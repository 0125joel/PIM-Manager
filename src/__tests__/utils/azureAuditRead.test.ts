import { describe, expect, it } from "vitest";
import type { RawActivityEvent } from "@/types/audit.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { buildAzureAuditContext, dedupeActivity, filtersRequestsToScope, holdingsOf, isAtOrBelowScope, planAzureAuditRead } from "@/utils/azureAuditRead";

describe("isAtOrBelowScope", () => {
    const rg = "/subscriptions/s-1/resourceGroups/rg-pim-manager-test";

    it("keeps a row at the read scope and beneath it", () => {
        expect(isAtOrBelowScope(rg, rg)).toBe(true);
        expect(isAtOrBelowScope(`${rg}/providers/Microsoft.Compute/virtualMachines/vm-1`, rg)).toBe(true);
        expect(isAtOrBelowScope(rg, "/")).toBe(true);
    });

    it("drops a row above the read scope, the subscription in the PAYG case", () => {
        expect(isAtOrBelowScope("/subscriptions/s-1", rg)).toBe(false);
        expect(isAtOrBelowScope(MG, rg)).toBe(false);
        expect(isAtOrBelowScope("/", rg)).toBe(false);
    });

    it("does not match a sibling whose name starts the same way", () => {
        expect(isAtOrBelowScope(`${rg}2`, rg)).toBe(false);
    });

    it("ignores case and a trailing slash", () => {
        expect(isAtOrBelowScope(rg.toUpperCase(), `${rg}/`)).toBe(true);
    });

    it("drops a row without a scope", () => {
        expect(isAtOrBelowScope(null, rg)).toBe(false);
        expect(isAtOrBelowScope(undefined, rg)).toBe(false);
        expect(isAtOrBelowScope("", rg)).toBe(false);
        expect(isAtOrBelowScope(" \t ", rg)).toBe(false);
        expect(isAtOrBelowScope(" \t ", "/")).toBe(false);
    });

    it("is idempotent: filtering twice gives the same rows as once", () => {
        const rows = [rg, "/subscriptions/s-1", `${rg}/x`, `${rg}2`, null].map((scope) => ({ scope }));
        const once = rows.filter((row) => isAtOrBelowScope(row.scope, rg));
        const twice = once.filter((row) => isAtOrBelowScope(row.scope, rg));
        expect(twice).toEqual(once);
        expect(once.map((row) => row.scope)).toEqual([rg, `${rg}/x`]);
    });

    it("does not apply path-prefix filtering to a management group read", () => {
        expect(filtersRequestsToScope(MG)).toBe(false);
        expect(filtersRequestsToScope(rg)).toBe(true);
        expect(filtersRequestsToScope("/subscriptions/s-1")).toBe(true);
    });
});

const MG = "/providers/Microsoft.Management/managementGroups/mg-1";
const scopes: AzureScope[] = [
    { id: "/", name: "Root", level: "root", parentId: null },
    { id: MG, name: "Platform", level: "managementGroup", parentId: "/" },
    { id: "/subscriptions/s-1", name: "Production", level: "subscription", parentId: MG },
    { id: "/subscriptions/s-2", name: "Labs", level: "subscription", parentId: MG, access: "partial" },
    { id: "/subscriptions/s-1/resourceGroups/rg-1", name: "rg-1", level: "resourceGroup", parentId: "/subscriptions/s-1" },
];

function assignment(extra: Partial<AzureAssignment>): AzureAssignment {
    return {
        id: "/subscriptions/s-1/providers/Microsoft.Authorization/roleAssignmentScheduleInstances/a1", scopeId: "/subscriptions/s-1", principalId: "P-1", principalName: "Megan Bowen",
        principalType: "User", roleDefinitionId: "ROLE-1", roleName: "Reader", state: "active", memberType: "direct", endDateTime: null, ...extra,
    };
}

