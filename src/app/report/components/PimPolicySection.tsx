import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { getAuthContextDisplayName } from "@/utils/authContextApi";

interface PimPolicySectionProps {
    policy: any;
    loadingApprovers: boolean;
    approvers: any[];
    authenticationContexts: any[];
}

export function PimPolicySection({ policy, loadingApprovers, approvers, authenticationContexts }: PimPolicySectionProps) {
    const [activeTab, setActiveTab] = useState<"activation" | "assignment" | "notification">("activation");

    // Helper to filter rules
    const getRules = (type: string) => policy.details.rules?.filter((r: any) => r["@odata.type"]?.includes(type)) || [];

    const approvalRules = getRules("ApprovalRule");
    const expirationRules = getRules("ExpirationRule");
    const enablementRules = getRules("EnablementRule");
    const notificationRules = getRules("NotificationRule");
    const authContextRules = getRules("AuthenticationContextRule");

    // Helper to find specific rule for a target
    const findRule = (rules: any[], caller: string, level: string) =>
        rules.find((r: any) => r.target?.caller === caller && r.target?.level === level);

    // Activation Settings (EndUser - Assignment)
    const activationExpiration = findRule(expirationRules, "EndUser", "Assignment");
    const activationEnablement = findRule(enablementRules, "EndUser", "Assignment");
    const activationAuthContext = findRule(authContextRules, "EndUser", "Assignment");
    const activationApproval = findRule(approvalRules, "EndUser", "Assignment");

    // Assignment Settings (Admin - Assignment/Eligibility)
    const adminAssignExpiration = findRule(expirationRules, "Admin", "Assignment");
    const adminEligibleExpiration = findRule(expirationRules, "Admin", "Eligibility");
    const adminAssignEnablement = findRule(enablementRules, "Admin", "Assignment");
    const adminEligibleEnablement = findRule(enablementRules, "Admin", "Eligibility");


    // Helper for Notification Table Rows
    const renderNotificationRow = (label: string, recipientType: string, targetCaller: string, targetLevel: string) => {
        // Find rules matching the target
        const targetRules = notificationRules.filter((r: any) =>
            r.target?.caller === targetCaller && r.target?.level === targetLevel
        );

        // Find specific rule for this recipient type within the target rules
        const rule = targetRules.find((r: any) => r.recipientType === recipientType);

        const isDefault = rule?.isDefaultRecipientsEnabled ?? false;
        const additional = rule?.notificationRecipients?.join("; ") || "";
        const isCritical = rule?.notificationLevel === "Critical";

        // Check if this is an Approver row for ACTIVATION notifications (EndUser/Assignment) and approval is required
        // Only activation notifications have approval workflow, not assignment notifications
        const isApproverRow = recipientType === "Approver";
        const isActivationNotification = targetCaller === "EndUser" && targetLevel === "Assignment";
        const approvalRequired = activationApproval?.setting?.isApprovalRequired ?? false;
        const shouldDisableApprover = isApproverRow && isActivationNotification && approvalRequired;

        return (
            <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{label}</td>
                <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                        {isDefault ? <Check className="h-4 w-4 text-blue-600" /> : <X className="h-4 w-4 text-zinc-400" />}
                        <span className="text-zinc-700 dark:text-zinc-300">{recipientType === "Requestor" ? "Assignee" : recipientType}</span>
                    </div>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400 text-xs break-all relative group">
                    {shouldDisableApprover ? (
                        <>
                            <span className="text-zinc-400 italic">Only designated approvers can receive this email</span>
                            <div className="absolute hidden group-hover:block bottom-full left-0 mb-2 px-3 py-2 bg-zinc-900 text-white text-xs rounded shadow-lg whitespace-nowrap z-10">
                                Additional recipients cannot be added when approval is required
                            </div>
                        </>
                    ) : (
                        additional || "-"
                    )}
                </td>
                <td className="px-3 py-2 text-center">
                    {isCritical ? <Check className="h-4 w-4 text-zinc-600 mx-auto" /> : <X className="h-4 w-4 text-zinc-400 mx-auto" />}
                </td>
            </tr>
        );
    };

    const NotificationTable = ({ title, caller, level }: { title: string, caller: string, level: string }) => (
        <div className="mb-6 last:mb-0">
            <h6 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-2 uppercase tracking-wider">
                {title}
            </h6>
            <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm text-left table-fixed">
                    <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 uppercase">
                        <tr>
                            <th className="px-3 py-2 font-medium" style={{ width: '40%' }}>Type</th>
                            <th className="px-3 py-2 font-medium" style={{ width: '20%' }}>Default Recipients</th>
                            <th className="px-3 py-2 font-medium" style={{ width: '28%' }}>Additional Recipients</th>
                            <th className="px-3 py-2 font-medium text-center" style={{ width: '12%' }}>Critical Only</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                        {renderNotificationRow("Role assignment alert", "Admin", caller, level)}
                        {renderNotificationRow(caller === "EndUser" ? "Notification to activated user" : "Notification to the assigned user (assignee)", "Requestor", caller, level)}
                        {renderNotificationRow(caller === "EndUser" ? "Request to approve an activation" : "Request to approve a role assignment renewal/extension", "Approver", caller, level)}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div>
            {/* Tabs Header */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-4">
                <button
                    onClick={() => setActiveTab("activation")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "activation"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Activation
                </button>
                <button
                    onClick={() => setActiveTab("assignment")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "assignment"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Assignment
                </button>
                <button
                    onClick={() => setActiveTab("notification")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "notification"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Notification
                </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[200px]">
                {activeTab === "activation" && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs text-zinc-500 mb-1">Maximum Duration</span>
                                <span className="font-medium">{activationExpiration?.maximumDuration || "Default"}</span>
                            </div>
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs text-zinc-500 mb-1">On activation, require</span>
                                <span className="font-medium">
                                    {(() => {
                                        if (activationAuthContext?.isEnabled && activationAuthContext?.claimValue) {
                                            const displayName = getAuthContextDisplayName(authenticationContexts, activationAuthContext.claimValue);
                                            return `Conditional Access: ${displayName || activationAuthContext.claimValue}`;
                                        }
                                        if (activationEnablement?.enabledRules?.includes("MultiFactorAuthentication")) {
                                            return "Azure Multi-Factor Authentication";
                                        }
                                        return "None";
                                    })()}
                                </span>
                            </div>
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs text-zinc-500 mb-1">Requirements</span>
                                <div className="flex flex-wrap gap-2">
                                    {activationEnablement?.enabledRules?.includes("Justification") && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">Justification</span>}
                                    {activationEnablement?.enabledRules?.includes("Ticketing") && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">Ticket</span>}
                                    {(!activationEnablement?.enabledRules || (activationEnablement.enabledRules.length === 0) || (activationEnablement.enabledRules.length === 1 && activationEnablement.enabledRules.includes("MultiFactorAuthentication"))) && <span className="text-zinc-500">None</span>}
                                </div>
                            </div>
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs text-zinc-500 mb-1">Approval Required</span>
                                <span className="font-medium">{activationApproval?.setting?.isApprovalRequired ? "Yes" : "No"}</span>
                            </div>
                        </div>

                        {/* Approvers List */}
                        {activationApproval?.setting?.isApprovalRequired && (
                            <div className="mt-3">
                                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Approvers</span>
                                {loadingApprovers ? (
                                    <div className="flex items-center gap-2 text-sm text-zinc-500">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading approvers...
                                    </div>
                                ) : approvers.length > 0 ? (
                                    <div className="flex flex-wrap gap-2">
                                        {approvers.map((approver: any, index: number) => (
                                            <div key={`${approver.id || 'unknown'}-${index}`} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-1 rounded border border-blue-100 dark:border-blue-800">
                                                {approver.displayName || approver.id}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-sm text-zinc-500 italic">No approvers found</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === "assignment" && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            {/* Eligible Assignment */}
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-1">Eligible Assignment</span>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500">Allow Permanent:</span>
                                        <span className="font-medium">{adminEligibleExpiration?.isExpirationRequired ? "No" : "Yes"}</span>
                                    </div>
                                    {adminEligibleExpiration?.isExpirationRequired && adminEligibleExpiration?.maximumDuration && (
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Expire After:</span>
                                            <span className="font-medium">{adminEligibleExpiration.maximumDuration}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Active Assignment */}
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-1">Active Assignment</span>
                                <div className="space-y-2">
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500">Allow Permanent:</span>
                                        <span className="font-medium">{adminAssignExpiration?.isExpirationRequired ? "No" : "Yes"}</span>
                                    </div>
                                    {adminAssignExpiration?.isExpirationRequired && adminAssignExpiration?.maximumDuration && (
                                        <div className="flex justify-between">
                                            <span className="text-zinc-500">Expire After:</span>
                                            <span className="font-medium">{adminAssignExpiration.maximumDuration}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Active Assignment Settings (independent) */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Require Azure MFA on active assignment:</span>
                                    <span className="font-medium">{adminAssignEnablement?.enabledRules?.includes("MultiFactorAuthentication") ? "Yes" : "No"}</span>
                                </div>
                            </div>
                            <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">Require justification on active assignment:</span>
                                    <span className="font-medium">{adminAssignEnablement?.enabledRules?.includes("Justification") ? "Yes" : "No"}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === "notification" && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                        <NotificationTable
                            title="Send notifications when members are assigned as eligible to this role"
                            caller="Admin"
                            level="Eligibility"
                        />
                        <NotificationTable
                            title="Send notifications when members are assigned as active to this role"
                            caller="Admin"
                            level="Assignment"
                        />
                        <NotificationTable
                            title="Send notifications when eligible members activate this role"
                            caller="EndUser"
                            level="Assignment"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
