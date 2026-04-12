import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";
import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE, PIM_URLS } from "@/config/constants";
import { RoleSettings, AssignmentSettings, Principal } from "@/types/shared.types";
import {
    parseHours,
    hoursToIso,
    toIsoDuration,
    formatDuration,
    DEFAULT_DURATIONS,
    isoDurationToLabel
} from "@/utils/durationUtils";

export { isoDurationToLabel } from "@/utils/durationUtils";

/**
 * PIM Configuration Service
 * Handles reading and writing PIM policies (Role Configuration) via Microsoft Graph API.
 * Replaces the legacy src/utils/pimApi.ts
 */

// --- Helpers ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @deprecated Use parseHours from durationUtils instead
 */
export const parseIsoDurationToHours = (duration: string | null | undefined): number => {
    return parseHours(duration ?? undefined);
};

/**
 * @deprecated Use hoursToIso from durationUtils instead
 */
export const hoursToIsoDuration = (hours: number): string => hoursToIso(hours);

/**
 * Microsoft PIM Default Settings
 * Used for "Configure from Scratch" (Standard Security)
 */
export const MICROSOFT_PIM_DEFAULTS: RoleSettings = {
    activation: {
        maxDuration: 8, // 8 Hours (PT8H)
        requireMfa: "AzureMFA", // "On activation, require Azure MFA"
        requireJustification: true, // "Require justification on activation"
        requireTicketInfo: false,
        requireApproval: false, // Auto-approve
        approvers: []
    },
    assignment: {
        allowPermanentEligible: true, // "Allow permanent eligible assignment"
        expireEligibleAfter: "1 Year", // "Expire eligible assignment after" (1 Year)
        allowPermanentActive: true, // "Allow permanent active assignment"
        expireActiveAfter: "15 Days", // "Expire active assignment after" (15 Days)
        requireMfaOnActive: true, // "Require Azure MFA on active assignment"
        requireJustificationOnActive: true, // "Require justification on active assignment"
    },
    notification: {
        eligibleAssignment: { admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, assignee: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, approver: { isEnabled: false, additionalRecipients: [], criticalOnly: false } }, // Admin + Assignee
        activeAssignment: { admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, assignee: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, approver: { isEnabled: false, additionalRecipients: [], criticalOnly: false } }, // Admin + Assignee
        eligibleActivation: { admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, requestor: { isEnabled: true, additionalRecipients: [], criticalOnly: false }, approver: { isEnabled: false, additionalRecipients: [], criticalOnly: false } } // Admin + User (Requestor)
    }
};


/**
 * Maps RoleSettings to PolicySettings (for Wizard)
 * Converts from the detailed RoleSettings structure to the simplified PolicySettings
 * used in the wizard state.
 */
export const mapRoleSettingsToPolicy = (rs: RoleSettings): any => {
    return {
        maxActivationDuration: `PT${rs.activation.maxDuration}H`,
        activationRequirement: rs.activation.requireMfa === "AzureMFA" ? "mfa" : rs.activation.requireMfa === "ConditionalAccess" ? "authenticationContext" : "none",
        authenticationContextId: rs.activation.authContextId,
        requireJustificationOnActivation: rs.activation.requireJustification,
        requireTicketInfo: rs.activation.requireTicketInfo,
        requireApproval: rs.activation.requireApproval,
        approvers: rs.activation.approvers.map(a => ({
            id: a.id,
            type: a.type as "user" | "group",
            displayName: a.displayName
        })),
        allowPermanentEligible: rs.assignment.allowPermanentEligible,
        eligibleExpiration: toIsoDuration(rs.assignment.expireEligibleAfter),
        allowPermanentActive: rs.assignment.allowPermanentActive,
        activeExpiration: toIsoDuration(rs.assignment.expireActiveAfter),
        requireMfaOnActiveAssignment: rs.assignment.requireMfaOnActive,
        requireJustificationOnActiveAssignment: rs.assignment.requireJustificationOnActive,
        notifications: {
            eligibleAssignment: {
                admin: { ...rs.notification.eligibleAssignment.admin, additionalRecipients: rs.notification.eligibleAssignment.admin.additionalRecipients.join(";") },
                assignee: { ...rs.notification.eligibleAssignment.assignee, additionalRecipients: rs.notification.eligibleAssignment.assignee.additionalRecipients.join(";") },
                approver: { ...rs.notification.eligibleAssignment.approver, additionalRecipients: rs.notification.eligibleAssignment.approver.additionalRecipients.join(";") }
            },
            activeAssignment: {
                admin: { ...rs.notification.activeAssignment.admin, additionalRecipients: rs.notification.activeAssignment.admin.additionalRecipients.join(";") },
                assignee: { ...rs.notification.activeAssignment.assignee, additionalRecipients: rs.notification.activeAssignment.assignee.additionalRecipients.join(";") },
                approver: { ...rs.notification.activeAssignment.approver, additionalRecipients: rs.notification.activeAssignment.approver.additionalRecipients.join(";") }
            },
            activation: {
                admin: { ...rs.notification.eligibleActivation.admin, additionalRecipients: rs.notification.eligibleActivation.admin.additionalRecipients.join(";") },
                requestor: { ...rs.notification.eligibleActivation.requestor!, additionalRecipients: rs.notification.eligibleActivation.requestor!.additionalRecipients.join(";") },
                approver: { ...rs.notification.eligibleActivation.approver, additionalRecipients: rs.notification.eligibleActivation.approver.additionalRecipients.join(";") }
            }
        }
    };
};


// Start Type Definitions for Graph Rules
// Using specific interfaces to avoid 'any'
interface PimRule {
    "@odata.type": string;
    id: string;
    target?: {
        caller: string;
        level: string;
        operations: string[];
        inheritableSettings?: string[];
        enforcedSettings?: string[];
    };
    [key: string]: any; // Allow loose props for complex rules
}

