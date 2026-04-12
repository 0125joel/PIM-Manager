import { PolicySettings } from '@/types/wizard.types';
import type { NotificationRecipient } from '@/types/shared.types';
import { DEFAULT_DURATIONS, normalizeDuration } from '@/utils/durationUtils';

/**
 * Service for parsing Graph API UnifiedRoleManagementPolicy responses
 * into wizard's PolicySettings format.
 */

interface GraphNotificationRule {
    '@odata.type': string;
    id: string;
    notificationType: string;
    recipientType: 'Admin' | 'Requestor' | 'Assignee' | 'Approver';
    notificationLevel: 'All' | 'Critical';
    isDefaultRecipientsEnabled: boolean;
    notificationRecipients: string[];
    target: {
        caller: 'Admin' | 'EndUser';
        operations: string[];
        level: 'Eligibility' | 'Assignment';
        inheritableSettings: string[];
        enforcedSettings: string[];
    };
}

interface GraphExpirationRule {
    '@odata.type': string;
    id: string;
    isExpirationRequired: boolean;
    maximumDuration: string;
    target: {
        caller: 'Admin' | 'EndUser';
        level: 'Eligibility' | 'Assignment';
    };
}

interface GraphEnablementRule {
    '@odata.type': string;
    id: string;
    enabledRules: string[];
    target: {
        caller: 'Admin' | 'EndUser';
        level: 'Assignment';
    };
}

interface GraphApprovalRule {
    '@odata.type': string;
    id: string;
    setting: {
        isApprovalRequired: boolean;
        approvalStages?: Array<{
            approvalStageTimeOutInDays: number;
            isApproverJustificationRequired: boolean;
            primaryApprovers: Array<{
                '@odata.type': string;
                id?: string;
                userId?: string;
                groupId?: string;
                description?: string;
            }>;
        }>;
    };
}

interface GraphAuthContextRule {
    '@odata.type': string;
    id: string;
    isEnabled: boolean;
    claimValue: string;
}

// Union type for all Graph API rule types
type GraphPolicyRule =
    | GraphNotificationRule
    | GraphExpirationRule
    | GraphEnablementRule
    | GraphApprovalRule
    | GraphAuthContextRule;

// Graph API policy response type (flexible to accept both GraphPolicyRule[] and PimPolicyRule[])
interface GraphPolicyResponse {
    rules?: Array<GraphPolicyRule | { '@odata.type': string; [key: string]: unknown }>;
    [key: string]: unknown;
}

/**
 * Parse notification rules from Graph API response
 */
export function parseNotificationRules(
    rules: GraphNotificationRule[]
): PolicySettings['notifications'] {
    const notifications: PolicySettings['notifications'] = {
        eligibleAssignment: {
            admin: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            assignee: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: '', criticalOnly: false }
        },
        activeAssignment: {
            admin: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            assignee: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: '', criticalOnly: false }
        },
        activation: {
            admin: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            requestor: { isEnabled: true, additionalRecipients: '', criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: '', criticalOnly: false }
        }
    };

    rules.forEach(rule => {
        const recipient = parseNotificationRecipient(rule);
        const category = getNotificationCategory(rule);
        const recipientKey = getRecipientKey(rule);

        if (category && recipientKey) {
            // Type assertion needed because TypeScript can't verify all combinations are valid
            // but we know from business logic that category/recipientKey pairs match
            (notifications[category] as Record<string, typeof recipient>)[recipientKey] = recipient;
        }
    });

    return notifications;
}

function parseNotificationRecipient(rule: GraphNotificationRule): {
    isEnabled: boolean;
    additionalRecipients: string;
    criticalOnly: boolean;
} {
    return {
        isEnabled: rule.isDefaultRecipientsEnabled,
        additionalRecipients: rule.notificationRecipients.join(';'),
        criticalOnly: rule.notificationLevel === 'Critical'
    };
}

function getNotificationCategory(
    rule: GraphNotificationRule
): 'eligibleAssignment' | 'activeAssignment' | 'activation' | null {
    const { caller, level } = rule.target;

    // Eligible Assignment: Admin caller + Eligibility level
    if (caller === 'Admin' && level === 'Eligibility') {
        return 'eligibleAssignment';
    }

    // Active Assignment: Admin caller + Assignment level
    if (caller === 'Admin' && level === 'Assignment') {
        return 'activeAssignment';
    }

    // Activation: EndUser caller + Assignment level
    if (caller === 'EndUser' && level === 'Assignment') {
        return 'activation';
    }

    return null;
}

function getRecipientKey(
    rule: GraphNotificationRule
): 'admin' | 'assignee' | 'requestor' | 'approver' | null {
    const recipientType = rule.recipientType.toLowerCase();

    // Map "Requestor" to "assignee" for eligible/active assignments
    // Map "Requestor" to "requestor" for activation
    if (recipientType === 'requestor') {
        return rule.target.caller === 'EndUser' ? 'requestor' : 'assignee';
    }

    if (recipientType === 'assignee') {
        return 'assignee';
    }

    if (recipientType === 'admin') {
        return 'admin';
    }

    if (recipientType === 'approver') {
        return 'approver';
    }

    return null;
}

/**
 * Parse activation rules (expiration + enablement for EndUser/Assignment)
 */
