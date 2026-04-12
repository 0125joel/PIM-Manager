import { useCallback } from "react";
import { Client } from "@microsoft/microsoft-graph-client";
import { loadApproversForRole } from "@/services/directoryRoleService";
import { PimPolicyRule, Approver } from "@/types/directoryRole.types";
import { Logger } from "@/utils/logger";

/**
 * Hook for loading approvers for a role's approval rules
 * Wraps the loadApproversForRole service function
 */
export function useApproversForRole() {
    const loadApprovers = useCallback(async (
        client: Client,
        policyRules?: PimPolicyRule[]
    ): Promise<Approver[]> => {
        if (!policyRules) return [];

        try {
            return await loadApproversForRole(client, policyRules);
        } catch (error) {
            Logger.error("useApproversForRole", "Failed to load approvers", error);
            return [];
        }
    }, []);

    return { loadApprovers };
}
