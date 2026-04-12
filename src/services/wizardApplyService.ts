/**
 * Wizard Apply Service
 *
 * Handles the execution of policy updates and assignment creation
 * for the Configure Wizard's Apply phase.
 *
 * API Endpoints (verified against Microsoft Graph documentation):
 *
 * Directory Roles:
 * - Policy Updates: PATCH /policies/roleManagementPolicies/{policyId}/rules/{ruleId}
 * - Eligible Assignments: POST /roleManagement/directory/roleEligibilityScheduleRequests
 * - Active Assignments: POST /roleManagement/directory/roleAssignmentScheduleRequests
 *
 * PIM Groups:
 * - Policy Updates: PATCH /policies/roleManagementPolicies/{policyId}/rules/{ruleId}
 * - Assignments: POST /identityGovernance/privilegedAccess/group/assignmentScheduleRequests
 *   (uses accessId: "member" | "owner", NOT roleDefinitionId)
 */

import { Client } from "@microsoft/microsoft-graph-client";
import { PolicySettings, AssignmentConfig, AssignmentRemoval, ApplyOperationResult, ApplyPhaseResult, ApplyProgressCallback, BulkRemovalRequest } from "@/types/wizard.types";
import { Logger } from "@/utils/logger";
import { PIM_URLS } from "@/config/constants";
import { DEFAULT_DURATIONS, formatDuration, toGraphDuration, parseHours } from "@/utils/durationUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { clearPolicyCache } from "@/services/directoryRoleService";
import { withRetry } from "@/utils/retryUtils";

// Re-export for callers that imported these types from this service
export type { ApplyOperationResult, ApplyPhaseResult, ApplyProgressCallback, BulkRemovalRequest } from "@/types/wizard.types";

// ============================================================================
// Policy Rule Mapping
// ============================================================================

/**
 * Maps PolicySettings to the individual rule updates needed
 * Each rule has a specific @odata.type and structure
 */
interface RuleUpdate {
    ruleId: string;
    odataType: string;
    payload: Record<string, any>;
}

/**
 * Helper to create the target object required by policy rule updates.
 * Each rule type has a specific caller/level combination.
 */
function createRuleTarget(caller: "Admin" | "EndUser", level: "Eligibility" | "Assignment"): Record<string, any> {
    return {
        "@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget",
        caller: caller,
        operations: ["All"],
        level: level,
        inheritableSettings: [],
        enforcedSettings: []
    };
}

