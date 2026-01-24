"use client";

import { useMsal } from "@azure/msal-react";
import { WorkloadType } from "@/types/workload";
import { useCallback } from "react";

// Re-export WORKLOAD_SCOPES for use in consent and detection
export const WORKLOAD_SCOPES: Record<WorkloadType, string[]> = {
    directoryRoles: [
        "RoleManagement.Read.Directory",
        "RoleAssignmentSchedule.Read.Directory",
        "RoleEligibilitySchedule.Read.Directory",
        "RoleManagementPolicy.Read.Directory"
    ],
    pimGroups: [
        "PrivilegedAccess.Read.AzureADGroup",
        "RoleManagementPolicy.Read.AzureADGroup"
    ],
    intune: ["DeviceManagementRBAC.Read.All"],
    exchange: ["RoleManagement.Read.Exchange"],
    sharepoint: ["Sites.Read.All"],
    defender: [] // External setup, not via Graph
};

// Persistence helpers
const STORAGE_KEY_PREFIX = "pim_workload_enabled_";

export function getEnabledWorkloads(): WorkloadType[] {
    if (typeof window === "undefined") return ["directoryRoles"];

    const enabled: WorkloadType[] = ["directoryRoles"]; // Always enabled
    const workloads: WorkloadType[] = ["pimGroups", "intune", "exchange", "sharepoint", "defender"];

    for (const workload of workloads) {
        if (localStorage.getItem(`${STORAGE_KEY_PREFIX}${workload}`) === "true") {
            enabled.push(workload);
        }
    }

    return enabled;
}

export function setWorkloadEnabled(workload: WorkloadType, enabled: boolean): void {
    if (typeof window === "undefined") return;

    if (workload === "directoryRoles") return; // Cannot disable core workload

    if (enabled) {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}${workload}`, "true");
    } else {
        localStorage.removeItem(`${STORAGE_KEY_PREFIX}${workload}`);
    }
}

/**
 * Hook for requesting incremental consent for additional workloads.
 * Triggers MSAL popup to acquire permissions, then persists to localStorage.
 */
export function useIncrementalConsent() {
    const { instance, accounts } = useMsal();

    const requestConsent = useCallback(async (workload: WorkloadType): Promise<boolean> => {
        if (workload === "directoryRoles") {
            return true; // Already consented via login
        }

        const scopes = WORKLOAD_SCOPES[workload];
        if (scopes.length === 0) {
            // Special workloads like Defender need external setup
            console.warn(`[useIncrementalConsent] Workload ${workload} requires external setup`);
            return false;
        }

        if (accounts.length === 0) {
            console.error("[useIncrementalConsent] No accounts available");
            return false;
        }

        // IMPORTANT: Try popup FIRST to maintain user click context (browsers block async popups)
        // If user already consented, the popup will be very fast or auto-close
        try {
            await instance.acquireTokenPopup({
                scopes,
                account: accounts[0]
            });
            setWorkloadEnabled(workload, true);
            return true;
        } catch (popupError: any) {
            // If popup failed due to interaction_in_progress, try silent
            if (popupError?.errorCode === "interaction_in_progress") {
                try {
                    await instance.acquireTokenSilent({
                        scopes,
                        account: accounts[0]
                    });
                    setWorkloadEnabled(workload, true);
                    return true;
                } catch {
                    // Silent also failed
                }
            }
            console.error(`[useIncrementalConsent] Consent failed for ${workload}:`, popupError);
            return false;
        }
    }, [instance, accounts]);

    const revokeConsent = useCallback((workload: WorkloadType): void => {
        setWorkloadEnabled(workload, false);
    }, []);

    return { requestConsent, revokeConsent, WORKLOAD_SCOPES };
}
