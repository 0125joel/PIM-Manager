import { describe, expect, it } from "vitest";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import { DELETED_PRINCIPAL } from "@/utils/azureDashboard";
import { azurePolicyKey } from "@/utils/azureScopes";
import { formatDate } from "@/utils/dateFormat";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, buildAssignmentRows, cardFactLine, eligiblePairsOf, hiddenInheritedCount, matchesAzureFilters, principalKindLabel, principalTypeLabelFor, scopeLineFor, defaultScopeId, findScope, flattenScopeTree, visibleScopeRows, type AzureFilterContext } from "@/utils/azureReport";

const MG = "/providers/Microsoft.Management/managementGroups/mg-platform";
const PROD = "/subscriptions/s1";
const TEST = "/subscriptions/s2";
const RG_WEB = `${PROD}/resourceGroups/rg-web`;
const RG_SBX = `${TEST}/resourceGroups/rg-sandbox`;
const KV = `${RG_WEB}/providers/Microsoft.KeyVault/vaults/kv-web`;

const SCOPES: AzureScope[] = [
    { id: "/", name: "Root", level: "root", parentId: null },
    { id: MG, name: "Contoso Platform", level: "managementGroup", parentId: "/" },
    { id: PROD, name: "Contoso Production", level: "subscription", parentId: MG },
    { id: TEST, name: "Contoso Test", level: "subscription", parentId: MG },
    { id: RG_SBX, name: "rg-sandbox", level: "resourceGroup", parentId: TEST },
    { id: RG_WEB, name: "rg-web", level: "resourceGroup", parentId: PROD },
    { id: KV, name: "kv-web", level: "resource", parentId: RG_WEB, resourceType: "Microsoft.KeyVault/vaults" },
];

function a(id: string, scopeId: string, roleName: string, principalName: string, extra: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, principalId: `p-${id}`, principalName, principalType: "User", roleDefinitionId: `r-${id}`, roleName, state: "active", memberType: "direct", endDateTime: null, ...extra };
}

const ASSIGNMENTS: AzureAssignment[] = [
    a("1", "/", "Reader", "Alex Wilber"),
    a("2", MG, "Owner", "Platform Team", { principalType: "Group" }),
    a("3", PROD, "Contributor", "Platform Team", { principalType: "Group" }),
    a("4", PROD, "Owner", "Adele Vance", { state: "eligible", endDateTime: "2027-01-01T00:00:00Z" }),
    a("5", "/subscriptions/S1/resourcegroups/RG-WEB", "Reader", "Web Ops", { principalType: "ForeignGroup" }),
    a("6", KV, "Key Vault Secrets User", "app-web", { principalType: "ServicePrincipal" }),
    a("7", TEST, "Contributor", "Test Team"),
    a("8", "/subscriptions/s9", "Reader", "Nobody"),
];

const ids = (rows: { assignment: AzureAssignment }[]) => rows.map((r) => r.assignment.id);
const names = (rows: { scope: AzureScope }[]) => rows.map((r) => r.scope.name);

const ALL_SEVEN = ["Root", "Contoso Platform", "Contoso Production", "rg-web", "kv-web", "Contoso Test", "rg-sandbox"];
const SIX = ["Root", "Contoso Platform", "Contoso Production", "rg-web", "Contoso Test", "rg-sandbox"];

describe("flattenScopeTree", () => {
    it("orders depth first with depths", () => {
        expect(flattenScopeTree(SCOPES).map((r) => [r.scope.name, r.depth])).toEqual([["Root", 0], ["Contoso Platform", 1], ["Contoso Production", 2], ["rg-web", 3], ["kv-web", 4], ["Contoso Test", 2], ["rg-sandbox", 3]]);
    });

    it("treats a scope with a missing parent as a root", () => {
        expect(flattenScopeTree([{ id: "/subscriptions/x", name: "X", level: "subscription", parentId: "/missing" }]).map((r) => r.depth)).toEqual([0]);
    });

    it("ends on a cycle", () => {
        const cycle: AzureScope[] = [{ id: "a", name: "A", level: "managementGroup", parentId: "b" }, { id: "b", name: "B", level: "managementGroup", parentId: "a" }];
        expect(flattenScopeTree(cycle)).toHaveLength(0);
    });

    it("returns an empty list for no scopes", () => {
        expect(flattenScopeTree([])).toEqual([]);
    });
});

