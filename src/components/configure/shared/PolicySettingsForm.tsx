"use client";

import React from 'react';
import { PolicySettings } from '@/hooks/useWizardState';
import { Shield, Clock, Key, CheckCircle, Users, Info, Ticket, Bell } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { DurationSlider } from '@/components/ui/DurationSlider';
import { PrincipalSelector } from './PrincipalSelector';
import { AuthContextSelector } from '@/components/AuthContextSelector';
import { ELIGIBLE_EXPIRATION_OPTIONS, ACTIVE_EXPIRATION_OPTIONS } from '@/config/constants';
import { DEFAULT_DURATIONS } from '@/utils/durationUtils';
import { NotificationCardProps, NotificationRecipientUpdate, NotificationRecipientSettings, NotificationActivationSettings } from '@/types/wizard.types';

// Microsoft default policy settings (matches Entra out-of-box defaults)
export const DEFAULT_POLICY_SETTINGS: PolicySettings = {
    maxActivationDuration: DEFAULT_DURATIONS.activationDuration,
    activationRequirement: "none",
    requireJustificationOnActivation: false,
    requireTicketInfo: false,
    requireApproval: false,
    approvers: [],
    allowPermanentEligible: true,
    eligibleExpiration: DEFAULT_DURATIONS.eligibleExpiration,
    allowPermanentActive: true,
    activeExpiration: DEFAULT_DURATIONS.activeExpiration,
    requireMfaOnActiveAssignment: false,
    requireJustificationOnActiveAssignment: false,
    notifications: {
        eligibleAssignment: {
            admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            assignee: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false }
        },
        activeAssignment: {
            admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            assignee: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false }
        },
        activation: {
            admin: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            requestor: { isEnabled: true, additionalRecipients: "", criticalOnly: false },
            approver: { isEnabled: true, additionalRecipients: "", criticalOnly: false }
        },
    },
};

interface PolicySettingsFormProps {
    /** The current policy settings for member (or the only policy for directory roles) */
    value: PolicySettings;
    onChange: (settings: PolicySettings) => void;
    workload: "directoryRoles" | "pimGroups";
    /** For pimGroups: which access type is currently being edited */
    accessType?: "member" | "owner";
    onAccessTypeChange?: (type: "member" | "owner") => void;
    /** For pimGroups: the owner policy settings */
    ownerValue?: PolicySettings;
    onOwnerChange?: (settings: PolicySettings) => void;
    /** Where the settings came from */
    configSource?: "defaults" | "loaded";
    isLoading?: boolean;
}

