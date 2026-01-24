import { Logger } from "@/utils/logger";
import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE, PIM_URLS } from "@/config/constants";
import { RoleSettings, AssignmentSettings, Principal } from "@/types";

/**
 * PIM Configuration Service
 * Handles reading and writing PIM policies (Role Configuration) via Microsoft Graph API.
 * Replaces the legacy src/utils/pimApi.ts
 */

// --- Helpers ---

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Parses an ISO 8601 duration (e.g. PT8H) to hours (integer)
 * Matches PT#H format. Defaults to 8 if invalid.
 */
export const parseIsoDurationToHours = (duration: string | null | undefined): number => {
    if (!duration) return 8;
    const match = duration.match(/PT(\d+)H/);
    return match ? parseInt(match[1], 10) : 8;
};

/**
 * Converts hours (integer) to ISO 8601 duration (e.g. PT8H)
 */
export const hoursToIsoDuration = (hours: number): string => `PT${hours}H`;

/**
 * Parses a human readable label (e.g. "1 Year", "6 Months") to ISO 8601 duration
 * Supports flexible input: "15 Days" -> P15D, "1 Year" -> P1Y
 */
export const labelToIsoDuration = (label: string): string => {
    if (!label) return "P1Y"; // Default

    // Handle "Permanent"
    if (label.toLowerCase() === "permanent") return "PT0S"; // Or handle logic elsewhere

    // Try to parse "Amount Unit"
    const match = label.match(/^(\d+)\s+(Day|Month|Year)s?$/i);
    if (match) {
        const amount = match[1];
        const unit = match[2].toLowerCase();

        if (unit.startsWith("day")) return `P${amount}D`;
        if (unit.startsWith("month")) return `P${amount}M`;
        if (unit.startsWith("year")) return `P${amount}Y`;
    }

    // Fallback for hardcoded legacies if regex fails (safety net)
    switch (label) {
        case "15 Days": return "P15D";
        case "1 Year": return "P1Y";
    }

    // Assume it might already be ISO or invalid. Return default if unsure, or return as is.
    if (label.startsWith("P")) return label;

    return "P1Y";
};

/**
 * Parses an ISO 8601 duration (e.g. P1Y, P3M) to human readable label
 * e.g. P1Y -> "1 Year", P6M -> "6 Months"
 */
