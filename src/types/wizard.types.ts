/**
 * The one policy model of the app (`PolicySettings`, NG-10) and the activation notification rule. The file keeps its old
 * name; the wizard types that lived here went with the old Configure (N-019).
 */

import { CustomExtensionSlots } from '@/types/shared.types';

export interface PolicySettings {
    // === Activation Tab ===
    maxActivationDuration: string;
    activationRequirement: "none" | "mfa" | "authenticationContext";
    authenticationContextId?: string;
    requireJustificationOnActivation: boolean;
    requireTicketInfo: boolean;
    requireApproval: boolean;
    approvers?: { id: string; type: "user" | "group" | "manager"; displayName?: string }[];
    /** PIM Custom Extensions (Preview); undefined leaves the policy's slots untouched */
    customExtensions?: CustomExtensionSlots;

    // === Assignment Tab ===
    allowPermanentEligible: boolean;
    eligibleExpiration?: string;
    allowPermanentActive: boolean;
    activeExpiration?: string;
    requireMfaOnActiveAssignment: boolean;
    requireJustificationOnActiveAssignment: boolean;

    // The Notification_Admin_EndUser_Assignment rule as read from the policy (spec 5.6). Undefined when the
    // rule is absent. Read-only: the apply mappers do not write it, `notifications.activation.admin` does.
    activationNotification?: ActivationNotificationRule;

    // === Notification Tab ===
    notifications: {
        eligibleAssignment: {
            admin: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            assignee: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            approver: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
        };
        activeAssignment: {
            admin: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            assignee: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            approver: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
        };
        activation: {
            admin: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            requestor: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
            approver: { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean; };
        };
    };
}

export interface ActivationNotificationRule {
    isDefaultRecipientsEnabled: boolean;
    notificationRecipients: string[];
}
