import type { ArmClient } from "@/utils/armClient";
import { armRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import type { ArmRoleManagementPolicy } from "@/types/azureResource.types";
import { escapeODataString } from "@/utils/odataUtils";
import { AUTHORIZATION_API_VERSION } from "./azureAssignmentService";

/**
 * The role settings of Azure resources (implementation spec section 4 and 6). Read only: there is no write path here.
 * ARM, not Graph: the client is the ARM client and a retry pauses `armRateLimiter`.
 */

const PROVIDER = "/providers/Microsoft.Authorization";

/** The scope as a path prefix: the root scope `/` has none */
const scopePath = (scope: string) => (scope === "/" ? "" : scope);

/**
 * One role's policy at one scope, with `$filter=roleDefinitionId eq '{scope}/providers/Microsoft.Authorization/
 * roleDefinitions/{id}'` (Learn REST sample "Manage Azure PIM role management policies with REST", `2020-10-01`;
 * measured: applied by the server). The full list is about 20 MB per subscription and is never read.
 *
 * `roleDefinitionId` is the role GUID. A role without a policy at the scope answers 400 `ResourceNotFound`, which throws
 * like any failed read (`mapArmError` says "No role settings"). An empty list, not seen in the spike, gives null.
 */
export async function getRolePolicy(client: ArmClient, scope: string, roleDefinitionId: string, signal?: AbortSignal): Promise<ArmRoleManagementPolicy | null> {
    const path = scopePath(scope);
    const policies = await withRetry(
        () => client.getAll<ArmRoleManagementPolicy>(
            `${path}${PROVIDER}/roleManagementPolicies`,
            AUTHORIZATION_API_VERSION,
            // Quotes doubled for defence in depth: a scope path or role GUID holds none, so the filter is unchanged for them
            { $filter: `roleDefinitionId eq '${escapeODataString(`${path}${PROVIDER}/roleDefinitions/${roleDefinitionId}`)}'` },
            { signal }
        ),
        3, 1000, "azurePolicy getRolePolicy", armRateLimiter
    );
    return policies[0] ?? null;
}
