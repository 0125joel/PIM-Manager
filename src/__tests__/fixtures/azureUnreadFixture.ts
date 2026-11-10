import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { createRequestBudget, planBelowListing, planBelowReading, withBelowState } from "@/utils/azureReadBelow";

/**
 * A subscription read below its own level whose read budget ran out (Read the rest), for the fixture routes. The same
 * planner as the adapter (`planBelowListing`, then `planBelowReading`) runs over the subscription's top readable scopes
 * with a small `budget`; the scopes it does not reach, and the assignments on and below them, are left out, as the app
 * would not have read them, and the subscription is `partial` with those scopes as `unreadScopeIds`.
 */
export function withBelowBudgetSpent(
    content: { scopes: AzureScope[]; assignments: AzureAssignment[] },
    subscriptionId: string,
    readableScopeIds: readonly string[],
    budget: number,
): { scopes: AzureScope[]; assignments: AzureAssignment[] } {
    const spend = createRequestBudget(budget);
    const listing = planBelowListing([{ subscriptionId, scopeIds: null }], spend);
    const isUnlisted = listing.unlisted.length > 0;
    const plan = planBelowReading(isUnlisted ? [] : [{ subscriptionId, scopeIds: readableScopeIds }], spend);
    const unread = isUnlisted ? [...readableScopeIds] : plan.unread.get(subscriptionId) ?? [];
    const keys = unread.map((id) => id.toLowerCase());
    const isNotRead = (id: string) => keys.some((key) => id.toLowerCase() === key || id.toLowerCase().startsWith(`${key}/`));
    const subscriptionKey = `/subscriptions/${subscriptionId}`.toLowerCase();
    return {
        scopes: content.scopes
            .filter((s) => !isNotRead(s.id))
            .map((s) => (s.level === "subscription" && s.id.toLowerCase() === subscriptionKey ? withBelowState(s, "partial", { unreadScopeIds: isUnlisted ? [] : unread, isUnlisted }) : s)),
        assignments: content.assignments.filter((a) => !isNotRead(a.scopeId)),
    };
}