export function parseActivationRules(rules: GraphPolicyRule[]): {
    maxActivationDuration: string;
    requireMfa: 'None' | 'AzureMFA' | 'ConditionalAccess';
    authContextId?: string;
    requireJustification: boolean;
    requireTicketInfo: boolean;
    requireApproval: boolean;
    approvers: Array<{ id: string; type: 'user' | 'group'; displayName: string }>;
} {
    const expirationRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule' &&
            r.id === 'Expiration_EndUser_Assignment'
    ) as GraphExpirationRule | undefined;

    const enablementRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule' &&
            r.id === 'Enablement_EndUser_Assignment'
    ) as GraphEnablementRule | undefined;

    const approvalRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyApprovalRule' &&
            r.id === 'Approval_EndUser_Assignment'
    ) as GraphApprovalRule | undefined;

    const authContextRule = rules.find(
        (r) =>
            r['@odata.type'] ===
            '#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule' &&
            r.id === 'AuthenticationContext_EndUser_Assignment'
    ) as GraphAuthContextRule | undefined;

    const enabledRules = enablementRule?.enabledRules || [];

    let requireMfa: 'None' | 'AzureMFA' | 'ConditionalAccess' = 'None';
    if (authContextRule?.isEnabled) {
        requireMfa = 'ConditionalAccess';
    } else if (enabledRules.includes('MultiFactorAuthentication')) {
        requireMfa = 'AzureMFA';
    }

    const approvers: Array<{ id: string; type: 'user' | 'group'; displayName: string }> = [];
    if (approvalRule?.setting.approvalStages?.[0]?.primaryApprovers) {
        approvalRule.setting.approvalStages[0].primaryApprovers.forEach((approver) => {
            const id = approver.userId || approver.groupId || approver.id || '';
            const type = approver['@odata.type'].includes('singleUser') ? 'user' : 'group';
            approvers.push({
                id,
                type,
                displayName: approver.description || id
            });
        });
    }

    return {
        maxActivationDuration: expirationRule?.maximumDuration || DEFAULT_DURATIONS.activationDuration,
        requireMfa,
        authContextId: authContextRule?.claimValue,
        requireJustification: enabledRules.includes('Justification'),
        requireTicketInfo: enabledRules.includes('Ticketing'),
        requireApproval: approvalRule?.setting.isApprovalRequired || false,
        approvers
    };
}

/**
 * Parse assignment rules (expiration for Admin/Eligibility and Admin/Assignment)
 */
export function parseAssignmentRules(rules: GraphPolicyRule[]): {
    allowPermanentEligible: boolean;
    eligibleExpiration: string;
    allowPermanentActive: boolean;
    activeExpiration: string;
    requireMfaOnActive: boolean;
    requireJustificationOnActive: boolean;
} {
    const eligibleExpirationRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule' &&
            r.id === 'Expiration_Admin_Eligibility'
    ) as GraphExpirationRule | undefined;

    const activeExpirationRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyExpirationRule' &&
            r.id === 'Expiration_Admin_Assignment'
    ) as GraphExpirationRule | undefined;

    const enablementRule = rules.find(
        (r) =>
            r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyEnablementRule' &&
            r.id === 'Enablement_Admin_Assignment'
    ) as GraphEnablementRule | undefined;

    const enabledRules = enablementRule?.enabledRules || [];

    return {
        allowPermanentEligible: !eligibleExpirationRule?.isExpirationRequired,
        eligibleExpiration: normalizeDuration(eligibleExpirationRule?.maximumDuration, DEFAULT_DURATIONS.eligibleExpiration),
        allowPermanentActive: !activeExpirationRule?.isExpirationRequired,
        activeExpiration: normalizeDuration(activeExpirationRule?.maximumDuration, DEFAULT_DURATIONS.newAssignmentActive),
        requireMfaOnActive: enabledRules.includes('MultiFactorAuthentication'),
        requireJustificationOnActive: enabledRules.includes('Justification')
    };
}

/**
 * Main entry point: parse complete policy from Graph API response or PimPolicy
 */
export function parseGraphPolicy(policyResponse: GraphPolicyResponse | { rules?: unknown[] }): PolicySettings {
    const rules = (policyResponse.rules || []) as GraphPolicyRule[];

    const notificationRules = rules.filter(
        (r): r is GraphNotificationRule => r['@odata.type'] === '#microsoft.graph.unifiedRoleManagementPolicyNotificationRule'
    );

    const notifications = parseNotificationRules(notificationRules);
    const activationSettings = parseActivationRules(rules);
    const assignmentSettings = parseAssignmentRules(rules);

    return {
        // Activation
        maxActivationDuration: activationSettings.maxActivationDuration,
        activationRequirement:
            activationSettings.requireMfa === 'ConditionalAccess'
                ? 'authenticationContext'
                : activationSettings.requireMfa === 'AzureMFA'
                    ? 'mfa'
                    : 'none',
        authenticationContextId: activationSettings.authContextId,
        requireJustificationOnActivation: activationSettings.requireJustification,
        requireTicketInfo: activationSettings.requireTicketInfo,
        requireApproval: activationSettings.requireApproval,
        approvers: activationSettings.approvers,

        // Assignment
        allowPermanentEligible: assignmentSettings.allowPermanentEligible,
        eligibleExpiration: assignmentSettings.eligibleExpiration,
        allowPermanentActive: assignmentSettings.allowPermanentActive,
        activeExpiration: assignmentSettings.activeExpiration,
        requireMfaOnActiveAssignment: assignmentSettings.requireMfaOnActive,
        requireJustificationOnActiveAssignment: assignmentSettings.requireJustificationOnActive,

        // Notifications
        notifications
    };
}