describe("planAzureAuditRead", () => {
    it("takes the subscriptions, the refused ones and the management groups", () => {
        expect(planAzureAuditRead(scopes)).toEqual({ subscriptionIds: ["s-1", "s-2"], refusedSubscriptionIds: ["s-2"], managementGroupIds: [MG] });
    });
});

describe("holdingsOf", () => {
    it("gives one holding per group, role and scope, and no user or eligible one", () => {
        const group = (extra: Partial<AzureAssignment>) => assignment({ principalId: "G-1", principalType: "Group", ...extra });
        const holdings = holdingsOf([
            group({}), group({ id: "x2", principalId: "g-1", roleDefinitionId: "role-1", scopeId: "/SUBSCRIPTIONS/S-1" }),
            group({ id: "x3", roleDefinitionId: "ROLE-2", roleName: "Owner" }),
            group({ id: "x4", principalType: "GroupSecurityNotEnabled", scopeId: "/subscriptions/s-2" }),
            assignment({}), group({ state: "eligible", scopeId: "/subscriptions/s-3" }),
        ]);
        expect(holdings.map((h) => `${h.groupId}|${h.roleId}|${h.scopeId}`)).toEqual([
            "G-1|ROLE-1|/subscriptions/s-1", "G-1|ROLE-2|/subscriptions/s-1", "G-1|ROLE-1|/subscriptions/s-2",
        ]);
        expect(holdings[0].roleName).toBe("Reader");
    });
});

describe("dedupeActivity", () => {
    it("keeps the first row per eventDataId without case, and every row without one", () => {
        const rows: RawActivityEvent[] = [
            { eventDataId: "E-1", caller: "first" }, { eventDataId: "e-1", caller: "second" }, { caller: "none-1" }, { eventDataId: "", caller: "none-2" }, { eventDataId: "E-2" },
        ];
        expect(dedupeActivity(rows).map((r) => r.caller ?? r.eventDataId)).toEqual(["first", "none-1", "none-2", "E-2"]);
    });
});

describe("buildAzureAuditContext", () => {
    const context = buildAzureAuditContext(scopes, [
        assignment({ principalUpn: "megan@contoso.example" }),
        assignment({ id: "elig-1", state: "eligible", principalId: "G-9", principalType: "Group", principalName: "Owners" }),
    ]);

    it("names scopes, roles and principals without case", () => {
        expect(context.scopeName("/SUBSCRIPTIONS/S-1")).toBe("Production");
        expect(context.scopeName("/subscriptions/none")).toBeUndefined();
        expect(context.roleName("role-1")).toBe("Reader");
        expect(context.principalName("p-1")).toBe("Megan Bowen");
    });

    it("gives the type and sign-in name, and the eligibilities", () => {
        expect(context.principal?.("p-1")).toEqual({ type: "User", upn: "megan@contoso.example" });
        expect(context.eligibilities).toEqual([{ id: "elig-1", principalId: "G-9", principalType: "Group", principalName: "Owners" }]);
    });
});

describe("buildAzureAuditContext with role definitions", () => {
    const definition = (id: string, roleName: string): ArmRoleDefinition => ({ id, name: id, type: "CustomRole", properties: { roleName } });
    const definitions = new Map([["role-9", definition("ROLE-9", "Contoso Old Operator")], ["role-1", definition("ROLE-1", "Reader (definition)")]]);
    const context = buildAzureAuditContext(scopes, [assignment({})], definitions);

    it("names a role no assignment holds from its definition, without case", () => {
        expect(context.roleName("ROLE-9")).toBe("Contoso Old Operator");
    });

    it("lets the name of an assignment win over the definition", () => {
        expect(context.roleName("role-1")).toBe("Reader");
    });

    it("leaves a role unnamed without definitions", () => {
        expect(buildAzureAuditContext(scopes, [assignment({})], null).roleName("role-9")).toBeUndefined();
        expect(buildAzureAuditContext(scopes, [assignment({})]).roleName("role-9")).toBeUndefined();
    });
});
