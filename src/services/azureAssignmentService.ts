import type { ArmClient, ArmQuery } from "@/utils/armClient";
import { armRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import type { ArmRoleScheduleInstance } from "@/types/azureResource.types";

/**
 * PIM role assignments on Azure resources (implementation spec section 4 and 8): the active schedule instances and the
 * eligibility schedules. ARM, not Graph: the client is the ARM client and a retry pauses `armRateLimiter`.
 *
 * Eligible assignments are read from `roleEligibilitySchedules`, not from `roleEligibilityScheduleInstances`: the
 * instance list at a scope leaves out an eligible custom role that is not assignable at that scope (a role whose
 * `assignableScopes` is one resource group, listed at its subscription), while the schedule list returns it. A built-in
 * role and an active custom role come back in both (measured 2026-10-22, `docs/Assets/lessons/azure.md`). Schedules also
 * hold future-dated items; the caller keeps the current ones (`isCurrentSchedule`).
 */

/** Role Assignment Schedule Instances, Role Eligibility Schedules and their instances (Learn, `2020-10-01`) */
export const AUTHORIZATION_API_VERSION = "2020-10-01";

const PROVIDER = "/providers/Microsoft.Authorization";

type InstanceList = "roleAssignmentScheduleInstances" | "roleEligibilitySchedules" | "roleEligibilityScheduleInstances";

function listInstances(client: ArmClient, scopePath: string, list: InstanceList, query: ArmQuery | undefined, signal: AbortSignal | undefined): Promise<ArmRoleScheduleInstance[]> {
    return withRetry(
        () => client.getAll<ArmRoleScheduleInstance>(`${scopePath}${PROVIDER}/${list}`, AUTHORIZATION_API_VERSION, query, { signal }),
        3, 1000, `azureAssignment ${list}`, armRateLimiter
    );
}

const subscriptionPath = (subscriptionId: string) => `/subscriptions/${encodeURIComponent(subscriptionId)}`;

/**
 * Active role assignments seen from one subscription, unfiltered: the items at the subscription, below it and inherited
 * from above (spike S4), as they come. A failed read throws; a subscription the user cannot read answers 403
 * `AuthorizationFailed`, which the caller handles.
 */
export function listAssignmentInstances(client: ArmClient, subscriptionId: string, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, subscriptionPath(subscriptionId), "roleAssignmentScheduleInstances", undefined, signal);
}

/**
 * Eligible role assignments seen from one subscription, as schedules (see the top of this file); otherwise the same rules
 * as `listAssignmentInstances`
 */
export function listEligibilitySchedules(client: ArmClient, subscriptionId: string, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, subscriptionPath(subscriptionId), "roleEligibilitySchedules", undefined, signal);
}

/**
 * Active role assignments seen from a resource group or resource, unfiltered: its own items, those below it and those
 * inherited onto it (measured at a resource, tenant test T4). For a subscription the user cannot list as a whole.
 */
export function listAssignmentInstancesAt(client: ArmClient, scopeId: string, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, scopeId, "roleAssignmentScheduleInstances", undefined, signal);
}

/** Eligible role assignments seen from a resource group or resource, as schedules; the same rules as `listAssignmentInstancesAt` */
export function listEligibilitySchedulesAt(client: ArmClient, scopeId: string, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, scopeId, "roleEligibilitySchedules", undefined, signal);
}

/**
 * The signed-in user's own eligible roles, asked once at root scope with `asTarget()` (spec section 8). This needs no
 * read access on any scope and no subscription list (measured, gate U1).
 */
export function listMyEligibilities(client: ArmClient, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, "", "roleEligibilityScheduleInstances", { $filter: "asTarget()" }, signal);
}

/**
 * The signed-in user's own active roles, assigned or activated, asked once at root scope with `asTarget()` (Azure spec
 * 15.5). Measured at a subscription (spike fixture `subscription-roleAssignmentScheduleInstances-asTarget-reader.json`),
 * at root not yet (tenant test T8).
 */
export function listMyAssignments(client: ArmClient, signal?: AbortSignal): Promise<ArmRoleScheduleInstance[]> {
    return listInstances(client, "", "roleAssignmentScheduleInstances", { $filter: "asTarget()" }, signal);
}
