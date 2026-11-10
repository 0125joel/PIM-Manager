import { describe, expect, it } from "vitest";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { computeAzureEasyToMiss, type AzureDashboardInput, type AzureEasyToMissId, type AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import {
    CARD_PATCHES,
    EASY_TO_MISS_PATCHES,
    entraTargetFor,
    isSameAzureFilter,
    patchForEntraTarget,
    reportFiltersFor,
    reportHrefFor,
} from "@/utils/azureDashboardFilterLink";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, buildAssignmentRows, eligiblePairsOf } from "@/utils/azureReport";
import { azurePolicyKey } from "@/utils/azureScopes";

const MG = "/providers/Microsoft.Management/managementGroups/mg1";
const S1 = "/subscriptions/s1";
const S2 = "/subscriptions/s2";
const RG = "/subscriptions/s1/resourceGroups/rg1";
const RES = "/subscriptions/s1/resourceGroups/rg1/providers/Microsoft.KeyVault/vaults/kv1";
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const CONTRIB = "b24988ac-6180-42a0-ab88-20f7382dd24c";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const CUSTOM = "cccccccc-0000-0000-0000-000000000001";
const KVADMIN = "00482a5a-887f-4fb3-b363-3b7fe8e74483";
const NOW = new Date("2026-10-24T12:00:00Z");
const inHours = (h: number) => new Date(NOW.getTime() + h * 3600000).toISOString();
const inDays = (d: number) => inHours(d * 24);

const scopes: AzureScope[] = [
    { id: MG, name: "Contoso MG", level: "managementGroup", parentId: null },
    { id: S1, name: "Prod Sub", level: "subscription", parentId: MG, tenantId: "t-home" },
    { id: S2, name: "Partner Sub", level: "subscription", parentId: MG, tenantId: "t-other" },
    { id: RG, name: "rg1", level: "resourceGroup", parentId: S1 },
    { id: RES, name: "kv1", level: "resource", parentId: RG, resourceType: "Microsoft.KeyVault/vaults" },
];

function a(id: string, scopeId: string, roleDefinitionId: string, roleName: string, principalId: string, over: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName, principalId, principalName: principalId, principalType: "User", state: "active", memberType: "direct", endDateTime: null, ...over };
}

const assignments: AzureAssignment[] = [
    a("a1", MG, OWNER, "Owner", "u-alice", { memberType: "inherited" }),
    a("a2", MG, OWNER, "Owner", "u-bg", { memberType: "inherited" }),
    a("a3", S1, OWNER, "Owner", "u-bob", { state: "eligible" }),
    a("a4", S1, OWNER, "Owner", "u-bob", { endDateTime: inHours(2), isActivated: true }),
    a("a5", S1, CONTRIB, "Contributor", "u-carol", { state: "eligible", endDateTime: inDays(3), principalUpn: "carol_x.com#EXT#@c.onmicrosoft.com" }),
    a("a6", S1, CONTRIB, "Contributor", "u-app1", { principalType: "ServicePrincipal" }),
    a("a7", S1, CONTRIB, "Contributor", "u-mi1", { principalType: "ServicePrincipal" }),
    a("a8", S1, READER, "Reader", "u-agent1", { principalType: "AgentIdentity", endDateTime: inDays(10) }),
    a("a9", RG, READER, "Reader", "u-dave", { state: "eligible" }),
    a("a10", RG, CUSTOM, "Custom", "u-erin", { isCustomRole: true }),
    a("a11", RES, KVADMIN, "Key Vault Administrator", "u-frank", { state: "eligible", endDateTime: inDays(20) }),
    a("a12", RES, CONTRIB, "Contributor", "u-grp1", { principalType: "Group" }),
    a("a13", RES, CONTRIB, "Contributor", "u-grace", { isViaGroup: true }),
    a("a14", S2, OWNER, "Owner", "u-henk"),
    a("a15", S1, CONTRIB, "Contributor", "u-alice", { state: "eligible", memberType: "inherited" }),
];

function def(roleName: string, actions: string[]): ArmRoleDefinition {
    return { id: roleName, name: roleName, type: "Microsoft.Authorization/roleDefinitions", properties: { roleName, permissions: [{ actions }] } };
}
const definitions = new Map<string, ArmRoleDefinition>([
    [CUSTOM, def("Custom", ["*"])],
    [READER, def("Reader", ["*/read"])],
    [KVADMIN, def("Key Vault Administrator", ["Microsoft.Authorization/*/read"])],
]);
const spTypes = new Map([["u-app1", "Application"], ["u-mi1", "ManagedIdentity"]]);
const emergencyIds = new Set(["u-bg"]);

