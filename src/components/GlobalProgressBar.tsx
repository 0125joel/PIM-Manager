"use client";

import { useEffect, useState } from "react";
import { usePimData } from "@/hooks/usePimData";
import { usePimGroupsLoading } from "@/hooks/usePimSelectors";

/**
 * Global progress bar that displays at the top of the viewport
 * Shows combined progress from both Directory Roles and PIM Groups
 *
 * Uses selector hooks to only re-render when loading state changes,
 * not when data changes in unrelated workloads.
 */
export function GlobalProgressBar() {
    const [isMounted, setIsMounted] = useState(false);

    // Only render client-side to avoid SSR/hydration issues
    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted) {
        return null;
    }

    return <GlobalProgressBarContent />;
}

function GlobalProgressBarContent() {
    const { loading, policiesLoading, loadingProgress, policyProgress } = usePimData();
    // Use selector hook - only re-renders when pimGroups loading state changes
    const pimGroupsLoadingState = usePimGroupsLoading();

    // PIM Groups loading state (from selector hook)
    const pimGroupsLoading = pimGroupsLoadingState.phase === "fetching";
    const pimGroupsProgress = pimGroupsLoadingState.progress;

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
