/**
 * Wizard-specific TypeScript types
 * Replaces 'any' types across wizard components
 */

import { LucideIcon } from 'lucide-react';
import { WorkloadType } from '@/types/workload.types';

// ==================== Policy & Assignment Types (used by services) ====================

export interface PolicySettings {
    // === Activation Tab ===
    maxActivationDuration: string;
    activationRequirement: "none" | "mfa" | "authenticationContext";
    authenticationContextId?: string;
    requireJustificationOnActivation: boolean;
    requireTicketInfo: boolean;
    requireApproval: boolean;
    approvers?: { id: string; type: "user" | "group" | "manager"; displayName?: string }[];

    // === Assignment Tab ===
    allowPermanentEligible: boolean;
    eligibleExpiration?: string;
    allowPermanentActive: boolean;
    activeExpiration?: string;
    requireMfaOnActiveAssignment: boolean;
    requireJustificationOnActiveAssignment: boolean;

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

export interface AssignmentConfig {
    principalIds: string[];
    assignmentType: "eligible" | "active";
    duration?: string;
    startDateTime?: string;
    endDateTime?: string;
    justification?: string;
    accessType?: "member" | "owner";
    directoryScopeId?: string;
}

export interface AssignmentRemoval {
    assignmentId: string;
    principalId: string;
    roleDefinitionId: string;
    directoryScopeId: string;
    assignmentType: "eligible" | "active";
    groupId?: string;
}

export interface WorkloadConfig {
    policies?: PolicySettings;
    ownerPolicies?: PolicySettings;
    assignments?: AssignmentConfig;
    removals?: AssignmentRemoval[];
    applied: boolean;
    configSource?: 'defaults' | 'loaded' | 'cloned';
    forRoleIds?: string[];
    forGroupIds?: string[];
    result?: {
        policiesUpdated: number;
        assignmentsCreated: number;
        errors: string[];
    };
}

export interface WizardData {
    workloads: WorkloadType[];
    configType: "settings" | "assignment" | "both";
    selectedRoleIds: string[];
    selectedGroupIds: string[];
    configMode: "scratch" | "load" | "clone";
    cloneMode: "new" | "clone";
    cloneSourceId?: string;
    directoryRoles: WorkloadConfig;
    pimGroups: WorkloadConfig;
    currentWorkloadIndex: number;
    scopes: string[];
    settings: Record<string, unknown>;
    assignments: Record<string, unknown>;
}

// ==================== Notification Types ====================

export interface NotificationRecipientSettings {
    isEnabled: boolean;
    additionalRecipients: string; // Semicolon-separated email addresses
    criticalOnly: boolean;
}

export interface NotificationSectionSettings {
    admin: NotificationRecipientSettings;
    assignee: NotificationRecipientSettings;
    approver: NotificationRecipientSettings;
}

export interface NotificationActivationSettings {
    admin: NotificationRecipientSettings;
    requestor: NotificationRecipientSettings;
    approver: NotificationRecipientSettings;
}

// ==================== Assignment Types ====================

/**
 * Raw role assignment from Microsoft Graph API
 * Used when fetching existing assignments
 */
export interface RawRoleAssignment {
    id: string;
    principalId: string;
    roleDefinitionId: string;
    directoryScopeId: string;
    appScopeId?: string | null;
    principal: {
        id: string;
        displayName: string;
        userPrincipalName?: string;
    };
    scheduleInfo?: {
        startDateTime?: string | null;
        expiration?: {
            endDateTime?: string | null;
            type?: string;
            duration?: string | null;
        };
    };
    justification?: string;
    status?: string;
}

/**
 * Raw group assignment from Microsoft Graph API
 */
export interface RawGroupAssignment {
    id: string;
    principalId: string;
    groupId: string;
    accessId: string; // "member" or "owner"
    principal: {
        id: string;
        displayName: string;
        userPrincipalName?: string;
    };
    scheduleInfo?: {
        startDateTime?: string | null;
        expiration?: {
            endDateTime?: string | null;
            type?: string;
            duration?: string | null;
        };
    };
    justification?: string;
    status?: string;
}

// ==================== Wizard Step Props ====================

export interface WorkloadCardProps {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon; // Lucide icon component
    enabled: boolean;
    selected: boolean;
    onToggle: (id: string) => void;
}

export interface ConfigTypeCardProps {
    type: string;
    title: string;
    description: string;
    icon: LucideIcon;
    recommended?: boolean;
    selected: boolean;
    enabled: boolean;
    onSelect: (type: string) => void;
}

// ==================== NotificationCard Props ====================

export interface NotificationCardProps {
    title: string;
    settings: NotificationSectionSettings | NotificationActivationSettings;
    onChange: (settings: NotificationSectionSettings | NotificationActivationSettings) => void;
}

/**
 * Update object for notification recipient settings
 * Partial to allow updating individual fields
 */
export interface NotificationRecipientUpdate {
    isEnabled?: boolean;
    additionalRecipients?: string;
    criticalOnly?: boolean;
}

// ==================== Wizard Apply Types ====================

export interface ApplyOperationResult {
    success: boolean;
    operation: string;
    targetId: string;
    targetName?: string;
    error?: string;
    warning?: string;
    retryable: boolean;
}

export interface ApplyPhaseResult {
    policiesUpdated: number;
    policiesFailed: number;
    assignmentsCreated: number;
    assignmentsFailed: number;
    removalsCompleted: number;
    removalsFailed: number;
    operations: ApplyOperationResult[];
    errors: string[];
}

export type ApplyProgressCallback = (
    phase: "policies" | "assignments" | "removals",
    current: number,
    total: number,
    description: string
) => void;

export interface BulkRemovalRequest {
    principalId: string;
    roleDefinitionId?: string;  // for role removals
    groupId?: string;           // for group removals
    accessType?: "member" | "owner"; // for group removals
    assignmentType: "eligible" | "active";
    directoryScopeId?: string;  // for role removals, default "/"
    rowNumber: number;
}
