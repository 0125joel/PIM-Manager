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
import { mapGraphError, describePolicyRuleId } from "@/utils/graphErrorMapping";
import { escapeODataString } from "@/utils/odataUtils";

/**
 * Format a friendly error string from a Graph error, optionally prefixed with
 * a remediation hint. ApplyStep renders this verbatim under each failed op.
 */
function friendlyError(rawError: unknown, context?: "policy" | "assignment" | "removal"): string {
    const mapped = mapGraphError(rawError, context);
    return mapped.remediation
        ? `${mapped.friendlyMessage} ${mapped.remediation}`
        : mapped.friendlyMessage;
}

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
    // approvalMode must be explicit — omitting it when isApprovalRequired:false caused
    // "The policy is invalid." for PIM Groups. fallbackPrimaryApprovers and
    // fallbackEscalationApprovers are NOT in the v1.0 unifiedApprovalStage schema and
    // cause "The policy rule is invalid." if included.
    rules.push({
        ruleId: "Approval_EndUser_Assignment",
        odataType: "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
        payload: {
            id: "Approval_EndUser_Assignment",
            setting: {
                isApprovalRequired: policy.requireApproval,
                approvalMode: policy.requireApproval ? "SingleStage" : "NoApproval",
                isApprovalRequiredForExtension: false,
                isRequestorJustificationRequired: true,
                // "The policy is invalid." when approvalStages:[] even with NoApproval mode.
                // Always include a stage; use empty primaryApprovers when approval is off.
                approvalStages: [{
                    approvalStageTimeOutInDays: 1,
                    isApproverJustificationRequired: true,
                    escalationTimeInMinutes: 0,
                    isEscalationEnabled: false,
                    primaryApprovers: policy.requireApproval && policy.approvers?.length
                        ? policy.approvers.map(a => ({
                            "@odata.type": a.type === "user"
                                ? "#microsoft.graph.singleUser"
                                : "#microsoft.graph.groupMembers",
                            [a.type === "user" ? "userId" : "groupId"]: a.id,
                            description: a.displayName || ""
                        }))
                        : [],
                    escalationApprovers: []
                }],
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
            error: friendlyError(error, "policy"),
            retryable: false // already retried
        };
    }
}

/**
 * Pre-flight: check whether an eligible or active schedule already exists for
 * a principal+role+scope combo. Returns true if a schedule is found (meaning
 * the assignment is already in place and the create can be skipped).
 */
async function scheduleExists(
    client: Client,
    readEndpoint: string,
    filter: string,
): Promise<boolean> {
    try {
        const result = await withRetry(
            () => client.api(`${readEndpoint}?$filter=${encodeURIComponent(filter)}&$top=1&$select=id`).get(),
            3, 1000, `scheduleExists`
        ) as { value?: unknown[] };
        return Array.isArray(result.value) && result.value.length > 0;
    } catch {
        // If the read fails (e.g. 403, network error) assume no schedule exists
        // so the create attempt can proceed and fail with a clearer error.
        return false;
    }
}

/**
 * Pre-flight: check whether a non-terminal schedule REQUEST already exists.
 * Accepts a pre-built OData filter so it works for both directory role and
 * PIM Groups request endpoints.
 *
 * Graph does not support 'ne' filter operators on the status field, so we
 * fetch up to 20 recent requests without a status filter and check terminal
 * vs non-terminal in memory.
 *
 * A failed POST can leave a record in Provisioning/PendingScheduleCreation
 * state. The next attempt then fails with "role assignment id X is invalid"
 * because Graph sees the pending request as a conflict.
 */
async function pendingScheduleRequestExists(
    client: Client,
    requestEndpoint: string,
    filter: string,
    logContext: string,
): Promise<{ exists: boolean; status?: string }> {
    // "Granted" and "Provisioned" are completed states. They represent requests
    // that succeeded in the past. Treating them as non-terminal would cause
    // pass 3 to false-positive on stale request records when the actual
    // schedule no longer exists (expired or deleted), blocking a new create.
    const TERMINAL_STATUSES = new Set(["Denied", "Canceled", "Failed", "Revoked", "Granted", "Provisioned"]);
    try {
        const result = await withRetry(
            () => client.api(`${requestEndpoint}?$filter=${encodeURIComponent(filter)}&$top=20&$select=id,status&$orderby=createdDateTime desc`).get(),
            3, 1000, `pendingCheck:${logContext}`
        ) as { value?: { id: string; status: string }[] };
        if (!Array.isArray(result.value)) return { exists: false };
        if (result.value.length > 0) {
            Logger.info("WizardApply", `Pre-flight request history (${result.value.length} records) for ${logContext}: ${result.value.map(r => r.status).join(", ")}`);
        }
        const active = result.value.find(r => !TERMINAL_STATUSES.has(r.status));
        if (active) return { exists: true, status: active.status };
        return { exists: false };
    } catch (err) {
        Logger.warn("WizardApply", `pendingScheduleRequestExists query failed for ${logContext}: ${err instanceof Error ? err.message : String(err)}`);
        return { exists: false };
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
            // Graph requires day-format durations (e.g. P365D, not P1Y) for schedule requests,
            // same constraint as the policy PATCH path. policyMaxDuration arrives as the ISO
            // form stored in PolicySettings (P1Y, P6M, ...), so convert before sending.
            const fallback = toGraphDuration(policyMaxDuration || absoluteDefault);
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

    const opName = `create${assignmentType === "eligible" ? "Eligible" : "Active"}Assignment`;
    const directoryScopeId = config.directoryScopeId || "/";

    // Pre-flight pass 1: check finalized schedules (roleEligibilitySchedules /
    // roleAssignmentSchedules). If the assignment is already in place, skip.
    const readEndpoint = assignmentType === "eligible"
        ? PIM_URLS.roleEligibilitySchedules
        : PIM_URLS.roleAssignmentSchedules;
    const preflightFilter = `principalId eq '${escapeODataString(principalId)}' and roleDefinitionId eq '${escapeODataString(roleDefinitionId)}' and directoryScopeId eq '${escapeODataString(directoryScopeId)}'`;

    Logger.debug("WizardApply", `Pre-flight pass 1 — endpoint: ${readEndpoint} filter: ${preflightFilter}`);
    const alreadyExists = await scheduleExists(client, readEndpoint, preflightFilter);
    Logger.info("WizardApply", `Pre-flight scheduleExists=${alreadyExists} for ${principalId} on ${roleDefinitionId} (${assignmentType})`);
    if (alreadyExists) {
        return {
            success: true,
            operation: opName,
            targetId: `${roleDefinitionId}:${principalId}`,
            warning: "Assignment already exists. No changes needed.",
            retryable: false,
        };
    }

    // Pre-flight pass 2: if the principal is a group, verify it is role-assignable.
    // Only groups created with isAssignableToRole=true can be used in
    // roleEligibilityScheduleRequests. Regular groups fail every POST with
    // "The role assignment id X is invalid" (changing GUID, all requests end as Failed).
    // Fetching /groups/{id} returns 404 for user principals — treat that as "not a group".
    try {
        const groupInfo = await client
            .api(`/groups/${encodeURIComponent(principalId)}?$select=id,isAssignableToRole`)
            .get() as { isAssignableToRole?: boolean };
        if (!groupInfo.isAssignableToRole) {
            Logger.warn("WizardApply", `Principal ${principalId} is a group but isAssignableToRole=false — assignment blocked`);
            return {
                success: false,
                operation: opName,
                targetId: `${roleDefinitionId}:${principalId}`,
                error: "This group cannot be assigned to a directory role. Only groups created with the 'Role-assignable' property enabled (isAssignableToRole=true) can be made eligible for Entra ID roles. This property is set at group creation and cannot be changed. Create a new role-assignable group in Entra ID and retry.",
                retryable: false,
            };
        }
        Logger.debug("WizardApply", `Principal ${principalId} is a role-assignable group — proceeding`);
    } catch {
        // 404 = user principal (not in /groups), or transient error — proceed normally.
    }

    // Pre-flight pass 3: check schedule REQUESTS for non-terminal entries.
    // A failed POST to roleEligibilityScheduleRequests can leave a record in
    // Provisioning state that blocks all subsequent create attempts, producing
    // the "role assignment id X is invalid" error with a changing GUID each try.
    const requestEndpoint = assignmentType === "eligible"
        ? PIM_URLS.roleEligibilityScheduleRequests
        : PIM_URLS.roleAssignmentScheduleRequests;
    const requestFilter = `principalId eq '${escapeODataString(principalId)}' and roleDefinitionId eq '${escapeODataString(roleDefinitionId)}' and directoryScopeId eq '${escapeODataString(directoryScopeId)}'`;
    const requestLogContext = `${principalId} on ${roleDefinitionId} (${assignmentType})`;
    Logger.debug("WizardApply", `Pre-flight pass 3 — endpoint: ${requestEndpoint} (non-terminal request check)`);
    const pendingReq = await pendingScheduleRequestExists(client, requestEndpoint, requestFilter, requestLogContext);
    Logger.info("WizardApply", `Pre-flight pendingRequest=${pendingReq.exists}${pendingReq.status ? ` (status: ${pendingReq.status})` : ""} for ${requestLogContext}`);
    if (pendingReq.exists) {
        const isComplete = pendingReq.status === "Granted" || pendingReq.status === "Provisioned";
        return {
            success: true,
            operation: opName,
            targetId: `${roleDefinitionId}:${principalId}`,
            warning: isComplete
                ? "Assignment was already processed. No changes needed."
                : `A previous assignment request is still being processed (status: ${pendingReq.status}). It may take a few minutes to activate. Verify the assignment in Entra ID.`,
            retryable: false,
        };
    }

    Logger.info("WizardApply", `Creating ${assignmentType} assignment — principal: ${principalId} role: ${roleDefinitionId} scope: ${directoryScopeId}`);
    Logger.debug("WizardApply", `POST endpoint: ${endpoint} payload: ${JSON.stringify(payload)}`);

    try {
        await withRetry(
            () => client.api(endpoint).post(payload),
            3,
            1000,
            `create${assignmentType}Assignment:${roleDefinitionId}:${principalId}`
        );

        return {
            success: true,
            operation: opName,
            targetId: `${roleDefinitionId}:${principalId}`,
            warning: usedFallbackDuration
                ? `Permanent duration not allowed by policy. Assignment created with expiry: ${usedFallbackDuration}`
                : undefined,
            retryable: false
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        const mapped = mapGraphError(error, "assignment");

        Logger.error("WizardApply", `Failed to create ${assignmentType} assignment — code: ${mapped.rawCode || "none"} — message: ${mapped.rawMessage || err.message}`);
        Logger.error("WizardApply", `Failed payload: ${JSON.stringify(payload)}`);

        // Success-equivalent: assignment already in place (Graph-level duplicate detection)
        if (mapped.classification === "success-equivalent") {
            return {
                success: true,
                operation: opName,
                targetId: `${roleDefinitionId}:${principalId}`,
                warning: mapped.friendlyMessage,
                retryable: false
            };
        }

        // Stale-state fallback: a blocking schedule exists that the pre-flight
        // missed (e.g. created between the pre-flight read and the POST, or in
        // a non-queryable pending state). Wait 5s for Graph to settle, then
        // re-check existence before retrying the create.
        if (mapped.classification === "stale-state") {
            Logger.warn("WizardApply", `Stale-state fallback: waiting 5s before re-checking and retrying for ${principalId} on ${roleDefinitionId}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            const existsNow = await scheduleExists(client, readEndpoint, preflightFilter);
            Logger.debug("WizardApply", `Stale-state re-check scheduleExists=${existsNow} for ${principalId} on ${roleDefinitionId}`);
            if (existsNow) {
                Logger.info("WizardApply", `Stale-state fallback: assignment now exists for ${principalId} on ${roleDefinitionId} — treating as success`);
                return {
                    success: true,
                    operation: opName,
                    targetId: `${roleDefinitionId}:${principalId}`,
                    warning: "Assignment already exists. No changes needed.",
                    retryable: false,
                };
            }

            const pendingNow = await pendingScheduleRequestExists(client, requestEndpoint, requestFilter, requestLogContext);
            Logger.debug("WizardApply", `Stale-state re-check pendingRequest=${pendingNow.exists}${pendingNow.status ? ` (status: ${pendingNow.status})` : ""} for ${requestLogContext}`);
            if (pendingNow.exists) {
                const isComplete = pendingNow.status === "Granted" || pendingNow.status === "Provisioned";
                return {
                    success: true,
                    operation: opName,
                    targetId: `${roleDefinitionId}:${principalId}`,
                    warning: isComplete
                        ? "Assignment was already processed. No changes needed."
                        : `A previous assignment request is still being processed (status: ${pendingNow.status}). It may take a few minutes to activate.`,
                    retryable: false,
                };
            }

            try {
                await withRetry(
                    () => client.api(endpoint).post(payload),
                    2,
                    1000,
                    `retryAfterStale:${roleDefinitionId}:${principalId}`
                );
                Logger.info("WizardApply", `Stale-state retry succeeded for ${principalId} on ${roleDefinitionId}`);
                return {
                    success: true,
                    operation: opName,
                    targetId: `${roleDefinitionId}:${principalId}`,
                    warning: usedFallbackDuration
                        ? `Permanent not allowed by policy. Assignment created with expiry: ${usedFallbackDuration}`
                        : undefined,
                    retryable: false,
                };
            } catch (retryError: unknown) {
                const retryMapped = mapGraphError(retryError, "assignment");
                Logger.warn("WizardApply", `Stale-state retry also failed for ${principalId} on ${roleDefinitionId} — code: ${retryMapped.rawCode || "none"} message: ${retryMapped.rawMessage || String(retryError)}`);
            }
        }

        return {
            success: false,
            operation: opName,
            targetId: `${roleDefinitionId}:${principalId}`,
            error: mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage,
            retryable: mapped.classification === "transient"
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
            // Convert to day-format (P365D etc.) — Graph rejects P1Y/P6M on schedule requests.
            const absoluteDefault = assignmentType === "active" ? DEFAULT_DURATIONS.newAssignmentActive : DEFAULT_DURATIONS.newAssignmentEligible;
            const fallback = toGraphDuration(policyMaxDuration || absoluteDefault);
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

    const opName = `createGroup${accessType === "member" ? "Member" : "Owner"}Assignment`;

    // Shared filter and log context used across both pre-flight passes and stale-state fallback.
    const groupScheduleFilter = `principalId eq '${escapeODataString(principalId)}' and groupId eq '${escapeODataString(groupId)}' and accessId eq '${escapeODataString(accessType)}'`;
    const groupLogContext = `${principalId} on group ${groupId} (${accessType}, ${assignmentType})`;

    // Pre-flight pass 1: check finalized schedules.
    const groupReadEndpoint = assignmentType === "eligible"
        ? PIM_URLS.groupEligibilitySchedules
        : PIM_URLS.groupAssignmentSchedules;

    const alreadyExists = await scheduleExists(client, groupReadEndpoint, groupScheduleFilter);
    Logger.info("WizardApply", `Pre-flight scheduleExists=${alreadyExists} for ${groupLogContext}`);
    if (alreadyExists) {
        return {
            success: true,
            operation: opName,
            targetId: `${groupId}:${principalId}`,
            warning: "Assignment already exists. No changes needed.",
            retryable: false,
        };
    }

    // Pre-flight pass 2: check schedule REQUESTS for non-terminal entries.
    // PIM Groups request endpoints share the same Graph OData engine as directory
    // role endpoints, so failed POSTs can leave Provisioning/PendingScheduleCreation
    // records that block subsequent creates with "role assignment id X is invalid".
    const groupRequestEndpoint = assignmentType === "eligible"
        ? PIM_URLS.groupEligibilityScheduleRequests
        : PIM_URLS.groupAssignmentScheduleRequests;
    Logger.debug("WizardApply", `Pre-flight pass 2 — group endpoint: ${groupRequestEndpoint} (non-terminal request check)`);
    const pendingGroupReq = await pendingScheduleRequestExists(client, groupRequestEndpoint, groupScheduleFilter, groupLogContext);
    Logger.info("WizardApply", `Pre-flight pendingRequest=${pendingGroupReq.exists}${pendingGroupReq.status ? ` (status: ${pendingGroupReq.status})` : ""} for ${groupLogContext}`);
    if (pendingGroupReq.exists) {
        const isComplete = pendingGroupReq.status === "Granted" || pendingGroupReq.status === "Provisioned";
        return {
            success: true,
            operation: opName,
            targetId: `${groupId}:${principalId}`,
            warning: isComplete
                ? "Assignment was already processed. No changes needed."
                : `A previous assignment request is still being processed (status: ${pendingGroupReq.status}). It may take a few minutes to activate. Verify the assignment in Entra ID.`,
            retryable: false,
        };
    }

    Logger.info("WizardApply", `Creating group ${accessType} ${assignmentType} assignment — ${groupLogContext}`);

    try {
        await withRetry(
            () => client.api(endpoint).post(payload),
            3,
            1000,
            `createGroup${accessType}Assignment:${groupId}:${principalId}`
        );

        return {
            success: true,
            operation: opName,
            targetId: `${groupId}:${principalId}`,
            warning: usedFallbackDuration
                ? `Permanent duration not allowed by policy. Assignment created with expiry: ${usedFallbackDuration}`
                : undefined,
            retryable: false
        };
    } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        const mapped = mapGraphError(error, "assignment");

        Logger.error("WizardApply", `Failed to create group ${accessType} assignment — code: ${mapped.rawCode || "none"} — message: ${mapped.rawMessage || err.message}`);
        Logger.error("WizardApply", `Failed payload: ${JSON.stringify(payload)}`);

        if (mapped.classification === "success-equivalent") {
            return {
                success: true,
                operation: opName,
                targetId: `${groupId}:${principalId}`,
                warning: mapped.friendlyMessage,
                retryable: false
            };
        }

        // Stale-state fallback: same approach as directory roles.
        if (mapped.classification === "stale-state") {
            Logger.warn("WizardApply", `Stale-state fallback: waiting 5s before re-checking and retrying for ${groupLogContext}`);
            await new Promise(resolve => setTimeout(resolve, 5000));

            const existsNow = await scheduleExists(client, groupReadEndpoint, groupScheduleFilter);
            Logger.debug("WizardApply", `Stale-state re-check scheduleExists=${existsNow} for ${groupLogContext}`);
            if (existsNow) {
                return {
                    success: true,
                    operation: opName,
                    targetId: `${groupId}:${principalId}`,
                    warning: "Assignment already exists. No changes needed.",
                    retryable: false,
                };
            }

            const pendingNow = await pendingScheduleRequestExists(client, groupRequestEndpoint, groupScheduleFilter, groupLogContext);
            Logger.debug("WizardApply", `Stale-state re-check pendingRequest=${pendingNow.exists}${pendingNow.status ? ` (status: ${pendingNow.status})` : ""} for ${groupLogContext}`);
            if (pendingNow.exists) {
                const isComplete = pendingNow.status === "Granted" || pendingNow.status === "Provisioned";
                return {
                    success: true,
                    operation: opName,
                    targetId: `${groupId}:${principalId}`,
                    warning: isComplete
                        ? "Assignment was already processed. No changes needed."
                        : `A previous assignment request is still being processed (status: ${pendingNow.status}). It may take a few minutes to activate.`,
                    retryable: false,
                };
            }

            try {
                await withRetry(
                    () => client.api(endpoint).post(payload),
                    2,
                    1000,
                    `retryAfterStaleGroup:${groupId}:${principalId}`
                );
                Logger.info("WizardApply", `Stale-state retry succeeded for ${groupLogContext}`);
                return {
                    success: true,
                    operation: opName,
                    targetId: `${groupId}:${principalId}`,
                    warning: usedFallbackDuration
                        ? `Permanent not allowed by policy. Assignment created with expiry: ${usedFallbackDuration}`
                        : undefined,
                    retryable: false,
                };
            } catch (retryError: unknown) {
                const retryMapped = mapGraphError(retryError, "assignment");
                Logger.warn("WizardApply", `Stale-state retry also failed for ${groupLogContext} — code: ${retryMapped.rawCode || "none"} message: ${retryMapped.rawMessage || String(retryError)}`);
            }
        }

        return {
            success: false,
            operation: opName,
            targetId: `${groupId}:${principalId}`,
            error: mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage,
            retryable: mapped.classification === "transient"
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
    const { updatePimPolicy, PolicyRuleUpdateError } = await import('./pimConfigurationService');

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
            const updatedRuleIds = await withRetry(
                () => updatePimPolicy(client, roleId, roleSettings),
                3,
                1000,
                `updatePolicy:${roleId}`
            );

            if (updatedRuleIds && updatedRuleIds.length > 0) {
                for (const ruleId of updatedRuleIds) {
                    results.push({
                        success: true,
                        operation: "updatePolicyRule",
                        targetId: `${roleId}:${ruleId}`,
                        targetName: describePolicyRuleId(ruleId),
                        retryable: false
                    });
                }
            } else {
                // No rules changed — surface a single no-op success so the role still
                // appears in the results list.
                results.push({
                    success: true,
                    operation: "updatePolicy",
                    targetId: roleId,
                    retryable: false
                });
            }
        } catch (error: unknown) {
            const err = error instanceof Error ? error : new Error(String(error));
            Logger.error("WizardApply", `Failed to update policy for role ${roleId} after retries:`, err);

            // If updatePimPolicy reports per-rule failures, surface one operation
            // entry per failing rule so the user sees *which setting* was rejected.
            if (error instanceof PolicyRuleUpdateError) {
                for (const failure of error.ruleFailures) {
                    const mapped = friendlyError(failure.error, "policy");
                    results.push({
                        success: false,
                        operation: "updatePolicyRule",
                        targetId: `${roleId}:${describePolicyRuleId(failure.ruleId)}`,
                        targetName: describePolicyRuleId(failure.ruleId),
                        error: mapped,
                        retryable: false
                    });
                }
            } else {
                const mapped = friendlyError(error, "policy");
                results.push({
                    success: false,
                    operation: "updatePolicy",
                    targetId: roleId,
                    error: mapped,
                    retryable: false
                });
            }
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
            // Friendly per-rule label so the result UI can show e.g.
            // "Activation requirements (MFA, justification, ticket)" instead of
            // "Enablement_EndUser_Assignment".
            result.targetName = `${accessType === "member" ? "Member" : "Owner"} · ${describePolicyRuleId(ruleUpdate.ruleId)}`;
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
            const mapped = mapGraphError(error, "removal");
            // 404 / "does not exist" → assignment was already gone; treat as success.
            if (mapped.classification === "success-equivalent") {
                result.removalsCompleted++;
                result.operations.push({
                    success: true,
                    operation: "Removal",
                    targetId: removals[i].principalId,
                    warning: mapped.friendlyMessage,
                    retryable: false,
                });
                Logger.info("wizardApplyService", `Removal no-op (${mapped.rawCode || "404"}) for ${removals[i].principalId}: ${mapped.friendlyMessage}`);
            } else {
                result.removalsFailed++;
                const friendly = mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage;
                result.errors.push(friendly);
                result.operations.push({
                    success: false,
                    operation: "Removal",
                    targetId: removals[i].principalId,
                    error: friendly,
                    retryable: mapped.classification === "transient",
                });
                Logger.error("wizardApplyService", `Failed to remove ${removals[i].principalId} after retries: ${mapped.rawCode || ""} ${mapped.rawMessage || ""}`);
            }
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
            const mapped = mapGraphError(error, "removal");
            if (mapped.classification === "success-equivalent") {
                result.removalsCompleted++;
                result.operations.push({
                    success: true,
                    operation: "Removal",
                    targetId: removals[i].principalId,
                    warning: mapped.friendlyMessage,
                    retryable: false,
                });
                Logger.info("wizardApplyService", `Group removal no-op (${mapped.rawCode || "404"}) for ${removals[i].principalId}: ${mapped.friendlyMessage}`);
            } else {
                result.removalsFailed++;
                const friendly = mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage;
                result.errors.push(friendly);
                result.operations.push({
                    success: false,
                    operation: "Removal",
                    targetId: removals[i].principalId,
                    error: friendly,
                    retryable: mapped.classification === "transient",
                });
                Logger.error("wizardApplyService", `Failed to remove ${removals[i].principalId}: ${mapped.rawCode || ""} ${mapped.rawMessage || ""}`);
            }
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
            const mapped = mapGraphError(error, "removal");
            const ok = mapped.classification === "success-equivalent";
            results.push({
                success: ok,
                operation: "BulkRoleRemoval",
                targetId: removal.principalId,
                warning: ok ? mapped.friendlyMessage : undefined,
                error: ok ? undefined : (mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage),
                retryable: mapped.classification === "transient",
            });
            Logger.error("wizardApplyService", `Bulk role removal for ${removal.principalId}: ${mapped.rawCode || ""} ${mapped.rawMessage || ""}`);
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
            const mapped = mapGraphError(error, "removal");
            const ok = mapped.classification === "success-equivalent";
            results.push({
                success: ok,
                operation: "BulkGroupRemoval",
                targetId: removal.principalId,
                warning: ok ? mapped.friendlyMessage : undefined,
                error: ok ? undefined : (mapped.remediation ? `${mapped.friendlyMessage} ${mapped.remediation}` : mapped.friendlyMessage),
                retryable: mapped.classification === "transient",
            });
            Logger.error("wizardApplyService", `Bulk group removal for ${removal.principalId}: ${mapped.rawCode || ""} ${mapped.rawMessage || ""}`);
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