export function PolicySettingsForm({
    value,
    onChange,
    workload,
    accessType = "member",
    onAccessTypeChange,
    ownerValue,
    onOwnerChange,
    configSource = "defaults",
    isLoading = false,
}: PolicySettingsFormProps) {
    const isGroups = workload === "pimGroups";

    // The policy currently being displayed/edited
    const policy = isGroups && accessType === "owner" && ownerValue ? ownerValue : value;

    const updatePolicy = (updates: Partial<PolicySettings>) => {
        if (isGroups && accessType === "owner" && onOwnerChange) {
            onOwnerChange({ ...policy, ...updates });
        } else {
            onChange({ ...value, ...updates });
        }
    };

    if (isLoading) {
        return (
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-sm text-zinc-500">Loading policy settings...</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* PIM Groups: Member/Owner Toggle */}
            {isGroups && onAccessTypeChange && (
                <div className="flex bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                    <button
                        onClick={() => onAccessTypeChange("member")}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${accessType === 'member'
                            ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                    >
                        <Users className="w-4 h-4" />
                        Members
                    </button>
                    <button
                        onClick={() => onAccessTypeChange("owner")}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${accessType === 'owner'
                            ? 'bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                    >
                        <Shield className="w-4 h-4" />
                        Owners
                    </button>
                </div>
            )}

            {/* Config Source Banner */}
            <div className={`flex items-center gap-3 p-3 rounded-lg border ${configSource === 'loaded'
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                }`}>
                {configSource === 'loaded' ? (
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : (
                    <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />
                )}
                <span className={`text-sm ${configSource === 'loaded'
                    ? 'text-green-700 dark:text-green-300'
                    : 'text-blue-700 dark:text-blue-300'
                    }`}>
                    {configSource === 'loaded'
                        ? "Configuration loaded from current settings."
                        : "Settings initialized with Microsoft default values."}
                </span>
            </div>

            {/* ACTIVATION SETTINGS */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-blue-500" />
                    Activation Settings
                </h3>

                <div className="space-y-4">
                    <DurationSlider
                        value={policy.maxActivationDuration}
                        onChange={(value) => updatePolicy({ maxActivationDuration: value })}
                        min={0.5}
                        max={24}
                        step={0.5}
                        label="Activation maximum duration (hours)"
                    />

                    <div className="space-y-2">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 font-medium flex items-center gap-1">
                            On activation, require
                            <span className="relative group cursor-default">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 hidden w-72 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                    Microsoft recommends requiring Azure MFA or a Conditional Access authentication context for activation to align with Zero Trust principles. Source: Microsoft Learn – PIM best practices.
                                </span>
                            </span>
                        </label>
                        <div className="flex flex-col gap-2 pl-4">
                            {[
                                { value: "none", label: "None" },
                                { value: "mfa", label: "Azure MFA" },
                                { value: "authenticationContext", label: "Conditional Access authentication context" }
                            ].map(opt => (
                                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name={`activationRequirement-${workload}-${accessType}`}
                                        checked={policy.activationRequirement === opt.value}
                                        onChange={() => updatePolicy({ activationRequirement: opt.value as "none" | "mfa" | "authenticationContext" })}
                                        className="w-4 h-4 text-blue-500"
                                    />
                                    <span className="text-sm text-zinc-700 dark:text-zinc-300">{opt.label}</span>
                                </label>
                            ))}
                        </div>

                        {policy.activationRequirement === "authenticationContext" && (
                            <div className="mt-3 pl-4">
                                <label className="text-xs text-zinc-600 dark:text-zinc-400 block mb-2">
                                    Select authentication context
                                </label>
                                <AuthContextSelector
                                    selectedContextId={policy.authenticationContextId}
                                    onSelect={(contextId) => updatePolicy({ authenticationContextId: contextId })}
                                />
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                            Require justification on activation
                            <span className="relative group cursor-default">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 hidden w-72 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                    Microsoft recommends enabling justification to create an audit trail for all role activations. Source: Microsoft Learn – PIM best practices.
                                </span>
                            </span>
                        </label>
                        <Toggle
                            checked={policy.requireJustificationOnActivation}
                            onChange={() => updatePolicy({ requireJustificationOnActivation: !policy.requireJustificationOnActivation })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                            <Ticket className="w-4 h-4 text-zinc-400" />
                            Require ticket information on activation
                        </label>
                        <Toggle
                            checked={policy.requireTicketInfo}
                            onChange={() => updatePolicy({ requireTicketInfo: !policy.requireTicketInfo })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                            Require approval to activate
                            <span className="relative group cursor-default">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 hidden w-72 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                    Microsoft recommends requiring approval for highly privileged roles such as Global Administrator and Privileged Role Administrator. Source: Microsoft Learn – PIM best practices.
                                </span>
                            </span>
                        </label>
                        <Toggle
                            checked={policy.requireApproval}
                            onChange={() => updatePolicy({ requireApproval: !policy.requireApproval })}
                        />
                    </div>

                    {policy.requireApproval && (
                        <PrincipalSelector
                            selectedPrincipals={(policy.approvers || []).map(a => ({
                                id: a.id,
                                type: a.type,
                                displayName: a.displayName
                            }))}
                            onChange={(principals) => updatePolicy({
                                approvers: principals.map(p => ({
                                    id: p.id,
                                    type: p.type,
                                    displayName: p.displayName
                                }))
                            })}
                            label="Select approver(s)"
                            description="If no approvers are selected, Privileged Role Administrators will be default approvers."
                            addLabel="+ Add approvers"
                        />
                    )}
                </div>
            </div>

            {/* ASSIGNMENT SETTINGS */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <Key className="w-4 h-4 text-green-500" />
                    Assignment Settings
                </h3>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                            Allow permanent eligible assignment
                            <span className="relative group cursor-default">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 hidden w-72 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                    For critical roles, Microsoft recommends limiting eligible assignment duration and enabling regular access reviews to enforce the least privilege principle.
                                </span>
                            </span>
                        </label>
                        <Toggle
                            checked={policy.allowPermanentEligible}
                            onChange={() => updatePolicy({ allowPermanentEligible: !policy.allowPermanentEligible })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Expire eligible assignments after
                        </label>
                        <select
                            value={policy.eligibleExpiration || DEFAULT_DURATIONS.eligibleExpiration}
                            onChange={(e) => updatePolicy({ eligibleExpiration: e.target.value })}
                            disabled={policy.allowPermanentEligible}
                            className="px-3 py-1.5 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                        >
                            {ELIGIBLE_EXPIRATION_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <hr className="border-zinc-200 dark:border-zinc-700" />

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                            Allow permanent active assignment
                            <span className="relative group cursor-default">
                                <Info className="w-3.5 h-3.5 text-zinc-400" />
                                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 hidden w-72 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                    Microsoft recommends disabling permanent active assignments to enforce time-bound, just-in-time access. Eligible assignments with activation are preferred. Source: Microsoft Learn – Zero Trust guidance.
                                </span>
                            </span>
                        </label>
                        <Toggle
                            checked={policy.allowPermanentActive}
                            onChange={() => updatePolicy({ allowPermanentActive: !policy.allowPermanentActive })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Expire active assignments after
                        </label>
                        <select
                            value={policy.activeExpiration || DEFAULT_DURATIONS.activeExpiration}
                            onChange={(e) => updatePolicy({ activeExpiration: e.target.value })}
                            disabled={policy.allowPermanentActive}
                            className="px-3 py-1.5 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-md text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                        >
                            {ACTIVE_EXPIRATION_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>

                    <hr className="border-zinc-200 dark:border-zinc-700" />

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Require MFA on active assignment
                        </label>
                        <Toggle
                            checked={policy.requireMfaOnActiveAssignment}
                            onChange={() => updatePolicy({ requireMfaOnActiveAssignment: !policy.requireMfaOnActiveAssignment })}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <label className="text-sm text-zinc-700 dark:text-zinc-300">
                            Require justification on active assignment
                        </label>
                        <Toggle
                            checked={policy.requireJustificationOnActiveAssignment}
                            onChange={() => updatePolicy({ requireJustificationOnActiveAssignment: !policy.requireJustificationOnActiveAssignment })}
                        />
                    </div>
                </div>
            </div>

            {/* NOTIFICATION SETTINGS */}
            <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <Bell className="w-4 h-4 text-purple-500" />
                    Notification Settings
                </h3>

                <div className="space-y-6">
                    <NotificationCard
                        title="Eligible Assignment Notifications"
                        settings={policy.notifications!.eligibleAssignment}
                        onChange={(newSettings) => updatePolicy({
                            notifications: { ...policy.notifications!, eligibleAssignment: newSettings as typeof policy.notifications.eligibleAssignment }
                        })}
                    />
                    <NotificationCard
                        title="Active Assignment Notifications"
                        settings={policy.notifications!.activeAssignment}
                        onChange={(newSettings) => updatePolicy({
                            notifications: { ...policy.notifications!, activeAssignment: newSettings as typeof policy.notifications.activeAssignment }
                        })}
                    />
                    <NotificationCard
                        title="Eligibility Activation Notifications"
                        settings={policy.notifications!.activation}
                        activationMode={true}
                        onChange={(newSettings) => updatePolicy({
                            notifications: { ...policy.notifications!, activation: newSettings as NotificationActivationSettings }
                        })}
                    />
                </div>
            </div>
        </div>
    );
}

// NotificationCard sub-component (same as in PoliciesStep)
function NotificationCard({
    title,
    settings,
    onChange,
    activationMode = false
}: NotificationCardProps & { activationMode?: boolean }) {
    const settingsRecord = settings as unknown as Record<string, NotificationRecipientSettings>;

    const updateRecipient = (
        type: "admin" | "assignee" | "approver" | "requestor",
        updates: NotificationRecipientUpdate
    ) => {
        const newSettings = {
            ...settings,
            [type]: { ...settingsRecord[type], ...updates }
        } as typeof settings;
        onChange(newSettings);
    };

    const recipientKey = activationMode ? "requestor" : "assignee";
    const recipientLabel = activationMode ? "Requestor" : "Assignee";
    const recipientDesc = activationMode ? "Notification to activated user (requestor)" : "Notification to the assigned user (assignee)";

    return (
        <div className="p-3 bg-white dark:bg-zinc-700/50 rounded-md border border-zinc-200 dark:border-zinc-600">
            <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-3">
                {title}
            </h4>

            <div className="grid grid-cols-[2fr_1fr_2fr_0.5fr] gap-4 mb-2 px-2">
                <span className="text-xs font-semibold text-zinc-500">Type</span>
                <span className="text-xs font-semibold text-zinc-500">Default recipients</span>
                <span className="text-xs font-semibold text-zinc-500">Additional recipients</span>
                <span className="text-xs font-semibold text-zinc-500 text-center">Critical</span>
            </div>

            {/* Row 1: Admin */}
            <div className="grid grid-cols-[2fr_1fr_2fr_0.5fr] gap-4 items-center mb-3 px-2">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">Role assignment alert</span>
                <div className="flex items-center gap-2">
                    <Toggle
                        checked={settings.admin?.isEnabled ?? true}
                        onChange={(val) => updateRecipient('admin', { isEnabled: val })}
                        size="sm"
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">Admin</span>
                </div>
                <input
                    type="text"
                    placeholder="Email IDs separated by semicolon"
                    value={settings.admin?.additionalRecipients ?? ""}
                    onChange={(e) => updateRecipient('admin', { additionalRecipients: e.target.value })}
                    className="w-full text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800"
                />
                <div className="flex justify-center">
                    <Toggle
                        checked={settings.admin?.criticalOnly ?? false}
                        onChange={(val) => updateRecipient('admin', { criticalOnly: val })}
                        size="sm"
                    />
                </div>
            </div>

            {/* Row 2: Assignee/Requestor */}
            <div className="grid grid-cols-[2fr_1fr_2fr_0.5fr] gap-4 items-center mb-3 px-2">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">{recipientDesc}</span>
                <div className="flex items-center gap-2">
                    <Toggle
                        checked={settingsRecord[recipientKey]?.isEnabled ?? true}
                        onChange={(val) => updateRecipient(recipientKey, { isEnabled: val })}
                        size="sm"
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">{recipientLabel}</span>
                </div>
                <input
                    type="text"
                    placeholder="Email IDs separated by semicolon"
                    value={settingsRecord[recipientKey]?.additionalRecipients ?? ""}
                    onChange={(e) => updateRecipient(recipientKey, { additionalRecipients: e.target.value })}
                    className="w-full text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-800"
                />
                <div className="flex justify-center">
                    <Toggle
                        checked={settingsRecord[recipientKey]?.criticalOnly ?? false}
                        onChange={(val) => updateRecipient(recipientKey, { criticalOnly: val })}
                        size="sm"
                    />
                </div>
            </div>

            {/* Row 3: Approver */}
            <div className="grid grid-cols-[2fr_1fr_2fr_0.5fr] gap-4 items-center mb-2 px-2">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">Request to approve</span>
                <div className="flex items-center gap-2">
                    <Toggle
                        checked={settings.approver?.isEnabled ?? true}
                        onChange={(val) => updateRecipient('approver', { isEnabled: val })}
                        size="sm"
                    />
                    <span className="text-xs text-zinc-700 dark:text-zinc-300">Approver</span>
                </div>
                <div className="relative">
                    <input
                        type="text"
                        placeholder={activationMode ? "Not configurable here" : "Email IDs separated by semicolon"}
                        value={settings.approver?.additionalRecipients ?? ""}
                        onChange={(e) => updateRecipient('approver', { additionalRecipients: e.target.value })}
                        disabled={activationMode}
                        className={`w-full text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-600 ${activationMode ? 'bg-zinc-100 dark:bg-zinc-900 text-zinc-400 cursor-not-allowed pr-6' : 'bg-zinc-50 dark:bg-zinc-800'}`}
                    />
                    {activationMode && (
                        <div className="group absolute right-1.5 top-1/2 -translate-y-1/2 cursor-default">
                            <Info className="h-3.5 w-3.5 text-zinc-400" />
                            <div className="pointer-events-none absolute bottom-full right-0 z-50 mb-2 hidden w-64 rounded bg-zinc-800 px-2.5 py-2 text-xs text-white shadow-lg group-hover:block dark:bg-zinc-700">
                                The Graph API does not support additional recipients for Activation approver notifications.
                                Only the designated approvers configured in the Approval section receive these emails.
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex justify-center">
                    <Toggle
                        checked={settings.approver?.criticalOnly ?? false}
                        onChange={(val) => updateRecipient('approver', { criticalOnly: val })}
                        size="sm"
                    />
                </div>
            </div>
        </div>
    );
}
