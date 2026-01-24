import { GroupPolicyRule } from "@/types/pimGroup.types";

interface GroupAssignmentTabProps {
    rules: GroupPolicyRule[];
}

export function GroupAssignmentTab({ rules }: GroupAssignmentTabProps) {
    // Helper to find specific rule
    const findRule = (ruleTypePart: string, caller: string, level: string) =>
        rules.find((r) =>
            r["@odata.type"]?.includes(ruleTypePart) &&
            r.target?.caller === caller &&
            r.target?.level === level
        );

    // Assignment settings (Admin - Eligibility and Assignment)
    const adminEligibleExpiration = findRule("ExpirationRule", "Admin", "Eligibility");
    const adminAssignExpiration = findRule("ExpirationRule", "Admin", "Assignment");
    const adminAssignEnablement = findRule("EnablementRule", "Admin", "Assignment");

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                {/* Eligible Assignment */}
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-1">
                        Eligible Assignment
                    </span>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-zinc-500">Allow Permanent:</span>
                            <span className="font-medium">{adminEligibleExpiration?.isExpirationRequired ? "No" : "Yes"}</span>
                        </div>
                        {adminEligibleExpiration?.isExpirationRequired && adminEligibleExpiration?.maximumDuration && (
                            <div className="flex justify-between text-xs">
                                <span className="text-zinc-500">Expire After:</span>
                                <span className="font-medium">{adminEligibleExpiration.maximumDuration}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Active Assignment */}
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2 border-b border-zinc-200 dark:border-zinc-700 pb-1">
                        Active Assignment
                    </span>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span className="text-zinc-500">Allow Permanent:</span>
                            <span className="font-medium">{adminAssignExpiration?.isExpirationRequired ? "No" : "Yes"}</span>
                        </div>
                        {adminAssignExpiration?.isExpirationRequired && adminAssignExpiration?.maximumDuration && (
                            <div className="flex justify-between text-xs">
                                <span className="text-zinc-500">Expire After:</span>
                                <span className="font-medium">{adminAssignExpiration.maximumDuration}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Active Assignment Settings (independent) */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Require Azure MFA on active assignment:</span>
                        <span className="font-medium">{adminAssignEnablement?.enabledRules?.includes("MultiFactorAuthentication") ? "Yes" : "No"}</span>
                    </div>
                </div>
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                    <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Require justification on active assignment:</span>
                        <span className="font-medium">{adminAssignEnablement?.enabledRules?.includes("Justification") ? "Yes" : "No"}</span>
                    </div>
                </div>
            </div>
        </>
    );
}