function mapPolicyToRuleUpdates(policy: PolicySettings): RuleUpdate[] {
    const rules: RuleUpdate[] = [];

    // 1. Expiration Rule - Admin Eligibility
    rules.push({
        ruleId: "Expiration_Admin_Eligibility",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
        payload: {
            id: "Expiration_Admin_Eligibility",
            isExpirationRequired: !policy.allowPermanentEligible,
            maximumDuration: toGraphDuration(policy.eligibleExpiration),
            target: createRuleTarget("Admin", "Eligibility")
        }
    });

    // 2. Expiration Rule - Admin Assignment (Active)
    rules.push({
        ruleId: "Expiration_Admin_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
        payload: {
            id: "Expiration_Admin_Assignment",
            isExpirationRequired: !policy.allowPermanentActive,
            maximumDuration: toGraphDuration(policy.activeExpiration),
            target: createRuleTarget("Admin", "Assignment")
        }
    });

    // 3. Expiration Rule - EndUser Assignment (Activation)
    rules.push({
        ruleId: "Expiration_EndUser_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule",
        payload: {
            id: "Expiration_EndUser_Assignment",
            isExpirationRequired: true,
            maximumDuration: policy.maxActivationDuration || DEFAULT_DURATIONS.activationDuration,
            target: createRuleTarget("EndUser", "Assignment")
        }
    });

    // 4. Enablement Rule - EndUser Assignment (MFA, Justification, TicketInfo)
    const enabledRules: string[] = [];
    if (policy.activationRequirement === "mfa") enabledRules.push("MultiFactorAuthentication");
    if (policy.requireJustificationOnActivation) enabledRules.push("Justification");
    if (policy.requireTicketInfo) enabledRules.push("Ticketing");

    rules.push({
        ruleId: "Enablement_EndUser_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule",
        payload: {
            id: "Enablement_EndUser_Assignment",
            enabledRules: enabledRules,
            target: createRuleTarget("EndUser", "Assignment")
        }
    });

    // 5. Enablement Rule - Admin Assignment (MFA, Justification for Active assignments)
    const adminEnablementRules: string[] = [];
    if (policy.requireMfaOnActiveAssignment) adminEnablementRules.push("MultiFactorAuthentication");
    if (policy.requireJustificationOnActiveAssignment) adminEnablementRules.push("Justification");

    rules.push({
        ruleId: "Enablement_Admin_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule",
        payload: {
            id: "Enablement_Admin_Assignment",
            enabledRules: adminEnablementRules,
            target: createRuleTarget("Admin", "Assignment")
        }
    });

    // 6. Authentication Context Rule (if applicable)
    if (policy.activationRequirement === "authenticationContext" && policy.authenticationContextId) {
        rules.push({
            ruleId: "AuthenticationContext_EndUser_Assignment",
            odataType: "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule",
            payload: {
                id: "AuthenticationContext_EndUser_Assignment",
                isEnabled: true,
                claimValue: policy.authenticationContextId,
                target: createRuleTarget("EndUser", "Assignment")
            }
        });
    }

    // 7. Approval Rule
    rules.push({
        ruleId: "Approval_EndUser_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
        payload: {
            id: "Approval_EndUser_Assignment",
            setting: {
                isApprovalRequired: policy.requireApproval,
                approvalStages: policy.requireApproval && policy.approvers?.length ? [{
                    approvalStageTimeOutInDays: 1,
                    isApproverJustificationRequired: true,
                    escalationTimeInMinutes: 0,
                    isEscalationEnabled: false,
                    primaryApprovers: policy.approvers.map(a => ({
                        "@odata.type": a.type === "user"
                            ? "#microsoft.graph.singleUser"
                            : "#microsoft.graph.groupMembers",
                        [a.type === "user" ? "userId" : "groupId"]: a.id,
                        description: a.displayName || ""
                    })),
                    fallbackPrimaryApprovers: [],
                    escalationApprovers: [],
                    fallbackEscalationApprovers: []
                }] : []
            },
            target: createRuleTarget("EndUser", "Assignment")
        }
    });

    // Notification rules — 9 rules covering 3 recipient types × 3 assignment scenarios
    if (policy.notifications) {
        const n = policy.notifications;
        const toArray = (s: string): string[] => s ? s.split(";").map(e => e.trim()).filter(Boolean) : [];

        const notificationRuleConfigs: Array<{
            ruleId: string;
            setting: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean };
            caller: "Admin" | "EndUser";
            level: "Eligibility" | "Assignment";
            recipientType: string;
        }> = [
            // Eligible assignment notifications
            { ruleId: "Notification_Admin_Admin_Eligibility",     setting: n.eligibleAssignment.admin,    caller: "Admin",   level: "Eligibility", recipientType: "Admin"     },
            { ruleId: "Notification_Requestor_Admin_Eligibility", setting: n.eligibleAssignment.assignee, caller: "Admin",   level: "Eligibility", recipientType: "Requestor" },
            { ruleId: "Notification_Approver_Admin_Eligibility",  setting: n.eligibleAssignment.approver, caller: "Admin",   level: "Eligibility", recipientType: "Approver"  },
            // Active assignment notifications
            { ruleId: "Notification_Admin_Admin_Assignment",      setting: n.activeAssignment.admin,      caller: "Admin",   level: "Assignment",  recipientType: "Admin"     },
            { ruleId: "Notification_Requestor_Admin_Assignment",  setting: n.activeAssignment.assignee,   caller: "Admin",   level: "Assignment",  recipientType: "Requestor" },
            { ruleId: "Notification_Approver_Admin_Assignment",   setting: n.activeAssignment.approver,   caller: "Admin",   level: "Assignment",  recipientType: "Approver"  },
            // Activation notifications
            { ruleId: "Notification_Admin_EndUser_Assignment",    setting: n.activation.admin,            caller: "EndUser", level: "Assignment",  recipientType: "Admin"     },
            { ruleId: "Notification_Requestor_EndUser_Assignment",setting: n.activation.requestor,        caller: "EndUser", level: "Assignment",  recipientType: "Requestor" },
            { ruleId: "Notification_Approver_EndUser_Assignment", setting: n.activation.approver,         caller: "EndUser", level: "Assignment",  recipientType: "Approver"  },
        ];

        for (const cfg of notificationRuleConfigs) {
            rules.push({
                ruleId: cfg.ruleId,
                odataType: "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule",
                payload: {
                    id: cfg.ruleId,
                    notificationType: "Email",
                    recipientType: cfg.recipientType,
                    notificationLevel: cfg.setting.criticalOnly ? "Critical" : "All",
                    isDefaultRecipientsEnabled: cfg.setting.isEnabled,
                    notificationRecipients: toArray(cfg.setting.additionalRecipients),
                    target: createRuleTarget(cfg.caller, cfg.level)
                }
            });
        }
    }

    return rules;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetches the policy ID for a given role or group scope
 */
async function getPolicyId(
    client: Client,
    scopeId: string,
    scopeType: "DirectoryRole" | "Group",
    roleDefinitionId?: string
): Promise<string | null> {
    try {
        let filter = `scopeId eq '${scopeId}' and scopeType eq '${scopeType}'`;
        if (roleDefinitionId) {
            filter += ` and roleDefinitionId eq '${roleDefinitionId}'`;
        }

        const response = await withRetry(
            () => client
                .api(PIM_URLS.roleManagementPolicyAssignments)
                .version("beta")
                .filter(filter)
                .select("policyId")
                .get(),
            3, 1000, 'getPolicyIdForScope'
        );

        if (response.value && response.value.length > 0) {
            return response.value[0].policyId;
        }
        return null;
    } catch (error) {
        Logger.error("WizardApply", `Failed to get policy ID for ${scopeId}:`, error);
        return null;
    }
}