interface ExpirationRule extends PimRule {
    maximumDuration?: string;
    isExpirationRequired?: boolean;
}

interface EnablementRule extends PimRule {
    enabledRules: string[];
}

interface NotificationRuleSettings extends PimRule {
    notificationType: string;
    recipientType?: string[];
    additionalRecipients?: string[];
    isDefaultRecipientsEnabled?: boolean;
}

interface ApprovalRule extends PimRule {
    setting?: {
        isApprovalRequired?: boolean;
        approvalStages?: any[];
        primaryApprovers?: any[];
    }
}

// --- Service Functions ---

/**
 * Checks if a rule matches a specific target (Caller/Level)
 */
const isTarget = (rule: PimRule, caller: string, level: string, operations?: string[]): boolean => {
    // Check Caller and Level
    if (rule.target?.caller !== caller || rule.target?.level !== level) return false;

    // Check Operations if specified (default to skipping check if null/undefined)
    // If we passed "All" explicitly (old default behavior), we treat it as "Expect All or Strict Match"
    // But since we want to be permissive, we only filter if operations is NON-EMPTY and NOT "All"
    if (operations && operations.length > 0 && !operations.includes("All")) {
        return rule.target?.operations?.some((op: string) => operations.includes(op)) || false;
    }

    return true;
};

/**
 * Retrieves the effective PIM policy for a Directory Role
 */
export async function getRolePolicy(client: Client, roleId: string): Promise<{ settings: RoleSettings, policyId: string, rules: PimRule[] } | null> {
    try {
        // Fetch assignments to find the policy ID
        // Api: /policies/roleManagementPolicyAssignments
        // IMPORTANT: Use v1.0 for Directory Roles (not beta) to ensure schema consistency
        const assignments = await withRetry(() =>
            client.api(PIM_URLS.roleManagementPolicyAssignments)
                .version("v1.0")
                .header("Accept-Language", GRAPH_LOCALE)
                .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
                .expand("policy($expand=rules)")
                .get()
        );

        if (!assignments.value || assignments.value.length === 0) {
            Logger.warn("pimConfiguration", `No policy assignment found for role ${roleId}`);
            return null;
        }

        const policy = assignments.value[0].policy;
        if (!policy) {
            Logger.warn("pimConfiguration", `Policy not found in assignment for role ${roleId}`);
            return null;
        }

        const rules: PimRule[] = policy.rules || [];

        // Use extracted parsing logic
        const { settings, approvalRule } = parseRulesToSettings(rules);

        // Fetch approvers if needed
        if (approvalRule && approvalRule.setting) {
            const stage = approvalRule.setting.approvalStages?.[0];
            const approvers = stage ? (stage.primaryApprovers || []) : (approvalRule.setting.primaryApprovers || []);

            settings.activation.approvers = await fetchApproverDetails(client, approvers);
        }

        return { settings, policyId: policy.id, rules };

    } catch (error) {
        Logger.error("pimConfiguration", `Failed to fetch policy for role ${roleId}`, error);
        return null;
    }
}

/**
 * Parses raw Graph rules into RoleSettings
 */
