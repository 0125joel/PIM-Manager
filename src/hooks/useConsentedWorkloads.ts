import { useMsal } from "@azure/msal-react";
import { WorkloadType } from '@/types/workload.types';
import { useCallback } from "react";
import { WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";

/**
 * Workloads the app can load today. Intune, Exchange and SharePoint have scopes defined but no adapter or UI yet:
 * probing them sent a token request that Entra answered with 400 on every page load.
 */
const PROBED_WORKLOADS: WorkloadType[] = ["pimGroups"];

export function useConsentedWorkloads() {
    const { instance, accounts } = useMsal();

    const checkConsent = useCallback(async (): Promise<WorkloadType[]> => {
        if (accounts.length === 0) return ["directoryRoles"];

        const consented: WorkloadType[] = ["directoryRoles"]; // directoryRoles is core

        for (const [workload, scopes] of Object.entries(WORKLOAD_SCOPES)) {
            // directoryRoles is already added; workloads without scopes (defender) or without an adapter are not probed
            if (workload === "directoryRoles" || scopes.length === 0) continue;
            if (!PROBED_WORKLOADS.includes(workload as WorkloadType)) continue;

            try {
                // Silent token request - fails if not consented
                await instance.acquireTokenSilent({
                    scopes,
                    account: accounts[0]
                });
                consented.push(workload as WorkloadType);
            } catch {
                // Not consented or token expired/invalid - treat as not enabled
            }
        }

        return consented;
    }, [instance, accounts]);

    return { checkConsent, WORKLOAD_SCOPES };
}
