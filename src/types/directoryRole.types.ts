// Comprehensive types for Entra ID Role & PIM data fetching

// Scope Types
export type ScopeType =
    | "tenant-wide"
    | "application"
    | "administrative-unit"
    | "rmau"
    | "specific-object"
    | "unknown";

export interface ScopeInfo {
    type: ScopeType;
    displayName?: string; // Human-readable name (e.g., "Sales Department", "Argos-Dev")
    id?: string; // Scope object ID
    isRestricted?: boolean; // For RMAU detection
}

// Step 1-3: Role Definitions
export interface RoleDefinition {
    id: string;
    displayName: string;
    description: string;
    templateId?: string;
    isBuiltIn: boolean;
    isEnabled?: boolean;
    isPrivileged?: boolean; // Added for privileged role detection
    resourceScopes?: string[];
    rolePermissions?: RolePermission[];
    version?: string;
}

export interface RolePermission {
    allowedResourceActions: string[];
    condition?: string;
}

// Step 4-5: Role Assignments (Permanent)
export interface RoleAssignment {
    id: string;
    roleDefinitionId: string;
    principalId: string;
    directoryScopeId: string;
    appScopeId?: string;
    createdDateTime?: string;
    modifiedDateTime?: string;
    condition?: string;
    conditionVersion?: string;
    principal?: Principal;
    directoryScope?: DirectoryScope;
    scopeInfo?: ScopeInfo; // Enriched scope information
}

export interface Principal {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    "@odata.type": string;
}

export interface DirectoryScope {
    id: string;
    displayName?: string;
    "@odata.type": string;
}

// Step 6-9: PIM Schedules & Instances
export interface PimEligibilitySchedule {
    id: string;
    principalId: string;
    roleDefinitionId: string;
    directoryScopeId: string;
    memberType: string; // "Direct" | "Group"
    status: string;
    scheduleInfo?: ScheduleInfo;
    createdDateTime?: string;
    modifiedDateTime?: string;
    createdUsing?: string;
    principal?: Principal;
    directoryScope?: DirectoryScope;
    scopeInfo?: ScopeInfo; // Enriched scope information
}

export interface PimAssignmentSchedule {
    id: string;
    principalId: string;
    roleDefinitionId: string;
    directoryScopeId: string;
    memberType: string;
    status: string;
    scheduleInfo?: ScheduleInfo;
    assignmentType?: string;
    createdDateTime?: string;
    modifiedDateTime?: string;
    createdUsing?: string;
    principal?: Principal;
    directoryScope?: DirectoryScope;
    scopeInfo?: ScopeInfo; // Enriched scope information
}

export interface ScheduleInfo {
    startDateTime?: string;
    expiration?: ExpirationPattern;
    recurrence?: any;
}

export interface ExpirationPattern {
    type?: string; // "afterDuration" | "afterDateTime" | "noExpiration"
    endDateTime?: string;
    duration?: string;
}

export interface PimScheduleInstance {
    id: string;
    principalId: string;
    roleDefinitionId: string;
    directoryScopeId: string;
    memberType: string;
    startDateTime?: string;
    endDateTime?: string;
    assignmentType?: string;
    roleAssignmentOriginId?: string;
    roleAssignmentScheduleId?: string;
    principal?: Principal;
    directoryScope?: DirectoryScope;
}

// Step 10-12: PIM Policies
export interface PimPolicyAssignment {
    id: string;
    policyId: string;
    scopeId: string;
    scopeType: string;
    roleDefinitionId: string;
    policy?: PimPolicy;
}

export interface PimPolicy {
    id: string;
    displayName?: string;
    description?: string;
    isOrganizationDefault?: boolean;
    lastModifiedDateTime?: string;
    lastModifiedBy?: any;
    rules?: PimPolicyRule[];
}

export interface PimPolicyRule {
    id: string;
    "@odata.type": string;
    target: RuleTarget;
    [key: string]: any; // Additional properties based on rule type
}

export interface RuleTarget {
    caller: string;
    operations: string[];
    level: string;
    targetObjects?: any[];
    inheritableSettings?: any[];
    enforcedSettings?: any[];
}

// Step 13-16: Approvers
export interface ApprovalRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule";
    setting: ApprovalSettings;
}

export interface ApprovalSettings {
    isApprovalRequired: boolean;
    isApprovalRequiredForExtension?: boolean;
    isRequestorJustificationRequired?: boolean;
    approvalMode?: string;
    approvalStages?: ApprovalStage[];
}

export interface ApprovalStage {
    approvalStageTimeOutInDays: number;
    isApproverJustificationRequired: boolean;
    escalationTimeInMinutes: number;
    isEscalationEnabled: boolean;
    primaryApprovers: Approver[];
    escalationApprovers?: Approver[];
}

export interface Approver {
    id: string;
    "@odata.type": string; // "#microsoft.graph.singleUser" | "#microsoft.graph.groupMembers"
    isBackup?: boolean;
    // Enriched data (fetched separately)
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    type?: "user" | "group";
}

// Step 17: Other Policy Rules
export interface NotificationRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule";
    notificationType: string;
    recipientType: string[];
    notificationLevel: string;
    isDefaultRecipientsEnabled: boolean;
    notificationRecipients: string[];
}

export interface ExpirationRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule";
    isExpirationRequired: boolean;
    maximumDuration?: string;
}

export interface EnablementRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule";
    enabledRules: string[];
}

export interface AuthenticationContextRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule";
    isEnabled: boolean;
    claimValue?: string;
}

// Comprehensive Role Data (aggregated)
export interface RoleDetailData {
    definition: RoleDefinition;
    assignments: {
        permanent: RoleAssignment[];
        eligible: PimEligibilitySchedule[];
        active: PimAssignmentSchedule[];
    };
    policy?: {
        assignment: PimPolicyAssignment;
        details: PimPolicy;
        approvers: Approver[];
    } | null;
    configError?: string; // Error message if config failed to load
    instances?: {
        eligible: PimScheduleInstance[];
        active: PimScheduleInstance[];
    };
}

// API Response wrappers
export interface GraphListResponse<T> {
    "@odata.context"?: string;
    "@odata.count"?: number;
    "@odata.nextLink"?: string;
    value: T[];
}