export function parseRulesToSettings(rules: PimRule[], explicitApprovers?: Principal[]): { settings: RoleSettings, approvalRule: ApprovalRule | null } {
    // Initialize default settings
    const settings: RoleSettings = {
        activation: {
            maxDuration: 8,
            requireMfa: "None",
            requireJustification: false,
            requireTicketInfo: false,
            requireApproval: false,
            approvers: explicitApprovers || []
        },
        assignment: {
            allowPermanentEligible: false,
            expireEligibleAfter: "1 Year",
            allowPermanentActive: false,
            expireActiveAfter: "1 Year",
            requireMfaOnActive: false,
            requireJustificationOnActive: false
        },
        notification: {
            eligibleAssignment: {
                admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                assignee: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                approver: { isEnabled: true, additionalRecipients: [], criticalOnly: false }
            },
            activeAssignment: {
                admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                assignee: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                approver: { isEnabled: true, additionalRecipients: [], criticalOnly: false }
            },
            eligibleActivation: {
                admin: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                requestor: { isEnabled: true, additionalRecipients: [], criticalOnly: false },
                approver: { isEnabled: true, additionalRecipients: [], criticalOnly: false }
            }
        }
    };

    let approvalRule: ApprovalRule | null = null;

    // Parse rules
    for (const rule of rules) {

        // --- Activation Rules (EndUser_Assignment) ---
        if (isTarget(rule, "EndUser", "Assignment")) {

            // Expiration
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
                const expRule = rule as ExpirationRule;
                if (expRule.maximumDuration) {
                    settings.activation.maxDuration = parseIsoDurationToHours(expRule.maximumDuration);
                }
            }

            // Auth Context
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
                if (rule.isEnabled) {
                    settings.activation.requireMfa = "ConditionalAccess";
                    settings.activation.authContextId = rule.claimValue;
                }
            }

            // Approval
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
                const appRule = rule as ApprovalRule;
                if (appRule.setting?.isApprovalRequired) {
                    settings.activation.requireApproval = true;
                    approvalRule = JSON.parse(JSON.stringify(rule));
                }
            }

            // Notification
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
                const notRule = rule as NotificationRuleSettings;
                if (notRule.notificationType === "Email") {
                    Logger.debug("PimConfig", "Parsing Email Notification Rule:", notRule);

                    // Defensive coding: Ensure recipients is always an array
                    // Beta API sometimes returns 'notificationRecipients' or a single string for 'recipientType'
                    let rawRecipients = notRule.recipientType || (notRule as any).notificationRecipients || [];

                    if (!Array.isArray(rawRecipients)) {
                        // If it's a string (e.g. "Admin"), wrap it
                        if (typeof rawRecipients === 'string') {
                            rawRecipients = [rawRecipients];
                        } else {
                            // Unknown type, log and fallback
                            Logger.warn("PimConfig", "Unexpected recipientType format:", rawRecipients);
                            rawRecipients = [];
                        }
                    }

                    const recipients: string[] = rawRecipients;

                    // Check for potential conflicts
                    // let hasConflict = false; // Logging removed in extraction to keep pure function clean or pass logger? defaulting to silent

                    if (recipients.some(r => r.toLowerCase() === "admin")) {
                        settings.notification.eligibleActivation.admin = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "requestor")) {
                        settings.notification.eligibleActivation.requestor = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "approver")) {
                        settings.notification.eligibleActivation.approver = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                }
            }

            // Enablement (MFA, Justification)
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
                const enRule = rule as EnablementRule;
                if (settings.activation.requireMfa !== "ConditionalAccess") {
                    settings.activation.requireMfa = enRule.enabledRules.includes("MultiFactorAuthentication") ? "AzureMFA" : "None";
                }
                settings.activation.requireJustification = enRule.enabledRules.includes("Justification");
                settings.activation.requireTicketInfo = enRule.enabledRules.includes("Ticketing");
            }
        }

        // --- Assignment Rules (Admin_Eligibility) ---
        if (isTarget(rule, "Admin", "Eligibility")) {
            // Expiration
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
                const expRule = rule as ExpirationRule;
                settings.assignment.allowPermanentEligible = !expRule.isExpirationRequired;
                settings.assignment.expireEligibleAfter = isoDurationToLabel(expRule.maximumDuration);
            }
            // Notification
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
                const notRule = rule as NotificationRuleSettings;
                if (notRule.notificationType === "Email") {
                    // Defensive coding: Ensure recipients is always an array
                    let rawRecipients = notRule.recipientType || (notRule as any).notificationRecipients || [];

                    if (!Array.isArray(rawRecipients)) {
                        if (typeof rawRecipients === 'string') {
                            rawRecipients = [rawRecipients];
                        } else {
                            rawRecipients = [];
                        }
                    }
                    const recipients: string[] = rawRecipients;

                    if (recipients.some(r => r.toLowerCase() === "admin")) {
                        settings.notification.eligibleAssignment.admin = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "requestor")) {
                        // Maps to 'assignee' for assignment policies
                        settings.notification.eligibleAssignment.assignee = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "approver")) {
                        settings.notification.eligibleAssignment.approver = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                }
            }
        }

        // --- Assignment Rules (Admin_Assignment - Active) ---
        if (isTarget(rule, "Admin", "Assignment")) {
            // Expiration
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
                const expRule = rule as ExpirationRule;
                settings.assignment.allowPermanentActive = !expRule.isExpirationRequired;
                settings.assignment.expireActiveAfter = isoDurationToLabel(expRule.maximumDuration);
            }
            // Notification
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
                const notRule = rule as NotificationRuleSettings;
                if (notRule.notificationType === "Email") {
                    // Defensive coding: Ensure recipients is always an array
                    let rawRecipients = notRule.recipientType || (notRule as any).notificationRecipients || [];

                    if (!Array.isArray(rawRecipients)) {
                        if (typeof rawRecipients === 'string') {
                            rawRecipients = [rawRecipients];
                        } else {
                            rawRecipients = [];
                        }
                    }
                    const recipients: string[] = rawRecipients;

                    if (recipients.some(r => r.toLowerCase() === "admin")) {
                        settings.notification.activeAssignment.admin = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "requestor")) {
                        settings.notification.activeAssignment.assignee = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                    if (recipients.some(r => r.toLowerCase() === "approver")) {
                        settings.notification.activeAssignment.approver = {
                            isEnabled: notRule.isDefaultRecipientsEnabled ?? true,
                            additionalRecipients: notRule.notificationRecipients || [],
                            criticalOnly: notRule.notificationLevel === "Critical"
                        };
                    }
                }
            }
            // Enablement
            if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
                const enRule = rule as EnablementRule;
                settings.assignment.requireMfaOnActive = enRule.enabledRules.includes("MultiFactorAuthentication");
                settings.assignment.requireJustificationOnActive = enRule.enabledRules.includes("Justification");
            }
        }
    }

    return { settings, approvalRule };
}

/**
 * Cleans a rule object for PATCH by removing read-only properties
 * that the Graph API doesn't accept in update requests.
 *
 * STRICT CLEANUP: Only send properties that are explicitly documented by Microsoft
 */
function cleanRuleForPatch(rule: any): any {
    // Build a clean object with ONLY the required properties per MS docs
    const cleaned: any = {
        "@odata.type": rule["@odata.type"],
        "id": rule.id
    };

    // Add target (required, with normalized operations)
    if (rule.target) {
        cleaned.target = {
            "@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget",
            caller: rule.target.caller,
            operations: (rule.target.operations || []).map((op: string) =>
                op.toLowerCase() === "all" ? "All" : op
            ),
            level: rule.target.level,
            inheritableSettings: rule.target.inheritableSettings || [],
            enforcedSettings: rule.target.enforcedSettings || []
        };
    }

    // Add type-specific properties based on rule type
    const ruleType = rule["@odata.type"];

    if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
        cleaned.isExpirationRequired = rule.isExpirationRequired;
        if (rule.maximumDuration) {
            cleaned.maximumDuration = rule.maximumDuration;
        }
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
        cleaned.enabledRules = rule.enabledRules || [];
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
        cleaned.notificationType = rule.notificationType;
        cleaned.recipientType = rule.recipientType;
        cleaned.notificationLevel = rule.notificationLevel;
        cleaned.isDefaultRecipientsEnabled = rule.isDefaultRecipientsEnabled;
        cleaned.notificationRecipients = rule.notificationRecipients || [];
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
        cleaned.isEnabled = rule.isEnabled || false;
        cleaned.claimValue = rule.claimValue || null;
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
        // For approval rules, the setting object must include approvalStages
        // even if it's an empty array - the API throws "Value cannot be null" otherwise
        if (rule.setting) {
            cleaned.setting = {
                isApprovalRequired: rule.setting.isApprovalRequired || false,
                // CRITICAL: Always include approvalStages, even if empty
                approvalStages: rule.setting.approvalStages ? rule.setting.approvalStages.map((stage: any) => ({
                    approvalStageTimeOutInDays: stage.approvalStageTimeOutInDays,
                    isApproverJustificationRequired: stage.isApproverJustificationRequired,
                    escalationTimeInMinutes: stage.escalationTimeInMinutes,
                    isEscalationEnabled: stage.isEscalationEnabled,
                    primaryApprovers: (stage.primaryApprovers || []).map((approver: any) => ({
                        "@odata.type": approver["@odata.type"],
                        id: approver.id,
                        isBackup: approver.isBackup ?? false
                    })),
                    escalationApprovers: (stage.escalationApprovers || []).map((approver: any) => ({
                        "@odata.type": approver["@odata.type"],
                        id: approver.id,
                        isBackup: approver.isBackup ?? false
                    }))
                })) : []
            };
        }
    }

    return cleaned;
}

