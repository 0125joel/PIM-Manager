/** A level in the Azure scope tree (implementation spec section 5) */
export type AzureScopeLevel = "root" | "managementGroup" | "subscription" | "resourceGroup" | "resource";

/** One scope in the tree. The tree is in `parentId`; `null` for a scope with no known parent */
export interface AzureScope {
    id: string;
    name: string;
    level: AzureScopeLevel;
    parentId: string | null;
    /** Resources only, for example `Microsoft.KeyVault/vaults` */
    resourceType?: string;
    /** Subscriptions only: the tenant the subscription belongs to; another tenant than the user's marks Azure Lighthouse */
    tenantId?: string;
    /**
     * Subscriptions only: the user cannot list it at its own level (400 `InsufficientPermissions`), so it is filled from
     * the resource groups and resources the user can read (Azure spec 15.5). `loading` while that runs, `partial` once it
     * is read, `failed` when a read failed. Absent for a subscription read as a whole.
     */
    access?: "loading" | "partial" | "failed";
    /**
     * Subscriptions with `access` only: the readable resource groups and resources below it that the read budget of the
     * round did not reach (`utils/azureReadBelow.ts`); Read the rest reads them. Absent when nothing is left to read.
     */
    unreadScopeIds?: string[];
    /** Subscriptions with `access` only: the budget ran out before its resource groups and resources were listed */
    isUnlisted?: true;
}

/** One PIM role assignment on an Azure scope, as the Report shows it */
export interface AzureAssignment {
    id: string;
    scopeId: string;
    principalId: string;
    principalName: string;
    principalType: string;
    /** The sign-in name of a user, or the e-mail address when ARM gives no sign-in name; absent for apps and groups without one */
    principalUpn?: string;
    /** The role definition GUID */
    roleDefinitionId: string;
    roleName: string;
    state: "active" | "eligible";
    memberType: "direct" | "inherited";
    /** ARM `startDateTime`; absent when ARM gives none */
    startDateTime?: string;
    endDateTime: string | null;
    /** Held through a group (ARM `memberType` `Group`, Learn; not measured yet); absent otherwise */
    isViaGroup?: true;
    /** Active because the principal activated an eligible role (ARM `assignmentType` `Activated`); absent otherwise */
    isActivated?: true;
    /** A custom role (`expandedProperties.roleDefinition.type` `CustomRole`, measured 2026-10-22); absent otherwise */
    isCustomRole?: true;
}

/** One item of `GET /subscriptions`, the fields the app reads. A `tenantId` other than the user's marks Lighthouse */
export interface ArmSubscription {
    id: string;
    subscriptionId: string;
    displayName: string;
    state: string;
    tenantId: string;
}

/** One entity of getEntities (Learn, Entities - List, `2020-05-01`): a management group or a subscription and its parent */
export interface ArmEntity {
    id: string;
    name: string;
    type: string;
    properties: { displayName?: string; parent?: { id?: string } | null; tenantId?: string };
}

/** One item of `GET /subscriptions/{id}/resourcegroups` or `/resources` (`2021-04-01`), the fields the app reads */
export interface ArmResourceItem {
    id: string;
    name: string;
    type: string;
}

interface ExpandedEntity {
    id: string;
    displayName: string;
    type: string;
}

/**
 * One schedule instance, or one eligibility schedule, as ARM returns it, the fields the app reads. `type` names the list
 * (`Microsoft.Authorization/roleEligibilitySchedules` for a schedule). The eligibility lists have no `assignmentType`, no
 * `linkedRoleEligibilityScheduleId` and no `roleAssignmentScheduleId` (Learn, spike fixtures); a schedule has no
 * `roleEligibilityScheduleId` but a `roleEligibilityScheduleRequestId` (measured 2026-10-22). `expandedProperties.scope`
 * names the scope of an inherited item, with `type` `tenant`, `managementgroup`, `subscription`, `resourcegroup` or
 * `resource`.
 */
export interface ArmRoleScheduleInstance {
    id: string;
    name: string;
    type: string;
    properties: {
        scope: string;
        roleDefinitionId: string;
        principalId: string;
        principalType: string;
        memberType: "Direct" | "Inherited" | "Group";
        status: string;
        startDateTime?: string;
        endDateTime?: string | null;
        createdOn?: string;
        assignmentType?: "Activated" | "Assigned";
        linkedRoleEligibilityScheduleId?: string;
        roleAssignmentScheduleId?: string;
        roleEligibilityScheduleId?: string;
        roleEligibilityScheduleRequestId?: string;
        expandedProperties?: {
            principal?: ExpandedEntity & { email?: string; userPrincipalName?: string };
            roleDefinition?: ExpandedEntity;
            scope?: ExpandedEntity;
        };
    };
}

/**
 * One rule of a role management policy as ARM returns it. The rule ids and fields match Graph; the type is in `ruleType`
 * (`RoleManagementPolicyExpirationRule`), not in `@odata.type` (Learn, spike fixtures). An approver is `{ id,
 * description, isBackup, userType }` with `userType` `User` or `Group` (Learn).
 */
export interface ArmPolicyRule {
    id: string;
    ruleType: string;
    target?: { caller?: string; level?: string; operations?: string[]; inheritableSettings?: string[]; enforcedSettings?: string[] };
    [field: string]: unknown;
}

/** One role's policy at one scope (`roleManagementPolicies`, `2020-10-01`), the fields the app reads */
export interface ArmRoleManagementPolicy {
    id: string;
    name: string;
    type: string;
    properties: {
        scope: string;
        rules: ArmPolicyRule[];
        /** What ARM computes as applying; `null` in the Learn example, the same 17 rules in the spike fixtures */
        effectiveRules?: ArmPolicyRule[] | null;
        isOrganizationDefault?: boolean;
        lastModifiedDateTime?: string | null;
        lastModifiedBy?: { displayName?: string } | null;
    };
}

/**
 * One role definition (`roleDefinitions/{id}`, `2022-04-01`, Learn Role Definitions - Get), the fields the app reads.
 * `type` is `BuiltInRole` or `CustomRole`.
 */
export interface ArmRoleDefinition {
    id: string;
    name: string;
    type: string;
    properties: {
        roleName: string;
        description?: string;
        type?: string;
        assignableScopes?: string[];
        permissions?: ArmRolePermission[];
    };
}

/** One permission block of a role definition (Learn, Role Definitions, `2022-04-01`) */
export interface ArmRolePermission {
    actions?: string[];
    notActions?: string[];
    dataActions?: string[];
    notDataActions?: string[];
}

/** One PIM alert of a subscription (Learn, Role Management Alerts - List For Scope, `2022-08-01-preview`) */
export interface ArmRoleManagementAlert {
    id: string;
    name: string;
    properties: {
        incidentCount?: number;
        isActive?: boolean;
        /** `0001-01-01T00:00:00...` when never scanned (measured 2026-10-24) */
        lastScannedDateTime?: string;
        scope?: string;
        alertDefinition?: { properties?: { displayName?: string; severityLevel?: string; description?: string; mitigationSteps?: string; howToPrevent?: string; securityImpact?: string } };
    };
}
