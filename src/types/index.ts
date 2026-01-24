export interface RoleDefinition {
    id: string;
    displayName: string;
    description?: string;
    isBuiltIn: boolean;
    isPrivileged?: boolean;
    assignmentCount?: number;
}

// Comprehensive PIM Role Settings (matching Azure Portal)
export interface RoleSettings {
    // Activation Tab
    activation: {
        maxDuration: number; // hours (1-24)
        requireMfa: "None" | "AzureMFA" | "ConditionalAccess";
        authContextId?: string; // Selected auth context ID
        requireJustification: boolean;
        requireTicketInfo: boolean;
        requireApproval: boolean;
        approvers: Principal[];
    };
    // Assignment Tab
    assignment: {
        allowPermanentEligible: boolean;
        expireEligibleAfter: string; // e.g., "1 Year", "6 Months"
        allowPermanentActive: boolean;
        expireActiveAfter: string;
        requireMfaOnActive: boolean;
        requireJustificationOnActive: boolean;
    };
    // Notification Tab
    notification: {
        eligibleAssignment: NotificationRule;
        activeAssignment: NotificationRule;
        eligibleActivation: NotificationRule;
    };
}

export interface NotificationRule {
    sendToAdmin: boolean;
    sendToAssignee: boolean;
    sendToApprover: boolean;
    additionalRecipients: string[]; // email addresses
    criticalOnly: boolean;
}

export interface Principal {
    id: string;
    displayName: string;
    userPrincipalName?: string; // For users
    groupTypes?: string[]; // For groups
    type: "user" | "group";
}

export interface AssignmentSettings {
    type: "Eligible" | "Active";
    duration: "Permanent" | "Specified";
    startDate?: string;
    endDate?: string;
    principals: Principal[];
    justification: string;
}

export interface RoleAssignment {
    id: string;
    roleDefinitionId: string;
    principalId: string;
    principalType: "User" | "Group";
    principalDisplayName: string;
    assignmentType: "Eligible" | "Active";
    startDateTime?: string;
    endDateTime?: string;
    memberType: "Direct" | "Group";
}

export interface AuthenticationContext {
    id: string;
    displayName: string;
    description?: string;
    isAvailable: boolean;
}
