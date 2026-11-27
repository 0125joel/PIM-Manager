"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import type { AccountInfo } from "@azure/msal-browser";
import type { WorkspaceListItem, WorkspaceProps, WorkspaceStatusItem, WorkspaceStep } from "@/app/settings/components/settingsTypes";
import { AZURE_SCOPES } from "@/config/authConfig";
import { LOG_ANALYTICS_PERMISSION } from "@/config/constants";
import { useAzureConsent } from "@/hooks/useAzureConsent";
import { listSubscriptions } from "@/services/azureScopeService";
import { checkWorkspaceLogs, listActivityLogWorkspaceIds, listAuditLogWorkspaceIds, listWorkspaces, type SubscriptionFailure, type WorkspaceInfo } from "@/services/auditWorkspaceService";
import { readWorkspaceChoice, writeWorkspaceChoice, AUDIT_WORKSPACE_LIMIT } from "@/utils/auditWorkspaceChoice";
import { normalizeWorkspaceId } from "@/utils/auditWorkspaceKql";
import type { WorkspaceLogsCheck } from "@/utils/auditWorkspaceStatus";
import { checkedLine, keepsText, workspaceLogLines, workspaceSummaryText, workspaceWhereText, type OtherWorkspace, type SubscriptionFact } from "@/utils/auditWorkspaceView";
import { type ArmClient, createArmClient } from "@/utils/armClient";
import { acquireArmToken, isAzureEnabled } from "@/utils/azureConsent";
import { isAbortError } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { classifyProbeError } from "@/utils/permissionStatus";
import type { ArmSubscription } from "@/types/azureResource.types";

const NOT_A_GUID = "That is not a workspace ID. It is a GUID such as 00000000-0000-0000-0000-000000000000, shown on the Overview page of the workspace.";
const TOO_MANY = `At most ${AUDIT_WORKSPACE_LIMIT} workspaces can be chosen.`;
const PENDING = "Not checked yet. Press Check again.";

interface Listing {
    workspaces: WorkspaceInfo[];
    failedSubscriptions: SubscriptionFailure[];
    /** Lower-case ARM ids of the workspaces that receive the Entra audit log; null when that could not be read */
    receivesEntra: Set<string> | null;
    /** Lower-case ARM ids of the workspaces that receive the Azure activity log; null when no subscription could be read */
    receivesActivity: Set<string> | null;
}

function describeConsentFailure(error: unknown): string {
    if (classifyProbeError(error) === "notGranted" || (error as { errorCode?: unknown } | null)?.errorCode === "user_cancelled") {
        return "The permission was not granted. The sign-in window may have been closed, or your tenant needs an admin to approve it. Try again, or ask an admin.";
    }
    return "The permission was not granted. The sign-in window may have been blocked. Try again.";
}

/** The subscriptions the Audit page reads: Enabled, and of the home tenant, as `listWorkspaces` filters them */
function visibleSubscriptions(all: readonly ArmSubscription[], homeTenantId: string | undefined): SubscriptionFact[] {
    return all
        .filter((s) => s.state === "Enabled" && (!homeTenantId || !s.tenantId || s.tenantId.toLowerCase() === homeTenantId.toLowerCase()))
        .map((s) => ({ id: s.subscriptionId.toLowerCase(), name: s.displayName }));
}

/** The subscriptions for the count and the mark. A failure is silent: the count is then left out, never guessed. */
async function readSubscriptions(client: ArmClient, homeTenantId: string | undefined, signal: AbortSignal): Promise<SubscriptionFact[] | null> {
    try {
        return visibleSubscriptions(await listSubscriptions(client, signal), homeTenantId);
    } catch (error: unknown) {
        if (isAbortError(error)) throw error;
        Logger.warn("useAuditWorkspaces", "The subscriptions could not be listed; the count of subscriptions is left out");
        return null;
    }
}

const noToken = (): WorkspaceLogsCheck => ({ entra: { kind: "failed", detail: "no token" }, azure: { kind: "failed", detail: "no token" }, subscriptionIds: [] });

/**
 * Choosing Log Analytics workspaces for the Audit page and Settings (implementation spec section 7 and 8). Flow: Choose, Azure access
 * if it is missing, one list with checkboxes across all subscriptions (a typed ID always adds to the selection), the Log Analytics
 * permission, a check per workspace for each of its two logs, a status per workspace. Only the customer ids are stored, per tenant,
 * in this browser. Apart from the silent read of the names of the chosen workspaces on mount, nothing runs until a person presses a
 * button: the page loads without a popup.
 */
