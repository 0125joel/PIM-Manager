import type { PimPolicyRule } from "@/types/directoryRole.types";
import type { ActivationNotificationRule } from "@/types/wizard.types";
import { parseCustomExtensionRules } from "@/utils/customExtensionUtils";

/**
 * What the dashboard and the report need from one directory role policy, parsed once.
 * Only the end user (activation) rules count. An empty summary means no policy rules are loaded.
 */
export interface PolicySummary {
    /** The role has a loaded policy with rules. A role whose policy failed to load or is still loading is not loaded. */
    isLoaded: boolean;
    isApprovalRequired?: boolean;
    hasCustomExtension?: boolean;
    hasPimMfa?: boolean;
    hasAuthContext?: boolean;
    contextId?: string;
    isJustificationRequired?: boolean;
    /** ISO 8601 maximum activation duration */
    maxDuration?: string;
    /** The Notification_Admin_EndUser_Assignment rule, undefined when the policy has no such rule */
    activationNotification?: ActivationNotificationRule;
}

const RULE_TYPE = "#microsoft.graph.unifiedRoleManagementPolicy";

function findEndUserRule(rules: PimPolicyRule[], ruleType: string): PimPolicyRule | undefined {
    return rules.find((r) => r["@odata.type"] === `${RULE_TYPE}${ruleType}` && r.target?.caller === "EndUser");
}

export function summarizePolicyRules(rules: PimPolicyRule[] | null | undefined): PolicySummary {
    if (!rules) return { isLoaded: false };

    const approvalRule = findEndUserRule(rules, "ApprovalRule");
    const enablementRule = findEndUserRule(rules, "EnablementRule");
    const authContextRule = findEndUserRule(rules, "AuthenticationContextRule");
    const expirationRule = findEndUserRule(rules, "ExpirationRule");
    const notificationRule = rules.find((r) => r.id === "Notification_Admin_EndUser_Assignment");

    return {
        isLoaded: true,
        isApprovalRequired: approvalRule?.setting?.isApprovalRequired,
        hasCustomExtension: !!parseCustomExtensionRules(rules),
        hasPimMfa: enablementRule?.enabledRules?.includes("MultiFactorAuthentication"),
        hasAuthContext: !!(authContextRule?.isEnabled && authContextRule?.claimValue),
        contextId: authContextRule?.claimValue,
        isJustificationRequired: enablementRule?.enabledRules?.includes("Justification"),
        maxDuration: expirationRule?.maximumDuration,
        activationNotification: notificationRule
            ? {
                  isDefaultRecipientsEnabled: notificationRule.isDefaultRecipientsEnabled === true,
                  notificationRecipients: Array.isArray(notificationRule.notificationRecipients) ? notificationRule.notificationRecipients : [],
              }
            : undefined,
    };
}
