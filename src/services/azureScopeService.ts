import type { ArmClient } from "@/utils/armClient";
import { armRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import type { ArmEntity, ArmResourceItem, ArmSubscription } from "@/types/azureResource.types";

/**
 * The Azure scopes the signed-in user can read (implementation spec section 4). ARM, not Graph: the client is the ARM
 * client and a retry pauses `armRateLimiter`.
 */

/** Subscriptions - List (Learn, `2022-12-01`) */
export const SUBSCRIPTIONS_API_VERSION = "2022-12-01";

/**
 * Every subscription the user can read. One the user cannot read is absent from the list (spec section 4), so the
 * result is what is visible, not a total. A failed read throws.
 */
export async function listSubscriptions(client: ArmClient, signal?: AbortSignal): Promise<ArmSubscription[]> {
    return withRetry(
        () => client.getAll<ArmSubscription>("/subscriptions", SUBSCRIPTIONS_API_VERSION, undefined, { signal }),
        3, 1000, "azureScope listSubscriptions", armRateLimiter
    );
}

/** Resource Groups - List and Resources - List (Learn, `2021-04-01`) */
export const RESOURCES_API_VERSION = "2021-04-01";

/**
 * The resource groups of one subscription the user can read, all pages. Below a subscription the user cannot list as a
 * whole, only the groups they hold a role on come back (Azure spec 15.5). A failed read throws.
 */
export async function listResourceGroups(client: ArmClient, subscriptionId: string, signal?: AbortSignal): Promise<ArmResourceItem[]> {
    return withRetry(
        () => client.getAll<ArmResourceItem>(`/subscriptions/${encodeURIComponent(subscriptionId)}/resourcegroups`, RESOURCES_API_VERSION, undefined, { signal }),
        3, 1000, "azureScope listResourceGroups", armRateLimiter
    );
}

/**
 * The resources of one subscription the user can read, all pages. Below a subscription the user cannot list as a whole,
 * only the resources they can read come back (measured 2026-10-19, tenant test T4). A failed read throws.
 */
export async function listResources(client: ArmClient, subscriptionId: string, signal?: AbortSignal): Promise<ArmResourceItem[]> {
    return withRetry(
        () => client.getAll<ArmResourceItem>(`/subscriptions/${encodeURIComponent(subscriptionId)}/resources`, RESOURCES_API_VERSION, undefined, { signal }),
        3, 1000, "azureScope listResources", armRateLimiter
    );
}

/** Entities - List (Learn, `2020-05-01`) */
export const ENTITIES_API_VERSION = "2020-05-01";

/**
 * The management groups and subscriptions the user can see, each with its parent (`properties.parent.id`), from
 * `POST /providers/Microsoft.Management/getEntities`. Learn lists it as a POST, but it only reads: no body, and pages
 * come back as `nextLink` (with `$skiptoken`), fetched with POST as well. It is the only source of how management
 * groups nest. Measured: as a Reader on one subscription it answered an empty list (`getEntities-reader-empty.json`,
 * VERIFY). The caller treats a failure or an empty list as "no hierarchy" and leaves the tree flat.
 */
export async function listEntities(client: ArmClient, signal?: AbortSignal): Promise<ArmEntity[]> {
    return withRetry(
        () => client.postAll<ArmEntity>("/providers/Microsoft.Management/getEntities", ENTITIES_API_VERSION, undefined, { signal }),
        3, 1000, "azureScope listEntities", armRateLimiter
    );
}
