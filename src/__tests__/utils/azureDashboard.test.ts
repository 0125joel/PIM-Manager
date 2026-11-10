import { describe, expect, it } from "vitest";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { actionCovers, dashboardLevelOf, DELETED_PRINCIPAL, directoryLookupIds, isAboveChosenScope, isDelegatedAssignment, isGuestAssignment, isPrivilegedByActions, isPrivilegedRole, principalKindOf, subscriptionScopeOf } from "@/utils/azureDashboard";

function assignment(over: Partial<AzureAssignment>): AzureAssignment {
    return {
        id: "a",
        scopeId: "/subscriptions/s1",
        principalId: "P-1",
        principalName: "Someone",
        principalType: "User",
        roleDefinitionId: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
        roleName: "Owner",
        state: "active",
        memberType: "direct",
        endDateTime: null,
        ...over,
    };
}

describe("actionCovers", () => {
    it("matches a glob over the whole target", () => {
        expect(actionCovers("*", "microsoft.authorization/roleassignments/write")).toBe(true);
        expect(actionCovers("Microsoft.Authorization/*", "microsoft.authorization/roleassignments/write")).toBe(true);
        expect(actionCovers("Microsoft.Authorization/*/read", "microsoft.authorization/roleassignments/write")).toBe(false);
        expect(actionCovers("*/read", "*/write")).toBe(false);
        expect(actionCovers("Microsoft.Web/sites/*", "*")).toBe(false);
    });
});

describe("isPrivilegedByActions", () => {
    it("reads actions and ignores notActions", () => {
        expect(isPrivilegedByActions([{ actions: ["*"] }])).toBe(true);
        expect(isPrivilegedByActions([{ actions: ["*"], notActions: ["Microsoft.Authorization/*/Write"] }])).toBe(true);
        expect(isPrivilegedByActions([{ actions: ["*/read"] }])).toBe(false);
        expect(isPrivilegedByActions([{ actions: ["*/read", "Microsoft.Authorization/*", "Microsoft.Support/*"] }])).toBe(true);
        expect(isPrivilegedByActions([{ actions: ["Microsoft.Authorization/roleAssignments/write", "*/read"] }])).toBe(true);
        expect(isPrivilegedByActions([{ actions: ["Microsoft.Authorization/*/read"], dataActions: ["Microsoft.KeyVault/vaults/*"] }])).toBe(false);
        expect(isPrivilegedByActions(undefined)).toBe(false);
    });
});

describe("isPrivilegedRole", () => {
    it("knows the five roles without definitions and reads the actions of the others", () => {
        expect(isPrivilegedRole("a8889054-8d42-49c9-bc1c-52486c10e7cd", null)).toBe(true);
        expect(isPrivilegedRole("A8889054-8D42-49C9-BC1C-52486C10E7CD", null)).toBe(true);
        const custom: ArmRoleDefinition = { id: "x", name: "cccc", type: "Microsoft.Authorization/roleDefinitions", properties: { roleName: "Custom", type: "CustomRole", permissions: [{ actions: ["*"] }] } };
        const reader: ArmRoleDefinition = { id: "y", name: "rrrr", type: "Microsoft.Authorization/roleDefinitions", properties: { roleName: "Reader", permissions: [{ actions: ["*/read"] }] } };
        const definitions = new Map([["cccc", custom], ["rrrr", reader]]);
        expect(isPrivilegedRole("cccc", definitions)).toBe(true);
        expect(isPrivilegedRole("CCCC", definitions)).toBe(true);
        expect(isPrivilegedRole("cccc", null)).toBe(false);
        expect(isPrivilegedRole("rrrr", definitions)).toBe(false);
        expect(isPrivilegedRole("unknown", definitions)).toBe(false);
    });
});

