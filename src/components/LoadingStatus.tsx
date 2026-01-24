"use client";

import { Loader2 } from "lucide-react";
import { usePimData } from "@/hooks/usePimData";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";

/**
 * Inline loading status component to display next to refresh buttons
 * Shows loading progress for both Directory Roles and PIM Groups
 * Uses consistent format: (current/total) for both workloads
 */
export function LoadingStatus() {
    const { loading: rolesLoading, policiesLoading, policyProgress, loadingMessage } = usePimData();
    const { workloads } = useUnifiedPimData();

    // PIM Groups loading state
    const pimGroupsLoading = workloads.pimGroups.loading.phase === "fetching";
    const pimGroupsProgress = workloads.pimGroups.loading.progress;

    // Directory Roles is loading if either data fetch or policies are loading
    const directoryRolesLoading = rolesLoading || policiesLoading;

    // No loading happening
    if (!directoryRolesLoading && !pimGroupsLoading) {
        return null;
    }

    return (
        <div className="flex flex-col gap-1">

            {/* Directory Roles loading */}
            {directoryRolesLoading && (
                <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 whitespace-nowrap">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    <span>
                        {loadingMessage || "Fetching role data..."}
                        {policiesLoading && policyProgress.total > 0 && (
                            <span className="font-medium ml-1">
                                ({policyProgress.current}/{policyProgress.total})
                            </span>
                        )}
                    </span>
                </div>
            )}

            {/* PIM Groups loading - same format as roles */}
            {pimGroupsLoading && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    <span>
                        {workloads.pimGroups.loading.message || "Processing groups..."}
                        {pimGroupsProgress && pimGroupsProgress.total > 0 && (
                            <span className="font-medium ml-1">
                                ({pimGroupsProgress.current}/{pimGroupsProgress.total})
                            </span>
                        )}
                    </span>
                </div>
            )}
        </div>
    );
}
