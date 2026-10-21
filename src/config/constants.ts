export const GRAPH_LOCALE = 'en-US';

export const PIM_URLS = {
    roleDefinitions: '/roleManagement/directory/roleDefinitions',
    roleEligibilitySchedules: '/roleManagement/directory/roleEligibilitySchedules',
    roleAssignmentSchedules: '/roleManagement/directory/roleAssignmentSchedules',
    roleAssignmentScheduleInstances: '/roleManagement/directory/roleAssignmentScheduleInstances',
    roleAssignments: '/roleManagement/directory/roleAssignments',
    roleEligibilityScheduleRequests: '/roleManagement/directory/roleEligibilityScheduleRequests',
    roleAssignmentScheduleRequests: '/roleManagement/directory/roleAssignmentScheduleRequests',
    roleManagementPolicyAssignments: '/policies/roleManagementPolicyAssignments',
    roleManagementPolicies: '/policies/roleManagementPolicies',
    // Beta: roleManagementAlerts has no v1.0 equivalent (Microsoft Learn documents it in beta only, checked 2026-10-15)
    alerts: 'https://graph.microsoft.com/beta/identityGovernance/roleManagementAlerts/alerts',
    // PIM for Groups endpoints
    groupEligibilityScheduleRequests: '/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests',
    groupAssignmentScheduleRequests: '/identityGovernance/privilegedAccess/group/assignmentScheduleRequests',
    groupEligibilitySchedules: '/identityGovernance/privilegedAccess/group/eligibilitySchedules',
    groupAssignmentSchedules: '/identityGovernance/privilegedAccess/group/assignmentSchedules',
    // PIM Custom Extensions (Preview), beta only
    customExtensions: '/identityGovernance/privilegedAccess/customExtensions',
};

// PIM Custom Extensions (Preview): the policy rule that links an extension to a
// role or group policy. Both slots are present on every policy in tenants where
// the preview is rolled out, whether or not an extension is linked.
export const CUSTOM_EXTENSION_RULE_TYPE = '#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule';
export const CUSTOM_EXTENSION_RULE_IDS = {
    preApproval: 'CustomExtension_PreApproval_EndUser_Assignment',
    postApproval: 'CustomExtension_PostApproval_EndUser_Assignment',
} as const;
export const CUSTOM_EXTENSION_SCOPES = {
    read: 'PrivilegedAccess-CustomExt.Read.All',
    readWrite: 'PrivilegedAccess-CustomExt.ReadWrite.All',
} as const;

// Re-export expiration options from centralized utility
export { EXPIRATION_OPTIONS } from '@/utils/durationUtils';

// Alias exports for backward compatibility
export { EXPIRATION_OPTIONS as ELIGIBLE_EXPIRATION_OPTIONS } from '@/utils/durationUtils';
export { EXPIRATION_OPTIONS as ACTIVE_EXPIRATION_OPTIONS } from '@/utils/durationUtils';

/** Public documentation (the docs folder of the repository), linked from the account menu. */
export const DOCUMENTATION_URL = "https://github.com/0125joel/PIM-Manager/tree/main/docs/en";

/** Delegated permission for the PIM security alerts of the dashboard (optional, incremental consent). */
export const ALERTS_PERMISSION = "RoleManagementAlert.Read.Directory";

/**
 * Delegated permission for the optional Conditional Access check of Configure (spec 12.5): which policies stand behind
 * an authentication context. Asked on demand; reading also needs an active Security Reader, Global Reader, Security
 * Administrator, Conditional Access Administrator, Global Administrator or similar role (T7).
 */
export const CONDITIONAL_ACCESS_PERMISSION = "Policy.Read.All";

/**
 * The appId of Microsoft's global "Microsoft Copilot Studio agent identity blueprint": an agent identity whose
 * agentIdentityBlueprintId is this id was made by Copilot Studio. Source: Learn, "Manage Entra Agent IDs" (Copilot Studio).
 */
export const COPILOT_STUDIO_BLUEPRINT_APP_ID = "25664c89-cea5-4ab6-b924-a54fd8a19ae0";