/**
 * Updates a single policy rule
 */
async function updatePolicyRule(
    client: Client,
    policyId: string,
    ruleUpdate: RuleUpdate
): Promise<ApplyOperationResult> {
    try {
        await withRetry(
            () => client
                .api(`${PIM_URLS.roleManagementPolicies}/${policyId}/rules/${ruleUpdate.ruleId}`)
                .patch({
                    "@odata.type": ruleUpdate.odataType,
                    ...ruleUpdate.payload
                }),
            3,
            1000,
            `updatePolicyRule:${policyId}:${ruleUpdate.ruleId}`
        );

        return {
            success: true,
            operation: "updatePolicyRule",
            targetId: ruleUpdate.ruleId,
            retryable: false
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        Logger.error("WizardApply", `Failed to update rule ${ruleUpdate.ruleId} after retries:`, err);
        return {
            success: false,
            operation: "updatePolicyRule",
            targetId: ruleUpdate.ruleId,
            error: err.message,
            retryable: false // already retried
        };
    }
}

/**
 * Creates a directory role assignment (eligible or active)
 */
async function createDirectoryRoleAssignment(
    client: Client,
    roleDefinitionId: string,
    principalId: string,
    assignmentType: "eligible" | "active",
    config: AssignmentConfig,
    allowPermanent: boolean,
    policyMaxDuration?: string
): Promise<ApplyOperationResult> {
    const endpoint = assignmentType === "eligible"
        ? PIM_URLS.roleEligibilityScheduleRequests
        : PIM_URLS.roleAssignmentScheduleRequests;

    // Ensure startDateTime is in proper ISO 8601 UTC format
    // UI input gives local datetime without timezone (e.g., "2026-01-13T16:13")
    // Graph API requires UTC with timezone (e.g., "2026-01-13T15:13:00Z")
    let startDateTime: string;
    if (config.startDateTime) {
        // Convert local datetime-local input to UTC ISO string
        const localDate = new Date(config.startDateTime);
        startDateTime = localDate.toISOString();
    } else {
        startDateTime = new Date().toISOString();
    }

    const scheduleInfo: Record<string, any> = {
        startDateTime: startDateTime,
    };


    // Handle expiration
    let usedFallbackDuration: string | undefined;
    if (config.duration === "permanent") {
        if (allowPermanent) {
            // Policy permits NoExpiration — use it as requested
            scheduleInfo.expiration = { type: "NoExpiration" };
        } else {
            // Policy requires expiration — use the policy's own maximum duration as fallback
            // so we don't risk exceeding maximumDuration (hardcoded defaults might be too long)
            const absoluteDefault = assignmentType === "active" ? DEFAULT_DURATIONS.newAssignmentActive : DEFAULT_DURATIONS.newAssignmentEligible;
            const fallback = policyMaxDuration || absoluteDefault;
            Logger.warn("WizardApply", `Permanent requested but policy disallows NoExpiration — falling back to ${fallback}`);
            scheduleInfo.expiration = { type: "AfterDuration", duration: fallback };
            usedFallbackDuration = fallback;
        }
    } else if (config.endDateTime) {
        scheduleInfo.expiration = {
            type: "AfterDateTime",
            endDateTime: new Date(config.endDateTime).toISOString()
        };
    } else {
        // Default duration based on assignment type
        // NOTE: Do NOT confuse with activation duration!
        // - Active ADMIN ASSIGNMENTS: Days/weeks (e.g., P15D = 15 days)
        // - Eligible assignments: Months (e.g., P180D = 180 days)
        // - Activation duration (when user activates): Hours (e.g., PT8H) - NOT used here!
        const defaultDuration = assignmentType === "active" ? DEFAULT_DURATIONS.newAssignmentActive : DEFAULT_DURATIONS.newAssignmentEligible;
        scheduleInfo.expiration = { type: "AfterDuration", duration: defaultDuration };
    }

    const payload = {
        action: "adminAssign",
        justification: config.justification || "Configured via PIM Manager",
        principalId: principalId,
        roleDefinitionId: roleDefinitionId,
        directoryScopeId: config.directoryScopeId || "/",
        scheduleInfo: scheduleInfo
    };

    // Debug logging
    Logger.debug("WizardApply", `Creating ${assignmentType} assignment for role ${roleDefinitionId}`);
    Logger.debug("WizardApply", `Endpoint: ${endpoint}`);
    Logger.debug("WizardApply", `Payload: ${JSON.stringify(payload, null, 2)}`);

    try {
        // Wrap in retry logic to handle transient failures (429, 503, 500+)
        await withRetry(
            () => client.api(endpoint).post(payload),
            3,
            1000,
            `create${assignmentType}Assignment:${roleDefinitionId}:${principalId}`
        );

        return {
            success: true,
            operation: `create${assignmentType === "eligible" ? "Eligible" : "Active"}Assignment`,
            targetId: `${roleDefinitionId}:${principalId}`,
            warning: usedFallbackDuration
                ? `Permanent duration not allowed by policy — assignment created with expiry: ${usedFallbackDuration}`
                : undefined,
            retryable: false
        };
    } catch (error: unknown) {
        // Enhanced error logging for debugging
        const err = error instanceof Error ? error : new Error(String(error));
        const errorBody = (error as { body?: { error?: { code?: string; message?: string } } }).body;
        const statusCode = (error as { statusCode?: number }).statusCode;

        Logger.error("WizardApply", `Failed to create ${assignmentType} assignment after retries:`, err);
        Logger.error("WizardApply", `Payload was: ${JSON.stringify(payload, null, 2)}`);
        if (errorBody) {
            Logger.error("WizardApply", `Error body: ${JSON.stringify(errorBody, null, 2)}`);
        }

        // Check if assignment already exists - treat as warning, not error
        const errorCode = errorBody?.error?.code;
        if (errorCode === "RoleAssignmentAlreadyExists") {
            Logger.info("WizardApply", `Assignment already exists, skipping: ${roleDefinitionId}:${principalId}`);
            return {
                success: true, // Treat as success since end result is the same
                operation: `create${assignmentType === "eligible" ? "Eligible" : "Active"}Assignment`,
                targetId: `${roleDefinitionId}:${principalId}`,
                warning: "Assignment already exists - skipped",
                retryable: false
            };
        }

        // Extract meaningful error message
        const errorMessage = errorBody?.error?.message || err.message;

        return {
            success: false,
            operation: `create${assignmentType === "eligible" ? "Eligible" : "Active"}Assignment`,
            targetId: `${roleDefinitionId}:${principalId}`,
            error: errorMessage,
            retryable: statusCode === 429 || (statusCode !== undefined && statusCode >= 500)
        };
    }
}

/**
 * Creates a PIM Group assignment
 * Note: Uses accessId instead of roleDefinitionId
 */
async function createGroupAssignment(
    client: Client,
    groupId: string,
    principalId: string,
    accessType: "member" | "owner",
    assignmentType: "eligible" | "active",
    config: AssignmentConfig,
    allowPermanent: boolean,
    policyMaxDuration?: string
): Promise<ApplyOperationResult> {
    const endpoint = assignmentType === "eligible"
        ? "/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests"
        : "/identityGovernance/privilegedAccess/group/assignmentScheduleRequests";

    // Ensure proper UTC ISO format for timestamps
    let startDateTime: string;
    if (config.startDateTime) {
        startDateTime = new Date(config.startDateTime).toISOString();
    } else {
        startDateTime = new Date().toISOString();
    }

    const scheduleInfo: Record<string, any> = {
        startDateTime: startDateTime,
    };

    // Handle expiration - same logic as directory role assignments
    let usedFallbackDuration: string | undefined;
    if (config.duration === "permanent") {
        if (allowPermanent) {
            // Policy permits NoExpiration — use it as requested
            scheduleInfo.expiration = { type: "NoExpiration" };
        } else {
            // Policy requires expiration — use the policy's own maximum duration as fallback
            const absoluteDefault = assignmentType === "active" ? DEFAULT_DURATIONS.newAssignmentActive : DEFAULT_DURATIONS.newAssignmentEligible;
            const fallback = policyMaxDuration || absoluteDefault;
            Logger.warn("WizardApply", `Permanent requested but policy disallows NoExpiration for group — falling back to ${fallback}`);
            scheduleInfo.expiration = { type: "AfterDuration", duration: fallback };
            usedFallbackDuration = fallback;
        }
    } else if (config.endDateTime) {
        scheduleInfo.expiration = {
            type: "AfterDateTime",
            endDateTime: new Date(config.endDateTime).toISOString()
        };
    } else {
        // Default duration - same logic as directory roles
        // Active: 15 days, Eligible: 180 days
        const defaultDuration = assignmentType === "active" ? DEFAULT_DURATIONS.newAssignmentActive : DEFAULT_DURATIONS.newAssignmentEligible;
        scheduleInfo.expiration = { type: "AfterDuration", duration: defaultDuration };
    }

    const payload = {
        accessId: accessType, // NOT roleDefinitionId!
        action: "adminAssign",
        justification: config.justification || "Configured via PIM Manager",
        groupId: groupId,
        principalId: principalId,
        scheduleInfo: scheduleInfo
    };

    try {
        // Wrap in retry logic to handle transient failures (429, 503, 500+)
        await withRetry(
            () => client.api(endpoint).post(payload),
            3,
            1000,
            `createGroup${accessType}Assignment:${groupId}:${principalId}`
        );

        return {
            success: true,
            operation: `createGroup${accessType === "member" ? "Member" : "Owner"}Assignment`,
            targetId: `${groupId}:${principalId}`,
            warning: usedFallbackDuration
                ? `Permanent duration not allowed by policy — assignment created with expiry: ${usedFallbackDuration}`
                : undefined,
            retryable: false
        };
    } catch (error: unknown) {
        // Enhanced error logging for debugging
        const err = error instanceof Error ? error : new Error(String(error));
        const errorBody = (error as { body?: { error?: { code?: string; message?: string } } }).body;
        const statusCode = (error as { statusCode?: number }).statusCode;

        Logger.error("WizardApply", `Failed to create group ${accessType} assignment after retries:`, err);
        Logger.error("WizardApply", `Payload was: ${JSON.stringify(payload, null, 2)}`);
        if (errorBody) {
            Logger.error("WizardApply", `Error body: ${JSON.stringify(errorBody, null, 2)}`);
        }

        // Check if assignment already exists - treat as warning, not error
        const errorCode = errorBody?.error?.code;
        if (errorCode === "RoleAssignmentAlreadyExists") {
            Logger.info("WizardApply", `Group assignment already exists, skipping: ${groupId}:${principalId}`);
            return {
                success: true, // Treat as success since end result is the same
                operation: `createGroup${accessType === "member" ? "Member" : "Owner"}Assignment`,
                targetId: `${groupId}:${principalId}`,
                warning: "Assignment already exists - skipped",
                retryable: false
            };
        }

        // Extract meaningful error message
        const errorMessage = errorBody?.error?.message || err.message;

        return {
            success: false,
            operation: `createGroup${accessType === "member" ? "Member" : "Owner"}Assignment`,
            targetId: `${groupId}:${principalId}`,
            error: errorMessage,
            retryable: statusCode === 429 || (statusCode !== undefined && statusCode >= 500)
        };
    }
}

// ============================================================================
// Main Apply Functions
// ============================================================================

/**
 * Apply policies for Directory Roles
 * Uses the existing updatePimPolicy function which is already tested and working.
 */
export async function applyDirectoryRolePolicies(
    client: Client,
    roleIds: string[],
    policy: PolicySettings,
    onProgress?: ApplyProgressCallback
): Promise<ApplyOperationResult[]> {
    // Import the working updatePimPolicy function dynamically to avoid circular deps
    const { updatePimPolicy } = await import('./pimConfigurationService');

    const results: ApplyOperationResult[] = [];
    const totalOperations = roleIds.length;
    let completed = 0;

    // Convert our PolicySettings to the RoleSettings format expected by updatePimPolicy
    // NOTE: updatePimPolicy expects HUMAN READABLE strings like "1 Month", not ISO "P1M"
    const roleSettings = {
        activation: {
            maxDuration: parseHours(policy.maxActivationDuration) || 8,
            requireMfa: policy.activationRequirement === "mfa" ? "AzureMFA" as const :
                policy.activationRequirement === "authenticationContext" ? "ConditionalAccess" as const : "None" as const,
            authContextId: policy.authenticationContextId,
            requireJustification: policy.requireJustificationOnActivation,
            requireTicketInfo: policy.requireTicketInfo || false,
            requireApproval: policy.requireApproval,
            approvers: (policy.approvers || []).map(a => ({
                id: a.id,
                type: a.type,
                displayName: a.displayName || ""
            }))
        },
        assignment: {
            allowPermanentEligible: policy.allowPermanentEligible,
            // Convert ISO duration (P1M) to human readable (1 Month) for updatePimPolicy
            expireEligibleAfter: formatDuration(policy.eligibleExpiration) || "1 Year",
            allowPermanentActive: policy.allowPermanentActive,
            expireActiveAfter: formatDuration(policy.activeExpiration) || "6 Months",
            requireMfaOnActive: policy.requireMfaOnActiveAssignment,
            requireJustificationOnActive: policy.requireJustificationOnActiveAssignment
        },
        notification: transformNotifications(policy.notifications)
    };

    for (const roleId of roleIds) {
        onProgress?.("policies", completed, totalOperations, `Updating policy for role`);

        try {
            // Wrap in retry logic to handle transient failures (429, 503, 500+)
            await withRetry(
                () => updatePimPolicy(client, roleId, roleSettings),
                3,
                1000,
                `updatePolicy:${roleId}`
            );

            results.push({
                success: true,
                operation: "updatePolicy",
                targetId: roleId,
                retryable: false
            });
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            const statusCode = (error as { statusCode?: number }).statusCode;
            Logger.error("WizardApply", `Failed to update policy for role ${roleId} after retries:`, err);
            results.push({
                success: false,
                operation: "updatePolicy",
                targetId: roleId,
                error: err.message,
                retryable: false // Already retried, don't flag as retryable
            });
        }

        completed++;
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    onProgress?.("policies", totalOperations, totalOperations, "Policy updates complete");

    // Clear policy cache after updates so next fetch gets fresh data
    clearPolicyCache();
    Logger.debug("WizardApply", "Policy cache cleared after Directory Role policy updates");

    return results;
}

/**
 * Transform PolicySettings notifications to RoleSettings notification format
 * - PolicySettings uses "activation", RoleSettings uses "eligibleActivation"
 * - PolicySettings uses string for additionalRecipients, RoleSettings uses string[]
 */
function transformNotifications(input?: PolicySettings["notifications"]): import("@/types").RoleSettings["notification"] {
    const defaultRecipient = { isEnabled: true, additionalRecipients: [] as string[], criticalOnly: false };

    if (!input) {
        return {
            eligibleAssignment: { admin: defaultRecipient, assignee: defaultRecipient, approver: { ...defaultRecipient, isEnabled: false } },
            activeAssignment: { admin: defaultRecipient, assignee: defaultRecipient, approver: { ...defaultRecipient, isEnabled: false } },
            eligibleActivation: { admin: defaultRecipient, requestor: defaultRecipient, approver: { ...defaultRecipient, isEnabled: false } }
        };
    }

    const toArray = (s: string): string[] => s ? s.split(";").map(e => e.trim()).filter(Boolean) : [];

    const transformRecipient = (r: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean }) => ({
        isEnabled: r.isEnabled,
        additionalRecipients: toArray(r.additionalRecipients),
        criticalOnly: r.criticalOnly
    });

    return {
        eligibleAssignment: {
            admin: transformRecipient(input.eligibleAssignment.admin),
            assignee: transformRecipient(input.eligibleAssignment.assignee),
            approver: transformRecipient(input.eligibleAssignment.approver)
        },
        activeAssignment: {
            admin: transformRecipient(input.activeAssignment.admin),
            assignee: transformRecipient(input.activeAssignment.assignee),
            approver: transformRecipient(input.activeAssignment.approver)
        },
        eligibleActivation: {
            admin: transformRecipient(input.activation.admin),
            requestor: transformRecipient(input.activation.requestor),
            approver: transformRecipient(input.activation.approver)
        }
    };
}

/**
 * Apply policies for PIM Groups
 */
export async function applyGroupPolicies(
    client: Client,
    groupIds: string[],
    policy: PolicySettings,
    accessType: "member" | "owner",
    onProgress?: ApplyProgressCallback
): Promise<ApplyOperationResult[]> {
    const results: ApplyOperationResult[] = [];
    const ruleUpdates = mapPolicyToRuleUpdates(policy);
    const totalOperations = groupIds.length * ruleUpdates.length;
    let completed = 0;

    for (const groupId of groupIds) {
        // Get policy ID for this group and access type
        const policyId = await getPolicyId(client, groupId, "Group", accessType);

        if (!policyId) {
            results.push({
                success: false,
                operation: "getPolicyId",
                targetId: `${groupId}:${accessType}`,
                error: `Could not find ${accessType} policy for group`,
                retryable: false
            });
            continue;
        }

        for (const ruleUpdate of ruleUpdates) {
            onProgress?.("policies", completed, totalOperations, `Updating ${ruleUpdate.ruleId} for group`);

            const result = await updatePolicyRule(client, policyId, ruleUpdate);
            result.targetId = `${groupId}:${accessType}:${ruleUpdate.ruleId}`;
            results.push(result);

            completed++;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    onProgress?.("policies", totalOperations, totalOperations, "Policy updates complete");

    // Clear policy cache after updates so next fetch gets fresh data
    clearPolicyCache();
    Logger.debug("WizardApply", "Policy cache cleared after PIM Group policy updates");

    return results;
}

/**
 * Create Directory Role assignments
 * Uses worker pool pattern for batched parallel requests (8 workers, 300ms delay)
 */
export async function applyDirectoryRoleAssignments(
    client: Client,
    roleIds: string[],
    assignment: AssignmentConfig,
    allowPermanent: boolean,
    policyMaxDuration?: string,
    onProgress?: ApplyProgressCallback
): Promise<ApplyOperationResult[]> {
    // Build list of all operations to perform
    interface AssignmentOperation {
        roleId: string;
        principalId: string;
    }

    const operations: AssignmentOperation[] = [];
    for (const roleId of roleIds) {
        for (const principalId of assignment.principalIds) {
            operations.push({ roleId, principalId });
        }
    }

    const totalOperations = operations.length;
    const failedOperations: Array<{operation: AssignmentOperation; error: string}> = [];

    // Use worker pool for batched parallel execution
    // Assignment endpoints are throttled the same as policy endpoints — use 4/500ms to reduce 429s
    const poolResult = await runWorkerPool<AssignmentOperation, ApplyOperationResult>({
        items: operations,
        workerCount: 4,
        delayMs: 500,
        processor: async (operation, workerId) => {
            Logger.debug("AssignmentWorker", `Worker ${workerId} processing ${operation.roleId} for ${operation.principalId}`);

            const result = await createDirectoryRoleAssignment(
                client,
                operation.roleId,
                operation.principalId,
                assignment.assignmentType,
                assignment,
                allowPermanent,
                policyMaxDuration
            );

            return result;
        },
        onProgress: (current, total) => {
            onProgress?.("assignments", current, total, `Creating assignment ${current}/${total}`);
        },
        onItemError: (item, error) => {
            failedOperations.push({ operation: item, error });
        }
    });

    onProgress?.("assignments", totalOperations, totalOperations, "Assignments complete");

    // Convert Map to array and add failed operations
    const allResults: ApplyOperationResult[] = Array.from(poolResult.results.values());

    // Add error results
    failedOperations.forEach(({ operation, error }) => {
        allResults.push({
            success: false,
            operation: "createAssignment",
            targetId: operation.roleId,
            error: `Failed for principal ${operation.principalId}: ${error}`,
            retryable: error.includes('429') || error.includes('503')
        });
    });

    return allResults;
}

/**
 * Create PIM Group assignments
 * Uses worker pool pattern for batched parallel requests (8 workers, 300ms delay)
 */
export async function applyGroupAssignments(
    client: Client,
    groupIds: string[],
    assignment: AssignmentConfig,
    allowPermanent: boolean,
    policyMaxDuration?: string,
    onProgress?: ApplyProgressCallback
): Promise<ApplyOperationResult[]> {
    const accessType = assignment.accessType || "member";

    // Build list of all operations to perform
    interface GroupAssignmentOperation {
        groupId: string;
        principalId: string;
        accessType: "member" | "owner";
    }

    const operations: GroupAssignmentOperation[] = [];
    for (const groupId of groupIds) {
        for (const principalId of assignment.principalIds) {
            operations.push({ groupId, principalId, accessType });
        }
    }

    const totalOperations = operations.length;
    const failedOperations: Array<{operation: GroupAssignmentOperation; error: string}> = [];

    // Use worker pool for batched parallel execution
    // Assignment endpoints are throttled the same as policy endpoints — use 4/500ms to reduce 429s
    const poolResult = await runWorkerPool<GroupAssignmentOperation, ApplyOperationResult>({
        items: operations,
        workerCount: 4,
        delayMs: 500,
        processor: async (operation, workerId) => {
            Logger.debug("GroupAssignmentWorker", `Worker ${workerId} processing ${operation.groupId} for ${operation.principalId} (${operation.accessType})`);

            const result = await createGroupAssignment(
                client,
                operation.groupId,
                operation.principalId,
                operation.accessType,
                assignment.assignmentType,
                assignment,
                allowPermanent,
                policyMaxDuration
            );

            return result;
        },
        onProgress: (current, total) => {
            onProgress?.("assignments", current, total, `Creating ${accessType} assignment ${current}/${total}`);
        },
        onItemError: (item, error) => {
            failedOperations.push({ operation: item, error });
        }
    });

    onProgress?.("assignments", totalOperations, totalOperations, "Assignments complete");

    // Convert Map to array and add failed operations
    const allResults: ApplyOperationResult[] = Array.from(poolResult.results.values());

    // Add error results
    failedOperations.forEach(({ operation, error }) => {
        allResults.push({
            success: false,
            operation: "createGroupAssignment",
            targetId: operation.groupId,
            error: `Failed for principal ${operation.principalId} (${operation.accessType}): ${error}`,
            retryable: error.includes('429') || error.includes('503')
        });
    });

    return allResults;
}

/**
 * Apply Directory Role Removals
 */
export async function applyDirectoryRoleRemovals(
    client: Client,
    roleId: string,
    removals: AssignmentRemoval[],
    onProgress?: (current: number, total: number) => void
): Promise<ApplyPhaseResult> {
    const { removePimAssignment } = await import('./pimConfigurationService');

    const result: ApplyPhaseResult = {
        policiesUpdated: 0,
        policiesFailed: 0,
        assignmentsCreated: 0,
        assignmentsFailed: 0,
        removalsCompleted: 0,
        removalsFailed: 0,
        operations: [],
        errors: []
    };

    for (let i = 0; i < removals.length; i++) {
        onProgress?.(i + 1, removals.length);

        try {
            // Wrap in retry logic to handle transient failures (429, 503, 500+)
            await withRetry(
                () => removePimAssignment(client, removals[i]),
                3,
                1000,
                `removeAssignment:${removals[i].principalId}`
            );
            result.removalsCompleted++;
            result.operations.push({
                success: true,
                operation: "Removal",
                targetId: removals[i].principalId,
                retryable: false
            });
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
        } catch (error: unknown) {
            result.removalsFailed++;
            const err = error instanceof Error ? error : new Error(String(error));
            const errorMessage = `Failed to remove ${removals[i].principalId} after retries: ${err.message}`;
            result.errors.push(errorMessage);
            result.operations.push({
                success: false,
                operation: "Removal",
                targetId: removals[i].principalId,
                error: errorMessage,
                retryable: false // Already retried
            });
            Logger.error("wizardApplyService", errorMessage, err);
        }
    }

    return result;
}

/**
 * Apply PIM Group Removals
 */
export async function applyGroupRemovals(
    client: Client,
    groupId: string,
    removals: AssignmentRemoval[],
    onProgress?: (current: number, total: number) => void
): Promise<ApplyPhaseResult> {
    const { removePimGroupAssignment } = await import('./pimConfigurationService');

    const result: ApplyPhaseResult = {
        policiesUpdated: 0,
        policiesFailed: 0,
        assignmentsCreated: 0,
        assignmentsFailed: 0,
        removalsCompleted: 0,
        removalsFailed: 0,
        operations: [],
        errors: []
    };

    for (let i = 0; i < removals.length; i++) {
        onProgress?.(i + 1, removals.length);

        try {
            await withRetry(
                () => removePimGroupAssignment(client, removals[i]),
                3,
                1000,
                `removeGroupAssignment:${removals[i].principalId}`
            );
            result.removalsCompleted++;
            result.operations.push({
                success: true,
                operation: "Removal",
                targetId: removals[i].principalId,
                retryable: false
            });
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error: unknown) {
            result.removalsFailed++;
            const err = error instanceof Error ? error : new Error(String(error));
            const errorMessage = `Failed to remove ${removals[i].principalId}: ${err.message}`;
            result.errors.push(errorMessage);
            result.operations.push({
                success: false,
                operation: "Removal",
                targetId: removals[i].principalId,
                error: errorMessage,
                retryable: true
            });
            Logger.error("wizardApplyService", errorMessage, err);
        }
    }

    return result;
}

// ============================================================================
// Bulk Removal Types & Functions
// ============================================================================

/**
 * Apply bulk role assignment removals via adminRemove action.
 * The Graph API resolves the active schedule from principalId + roleDefinitionId + scopeId.
 */
export async function applyBulkRoleRemovals(
    client: Client,
    removals: BulkRemovalRequest[],
    onProgress?: (current: number, total: number) => void
): Promise<ApplyOperationResult[]> {
    const results: ApplyOperationResult[] = [];

    for (let i = 0; i < removals.length; i++) {
        onProgress?.(i + 1, removals.length);
        const removal = removals[i];
        const endpoint = removal.assignmentType === "eligible"
            ? "/roleManagement/directory/roleEligibilityScheduleRequests"
            : "/roleManagement/directory/roleAssignmentScheduleRequests";

        try {
            await withRetry(
                () => client.api(endpoint).version("beta").post({
                    action: "adminRemove",
                    principalId: removal.principalId,
                    roleDefinitionId: removal.roleDefinitionId,
                    directoryScopeId: removal.directoryScopeId ?? "/",
                    justification: "Bulk removal via PIM Manager"
                }),
                3,
                1000,
                `bulkRoleRemoval:${removal.principalId}`
            );
            results.push({
                success: true,
                operation: "BulkRoleRemoval",
                targetId: removal.principalId,
                retryable: false
            });
            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            const isNotFound = err.message.includes("ResourceNotFound") || err.message.includes("404");
            results.push({
                success: isNotFound, // already removed is not a failure
                operation: "BulkRoleRemoval",
                targetId: removal.principalId,
                warning: isNotFound ? "Assignment not found — may have already been removed" : undefined,
                error: isNotFound ? undefined : err.message,
                retryable: false
            });
            Logger.error("wizardApplyService", `Bulk role removal failed for ${removal.principalId}:`, err);
        }
    }

    return results;
}

/**
 * Apply bulk group assignment removals via adminRemove action.
 */
export async function applyBulkGroupRemovals(
    client: Client,
    removals: BulkRemovalRequest[],
    onProgress?: (current: number, total: number) => void
): Promise<ApplyOperationResult[]> {
    const results: ApplyOperationResult[] = [];

    for (let i = 0; i < removals.length; i++) {
        onProgress?.(i + 1, removals.length);
        const removal = removals[i];
        const endpoint = removal.assignmentType === "eligible"
            ? "/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests"
            : "/identityGovernance/privilegedAccess/group/assignmentScheduleRequests";

        try {
            await withRetry(
                () => client.api(endpoint).version("beta").post({
                    action: "adminRemove",
                    groupId: removal.groupId,
                    principalId: removal.principalId,
                    accessId: removal.accessType,
                    justification: "Bulk removal via PIM Manager"
                }),
                3,
                1000,
                `bulkGroupRemoval:${removal.principalId}`
            );
            results.push({
                success: true,
                operation: "BulkGroupRemoval",
                targetId: removal.principalId,
                retryable: false
            });
            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            const isNotFound = err.message.includes("ResourceNotFound") || err.message.includes("404");
            results.push({
                success: isNotFound,
                operation: "BulkGroupRemoval",
                targetId: removal.principalId,
                warning: isNotFound ? "Assignment not found — may have already been removed" : undefined,
                error: isNotFound ? undefined : err.message,
                retryable: false
            });
            Logger.error("wizardApplyService", `Bulk group removal failed for ${removal.principalId}:`, err);
        }
    }

    return results;
}

/**
 * Aggregate results into a summary
 */
export function aggregateResults(operations: ApplyOperationResult[]): ApplyPhaseResult {
    const policyOps = operations.filter(o => o.operation.includes("Policy") || o.operation.includes("Rule"));
    const assignmentOps = operations.filter(o => o.operation.includes("Assignment") || o.operation.includes("assignment"));
    const removalOps = operations.filter(o => o.operation.includes("Removal") || o.operation.includes("removal"));

    return {
        policiesUpdated: policyOps.filter(o => o.success).length,
        policiesFailed: policyOps.filter(o => !o.success).length,
        assignmentsCreated: assignmentOps.filter(o => o.success).length,
        assignmentsFailed: assignmentOps.filter(o => !o.success).length,
        removalsCompleted: removalOps.filter(o => o.success).length,
        removalsFailed: removalOps.filter(o => !o.success).length,
        operations: operations,
        errors: operations.filter(o => !o.success).map(o => o.error || "Unknown error")
    };
}
