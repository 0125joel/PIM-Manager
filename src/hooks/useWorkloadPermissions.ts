"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { ALERTS_PERMISSION, CONDITIONAL_ACCESS_PERMISSION } from "@/config/constants";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { useCustomExtensions } from "@/hooks/useCustomExtensions";
import { useIncrementalConsent, WORKLOAD_SCOPES, WORKLOAD_WRITE_SCOPES, isWriteConsentGranted, setWriteConsentGranted } from "@/hooks/useIncrementalConsent";
import { Logger } from "@/utils/logger";
import { classifyProbeError, customExtensionCell, readCell, rowAction, writeCell, type CellStatus, type ProbeResult, type RowAction } from "@/utils/permissionStatus";
import { setFeatureEnabled, setWorkloadVisible } from "@/utils/workloadPreferences";

export type PermissionRowId = "directoryRoles" | "pimGroups" | "securityAlerts" | "customExtensions" | "conditionalAccess";

export interface PermissionRow {
    id: PermissionRowId;
    label: string;
    read: CellStatus;
    write: CellStatus;
    action: RowAction;
}

type Probes = { pimGroupsRead: ProbeResult | "checking"; pimGroupsWrite: ProbeResult | "checking"; directoryWrite: ProbeResult | "checking"; alertsRead: ProbeResult | "checking"; conditionalAccessRead: ProbeResult | "checking" };

const CHECKING: Probes = { pimGroupsRead: "checking", pimGroupsWrite: "checking", directoryWrite: "checking", alertsRead: "checking", conditionalAccessRead: "checking" };

/**
 * The permission table of the settings page. Each cell is probed once per sign-in with a silent token request,
 * one after the other (like the old settings modal); a probe that fails for another reason than a missing
 * consent shows "Could not check" with a retry. One grant at a time. The page can unmount during a consent popup
 * (the sign-in guard does), so the status is read again on mount and nothing relies on state surviving the popup.
 */
export function useWorkloadPermissions() {
    const { instance, accounts } = useMsal();
    const { requestConsent, requestWriteConsent } = useIncrementalConsent();
    const { enableWorkload } = useUnifiedActions();
    const customExtensions = useCustomExtensions();
    const [probes, setProbes] = useState<Probes>(CHECKING);
    const [busyRow, setBusyRow] = useState<PermissionRowId | null>(null);
    const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
    const probedFor = useRef<string | null>(null);

    const account = accounts[0];

    const probe = useCallback(
        async (scopes: string[]): Promise<ProbeResult> => {
            if (!account || scopes.length === 0) return "unknown";
            try {
                await instance.acquireTokenSilent({ scopes, account });
                return "granted";
            } catch (error: unknown) {
                return classifyProbeError(error);
            }
        },
        [instance, account],
    );

    const runProbes = useCallback(async () => {
        setProbes(CHECKING);
        const directoryWrite = await probe(WORKLOAD_WRITE_SCOPES.directoryRoles);
        const pimGroupsRead = await probe(WORKLOAD_SCOPES.pimGroups);
        const pimGroupsWrite = await probe(WORKLOAD_WRITE_SCOPES.pimGroups);
        const alertsRead = await probe([ALERTS_PERMISSION]);
        const conditionalAccessRead = await probe([CONDITIONAL_ACCESS_PERMISSION]);
        // A decisive write probe keeps the stored flag in step (the other pages read the flag)
        if (directoryWrite === "granted") setWriteConsentGranted("directoryRoles", true);
        if (pimGroupsWrite === "granted") setWriteConsentGranted("pimGroups", true);
        if (alertsRead === "granted") setFeatureEnabled("securityAlerts", true);
        setProbes({ directoryWrite, pimGroupsRead, pimGroupsWrite, alertsRead, conditionalAccessRead });
    }, [probe]);

    useEffect(() => {
        const key = account?.homeAccountId ?? null;
        if (!key || probedFor.current === key) return;
        probedFor.current = key;
        void runProbes();
    }, [account, runProbes]);

    const rows: PermissionRow[] = [];
    {
        const read = readCell("granted");
        const write = writeCell(probes.directoryWrite, isWriteConsentGranted("directoryRoles"));
        rows.push({ id: "directoryRoles", label: "Directory roles", read, write, action: rowAction(read, write) });
    }
    {
        const read = readCell(probes.pimGroupsRead);
        const write = read === "notGranted" ? "notGranted" : writeCell(probes.pimGroupsWrite, isWriteConsentGranted("pimGroups"));
        rows.push({ id: "pimGroups", label: "PIM for Groups", read, write, action: rowAction(read, write) });
    }
    {
        const read = readCell(probes.alertsRead);
        rows.push({ id: "securityAlerts", label: "Security alerts", read, write: "readOnly", action: rowAction(read, "readOnly") });
    }
    {
        const read = customExtensionCell(customExtensions.status);
        rows.push({ id: "customExtensions", label: "Custom extension list", read, write: "readOnly", action: rowAction(read, "readOnly") });
    }
    {
        const read = readCell(probes.conditionalAccessRead);
        rows.push({ id: "conditionalAccess", label: "Conditional Access check", read, write: "readOnly", action: rowAction(read, "readOnly") });
    }

    const grant = useCallback(
        async (rowId: PermissionRowId, kind: "read" | "write") => {
            if (busyRow || !account) return;
            setBusyRow(rowId);
            setMessage(null);
            try {
                let ok = false;
                if (rowId === "pimGroups" && kind === "read") {
                    ok = await requestConsent("pimGroups");
                    if (ok) {
                        await enableWorkload("pimGroups");
                        setWorkloadVisible("pimGroups", true);
                    }
                } else if (rowId === "securityAlerts") {
                    await instance.acquireTokenPopup({ scopes: [ALERTS_PERMISSION], account });
                    setFeatureEnabled("securityAlerts", true);
                    setWorkloadVisible("securityAlerts", true);
                    ok = true;
                } else if (rowId === "conditionalAccess") {
                    await instance.acquireTokenPopup({ scopes: [CONDITIONAL_ACCESS_PERMISSION], account });
                    ok = true;
                } else if (rowId === "customExtensions") {
                    await customExtensions.requestPermission();
                    ok = true;
                } else if (kind === "write" && (rowId === "directoryRoles" || rowId === "pimGroups")) {
                    ok = await requestWriteConsent(rowId);
                }
                if (ok) {
                    setMessage({ kind: "success", text: "Permission granted." });
                    await runProbes();
                } else {
                    setMessage({ kind: "error", text: "The permission was not granted. The sign-in window may have been cancelled or blocked. Try again." });
                }
            } catch (error: unknown) {
                Logger.error("Settings", `Granting ${kind} access for ${rowId} failed`, error);
                setMessage({ kind: "error", text: "The permission was not granted. The sign-in window may have been cancelled or blocked. Try again." });
            } finally {
                setBusyRow(null);
            }
        },
        [busyRow, account, requestConsent, requestWriteConsent, enableWorkload, instance, customExtensions, runProbes],
    );

    /** The row's single action: grant what is missing (read first), or check again. */
    const act = useCallback(
        (row: PermissionRow) => {
            if (row.action === "retry") {
                void runProbes();
                if (row.id === "customExtensions") void customExtensions.reload();
            } else if (row.action === "grantRead") void grant(row.id, "read");
            else if (row.action === "grantWrite") void grant(row.id, "write");
        },
        [grant, runProbes, customExtensions],
    );

    return { rows, busyRow, message, act, dismissMessage: () => setMessage(null) };
}
