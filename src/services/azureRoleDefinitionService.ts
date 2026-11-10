import type { ArmClient } from "@/utils/armClient";
import { armRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import type { ArmRoleDefinition } from "@/types/azureResource.types";

/**
 * Azure role definitions (Azure spec 15.4): one role, for its description in the role view. Read only. ARM, not Graph:
 * the client is the ARM client and a retry pauses `armRateLimiter`.
 */

/** Role Definitions - Get (Learn, `2022-04-01`) */
export const ROLE_DEFINITIONS_API_VERSION = "2022-04-01";

/** The scope as a path prefix: the root scope `/` has none */
const scopePath = (scope: string) => (scope === "/" ? "" : scope);

/**
 * One role definition by its GUID, read at `scope`: a built-in role is readable at any scope, a custom role at its
 * assignable scopes (Learn). A failed read throws.
 */
export function getRoleDefinition(client: ArmClient, scope: string, roleDefinitionId: string, signal?: AbortSignal): Promise<ArmRoleDefinition> {
    return withRetry(
        () => client.get<ArmRoleDefinition>(`${scopePath(scope)}/providers/Microsoft.Authorization/roleDefinitions/${encodeURIComponent(roleDefinitionId)}`, ROLE_DEFINITIONS_API_VERSION, undefined, { signal }),
        3, 1000, "azureRoleDefinition getRoleDefinition", armRateLimiter
    );
}

/**
 * Every role definition of one type, listed at `scope` (Learn, Role Definitions - List, `2022-04-01`; the tenant-level
 * list and the two `type` filters are documented). Measured 2026-10-24: 986 built-in roles in one response with
 * `permissions`, and a custom role assignable only at a resource group is returned at tenant level and at its
 * subscription. A failed read throws.
 */
export function listRoleDefinitions(client: ArmClient, scope: string, type: "BuiltInRole" | "CustomRole", signal?: AbortSignal): Promise<ArmRoleDefinition[]> {
    return withRetry(
        () => client.getAll<ArmRoleDefinition>(`${scopePath(scope)}/providers/Microsoft.Authorization/roleDefinitions`, ROLE_DEFINITIONS_API_VERSION, { $filter: `type eq '${type}'` }, { signal }),
        3, 1000, "azureRoleDefinition listRoleDefinitions", armRateLimiter
    );
}
