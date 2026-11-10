import { describe, expect, it } from "vitest";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { DELETED_PRINCIPAL } from "@/utils/azureDashboard";
import { azurePolicyKey } from "@/utils/azureScopes";
import {
    computeAzureAccounts,
    computeAzureActivation,
    computeAzureApprovers,
    computeAzureCards,
    computeAzureEasyToMiss,
    computeAzureHasAccess,
    computeAzureRightNow,
    computeAzureTerms,
    computeAzureWho,
    countAzureFailedPairs,
    countAzureSettingsFailed,
    type AzureDashboardInput,
    type AzureSettingsOutcome,
} from "@/utils/azureDashboardStats";

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

function a(id: string, scopeId: string, roleDefinitionId: string, roleName: string, principalId: string, principalName: string, over: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName, principalId, principalName, principalType: "User", state: "active", memberType: "direct", endDateTime: null, ...over };
}

// 15 assignments, see the notes per line
const assignments: AzureAssignment[] = [
    // Made on the management group, but ARM lists them as Inherited from every subscription below
    a("a1", MG, OWNER, "Owner", "u-alice", "Alice", { memberType: "inherited" }),
    a("a2", MG, OWNER, "Owner", "u-bg", "Break Glass", { memberType: "inherited" }),
    a("a3", S1, OWNER, "Owner", "u-bob", "Bob", { state: "eligible" }),
    a("a4", S1, OWNER, "Owner", "u-bob", "Bob", { endDateTime: inHours(2), isActivated: true }),
    a("a5", S1, CONTRIB, "Contributor", "u-carol", "Carol", { state: "eligible", endDateTime: inDays(3), principalUpn: "carol_x.com#EXT#@c.onmicrosoft.com" }),
    a("a6", S1, CONTRIB, "Contributor", "u-app1", "App One", { principalType: "ServicePrincipal" }),
    a("a7", S1, CONTRIB, "Contributor", "u-mi1", "MI One", { principalType: "ServicePrincipal" }),
    a("a8", S1, READER, "Reader", "u-agent1", "Agent One", { principalType: "AgentIdentity", endDateTime: inDays(10) }),
    a("a9", RG, READER, "Reader", "u-dave", "Dave", { state: "eligible" }),
    a("a10", RG, CUSTOM, "Custom", "u-erin", "Erin", { isCustomRole: true }),
    a("a11", RES, KVADMIN, "Key Vault Administrator", "u-frank", "Frank", { state: "eligible", endDateTime: inDays(20) }),
    a("a12", RES, CONTRIB, "Contributor", "u-grp1", "Group One", { principalType: "Group" }),
    a("a13", RES, CONTRIB, "Contributor", "u-grace", "Grace", { isViaGroup: true }),
    a("a14", S2, OWNER, "Owner", "u-henk", "Henk"),
    a("a15", S1, CONTRIB, "Contributor", "u-alice", "Alice", { state: "eligible", memberType: "inherited" }),
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

const GROUP_APPROVER = "11111111-aaaa-4aaa-8aaa-111111111111";
const ANN = "22222222-bbbb-4bbb-8bbb-222222222222";
const NO_NAME = "44444444-dddd-4ddd-8ddd-444444444444";

interface RuleSpec {
    approval?: boolean;
    approvers?: Record<string, unknown>[];
    mfa?: boolean;
    authContext?: boolean;
    justification?: boolean;
    maxDuration: string;
    notifyDefaults: boolean;
    recipients?: string[];
}

function loaded(spec: RuleSpec): AzureSettingsOutcome {
    const caller = { caller: "EndUser" };
    return {
        status: "loaded",
        rules: [
            { id: "Approval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule", target: caller, setting: { isApprovalRequired: spec.approval === true, approvalStages: [{ primaryApprovers: spec.approvers ?? [] }] } },
            { id: "Enablement_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule", target: caller, enabledRules: [...(spec.mfa ? ["MultiFactorAuthentication"] : []), ...(spec.justification ? ["Justification"] : [])] },
            { id: "AuthenticationContext_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule", target: caller, isEnabled: spec.authContext === true, claimValue: spec.authContext ? "c1" : "" },
            { id: "Expiration_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: caller, maximumDuration: spec.maxDuration },
            { id: "Notification_Admin_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target: { caller: "Admin" }, isDefaultRecipientsEnabled: spec.notifyDefaults, notificationRecipients: spec.recipients ?? [] },
        ],
    };
}

const approversP1 = [
    { "@odata.type": "#microsoft.graph.groupMembers", groupId: GROUP_APPROVER, description: "Security Approvers" },
    { "@odata.type": "#microsoft.graph.singleUser", userId: ANN, description: "Ann" },
];

const P1 = azurePolicyKey(MG, OWNER);
const P2 = azurePolicyKey(S1, OWNER);
const P3 = azurePolicyKey(S1, CONTRIB);
const P4 = azurePolicyKey(S1, READER);
const P6 = azurePolicyKey(RG, CUSTOM);
const P7 = azurePolicyKey(RES, KVADMIN);
const P8 = azurePolicyKey(RES, CONTRIB);
const P9 = azurePolicyKey(S2, OWNER);

// P9 (Owner on the partner subscription) and P5 (Reader on the resource group) are not in the map yet
const settingsBefore = new Map<string, AzureSettingsOutcome>([
    [P1, loaded({ approval: true, approvers: approversP1, mfa: true, maxDuration: "PT8H", notifyDefaults: true })],
    [P2, loaded({ mfa: true, justification: true, maxDuration: "PT10H", notifyDefaults: false })],
    [P3, loaded({ authContext: true, maxDuration: "PT4H", notifyDefaults: false, recipients: ["x@c.com"] })],
    [P4, loaded({ approval: true, approvers: [{ "@odata.type": "#microsoft.graph.singleUser", userId: NO_NAME }], mfa: true, maxDuration: "PT12H", notifyDefaults: true })],
    [P6, { status: "noAccess" }],
    [P7, { status: "failed" }],
    [P8, { status: "missing" }],
]);
const settingsAfter = new Map(settingsBefore);
settingsAfter.set(P9, loaded({ maxDuration: "PT90M", notifyDefaults: false }));

function input(over: Partial<AzureDashboardInput> = {}): AzureDashboardInput {
    return { assignments, scopes, homeTenantId: "t-home", definitions, settings: settingsAfter, spTypes, emergencyIds: new Set(["u-bg"]), now: NOW, isTopScope: true, chosenScopeId: null, scope: "privileged", ...over };
}

describe("computeAzureCards", () => {
    it("counts every card with its breakdown", () => {
        const cards = computeAzureCards(input());
        expect(cards.roleScope).toEqual({ value: "9", breakdown: "role × scope with an assignment · 1 MG, 4 sub, 2 RG, 2 resource", isWarning: false });
        expect(cards.activeNow).toEqual({ value: "10", breakdown: "assignments · 1 activated, 9 assigned", isWarning: false });
        expect(cards.permanent).toEqual({ value: "8", breakdown: "assignments · 1 emergency access", isWarning: true });
        expect(cards.eligible).toEqual({ value: "5", breakdown: "assignments · 3 without an end date", isWarning: false });
        expect(cards.privileged).toEqual({ value: "6", breakdown: "role × scope · 3 roles", isWarning: false });
        // P6 has no readable settings (noAccess): it is left out of the ratio, as in On activation
        expect(cards.requireApproval).toEqual({ value: "1", breakdown: "of 5 privileged role × scope", isWarning: false });
        expect(cards.customRoles).toEqual({ value: "1", breakdown: "role × scope · 1 custom roles", isWarning: false });
        expect(cards.inherited).toEqual({ value: "2", breakdown: "assignments · made on a management group", isWarning: false });
    });

    it("counts the assignments above a chosen subscription as inherited, and leaves their role × scope out of the own ones", () => {
        const cards = computeAzureCards(input({ isTopScope: false, chosenScopeId: S1 }));
        expect(cards.inherited).toEqual({ value: "2", breakdown: "assignments · from above", isWarning: false });
        expect(cards.roleScope).toEqual({ value: "8", breakdown: "role × scope with an assignment · 0 MG, 4 sub, 2 RG, 2 resource", isWarning: false });
        expect(cards.privileged).toEqual({ value: "5", breakdown: "role × scope · 3 roles", isWarning: false });
        expect(cards.requireApproval).toEqual({ value: "0", breakdown: "of 4 privileged role × scope", isWarning: false });
    });

    it("counts the management group role × scope at the top scope although ARM calls them inherited", () => {
        expect(computeAzureCards(input()).roleScope.breakdown).toContain("1 MG");
        expect(computeAzureEasyToMiss(input()).find((r) => r.id === "onlyPermanent")?.count).toBe(4);
    });

    it("waits for the definitions and the settings", () => {
        const noDefinitions = computeAzureCards(input({ definitions: null }));
        expect(noDefinitions.privileged.value).toBeNull();
        const pending = computeAzureCards(input({ settings: settingsBefore }));
        expect(pending.requireApproval).toEqual({ value: null, breakdown: "of 5 privileged role × scope", isWarning: false });
    });

    it("shows a dash when no privileged settings can be read, and does not warn about emergency access only", () => {
        const allNoAccess = new Map<string, AzureSettingsOutcome>([P1, P2, P3, P6, P8, P9].map((k) => [k, { status: "noAccess" }]));
        expect(computeAzureCards(input({ settings: allNoAccess })).requireApproval.value).toBe("-");
        const onlyBreakGlass = [assignments[1]];
        expect(computeAzureCards(input({ assignments: onlyBreakGlass })).permanent).toEqual({ value: "1", breakdown: "assignments · 1 emergency access", isWarning: false });
    });
});

describe("computeAzureWho", () => {
    it("splits permanent, eligible and active time-bound", () => {
        expect(computeAzureWho(input())).toEqual({ permanent: 8, eligible: 5, activeTimeBound: 2, total: 15, emergencyPermanent: 1 });
    });
});

describe("computeAzureTerms", () => {
    it("counts the loaded privileged role × scope and leaves the unreadable one out", () => {
        expect(computeAzureTerms(input())).toEqual({
            roleCount: 5,
            entraMfa: 2,
            authContext: 1,
            neither: 1,
            approval: 1,
            justification: 1,
            withoutJustification: 3,
            overEightHours: 1,
            isPending: false,
        });
    });

    it("is pending until every privileged pair has a settings entry", () => {
        const before = computeAzureTerms(input({ settings: settingsBefore }));
        expect(before.isPending).toBe(true);
        expect(before.neither).toBe(0);
        expect(before.roleCount).toBe(5);
    });

    it("never waits for settings of a root pair, which are not read", () => {
        const rootAssignment = a("root1", "/", OWNER, "Owner", "u-root", "Root Owner");
        const rootInput = input({ assignments: [...assignments, rootAssignment] });
        expect(computeAzureTerms(rootInput).isPending).toBe(false);
        expect(computeAzureCards(rootInput).requireApproval.value).not.toBeNull();
        // The root pair is left out of the ratio of the card and of the block alike
        expect(computeAzureCards(rootInput).requireApproval.breakdown).toBe(`of ${computeAzureTerms(rootInput).roleCount} privileged role × scope`);
        expect(computeAzureCards(rootInput).requireApproval.breakdown).toBe(computeAzureCards(input()).requireApproval.breakdown);
        const activation = computeAzureActivation(rootInput);
        expect(activation.notReadable).toBeGreaterThanOrEqual(1);
        expect(activation.unloaded).toBe(activation.roleCount - activation.notReadable - (activation.approvalRequired + activation.approvalNotRequired));
    });
});

describe("a failed settings read", () => {
    // P3 (Contributor on Prod Sub, authentication context, not notified by default but a recipient) and P9 failed
    const withFailed = new Map(settingsAfter);
    withFailed.set(P3, { status: "failed" });
    withFailed.set(P9, { status: "failed" });

    it("is not counted as not required, and leaves the denominator of the approval card", () => {
        expect(computeAzureCards(input({ settings: withFailed })).requireApproval).toEqual({ value: "1", breakdown: "of 3 privileged role × scope", isWarning: false });
    });

    it("gives a dash, not 0, when every privileged read failed", () => {
        const allFailed = new Map<string, AzureSettingsOutcome>([P1, P2, P3, P6, P8, P9].map((k) => [k, { status: "failed" }]));
        expect(computeAzureCards(input({ settings: allFailed })).requireApproval.value).toBe("-");
        expect(computeAzureTerms(input({ settings: allFailed }))).toMatchObject({ roleCount: 0, neither: 0, approval: 0, withoutJustification: 0, isPending: false });
    });

    it("is left out of the terms: roleCount and every count", () => {
        expect(computeAzureTerms(input({ settings: withFailed }))).toEqual({
            roleCount: 3,
            entraMfa: 2,
            authContext: 0,
            neither: 0,
            approval: 1,
            justification: 1,
            // P8 is missing, so not loaded: in roleCount as in Entra, in no count
            withoutJustification: 1,
            overEightHours: 1,
            isPending: false,
        });
    });

    it("is not counted as nobody notified", () => {
        const before = computeAzureEasyToMiss(input()).find((r) => r.id === "nobodyNotified")?.count;
        const after = computeAzureEasyToMiss(input({ settings: withFailed })).find((r) => r.id === "nobodyNotified")?.count;
        // P2 and P9 notify nobody; P9 failed, so it is not counted
        expect(before).toBe(2);
        expect(after).toBe(1);
    });

    it("is counted for the page banner, over the roles the reads asked for", () => {
        expect(countAzureSettingsFailed(assignments, definitions, withFailed, "privileged")).toEqual({ n: 2, m: 6 });
        expect(countAzureSettingsFailed(assignments, definitions, settingsAfter, "privileged")).toBeNull();
        // P7 (Key Vault Administrator, not privileged) failed: only with all roles
        expect(countAzureSettingsFailed(assignments, definitions, settingsAfter, "all")).toEqual({ n: 1, m: 9 });
    });

    it("is told apart from a setting still loading in the Advanced charts", () => {
        expect(countAzureFailedPairs(input({ settings: withFailed }))).toBe(2);
        expect(countAzureFailedPairs(input({ settings: settingsBefore }))).toBe(0);
    });
});

describe("definitions that failed", () => {
    it("show the count of the built-in privileged roles, not a skeleton", () => {
        expect(computeAzureCards(input({ definitions: null })).privileged.value).toBeNull();
        const failed = computeAzureCards(input({ definitions: null, definitionsFailed: true }));
        // Owner and Contributor are built-in privileged; the custom role is not known without definitions
        expect(failed.privileged).toEqual({ value: "5", breakdown: "role × scope · 2 roles", isWarning: false });
    });
});

describe("computeAzureEasyToMiss", () => {
    const row = (rows: ReturnType<typeof computeAzureEasyToMiss>, id: string) => rows.find((r) => r.id === id)!;

    it("counts every row in the fixed order", () => {
        const rows = computeAzureEasyToMiss(input());
        expect(rows.map((r) => r.id)).toEqual(["permanentOwners", "eligibleWithoutEnd", "apps", "managedIdentities", "agents", "guests", "deleted", "nobodyNotified", "onlyPermanent"]);
        expect(rows.map((r) => r.count)).toEqual([2, 3, 1, 1, 1, 1, 0, 2, 4]);
        expect(rows.map((r) => r.label)).toEqual([
            "Permanent Owners at subscription or above",
            "Eligible without an end date",
            "Apps with a privileged role",
            "Managed identities with a privileged role",
            "Agents with a role",
            "Guests with a role",
            "Deleted accounts with a role",
            "Nobody is notified on activation",
            "Only permanent assignments",
        ]);
        expect(row(rows, "permanentOwners").detail).toBe("Emergency access left out.");
        expect(row(rows, "eligibleWithoutEnd").detail).toBe("Never comes up for review by itself.");
        expect(row(rows, "apps").detail).toBe("Always active: Azure does not let them be eligible.");
        expect(row(rows, "managedIdentities").detail).toBe("Always active: Azure does not let them be eligible.");
        expect(row(rows, "agents").detail).toBe("AI agents (Microsoft Entra Agent ID) that hold a role. Active only.");
        expect(row(rows, "guests").detail).toBe("Accounts from another tenant.");
        expect(row(rows, "nobodyNotified").detail).toBe("Privileged role × scope where activation goes unnoticed.");
        expect(row(rows, "onlyPermanent").detail).toBe("Privileged role × scope that nobody activates, PIM is not used.");
        expect(row(rows, "permanentOwners").category).toBe("Access without an end");
        expect(row(rows, "guests").category).toBe("Accounts you may not expect");
        expect(row(rows, "onlyPermanent").category).toBe("Roles set up halfway");
    });

    it("marks Apps and Managed identities unknown only when the service principal types failed", () => {
        const failed = computeAzureEasyToMiss(input({ spTypes: null, spTypesFailed: true }));
        for (const id of ["apps", "managedIdentities"]) {
            expect(row(failed, id).count).toBeNull();
            expect(row(failed, id).isUnknown).toBe(true);
        }
        expect(row(failed, "guests").isUnknown).toBeUndefined();
        const loading = computeAzureEasyToMiss(input({ spTypes: null }));
        expect(row(loading, "apps").isUnknown).toBeUndefined();
        expect(row(computeAzureEasyToMiss(input()), "apps").isUnknown).toBeUndefined();
    });

    it("counts deleted accounts as distinct principals, and leaves a deleted group out of the accounts", () => {
        const withDeleted = new Map([...spTypes, ["u-bob", DELETED_PRINCIPAL], ["u-mi1", DELETED_PRINCIPAL], ["u-grp1", DELETED_PRINCIPAL]]);
        const rows = computeAzureEasyToMiss(input({ spTypes: withDeleted }));
        expect(row(rows, "deleted").count).toBe(3);
        expect(row(rows, "deleted").detail).toBe("Not found in Microsoft Entra ID. The role stays until it is removed.");
        expect(row(rows, "deleted").category).toBe("Accounts you may not expect");
        expect(row(rows, "managedIdentities").count).toBe(0);
        const accounts = computeAzureAccounts(input({ scope: "all", spTypes: withDeleted }), 20);
        expect(accounts.find((r) => r.id === "u-bob")?.tags).toContain("deleted");
        expect(accounts.some((r) => r.id === "u-grp1")).toBe(false);
        expect(computeAzureHasAccess(input({ spTypes: withDeleted })).groupsHoldingRoles).toBe(computeAzureHasAccess(input()).groupsHoldingRoles);
    });

    it("marks Deleted unknown when the users and groups could not be checked, and waits while the reads run", () => {
        const unchecked = row(computeAzureEasyToMiss(input({ isDeletedUnknown: true })), "deleted");
        expect(unchecked).toMatchObject({ count: null, isUnknown: true, detail: "Could not check which accounts still exist." });
        expect(row(computeAzureEasyToMiss(input({ spTypes: null, spTypesFailed: true })), "deleted").isUnknown).toBe(true);
        const loading = row(computeAzureEasyToMiss(input({ spTypes: null })), "deleted");
        expect(loading.count).toBeNull();
        expect(loading.isUnknown).toBeUndefined();
    });

    it("cannot tell apps from managed identities without the service principal types", () => {
        const rows = computeAzureEasyToMiss(input({ spTypes: null }));
        for (const id of ["apps", "managedIdentities"]) {
            expect(row(rows, id).count).toBeNull();
            expect(row(rows, id).detail).toBe("Could not tell apps from managed identities. 2 together, always active.");
        }
    });

    it("waits for the settings of Nobody is notified", () => {
        expect(row(computeAzureEasyToMiss(input({ settings: settingsBefore })), "nobodyNotified").count).toBeNull();
    });

    it("says None for a row with 0", () => {
        const rows = computeAzureEasyToMiss(input({ assignments: [assignments[3]] }));
        expect(row(rows, "guests")).toMatchObject({ count: 0, detail: "None" });
        expect(row(rows, "permanentOwners")).toMatchObject({ count: 0, detail: "None" });
    });
});

describe("computeAzureHasAccess", () => {
    it("counts privileged roles per level", () => {
        expect(computeAzureHasAccess(input())).toEqual({
            rows: [
                { label: "Management group", permanent: 2, eligible: 0, activeTimeBound: 0, total: 2 },
                { label: "Subscription", permanent: 3, eligible: 3, activeTimeBound: 1, total: 7 },
                { label: "Resource group", permanent: 1, eligible: 0, activeTimeBound: 0, total: 1 },
                { label: "Resource", permanent: 2, eligible: 0, activeTimeBound: 0, total: 2 },
            ],
            direct: 11,
            viaGroup: 1,
            groupsHoldingRoles: 1,
        });
    });

    it("counts all roles when asked", () => {
        expect(computeAzureHasAccess(input({ scope: "all" }))).toEqual({
            rows: [
                { label: "Management group", permanent: 2, eligible: 0, activeTimeBound: 0, total: 2 },
                { label: "Subscription", permanent: 3, eligible: 3, activeTimeBound: 2, total: 8 },
                { label: "Resource group", permanent: 1, eligible: 1, activeTimeBound: 0, total: 2 },
                { label: "Resource", permanent: 2, eligible: 1, activeTimeBound: 0, total: 3 },
            ],
            direct: 14,
            viaGroup: 1,
            groupsHoldingRoles: 1,
        });
    });
});

describe("computeAzureActivation", () => {
    it("counts the privileged role × scope", () => {
        expect(computeAzureActivation(input())).toEqual({
            roleCount: 6,
            entraMfa: 2,
            authContext: 1,
            neither: 1,
            approvalRequired: 1,
            approvalNotRequired: 3,
            justificationRequired: 1,
            justificationNotRequired: 3,
            durations: { upTo1h: 0, upTo4h: 2, upTo8h: 1, upTo12h: 1, over12h: 0 },
            unloaded: 1,
            notReadable: 1,
        });
    });

    it("counts all role × scope when asked", () => {
        expect(computeAzureActivation(input({ scope: "all" }))).toEqual({
            roleCount: 9,
            entraMfa: 3,
            authContext: 1,
            neither: 1,
            approvalRequired: 2,
            approvalNotRequired: 3,
            justificationRequired: 1,
            justificationNotRequired: 4,
            durations: { upTo1h: 0, upTo4h: 2, upTo8h: 1, upTo12h: 2, over12h: 0 },
            unloaded: 3,
            notReadable: 1,
        });
    });
});

describe("computeAzureAccounts", () => {
    it("ranks by the distinct privileged roles held and fills the tags", () => {
        const rows = computeAzureAccounts(input());
        expect(rows.map((r) => r.name)).toEqual(["Alice", "App One", "Break Glass", "Erin", "Grace", "Henk"]);
        expect(rows[0]).toEqual({ id: "u-alice", name: "Alice", kind: "user", isEmergency: false, privilegedRoles: 2, permanent: 1, eligible: 1, tags: [] });
        expect(rows[1]).toMatchObject({ kind: "servicePrincipal", privilegedRoles: 1, permanent: 1, tags: ["app"] });
        expect(rows[2]).toMatchObject({ isEmergency: true, tags: ["emergency"] });
        expect(rows[5]).toMatchObject({ tags: ["delegated"] });
    });

    it("lists the rest with the guest, managed identity and the eligible-only accounts last", () => {
        const rows = computeAzureAccounts(input(), 20);
        expect(rows.map((r) => r.name)).toEqual(["Alice", "App One", "Break Glass", "Erin", "Grace", "Henk", "MI One", "Bob", "Carol"]);
        expect(rows[6].tags).toEqual(["managed identity"]);
        expect(rows[7]).toMatchObject({ permanent: 0, eligible: 1 });
        expect(rows[8]).toMatchObject({ kind: "user", tags: ["guest"] });
    });

    it("tags an agent and leaves an unknown service principal untagged", () => {
        const all = computeAzureAccounts(input({ scope: "all", spTypes: null }), 20);
        expect(all.find((r) => r.name === "Agent One")).toMatchObject({ kind: "agentIdentity", tags: ["agent"] });
        expect(all.find((r) => r.name === "App One")?.tags).toEqual([]);
    });
});

describe("computeAzureApprovers", () => {
    it("reads the approvers of the privileged roles that require approval", () => {
        expect(computeAzureApprovers(input())).toEqual({
            approvers: [
                { id: `user:${ANN}`, name: "Ann", isGroup: false, roleCount: 1 },
                { id: `group:${GROUP_APPROVER}`, name: "Security Approvers", isGroup: true, roleCount: 1 },
            ],
            singleApproverRoles: [],
            requiringApproval: 1,
        });
    });

    it("names an approver without a description from the start of the id, and lists single approvers with the scope", () => {
        const summary = computeAzureApprovers(input({ scope: "all" }));
        expect(summary.requiringApproval).toBe(2);
        expect(summary.approvers.map((r) => r.name)).toEqual(["Ann", "Security Approvers", "Unknown (44444444)"]);
        expect(summary.singleApproverRoles).toEqual([{ role: "Reader · Prod Sub", approver: "Unknown (44444444)" }]);
    });
});

describe("computeAzureRightNow", () => {
    it("lists activations and eligibilities that end within 7 days, with the scope name", () => {
        expect(computeAzureRightNow(input())).toEqual({
            activated: [{ who: "Bob", what: "Owner · Prod Sub", msLeft: 2 * 3600000, principalId: "u-bob" }],
            activatedCount: 1,
            ending: [{ who: "Carol", what: "Contributor · Prod Sub", msLeft: 3 * 24 * 3600000, principalId: "u-carol" }],
            endingCount: 1,
        });
    });

    it("falls back to the last path segment when the scope is unknown, and limits the rows", () => {
        const rows = [
            a("x1", "/subscriptions/zz", OWNER, "Owner", "u-1", "One", { endDateTime: inHours(3), isActivated: true }),
            a("x2", S1, OWNER, "Owner", "u-2", "Two", { endDateTime: inHours(1), isActivated: true }),
            a("x3", S1, OWNER, "Owner", "u-3", "Three", { endDateTime: inHours(-1), isActivated: true }),
        ];
        const result = computeAzureRightNow(input({ assignments: rows }), 1);
        expect(result.activatedCount).toBe(2);
        expect(result.activated).toHaveLength(1);
        expect(result.activated[0].who).toBe("Two");
        const unknown = computeAzureRightNow(input({ assignments: [rows[0]] }));
        expect(unknown.activated[0].what).toBe("Owner · zz");
    });
});
