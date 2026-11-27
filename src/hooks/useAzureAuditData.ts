"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { AccountInfo } from "@azure/msal-browser";
import { AUDIT_LOG_PERMISSION, LOG_ANALYTICS_PERMISSION } from "@/config/constants";
import { useAzureActions, useAzureData } from "@/contexts/AzureContext";
import { useArmToken } from "@/hooks/useAzureConsent";
import { definitionsOf, loadAzureRoleDefinitions } from "@/hooks/useAzureDashboardReads";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { fetchAuditRows } from "@/services/auditService";
import { listWorkspaces, readWorkspaces } from "@/services/auditWorkspaceService";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { readAzureAudit } from "@/services/azureAuditService";
import { readServicePrincipalTypes } from "@/services/servicePrincipalTypeService";
import type { AuditEvent, AzureEntraLogState, RawDirectoryAudit } from "@/types/audit.types";
import { createArmClient } from "@/utils/armClient";
import { mapAuditEvents } from "@/utils/auditEvents";
import { AuditTooManyEventsError, classifyAuditError } from "@/utils/auditErrors";
import { addGraphRows, allWorkspacesFailed, mergeWorkspaceRows, summarizeWorkspaceReads, workspacePeriodMax, workspaceReach, type WorkspaceRead, type WorkspaceRef, type WorkspaceSummary } from "@/utils/auditWorkspaceMerge";
import { applyApprovers, buildAzureHolderKinds, expandGroupActivations, hasUnnamedRole, mapAzureAuditEvents } from "@/utils/azureAuditEvents";
import { buildAzureAuditContext, holdingsOf, planAzureAuditRead, type AzureAuditNotRead } from "@/utils/azureAuditRead";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import { azureWorkspaceReach, AZURE_WORKSPACE_MAX_DAYS, ACTIVITY_LOG_DAYS, combineWorkspaceReads, lowerKeys, mergeAzureActivity, sendingSubscriptions, type AzureWorkspaceRead, type MergedActivity, workspaceLogFailures, type WorkspaceLogFailure } from "@/utils/azureWorkspaceActivity";
import { getErrorCode, getErrorStatusCode, isAbortError } from "@/utils/errorUtils";
import { createGraphClient } from "@/utils/graphClient";
import { Logger } from "@/utils/logger";
import { activityLogRateLimiter } from "@/utils/rateLimiter";
import { classifyProbeError } from "@/utils/permissionStatus";
import type { PrincipalKind } from "@/utils/principalUtils";

export type AzureAuditStatus = "idle" | "loading" | "ready" | "too-many" | "failed";
export type { AzureEntraLogState };

/** The chosen workspaces as the Azure Audit page shows them: what was read, and how far back the workspace data reaches */
export interface AzureWorkspaceInfo {
    summary: WorkspaceSummary;
    /** Every workspace failed: the last 90 days of the Azure activity log and the Entra audit log are shown instead, visibly */
    fellBack: boolean;
    /** The subscriptions that send their activity log to a workspace read (lower case); null when no workspace could say */
    sendingSubscriptionIds: Set<string> | null;
    /** How far back the workspaces reach (the earliest event their tables hold); null when unknown */
    oldest: string | null;
    /** One log that failed on a workspace whose other log was read */
    logFailures?: WorkspaceLogFailure[];
}

export interface UseAzureAuditDataResult {
    status: AzureAuditStatus;
    events: AuditEvent[];
    /** The kind of each app or agent the events name, by lower case id; an id that is missing is not known */
    holderKinds: ReadonlyMap<string, PrincipalKind>;
    /** The reads that gave nothing, and why: an empty answer is never told as nothing happened */
    notRead: AzureAuditNotRead[];
    /** How many of the requests are the user's own, read with `asTarget()` on scopes the user cannot read */
    ownRequestCount: number;
    entraLog: AzureEntraLogState | null;
    readAt: string | null;
    oldest: string | null;
    /** Rows kept so far while loading */
    loadedCount: number;
    progress: { done: number; total: number };
    /** The period the last read was asked for, in days (named by the too-many state) */
    requestedDays: number;
    /** The longest period the page offers: 90 days, or up to a year with a chosen workspace (until its retention is known, a year) */
    maxDays: number;
    /** How far back the Entra audit log reaches in this read: 30 days, or more when a workspace holds its `AuditLogs` */
    entraLogDays: number;
    /** The chosen workspaces of the last read; null without a choice */
    workspace: AzureWorkspaceInfo | null;
    /** Starts a read of the last `days` days (the longest period the page offers without one), aborting the one in flight. Does nothing until the page calls it. */
    load: (days?: number) => void;
}