export const isoDurationToLabel = (duration: string | null | undefined): string => {
    if (!duration) return "1 Year";

    // Regex for PnYnMnD
    // Note: Graph often returns strict P1M, P15D.
    const match = duration.match(/P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?/);

    if (match) {
        const years = match[1] ? parseInt(match[1], 10) : 0;
        const months = match[2] ? parseInt(match[2], 10) : 0;
        const days = match[3] ? parseInt(match[3], 10) : 0;

        const parts: string[] = [];

        if (years > 0) parts.push(`${years} Year${years !== 1 ? 's' : ''}`);
        if (months > 0) parts.push(`${months} Month${months !== 1 ? 's' : ''}`);
        if (days > 0) parts.push(`${days} Day${days !== 1 ? 's' : ''}`);

        if (parts.length === 0) return "Permanent"; // P0D or similar?
        return parts.join(" ");
    }

    return duration; // Return raw if parse failure
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
const isTarget = (rule: PimRule, caller: string, level: string, operations: string[] = ["All"]): boolean => {
    return rule.target?.caller === caller &&
        rule.target?.level === level &&
        rule.target?.operations?.some((op: string) => operations.includes(op)) || false;
};

/**
 * Retrieves the effective PIM policy for a Directory Role
 */
export async function getRolePolicy(client: Client, roleId: string): Promise<{ settings: RoleSettings, policyId: string, rules: PimRule[] } | null> {
    try {
        // Fetch assignments to find the policy ID
        // Api: /policies/roleManagementPolicyAssignments
        const assignments = await client.api(PIM_URLS.roleManagementPolicyAssignments)
            .version("v1.0")
            .header("Accept-Language", GRAPH_LOCALE)
            .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
            .expand("policy($expand=rules)")
            .get();

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

        // Initialize default settings
        const settings: RoleSettings = {
            activation: {
                maxDuration: 8,
                requireMfa: "None",
                requireJustification: false,
                requireTicketInfo: false,
                requireApproval: false,
                approvers: []
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
                eligibleAssignment: { sendToAdmin: true, sendToAssignee: true, sendToApprover: false, additionalRecipients: [], criticalOnly: false },
                activeAssignment: { sendToAdmin: true, sendToAssignee: true, sendToApprover: false, additionalRecipients: [], criticalOnly: false },
                eligibleActivation: { sendToAdmin: true, sendToAssignee: true, sendToApprover: false, additionalRecipients: [], criticalOnly: false }
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
                        const recipients = notRule.recipientType || [];
                        settings.notification.eligibleActivation = {
                            sendToAdmin: recipients.includes("Admin"),
                            sendToAssignee: recipients.includes("Requestor"),
                            sendToApprover: recipients.includes("Approver"),
                            additionalRecipients: notRule.additionalRecipients || [],
                            criticalOnly: notRule.isDefaultRecipientsEnabled === false
                        };
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
                        const recipients = notRule.recipientType || [];
                        settings.notification.eligibleAssignment = {
                            sendToAdmin: recipients.includes("Admin"),
                            sendToAssignee: recipients.includes("Requestor"),
                            sendToApprover: recipients.includes("Approver"),
                            additionalRecipients: notRule.additionalRecipients || [],
                            criticalOnly: notRule.isDefaultRecipientsEnabled === false
                        };
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
                        const recipients = notRule.recipientType || [];
                        settings.notification.activeAssignment = {
                            sendToAdmin: recipients.includes("Admin"),
                            sendToAssignee: recipients.includes("Requestor"),
                            sendToApprover: recipients.includes("Approver"),
                            additionalRecipients: notRule.additionalRecipients || [],
                            criticalOnly: notRule.isDefaultRecipientsEnabled === false
                        };
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

        // Fetch approvers if needed
        if (approvalRule && approvalRule.setting) {
            const stage = approvalRule.setting.approvalStages?.[0];
            const approvers = stage ? (stage.primaryApprovers || []) : (approvalRule.setting.primaryApprovers || []);

            settings.activation.approvers = await fetchApproverDetails(client, approvers);
        }

        return { settings, policyId: policy.id, rules };

    } catch (error) {
        Logger.error("pimConfiguration", `Error fetching policy for role ${roleId}:`, error);
        throw error;
    }
}

/**
 * Updates PIM policy for a role
 */
export async function updatePimPolicy(client: Client, roleId: string, newSettings: RoleSettings) {
    try {
        const currentData = await getRolePolicy(client, roleId);
        if (!currentData) throw new Error(`Could not fetch current policy for role ${roleId}`);

        const { policyId, rules } = currentData;
        const updatedRules = rules.map(rule => calculateRuleUpdate(rule, newSettings)).filter(Boolean);

        if (updatedRules.length === 0) return true;

        // Apply patches (merge)
        const finalRules = rules.map(rule => {
            const update = updatedRules.find((u: any) => u.id === rule.id);
            return update || rule;
        });

        await client.api(`${PIM_URLS.roleManagementPolicies}/${policyId}`)
            .version("beta")
            .header("Accept-Language", GRAPH_LOCALE)
            .patch({ rules: finalRules });

        // Verification delay
        await delay(2000);
        const verified = await getRolePolicy(client, roleId);
        if (!verified) throw new Error("Verification failed after update");

        return true;

    } catch (error) {
        Logger.error("pimConfiguration", `Failed to update policy for role ${roleId}`, error);
        throw error;
    }
}

/**
 * Calculates rule updates based on new settings vs current rule
 */
function calculateRuleUpdate(rule: PimRule, newSettings: RoleSettings): PimRule | null {
    const updatedRule = { ...rule };
    let hasChanges = false;

    // --- Activation ---
    if (isTarget(rule, "EndUser", "Assignment")) {
        // Expiration
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newDuration = hoursToIsoDuration(newSettings.activation.maxDuration);
            if (rule.maximumDuration !== newDuration) {
                updatedRule.maximumDuration = newDuration;
                hasChanges = true;
            }
        }
        // Enablement
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
            const newEnabledRules: string[] = [];
            if (newSettings.activation.requireMfa === "AzureMFA") newEnabledRules.push("MultiFactorAuthentication");
            if (newSettings.activation.requireJustification) newEnabledRules.push("Justification");
            if (newSettings.activation.requireTicketInfo) newEnabledRules.push("Ticketing");

            if (JSON.stringify(rule.enabledRules.sort()) !== JSON.stringify(newEnabledRules.sort())) {
                updatedRule.enabledRules = newEnabledRules;
                hasChanges = true;
            }
        }
        // Auth Context
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
            const shouldUseContext = newSettings.activation.requireMfa === "ConditionalAccess" && !!newSettings.activation.authContextId;
            if (shouldUseContext) {
                if (!rule.isEnabled || rule.claimValue !== newSettings.activation.authContextId) {
                    updatedRule.isEnabled = true;
                    updatedRule.claimValue = newSettings.activation.authContextId;
                    hasChanges = true;
                }
            } else if (rule.isEnabled) {
                updatedRule.isEnabled = false;
                updatedRule.claimValue = null;
                hasChanges = true;
            }
        }
        // Notification
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule") {
            if (rule.notificationType === "Email") updateNotificationRule(updatedRule, rule, newSettings.notification.eligibleActivation, () => { hasChanges = true; });
        }
        // Approval
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
            updateApprovalRule(updatedRule, rule, newSettings.activation, () => { hasChanges = true; });
        }
    }

    // --- Assignment (Eligibility) ---
    if (isTarget(rule, "Admin", "Eligibility")) {
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newIsExp = !newSettings.assignment.allowPermanentEligible;
            const newDur = newSettings.assignment.allowPermanentEligible ? null : labelToIsoDuration(newSettings.assignment.expireEligibleAfter);

            if (rule.isExpirationRequired !== newIsExp || rule.maximumDuration !== newDur) {
                updatedRule.isExpirationRequired = newIsExp;
                updatedRule.maximumDuration = newDur;
                hasChanges = true;
            }
        }
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule" && rule.notificationType === "Email") {
            updateNotificationRule(updatedRule, rule, newSettings.notification.eligibleAssignment, () => { hasChanges = true; });
        }
    }

    // --- Assignment (Active) ---
    if (isTarget(rule, "Admin", "Assignment")) {
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
            const newIsExp = !newSettings.assignment.allowPermanentActive;
            const newDur = newSettings.assignment.allowPermanentActive ? null : labelToIsoDuration(newSettings.assignment.expireActiveAfter);

            if (rule.isExpirationRequired !== newIsExp || rule.maximumDuration !== newDur) {
                updatedRule.isExpirationRequired = newIsExp;
                updatedRule.maximumDuration = newDur;
                hasChanges = true;
            }
        }
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule" && rule.notificationType === "Email") {
            updateNotificationRule(updatedRule, rule, newSettings.notification.activeAssignment, () => { hasChanges = true; });
        }
        if (rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
            const newEnabledRules: string[] = [];
            if (newSettings.assignment.requireMfaOnActive) newEnabledRules.push("MultiFactorAuthentication");
            if (newSettings.assignment.requireJustificationOnActive) newEnabledRules.push("Justification");
            if (JSON.stringify(rule.enabledRules.sort()) !== JSON.stringify(newEnabledRules.sort())) {
                updatedRule.enabledRules = newEnabledRules;
                hasChanges = true;
            }
        }
    }

    return hasChanges ? updatedRule : null;
}