/**
 * @deprecated Use cleanRuleForPatch instead
 * Sanitizes rules before sending to Graph API by removing properties that aren't accepted.
 * Graph API is strict about what properties it accepts in PATCH requests.
 */
function sanitizeRulesForPatch(rules: any[]): any[] {
    return rules.map(rule => cleanRuleForPatch(rule));
}

/**
 * Creates a minimal rule representation with only required properties
 * Used for bulk updates to include unchanged rules
 *
 * CRITICAL: Preserves the exact target from the original rule.
 * The target is semantically locked to the rule ID and must not be modified.
 */
function createMinimalRule(rule: PimRule): any {
    const minimal: any = {
        "@odata.type": rule["@odata.type"],
        id: rule.id,
        target: {
            "@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget",
            caller: rule.target?.caller || "Admin",
            operations: rule.target?.operations || ["All"],
            level: rule.target?.level || "Eligibility",
            inheritableSettings: rule.target?.inheritableSettings || [],
            enforcedSettings: rule.target?.enforcedSettings || []
        }
    };

    // Include type-specific required properties from original rule
    const ruleType = rule["@odata.type"];

    if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
        minimal.isExpirationRequired = rule.isExpirationRequired;
        if (rule.maximumDuration) {
            minimal.maximumDuration = rule.maximumDuration;
        }
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
        minimal.enabledRules = rule.enabledRules || [];
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
        minimal.notificationType = rule.notificationType;
        minimal.recipientType = rule.recipientType;
        minimal.notificationLevel = rule.notificationLevel;
        minimal.isDefaultRecipientsEnabled = rule.isDefaultRecipientsEnabled;
        minimal.notificationRecipients = rule.notificationRecipients || [];
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
        minimal.setting = rule.setting || { isApprovalRequired: false };
    } else if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
        minimal.isEnabled = rule.isEnabled || false;
        minimal.claimValue = rule.claimValue || null;
    }

    return minimal;
}

/**
 * Updates PIM policy for a role using INDIVIDUAL rule PATCH operations
 * This is the recommended approach per Microsoft documentation:
 * https://learn.microsoft.com/en-us/graph/api/unifiedrolemanagementpolicyrule-update
 *
 * Each changed rule is updated separately via:
 * PATCH /policies/roleManagementPolicies/{policyId}/rules/{ruleId}
 */
export async function updatePimPolicy(client: Client, roleId: string, newSettings: RoleSettings) {
    try {
        const currentData = await getRolePolicy(client, roleId);
        if (!currentData) throw new Error(`Could not fetch current policy for role ${roleId}`);

        const { policyId, rules } = currentData;

        Logger.debug("pimConfiguration", `[updatePimPolicy] Processing ${rules.length} rules for policy ${policyId}`);

        // Calculate which rules need updates
        const rulesToUpdate: Array<{ original: PimRule, updated: any }> = [];

        for (const rule of rules) {
            try {
                const updatedRule = calculateRuleUpdate(rule, newSettings);
                if (updatedRule) {
                    rulesToUpdate.push({ original: rule, updated: updatedRule });
                }
            } catch (err) {
                Logger.error("pimConfiguration", `[updatePimPolicy] Error calculating update for rule ${rule.id}:`, err);
            }
        }

        Logger.debug("pimConfiguration", `[updatePimPolicy] ${rulesToUpdate.length} rules need updates out of ${rules.length} total`);

        if (rulesToUpdate.length === 0) {
            Logger.debug("pimConfiguration", `[updatePimPolicy] No changes needed for policy ${policyId}`);
            return true;
        }

        // Update each rule individually (per Microsoft docs recommendation)
        Logger.info("pimConfiguration", `[updatePimPolicy] Updating ${rulesToUpdate.length} rules individually for policy ${policyId}`);

        for (const { original, updated } of rulesToUpdate) {
            const cleanedRule = cleanRuleForPatch(updated);

            Logger.debug("pimConfiguration", `[updatePimPolicy] Updating rule ${cleanedRule.id}`,
                JSON.stringify(cleanedRule, null, 2));

            try {
                // TESTING: Try beta API instead of v1.0 for rule updates
                // v1.0 might be too strict for Directory Roles
                await withRetry(
                    () => client.api(`${PIM_URLS.roleManagementPolicies}/${policyId}/rules/${cleanedRule.id}`)
                        .version("beta")
                        .header("Accept-Language", GRAPH_LOCALE)
                        .patch(cleanedRule),
                    3,
                    1000,
                    `updatePolicyRule_${cleanedRule.id}`
                );

                // Small delay between rule updates
                await delay(300);
            } catch (patchError: any) {
                Logger.error("pimConfiguration", `[updatePimPolicy] PATCH failed for rule ${cleanedRule.id}`);
                Logger.error("pimConfiguration", `Error code: ${patchError.code || 'unknown'}`);
                Logger.error("pimConfiguration", `Error message: ${patchError.message}`);
                Logger.error("pimConfiguration", `Failed payload:`, JSON.stringify(cleanedRule, null, 2));
                throw patchError;
            }
        }

        // Verification delay
        await delay(1000);
        const verified = await getRolePolicy(client, roleId);
        if (!verified) throw new Error("Verification failed after update");

        Logger.info("pimConfiguration", `[updatePimPolicy] Successfully updated ${rulesToUpdate.length} rules for role ${roleId}`);
        return true;

    } catch (error: any) {
        Logger.error("pimConfiguration", `Failed to update policy for role ${roleId}`, error);
        throw error;
    }
}