const DAY_MS = 86_400_000;
/** The longest period without a workspace: the reach of the Activity Log and the request lists */
const AZURE_DAYS = 90;
const ENTRA_DAYS = 30;
const NO_KINDS: ReadonlyMap<string, PrincipalKind> = new Map();
const NO_PROGRESS = { done: 0, total: 0 };

/** Newest first; an event without a valid time sorts last */
function newestFirst(events: AuditEvent[]): AuditEvent[] {
    const key = (event: AuditEvent) => {
        const time = Date.parse(event.time);
        return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
    };
    return [...events].sort((a, b) => key(b) - key(a));
}

/** The earliest of some ISO times, or null when there are none */
function earliestIso(values: readonly (string | null)[]): string | null {
    let best: number | null = null;
    for (const value of values) {
        if (value === null) continue;
        const ms = Date.parse(value);
        if (Number.isFinite(ms) && (best === null || ms < best)) best = ms;
    }
    return best === null ? null : new Date(best).toISOString();
}

/**
 * The events that a workspace holds, marked as such: the id the mapper gave is in the workspace's map (lower case ids)
 */
function markWorkspace(events: readonly AuditEvent[], workspaceOf: ReadonlyMap<string, string>, sourceIdOf: (event: AuditEvent) => string): AuditEvent[] {
    return events.map((event): AuditEvent => {
        const name = workspaceOf.get(sourceIdOf(event));
        return name === undefined ? event : { ...event, source: "azure-workspace", workspace: name };
    });
}

/**
 * The audit log of the Azure Audit page: the ARM role requests and the Activity Log of the last 90 days (or the shorter period
 * asked for), with the Entra audit log of the last 30 days next to them when its permission allows (silent token only, never a
 * popup). With a chosen Log Analytics workspace, the workspaces' Azure activity log and Entra audit log are read as well, up to a
 * year, merged with the native reads so each event is shown once. Events live in React state for the session: nothing of them
 * goes to storage, and they are cleared, and the read stopped, when the account (and with it the tenant) changes. A failed read
 * keeps the events of the same tenant and sets the status. When every chosen workspace fails, the last 90 days are read as without one.
 */
