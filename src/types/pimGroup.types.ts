// Types for PIM for Groups data
// Reuses Principal and ScheduleInfo from roleData.ts for consistency

import { Approver, Principal, ScheduleInfo, ScopeInfo } from "./directoryRole.types";
import { WorkloadLink } from "./workload.types";

// Group types
export type GroupType = "security" | "m365" | "mailEnabled" | "unknown";

// PIM-managed group
export interface PimGroup {
    id: string;
    displayName: string;
    description?: string;
    groupType: GroupType;
    mail?: string;
    mailEnabled?: boolean;
    securityEnabled?: boolean;
    membershipRule?: string; // For dynamic groups
    membershipRuleProcessingState?: string;
    isAssignableToRole?: boolean; // True if role-assignable group
    /** Synced from on-premises: PIM cannot manage it (Configure locks it) */
    onPremisesSyncEnabled?: boolean | null;
    /** In a restricted management administrative unit: PIM does not support it (Configure locks it, M-07) */
    isManagementRestricted?: boolean | null;
}

// Access type for group PIM
export type GroupAccessType = "member" | "owner";

// Assignment type
export type GroupAssignmentType = "eligible" | "active" | "permanent";

// A single PIM assignment to a group (member or owner)
export interface GroupPimAssignment {
    id: string;
    groupId: string;
    principalId: string;
    principal?: Principal;
    /** `userType` (Member or Guest) of a user principal, read from /users after the assignments (Report spec 5.3b); undefined for groups, apps or when not read */
    principalUserType?: string;
    accessType: GroupAccessType;
    assignmentType: GroupAssignmentType;
    /**
     * How an active instance came about, Graph's own `assignmentType` on the schedule instance: `assigned` (an
     * administrator gave it) or `activated` (someone activated an eligibility). Undefined for eligible instances.
     */
    assignmentOrigin?: "assigned" | "activated";
    memberType?: string; // "Direct" | "Group"
    status?: string;
    startDateTime?: string;
    endDateTime?: string;
    scheduleInfo?: ScheduleInfo;
    createdDateTime?: string;
    modifiedDateTime?: string;
    scopeInfo?: ScopeInfo;
}

// Aggregated PIM data for a single group
export interface PimGroupData {
    group: PimGroup;
    assignments: GroupPimAssignment[];
    linkedWorkloads?: WorkloadLink[]; // For Fase 4: linked Intune/Exchange/etc roles

    // Computed stats (can be calculated from assignments)
    stats?: PimGroupStats;

    // PIM policies for Member and Owner access (loaded progressively)
    policies?: {
        member?: GroupPimPolicy;
        owner?: GroupPimPolicy;
    };

    // Computed settings from policies (for easy access)
    settings?: GroupPimSettings;

    // Graph answered 403 on this group's policies: this admin may not read them. Then policies and settings are absent
    // (never "no policy"), and the screens say the settings are not readable (utils/policyReadAccess.ts)
    policiesForbidden?: boolean;

    // Flag for unmanaged groups (added in Phase 6)
    isManaged?: boolean;

    // Direct members of a role-assignable group outside PIM (spec 5.4); undefined when not read yet or the call failed
    memberCount?: number;
}

// Computed settings derived from policies
export interface GroupPimSettings {
    // Member settings
    memberMaxDuration?: string;           // ISO 8601 duration (e.g., "PT8H")
    memberRequiresMfa?: boolean;
    memberRequiresJustification?: boolean;
    memberRequiresApproval?: boolean;

    // Owner settings
    ownerMaxDuration?: string;
    ownerRequiresMfa?: boolean;
    ownerRequiresJustification?: boolean;
    ownerRequiresApproval?: boolean;
}

// PIM Policy for a group (either Member or Owner access)
export interface GroupPimPolicy {
    id: string;
    groupId: string;
    policyType: "member" | "owner";
    displayName?: string;
    rules: GroupPolicyRule[];
    /** The approvers of the approval rule with their names, resolved in the background after the policy (Report spec 5.2). Undefined until resolved; an empty list means there are none to show. */
    approvers?: Approver[];
}

// Policy rule (same structure as Directory Roles)
export interface GroupApprover {
    "@odata.type"?: string;
    id?: string;
    userId?: string;
    groupId?: string;
    description?: string;
    isBackup?: boolean;
}

export interface GroupApprovalStage {
    approvalStageTimeOutInDays?: number;
    isApproverJustificationRequired?: boolean;
    escalationTimeInMinutes?: number;
    isEscalationEnabled?: boolean;
    primaryApprovers?: GroupApprover[];
    escalationApprovers?: GroupApprover[];
}

