"use client";

import { useMsal } from "@azure/msal-react";
import { WorkloadType } from '@/types/workload.types';
import { useCallback } from "react";
import { Logger } from "@/utils/logger";

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

// Write scopes for Configure operations (least-privilege)
// Requested via incremental consent when user starts configuration
export const WORKLOAD_WRITE_SCOPES: Record<WorkloadType, string[]> = {
    directoryRoles: [
        "RoleManagementPolicy.ReadWrite.Directory",      // Update policies
        "RoleEligibilitySchedule.ReadWrite.Directory",   // Create eligible assignments
        "RoleAssignmentSchedule.ReadWrite.Directory"     // Create active assignments
    ],
    pimGroups: [
        "RoleManagementPolicy.ReadWrite.AzureADGroup",           // Update policies
        "PrivilegedEligibilitySchedule.ReadWrite.AzureADGroup",  // Create eligible assignments
        "PrivilegedAssignmentSchedule.ReadWrite.AzureADGroup"    // Create active assignments
    ],
    intune: [],
    exchange: [],
    sharepoint: [],
    defender: []
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

// Write consent persistence (for Configure features)
const WRITE_CONSENT_PREFIX = "pim_write_consent_";

export function isWriteConsentGranted(workloadId: string): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`${WRITE_CONSENT_PREFIX}${workloadId}`) === "true";
}

export function setWriteConsentGranted(workloadId: string, granted: boolean): void {
    if (typeof window === "undefined") return;
    if (granted) {
        localStorage.setItem(`${WRITE_CONSENT_PREFIX}${workloadId}`, "true");
    } else {
        localStorage.removeItem(`${WRITE_CONSENT_PREFIX}${workloadId}`);
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
            return true; // Already consented via login (Read)
        }

        const scopes = WORKLOAD_SCOPES[workload];
        if (scopes.length === 0) {
            Logger.warn("useIncrementalConsent", `Workload ${workload} requires external setup`);
            return false;
        }

        if (accounts.length === 0) {
            Logger.error("useIncrementalConsent", "No accounts available");
            return false;
        }

        try {
            await instance.acquireTokenPopup({
                scopes,
                account: accounts[0]
            });
            setWorkloadEnabled(workload, true);
            return true;
        } catch (popupError: any) {
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
            Logger.error("useIncrementalConsent", `Consent failed for ${workload}`, popupError);
            return false;
        }
    }, [instance, accounts]);

    const requestWriteConsent = useCallback(async (workload: WorkloadType): Promise<boolean> => {
        const scopes = WORKLOAD_WRITE_SCOPES[workload];
        if (!scopes || scopes.length === 0) {
            // No specific write scopes defined (e.g. Defender), assume granted or not applicable
            return true;
        }

        if (accounts.length === 0) return false;

        try {
            await instance.acquireTokenPopup({
                scopes,
                account: accounts[0]
            });
            setWriteConsentGranted(workload, true);
            return true;
        } catch (popupError: any) {
            if (popupError?.errorCode === "interaction_in_progress") {
                try {
                    await instance.acquireTokenSilent({
                        scopes,
                        account: accounts[0]
                    });
                    setWriteConsentGranted(workload, true);
                    return true;
                } catch {
                    // Silent also failed
                }
            }
            Logger.error("useIncrementalConsent", `Write Consent failed for ${workload}`, popupError);
            return false;
        }
    }, [instance, accounts]);

    const revokeConsent = useCallback((workload: WorkloadType): void => {
        setWorkloadEnabled(workload, false);
    }, []);

    return { requestConsent, requestWriteConsent, revokeConsent, WORKLOAD_SCOPES, WORKLOAD_WRITE_SCOPES };
}
