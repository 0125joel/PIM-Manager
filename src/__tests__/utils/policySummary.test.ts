import { describe, it, expect } from "vitest";
import { summarizePolicyRules } from "@/utils/policySummary";
import type { PimPolicyRule } from "@/types/directoryRole.types";

const target = { caller: "EndUser", operations: ["All"], level: "Assignment" };
const rule = (type: string, extra: Partial<PimPolicyRule>): PimPolicyRule =>
    ({ id: `${type}_EndUser_Assignment`, "@odata.type": `#microsoft.graph.unifiedRoleManagementPolicy${type}Rule`, target, ...extra }) as PimPolicyRule;

describe("summarizePolicyRules", () => {
    it("is not loaded without rules", () => {
        expect(summarizePolicyRules(null)).toEqual({ isLoaded: false });
        expect(summarizePolicyRules(undefined)).toEqual({ isLoaded: false });
    });

    it("reads approval, MFA, justification and the maximum duration of the end user rules", () => {
        const summary = summarizePolicyRules([
            rule("Approval", { setting: { isApprovalRequired: true } as PimPolicyRule["setting"] }),
            rule("Enablement", { enabledRules: ["MultiFactorAuthentication", "Justification"] }),
            rule("Expiration", { maximumDuration: "PT8H" }),
        ]);
        expect(summary).toMatchObject({ isLoaded: true, isApprovalRequired: true, hasPimMfa: true, hasAuthContext: false, isJustificationRequired: true, maxDuration: "PT8H", hasCustomExtension: false });
        expect(summary.activationNotification).toBeUndefined();
    });

    it("counts an authentication context only when it is enabled and has a claim", () => {
        expect(summarizePolicyRules([rule("AuthenticationContext", { isEnabled: true, claimValue: "c1" })])).toMatchObject({ hasAuthContext: true, contextId: "c1" });
        expect(summarizePolicyRules([rule("AuthenticationContext", { isEnabled: false, claimValue: "c1" })]).hasAuthContext).toBe(false);
        expect(summarizePolicyRules([rule("AuthenticationContext", { isEnabled: true })]).hasAuthContext).toBe(false);
    });

    it("ignores rules of other callers", () => {
        const adminRule = { ...rule("Expiration", { maximumDuration: "PT1H" }), target: { ...target, caller: "Admin" } } as PimPolicyRule;
        expect(summarizePolicyRules([adminRule]).maxDuration).toBeUndefined();
    });

    it("reads the activation notification rule and leaves it undefined when the rule is absent", () => {
        const notification = { id: "Notification_Admin_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target, isDefaultRecipientsEnabled: false, notificationRecipients: [] } as unknown as PimPolicyRule;
        expect(summarizePolicyRules([notification]).activationNotification).toEqual({ isDefaultRecipientsEnabled: false, notificationRecipients: [] });
        expect(summarizePolicyRules([rule("Expiration", {})]).activationNotification).toBeUndefined();
    });
});
