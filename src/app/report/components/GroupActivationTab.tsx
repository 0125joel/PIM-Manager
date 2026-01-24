import { GroupPolicyRule } from "@/types/pimGroup.types";
import { getAuthContextDisplayName } from "@/utils/authContextApi";

interface GroupActivationTabProps {
    rules: GroupPolicyRule[];
    authenticationContexts?: any[];
}

export function GroupActivationTab({ rules, authenticationContexts = [] }: GroupActivationTabProps) {
    // Helper to find specific rule
    const findRule = (ruleTypePart: string, caller: string, level: string) =>
        rules.find((r) =>
            r["@odata.type"]?.includes(ruleTypePart) &&
            r.target?.caller === caller &&
            r.target?.level === level
        );

    // Activation settings (EndUser - Assignment)
    const activationExpiration = findRule("ExpirationRule", "EndUser", "Assignment");
    const activationEnablement = findRule("EnablementRule", "EndUser", "Assignment");
    const activationApproval = findRule("ApprovalRule", "EndUser", "Assignment");
    const activationAuthContext = findRule("AuthenticationContextRule", "EndUser", "Assignment");

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <span className="block text-xs text-zinc-500 mb-1">Maximum Duration</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {activationExpiration?.maximumDuration || "Default"}
                    </span>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <span className="block text-xs text-zinc-500 mb-1">On activation, require</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {(() => {
                            // Check for Conditional Access context first - casting safely as we know the structure but type definition might be incomplete
                            const authContext = activationAuthContext as any;
                            if (authContext?.isEnabled && authContext?.claimValue) {
                                const displayName = getAuthContextDisplayName(authenticationContexts, authContext.claimValue);
                                return `Conditional Access: ${displayName || authContext.claimValue}`;
                            }
                            // Fall back to MFA check
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
                        {activationEnablement?.enabledRules?.includes("Justification") && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">
                                Justification
                            </span>
                        )}
                        {activationEnablement?.enabledRules?.includes("Ticketing") && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 rounded text-xs">
                                Ticket
                            </span>
                        )}
                        {!activationEnablement?.enabledRules?.includes("Justification") &&
                            !activationEnablement?.enabledRules?.includes("Ticketing") && (
                                <span className="text-zinc-500">None</span>
                            )}
                    </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <span className="block text-xs text-zinc-500 mb-1">Approval Required</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {activationApproval?.setting?.isApprovalRequired ? "Yes" : "No"}
                    </span>
                </div>
            </div>

            {/* Approvers List - show when approval is required */}
            {activationApproval?.setting?.isApprovalRequired && (() => {
                const setting = activationApproval.setting as any; // Temporary cast due to complex nested structure
                const approvers = setting?.approvalStages?.[0]?.primaryApprovers ||
                    setting?.primaryApprovers || [];
                return (
                    <div className="mt-3">
                        <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Approvers</span>
                        {approvers.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {approvers.map((approver: any, index: number) => (
                                    <div key={`${approver.id || 'unknown'}-${index}`} className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-2 py-1 rounded border border-blue-100 dark:border-blue-800">
                                        {approver.description || approver.displayName || approver.id || "Unknown"}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-zinc-500 italic">No approvers configured</div>
                        )}
                    </div>
                );
            })()}
        </>
    );
}
