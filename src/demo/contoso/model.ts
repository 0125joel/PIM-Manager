/**
 * The demo tenant as plain objects in the shape Microsoft Graph stores them. The fake Graph (`src/demo/graph`) answers
 * the app's requests from this model, so the app reads it through its real services, parsers and loaders.
 */

export interface DemoUser {
    id: string;
    displayName: string;
    userPrincipalName: string;
    mail: string | null;
    userType: "Member" | "Guest";
    jobTitle: string | null;
    department: string | null;
    /** An agent's user account: the object id of its agent identity */
    agentParentId?: string;
}

export interface DemoServicePrincipal {
    id: string;
    appId: string;
    displayName: string;
    /** Absent: an ordinary app. An Agent ID object: its Graph type and, for an agent identity, its blueprint appId */
    agent?: { type: "agentIdentity"; blueprintAppId: string } | { type: "agentIdentityBlueprintPrincipal" };
}

export interface DemoApplication {
    id: string;
    appId: string;
    displayName: string;
}

export interface DemoAdministrativeUnit {
    id: string;
    displayName: string;
    description: string;
    isMemberManagementRestricted: boolean;
    /** Groups that are members of the unit (the access check reads them for a role scoped to the unit) */
    groupMembers?: string[];
}

export interface DemoGroup {
    id: string;
    displayName: string;
    description: string;
    mail: string | null;
    mailEnabled: boolean;
    securityEnabled: boolean;
    groupTypes: string[];
    isAssignableToRole: boolean;
    membershipRule: string | null;
    membershipRuleProcessingState: string | null;
    /** Synced from on-premises Active Directory */
    onPremisesSyncEnabled?: boolean | null;
    /** Onboarded to PIM for Groups (listed by `privilegedAccess/group/resources`) */
    isPimManaged: boolean;
    /** Members and owners outside PIM; PIM members and owners that are active right now are added by the server */
    members: string[];
    owners: string[];
}

export interface DemoRoleDefinition {
    id: string;
    displayName: string;
    description: string;
    isBuiltIn: boolean;
    isEnabled: boolean;
    isPrivileged: boolean;
    templateId: string;
    resourceScopes: string[];
    rolePermissions: unknown[];
    version: string | null;
}

/** One PIM schedule for a directory role: eligible, or active (assigned by an administrator or activated) */
export interface DemoRoleSchedule {
    kind: "eligible" | "active";
    id: string;
    roleDefinitionId: string;
    principalId: string;
    directoryScopeId: string;
    startDateTime: string;
    /** null: no end */
    endDateTime: string | null;
    assignmentType?: "Assigned" | "Activated";
    /** Activated through a group the principal is a member of: the instance says `memberType` Group (lessons-learned) */
    throughGroup?: boolean;
    createdDateTime: string;
}

/** One PIM for Groups schedule: a member or owner, eligible or active */
export interface DemoGroupSchedule {
    kind: "eligible" | "active";
    id: string;
    groupId: string;
    principalId: string;
    accessId: "member" | "owner";
    startDateTime: string;
    endDateTime: string | null;
    assignmentType?: "assigned" | "activated";
}

export type DemoRule = Record<string, unknown> & { id: string; "@odata.type": string };

export interface DemoPolicy {
    id: string;
    displayName: string;
    scopeId: string;
    scopeType: "Directory" | "Group";
    /** A role definition id, or "member" / "owner" for a group */
    roleDefinitionId: string;
    rules: DemoRule[];
}

export interface DemoAlert {
    id: string;
    alertDefinitionId: string;
    isActive: boolean;
    incidentCount: number;
    lastModifiedDateTime: string;
    lastScannedDateTime: string;
    scopeId: string;
    scopeType: string;
    alertDefinition: Record<string, unknown>;
    alertConfiguration: Record<string, unknown>;
    alertIncidents: Record<string, unknown>[];
}

export interface DemoCustomExtension {
    id: string;
    displayName: string;
    description: string;
    targetUrl: string;
}

/** A Conditional Access policy in the shape of the v1.0 read (`$select` of the Configure check) */
export interface DemoConditionalAccessPolicy {
    id: string;
    displayName: string;
    state: "enabled" | "disabled" | "enabledForReportingButNotEnforced";
    conditions: { applications: { includeAuthenticationContextClassReferences: string[] } };
    grantControls: { operator: "OR" | "AND"; builtInControls: string[]; authenticationStrength: { id: string } | null } | null;
    sessionControls: { signInFrequency: { isEnabled: boolean; frequencyInterval: "timeBased" | "everyTime" } | null } | null;
}

export interface DemoAuthenticationContext {
    id: string;
    displayName: string;
    description: string;
    isAvailable: boolean;
}

export interface DemoTenant {
    id: string;
    displayName: string;
    /** The signed-in demo user */
    signedInUserId: string;
    users: DemoUser[];
    servicePrincipals: DemoServicePrincipal[];
    applications: DemoApplication[];
    administrativeUnits: DemoAdministrativeUnit[];
    groups: DemoGroup[];
    roleDefinitions: DemoRoleDefinition[];
    roleSchedules: DemoRoleSchedule[];
    groupSchedules: DemoGroupSchedule[];
    policies: DemoPolicy[];
    alerts: DemoAlert[];
    customExtensions: DemoCustomExtension[];
    authenticationContexts: DemoAuthenticationContext[];
    /** Conditional Access policies that target the contexts (the optional check of Configure, spec 12.5) */
    conditionalAccessPolicies: DemoConditionalAccessPolicy[];
    /** Accounts marked as emergency access accounts in the demo's settings */
    emergencyAccountIds: string[];
}