/**
 * Calculates rule updates based on new settings vs current rule.
 * Returns the FULL rule object with updates applied, or null if no changes.
 *
 * IMPORTANT: We return the complete rule (not a delta) because the Azure Portal
 * does this in its bulk updates. Sending partial objects can cause "policy is invalid" errors.
 *
 * CRITICAL: The target object MUST match the semantic definition of the rule ID.
 * For example, Expiration_Admin_Eligibility requires caller="Admin" and level="Eligibility".
 * The API validates this alignment and returns InvalidPolicyRule if there's a mismatch.
 */
function calculateRuleUpdate(rule: PimRule, newSettings: RoleSettings): any | null {
    // Start with a complete copy of the original rule
    // The Azure Portal sends full rule objects back, not deltas
    const updated: any = { ...rule };
    let hasChanges = false;

    // --- Activation ---
    if (isTarget(rule, "EndUser", "Assignment")) {
        // Expiration
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newDuration = hoursToIsoDuration(newSettings.activation.maxDuration);
            if (rule.maximumDuration !== newDuration) {
                updated.isExpirationRequired = true;
                updated.maximumDuration = newDuration;
                hasChanges = true;
            }
        }
        // Enablement
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
            const newEnabledRules: string[] = [];
            if (newSettings.activation.requireMfa === "AzureMFA") newEnabledRules.push("MultiFactorAuthentication");
            if (newSettings.activation.requireJustification) newEnabledRules.push("Justification");
            if (newSettings.activation.requireTicketInfo) newEnabledRules.push("Ticketing");

            if (JSON.stringify([...(rule.enabledRules || [])].sort()) !== JSON.stringify(newEnabledRules.sort())) {
                updated.enabledRules = newEnabledRules;
                hasChanges = true;
            }
        }
        // Auth Context
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
            const shouldUseContext = newSettings.activation.requireMfa === "ConditionalAccess" && !!newSettings.activation.authContextId;
            if (shouldUseContext) {
                if (!rule.isEnabled || rule.claimValue !== newSettings.activation.authContextId) {
                    updated.isEnabled = true;
                    updated.claimValue = newSettings.activation.authContextId;
                    hasChanges = true;
                }
            } else if (rule.isEnabled) {
                updated.isEnabled = false;
                updated.claimValue = null;
                hasChanges = true;
            }
        }
        // Notification - using complete rule object as required by Graph API
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
            if (rule.notificationType === "Email") {
                const completeRule = calculateNotificationChanges(rule, newSettings.notification.eligibleActivation);
                if (completeRule) {
                    // Replace updated with complete rule (not Object.assign)
                    Object.keys(completeRule).forEach(key => updated[key] = completeRule[key]);
                    hasChanges = true;
                }
            }
        }
        // Approval
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
            const approvalChanges = calculateApprovalChanges(rule, newSettings.activation);
            if (approvalChanges) {
                Object.assign(updated, approvalChanges);
                hasChanges = true;
            }
        }
    }

    // --- Assignment (Eligibility) ---
    if (isTarget(rule, "Admin", "Eligibility")) {
        // Expiration
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newIsExp = !newSettings.assignment.allowPermanentEligible;
            const newDur = newSettings.assignment.allowPermanentEligible ? null : toIsoDuration(newSettings.assignment.expireEligibleAfter);

            if (rule.isExpirationRequired !== newIsExp || rule.maximumDuration !== newDur) {
                updated.isExpirationRequired = newIsExp;
                // CRITICAL: Only include maximumDuration when expiration is required
                // If expiration is NOT required, we must REMOVE maximumDuration from the object
                if (newIsExp && newDur) {
                    updated.maximumDuration = newDur;
                } else {
                    delete updated.maximumDuration;
                }
                hasChanges = true;
            }
        }
        // Notification - using complete rule object
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule" && rule.notificationType === "Email") {
            const completeRule = calculateNotificationChanges(rule, newSettings.notification.eligibleAssignment);
            if (completeRule) {
                Object.keys(completeRule).forEach(key => updated[key] = completeRule[key]);
                hasChanges = true;
            }
        }
    }

    // --- Assignment (Active) ---
    if (isTarget(rule, "Admin", "Assignment")) {
        // Expiration
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newIsExp = !newSettings.assignment.allowPermanentActive;
            const newDur = newSettings.assignment.allowPermanentActive ? null : toIsoDuration(newSettings.assignment.expireActiveAfter);

            if (rule.isExpirationRequired !== newIsExp || rule.maximumDuration !== newDur) {
                updated.isExpirationRequired = newIsExp;
                // CRITICAL: Only include maximumDuration when expiration is required
                // If expiration is NOT required, we must REMOVE maximumDuration from the object
                if (newIsExp && newDur) {
                    updated.maximumDuration = newDur;
                } else {
                    delete updated.maximumDuration;
                }
                hasChanges = true;
            }
        }
        // Notification - using complete rule object
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule" && rule.notificationType === "Email") {
            const completeRule = calculateNotificationChanges(rule, newSettings.notification.activeAssignment);
            if (completeRule) {
                Object.keys(completeRule).forEach(key => updated[key] = completeRule[key]);
                hasChanges = true;
            }
        }
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
            const newEnabledRules: string[] = [];
            if (newSettings.assignment.requireMfaOnActive) newEnabledRules.push("MultiFactorAuthentication");
            if (newSettings.assignment.requireJustificationOnActive) newEnabledRules.push("Justification");
            if (JSON.stringify([...(rule.enabledRules || [])].sort()) !== JSON.stringify(newEnabledRules.sort())) {
                updated.enabledRules = newEnabledRules;
                hasChanges = true;
            }
        }
    }

    return hasChanges ? updated : null;
}

