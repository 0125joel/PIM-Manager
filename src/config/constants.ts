export const GRAPH_LOCALE = 'en-US';

export const PIM_URLS = {
    roleDefinitions: '/roleManagement/directory/roleDefinitions',
    roleEligibilitySchedules: '/roleManagement/directory/roleEligibilitySchedules',
    roleAssignmentSchedules: '/roleManagement/directory/roleAssignmentSchedules',
    roleAssignments: '/roleManagement/directory/roleAssignments',
    roleEligibilityScheduleRequests: '/roleManagement/directory/roleEligibilityScheduleRequests',
    roleAssignmentScheduleRequests: '/roleManagement/directory/roleAssignmentScheduleRequests',
    roleManagementPolicyAssignments: '/policies/roleManagementPolicyAssignments',
    roleManagementPolicies: '/policies/roleManagementPolicies',
    alerts: 'https://graph.microsoft.com/beta/identityGovernance/roleManagementAlerts/alerts',
    // PIM Groups endpoints
    groupEligibilityScheduleRequests: '/identityGovernance/privilegedAccess/group/eligibilityScheduleRequests',
    groupAssignmentScheduleRequests: '/identityGovernance/privilegedAccess/group/assignmentScheduleRequests',
    groupEligibilitySchedules: '/identityGovernance/privilegedAccess/group/eligibilitySchedules',
    groupAssignmentSchedules: '/identityGovernance/privilegedAccess/group/assignmentSchedules',
};

// Re-export expiration options from centralized utility
export { EXPIRATION_OPTIONS } from '@/utils/durationUtils';

// Alias exports for backward compatibility
export { EXPIRATION_OPTIONS as ELIGIBLE_EXPIRATION_OPTIONS } from '@/utils/durationUtils';
export { EXPIRATION_OPTIONS as ACTIVE_EXPIRATION_OPTIONS } from '@/utils/durationUtils';
