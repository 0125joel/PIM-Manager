"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { AccountInfo } from "@azure/msal-browser";
import { AZURE_SCOPES } from "@/config/authConfig";
import { AUDIT_LOG_PERMISSION, LOG_ANALYTICS_PERMISSION } from "@/config/constants";
import { fetchAuditRows } from "@/services/auditService";
import { listWorkspaces, readWorkspaces } from "@/services/auditWorkspaceService";
import type { AuditEvent, RawDirectoryAudit } from "@/types/audit.types";
import { isAzureEnabled } from "@/utils/azureConsent";
import { mapAuditEvents } from "@/utils/auditEvents";
import { classifyAuditError, type AuditErrorKind } from "@/utils/auditErrors";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import { addGraphRows, allWorkspacesFailed, mergeWorkspaceRows, summarizeWorkspaceReads, workspacePeriodMax, workspaceReach, type WorkspaceRead, type WorkspaceRef, type WorkspaceSummary } from "@/utils/auditWorkspaceMerge";
import { failureReason } from "@/utils/auditWorkspaceStatus";
import { WORKSPACE_MAX_DAYS } from "@/utils/auditWorkspaceKql";
import { createArmClient } from "@/utils/armClient";
import { isAbortError } from "@/utils/errorUtils";
import { createGraphClient } from "@/utils/graphClient";
import { Logger } from "@/utils/logger";
import { classifyProbeError } from "@/utils/permissionStatus";

export type AuditStatus = "idle" | "permission" | "loading" | "ready" | "role-missing" | "too-many" | "failed";

/** Where the events of the last read came from, and how the read of the chosen workspaces went */
export interface AuditSourceInfo {
    kind: "graph" | "workspace";
    /** The reads of the chosen workspaces; null without a choice */
    summary: WorkspaceSummary | null;
    /** Every workspace failed and the 30 days of the Entra audit log are shown instead */
    fellBack: boolean;
}

export interface UseAuditDataResult {
    status: AuditStatus;
    source: AuditSourceInfo;
    /** The longest period the page offers: 30 days, or the longest retention of the chosen workspaces */
    maxDays: number;
    /** The period the last read asked for (named by the too-many state) */
    requestedDays: number;
    /** The mapped events of the last successful read (kept in memory only) */
    events: AuditEvent[];
    /** ISO time the last successful read finished */
    readAt: string | null;
    /** ISO start of the window the last successful read covered (for workspaces: how far back they reach) */
    oldest: string | null;
    /** Rows read so far while loading */
    loadedCount: number;
    isRequestingPermission: boolean;
    /** Starts a read of the last `days` days (without `days`: the whole period of the source), aborting the one in flight. Does nothing until the page calls it. */
    load: (days?: number) => void;
    /** Asks for AuditLog.Read.All in a popup, then reads the Entra audit log with the last chosen number of days (30 at first) */
    requestPermission: () => Promise<void>;
}

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
const GRAPH_SOURCE: AuditSourceInfo = { kind: "graph", summary: null, fellBack: false };

/** The rows from `startIso` on; a row without a valid time stays */
function rowsSince(rows: RawDirectoryAudit[], startIso: string): RawDirectoryAudit[] {
    const from = Date.parse(startIso);
    return rows.filter((row) => {
        const time = Date.parse(row.activityDateTime);
        return !Number.isFinite(time) || time >= from;
    });
}

interface ReadContext {
    controller: AbortController;
    isCurrent: () => boolean;
}

/**
 * The audit log of the Audit page (implementation spec sections 3 and 7). By default the Entra audit log behind the optional
 * AuditLog.Read.All permission; with a choice of Log Analytics workspaces (Settings) the chosen workspaces instead, merged,
 * for as long as they keep their logs. Both permissions are requested by incremental consent only, never at sign-in; without
 * a silent token no call is made. Events live in React state for the session: nothing of them goes to storage, and they are
 * cleared when the account (and with it the tenant) changes. A failed read keeps the events of the same tenant and sets the
 * status. When every chosen workspace fails, the 30 days of Graph are read instead and the page says so.
 */