describe("visibleScopeRows", () => {
    const rows = flattenScopeTree(SCOPES);

    it("hides resources when a subscription is selected", () => {
        expect(names(visibleScopeRows(rows, PROD))).toEqual(SIX);
    });

    it("shows the resource under the selected resource group", () => {
        expect(names(visibleScopeRows(rows, RG_WEB))).toEqual(ALL_SEVEN);
    });

    it("shows the resource when it is selected, case-insensitively", () => {
        expect(names(visibleScopeRows(rows, KV.toUpperCase()))).toEqual(ALL_SEVEN);
    });

    it("hides resources when nothing is selected", () => {
        expect(names(visibleScopeRows(rows, null))).toEqual(SIX);
    });
});

describe("defaultScopeId and findScope", () => {
    it("picks the first subscription", () => {
        expect(defaultScopeId(SCOPES)).toBe(PROD);
    });

    it("falls back to the first scope", () => {
        expect(defaultScopeId([SCOPES[0], SCOPES[1]])).toBe("/");
    });

    it("returns null for no scopes", () => {
        expect(defaultScopeId([])).toBeNull();
    });

    it("finds a scope case-insensitively", () => {
        expect(findScope(SCOPES, "/SUBSCRIPTIONS/S1")?.id).toBe(PROD);
        expect(findScope(SCOPES, "/nope")).toBeNull();
        expect(findScope(SCOPES, null)).toBeNull();
    });
});

describe("buildAssignmentRows without filters", () => {
    const cases: [string, string | null, string[], boolean[]][] = [
        ["PROD", PROD, ["1", "2", "3", "4", "5", "6"], [true, true, false, false, false, false]],
        ["PROD in capitals", "/SUBSCRIPTIONS/S1", ["1", "2", "3", "4", "5", "6"], [true, true, false, false, false, false]],
        ["KV", KV, ["1", "2", "3", "4", "5", "6"], [true, true, true, true, true, false]],
        ["root", "/", ["1", "2", "3", "4", "5", "6", "7"], [false, false, false, false, false, false, false]],
        ["TEST", TEST, ["1", "2", "7"], [true, true, false]],
        ["an unknown scope", "/subscriptions/zzz", [], []],
        ["null", null, [], []],
    ];

    for (const [label, selected, expectedIds, expectedInherited] of cases) {
        it(`selected ${label}`, () => {
            const rows = buildAssignmentRows(ASSIGNMENTS, SCOPES, selected, EMPTY_AZURE_FILTERS);
            expect(ids(rows)).toEqual(expectedIds);
            expect(rows.map((r) => r.isInherited)).toEqual(expectedInherited);
        });
    }

    it("fills the texts with PROD selected", () => {
        const rows = buildAssignmentRows(ASSIGNMENTS, SCOPES, PROD, EMPTY_AZURE_FILTERS);
        expect(rows.map((r) => r.originText)).toEqual(["Inherited from Root", "Inherited from Contoso Platform", "This scope", "This scope", "This scope", "This scope"]);
        const row5 = rows.find((r) => r.assignment.id === "5");
        expect(row5?.scope.name).toBe("rg-web");
        expect(row5?.scope.id).toBe(RG_WEB);
        expect(rows.find((r) => r.assignment.id === "4")?.endText).toBe(formatDate("2027-01-01T00:00:00Z"));
        expect(rows.filter((r) => r.assignment.id !== "4").every((r) => r.endText === "Permanent")).toBe(true);
        expect(rows.map((r) => r.principalTypeLabel)).toEqual(["User", "Group", "Group", "User", "Foreign group", "App"]);
    });

    it("names the inherited resource group with KV selected", () => {
        const rows = buildAssignmentRows(ASSIGNMENTS, SCOPES, KV, EMPTY_AZURE_FILTERS);
        expect(rows.find((r) => r.assignment.id === "5")?.originText).toBe("Inherited from rg-web");
    });

    it("keeps the raw end date when it is invalid", () => {
        const rows = buildAssignmentRows([a("9", PROD, "Reader", "X", { endDateTime: "not a date" })], SCOPES, PROD, EMPTY_AZURE_FILTERS);
        expect(rows[0].endText).toBe("not a date");
    });
});