export function useAzureAuditData(): UseAzureAuditDataResult {
    const { instance, accounts } = useMsal();
    const account: AccountInfo | undefined = accounts[0];
    const accountKey = account?.homeAccountId ?? "";
    const tenantId = account?.tenantId;
    const { scopes, assignments } = useAzureData();
    const { getArmClient } = useAzureActions();
    const getGraph = useGraphClient();
    const getArmToken = useArmToken();
    const logClient = useMemo(() => createArmClient(getArmToken, { limiter: activityLogRateLimiter }), [getArmToken]);

    const [status, setStatus] = useState<AzureAuditStatus>("idle");
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [holderKinds, setHolderKinds] = useState<ReadonlyMap<string, PrincipalKind>>(NO_KINDS);
    const [notRead, setNotRead] = useState<AzureAuditNotRead[]>([]);
    const [ownRequestCount, setOwnRequestCount] = useState(0);
    const [entraLog, setEntraLog] = useState<AzureEntraLogState | null>(null);
    const [readAt, setReadAt] = useState<string | null>(null);
    const [oldest, setOldest] = useState<string | null>(null);
    const [loadedCount, setLoadedCount] = useState(0);
    const [progress, setProgress] = useState(NO_PROGRESS);
    const [requestedDays, setRequestedDays] = useState(AZURE_DAYS);
    const [maxDays, setMaxDays] = useState(AZURE_DAYS);
    const [entraLogDays, setEntraLogDays] = useState(ENTRA_DAYS);
    const [workspace, setWorkspace] = useState<AzureWorkspaceInfo | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    /** The Entra audit log, optional: a silent token only. Its failure is told by its reason and never stops the page. */
    const readEntra = useCallback(async (signal: AbortSignal): Promise<{ rows: RawDirectoryAudit[] | null; state: AzureEntraLogState }> => {
        if (!account) return { rows: null, state: "no permission" };
        let token: string;
        try {
            token = (await instance.acquireTokenSilent({ scopes: [AUDIT_LOG_PERMISSION], account })).accessToken;
        } catch (tokenError: unknown) {
            if (isAbortError(tokenError) || signal.aborted) throw tokenError;
            const isConsent = classifyProbeError(tokenError) === "notGranted" || (tokenError as { errorCode?: unknown } | null)?.errorCode === "user_cancelled";
            if (!isConsent) Logger.warn("useAzureAuditData", "No token for the Entra audit log next to the Azure sources", tokenError);
            return { rows: null, state: isConsent ? "no permission" : "no token" };
        }
        try {
            // `loggedByService eq 'PIM'` holds ResourceManagement and GroupManagement (measured), so no other read is needed
            const start = new Date(Date.now() - ENTRA_DAYS * DAY_MS).toISOString();
            return { rows: await fetchAuditRows(createGraphClient(token), start, { signal }), state: "read" };
        } catch (error: unknown) {
            if (isAbortError(error) || signal.aborted) throw error;
            const kind = classifyAuditError(error);
            if (kind !== "failed") Logger.info("useAzureAuditData", `The Entra audit log was not read (${kind})`);
            else Logger.warn("useAzureAuditData", `The Entra audit log read failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
            const state: AzureEntraLogState = kind === "role-missing" ? "no reader role" : kind === "permission" ? "no permission" : kind === "too-many" ? "too many" : "failed";
            return { rows: null, state };
        }
    }, [account, instance]);

    /** The chosen workspaces with their names and retention when Azure can say (the ids still work without them) */
    const resolveWorkspaces = useCallback(async (ids: string[], signal: AbortSignal): Promise<{ refs: WorkspaceRef[]; retention: (number | undefined)[] }> => {
        const known = new Map<string, { name: string; retentionDays?: number }>();
        if (account) {
            try {
                const listing = await listWorkspaces(getArmClient(), account.tenantId, signal);
                for (const workspace of listing.workspaces) known.set(workspace.customerId, { name: workspace.name, retentionDays: workspace.retentionDays });
            } catch (error: unknown) {
                if (isAbortError(error)) throw error;
                Logger.warn("useAzureAuditData", "The workspace names could not be listed; the ids are shown");
            }
        }
        return {
            refs: ids.map((customerId) => ({ customerId, name: known.get(customerId)?.name ?? customerId })),
            retention: ids.map((customerId) => known.get(customerId)?.retentionDays),
        };
    }, [account, getArmClient]);

    /**
     * The reads of both logs of the chosen workspaces: silent token only. A missing token makes every workspace fail by its
     * reason; an abort throws.
     */
    const readChosen = useCallback(async (chosen: AccountInfo, signal: AbortSignal, refs: readonly WorkspaceRef[], days: number): Promise<{ entra: WorkspaceRead[]; azure: AzureWorkspaceRead[] }> => {
        const getToken = async () => (await instance.acquireTokenSilent({ scopes: [LOG_ANALYTICS_PERMISSION], account: chosen })).accessToken;
        try {
            // One silent request first: without the consent every workspace fails the same way, and it is told once
            await getToken();
            // Both logs together: the gate of the query service keeps the queries in flight within the limit
            const [entra, azure] = await Promise.all([
                readWorkspaces(getToken, refs, days, { signal }),
                readAzureWorkspaces(getToken, refs, days, { signal }),
            ]);
            return { entra, azure };
        } catch (error: unknown) {
            if (isAbortError(error) || signal.aborted) throw error;
            const reason = classifyProbeError(error) === "notGranted" ? "permission not granted" : "no token";
            if (reason === "no token") Logger.warn("useAzureAuditData", "No token for the workspace read", error);
            return {
                entra: refs.map((workspace) => ({ workspace, ok: false as const, reason })),
                azure: refs.map((workspace) => ({ workspace, ok: false as const, reason })),
            };
        }
    }, [instance]);

    const load = useCallback((days?: number) => {
        if (!account) return;
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        const isCurrent = () => controllerRef.current === controller && !controller.signal.aborted;
        setStatus("loading");
        setLoadedCount(0);
        setProgress(NO_PROGRESS);
        const choice = readWorkspaceChoice(tenantId);

        const run = async (): Promise<void> => {
            // Fixed at the start, so the window does not move while the reads run
            const started = Date.now();
            const to = new Date(started).toISOString();
            const noop = () => undefined;
            // The reads that wait for nothing run together; the first error of the native read ends the others
            const side = new AbortController();
            controller.signal.addEventListener("abort", () => side.abort(), { once: true });

            // The Entra audit log has a fixed window (30 days) and needs nothing of the other reads
            const entraRead = readEntra(side.signal);
            entraRead.catch(noop);

            let refs: WorkspaceRef[] = [];
            let offered = AZURE_DAYS;
            let readDays = days ?? AZURE_DAYS;
            // The Activity Log keeps 90 days, so ARM is read no further back, with or without a workspace (a new setting misses events without a sign).
            // `from` needs only `days`: without one the period is at least 90 days, with one it is cut to 1 to 365 days when a workspace is chosen.
            const armDays = Math.min(ACTIVITY_LOG_DAYS, choice.length > 0 ? (days === undefined ? ACTIVITY_LOG_DAYS : Math.min(Math.max(1, Math.floor(days)), AZURE_WORKSPACE_MAX_DAYS)) : readDays);
            const armFrom = new Date(started - armDays * DAY_MS).toISOString();

            // The chosen workspaces: their names and retention, then their logs, next to the native read
            let resolving: Promise<void> | null = null;
            let workspaceReads: Promise<{ entra: WorkspaceRead[]; azure: AzureWorkspaceRead[] }> | null = null;
            if (choice.length > 0) {
                resolving = (async () => {
                    const resolved = await resolveWorkspaces(choice, side.signal);
                    if (!isCurrent()) throw new DOMException("The read was replaced.", "AbortError");
                    refs = resolved.refs;
                    // Until the retention is known the page may ask for a year, so a URL with a longer period is not cut
                    // Never below the 90 days of the native read: a workspace that keeps less takes nothing away
                    offered = Math.min(Math.max(workspacePeriodMax(resolved.retention), AZURE_DAYS), AZURE_WORKSPACE_MAX_DAYS);
                    readDays = Math.min(Math.max(1, Math.floor(days ?? offered)), AZURE_WORKSPACE_MAX_DAYS);
                    setMaxDays(offered);
                    setRequestedDays(readDays);
                })();
                resolving.catch(noop);
                workspaceReads = resolving.then(() => readChosen(account, side.signal, refs, readDays));
                workspaceReads.catch(noop);
            } else {
                setRequestedDays(readDays);
            }

            let raw: Awaited<ReturnType<typeof readAzureAudit>>;
            try {
                raw = await readAzureAudit({
                    client: getArmClient(),
                    logClient,
                    plan: planAzureAuditRead(scopes),
                    from: armFrom,
                    to,
                    signal: controller.signal,
                    onRows: (count) => {
                        if (isCurrent()) setLoadedCount(count);
                    },
                    onProgress: (done, total) => {
                        if (isCurrent()) setProgress({ done, total });
                    },
                });
            } catch (error: unknown) {
                // The page names the period of this read in the too-many state: it is set once the workspaces are resolved
                if (resolving && isCurrent()) await resolving.catch(noop);
                side.abort();
                throw error;
            }
            if (!isCurrent()) return;
            const armAllNotRead = raw.tried > 0 && raw.notRead.length >= raw.tried;

            // Each workspace read is counted once: every log of every chosen workspace, silently
            let entraReads: WorkspaceRead[] = [];
            let azureReads: AzureWorkspaceRead[] = [];
            let fellBack = false;
            if (workspaceReads) {
                const reads = await workspaceReads;
                if (!isCurrent()) return;
                entraReads = reads.entra;
                azureReads = reads.azure;
                fellBack = allWorkspacesFailed(summarizeWorkspaceReads(combineWorkspaceReads(entraReads, azureReads)));
            }
            // Every workspace failed: back to the native read, at most 90 days, visibly
            const cutDays = fellBack ? Math.min(readDays, AZURE_DAYS) : readDays;
            if (fellBack) setRequestedDays(cutDays);
            const hasChoice = refs.length > 0 && !fellBack;
            const periodStart = new Date(started - cutDays * DAY_MS).toISOString();

            // The rows of the workspaces, merged so that each event is shown once (throws too many)
            const entraMerged = hasChoice ? mergeWorkspaceRows(entraReads, tenantId ?? "") : null;
            const azureMerged: MergedActivity | null = hasChoice ? mergeAzureActivity(raw.activity, azureReads) : null;
            // No workspace row and every native read gave nothing: failed. A person without an Azure role who may read a workspace sees what it holds.
            const workspaceRowCount = (entraMerged?.rows.length ?? 0) + (azureMerged?.rows.length ?? 0);
            if (armAllNotRead && workspaceRowCount === 0) {
                // The Entra rows are not shown in this state: their read ends here
                side.abort();
                setNotRead(raw.notRead);
                setOwnRequestCount(raw.ownRequestCount);
                setStatus("failed");
                return;
            }

            const entra = await entraRead;
            if (!isCurrent()) return;
            let entraRows: RawDirectoryAudit[] | null = entra.rows;
            let entraWorkspaceOf = new Map<string, string>();
            let otherTenant = 0;
            let graphOnly = 0;
            // A workspace counts for the Entra log only when it holds some: an empty table reaches nowhere, and must not hide that the log is missing
            const entraWorkspaceReach = hasChoice ? workspaceReach(entraReads) : null;
            const entraWorkspaceHolds = entraWorkspaceReach !== null;
            if (entraMerged) {
                // A workspace can miss events (measured): the Entra audit log of the last 30 days is added where the workspace has no row
                const combined = addGraphRows(entraMerged, entra.rows ?? []);
                entraRows = combined.rows;
                entraWorkspaceOf = lowerKeys(combined.workspaceOf);
                otherTenant = entraMerged.otherTenant;
                graphOnly = combined.graphOnly;
            }

            let context = buildAzureAuditContext(scopes, assignments);
            const requests = [...raw.assignmentRequests, ...raw.eligibilityRequests];
            const armRows = azureMerged ? azureMerged.rows : raw.activity;
            const mapArm = () => mapAzureAuditEvents({ assignmentRequests: raw.assignmentRequests, eligibilityRequests: raw.eligibilityRequests, activity: armRows, context });
            let armEvents = mapArm();
            // A role that nobody holds any more is named by its definition (the existing read, cached for the session); a failed read leaves the events as they are
            if (hasUnnamedRole(armEvents)) {
                try {
                    const result = await loadAzureRoleDefinitions(getArmClient(), scopes, controller.signal);
                    if (!isCurrent()) return;
                    if (result.status === "failed") Logger.warn("useAzureAuditData", "The role definitions could not be read");
                    // "loading" is a stopped read: the events stay as they are
                    const definitions = definitionsOf(result);
                    if (definitions) {
                        context = buildAzureAuditContext(scopes, assignments, definitions);
                        armEvents = mapArm();
                    }
                } catch (error: unknown) {
                    if (isAbortError(error) || controller.signal.aborted) throw error;
                    Logger.warn("useAzureAuditData", `The role definitions could not be read (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
                }
            }
            let groupEvents: AuditEvent[] = [];
            if (entraRows) {
                armEvents = applyApprovers(armEvents, entraRows);
                groupEvents = expandGroupActivations(mapAuditEvents(entraRows), holdingsOf(assignments), context);
            }
            if (azureMerged) armEvents = markWorkspace(armEvents, azureMerged.workspaceOf, (event) => event.id.toLowerCase());
            // A group row whose activation came from a workspace is that workspace's too: its id starts with the Entra event id
            groupEvents = markWorkspace(groupEvents, entraWorkspaceOf, (event) => event.id.split("|")[0].toLowerCase());
            // The request lists hold their whole history; the page says the period. Only the events are cut: the mapper got every row, so links stay right.
            const fromMs = Date.parse(periodStart);
            const all = newestFirst([...armEvents, ...groupEvents]).filter((event) => {
                const time = Date.parse(event.time);
                return !Number.isFinite(time) || time >= fromMs;
            });

            // Graph tells an app from an agent for the apps the PIM lists do not name
            const known = buildAzureHolderKinds({ requests, assignments, servicePrincipalTypes: new Map() });
            const unknown = [...new Set(all.filter((event) => event.targetIsApp && event.target?.id).map((event) => (event.target?.id ?? "").toLowerCase()))].filter((id) => !known.has(id));
            let servicePrincipalTypes = new Map<string, string>();
            if (unknown.length > 0) {
                try {
                    servicePrincipalTypes = await readServicePrincipalTypes(await getGraph(), unknown, controller.signal);
                } catch (error: unknown) {
                    if (isAbortError(error) || controller.signal.aborted) throw error;
                    // Those ids stay unknown
                    Logger.warn("useAzureAuditData", `The kinds of the apps could not be read (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
                }
            }
            if (!isCurrent()) return;

            const readTime = new Date().toISOString();
            setEvents(all);
            setHolderKinds(buildAzureHolderKinds({ requests, assignments, servicePrincipalTypes }));
            setNotRead(raw.notRead);
            setOwnRequestCount(raw.ownRequestCount);
            setEntraLog(entra.state === "read" || entraWorkspaceHolds ? "read" : entra.state);
            // How far the Entra rows really reach: what the workspace holds, or the 30 days of Graph when that was read. Never the period asked for.
            if (entraWorkspaceHolds) {
                const reachDays = Math.max(1, Math.floor((started - Date.parse(entraWorkspaceReach)) / DAY_MS));
                setEntraLogDays(Math.max(entra.state === "read" ? ENTRA_DAYS : 0, reachDays));
            } else {
                setEntraLogDays(ENTRA_DAYS);
            }
            setMaxDays(choice.length > 0 && !fellBack ? offered : AZURE_DAYS);
            setReadAt(readTime);
            if (hasChoice) {
                const reach = earliestIso([workspaceReach(entraReads), azureWorkspaceReach(azureReads)]);
                const combinedReads = combineWorkspaceReads(entraReads, azureReads);
                setWorkspace({
                    // Without Graph next to it, what a workspace missed in the last 30 days is not added: told, as on the Entra page. Without a workspace that holds the log, the notice about groups says it.
                    summary: summarizeWorkspaceReads(combinedReads, otherTenant, { graphOnly, failure: entraWorkspaceHolds && entra.state !== "read" ? entra.state : null }),
                    fellBack: false,
                    sendingSubscriptionIds: sendingSubscriptions(azureReads),
                    oldest: reach,
                    logFailures: workspaceLogFailures(entraReads, azureReads),
                });
                // What can really be there: the native read and what the workspaces hold. A workspace that started recently never claims the whole period.
                setOldest(earliestIso([armFrom, reach]) ?? armFrom);
            } else if (fellBack) {
                setWorkspace({
                    summary: summarizeWorkspaceReads(combineWorkspaceReads(entraReads, azureReads)),
                    fellBack: true,
                    sendingSubscriptionIds: null,
                    oldest: null,
                });
                setOldest(periodStart);
            } else {
                setWorkspace(null);
                setOldest(periodStart);
            }
            setStatus("ready");
        };

        void run()
            .catch((error: unknown) => {
                // An abort is a new read starting, not a failure
                if (!isCurrent() || isAbortError(error)) return;
                if (error instanceof AuditTooManyEventsError) {
                    setStatus("too-many");
                    return;
                }
                Logger.warn("useAzureAuditData", `The Azure audit read failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
                setStatus("failed");
            })
            .finally(() => {
                if (controllerRef.current === controller) controllerRef.current = null;
            });
    }, [account, assignments, getArmClient, getGraph, logClient, readChosen, readEntra, resolveWorkspaces, scopes, tenantId]);


    // A new account or tenant: drop what was read, and stop a read that belongs to the previous one
    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setEvents([]);
        setHolderKinds(NO_KINDS);
        setNotRead([]);
        setOwnRequestCount(0);
        setEntraLog(null);
        setReadAt(null);
        setOldest(null);
        setLoadedCount(0);
        setProgress(NO_PROGRESS);
        setRequestedDays(AZURE_DAYS);
        // With a choice the URL may name a period up to the longest a workspace keeps, until the retention is known
        setMaxDays(readWorkspaceChoice(tenantId).length > 0 ? AZURE_WORKSPACE_MAX_DAYS : AZURE_DAYS);
        setEntraLogDays(ENTRA_DAYS);
        setWorkspace(null);
        setStatus("idle");
        return () => {
            controllerRef.current?.abort();
            controllerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the home account id holds the tenant
    }, [accountKey]);

    return { status, events, holderKinds, notRead, ownRequestCount, entraLog, readAt, oldest, loadedCount, progress, requestedDays, maxDays, entraLogDays, workspace, load };
}
