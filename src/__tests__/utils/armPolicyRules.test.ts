import { describe, expect, it } from "vitest";
import type { ArmPolicyRule, ArmRoleManagementPolicy } from "@/types/azureResource.types";
import { graphRulesOf, parseArmPolicy, rulesInForce, toGraphRule } from "@/utils/armPolicyRules";
import fixture from "@/__tests__/fixtures/azure/subscription-owner-policy.json";

/**
 * Azure role settings into `PolicySettings` (Azure spec 6): the 17 rules of the Owner policy measured in the spike, the
 * approver shape of ARM, and `effectiveRules` over `rules`.
 */

const OWNER = fixture.value[0] as unknown as ArmRoleManagementPolicy;

/** The Owner policy with some rules replaced, in both lists */
function withRules(replace: Record<string, Partial<ArmPolicyRule>>): ArmRoleManagementPolicy {
    const change = (rules: ArmPolicyRule[]) => rules.map((r) => (replace[r.id] ? { ...r, ...replace[r.id] } : r));
    return { ...OWNER, properties: { ...OWNER.properties, rules: change(OWNER.properties.rules), effectiveRules: change(OWNER.properties.effectiveRules ?? []) } };
}

describe("parseArmPolicy", () => {
    it("reads the 17 rules of the Owner policy from the spike", () => {
        expect(rulesInForce(OWNER)).toHaveLength(17);
        expect(parseArmPolicy(OWNER)).toEqual({
            maxActivationDuration: "PT8H",
            activationRequirement: "none",
            authenticationContextId: undefined,
            requireJustificationOnActivation: true,
            requireTicketInfo: false,
            requireApproval: false,
            approvers: [],
            customExtensions: undefined,
            allowPermanentEligible: false,
            eligibleExpiration: "P1Y",
            allowPermanentActive: false,
            activeExpiration: "P180D",
            requireMfaOnActiveAssignment: false,
            requireJustificationOnActiveAssignment: true,
            notifications: {
                eligibleAssignment: {
                    admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    assignee: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                },
                activeAssignment: {
                    admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    assignee: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                },
                activation: {
                    admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    requestor: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                    approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
                },
            },
            activationNotification: { isDefaultRecipientsEnabled: true, notificationRecipients: [] },
        });
    });

    it("reads MFA, ticket, approval with a user and a group, and permanent assignments", () => {
        const settings = parseArmPolicy(withRules({
            Enablement_EndUser_Assignment: { enabledRules: ["MultiFactorAuthentication", "Justification", "Ticketing"] },
            Approval_EndUser_Assignment: {
                setting: {
                    approvalMode: "SingleStage",
                    isApprovalRequired: true,
                    approvalStages: [{
                        approvalStageTimeOutInDays: 1,
                        isApproverJustificationRequired: true,
                        primaryApprovers: [
                            { id: "u1", description: "Megan Bowen", isBackup: false, userType: "User" },
                            { id: "g1", description: "Security Leads", isBackup: false, userType: "Group" },
                        ],
                    }],
                },
            },
            Expiration_Admin_Eligibility: { isExpirationRequired: false, maximumDuration: "P90D" },
            Expiration_Admin_Assignment: { isExpirationRequired: false },
            Enablement_Admin_Assignment: { enabledRules: ["MultiFactorAuthentication"] },
            Expiration_EndUser_Assignment: { maximumDuration: "PT4H" },
        }));
        expect(settings).toMatchObject({
            maxActivationDuration: "PT4H",
            activationRequirement: "mfa",
            requireJustificationOnActivation: true,
            requireTicketInfo: true,
            requireApproval: true,
            approvers: [
                { id: "u1", type: "user", displayName: "Megan Bowen" },
                { id: "g1", type: "group", displayName: "Security Leads" },
            ],
            allowPermanentEligible: true,
            eligibleExpiration: "P90D",
            allowPermanentActive: true,
            requireMfaOnActiveAssignment: true,
            requireJustificationOnActiveAssignment: false,
        });
    });

    it("reads an authentication context over MFA", () => {
        const settings = parseArmPolicy(withRules({
            AuthenticationContext_EndUser_Assignment: { isEnabled: true, claimValue: "c1" },
            Enablement_EndUser_Assignment: { enabledRules: ["MultiFactorAuthentication"] },
        }));
        expect(settings.activationRequirement).toBe("authenticationContext");
        expect(settings.authenticationContextId).toBe("c1");
    });

    it("reads a notification rule by caller, level and recipient", () => {
        const settings = parseArmPolicy(withRules({
            Notification_Admin_EndUser_Assignment: { isDefaultRecipientsEnabled: false, notificationLevel: "Critical", notificationRecipients: ["soc@contoso.com"] },
        }));
        expect(settings.notifications.activation.admin).toEqual({ isEnabled: false, additionalRecipients: "soc@contoso.com", criticalOnly: true });
        expect(settings.activationNotification).toEqual({ isDefaultRecipientsEnabled: false, notificationRecipients: ["soc@contoso.com"] });
        expect(settings.notifications.activation.requestor.isEnabled).toBe(true);
    });
});

describe("rulesInForce", () => {
    it("takes effectiveRules over rules", () => {
        const policy = withRules({});
        policy.properties.effectiveRules = policy.properties.effectiveRules!.map((r) => (r.id === "Expiration_EndUser_Assignment" ? { ...r, maximumDuration: "PT2H" } : r));
        expect(parseArmPolicy(policy).maxActivationDuration).toBe("PT2H");
    });

    it("falls back to rules when effectiveRules is null or empty", () => {
        for (const effectiveRules of [null, []]) {
            const policy: ArmRoleManagementPolicy = { ...OWNER, properties: { ...OWNER.properties, effectiveRules } };
            expect(rulesInForce(policy)).toBe(OWNER.properties.rules);
            expect(parseArmPolicy(policy).maxActivationDuration).toBe("PT8H");
        }
    });
});

describe("toGraphRule", () => {
    it("turns ruleType into the Graph type and keeps the other fields", () => {
        const rule = OWNER.properties.rules.find((r) => r.id === "Expiration_Admin_Eligibility")!;
        expect(toGraphRule(rule)).toMatchObject({
            "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
            id: "Expiration_Admin_Eligibility",
            isExpirationRequired: true,
            maximumDuration: "P365D",
        });
    });

    it("gives every rule type of the spike a Graph type the parser knows", () => {
        const types = new Set(OWNER.properties.rules.map((r) => toGraphRule(r)["@odata.type"]));
        expect([...types].sort()).toEqual([
            "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
            "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule",
            "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule",
            "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
            "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule",
        ]);
    });
});

describe("graphRulesOf", () => {
    it("gives the rules in force in the Graph shape, one per ARM rule", () => {
        const rules = graphRulesOf(OWNER);
        expect(rules).toHaveLength(rulesInForce(OWNER).length);
        expect(rules.every((rule) => String(rule["@odata.type"]).startsWith("#microsoft.graph.unifiedRoleManagementPolicy"))).toBe(true);
    });
});