/**
 * Calculate notification rule changes - MUST return complete rule object
 *
 * Microsoft Graph API requires the complete rule object including target.
 * Each notification rule handles ONE recipientType (Admin, Requestor, Assignee, or Approver).
 *
 * Key properties:
 * - notificationLevel: "All" = normal, "Critical" = critical emails only
 * - isDefaultRecipientsEnabled: true = default recipients enabled
 * - notificationRecipients: array of email addresses for additional recipients
 * - recipientType: "Admin" | "Requestor" | "Assignee" | "Approver" (immutable)
 */
function calculateNotificationChanges(currentRule: any, blockSetting: any): any | null {
    // Determine which setting applies based on recipientType
    const recipientType = currentRule.recipientType;
    Logger.info("pimConfiguration", `[NotificationUpdate] Processing rule ${currentRule.id} with recipientType: ${recipientType}`);

    // Map recipientType to our settings key
    // Note: "Requestor" is used for BOTH activation and assignment notifications
    // We need to check the rule ID to determine which settings to use:
    // - Admin_Assignment/Admin_Eligibility = assignment notifications → use "assignee" settings
    // - EndUser_Assignment = activation notifications → use "requestor" settings
    let settingKey: string | null = null;
    if (recipientType === "Admin") settingKey = "admin";
    else if (recipientType === "Requestor") settingKey = blockSetting?.requestor ? "requestor" : "assignee";
    else if (recipientType === "Assignee") settingKey = "assignee"; // CRITICAL: Handle Assignee explicitly!
    else if (recipientType === "Approver") settingKey = "approver";

    if (!settingKey || !blockSetting?.[settingKey]) {
        Logger.info("pimConfiguration", `[NotificationUpdate] No matching settings for ${recipientType}, skipping`);
        return null; // No matching settings
    }

    const setting = blockSetting[settingKey];

    // Calculate new values - FIXED MAPPING:
    // criticalOnly → notificationLevel ("Critical" or "All")
    // isEnabled → isDefaultRecipientsEnabled
    const newNotificationLevel = setting.criticalOnly === true ? "Critical" : "All";
    const newIsDefaultEnabled = setting.isEnabled !== false; // default true if not specified
    const newAdditionalRecipients = setting.additionalRecipients
        ? (typeof setting.additionalRecipients === 'string'
            ? setting.additionalRecipients.split(';').map((e: string) => e.trim()).filter((e: string) => e)
            : setting.additionalRecipients)
        : [];

    // Check if anything changed
    const currentNotificationLevel = currentRule.notificationLevel || "All";
    const currentIsDefaultEnabled = currentRule.isDefaultRecipientsEnabled !== false;
    const currentAdditionalRecipients = currentRule.notificationRecipients || [];

    const criticalChanged = currentNotificationLevel !== newNotificationLevel;
    const enabledChanged = currentIsDefaultEnabled !== newIsDefaultEnabled;
    const recipientsChanged = JSON.stringify(currentAdditionalRecipients.sort()) !==
        JSON.stringify(newAdditionalRecipients.sort());

    Logger.info("pimConfiguration", `[NotificationUpdate] ${recipientType}: criticalOnly=${setting.criticalOnly}, notificationLevel=${newNotificationLevel} (current=${currentNotificationLevel}), criticalChanged=${criticalChanged}, enabledChanged=${enabledChanged}, recipientsChanged=${recipientsChanged}`);

    if (!criticalChanged && !enabledChanged && !recipientsChanged) {
        Logger.info("pimConfiguration", `[NotificationUpdate] No changes detected for ${recipientType}`);
        return null; // No changes needed
    }

    // Return COMPLETE rule object as required by Graph API
    // Keep everything from original rule but update the changed properties
    const completeRule = {
        "@odata.type": currentRule["@odata.type"],
        "id": currentRule.id,
        "notificationType": currentRule.notificationType,
        "recipientType": currentRule.recipientType,
        "notificationLevel": newNotificationLevel,
        "isDefaultRecipientsEnabled": newIsDefaultEnabled,
        "notificationRecipients": newAdditionalRecipients,
        "target": currentRule.target // Include complete target object
    };

    Logger.info("pimConfiguration", `[NotificationUpdate] Returning complete rule for ${recipientType}:`, JSON.stringify(completeRule, null, 2));
    return completeRule;
}

/**
 * Calculate approval rule changes (delta only)
 */