describe("buildAssignmentRows filters, PROD selected", () => {
    const cases: [string, Parameters<typeof buildAssignmentRows>[3], string[]][] = [
        ["eligible", { ...EMPTY_AZURE_FILTERS, status: "eligible" }, ["4"]],
        ["active", { ...EMPTY_AZURE_FILTERS, status: "active" }, ["1", "2", "3", "5", "6"]],
        ["here", { ...EMPTY_AZURE_FILTERS, origin: "here" }, ["3", "4", "5", "6"]],
        ["inherited", { ...EMPTY_AZURE_FILTERS, origin: "inherited" }, ["1", "2"]],
        ["query owner", { ...EMPTY_AZURE_FILTERS, query: "owner" }, ["2", "4"]],
        ["query with spaces and capitals", { ...EMPTY_AZURE_FILTERS, query: "  WEB ops " }, ["5"]],
        ["query platform", { ...EMPTY_AZURE_FILTERS, query: "platform" }, ["2", "3"]],
        ["all three", { ...EMPTY_AZURE_FILTERS, query: "reader", status: "active", origin: "inherited" }, ["1"]],
        ["no match", { ...EMPTY_AZURE_FILTERS, query: "nothing matches" }, []],
    ];

    for (const [label, filters, expected] of cases) {
        it(label, () => {
            expect(ids(buildAssignmentRows(ASSIGNMENTS, SCOPES, PROD, filters))).toEqual(expected);
        });
    }
});

describe("cardFactLine", () => {
    it("writes the scope, the origin and the end", () => {
        const rows = buildAssignmentRows(ASSIGNMENTS, SCOPES, PROD, EMPTY_AZURE_FILTERS);
        expect(cardFactLine(rows.find((r) => r.assignment.id === "3")!)).toBe("Contoso Production, this scope, Permanent");
        expect(cardFactLine(rows.find((r) => r.assignment.id === "1")!)).toBe("Root, inherited from Root, Permanent");
    });
});

describe("buildAssignmentRows new filters", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const OWNER_ID = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
    const MATCH: AzureAssignment[] = [
        a("m1", PROD, "Owner", "Owner Active", { roleDefinitionId: OWNER_ID }),
        a("m2", PROD, "Owner", "Owner Activated", { roleDefinitionId: OWNER_ID.toUpperCase(), isActivated: true, endDateTime: "2026-10-19T20:00:00Z" }),
        a("m3", PROD, "Reader", "Reader Eligible", { state: "eligible", endDateTime: "2026-11-30T00:00:00Z" }),
        a("m4", RG_WEB, "Reader", "App Reader", { principalType: "ServicePrincipal", endDateTime: "2026-11-10T00:00:00Z" }),
        a("m5", KV, "Key Vault Reader", "Vault Group", { principalType: "Group" }),
    ];
    const cases: [string, Partial<typeof EMPTY_AZURE_FILTERS>, string[]][] = [
        ["status eligible", { status: "eligible" }, ["m3"]],
        ["status active", { status: "active" }, ["m1", "m2", "m4", "m5"]],
        ["status activated", { status: "activated" }, ["m2"]],
        ["status assigned", { status: "assigned" }, ["m1", "m4", "m5"]],
        ["privileged", { privileged: true }, ["m1", "m2"]],
        ["principal app", { principalType: "app" }, ["m4"]],
        ["principal group", { principalType: "group" }, ["m5"]],
        ["ends permanent", { ends: "permanent" }, ["m1", "m5"]],
        ["ends timeBound", { ends: "timeBound" }, ["m2", "m3", "m4"]],
        ["ends within30", { ends: "within30" }, ["m2", "m4"]],
        ["level subscription", { level: "subscription" }, ["m1", "m2", "m3"]],
        ["level resource", { level: "resource" }, ["m5"]],
        ["resource type", { resourceType: "microsoft.keyvault/vaults" }, ["m5"]],
    ];
    for (const [label, change, expected] of cases) {
        it(label, () => {
            const rows = buildAssignmentRows(MATCH, SCOPES, PROD, { ...EMPTY_AZURE_FILTERS, ...change }, now);
            expect(ids(rows).sort()).toEqual(expected);
        });
    }
});

