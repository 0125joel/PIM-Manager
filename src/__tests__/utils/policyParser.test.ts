import { describe, expect, it } from "vitest";
import { parseGraphPolicy } from "@/utils/policyParser";
import { CUSTOM_EXTENSION_RULE_IDS, CUSTOM_EXTENSION_RULE_TYPE } from "@/config/constants";

const endUserTarget = { caller: "EndUser", operations: ["All"], level: "Assignment", inheritableSettings: [], enforcedSettings: [] };

const baseRules = [
    {
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
        id: "Expiration_EndUser_Assignment",
        isExpirationRequired: true,
        maximumDuration: "PT4H",
        target: endUserTarget,
    },
    {
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule",
        id: "Enablement_EndUser_Assignment",
        enabledRules: ["Justification"],
        target: endUserTarget,
    },
    {
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
        id: "Approval_EndUser_Assignment",
        setting: { isApprovalRequired: false, approvalStages: [] },
        target: endUserTarget,
    },
];

describe("parseGraphPolicy custom extensions", () => {
    it("leaves customExtensions undefined when the policy has no preview slots", () => {
        const policy = parseGraphPolicy({ rules: baseRules });
        expect(policy.customExtensions).toBeUndefined();
        expect(policy.maxActivationDuration).toBe("PT4H");
        expect(policy.requireJustificationOnActivation).toBe(true);
    });

    it("leaves customExtensions undefined when both slots are unlinked", () => {
        const rules = [
            ...baseRules,
            { "@odata.type": CUSTOM_EXTENSION_RULE_TYPE, id: CUSTOM_EXTENSION_RULE_IDS.preApproval, isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [], target: endUserTarget },
            { "@odata.type": CUSTOM_EXTENSION_RULE_TYPE, id: CUSTOM_EXTENSION_RULE_IDS.postApproval, isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [], target: endUserTarget },
        ];
        expect(parseGraphPolicy({ rules }).customExtensions).toBeUndefined();
    });

    it("exposes a linked pre-approval slot with its name and attributes", () => {
        const rules = [
            ...baseRules,
            { "@odata.type": CUSTOM_EXTENSION_RULE_TYPE, id: CUSTOM_EXTENSION_RULE_IDS.preApproval, isEnabled: true, customExtensionId: "a05c9349-5950-4884-bab4-7fb6aa3e4ff5", displayName: "Outside office hours", customAttributes: ["reservedNotUsed"], target: endUserTarget },
            { "@odata.type": CUSTOM_EXTENSION_RULE_TYPE, id: CUSTOM_EXTENSION_RULE_IDS.postApproval, isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [], target: endUserTarget },
        ];
        const policy = parseGraphPolicy({ rules });
        expect(policy.customExtensions).toEqual({
            preApproval: {
                isEnabled: true,
                customExtensionId: "a05c9349-5950-4884-bab4-7fb6aa3e4ff5",
                displayName: "Outside office hours",
                customAttributes: ["reservedNotUsed"],
            },
        });
    });
});

describe("parseGraphPolicy activation notification rule", () => {
    const notificationRule = (overrides: Record<string, unknown>) => ({
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule",
        id: "Notification_Admin_EndUser_Assignment",
        notificationType: "Email",
        recipientType: "Admin",
        notificationLevel: "All",
        isDefaultRecipientsEnabled: true,
        notificationRecipients: [],
        target: endUserTarget,
        ...overrides,
    });

    it("is undefined when the policy has no such rule", () => {
        expect(parseGraphPolicy({ rules: baseRules }).activationNotification).toBeUndefined();
    });

    it("reads the default recipients flag and the extra recipients", () => {
        const policy = parseGraphPolicy({ rules: [...baseRules, notificationRule({ isDefaultRecipientsEnabled: false, notificationRecipients: ["soc@contoso.com"] })] });
        expect(policy.activationNotification).toEqual({ isDefaultRecipientsEnabled: false, notificationRecipients: ["soc@contoso.com"] });
    });

    it("represents 'nobody is notified' as defaults off with an empty list", () => {
        const policy = parseGraphPolicy({ rules: [...baseRules, notificationRule({ isDefaultRecipientsEnabled: false })] });
        expect(policy.activationNotification).toEqual({ isDefaultRecipientsEnabled: false, notificationRecipients: [] });
    });

    it("ignores the requestor and approver activation rules", () => {
        const policy = parseGraphPolicy({ rules: [...baseRules, notificationRule({ id: "Notification_Requestor_EndUser_Assignment", recipientType: "Requestor", isDefaultRecipientsEnabled: false })] });
        expect(policy.activationNotification).toBeUndefined();
    });
});

describe("parseGraphPolicy on the rules of a PIM for Groups policy", () => {
    // Group policies come without a target (lessons-learned, Report run 2026-10-02): the caller and level are in the rule id
    const T = "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule";
    const notification = (id: string, extra: Record<string, unknown> = {}) => ({ "@odata.type": T, id, notificationType: "Email", recipientType: id.split("_")[1], notificationLevel: "All", isDefaultRecipientsEnabled: true, notificationRecipients: ["ops@contoso.com"], ...extra });

    it("sorts the notification rules by the caller and level in the rule id", () => {
        const settings = parseGraphPolicy({
            rules: [
                notification("Notification_Admin_Admin_Eligibility"),
                notification("Notification_Requestor_Admin_Assignment", { notificationLevel: "Critical" }),
                notification("Notification_Requestor_EndUser_Assignment"),
            ],
        });
        expect(settings.notifications.eligibleAssignment.admin.additionalRecipients).toBe("ops@contoso.com");
        expect(settings.notifications.activeAssignment.assignee.criticalOnly).toBe(true);
        expect(settings.notifications.activation.requestor.isEnabled).toBe(true);
    });

    it("does not throw on a rule without recipients or a recipient type", () => {
        expect(() => parseGraphPolicy({ rules: [notification("Notification_Approver_EndUser_Assignment", { recipientType: undefined, notificationRecipients: undefined })] })).not.toThrow();
    });
});
