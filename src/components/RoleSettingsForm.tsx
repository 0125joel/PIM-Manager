"use client";

import { useState, useEffect } from "react";
import { RoleSettings, Principal } from "@/types";
import { UserGroupSearch } from "./UserGroupSearch";
import { AuthContextSelector } from "./AuthContextSelector";
import { Loader2 } from "lucide-react";

interface RoleSettingsFormProps {
    selectedRoleCount: number;
    onApply: (settings: RoleSettings) => void;
    initialSettings?: RoleSettings;
    isLoading?: boolean;
}

export function RoleSettingsForm({ selectedRoleCount, onApply, initialSettings, isLoading }: RoleSettingsFormProps) {
    const [activeTab, setActiveTab] = useState<"activation" | "assignment" | "notification">("activation");
    const [settings, setSettings] = useState<RoleSettings>({
        activation: {
            maxDuration: 8,
            requireMfa: "None",
            requireJustification: true,
            requireTicketInfo: false,
            requireApproval: false,
            approvers: [],
        },
        assignment: {
            allowPermanentEligible: true,
            expireEligibleAfter: "1 Year",
            allowPermanentActive: false,
            expireActiveAfter: "6 Months",
            requireMfaOnActive: false,
            requireJustificationOnActive: true,
        },
        notification: {
            eligibleAssignment: {
                sendToAdmin: true,
                sendToAssignee: false,
                sendToApprover: true,
                additionalRecipients: [],
                criticalOnly: false,
            },
            activeAssignment: {
                sendToAdmin: true,
                sendToAssignee: false,
                sendToApprover: true,
                additionalRecipients: [],
                criticalOnly: false,
            },
            eligibleActivation: {
                sendToAdmin: false,
                sendToAssignee: true,
                sendToApprover: true,
                additionalRecipients: [],
                criticalOnly: false,
            },
        },
    });

    useEffect(() => {
        if (initialSettings) {
            setSettings(initialSettings);
        }
    }, [initialSettings]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onApply(settings);
    };

    const tabs = [
        { id: "activation" as const, label: "Activation" },
        { id: "assignment" as const, label: "Assignment" },
        { id: "notification" as const, label: "Notification" },
    ];

    const isAuthContextValid = settings.activation.requireMfa !== "ConditionalAccess" || !!settings.activation.authContextId;

    return (
        <div className="w-full bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-zinc-200 dark:border-zinc-800 relative overflow-hidden">
            {isLoading && (
                <div className="absolute inset-0 bg-white/80 dark:bg-zinc-900/80 flex flex-col items-center justify-center z-50 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-2" />
                    <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Loading settings...</p>
                </div>
            )}
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Role Settings</h2>
                <p className="text-sm text-zinc-500 mt-1">Configure settings for {selectedRoleCount} selected roles</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex px-6">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                {/* ... existing tab content ... */}
                {/* Activation Tab */}
                {activeTab === "activation" && (
                    <div className="space-y-6">
                        {/* ... existing activation fields ... */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                                Activation maximum duration (hours)
                            </label>
                            <div className="relative pt-6 pb-2">
                                <input
                                    type="range"
                                    min="1"
                                    max="24"
                                    value={settings.activation.maxDuration}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        activation: { ...settings.activation, maxDuration: parseInt(e.target.value) }
                                    })}
                                    className="w-full h-2 bg-zinc-200 rounded-lg appearance-none cursor-pointer dark:bg-zinc-700"
                                />
                                <div
                                    className="absolute top-0 transform -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded"
                                    style={{ left: `${((settings.activation.maxDuration - 1) / 23) * 100}%` }}
                                >
                                    {settings.activation.maxDuration}h
                                </div>
                                <div className="flex justify-between text-xs text-zinc-500 mt-1">
                                    <span>1 hour</span>
                                    <span>24 hours</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
                                On activation, require
                            </label>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={settings.activation.requireMfa === "None"}
                                        onChange={() => setSettings({
                                            ...settings,
                                            activation: { ...settings.activation, requireMfa: "None" }
                                        })}
                                        className="h-4 w-4"
                                    />
                                    <span className="text-sm">None</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={settings.activation.requireMfa === "AzureMFA"}
                                        onChange={() => setSettings({
                                            ...settings,
                                            activation: { ...settings.activation, requireMfa: "AzureMFA" }
                                        })}
                                        className="h-4 w-4"
                                    />
                                    <span className="text-sm">Azure MFA</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={settings.activation.requireMfa === "ConditionalAccess"}
                                        onChange={() => setSettings({
                                            ...settings,
                                            activation: { ...settings.activation, requireMfa: "ConditionalAccess" }
                                        })}
                                        className="h-4 w-4"
                                    />
                                    <span className="text-sm">Microsoft Entra Conditional Access authentication context</span>
                                </label>
                                {settings.activation.requireMfa === "ConditionalAccess" && (
                                    <div className="pl-6 mt-2">
                                        <AuthContextSelector
                                            selectedContextId={settings.activation.authContextId}
                                            onSelect={(contextId) => setSettings({
                                                ...settings,
                                                activation: { ...settings.activation, authContextId: contextId }
                                            })}
                                        />
                                        {!settings.activation.authContextId && (
                                            <p className="text-xs text-red-500 mt-1">Please select an authentication context.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.activation.requireJustification}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        activation: { ...settings.activation, requireJustification: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Require justification on activation</span>
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.activation.requireTicketInfo}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        activation: { ...settings.activation, requireTicketInfo: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Require ticket information on activation</span>
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.activation.requireApproval}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        activation: { ...settings.activation, requireApproval: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Require approval to activate</span>
                            </label>
                        </div>

                        {settings.activation.requireApproval && (
                            <div className="pl-6 border-l-2 border-blue-200 dark:border-blue-800">
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                    Select approver(s)
                                </label>
                                <UserGroupSearch
                                    initialSelected={settings.activation.approvers}
                                    onSelectionChange={(principals) => setSettings({
                                        ...settings,
                                        activation: { ...settings.activation, approvers: principals }
                                    })}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Assignment Tab */}
                {activeTab === "assignment" && (
                    <div className="space-y-6">
                        <div className="space-y-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.assignment.allowPermanentEligible}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, allowPermanentEligible: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Allow permanent eligible assignment</span>
                            </label>

                            <div className="pl-6">
                                <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                                    Expire eligible assignments after
                                </label>
                                <select
                                    value={settings.assignment.expireEligibleAfter}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, expireEligibleAfter: e.target.value }
                                    })}
                                    disabled={settings.assignment.allowPermanentEligible}
                                    className="px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <option>15 Days</option>
                                    <option>1 Month</option>
                                    <option>3 Months</option>
                                    <option>6 Months</option>
                                    <option>1 Year</option>
                                    <option>2 Years</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.assignment.allowPermanentActive}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, allowPermanentActive: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Allow permanent active assignment</span>
                            </label>

                            <div className="pl-6">
                                <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                                    Expire active assignments after
                                </label>
                                <select
                                    value={settings.assignment.expireActiveAfter}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, expireActiveAfter: e.target.value }
                                    })}
                                    disabled={settings.assignment.allowPermanentActive}
                                    className="px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <option>15 Days</option>
                                    <option>1 Month</option>
                                    <option>3 Months</option>
                                    <option>6 Months</option>
                                    <option>1 Year</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-3 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.assignment.requireMfaOnActive}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, requireMfaOnActive: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Require Azure Multi-Factor Authentication on active assignment</span>
                            </label>

                            <label className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    checked={settings.assignment.requireJustificationOnActive}
                                    onChange={(e) => setSettings({
                                        ...settings,
                                        assignment: { ...settings.assignment, requireJustificationOnActive: e.target.checked }
                                    })}
                                    className="h-4 w-4 rounded"
                                />
                                <span className="text-sm font-medium">Require justification on active assignment</span>
                            </label>
                        </div>
                    </div>
                )}

                {/* Notification Tab */}
                {activeTab === "notification" && (
                    <div className="space-y-8">
                        {/* Eligible Assignment Notifications */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                                Send notifications when members are assigned as eligible to this role
                            </h3>
                            <div className="space-y-4">
                                <div className="grid grid-cols-4 gap-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                                    <div>Type</div>
                                    <div>Default recipients</div>
                                    <div>Additional recipients</div>
                                    <div>Critical emails only</div>
                                </div>
                                <NotificationRow
                                    label="Role assignment alert"
                                    rule={settings.notification.eligibleAssignment}
                                    onChange={(rule) => setSettings({
                                        ...settings,
                                        notification: { ...settings.notification, eligibleAssignment: rule }
                                    })}
                                />
                            </div>
                        </div>

                        {/* Active Assignment Notifications */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                                Send notifications when members are assigned as active to this role
                            </h3>
                            <div className="space-y-4">
                                <div className="grid grid-cols-4 gap-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                                    <div>Type</div>
                                    <div>Default recipients</div>
                                    <div>Additional recipients</div>
                                    <div>Critical emails only</div>
                                </div>
                                <NotificationRow
                                    label="Role assignment alert"
                                    rule={settings.notification.activeAssignment}
                                    onChange={(rule) => setSettings({
                                        ...settings,
                                        notification: { ...settings.notification, activeAssignment: rule }
                                    })}
                                />
                            </div>
                        </div>

                        {/* Activation Notifications */}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                                Send notifications when eligible members activate this role
                            </h3>
                            <div className="space-y-4">
                                <div className="grid grid-cols-4 gap-4 text-xs font-semibold text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800 pb-2">
                                    <div>Type</div>
                                    <div>Default recipients</div>
                                    <div>Additional recipients</div>
                                    <div>Critical emails only</div>
                                </div>
                                <NotificationRow
                                    label="Role activation alert"
                                    rule={settings.notification.eligibleActivation}
                                    onChange={(rule) => setSettings({
                                        ...settings,
                                        notification: { ...settings.notification, eligibleActivation: rule }
                                    })}
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className="pt-6 border-t border-zinc-200 dark:border-zinc-800 flex flex-col gap-2">
                    <button
                        type="submit"
                        disabled={selectedRoleCount === 0 || !isAuthContextValid}
                        className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Apply to {selectedRoleCount} Role{selectedRoleCount !== 1 ? 's' : ''}
                    </button>
                    {!isAuthContextValid && (
                        <p className="text-xs text-red-500 text-center">Please select an authentication context to proceed.</p>
                    )}
                </div>
            </form>
        </div>
    );
}

// Helper component for notification rows
function NotificationRow({ label, rule, onChange }: {
    label: string;
    rule: { sendToAdmin: boolean; sendToAssignee: boolean; sendToApprover: boolean; additionalRecipients: string[]; criticalOnly: boolean };
    onChange: (rule: any) => void;
}) {
    return (
        <div className="grid grid-cols-4 gap-4 items-start">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
            <div className="space-y-2">
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={rule.sendToAdmin}
                        onChange={(e) => onChange({ ...rule, sendToAdmin: e.target.checked })}
                        className="h-4 w-4 rounded"
                    />
                    <span className="text-sm">Admin</span>
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={rule.sendToAssignee}
                        onChange={(e) => onChange({ ...rule, sendToAssignee: e.target.checked })}
                        className="h-4 w-4 rounded"
                    />
                    <span className="text-sm">Assignee</span>
                </label>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={rule.sendToApprover}
                        onChange={(e) => onChange({ ...rule, sendToApprover: e.target.checked })}
                        className="h-4 w-4 rounded"
                    />
                    <span className="text-sm">Approver</span>
                </label>
            </div>
            <div>
                <input
                    type="text"
                    placeholder="email IDs separated by semicolon"
                    className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm"
                    value={rule.additionalRecipients.join("; ")}
                    onChange={(e) => onChange({
                        ...rule,
                        additionalRecipients: e.target.value.split(";").map(s => s.trim()).filter(Boolean)
                    })}
                />
            </div>
            <div>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={rule.criticalOnly}
                        onChange={(e) => onChange({ ...rule, criticalOnly: e.target.checked })}
                        className="h-4 w-4 rounded"
                    />
                    <span className="text-sm">Critical emails only</span>
                </label>
            </div>
        </div>
    );
}
