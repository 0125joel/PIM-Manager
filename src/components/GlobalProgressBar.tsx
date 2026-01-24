"use client";

import { usePimData } from "@/hooks/usePimData";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";

/**
 * Global progress bar that displays at the top of the viewport
 * Shows combined progress from both Directory Roles and PIM Groups
 */
export function GlobalProgressBar() {
    const { loading, policiesLoading, loadingProgress, policyProgress } = usePimData();
    const { workloads } = useUnifiedPimData();

    // PIM Groups loading state
    const pimGroupsLoading = workloads.pimGroups.loading.phase === "fetching";
    const pimGroupsProgress = workloads.pimGroups.loading.progress;

    // Calculate combined progress
    let progress = 0;
    let isVisible = false;

    // Initial Directory Roles load
    if (loading) {
        progress = loadingProgress;
        isVisible = true;
    }
    // Background loading - combine both workloads
    else if (policiesLoading || pimGroupsLoading) {
        isVisible = true;

        // Calculate weighted average of both progress values
        let totalWeight = 0;
        let weightedProgress = 0;

        // Directory Roles policy loading
        if (policiesLoading && policyProgress.total > 0) {
            const rolesPercent = (policyProgress.current / policyProgress.total) * 100;
            // Weight roles more heavily since there are typically more
            weightedProgress += rolesPercent * 0.7;
            totalWeight += 0.7;
        } else if (!policiesLoading) {
            // Roles done, give it full weight as 100%
            weightedProgress += 100 * 0.7;
            totalWeight += 0.7;
        }

        // PIM Groups loading
        if (pimGroupsLoading && pimGroupsProgress && pimGroupsProgress.total > 0) {
            const groupsPercent = (pimGroupsProgress.current / pimGroupsProgress.total) * 100;
            weightedProgress += groupsPercent * 0.3;
            totalWeight += 0.3;
        } else if (!pimGroupsLoading) {
            // Groups done or not loading
            weightedProgress += 100 * 0.3;
            totalWeight += 0.3;
        }

        progress = totalWeight > 0 ? weightedProgress / totalWeight : 0;
    }

    if (!isVisible) {
        return null;
    }

    // Determine color based on what's loading
    // Blue for roles only, emerald for groups only, gradient for both
    let gradientClass = "from-blue-500 to-blue-600";
    if (policiesLoading && pimGroupsLoading) {
        gradientClass = "from-blue-500 via-cyan-500 to-emerald-500";
    } else if (pimGroupsLoading && !policiesLoading) {
        gradientClass = "from-emerald-500 to-emerald-600";
    }

    return (
        <div className="fixed top-0 left-0 right-0 z-[100] h-1 bg-zinc-200 dark:bg-zinc-800">
            <div
                className={`h-full bg-gradient-to-r ${gradientClass} transition-all duration-300 ease-out`}
                style={{ width: `${Math.min(progress, 100)}%` }}
            />
        </div>
    );
}