export interface GroupPolicyRule {
    "@odata.type": string;
    id: string;
    target?: {
        caller: string;
        operations: string[];
        level: string;
        inheritableSettings?: string[];
    };
    // ExpirationRule properties
    isExpirationRequired?: boolean;
    maximumDuration?: string;          // ISO 8601 duration (e.g., "PT8H", "P1D")
    // EnablementRule properties
    enabledRules?: string[];           // ["MultiFactorAuthentication", "Justification", "Ticketing"]
    // ApprovalRule properties
    setting?: {
        isApprovalRequired?: boolean;
        isApprovalRequiredForExtension?: boolean;
        isRequestorJustificationRequired?: boolean;
        approvalMode?: string;
        approvalStages?: GroupApprovalStage[];
    };
    // AuthenticationContextRule properties (isEnabled is shared with CustomExtensionRule)
    isEnabled?: boolean;
    claimValue?: string;
    // NotificationRule properties
    notificationType?: string;
    recipientType?: string;
    notificationLevel?: string;
    isDefaultRecipientsEnabled?: boolean;
    notificationRecipients?: string[];
    // CustomExtensionRule properties (Preview)
    customExtensionId?: string | null;
    displayName?: string | null;
    customAttributes?: string[] | null;
}

// Known roleDefinitionIds for Group PIM policies
export const GROUP_POLICY_ROLE_IDS = {
    MEMBER: "f2c171f1-ca01-4eb1-9988-12e2e920d364",
    OWNER: "35456f91-5367-42f7-bbd3-0599c1584c3c"
} as const;

// Helper: Extract settings from policy rules
// Groups use same structure as Directory Roles:
// - Activation: caller="EndUser", level="Assignment"
// - Assignment: caller="Admin", level="Assignment" or "Eligibility"
export function extractGroupPolicySettings(policy: GroupPimPolicy): Partial<GroupPimSettings> {
    const prefix = policy.policyType === "member" ? "member" : "owner";
    const settings: Partial<GroupPimSettings> = {};

    // Helper to find specific rule
    const findRule = (ruleTypePart: string, caller: string, level: string) =>
        policy.rules.find((r) =>
            r["@odata.type"]?.includes(ruleTypePart) &&
            r.target?.caller === caller &&
            r.target?.level === level
        );

    // Activation settings (EndUser - Assignment) - this is what users see when activating
    const activationExpiration = findRule("ExpirationRule", "EndUser", "Assignment");
    const activationEnablement = findRule("EnablementRule", "EndUser", "Assignment");
    const activationApproval = findRule("ApprovalRule", "EndUser", "Assignment");


    // Extract Activation settings
    if (activationExpiration) {
        if (prefix === "member") {
            settings.memberMaxDuration = activationExpiration.maximumDuration;
        } else {
            settings.ownerMaxDuration = activationExpiration.maximumDuration;
        }
    }

    if (activationEnablement) {
        const enabled = activationEnablement.enabledRules || [];
        if (prefix === "member") {
            settings.memberRequiresMfa = enabled.includes("MultiFactorAuthentication");
            settings.memberRequiresJustification = enabled.includes("Justification");
        } else {
            settings.ownerRequiresMfa = enabled.includes("MultiFactorAuthentication");
            settings.ownerRequiresJustification = enabled.includes("Justification");
        }
    }

    if (activationApproval) {
        if (prefix === "member") {
            settings.memberRequiresApproval = activationApproval.setting?.isApprovalRequired;
        } else {
            settings.ownerRequiresApproval = activationApproval.setting?.isApprovalRequired;
        }
    }

    return settings;
}

// Computed statistics for a group
export interface PimGroupStats {
    eligibleMembers: number;
    activeMembers: number;
    permanentMembers: number;
    eligibleOwners: number;
    activeOwners: number;
    permanentOwners: number;
    totalAssignments: number;
}

// Helper function to compute stats from assignments
export function computeGroupStats(assignments: GroupPimAssignment[]): PimGroupStats {
    const stats: PimGroupStats = {
        eligibleMembers: 0,
        activeMembers: 0,
        permanentMembers: 0,
        eligibleOwners: 0,
        activeOwners: 0,
        permanentOwners: 0,
        totalAssignments: assignments.length
    };

    for (const assignment of assignments) {
        if (assignment.accessType === "member") {
            if (assignment.assignmentType === "eligible") stats.eligibleMembers++;
            else if (assignment.assignmentType === "active") stats.activeMembers++;
            else if (assignment.assignmentType === "permanent") stats.permanentMembers++;
        } else if (assignment.accessType === "owner") {
            if (assignment.assignmentType === "eligible") stats.eligibleOwners++;
            else if (assignment.assignmentType === "active") stats.activeOwners++;
            else if (assignment.assignmentType === "permanent") stats.permanentOwners++;
        }
    }

    return stats;
}

// API response types for Graph API
export interface GroupEligibilityScheduleInstance {
    id: string;
    principalId: string;
    principal?: Principal;
    groupId: string;
    accessId: "member" | "owner";
    memberType: string;
    status: string;
    startDateTime?: string;
    endDateTime?: string;
    scheduleInfo?: ScheduleInfo;
}

export interface GroupAssignmentScheduleInstance {
    id: string;
    principalId: string;
    principal?: Principal;
    groupId: string;
    accessId: "member" | "owner";
    memberType: string;
    status: string;
    startDateTime?: string;
    endDateTime?: string;
    assignmentType?: string;
}