// Helper to update notification rules
function updateNotificationRule(updatedRule: any, currentRule: any, setting: any, onChange: () => void) {
    const newRecipients = [];
    if (setting.sendToAdmin) newRecipients.push("Admin");
    if (setting.sendToAssignee) newRecipients.push("Requestor");
    if (setting.sendToApprover) newRecipients.push("Approver");

    const currentRecipients = currentRule.recipientType || [];
    const currentAdditional = currentRule.additionalRecipients || [];

    const recipientsChanged = JSON.stringify(currentRecipients.sort()) !== JSON.stringify(newRecipients.sort());
    const additionalChanged = JSON.stringify(currentAdditional.sort()) !== JSON.stringify(setting.additionalRecipients.sort());

    if (recipientsChanged || additionalChanged) {
        updatedRule.recipientType = newRecipients;
        updatedRule.additionalRecipients = setting.additionalRecipients;
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

            const mappedApprovers = newApprovers.map((a: any) => ({
                "@odata.type": a.type === "group" ? "#microsoft.graph.groupMembers" : "#microsoft.graph.singleUser",
                id: a.id,
                isBackup: false
            }));

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
                        duration: assignmentSettings.duration === "Permanent" ? null : "P1Y" // Default to 1 year if specified, TODO: Add duration picker in Assignment UI
                    }
                }
            };

            const endpoint = assignmentSettings.type === "Eligible"
                ? PIM_URLS.roleEligibilityScheduleRequests
                : PIM_URLS.roleAssignmentScheduleRequests;

            const response = await client.api(endpoint).header("Accept-Language", GRAPH_LOCALE).post(requestBody);
            results.push({ principalId: principal.id, status: "success", id: response.id });

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Assignment failed';
            Logger.error("pimConfiguration", `Failed to assign role ${roleId} to ${principal.displayName}`, error);
            results.push({ principalId: principal.id, status: "error", error: errorMessage });
        }
    }
    return results;
}


// --- Internal Utils ---

async function fetchApproverDetails(client: Client, approversRaw: any[]): Promise<Principal[]> {
    const approverPromises = approversRaw.map(async (approver: any, index: number) => {
        if (index > 0) await delay(100);
        try {
            let endpoint = "";
            const type = approver["@odata.type"];

            if (type === "#microsoft.graph.singleUser") endpoint = `/users/${approver.id}?$select=id,displayName,userPrincipalName`;
            else if (type === "#microsoft.graph.groupMembers") endpoint = `/groups/${approver.id}?$select=id,displayName`;

            if (endpoint) {
                const details = await client.api(endpoint).header("Accept-Language", GRAPH_LOCALE).get();
                return {
                    id: details.id,
                    displayName: details.displayName,
                    userPrincipalName: details.userPrincipalName,
                    type: type === "#microsoft.graph.singleUser" ? "user" : "group"
                } as Principal;
            }
            return null;
        } catch (e) {
            return {
                id: approver.id,
                displayName: `Unknown (${approver.id})`,
                type: "user"
            } as Principal;
        }
    });

    const results = await Promise.all(approverPromises);
    return results.filter(Boolean) as Principal[];
}