describe("principalKindOf", () => {
    const spTypes = new Map([["sp-app", "Application"], ["sp-mi", "ManagedIdentity"], ["sp-svc", "ServiceIdentity"], ["sp-legacy", "Legacy"]]);

    it("tells a guest from a user", () => {
        expect(isGuestAssignment(assignment({ principalUpn: "carol_x.com#EXT#@c.onmicrosoft.com" }))).toBe(true);
        expect(isGuestAssignment(assignment({ principalUpn: "carol@c.com" }))).toBe(false);
        expect(isGuestAssignment(assignment({ principalType: "Group", principalUpn: "x#ext#" }))).toBe(false);
        expect(principalKindOf(assignment({ principalUpn: "carol_x.com#ext#@c.onmicrosoft.com" }), spTypes)).toBe("guest");
        expect(principalKindOf(assignment({ principalUpn: "carol@c.com" }), spTypes)).toBe("user");
        expect(principalKindOf(assignment({}), spTypes)).toBe("user");
    });

    it("maps groups, agents and the rest", () => {
        expect(principalKindOf(assignment({ principalType: "Group" }), spTypes)).toBe("group");
        expect(principalKindOf(assignment({ principalType: "ForeignGroup" }), spTypes)).toBe("group");
        expect(principalKindOf(assignment({ principalType: "AgentIdentity" }), spTypes)).toBe("agent");
        expect(principalKindOf(assignment({ principalType: "Device" }), spTypes)).toBe("unknown");
        expect(principalKindOf(assignment({ principalType: "Something" }), null)).toBe("unknown");
    });

    it("looks a service principal up by lowercase id", () => {
        const sp = (id: string) => assignment({ principalType: "ServicePrincipal", principalId: id });
        expect(principalKindOf(sp("SP-MI"), spTypes)).toBe("managedIdentity");
        expect(principalKindOf(sp("sp-svc"), spTypes)).toBe("agent");
        expect(principalKindOf(sp("sp-app"), spTypes)).toBe("app");
        expect(principalKindOf(sp("sp-legacy"), spTypes)).toBe("app");
        expect(principalKindOf(sp("sp-missing"), spTypes)).toBe("servicePrincipal");
        expect(principalKindOf(sp("sp-app"), null)).toBe("servicePrincipal");
    });

    it("calls any principal deleted that the directory read did not find", () => {
        const withDeleted = new Map([...spTypes, ["p-1", DELETED_PRINCIPAL], ["sp-gone", DELETED_PRINCIPAL]]);
        expect(principalKindOf(assignment({}), withDeleted)).toBe("deleted");
        expect(principalKindOf(assignment({ principalType: "Group" }), withDeleted)).toBe("deleted");
        expect(principalKindOf(assignment({ principalType: "ServicePrincipal", principalId: "SP-GONE" }), withDeleted)).toBe("deleted");
        expect(principalKindOf(assignment({ principalId: "p-2" }), withDeleted)).toBe("user");
    });
});

describe("directoryLookupIds", () => {
    const scopes: AzureScope[] = [
        { id: "/subscriptions/home", name: "Prod", level: "subscription", parentId: null, tenantId: "t-home" },
        { id: "/subscriptions/partner", name: "Partner", level: "subscription", parentId: null, tenantId: "t-other" },
    ];
    const list = [
        assignment({ principalId: "U-1", scopeId: "/subscriptions/home/resourceGroups/rg" }),
        assignment({ principalId: "u-1", scopeId: "/subscriptions/home" }),
        assignment({ principalId: "g-1", principalType: "Group", scopeId: "/subscriptions/home" }),
        assignment({ principalId: "sp-1", principalType: "ServicePrincipal", scopeId: "/subscriptions/home" }),
        assignment({ principalId: "fg-1", principalType: "ForeignGroup", scopeId: "/subscriptions/home" }),
        assignment({ principalId: "ag-1", principalType: "AgentIdentity", scopeId: "/subscriptions/home" }),
        assignment({ principalId: "u-partner", scopeId: "/subscriptions/partner" }),
        assignment({ principalId: "mg-user", scopeId: "/providers/Microsoft.Management/managementGroups/mg1" }),
    ];

    it("asks for the users, groups and service principals of the home tenant, distinct and in lowercase", () => {
        expect(directoryLookupIds(list, scopes, "t-home")).toEqual({ users: ["u-1", "mg-user"], groups: ["g-1"], servicePrincipals: ["sp-1"] });
    });

    it("asks for nothing without the home tenant", () => {
        expect(directoryLookupIds(list, scopes, undefined)).toEqual({ users: [], groups: [], servicePrincipals: [] });
    });
});