function calculateApprovalChanges(currentRule: any, activationSettings: any): any | null {
    const currentSetting = currentRule.setting || {};
    const currentApproval = currentSetting.isApprovalRequired || false;
    const newApproval = activationSettings.requireApproval || false;
    const newApprovers = activationSettings.approvers || [];

    if (!currentApproval && !newApproval) {
        return null; // No change needed
    }

    // Check if approval settings changed
    const currentApprovers = currentSetting.approvalStages?.[0]?.primaryApprovers || [];
    const currentApproverIds = currentApprovers.map((a: any) => a.id).sort();
    const newApproverIds = newApprovers.filter((a: any) => a.id).map((a: any) => a.id).sort();

    if (currentApproval === newApproval && JSON.stringify(currentApproverIds) === JSON.stringify(newApproverIds)) {
        return null; // No changes
    }

    // Build the setting delta
    const settingDelta: any = {
        isApprovalRequired: newApproval
    };

    if (newApproval && newApproverIds.length > 0) {
        settingDelta.approvalStages = [{
            approvalStageTimeOutInDays: 1,
            isApproverJustificationRequired: true,
            escalationTimeInMinutes: 0,
            isEscalationEnabled: false,
            primaryApprovers: newApprovers
                .filter((a: any) => a.id && typeof a.id === 'string')
                .map((a: any) => ({
                    "@odata.type": a.type === "group" ? "#microsoft.graph.groupMembers" : "#microsoft.graph.singleUser",
                    id: a.id,
                    isBackup: false
                })),
            escalationApprovers: []
        }];
    } else if (!newApproval) {
        settingDelta.approvalStages = [{
            ...currentSetting.approvalStages?.[0],
            primaryApprovers: []
        }];
    }

    return { setting: settingDelta };
}

// Helper to update notification rules
function updateNotificationRule(updatedRule: any, currentRule: any, blockSetting: any, onChange: () => void) {
    // Defensive: ensure currentRecipients is always an array
    let rawRecipients = currentRule.recipientType || [];
    if (!Array.isArray(rawRecipients)) {
        rawRecipients = typeof rawRecipients === 'string' ? [rawRecipients] : [];
    }
    const currentRecipients: string[] = rawRecipients;
    const newRecipients: string[] = [];

    // Priority for determining shared settings (Additional/Critical)
    // If a rule targets multiple, we prioritize Admin > Assignee/Requestor > Approver
    let primarySetting: any = null;

    // Check Admin
    if (currentRecipients.includes("Admin")) {
        // Only keep if enabled in UI
        if (blockSetting.admin?.isEnabled) {
            newRecipients.push("Admin");
            if (!primarySetting) primarySetting = blockSetting.admin;
        }
    }

    // Check Assignee/Requestor
    // Matches "Requestor" string in Graph
    if (currentRecipients.includes("Requestor")) {
        const setting = blockSetting.requestor || blockSetting.assignee;
        if (setting?.isEnabled) {
            newRecipients.push("Requestor");
            if (!primarySetting) primarySetting = setting;
        }
    }

    // Check Approver
    if (currentRecipients.includes("Approver")) {
        if (blockSetting.approver?.isEnabled) {
            newRecipients.push("Approver");
            if (!primarySetting) primarySetting = blockSetting.approver;
        }
    }

    const recipientsChanged = JSON.stringify([...currentRecipients].sort()) !== JSON.stringify([...newRecipients].sort());

    // Check additional/critical settings
    // If we have a primary setting, we enforce its values on this rule
    let additionalChanged = false;
    let criticalChanged = false;

    if (primarySetting) {
        // Defensive: ensure these are always arrays
        let currentAdditional = currentRule.additionalRecipients || [];
        if (!Array.isArray(currentAdditional)) {
            currentAdditional = typeof currentAdditional === 'string' ? [currentAdditional] : [];
        }
        let newAdditional = primarySetting.additionalRecipients || [];
        if (!Array.isArray(newAdditional)) {
            newAdditional = typeof newAdditional === 'string' ? [newAdditional] : [];
        }

        additionalChanged = JSON.stringify([...currentAdditional].sort()) !== JSON.stringify([...newAdditional].sort());

        // FIXED MAPPING: criticalOnly → notificationLevel, not isDefaultRecipientsEnabled
        const currentNotificationLevel = currentRule.notificationLevel || "All";
        const newNotificationLevel = primarySetting.criticalOnly === true ? "Critical" : "All";

        if (currentNotificationLevel !== newNotificationLevel) criticalChanged = true;

        // Graph API uses 'notificationRecipients' not 'additionalRecipients'
        if (additionalChanged) updatedRule.notificationRecipients = newAdditional;
        if (criticalChanged) updatedRule.notificationLevel = newNotificationLevel;
    }

    if (recipientsChanged) {
        updatedRule.recipientType = newRecipients;
    }

    if (recipientsChanged || additionalChanged || criticalChanged) {
        onChange();
    }
}

// Helper to update approval rules
function updateApprovalRule(updatedRule: any, currentRule: any, activationSettings: any, onChange: () => void) {
    if (activationSettings.requireApproval) {
        let needsUpdate = false;
        const currentSetting = currentRule.setting || {};

        if (!currentSetting.isApprovalRequired) needsUpdate = true;

        // Check approver changes
        const stage = currentSetting.approvalStages?.[0];
        const currentApprovers = stage ? (stage.primaryApprovers || []) : (currentSetting.primaryApprovers || []);
        const newApprovers = activationSettings.approvers;

        if (currentApprovers.length !== newApprovers.length) {
            needsUpdate = true;
        } else {
            const currentIds = (currentApprovers || []).map((a: any) => a.id).sort();
            const newIds = (newApprovers || []).map((a: any) => a.id).sort();
            if (JSON.stringify(currentIds) !== JSON.stringify(newIds)) needsUpdate = true;
        }

        if (needsUpdate) {
            if (newApprovers.length === 0) return; // Cannot enable without approvers

            const newSetting = { ...currentSetting };
            newSetting.isApprovalRequired = true;

            // Filter out approvers without valid ID and map to Graph format
            const mappedApprovers = newApprovers
                .filter((a: any) => a.id && typeof a.id === 'string' && a.id.length > 0)
                .map((a: any) => ({
                    "@odata.type": a.type === "group" ? "#microsoft.graph.groupMembers" : "#microsoft.graph.singleUser",
                    id: a.id,
                    isBackup: false
                }));

            // If no valid approvers after filtering, skip the update
            if (mappedApprovers.length === 0) return;

            if (newSetting.approvalStages && newSetting.approvalStages.length > 0) {
                newSetting.approvalStages[0].primaryApprovers = mappedApprovers;
            } else {
                newSetting.approvalStages = [{
                    approvalStageTimeOutInDays: 1,
                    isApproverJustificationRequired: true,
                    escalationTimeInMinutes: 0,
                    isEscalationEnabled: false,
                    primaryApprovers: mappedApprovers,
                    escalationApprovers: []
                }];
            }

            delete newSetting["@odata.type"];
            updatedRule.setting = newSetting;
            onChange();
        }

    } else {
        // Disable approval
        if (currentRule.setting?.isApprovalRequired) {
            const newSetting = { ...currentRule.setting };
            newSetting.isApprovalRequired = false;
            if (newSetting.approvalStages && newSetting.approvalStages.length > 0) {
                newSetting.approvalStages[0].primaryApprovers = [];
            }
            delete newSetting["@odata.type"];
            updatedRule.setting = newSetting;
            onChange();
        }
    }
}

