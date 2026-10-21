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
    /** `userType` (Member or Guest) of the user principal, read from /users after the fast phase; undefined for groups, apps or when not read. */
    principalUserType?: string;
    directoryScope?: DirectoryScope;
    scopeInfo?: ScopeInfo; // Enriched scope information
}

export interface Principal {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    /** Service principals: Application, ManagedIdentity, or ServiceIdentity (always and only for an agent identity) */
    servicePrincipalType?: string | null;
    /** An agent identity: the appId of the blueprint it was created from */
    agentIdentityBlueprintId?: string | null;
    /** An agent's user account: the object id of its agent identity */
    identityParentId?: string | null;
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
    /** `userType` (Member or Guest) of the user principal, read from /users after the fast phase; undefined for groups, apps or when not read. */
    principalUserType?: string;
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
    /** The activation came through membership of a group that is eligible for the role: the schedule instance says `memberType` Group (Report spec 5.6). Neither list names the group. */
    viaGroup?: boolean;
    createdDateTime?: string;
    modifiedDateTime?: string;
    createdUsing?: string;
    principal?: Principal;
    /** `userType` (Member or Guest) of the user principal, read from /users after the fast phase; undefined for groups, apps or when not read. */
    principalUserType?: string;
    directoryScope?: DirectoryScope;
    scopeInfo?: ScopeInfo; // Enriched scope information
}

export interface ScheduleInfo {
    startDateTime?: string;
    expiration?: ExpirationPattern;
    recurrence?: Record<string, unknown>;
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
    /** `userType` (Member or Guest) of the user principal, read from /users after the fast phase; undefined for groups, apps or when not read. */
    principalUserType?: string;
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
    lastModifiedBy?: Record<string, unknown>;
    rules?: PimPolicyRule[];
}

/**
 * Generic PIM policy rule as returned by Graph. Every rule carries id, type and
 * target; the remaining properties depend on the rule type and are optional here.
 * The typed subclasses below narrow them for a specific "@odata.type".
 */
export interface PimPolicyRule {
    id: string;
    "@odata.type": string;
    target: RuleTarget;
    // ExpirationRule
    isExpirationRequired?: boolean;
    maximumDuration?: string;
    // EnablementRule
    enabledRules?: string[];
    // AuthenticationContextRule (isEnabled is shared with CustomExtensionRule)
    isEnabled?: boolean;
    claimValue?: string;
    // ApprovalRule
    setting?: ApprovalSettings;
    // NotificationRule
    notificationType?: string;
    recipientType?: string | string[];
    notificationLevel?: string;
    isDefaultRecipientsEnabled?: boolean;
    notificationRecipients?: string[];
    // CustomExtensionRule (Preview)
    customExtensionId?: string | null;
    displayName?: string | null;
    customAttributes?: string[] | null;
}

export interface RuleTarget {
    caller: string;
    operations: string[];
    level: string;
    targetObjects?: string[];
    inheritableSettings?: string[];
    enforcedSettings?: string[];
}

// Step 13-16: Approvers
export interface ApprovalRule extends PimPolicyRule {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule";
    setting: ApprovalSettings;
}

export interface ApprovalSettings {
    isApprovalRequired?: boolean;
    isApprovalRequiredForExtension?: boolean;
    isRequestorJustificationRequired?: boolean;
    approvalMode?: string;
    approvalStages?: ApprovalStage[];
}

export interface ApprovalStage {
    approvalStageTimeOutInDays?: number;
    isApproverJustificationRequired?: boolean;
    escalationTimeInMinutes?: number;
    isEscalationEnabled?: boolean;
    primaryApprovers?: PrimaryApprover[];
    escalationApprovers?: PrimaryApprover[];
}

/** Raw approver from Graph API before enrichment */
export interface PrimaryApprover {
    id?: string;
    groupId?: string;
    userId?: string;
    "@odata.type": "#microsoft.graph.singleUser" | "#microsoft.graph.groupMembers" | "#microsoft.graph.requestorManager";
    description?: string;
    isBackup?: boolean;
}

/** Enriched approver with display information */
export interface Approver extends PrimaryApprover {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    type?: "user" | "group" | "manager";
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
    /** Graph answered 403 on this role's policy: not readable with the current access, not a failure and not "no policy" (FIX-12) */
    policiesForbidden?: boolean;
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