export function useAuditWorkspaces(tenantLabel: string | null): WorkspaceProps {
    const { instance, accounts } = useMsal();
    const account: AccountInfo | undefined = accounts[0];
    const tenantId = account?.tenantId;
    const azure = useAzureConsent();

    // The choice of this tenant, read again when the tenant becomes known (adjust state while rendering)
    const [chosen, setChosen] = useState(() => ({ tenantId, ids: readWorkspaceChoice(tenantId) }));
    if (chosen.tenantId !== tenantId) setChosen({ tenantId, ids: readWorkspaceChoice(tenantId) });
    const chosenIds = chosen.ids;

    const [step, setStep] = useState<WorkspaceStep>(() => (chosenIds.length > 0 ? "chosen" : "none"));
    const [listing, setListing] = useState<Listing | null>(null);
    const [listError, setListError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [manualIds, setManualIds] = useState<string[]>([]);
    const [manualDraft, setManualDraft] = useState("");
    const [manualError, setManualError] = useState<string | null>(null);
    const [consentMessage, setConsentMessage] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);
    const [checks, setChecks] = useState<ReadonlyMap<string, WorkspaceLogsCheck>>(new Map());
    const [subscriptions, setSubscriptions] = useState<SubscriptionFact[] | null>(null);
    const [facts, setFacts] = useState<ReadonlyMap<string, { name: string; retentionDays?: number }>>(new Map());
    const [checkedAt, setCheckedAt] = useState<string | null>(null);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => () => controllerRef.current?.abort(), []);
    const nextController = useCallback((): AbortController => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        return controller;
    }, []);

    const armClient = useCallback(() => createArmClient(() => {
        if (!account) return Promise.reject(new Error("No signed-in account for Azure Resource Manager"));
        return acquireArmToken(instance, account);
    }), [account, instance]);

    /** Silent only: a check or a read never opens a window by itself */
    const lawToken = useCallback(async (): Promise<string> => {
        if (!account) throw new Error("No signed-in account");
        return (await instance.acquireTokenSilent({ scopes: [LOG_ANALYTICS_PERMISSION], account })).accessToken;
    }, [account, instance]);

    const rememberFacts = useCallback((workspaces: readonly WorkspaceInfo[]) => {
        setFacts((current) => {
            const next = new Map(current);
            for (const w of workspaces) next.set(w.customerId, { name: w.name, retentionDays: w.retentionDays });
            return next;
        });
    }, []);

    // Once when the section mounts: the names of the chosen workspaces, read with the call the chooser uses, so the Settings lines name
    // them before the first check. Only ids are stored. Silent (no popup); a failed listing changes nothing, and the id stays.
    useEffect(() => {
        if (chosenIds.length === 0 || !account || !isAzureEnabled(account)) return;
        const controller = new AbortController();
        const client = createArmClient(async () => (await instance.acquireTokenSilent({ scopes: AZURE_SCOPES, account })).accessToken);
        listWorkspaces(client, account.tenantId, controller.signal)
            .then((found) => rememberFacts(found.workspaces))
            .catch((error: unknown) => {
                if (isAbortError(error)) return;
                Logger.warn("useAuditWorkspaces", "The names of the chosen workspaces could not be listed; the ids are shown");
            });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once when the section mounts; the chooser keeps the names after that
    }, [account?.homeAccountId]);

    const loadListing = useCallback(async (): Promise<void> => {
        const controller = nextController();
        setStep("listing");
        setListError(null);
        try {
            const client = armClient();
            const found = await listWorkspaces(client, tenantId, controller.signal);
            // The subscriptions give the count and the mark; a failure leaves them out
            const visible = await readSubscriptions(client, tenantId, controller.signal);
            // Convenience marks: when they cannot be read nothing is shown
            let receivesEntra: Set<string> | null = null;
            try {
                receivesEntra = await listAuditLogWorkspaceIds(client, controller.signal);
            } catch (error: unknown) {
                if (isAbortError(error)) throw error;
                Logger.warn("useAuditWorkspaces", "The Entra diagnostic settings could not be read; no mark is shown");
            }
            let receivesActivity: Set<string> | null = null;
            if (visible) {
                try {
                    receivesActivity = await listActivityLogWorkspaceIds(client, visible.map((s) => s.id), controller.signal);
                } catch (error: unknown) {
                    if (isAbortError(error)) throw error;
                    Logger.warn("useAuditWorkspaces", "The subscription diagnostic settings could not be read; no mark is shown");
                }
            }
            if (controller.signal.aborted) return;
            rememberFacts(found.workspaces);
            setSubscriptions(visible);
            setListing({ workspaces: found.workspaces, failedSubscriptions: found.failedSubscriptions, receivesEntra, receivesActivity });
            // The chosen ones stay chosen; so do ids typed earlier
            setSelected((current) => (current.length > 0 ? current : chosenIds));
            setStep(found.workspaces.length === 0 ? "nolist" : "list");
        } catch (error: unknown) {
            if (isAbortError(error) || controller.signal.aborted) return;
            Logger.warn("useAuditWorkspaces", "The workspaces could not be listed");
            setListing(null);
            setListError("Azure did not return the subscriptions or their workspaces. This says nothing about whether any workspace exists. Try again, or enter a workspace ID.");
            setStep("list");
        }
    }, [armClient, chosenIds, nextController, rememberFacts, tenantId]);

    const choose = useCallback(() => {
        setConsentMessage(null);
        setManualError(null);
        setSelected(chosenIds);
        if (isAzureEnabled(account)) void loadListing();
        else setStep("azure");
    }, [account, chosenIds, loadListing]);

    const grantAzure = useCallback(async () => {
        setIsBusy(true);
        setConsentMessage(null);
        try {
            const ok = await azure.enable();
            if (ok) await loadListing();
            else setConsentMessage("Azure access was not granted. The sign-in window may have been closed, or your tenant needs an admin to approve it. You can enter a workspace ID instead.");
        } finally {
            setIsBusy(false);
        }
    }, [azure, loadListing]);

    const toggle = useCallback((customerId: string) => {
        setManualError(null);
        setSelected((current) => (current.includes(customerId) ? current.filter((id) => id !== customerId) : [...current, customerId]));
    }, []);

    /** Checks the given workspaces for each log, stores them as the choice, and shows their statuses */
    const runCheck = useCallback(async (ids: string[], options: { refreshFacts: boolean }): Promise<void> => {
        if (!account) return;
        const controller = nextController();
        setIsBusy(true);
        setStep("checking");
        try {
            if (isAzureEnabled(account)) {
                // Silently: names and retention when asked, and the subscriptions for the count; a failure leaves them out
                const client = createArmClient(async () => (await instance.acquireTokenSilent({ scopes: AZURE_SCOPES, account })).accessToken);
                if (options.refreshFacts) {
                    try {
                        rememberFacts((await listWorkspaces(client, account.tenantId, controller.signal)).workspaces);
                    } catch (error: unknown) {
                        if (isAbortError(error)) throw error;
                    }
                }
                setSubscriptions(await readSubscriptions(client, account.tenantId, controller.signal));
            } else {
                setSubscriptions(null);
            }
            const result = await checkWorkspaceLogs(lawToken, ids, { signal: controller.signal });
            if (controller.signal.aborted) return;
            writeWorkspaceChoice(tenantId, ids);
            setChosen({ tenantId, ids });
            setChecks(result);
            setCheckedAt(new Date().toISOString());
            setStep("chosen");
        } catch (error: unknown) {
            if (isAbortError(error) || controller.signal.aborted) return;
            // The token failed: no workspace was checked, so each is told as a named failure and the choice is not stored
            Logger.warn("useAuditWorkspaces", "The workspaces could not be checked");
            if (classifyProbeError(error) === "notGranted") {
                setConsentMessage(null);
                setStep("consent");
            } else {
                setChecks(new Map(ids.map((id) => [id, noToken()])));
                setCheckedAt(new Date().toISOString());
                writeWorkspaceChoice(tenantId, ids);
                setChosen({ tenantId, ids });
                setStep("chosen");
            }
        } finally {
            setIsBusy(false);
        }
    }, [account, instance, lawToken, nextController, rememberFacts, tenantId]);

    /** Use the selection: the Log Analytics permission if it is missing, then the check */
    const applySelection = useCallback(async () => {
        // A typed id adds to the selection; it is checked before it is used
        let ids = selected;
        if (step === "manual") {
            const typed = manualDraft.trim() === "" ? null : normalizeWorkspaceId(manualDraft);
            if (manualDraft.trim() !== "" && typed === null) {
                setManualError(NOT_A_GUID);
                return;
            }
            if (typed !== null && !ids.includes(typed)) ids = [...ids, typed];
            if (typed !== null) setManualIds((current) => (current.includes(typed) ? current : [...current, typed]));
            setManualDraft("");
            setManualError(null);
            setSelected(ids);
        }
        if (ids.length === 0) {
            setManualError("Enter a workspace ID.");
            return;
        }
        if (ids.length > AUDIT_WORKSPACE_LIMIT) {
            setManualError(TOO_MANY);
            return;
        }
        try {
            await lawToken();
        } catch (error: unknown) {
            if (classifyProbeError(error) === "notGranted") {
                setConsentMessage(null);
                setStep("consent");
                return;
            }
            Logger.warn("useAuditWorkspaces", "No token for Log Analytics", error);
            setConsentMessage("PIM Manager could not get a token for Log Analytics. Try again.");
            setStep("consent");
            return;
        }
        await runCheck(ids, { refreshFacts: false });
    }, [lawToken, manualDraft, runCheck, selected, step]);

    const grantLogAnalytics = useCallback(async () => {
        if (!account) return;
        setIsBusy(true);
        setConsentMessage(null);
        try {
            const result = await instance.acquireTokenPopup({ scopes: [LOG_ANALYTICS_PERMISSION], account });
            // Consent given by another account says nothing about this one
            if (result.account?.homeAccountId !== account.homeAccountId) {
                setConsentMessage("The sign-in window was finished with another account. Sign in with the account PIM Manager is using.");
                return;
            }
        } catch (error: unknown) {
            Logger.warn("useAuditWorkspaces", "Consent for Log Analytics failed", error);
            setConsentMessage(describeConsentFailure(error));
            return;
        } finally {
            setIsBusy(false);
        }
        await runCheck(selected, { refreshFacts: false });
    }, [account, instance, runCheck, selected]);

    const showManual = useCallback(() => {
        setManualError(null);
        setStep("manual");
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
        setIsBusy(false);
        setConsentMessage(null);
        setManualError(null);
        setManualDraft("");
        setStep(chosenIds.length > 0 ? "chosen" : "none");
    }, [chosenIds]);

    const checkAgain = useCallback(() => void runCheck(chosenIds, { refreshFacts: true }), [chosenIds, runCheck]);

    const removeAll = useCallback(() => {
        controllerRef.current?.abort();
        writeWorkspaceChoice(tenantId, []);
        setChosen({ tenantId, ids: [] });
        setChecks(new Map());
        setSelected([]);
        setManualIds([]);
        setCheckedAt(null);
        setStep("none");
    }, [tenantId]);

    const items = useMemo<WorkspaceListItem[]>(() => {
        const listed = (listing?.workspaces ?? []).map((w): WorkspaceListItem => ({
            customerId: w.customerId,
            name: w.name,
            where: workspaceWhereText(w.subscriptionName, w.location, w.retentionDays),
            ...(listing?.receivesEntra ? { receivesEntraLogs: listing.receivesEntra.has(w.id.toLowerCase()) } : {}),
            ...(listing?.receivesActivity ? { receivesActivityLogs: listing.receivesActivity.has(w.id.toLowerCase()) } : {}),
            isSelected: selected.includes(w.customerId),
        }));
        // Chosen or typed ids the list does not hold stay visible and selectable, so a typed id is never lost from the choice
        const known = new Set(listed.map((w) => w.customerId));
        const extra = [...new Set([...chosenIds, ...manualIds])].filter((id) => !known.has(id)).map((id): WorkspaceListItem => ({
            customerId: id,
            name: facts.get(id)?.name ?? id,
            where: "Added by its ID.",
            isSelected: selected.includes(id),
        }));
        return [...listed, ...extra];
    }, [listing, selected, chosenIds, manualIds, facts]);

    const statuses = useMemo<WorkspaceStatusItem[]>(() => chosenIds.map((id) => {
        const known = facts.get(id) ?? { name: id };
        const name = known.retentionDays === undefined ? known.name : `${known.name}. ${keepsText(known.retentionDays)}`;
        const logs = checks.get(id);
        if (!logs) return { customerId: id, name, lines: [{ tone: "pending", text: PENDING }] };
        // The other chosen workspaces that were checked, so a log another one holds is told as such
        const others = chosenIds.flatMap((other): OtherWorkspace[] => {
            const otherLogs = other === id ? undefined : checks.get(other);
            return otherLogs ? [{ name: facts.get(other)?.name ?? other, logs: otherLogs, isListedBefore: chosenIds.indexOf(other) < chosenIds.indexOf(id) }] : [];
        });
        return { customerId: id, name, lines: workspaceLogLines(logs, others, { subscriptions }) };
    }), [chosenIds, checks, facts, subscriptions]);

    const summary = useMemo(() => {
        if (checks.size === 0) return null;
        const found = chosenIds.map((id) => checks.get(id)).filter((c): c is WorkspaceLogsCheck => c !== undefined);
        return workspaceSummaryText(found, subscriptions?.map((s) => s.id) ?? null);
    }, [checks, chosenIds, subscriptions]);

    return {
        tenantLabel,
        step,
        items,
        failedSubscriptions: (listing?.failedSubscriptions ?? []).map((s) => s.name),
        listError,
        selectedCount: selected.length,
        manualDraft,
        manualError,
        consentMessage,
        isBusy,
        summary,
        statuses,
        checkedLine: checkedAt ? checkedLine(checkedAt) : null,
        onChoose: choose,
        onGrantAzure: () => void grantAzure(),
        onToggle: toggle,
        onShowManual: showManual,
        onManualChange: (text) => {
            setManualDraft(text);
            setManualError(null);
        },
        onUse: () => void applySelection(),
        onGrantLogAnalytics: () => void grantLogAnalytics(),
        onCancel: cancel,
        onRetryList: () => void loadListing(),
        onCheckAgain: checkAgain,
        onRemoveAll: removeAll,
    };
}
