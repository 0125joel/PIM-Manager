import { memo, useState } from "react";
import { Shield, Users, CheckCircle2, ChevronDown, ChevronRight, Settings, Loader2, Info } from "lucide-react";
import { RoleDetailData } from "@/types/directoryRole.types";
import { RoleConfigWarning } from "@/components/DataWarningBanner";
import { AssignmentsSection } from "./AssignmentsSection";
import { PimPolicySection } from "./PimPolicySection";

interface RoleCardProps {
    roleData: RoleDetailData;
    isExpanded: boolean;
    onToggle: () => void;
    loadingApprovers: boolean;
    approversCache: Map<string, any[]>;
    authenticationContexts: any[];
}

export const RoleCard = memo(function RoleCard({ roleData, isExpanded, onToggle, loadingApprovers, approversCache, authenticationContexts }: RoleCardProps) {
    const { definition, assignments, policy } = roleData;
    const totalAssignments = assignments.permanent.length + assignments.eligible.length + assignments.active.length;
    const isPimConfigured = !!policy;

    // Independent state for each section
    const [assignmentsExpanded, setAssignmentsExpanded] = useState(false);
    const [configExpanded, setConfigExpanded] = useState(false);

    return (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            {/* Role Header - Always Visible */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {definition.displayName}
                            </h3>
                            {definition.isBuiltIn && (
                                <span className="px-2 py-0.5 text-xs rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                    Built-in
                                </span>
                            )}
                            {definition.isPrivileged && (
                                <span className="px-2 py-0.5 text-xs rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                                    <Shield className="h-3 w-3" />
                                    Privileged
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                            {definition.description}
                        </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                        <div className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            <span>{totalAssignments} assignments</span>
                        </div>
                        {isPimConfigured && (
                            <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span>PIM Configured</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Role Assignments Section - Collapsible */}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
                <div
                    onClick={() => setAssignmentsExpanded(!assignmentsExpanded)}
                    className="p-4 bg-white dark:bg-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        {assignmentsExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                        <Users className="h-4 w-4 text-zinc-500" />
                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Role Assignments</h4>
                        <span className="text-sm text-zinc-500">({totalAssignments})</span>
                    </div>
                </div>
                {assignmentsExpanded && (
                    <div className="px-6 pb-6 bg-white dark:bg-zinc-900">
                        <AssignmentsSection assignments={assignments} />
                    </div>
                )}
            </div>
            {/* PIM Role Configuration Section - Collapsible */}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
                <div
                    onClick={() => {
                        setConfigExpanded(!configExpanded);
                        if (!configExpanded) {
                            onToggle();
                        }
                    }}
                    className="p-4 bg-white dark:bg-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        {configExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                        <Settings className="h-4 w-4 text-zinc-500" />
                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Role Configuration</h4>
                    </div>
                    {isPimConfigured ? (
                        <span className="text-sm text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                    ) : (
                        <span className="text-sm text-zinc-500">Not Configured</span>
                    )}
                </div>
                {configExpanded && (
                    <div className="px-6 pb-6 bg-white dark:bg-zinc-900">
                        {/* PIM Policy Section - Always show if policy exists */}
                        {policy && (
                            <PimPolicySection
                                policy={policy}
                                loadingApprovers={loadingApprovers}
                                approvers={approversCache.get(definition.id) || []}
                                authenticationContexts={authenticationContexts}
                            />
                        )}


                        {/* Loading State - Only when policy is undefined */}
                        {policy === undefined && !roleData.configError && (
                            <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                                <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                                <div>
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Loading Configuration...</p>
                                    <p className="text-xs text-zinc-500">Fetching PIM policy settings</p>
                                </div>
                            </div>
                        )}

                        {/* Error State - When config failed to load */}
                        {roleData.configError && (
                            <RoleConfigWarning error={roleData.configError} />
                        )}

                        {/* Validated Empty State - When policy is explicitly null and no error */}
                        {policy === null && !roleData.configError && (
                            <div className="flex items-center gap-3 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                                <Info className="h-5 w-5 text-zinc-400" />
                                <div>
                                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No Configuration Found</p>
                                    <p className="text-xs text-zinc-500">This role has no PIM policy explicitly assigned.</p>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});
