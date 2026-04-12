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
    // Notification Tab
    notification: {
        eligibleAssignment: GranularNotificationSettings;
        activeAssignment: GranularNotificationSettings;
        eligibleActivation: ActivatorNotificationSettings;
    };
}

export interface GranularNotificationSettings {
    admin: NotificationRecipient;
    assignee: NotificationRecipient;
    approver: NotificationRecipient;
}

export interface ActivatorNotificationSettings {
    admin: NotificationRecipient;
    requestor: NotificationRecipient;
    approver: NotificationRecipient;
}

export interface NotificationRecipient {
    isEnabled: boolean;
    additionalRecipients: string[]; // stored as array in domain model
    criticalOnly: boolean;
}

export interface Principal {
    id: string;
    displayName?: string; // Optional - may not always be resolved
    userPrincipalName?: string; // For users
    groupTypes?: string[]; // For groups
    mail?: string; // Email address
    type: "user" | "group" | "manager"; // manager = requestor's manager (PIM approval)
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
