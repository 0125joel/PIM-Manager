import { describe, expect, it } from "vitest";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import { azurePolicyKey } from "@/utils/azureScopes";
import { buildAzureTips, type AzureTipInput } from "@/utils/azureTipRules";

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const CONTRIB = "b24988ac-6180-42a0-ab88-20f7382dd24c";

const MG = "/providers/Microsoft.Management/managementGroups/mg1";
const S1 = "/subscriptions/s1";
const S2 = "/subscriptions/s2";
const S3 = "/subscriptions/s3";
const RG = "/subscriptions/s1/resourceGroups/rg1";

const scopes: AzureScope[] = [
    { id: MG, name: "MG", level: "managementGroup", parentId: null },
    { id: S1, name: "S1", level: "subscription", parentId: MG },
    { id: S2, name: "S2", level: "subscription", parentId: MG },
    { id: S3, name: "S3", level: "subscription", parentId: MG },
    { id: RG, name: "rg1", level: "resourceGroup", parentId: S1 },
];

function a(id: string, scopeId: string, roleDefinitionId: string, over: Partial<AzureAssignment> = {}): AzureAssignment {
    return { id, scopeId, roleDefinitionId, roleName: id, principalId: `p-${id}`, principalName: id, principalType: "User", state: "active", memberType: "direct", endDateTime: null, ...over };
}

function policy(isApprovalRequired: boolean): AzureSettingsOutcome {
    const caller = { caller: "EndUser" };
    return {
        status: "loaded",
        rules: [
            { id: "Approval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule", target: caller, setting: { isApprovalRequired, approvalStages: [{ primaryApprovers: [] }] } },
            { id: "Enablement_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule", target: caller, enabledRules: [] },
            { id: "Expiration_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: caller, maximumDuration: "PT8H" },
        ],
    };
}

function input(over: Partial<AzureTipInput> = {}): AzureTipInput {
    return { counted: [], settings: new Map(), scopes, definitions: null, emergencyIds: new Set(), ...over };
}

const ids = (tips: ReturnType<typeof buildAzureTips>) => tips.map((t) => t.id);

describe("buildAzureTips", () => {
    it("gives only the general tips when there is nothing to say about the tenant", () => {
        const tips = buildAzureTips(input());
        expect(ids(tips)).toEqual(["general-settings", "general-apps"]);
        expect(tips.every((t) => t.source === "general")).toBe(true);
        expect(tips[0]).toMatchObject({ title: "Settings do not inherit", action: { label: "Open the Report", href: "/azure/report" } });
        expect(tips[1]).toMatchObject({ title: "Apps cannot be eligible", action: { kind: "link", label: "Read more", href: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-resource-roles-assign-roles" } });
    });

    it("counts the subscriptions where Owner activates without approval, in the plural", () => {
        const counted = [a("o1", S1, OWNER, { state: "eligible" }), a("o2", S2, OWNER, { state: "eligible" }), a("o3", S3, OWNER, { state: "eligible" })];
        const settings = new Map<string, AzureSettingsOutcome>([
            [azurePolicyKey(S1, OWNER), policy(false)],
            [azurePolicyKey(S2, OWNER), policy(false)],
            [azurePolicyKey(S3, OWNER), policy(true)],
        ]);
        const tips = buildAzureTips(input({ counted, settings }));
        expect(tips[0]).toMatchObject({
            id: "ownerNoApproval",
            source: "tenant",
            title: "Owner activates without approval on 2 subscriptions",
            text: "Role settings are per role and per scope in Azure: a rule on a management group does not reach the subscriptions below it.",
            action: { kind: "filter", label: "Show the 2 subscriptions", filter: { role: OWNER, approval: "notRequired", level: "subscription" } },
        });
    });

    it("says subscription in the singular for one", () => {
        const counted = [a("o1", S1, OWNER, { state: "eligible" }), a("o1b", S1, OWNER)];
        const settings = new Map<string, AzureSettingsOutcome>([[azurePolicyKey(S1, OWNER), policy(false)]]);
        const tip = buildAzureTips(input({ counted, settings }))[0];
        expect(tip.title).toBe("Owner activates without approval on 1 subscription");
        expect(tip.action.label).toBe("Show the 1 subscription");
    });

    it("leaves the tip out when the settings are not loaded, require approval, or the Owner is not on a subscription", () => {
        const counted = [a("o1", S1, OWNER), a("o2", MG, OWNER), a("o3", RG, OWNER), a("c1", S2, CONTRIB)];
        expect(ids(buildAzureTips(input({ counted })))).not.toContain("ownerNoApproval");
        const failed = new Map<string, AzureSettingsOutcome>([[azurePolicyKey(S1, OWNER), { status: "failed" }], [azurePolicyKey(MG, OWNER), policy(false)], [azurePolicyKey(S2, CONTRIB), policy(false)]]);
        expect(ids(buildAzureTips(input({ counted, settings: failed })))).not.toContain("ownerNoApproval");
        const required = new Map<string, AzureSettingsOutcome>([[azurePolicyKey(S1, OWNER), policy(true)]]);
        expect(ids(buildAzureTips(input({ counted, settings: required })))).not.toContain("ownerNoApproval");
    });

    it("counts the permanent Owners outside emergency access", () => {
        const counted = [
            a("o1", S1, OWNER),
            a("o2", MG, OWNER),
            a("bg", S2, OWNER),
            a("eligible", S3, OWNER, { state: "eligible" }),
            a("timebound", S3, OWNER, { endDateTime: "2026-12-01T00:00:00Z" }),
            a("contrib", S3, CONTRIB),
        ];
        const tips = buildAzureTips(input({ counted, emergencyIds: new Set(["p-bg"]) }));
        expect(tips[0]).toMatchObject({
            id: "permanentOwners",
            source: "tenant",
            title: "2 permanent Owner assignments",
            text: "Make them eligible so they need an activation.",
            action: { kind: "filter", label: "Show these 2 assignments", filter: { status: "active", ends: "permanent", role: OWNER, excludeEmergency: true } },
        });
    });

    it("says assignment in the singular for one, and drops the tip at zero", () => {
        expect(buildAzureTips(input({ counted: [a("o1", S1, OWNER)] }))[0]).toMatchObject({ title: "1 permanent Owner assignment", action: { label: "Show this assignment" } });
        expect(ids(buildAzureTips(input({ counted: [a("o1", S1, OWNER)], emergencyIds: new Set(["p-o1"]) })))).toEqual(["general-settings", "general-apps"]);
    });

    it("puts the tenant tips before the general ones", () => {
        const counted = [a("o1", S1, OWNER)];
        const settings = new Map<string, AzureSettingsOutcome>([[azurePolicyKey(S1, OWNER), policy(false)]]);
        expect(ids(buildAzureTips(input({ counted, settings })))).toEqual(["ownerNoApproval", "permanentOwners", "general-settings", "general-apps"]);
    });
});