describe("DEFAULT_AZURE_FILTERS", () => {
    it("starts on Origin This scope and filters nothing else", () => {
        expect(DEFAULT_AZURE_FILTERS).toEqual({ ...EMPTY_AZURE_FILTERS, origin: "here" });
        expect(ids(buildAssignmentRows(ASSIGNMENTS, SCOPES, PROD, DEFAULT_AZURE_FILTERS))).toEqual(["3", "4", "5", "6"]);
    });
});

describe("hiddenInheritedCount", () => {
    it("counts the inherited rows of a scope with none of its own", () => {
        const inherited = buildAssignmentRows(ASSIGNMENTS, SCOPES, RG_SBX, { ...EMPTY_AZURE_FILTERS, origin: "inherited" });
        expect(buildAssignmentRows(ASSIGNMENTS, SCOPES, RG_SBX, DEFAULT_AZURE_FILTERS)).toEqual([]);
        expect(inherited.length).toBeGreaterThan(0);
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, RG_SBX, DEFAULT_AZURE_FILTERS)).toBe(inherited.length);
    });

    it("is 0 when the scope has rows of its own, another filter is set or Origin is not This scope", () => {
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, PROD, DEFAULT_AZURE_FILTERS)).toBe(0);
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, RG_SBX, { ...DEFAULT_AZURE_FILTERS, query: "reader" })).toBe(0);
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, RG_SBX, { ...DEFAULT_AZURE_FILTERS, status: "active" })).toBe(0);
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, RG_SBX, { ...DEFAULT_AZURE_FILTERS, privileged: true })).toBe(0);
        expect(hiddenInheritedCount(ASSIGNMENTS, SCOPES, RG_SBX, EMPTY_AZURE_FILTERS)).toBe(0);
    });
});

describe("scopeLineFor", () => {
    it("names what the rows hold per Origin", () => {
        expect(scopeLineFor("rg-web", "all")).toBe("rg-web, including inherited assignments");
        expect(scopeLineFor("rg-web", "here")).toBe("rg-web, without inherited assignments");
        expect(scopeLineFor("rg-web", "inherited")).toBe("rg-web, inherited assignments only");
    });
});