/**
 * Creates a new PIM Assignment (Active or Eligible)
 */
export async function createPimAssignment(client: Client, assignmentSettings: AssignmentSettings, roleId: string) {
    const results = [];

    for (const [index, principal] of assignmentSettings.principals.entries()) {
        if (index > 0) await delay(200);

        try {
            const requestBody: any = {
                action: "adminAssign",
                principalId: principal.id,
                roleDefinitionId: roleId,
                directoryScopeId: "/",
                justification: assignmentSettings.justification || "Assigned via PIM Configurator",
                scheduleInfo: {
                    startDateTime: assignmentSettings.startDate ? new Date(assignmentSettings.startDate).toISOString() : new Date().toISOString(),
                    expiration: {
                        type: assignmentSettings.duration === "Permanent" ? "noExpiration" : "afterDuration",
                        duration: assignmentSettings.duration === "Permanent" ? null : DEFAULT_DURATIONS.eligibleExpiration // Default to 1 year if specified, TODO: Add duration picker in Assignment UI
                    }
                }
            };

            const endpoint = assignmentSettings.type === "Eligible"
                ? PIM_URLS.roleEligibilityScheduleRequests
                : PIM_URLS.roleAssignmentScheduleRequests;

            const response = await withRetry(() =>
                client.api(endpoint).header("Accept-Language", GRAPH_LOCALE).post(requestBody)
            );
            results.push({ principalId: principal.id, status: "success", id: response.id });

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Assignment failed';
            Logger.error("pimConfiguration", `Failed to assign role ${roleId} to ${principal.displayName}`, error);
            results.push({ principalId: principal.id, status: "error", error: errorMessage });
        }
    }
    return results;
}

/**
 * Removes an existing PIM Assignment (Directory Role)
 */
export async function removePimAssignment(client: Client, removal: { assignmentId: string; principalId: string; roleDefinitionId: string; directoryScopeId: string; assignmentType: "eligible" | "active" }) {
    const endpoint = removal.assignmentType === "eligible"
        ? PIM_URLS.roleEligibilityScheduleRequests
        : PIM_URLS.roleAssignmentScheduleRequests;

    const requestBody = {
        action: "adminRemove",
        principalId: removal.principalId,
        roleDefinitionId: removal.roleDefinitionId,
        directoryScopeId: removal.directoryScopeId,
        justification: "Removed via PIM Configurator"
    };

    await withRetry(() =>
        client.api(endpoint)
            .header("Accept-Language", GRAPH_LOCALE)
            .post(requestBody)
    );
}

/**
 * Removes an existing PIM Group Assignment
 */
export async function removePimGroupAssignment(client: Client, removal: { assignmentId: string; principalId: string; roleDefinitionId: string; directoryScopeId: string; assignmentType: "eligible" | "active"; groupId?: string }) {
    const requestBody = {
        action: "adminRemove",
        principalId: removal.principalId,
        accessId: removal.roleDefinitionId, // "member" or "owner"
        // groupId must be the actual group ID. removal.groupId is set by AssignmentsStep for group removals.
        // directoryScopeId is always "/" for group assignments (tenant scope), so it cannot be used here.
        groupId: removal.groupId || removal.directoryScopeId,
        justification: "Removed via PIM Configurator"
    };

    await withRetry(() =>
        client.api(PIM_URLS.groupAssignmentScheduleRequests)
            .header("Accept-Language", GRAPH_LOCALE)
            .post(requestBody)
    );
}


// --- Internal Utils ---

async function fetchApproverDetails(client: Client, approversRaw: any[]): Promise<Principal[]> {
    const results: (Principal | null)[] = [];

    for (let index = 0; index < approversRaw.length; index++) {
        if (index > 0) await delay(100);
        const approver = approversRaw[index];
        try {
            let endpoint = "";
            const type = approver["@odata.type"];

            if (type === "#microsoft.graph.singleUser") endpoint = `/users/${approver.id}?$select=id,displayName,userPrincipalName`;
            else if (type === "#microsoft.graph.groupMembers") endpoint = `/groups/${approver.id}?$select=id,displayName`;

            if (endpoint) {
                const details = await withRetry(() =>
                    client.api(endpoint).header("Accept-Language", GRAPH_LOCALE).get()
                );
                results.push({
                    id: details.id,
                    displayName: details.displayName,
                    userPrincipalName: details.userPrincipalName,
                    type: type === "#microsoft.graph.singleUser" ? "user" : "group"
                } as Principal);
            } else {
                results.push(null);
            }
        } catch (e) {
            results.push({
                id: approver.id,
                displayName: `Unknown (${approver.id})`,
                type: "user"
            } as Principal);
        }
    }

    return results.filter(Boolean) as Principal[];
}
