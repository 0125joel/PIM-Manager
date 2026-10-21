"use client";

import { useRolesLoading } from "@/hooks/usePimData";
import { usePimGroupsLoading } from "@/hooks/usePimSelectors";
import type { LoadingSnapshot } from "@/utils/loadingStatus";

/** Reads both workloads' loading state once, in the shape the pure helpers in utils/loadingStatus.ts take. */
export function useLoadingSnapshot(): LoadingSnapshot {
    const { loading, loadingProgress, policiesLoading, policyProgress } = useRolesLoading();
    const groups = usePimGroupsLoading();
    return {
        rolesLoading: loading,
        rolesProgress: loadingProgress,
        policiesLoading,
        policyProgress,
        groupsLoading: groups.phase === "fetching",
        groupsProgress: groups.progress,
    };
}