describe("scope helpers", () => {
    const scopes: AzureScope[] = [
        { id: "/subscriptions/S1", name: "Prod", level: "subscription", parentId: null, tenantId: "t-home" },
        { id: "/subscriptions/s2", name: "Partner", level: "subscription", parentId: null, tenantId: "t-other" },
    ];
    const byId = new Map(scopes.map((s) => [s.id.toLowerCase(), s]));

    it("gives the dashboard level, root counting as management group", () => {
        expect(dashboardLevelOf("/")).toBe("managementGroup");
        expect(dashboardLevelOf("/providers/Microsoft.Management/managementGroups/mg1")).toBe("managementGroup");
        expect(dashboardLevelOf("/subscriptions/s1")).toBe("subscription");
        expect(dashboardLevelOf("/subscriptions/s1/resourceGroups/rg1")).toBe("resourceGroup");
        expect(dashboardLevelOf("/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.KeyVault/vaults/kv1")).toBe("resource");
        expect(dashboardLevelOf("/nonsense")).toBeNull();
    });

    it("finds the subscription of a scope", () => {
        expect(subscriptionScopeOf("/subscriptions/s1/resourceGroups/rg1", byId)?.name).toBe("Prod");
        expect(subscriptionScopeOf("/SUBSCRIPTIONS/S1", byId)?.name).toBe("Prod");
        expect(subscriptionScopeOf("/providers/Microsoft.Management/managementGroups/mg1", byId)).toBeNull();
        expect(subscriptionScopeOf("/subscriptions/unknown", byId)).toBeNull();
    });

    it("marks an assignment on a subscription of another tenant as delegated", () => {
        expect(isDelegatedAssignment(assignment({ scopeId: "/subscriptions/s2/resourceGroups/rg" }), byId, "t-home")).toBe(true);
        expect(isDelegatedAssignment(assignment({ scopeId: "/subscriptions/s1" }), byId, "t-home")).toBe(false);
        expect(isDelegatedAssignment(assignment({ scopeId: "/providers/Microsoft.Management/managementGroups/mg1" }), byId, "t-home")).toBe(false);
        expect(isDelegatedAssignment(assignment({ scopeId: "/subscriptions/s2" }), byId, undefined)).toBe(false);
    });
});

describe("isAboveChosenScope", () => {
    const MG = "/providers/Microsoft.Management/managementGroups/mg1";
    const scopes: AzureScope[] = [
        { id: MG, name: "MG", level: "managementGroup", parentId: null },
        { id: "/subscriptions/S1", name: "Prod", level: "subscription", parentId: MG },
        { id: "/subscriptions/s1/resourceGroups/rg1", name: "rg1", level: "resourceGroup", parentId: "/subscriptions/S1" },
        { id: "/subscriptions/s2", name: "Other", level: "subscription", parentId: null },
    ];
    const byId = new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
    const on = (scopeId: string) => assignment({ scopeId, memberType: "inherited" });

    it("is false without a chosen scope", () => {
        expect(isAboveChosenScope(on(MG), null, byId)).toBe(false);
    });

    it("is true only for a strict ancestor of the chosen scope, whatever the member type", () => {
        const chosen = "/subscriptions/s1";
        expect(isAboveChosenScope(on("/subscriptions/S1"), chosen, byId)).toBe(false);
        expect(isAboveChosenScope(on(MG), chosen, byId)).toBe(true);
        expect(isAboveChosenScope(on(MG.toLowerCase()), "/SUBSCRIPTIONS/S1/resourceGroups/rg1", byId)).toBe(true);
        expect(isAboveChosenScope(on("/subscriptions/s1/resourceGroups/rg1"), chosen, byId)).toBe(false);
        expect(isAboveChosenScope(on("/subscriptions/s2"), chosen, byId)).toBe(false);
    });
});
