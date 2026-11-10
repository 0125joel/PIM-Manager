import type { ArmClient } from "@/utils/armClient";
import { armRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import type { ArmRoleManagementAlert } from "@/types/azureResource.types";

/**
 * The PIM alerts of an Azure subscription (Learn, Role Management Alerts). Read only: no refresh and no dismiss. ARM,
 * not Graph: the client is the ARM client and a retry pauses `armRateLimiter`.
 */

// No GA version exists for PIM alerts of Azure resources (Learn, Role Management Alerts); preview is the only one
export const ALERTS_API_VERSION = "2022-08-01-preview";

/** The alerts of one subscription (Role Management Alerts - List For Scope). A failed read throws. */
export function listRoleManagementAlerts(client: ArmClient, subscriptionId: string, signal?: AbortSignal): Promise<ArmRoleManagementAlert[]> {
    return withRetry(
        () => client.getAll<ArmRoleManagementAlert>(`/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Authorization/roleManagementAlerts`, ALERTS_API_VERSION, undefined, { signal }),
        3, 1000, "azureAlert listRoleManagementAlerts", armRateLimiter
    );
}
