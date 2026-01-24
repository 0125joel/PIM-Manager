import { useMsal } from "@azure/msal-react";
import { WorkloadType } from "@/types/workload";
import { useCallback } from "react";

const WORKLOAD_SCOPES: Record<WorkloadType, string[]> = {
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
    defender: [] // Externe setup, niet via Graph
};

export function useConsentedWorkloads() {
    const { instance, accounts } = useMsal();

    const checkConsent = useCallback(async (): Promise<WorkloadType[]> => {
        if (accounts.length === 0) return ["directoryRoles"];

        const consented: WorkloadType[] = ["directoryRoles"]; // directoryRoles is core

        for (const [workload, scopes] of Object.entries(WORKLOAD_SCOPES)) {
            // Sla directoryRoles over (al toegevoegd) en workloads zonder scopes (zoals defender)
            if (workload === "directoryRoles" || scopes.length === 0) continue;

            try {
                // Silent token request - fails if not consented
                await instance.acquireTokenSilent({
                    scopes,
                    account: accounts[0]
                });
                consented.push(workload as WorkloadType);
            } catch (error) {
                // Not consented or token expired/invalid - treat as not enabled
            }
        }

        return consented;
    }, [instance, accounts]);

    return { checkConsent, WORKLOAD_SCOPES };
}