describe("matchesAzureFilters: the keys of the dashboard", () => {
    const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
    const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
    const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
    const subScope: AzureScope = { id: PROD, name: "Contoso Production", level: "subscription", parentId: MG };
    const rootScope: AzureScope = { id: "/", name: "Root", level: "root", parentId: null };
    const mgScope: AzureScope = { id: MG, name: "Contoso Platform", level: "managementGroup", parentId: "/" };
    const rgScope: AzureScope = { id: RG_WEB, name: "rg-web", level: "resourceGroup", parentId: PROD };
    const base = (extra: Partial<AzureAssignment> = {}) => a("x", PROD, "Owner", "Someone", { roleDefinitionId: OWNER, ...extra });
    const test = (assignment: AzureAssignment, filters: Partial<typeof EMPTY_AZURE_FILTERS>, context: AzureFilterContext = {}, scope: AzureScope = subScope) =>
        matchesAzureFilters(assignment, scope, false, { ...EMPTY_AZURE_FILTERS, ...filters }, context, NOW_MS);

    function policy(over: { approval?: boolean; mfa?: boolean; authContext?: boolean; justification?: boolean; maxDuration: string; defaults: boolean; recipients?: string[] }): AzureSettingsOutcome {
        const caller = { caller: "EndUser" };
        return {
            status: "loaded",
            rules: [
                { id: "Approval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule", target: caller, setting: { isApprovalRequired: over.approval === true, approvalStages: [{ primaryApprovers: [] }] } },
                { id: "Enablement_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule", target: caller, enabledRules: [...(over.mfa ? ["MultiFactorAuthentication"] : []), ...(over.justification ? ["Justification"] : [])] },
                { id: "AuthenticationContext_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule", target: caller, isEnabled: over.authContext === true, claimValue: over.authContext ? "c1" : "" },
                { id: "Expiration_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: caller, maximumDuration: over.maxDuration },
                { id: "Notification_Admin_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target: { caller: "Admin" }, isDefaultRecipientsEnabled: over.defaults, notificationRecipients: over.recipients ?? [] },
            ],
        };
    }
    const key = azurePolicyKey(PROD, OWNER);
    const mfaApproval = new Map<string, AzureSettingsOutcome>([[key, policy({ approval: true, mfa: true, maxDuration: "PT8H", defaults: false })]]);
    const authCtx = new Map<string, AzureSettingsOutcome>([[key, policy({ authContext: true, justification: true, maxDuration: "PT10H", defaults: true })]]);
    const notLoaded = new Map<string, AzureSettingsOutcome>([[key, { status: "failed" }]]);

    it("keeps the five roles privileged without definitions, and adds those by actions with them", () => {
        expect(test(base(), { privileged: true })).toBe(true);
        expect(test(base({ roleDefinitionId: READER }), { privileged: true })).toBe(false);
        const definitions = new Map<string, ArmRoleDefinition>([[READER, { id: "r", name: "r", type: "Microsoft.Authorization/roleDefinitions", properties: { roleName: "Reader", permissions: [{ actions: ["*"] }] } }]]);
        expect(test(base({ roleDefinitionId: READER }), { privileged: true }, { definitions })).toBe(true);
    });

    it("tells the principal types apart", () => {
        const spTypes = new Map([["sp-app", "Application"], ["sp-mi", "ManagedIdentity"]]);
        const app = base({ principalId: "sp-app", principalType: "ServicePrincipal" });
        const mi = base({ principalId: "sp-mi", principalType: "ServicePrincipal" });
        const agent = base({ principalType: "AgentIdentity" });
        const guest = base({ principalUpn: "x_y.com#EXT#@c.onmicrosoft.com" });
        expect(test(app, { principalType: "app" }, { spTypes })).toBe(true);
        expect(test(mi, { principalType: "app" }, { spTypes })).toBe(false);
        expect(test(mi, { principalType: "managedIdentity" }, { spTypes })).toBe(true);
        expect(test(app, { principalType: "managedIdentity" }, { spTypes })).toBe(false);
        expect(test(mi, { principalType: "app" })).toBe(true);
        expect(test(mi, { principalType: "managedIdentity" })).toBe(false);
        expect(test(agent, { principalType: "agent" })).toBe(true);
        expect(test(guest, { principalType: "guest" })).toBe(true);
        expect(test(guest, { principalType: "user" })).toBe(false);
        expect(test(base(), { principalType: "guest" })).toBe(false);
        expect(test(base({ principalType: "ForeignGroup" }), { principalType: "foreignGroup" })).toBe(true);
        expect(test(base({ principalType: "ForeignGroup" }), { principalType: "group" })).toBe(false);
    });

    it("keeps a deleted principal under Deleted only, and labels it Deleted", () => {
        const spTypes = new Map([["u-gone", DELETED_PRINCIPAL], ["g-gone", DELETED_PRINCIPAL]]);
        const user = base({ principalId: "U-GONE" });
        const group = base({ principalId: "g-gone", principalType: "Group" });
        expect(test(user, { principalType: "deleted" }, { spTypes })).toBe(true);
        expect(test(group, { principalType: "deleted" }, { spTypes })).toBe(true);
        expect(test(user, { principalType: "user" }, { spTypes })).toBe(false);
        expect(test(group, { principalType: "group" }, { spTypes })).toBe(false);
        expect(test(base(), { principalType: "deleted" }, { spTypes })).toBe(false);
        expect(test(user, { principalType: "deleted" })).toBe(false);
        expect(principalKindLabel(user, spTypes)).toBe("Deleted");
    });

    it("matches customRole, via and role", () => {
        expect(test(base({ isCustomRole: true }), { customRole: true })).toBe(true);
        expect(test(base(), { customRole: true })).toBe(false);
        expect(test(base(), { via: "direct" })).toBe(true);
        expect(test(base(), { via: "group" })).toBe(false);
        expect(test(base({ isViaGroup: true }), { via: "group" })).toBe(true);
        expect(test(base({ isViaGroup: true }), { via: "direct" })).toBe(false);
        expect(test(base({ roleDefinitionId: OWNER.toUpperCase() }), { role: OWNER })).toBe(true);
        expect(test(base({ roleDefinitionId: READER }), { role: OWNER })).toBe(false);
    });

    it("leaves emergency access out and tells roles with and without an eligible assignment apart", () => {
        const emergencyIds = new Set(["p-x"]);
        expect(test(base({ principalId: "P-X" }), { excludeEmergency: true }, { emergencyIds })).toBe(false);
        expect(test(base({ principalId: "p-y" }), { excludeEmergency: true }, { emergencyIds })).toBe(true);
        expect(test(base({ principalId: "P-X" }), {}, { emergencyIds })).toBe(true);
        const withEligible = new Set([key]);
        expect(test(base(), { noEligible: true }, { eligiblePairs: withEligible })).toBe(false);
        expect(test(base(), { noEligible: true }, { eligiblePairs: new Set() })).toBe(true);
    });

    it("reads the policy keys, and matches none of them while the policy is not loaded", () => {
        expect(test(base(), { approval: "required" }, { settings: mfaApproval })).toBe(true);
        expect(test(base(), { approval: "notRequired" }, { settings: mfaApproval })).toBe(false);
        expect(test(base(), { approval: "notRequired" }, { settings: authCtx })).toBe(true);
        expect(test(base(), { justification: "required" }, { settings: authCtx })).toBe(true);
        expect(test(base(), { justification: "notRequired" }, { settings: mfaApproval })).toBe(true);
        expect(test(base(), { mfa: "entraMfa" }, { settings: mfaApproval })).toBe(true);
        expect(test(base(), { mfa: "authContext" }, { settings: mfaApproval })).toBe(false);
        expect(test(base(), { mfa: "authContext" }, { settings: authCtx })).toBe(true);
        expect(test(base(), { mfa: "neither" }, { settings: authCtx })).toBe(false);
        for (const settings of [notLoaded, new Map<string, AzureSettingsOutcome>(), undefined]) {
            expect(test(base(), { approval: "notRequired" }, { settings })).toBe(false);
            expect(test(base(), { mfa: "neither" }, { settings })).toBe(false);
            expect(test(base(), { maxDuration: "over8h" }, { settings })).toBe(false);
            expect(test(base(), { notified: "none" }, { settings })).toBe(false);
        }
    });

    it("matches the maximum duration by bucket and over 8 hours", () => {
        expect(test(base(), { maxDuration: "upTo8h" }, { settings: mfaApproval })).toBe(true);
        expect(test(base(), { maxDuration: "upTo4h" }, { settings: mfaApproval })).toBe(false);
        expect(test(base(), { maxDuration: "over8h" }, { settings: mfaApproval })).toBe(false);
        expect(test(base(), { maxDuration: "over8h" }, { settings: authCtx })).toBe(true);
        expect(test(base(), { maxDuration: "upTo12h" }, { settings: authCtx })).toBe(true);
    });

    it("matches Nobody is notified only when the rule has no default recipients and no recipients", () => {
        expect(test(base(), { notified: "none" }, { settings: mfaApproval })).toBe(true);
        expect(test(base(), { notified: "none" }, { settings: authCtx })).toBe(false);
        const withRecipient = new Map<string, AzureSettingsOutcome>([[key, policy({ maxDuration: "PT8H", defaults: false, recipients: ["a@b.com"] })]]);
        expect(test(base(), { notified: "none" }, { settings: withRecipient })).toBe(false);
    });

    it("matches the two new levels: management groups include the root, subscription or above stops at the subscription", () => {
        expect(test(base(), { level: "managementGroup" }, {}, rootScope)).toBe(true);
        expect(test(base(), { level: "managementGroup" }, {}, mgScope)).toBe(true);
        expect(test(base(), { level: "managementGroup" }, {}, subScope)).toBe(false);
        expect(test(base(), { level: "subscriptionOrAbove" }, {}, rootScope)).toBe(true);
        expect(test(base(), { level: "subscriptionOrAbove" }, {}, mgScope)).toBe(true);
        expect(test(base(), { level: "subscriptionOrAbove" }, {}, subScope)).toBe(true);
        expect(test(base(), { level: "subscriptionOrAbove" }, {}, rgScope)).toBe(false);
        expect(test(base(), { level: "subscription" }, {}, mgScope)).toBe(false);
    });

    it("builds the eligible pairs of the assignments", () => {
        const pairs = eligiblePairsOf([base({ state: "eligible" }), base({ id: "y", scopeId: TEST })]);
        expect([...pairs]).toEqual([azurePolicyKey(PROD, OWNER)]);
    });

    it("buildAssignmentRows takes the context and derives the eligible pairs from its own assignments", () => {
        const owner = { roleDefinitionId: OWNER };
        const list = [a("e", PROD, "Owner", "E", { ...owner, state: "eligible" }), a("f", PROD, "Owner", "F", owner), a("g", TEST, "Owner", "G", owner)];
        const rows = buildAssignmentRows(list, SCOPES, MG, { ...DEFAULT_AZURE_FILTERS, origin: "all", noEligible: true });
        expect(ids(rows)).toEqual(["g"]);
    });
});

describe("principal kind labels", () => {
    const sp = (principalType: string, principalId = "sp-1", principalUpn?: string): AzureAssignment => ({
        id: "x", scopeId: "/subscriptions/s1", principalId, principalName: "N", principalType, principalUpn, roleDefinitionId: "r", roleName: "Reader", state: "active", memberType: "direct", endDateTime: null,
    });

    it("principalKindLabel names every kind", () => {
        expect(principalKindLabel(sp("User"))).toBe("User");
        expect(principalKindLabel(sp("User", "u", "a_b.com#EXT#@t.onmicrosoft.com"))).toBe("Guest");
        expect(principalKindLabel(sp("Group"))).toBe("Group");
        expect(principalKindLabel(sp("ForeignGroup"))).toBe("Foreign group");
        expect(principalKindLabel(sp("ServicePrincipal"))).toBe("App");
        expect(principalKindLabel(sp("ServicePrincipal"), new Map([["sp-1", "Application"]]))).toBe("App");
        expect(principalKindLabel(sp("ServicePrincipal"), new Map([["sp-1", "ManagedIdentity"]]))).toBe("Managed identity");
        expect(principalKindLabel(sp("AgentIdentity"))).toBe("Agent");
        expect(principalKindLabel(sp("Device"))).toBe("Device");
        expect(principalKindLabel(sp("Something"))).toBe("Unknown");
    });

    it("buildAssignmentRows uses the spTypes of the context", () => {
        const scopes: AzureScope[] = [{ id: "/subscriptions/s1", name: "S1", level: "subscription", parentId: null }];
        const assignments = [sp("ServicePrincipal")];
        const withContext = buildAssignmentRows(assignments, scopes, "/subscriptions/s1", EMPTY_AZURE_FILTERS, new Date(), { spTypes: new Map([["sp-1", "ManagedIdentity"]]) });
        expect(withContext[0].principalTypeLabel).toBe("Managed identity");
        expect(buildAssignmentRows(assignments, scopes, "/subscriptions/s1", EMPTY_AZURE_FILTERS)[0].principalTypeLabel).toBe("App");
    });

    it("principalTypeLabelFor knows agent, device and unknown", () => {
        expect(principalTypeLabelFor("AgentIdentity")).toBe("Agent");
        expect(principalTypeLabelFor("Device")).toBe("Device");
        expect(principalTypeLabelFor("Something")).toBe("Unknown");
    });
});