function loaded(over: { approval?: boolean; mfa?: boolean; maxDuration: string; notifyDefaults: boolean; recipients?: string[] }): AzureSettingsOutcome {
    const caller = { caller: "EndUser" };
    return {
        status: "loaded",
        rules: [
            { id: "Approval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule", target: caller, setting: { isApprovalRequired: over.approval === true, approvalStages: [{ primaryApprovers: [] }] } },
            { id: "Enablement_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule", target: caller, enabledRules: over.mfa ? ["MultiFactorAuthentication"] : [] },
            { id: "Expiration_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: caller, maximumDuration: over.maxDuration },
            { id: "Notification_Admin_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target: { caller: "Admin" }, isDefaultRecipientsEnabled: over.notifyDefaults, notificationRecipients: over.recipients ?? [] },
        ],
    };
}

const settings = new Map<string, AzureSettingsOutcome>([
    [azurePolicyKey(MG, OWNER), loaded({ approval: true, mfa: true, maxDuration: "PT8H", notifyDefaults: true })],
    [azurePolicyKey(S1, OWNER), loaded({ mfa: true, maxDuration: "PT10H", notifyDefaults: false })],
    [azurePolicyKey(S1, CONTRIB), loaded({ maxDuration: "PT4H", notifyDefaults: false, recipients: ["x@c.com"] })],
    [azurePolicyKey(S1, READER), loaded({ approval: true, mfa: true, maxDuration: "PT12H", notifyDefaults: true })],
    [azurePolicyKey(RG, CUSTOM), { status: "noAccess" }],
    [azurePolicyKey(RES, KVADMIN), { status: "failed" }],
    [azurePolicyKey(RES, CONTRIB), { status: "missing" }],
    [azurePolicyKey(S2, OWNER), loaded({ maxDuration: "PT90M", notifyDefaults: false })],
]);

const input: AzureDashboardInput = { assignments, scopes, homeTenantId: "t-home", definitions, settings, spTypes, emergencyIds, now: NOW, isTopScope: true, chosenScopeId: null, scope: "privileged" };

describe("patchForEntraTarget", () => {
    it.each([
        [{ assignment: "permanent" }, { status: "active", ends: "permanent" }],
        [{ assignment: "eligible" }, { status: "eligible" }],
        [{ assignment: "activeTimeBound" }, { status: "active", ends: "timeBound" }],
        [{ mfa: "entraMfa" }, { mfa: "entraMfa" }],
        [{ mfa: "authContext" }, { mfa: "authContext" }],
        [{ mfa: "neither" }, { mfa: "neither" }],
        [{ approval: "required" }, { approval: "required" }],
        [{ approval: "notRequired" }, { approval: "notRequired" }],
        [{ justification: "required" }, { justification: "required" }],
        [{ justification: "notRequired" }, { justification: "notRequired" }],
        [{ maxDuration: "upTo1h" }, { maxDuration: "upTo1h" }],
        [{ maxDuration: "upTo4h" }, { maxDuration: "upTo4h" }],
        [{ maxDuration: "upTo8h" }, { maxDuration: "upTo8h" }],
        [{ maxDuration: "upTo12h" }, { maxDuration: "upTo12h" }],
        [{ maxDuration: "over12h" }, { maxDuration: "over12h" }],
        [{ maxDuration: "over8h" }, { maxDuration: "over8h" }],
        [{ via: "direct" }, { via: "direct" }],
        [{ via: "group" }, { via: "group" }],
    ] as [DashboardFilter, object][])("maps %j to %j", (target, patch) => {
        expect(patchForEntraTarget(target)).toEqual(patch);
    });

    it("returns null for any other target", () => {
        expect(patchForEntraTarget({ assignment: "active" })).toBeNull();
        expect(patchForEntraTarget({ privileged: true })).toBeNull();
        expect(patchForEntraTarget({ mfa: "neither", approval: "required" })).toBeNull();
        expect(patchForEntraTarget({})).toBeNull();
    });
});

describe("entraTargetFor", () => {
    const targets: DashboardFilter[] = [
        { assignment: "permanent" }, { assignment: "eligible" }, { assignment: "activeTimeBound" },
        { mfa: "entraMfa" }, { mfa: "authContext" }, { mfa: "neither" },
        { approval: "required" }, { approval: "notRequired" }, { justification: "required" }, { justification: "notRequired" },
        { maxDuration: "upTo1h" }, { maxDuration: "upTo4h" }, { maxDuration: "upTo8h" }, { maxDuration: "upTo12h" }, { maxDuration: "over12h" }, { maxDuration: "over8h" },
        { via: "direct" }, { via: "group" },
    ];

    it.each(targets)("returns %j for its own filters, with either Origin", (target) => {
        expect(entraTargetFor(reportFiltersFor(patchForEntraTarget(target)!, false))).toEqual(target);
        expect(entraTargetFor(reportFiltersFor(patchForEntraTarget(target)!, true))).toEqual(target);
    });

    it("returns {} when the filters hold anything else", () => {
        expect(entraTargetFor(reportFiltersFor({ privileged: true }, false))).toEqual({});
        expect(entraTargetFor(reportFiltersFor({ status: "eligible", privileged: true }, false))).toEqual({});
        expect(entraTargetFor(reportFiltersFor({}, false))).toEqual({});
    });
});

describe("reportFiltersFor and isSameAzureFilter", () => {
    it("is neutral except the patch and takes Origin from the scope bar", () => {
        expect(reportFiltersFor({ privileged: true }, false)).toEqual({ ...EMPTY_AZURE_FILTERS, origin: "here", privileged: true });
        expect(reportFiltersFor({ privileged: true }, true).origin).toBe("all");
        expect(reportFiltersFor(CARD_PATCHES.inherited!, true).origin).toBe("inherited");
        expect(reportFiltersFor({}, false)).toEqual(DEFAULT_AZURE_FILTERS);
    });

    it("compares every key and the query", () => {
        expect(isSameAzureFilter(DEFAULT_AZURE_FILTERS, { ...DEFAULT_AZURE_FILTERS })).toBe(true);
        expect(isSameAzureFilter(DEFAULT_AZURE_FILTERS, { ...DEFAULT_AZURE_FILTERS, query: "x" })).toBe(false);
        expect(isSameAzureFilter(DEFAULT_AZURE_FILTERS, { ...DEFAULT_AZURE_FILTERS, role: OWNER })).toBe(false);
        expect(isSameAzureFilter(DEFAULT_AZURE_FILTERS, { ...DEFAULT_AZURE_FILTERS, excludeEmergency: true })).toBe(false);
    });
});

describe("the cards", () => {
    it("has a patch for every card except Role x scope", () => {
        expect(CARD_PATCHES.roleScope).toBeNull();
        expect(CARD_PATCHES.requireApproval).toEqual({ privileged: true, approval: "required" });
        expect(CARD_PATCHES.customRoles).toEqual({ customRole: true });
    });
});

describe("Easy to miss: Open in report lands on the same rows as the count", () => {
    const counts = Object.fromEntries(computeAzureEasyToMiss(input).map((r) => [r.id, r.count])) as Record<AzureEasyToMissId, number | null>;
    const context = { definitions, spTypes, settings, emergencyIds, eligiblePairs: eligiblePairsOf(assignments) };

    function rowsOf(id: AzureEasyToMissId) {
        return buildAssignmentRows(assignments, scopes, MG, reportFiltersFor(EASY_TO_MISS_PATCHES[id], true), NOW, context);
    }
    const distinctPrincipals = (id: AzureEasyToMissId) => new Set(rowsOf(id).map((r) => r.assignment.principalId.toLowerCase())).size;
    const distinctPairs = (id: AzureEasyToMissId) => new Set(rowsOf(id).map((r) => azurePolicyKey(r.assignment.scopeId, r.assignment.roleDefinitionId))).size;

    it("counts the fixture as the dashboard does", () => {
        expect(counts).toEqual({ permanentOwners: 2, eligibleWithoutEnd: 3, apps: 1, managedIdentities: 1, agents: 1, guests: 1, deleted: 0, nobodyNotified: 2, onlyPermanent: 4 });
    });

    it("permanentOwners and eligibleWithoutEnd count assignments", () => {
        expect(rowsOf("permanentOwners").map((r) => r.assignment.id)).toEqual(["a1", "a14"]);
        expect(rowsOf("permanentOwners")).toHaveLength(counts.permanentOwners!);
        expect(rowsOf("eligibleWithoutEnd")).toHaveLength(counts.eligibleWithoutEnd!);
    });

    it.each(["apps", "managedIdentities", "agents", "guests"] as const)("%s counts distinct principals", (id) => {
        expect(rowsOf(id).length).toBeGreaterThan(0);
        expect(distinctPrincipals(id)).toBe(counts[id]);
    });

    it.each(["nobodyNotified", "onlyPermanent"] as const)("%s counts distinct role x scope", (id) => {
        expect(distinctPairs(id)).toBe(counts[id]);
    });

    it("onlyPermanent derives the eligible pairs itself when the context has none", () => {
        const rows = buildAssignmentRows(assignments, scopes, MG, reportFiltersFor(EASY_TO_MISS_PATCHES.onlyPermanent, true), NOW, { definitions });
        expect(rows.every((r) => r.assignment.state === "active")).toBe(true);
        expect(distinctPairs("onlyPermanent")).toBe(new Set(rows.map((r) => azurePolicyKey(r.assignment.scopeId, r.assignment.roleDefinitionId))).size);
    });
});

describe("reportHrefFor", () => {
    it("writes the scope and the filters", () => {
        expect(reportHrefFor(reportFiltersFor({ status: "eligible", privileged: true }, false), S1)).toBe("/azure/report?scope=%2Fsubscriptions%2Fs1&f=status:eligible,privileged:true");
    });

    it("writes only the filters without a chosen scope, and nothing at all for the defaults", () => {
        expect(reportHrefFor(reportFiltersFor({ principalType: "guest" }, true), null)).toBe("/azure/report?f=origin:all,principalType:guest");
        expect(reportHrefFor(DEFAULT_AZURE_FILTERS, null)).toBe("/azure/report");
    });
});
