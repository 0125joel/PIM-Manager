/**
 * The reads below a subscription the user cannot list as a whole (Azure spec 15.5), with a budget in ARM requests per
 * round. A round lists the readable resource groups and resources of each subscription (`topReadableScopes`) and then
 * reads their assignments, in order, until the budget is spent. What it did not reach is kept on the subscription
 * (`unreadScopeIds`, `isUnlisted`) and read by the next round (Read the rest), whose items are merged into what is
 * loaded. Pure logic; the reads themselves are in `workloads/azureAssignmentsAdapter.ts`.
 */
import type { ArmRoleScheduleInstance, ArmSubscription, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { buildScopeTree, compareScopes, toAssignment } from "@/utils/azureScopes";

/**
 * ARM requests one round below the refused subscriptions may use (Joël, 2026-11-01). `armRateLimiter` sends 200 per
 * 10 seconds, so this is about one minute: enough for most tenants, while a tenant with thousands of readable resource
 * groups does not keep the limiter (and the portal's share of the ARM budget) busy for many minutes and gets no wave of
 * 429s. Refresh starts from zero with a fresh budget; Read the rest gets the same budget again.
 */
export const AZURE_READ_BELOW_BUDGET = 1200;

/**
 * A listing (resource groups and resources) and a scope read (active instances and eligibility schedules) are two list
 * requests each. A list with more than one page costs a request per extra page that the budget does not count; for
 * these lists that is rare (ARM pages hold up to 1000 items).
 */
export const REQUESTS_PER_BELOW_ITEM = 2;

export interface RequestBudget {
    /** Takes `cost` when that much is left; false (and nothing taken) when it is not */
    take(cost: number): boolean;
    readonly left: number;
}

export function createRequestBudget(total: number): RequestBudget {
    let left = Math.max(0, Math.floor(total));
    return {
        take(cost) {
            if (cost > left) return false;
            left -= cost;
            return true;
        },
        get left() {
            return left;
        },
    };
}

/** The items the budget pays for, in order, and the rest: the first item that does not fit ends the round */
export function takeWithinBudget<T>(items: readonly T[], budget: RequestBudget, cost: number = REQUESTS_PER_BELOW_ITEM): { taken: T[]; rest: T[] } {
    const taken: T[] = [];
    let i = 0;
    for (; i < items.length; i++) {
        if (!budget.take(cost)) break;
        taken.push(items[i]);
    }
    return { taken, rest: items.slice(i) };
}

/** One subscription a round reads below: the scopes still to read, or null when they are not listed yet */
export interface BelowTarget {
    subscriptionId: string;
    scopeIds: string[] | null;
}

/** One scope read of a round */
export interface BelowItem {
    subscriptionId: string;
    scopeId: string;
}

/** The subscription id of a `/subscriptions/{id}` scope id */
function subscriptionIdOf(scopeId: string): string {
    return scopeId.split("/").filter((s) => s !== "")[1] ?? "";
}

/** What the last round left for later, per subscription in tree order: the input of Read the rest */
export function unreadTargets(scopes: readonly AzureScope[]): BelowTarget[] {
    return scopes
        .filter((s) => s.level === "subscription" && (s.isUnlisted === true || (s.unreadScopeIds?.length ?? 0) > 0))
        .map((s) => ({ subscriptionId: subscriptionIdOf(s.id), scopeIds: s.isUnlisted ? null : [...(s.unreadScopeIds ?? [])] }));
}

/** The resource groups and resources not read yet, and the subscriptions whose scopes are not listed yet */
export function countUnread(scopes: readonly AzureScope[]): { scopes: number; unlistedSubscriptions: number } {
    let count = 0;
    let unlisted = 0;
    for (const s of scopes) {
        if (s.level !== "subscription") continue;
        count += s.unreadScopeIds?.length ?? 0;
        if (s.isUnlisted) unlisted++;
    }
    return { scopes: count, unlistedSubscriptions: unlisted };
}

/** Step 1 of a round: the subscriptions to list now, and those the budget leaves unlisted */
export function planBelowListing(targets: readonly BelowTarget[], budget: RequestBudget): { toList: string[]; unlisted: string[] } {
    const { taken, rest } = takeWithinBudget(targets.filter((t) => t.scopeIds === null).map((t) => t.subscriptionId), budget);
    return { toList: taken, unlisted: rest };
}

/**
 * Step 2 of a round: the scope reads the budget left after the listing pays for, subscription by subscription in order,
 * and per subscription the scopes it does not reach (absent when it reaches them all).
 */
export function planBelowReading(scopesBySubscription: ReadonlyArray<{ subscriptionId: string; scopeIds: readonly string[] }>, budget: RequestBudget): { items: BelowItem[]; unread: Map<string, string[]> } {
    const all = scopesBySubscription.flatMap(({ subscriptionId, scopeIds }) => scopeIds.map((scopeId) => ({ subscriptionId, scopeId })));
    const { taken, rest } = takeWithinBudget(all, budget);
    const unread = new Map<string, string[]>();
    for (const item of rest) {
        const list = unread.get(item.subscriptionId);
        if (list) list.push(item.scopeId);
        else unread.set(item.subscriptionId, [item.scopeId]);
    }
    return { items: taken, unread };
}

/** One subscription at the end of a round: what was read below it and what is left */
export interface BelowSettled {
    subscriptionId: string;
    /** The active instances and current eligibility schedules read in this round */
    instances: ArmRoleScheduleInstance[];
    /** A listing or a scope read failed (not a 403, 404 or 400 `InsufficientPermissions`, which are "not readable") */
    failed: boolean;
    unreadScopeIds: string[];
    isUnlisted: boolean;
}

/** The access fields of a subscription scope after a round: `partial` (or `failed`) with what is left to read */
export function withBelowState(scope: AzureScope, access: NonNullable<AzureScope["access"]>, settled: Pick<BelowSettled, "unreadScopeIds" | "isUnlisted">): AzureScope {
    const rest: AzureScope = { ...scope };
    delete rest.unreadScopeIds;
    delete rest.isUnlisted;
    return {
        ...rest,
        access,
        ...(settled.unreadScopeIds.length > 0 ? { unreadScopeIds: settled.unreadScopeIds } : {}),
        ...(settled.isUnlisted ? { isUnlisted: true as const } : {}),
    };
}

/**
 * A subscription of a later round (Read the rest) merged into what is loaded: its new assignments without the ones
 * already there (an item inherited from above comes back from every scope), the resource groups and resources they are
 * on added to the tree under the scopes that are there, and the subscription's access and what is left to read
 * updated. A failed subscription stays failed until Refresh. A subscription that is no longer in the tree is ignored.
 */
export function mergeBelowRound(content: { data: readonly AzureAssignment[]; scopes: readonly AzureScope[] }, settled: BelowSettled): { data: AzureAssignment[]; scopes: AzureScope[] } {
    const subscriptionKey = `/subscriptions/${settled.subscriptionId}`.toLowerCase();
    const subscription = content.scopes.find((s) => s.level === "subscription" && s.id.toLowerCase() === subscriptionKey);
    if (!subscription) return { data: [...content.data], scopes: [...content.scopes] };

    const seen = new Set(content.data.map((a) => a.id.toLowerCase()));
    const added: AzureAssignment[] = [];
    for (const instance of settled.instances) {
        const key = instance.id.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(toAssignment(instance));
    }

    const existing = new Map(content.scopes.map((s) => [s.id.toLowerCase(), s]));
    const asArm: ArmSubscription = { id: subscription.id, subscriptionId: settled.subscriptionId, displayName: subscription.name, state: "Enabled", tenantId: subscription.tenantId ?? "" };
    const newScopes = buildScopeTree([asArm], { [settled.subscriptionId]: settled.instances })
        .filter((s) => s.level !== "subscription" && !existing.has(s.id.toLowerCase()))
        // A parent that is in the tree keeps the id the tree has (ARM ids are case-insensitive)
        .map((s) => (s.parentId === null ? s : { ...s, parentId: existing.get(s.parentId.toLowerCase())?.id ?? s.parentId }));

    const access = settled.failed || subscription.access === "failed" ? "failed" : "partial";
    const scopes = content.scopes.map((s) => (s === subscription ? withBelowState(s, access, settled) : s));
    return { data: [...content.data, ...added], scopes: [...scopes, ...newScopes].sort(compareScopes) };
}
