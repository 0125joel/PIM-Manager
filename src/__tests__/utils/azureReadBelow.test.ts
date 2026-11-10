import { describe, expect, it } from "vitest";
import type { ArmRoleScheduleInstance, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import {
    AZURE_READ_BELOW_BUDGET,
    countUnread,
    createRequestBudget,
    mergeBelowRound,
    planBelowListing,
    planBelowReading,
    takeWithinBudget,
    unreadTargets,
    withBelowState,
} from "@/utils/azureReadBelow";
import { toAssignment } from "@/utils/azureScopes";

const AUTH = "/providers/Microsoft.Authorization";
const S2 = "s2";
const SUB = `/subscriptions/${S2}`;
const rg = (n: number) => `${SUB}/resourceGroups/rg-${n}`;

function instance(name: string, scope: string): ArmRoleScheduleInstance {
    return {
        id: `${scope}${AUTH}/roleAssignmentScheduleInstances/${name}`,
        name,
        type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
        properties: {
            scope,
            memberType: "Direct",
            principalId: `p-${name}`,
            principalType: "User",
            roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7`,
            status: "Provisioned",
            expandedProperties: { scope: { id: scope, displayName: scope, type: "x" }, principal: { id: `p-${name}`, displayName: name, type: "User" } },
        },
    } as ArmRoleScheduleInstance;
}

const subscription = (over: Partial<AzureScope> = {}): AzureScope => ({ id: SUB, name: "Test", level: "subscription", parentId: null, tenantId: "t", access: "partial", ...over });

describe("the read budget", () => {
    it("is about one minute of the ARM limiter (200 per 10 seconds)", () => {
        expect(AZURE_READ_BELOW_BUDGET).toBe(1200);
    });

    it("takes what fits and refuses, without taking, what does not", () => {
        const budget = createRequestBudget(5);
        expect(budget.take(2)).toBe(true);
        expect(budget.take(2)).toBe(true);
        expect(budget.take(2)).toBe(false);
        expect(budget.left).toBe(1);
        expect(budget.take(1)).toBe(true);
        expect(budget.left).toBe(0);
    });

    it("stops at the first item that does not fit, so the rest keeps its order", () => {
        const { taken, rest } = takeWithinBudget(["a", "b", "c", "d"], createRequestBudget(5), 2);
        expect(taken).toEqual(["a", "b"]);
        expect(rest).toEqual(["c", "d"]);
    });

    it("takes nothing with a budget of zero", () => {
        expect(takeWithinBudget([1, 2], createRequestBudget(0))).toEqual({ taken: [], rest: [1, 2] });
    });
});

describe("planning a round", () => {
    it("lists what is not listed yet first, and leaves the subscriptions the budget does not reach unlisted", () => {
        const budget = createRequestBudget(5);
        const plan = planBelowListing([{ subscriptionId: "a", scopeIds: null }, { subscriptionId: "b", scopeIds: ["x"] }, { subscriptionId: "c", scopeIds: null }, { subscriptionId: "d", scopeIds: null }], budget);
        expect(plan).toEqual({ toList: ["a", "c"], unlisted: ["d"] });
        expect(budget.left).toBe(1);
    });

    it("reads in order, subscription by subscription, until the budget is spent, and keeps the rest per subscription", () => {
        const budget = createRequestBudget(7);
        const plan = planBelowReading([{ subscriptionId: "a", scopeIds: ["a1", "a2"] }, { subscriptionId: "b", scopeIds: ["b1", "b2", "b3"] }], budget);
        expect(plan.items).toEqual([{ subscriptionId: "a", scopeId: "a1" }, { subscriptionId: "a", scopeId: "a2" }, { subscriptionId: "b", scopeId: "b1" }]);
        expect(plan.unread).toEqual(new Map([["b", ["b2", "b3"]]]));
    });

    it("leaves nothing unread when the budget reaches everything", () => {
        const plan = planBelowReading([{ subscriptionId: "a", scopeIds: ["a1"] }], createRequestBudget(AZURE_READ_BELOW_BUDGET));
        expect(plan.unread.size).toBe(0);
    });

    it("stops on time with the full budget: 600 scope reads, the rest of a large subscription left", () => {
        const scopeIds = Array.from({ length: 1000 }, (_, i) => rg(i));
        const budget = createRequestBudget(AZURE_READ_BELOW_BUDGET);
        expect(planBelowListing([{ subscriptionId: S2, scopeIds: null }], budget).toList).toEqual([S2]);
        const plan = planBelowReading([{ subscriptionId: S2, scopeIds }], budget);
        // 2 for the listing, 2 per scope read
        expect(plan.items).toHaveLength(599);
        expect(plan.unread.get(S2)).toHaveLength(401);
        expect(plan.unread.get(S2)?.[0]).toBe(rg(599));
        expect(budget.left).toBe(0);
    });
});

describe("what is left for Read the rest", () => {
    it("reads the unread scopes and unlisted subscriptions from the tree, and counts them", () => {
        const scopes: AzureScope[] = [
            subscription({ unreadScopeIds: [rg(1), rg(2)] }),
            { id: "/subscriptions/s3", name: "Other", level: "subscription", parentId: null, access: "partial", isUnlisted: true },
            { id: "/subscriptions/s4", name: "Whole", level: "subscription", parentId: null },
            { id: rg(9), name: "rg-9", level: "resourceGroup", parentId: SUB },
        ];
        expect(unreadTargets(scopes)).toEqual([{ subscriptionId: S2, scopeIds: [rg(1), rg(2)] }, { subscriptionId: "s3", scopeIds: null }]);
        expect(countUnread(scopes)).toEqual({ scopes: 2, unlistedSubscriptions: 1 });
        expect(unreadTargets([subscription()])).toEqual([]);
    });

    it("sets and clears what is left on a subscription scope", () => {
        const left = withBelowState(subscription(), "partial", { unreadScopeIds: [rg(1)], isUnlisted: false });
        expect(left.unreadScopeIds).toEqual([rg(1)]);
        expect(left.isUnlisted).toBeUndefined();
        const done = withBelowState(left, "partial", { unreadScopeIds: [], isUnlisted: false });
        expect("unreadScopeIds" in done).toBe(false);
        expect("isUnlisted" in done).toBe(false);
    });
});

describe("mergeBelowRound", () => {
    const first = instance("one", rg(1));
    const inherited = instance("sub", SUB);
    const loaded = {
        data: [toAssignment(first), toAssignment(inherited)] as AzureAssignment[],
        scopes: [subscription({ unreadScopeIds: [rg(2), rg(3)] }), { id: rg(1), name: "rg-1", level: "resourceGroup", parentId: SUB }] as AzureScope[],
    };

    it("adds the new assignments without the ones already loaded, and their scopes under the subscription", () => {
        const vm = `${rg(2)}/providers/Microsoft.Compute/virtualMachines/vm-2`;
        const merged = mergeBelowRound(loaded, { subscriptionId: S2, instances: [inherited, instance("two", rg(2)), instance("vm", vm)], failed: false, unreadScopeIds: [rg(3)], isUnlisted: false });
        const ids = merged.data.map((a) => a.id);
        expect(ids).toHaveLength(4);
        expect(new Set(ids.map((id) => id.toLowerCase())).size).toBe(4);
        expect(merged.scopes.map((s) => s.id)).toEqual([SUB, rg(1), rg(2), vm]);
        expect(merged.scopes.find((s) => s.id === rg(2))?.parentId).toBe(SUB);
        expect(merged.scopes.find((s) => s.id === vm)?.parentId).toBe(rg(2));
        expect(merged.scopes[0]).toMatchObject({ access: "partial", unreadScopeIds: [rg(3)] });
    });

    it("clears what is left when the round read it all, and a second identical merge adds nothing", () => {
        const settled = { subscriptionId: S2, instances: [instance("two", rg(2))], failed: false, unreadScopeIds: [], isUnlisted: false };
        const once = mergeBelowRound(loaded, settled);
        expect(once.scopes[0].unreadScopeIds).toBeUndefined();
        const twice = mergeBelowRound(once, settled);
        expect(twice.data).toHaveLength(once.data.length);
        expect(twice.scopes).toHaveLength(once.scopes.length);
    });

    it("keeps a parent the tree already has, in the case the tree has it", () => {
        const upper = `/subscriptions/${S2}/resourceGroups/RG-1/providers/Microsoft.KeyVault/vaults/kv`;
        const merged = mergeBelowRound(loaded, { subscriptionId: S2, instances: [instance("kv", upper)], failed: false, unreadScopeIds: [], isUnlisted: false });
        expect(merged.scopes.filter((s) => s.level === "resourceGroup")).toHaveLength(1);
        expect(merged.scopes.find((s) => s.id === upper)?.parentId).toBe(rg(1));
    });

    it("marks a failed round failed, and a failed subscription stays failed", () => {
        expect(mergeBelowRound(loaded, { subscriptionId: S2, instances: [], failed: true, unreadScopeIds: [rg(3)], isUnlisted: false }).scopes[0].access).toBe("failed");
        const failed = { ...loaded, scopes: [subscription({ access: "failed", unreadScopeIds: [rg(3)] }), ...loaded.scopes.slice(1)] };
        expect(mergeBelowRound(failed, { subscriptionId: S2, instances: [], failed: false, unreadScopeIds: [], isUnlisted: false }).scopes[0].access).toBe("failed");
    });

    it("ignores a subscription that is no longer in the tree", () => {
        const merged = mergeBelowRound(loaded, { subscriptionId: "gone", instances: [instance("x", "/subscriptions/gone/resourceGroups/rg")], failed: false, unreadScopeIds: [], isUnlisted: false });
        expect(merged.data).toEqual(loaded.data);
        expect(merged.scopes).toEqual(loaded.scopes);
    });
});