export function useAuditData(): UseAuditDataResult {
    const { instance, accounts } = useMsal();
    const account: AccountInfo | undefined = accounts[0];
    // The home account id holds the tenant: a change of either clears what was read
    const accountKey = account?.homeAccountId ?? "";
    const tenantId = account?.tenantId;

    const [status, setStatus] = useState<AuditStatus>("idle");
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [readAt, setReadAt] = useState<string | null>(null);
    const [oldest, setOldest] = useState<string | null>(null);
    const [loadedCount, setLoadedCount] = useState(0);
    const [isRequestingPermission, setIsRequestingPermission] = useState(false);
    const [source, setSource] = useState<AuditSourceInfo>(GRAPH_SOURCE);
    const [maxDays, setMaxDays] = useState(DEFAULT_DAYS);
    const [requestedDays, setRequestedDays] = useState(DEFAULT_DAYS);
    const controllerRef = useRef<AbortController | null>(null);
    const daysRef = useRef<number | undefined>(undefined);

    /** Starts a read: aborts the one in flight; only the newest read may write */
    const begin = useCallback((): ReadContext => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        const isCurrent = () => controllerRef.current === controller && !controller.signal.aborted;
        setStatus("loading");
        setLoadedCount(0);
        return { controller, isCurrent };
    }, []);

    const end = useCallback((controller: AbortController) => {
        if (controllerRef.current === controller) controllerRef.current = null;
    }, []);

    /** The read of the Entra audit log. `acquire` gives the token (silent for load, popup after the consent). */
    const readGraph = useCallback(async (ctx: ReadContext, days: number, acquire: () => Promise<string>, info: AuditSourceInfo): Promise<void> => {
        const { controller, isCurrent } = ctx;
        let token: string;
        try {
            token = await acquire();
        } catch (tokenError: unknown) {
            // No consent for the optional scope, or a closed consent popup: the page asks for it. Anything else (network, an interaction in progress) is a failed read, never a question about permission. No Graph call is made.
            if (isCurrent()) {
                const isConsent = classifyProbeError(tokenError) === "notGranted" || (tokenError as { errorCode?: unknown } | null)?.errorCode === "user_cancelled";
                if (!isConsent) Logger.warn("useAuditData", "No token for the audit read", tokenError);
                setSource(info);
                setStatus(isConsent ? "permission" : "failed");
            }
            return;
        }
        if (!isCurrent()) return;
        // Named by the too-many state when this read is the one that fails
        setRequestedDays(days);
        const startIso = new Date(Date.now() - days * DAY_MS).toISOString();
        const rows = await fetchAuditRows(createGraphClient(token), startIso, {
            signal: controller.signal,
            onProgress: (count) => {
                if (isCurrent()) setLoadedCount(count);
            },
        });
        if (!isCurrent()) return;
        setEvents(mapAuditEvents(rows));
        setReadAt(new Date().toISOString());
        setOldest(startIso);
        setSource(info);
        setMaxDays(DEFAULT_DAYS);
        setStatus("ready");
    }, []);

    /** The chosen workspaces with their names and retention when Azure can say (silent token only: no popup on a page load) */
    const resolveWorkspaces = useCallback(async (ids: string[], signal: AbortSignal): Promise<{ refs: WorkspaceRef[]; retention: (number | undefined)[] }> => {
        const known = new Map<string, { name: string; retentionDays?: number }>();
        if (account && isAzureEnabled(account)) {
            try {
                const client = createArmClient(async () => (await instance.acquireTokenSilent({ scopes: AZURE_SCOPES, account })).accessToken);
                const listing = await listWorkspaces(client, account.tenantId, signal);
                for (const workspace of listing.workspaces) known.set(workspace.customerId, { name: workspace.name, retentionDays: workspace.retentionDays });
            } catch (error: unknown) {
                if (isAbortError(error)) throw error;
                // Names and retention are a refinement: the ids still work, with the longest period a workspace keeps
                Logger.warn("useAuditData", "The workspace names could not be listed; the ids are shown");
            }
        }
        return {
            refs: ids.map((customerId) => ({ customerId, name: known.get(customerId)?.name ?? customerId })),
            retention: ids.map((customerId) => known.get(customerId)?.retentionDays),
        };
    }, [account, instance]);

    /**
     * The last days of the Entra audit log next to a workspace read: a silent token only, never a popup. Its failure does not
     * stop the workspaces: it is told by its reason. An abort and the too-many state stay what they are.
     */
    const readGraphAlongside = useCallback(async (ctx: ReadContext, startIso: string): Promise<{ rows: RawDirectoryAudit[] | null; failure: string | null }> => {
        const { controller } = ctx;
        if (!account) return { rows: null, failure: "no permission" };
        let token: string;
        try {
            token = (await instance.acquireTokenSilent({ scopes: [AUDIT_LOG_PERMISSION], account })).accessToken;
        } catch (tokenError: unknown) {
            if (isAbortError(tokenError)) throw tokenError;
            const isConsent = classifyProbeError(tokenError) === "notGranted" || (tokenError as { errorCode?: unknown } | null)?.errorCode === "user_cancelled";
            if (!isConsent) Logger.warn("useAuditData", "No token for the Entra audit log next to the workspaces", tokenError);
            return { rows: null, failure: isConsent ? "no permission" : "no token" };
        }
        try {
            return { rows: await fetchAuditRows(createGraphClient(token), startIso, { signal: controller.signal }), failure: null };
        } catch (error: unknown) {
            if (isAbortError(error) || controller.signal.aborted) throw error;
            const kind = classifyAuditError(error);
            if (kind === "too-many") throw error;
            return { rows: null, failure: kind === "permission" ? "no permission" : kind === "role-missing" ? "no reader role" : failureReason(error) };
        }
    }, [account, instance]);

    /** The read of the chosen workspaces; every workspace failing falls back to the 30 days of Graph, visibly */
    const readFromWorkspaces = useCallback(async (ctx: ReadContext, ids: string[], days: number | undefined): Promise<void> => {
        const { controller, isCurrent } = ctx;
        if (!account) return;
        // The Entra audit log next to the workspaces needs nothing of their list or their reads: it starts at once. Its window is
        // the one the read below would use: 30 days, or the period asked for when that is shorter.
        const earlyDays = days === undefined ? DEFAULT_DAYS : Math.min(DEFAULT_DAYS, Math.max(1, Math.floor(days)));
        const early = readGraphAlongside(ctx, new Date(Date.now() - earlyDays * DAY_MS).toISOString());
        // An abort or a too-many ends the read where `early` is awaited; when the read ends before that, nobody is left to hear it
        early.catch(() => undefined);
        const { refs, retention } = await resolveWorkspaces(ids, controller.signal);
        if (!isCurrent()) return;
        const max = workspacePeriodMax(retention);
        const readDays = Math.min(Math.max(1, Math.floor(days ?? max)), WORKSPACE_MAX_DAYS);
        setMaxDays(max);
        setRequestedDays(readDays);
        const getToken = async () => (await instance.acquireTokenSilent({ scopes: [LOG_ANALYTICS_PERMISSION], account })).accessToken;
        let reads: WorkspaceRead[];
        try {
            // One silent request first: without the consent every workspace fails the same way, and it is told once
            await getToken();
            reads = await readWorkspaces(getToken, refs, readDays, { signal: controller.signal });
        } catch (error: unknown) {
            if (isAbortError(error) || !isCurrent()) return;
            const reason = classifyProbeError(error) === "notGranted" ? "permission not granted" : "no token";
            if (reason === "no token") Logger.warn("useAuditData", "No token for the workspace read", error);
            reads = refs.map((workspace) => ({ workspace, ok: false as const, reason }));
        }
        if (!isCurrent()) return;
        const firstSummary = summarizeWorkspaceReads(reads);
        if (allWorkspacesFailed(firstSummary)) {
            const summary = firstSummary;
            const info: AuditSourceInfo = { kind: "graph", summary, fellBack: true };
            setRequestedDays(DEFAULT_DAYS);
            // The early read of 30 days, when it was read, is the read of the fallback: no second one. A too-many ends the read as before.
            const fallbackRows = earlyDays === DEFAULT_DAYS ? (await early).rows : null;
            if (!isCurrent()) return;
            if (fallbackRows) {
                const startIso = new Date(Date.now() - DEFAULT_DAYS * DAY_MS).toISOString();
                setEvents(mapAuditEvents(rowsSince(fallbackRows, startIso)));
                setReadAt(new Date().toISOString());
                setOldest(startIso);
                setSource(info);
                setMaxDays(DEFAULT_DAYS);
                setStatus("ready");
                return;
            }
            await readGraph(ctx, DEFAULT_DAYS, async () => (await instance.acquireTokenSilent({ scopes: [AUDIT_LOG_PERMISSION], account })).accessToken, info);
            return;
        }
        const merged = mergeWorkspaceRows(reads, account.tenantId);
        // A workspace can miss events (measured): the last 30 days of the Entra audit log are read too, silently, under the same abort
        const graphDays = Math.min(DEFAULT_DAYS, readDays);
        const graphStart = new Date(Date.now() - graphDays * DAY_MS).toISOString();
        const graph = await early;
        if (!isCurrent()) return;
        // The early read started a little before this point, and for 30 days when the workspaces keep less: only the rows of this window count
        const graphRows = graph.rows ? rowsSince(graph.rows, graphStart) : [];
        const combined = addGraphRows(merged, graphRows);
        const summary = summarizeWorkspaceReads(reads, merged.otherTenant, { graphOnly: combined.graphOnly, failure: graph.failure });
        const names = combined.workspaceOf;
        // One action can span rows of both sources, so the whole is mapped once. An event is a workspace event only when its id came from a workspace.
        const mapped = mapAuditEvents(combined.rows).map((event): AuditEvent => (names.has(event.id) ? { ...event, source: "workspace", workspace: names.get(event.id) } : { ...event, source: "graph" }));
        const readTime = new Date().toISOString();
        setEvents(mapped);
        setReadAt(readTime);
        const reach = workspaceReach(reads);
        const earliest = [reach, graph.rows ? graphStart : null].filter((v): v is string => v !== null).sort()[0];
        setOldest(earliest ?? readTime);
        setSource({ kind: "workspace", summary, fellBack: false });
        setStatus("ready");
    }, [account, instance, readGraph, readGraphAlongside, resolveWorkspaces]);

    /** One read, of the chosen workspaces when there are any (and `useChoice`), else of Graph. Only the newest read may write. */
    const startRead = useCallback(async (days: number | undefined, acquire: () => Promise<string>, useChoice: boolean): Promise<void> => {
        const ctx = begin();
        try {
            const ids = useChoice ? readWorkspaceChoice(tenantId) : [];
            if (ids.length > 0) await readFromWorkspaces(ctx, ids, days);
            else await readGraph(ctx, days ?? DEFAULT_DAYS, acquire, GRAPH_SOURCE);
        } catch (error: unknown) {
            // An abort is a new read starting, not a failure
            if (!ctx.isCurrent() || isAbortError(error)) return;
            const kind: AuditErrorKind = classifyAuditError(error);
            setStatus(kind);
        } finally {
            end(ctx.controller);
        }
    }, [begin, end, readFromWorkspaces, readGraph, tenantId]);

    const load = useCallback((days?: number) => {
        daysRef.current = days;
        if (!account) return;
        void startRead(days, async () => (await instance.acquireTokenSilent({ scopes: [AUDIT_LOG_PERMISSION], account })).accessToken, true);
    }, [account, instance, startRead]);

    const requestPermission = useCallback(async () => {
        if (!account) return;
        setIsRequestingPermission(true);
        try {
            // The consent is for the Entra audit log, which is read by itself here, also when workspaces are chosen
            const days = daysRef.current === undefined ? undefined : Math.min(daysRef.current, DEFAULT_DAYS);
            await startRead(days, async () => {
                const result = await instance.acquireTokenPopup({ scopes: [AUDIT_LOG_PERMISSION], account });
                // Consent given by another account says nothing about this one
                if (result.account?.homeAccountId !== account.homeAccountId) {
                    Logger.warn("useAuditData", "The consent popup was finished with another account; nothing was read.");
                    throw Object.assign(new Error("another account"), { errorCode: "consent_required" });
                }
                return result.accessToken;
            }, false);
        } finally {
            setIsRequestingPermission(false);
        }
    }, [account, instance, startRead]);

    // A new account or tenant: drop what was read, and stop a read that belongs to the previous one
    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setEvents([]);
        setReadAt(null);
        setOldest(null);
        setLoadedCount(0);
        setSource(GRAPH_SOURCE);
        // With a choice the URL may name a period up to the longest a workspace keeps, until the retention is known
        setMaxDays(readWorkspaceChoice(tenantId).length > 0 ? WORKSPACE_MAX_DAYS : DEFAULT_DAYS);
        setRequestedDays(DEFAULT_DAYS);
        setStatus("idle");
        return () => {
            controllerRef.current?.abort();
            controllerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the home account id holds the tenant
    }, [accountKey]);

    return { status, source, maxDays, requestedDays, events, readAt, oldest, loadedCount, isRequestingPermission, load, requestPermission };
}
