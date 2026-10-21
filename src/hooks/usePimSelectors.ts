/**
 * PIM Context Selector Hooks
 *
 * Thin wrappers over the three UnifiedPimContext slices (data, loading, actions).
 * Each hook subscribes only to the slice it needs, so a component that reads
 * data does not re-render on loading progress ticks and a component that only
 * needs an action never re-renders because of context updates.
 *
 * Usage:
 * ```tsx
 * const groups = usePimGroupsData();          // data slice
 * const loading = usePimGroupsLoading();      // loading slice
 * const refresh = useRefreshWorkload("pimGroups"); // actions slice
 * ```
 */

import { useMemo, useCallback } from "react";
import { useUnifiedPimData, useUnifiedData, useUnifiedLoading, useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { WorkloadType, WorkloadLoadingState } from '@/types/workload.types';
import { PimGroupData } from "@/types/pimGroup.types";
import { Client } from "@microsoft/microsoft-graph-client";

// Re-export for convenience
export { useUnifiedPimData, useUnifiedData, useUnifiedLoading, useUnifiedActions };

// ============================================================================
// Workload Data Selectors
// ============================================================================

/**
 * Select only PIM for Groups data
 * Re-renders only when the data slice changes
 */
export function usePimGroupsData(): PimGroupData[] {
    return useUnifiedData().workloads.pimGroups.data;
}

/**
 * Select only PIM for Groups loading state
 */
export function usePimGroupsLoading(): WorkloadLoadingState {
    return useUnifiedLoading().workloads.pimGroups;
}

/**
 * Check if PIM for Groups workload is consented
 */
export function usePimGroupsConsented(): boolean {
    return useUnifiedData().workloads.pimGroups.consent.consented;
}

// ============================================================================
// Generic Workload Selectors
// ============================================================================

/**
 * Select data for any workload
 * Type-safe based on workload type
 */
export function useWorkloadData<T>(workload: WorkloadType): T[] {
    return useUnifiedData().workloads[workload].data as unknown as T[];
}

/**
 * Select loading state for any workload
 */
export function useWorkloadLoading(workload: WorkloadType): WorkloadLoadingState {
    return useUnifiedLoading().workloads[workload];
}

/**
 * Check if workload is currently loading (any loading phase)
 */
export function useIsWorkloadLoading(workload: WorkloadType): boolean {
    const loading = useWorkloadLoading(workload);
    return loading.phase === "fetching" || loading.phase === "processing" || loading.phase === "consent";
}

/**
 * Check if workload is consented
 */
export function useWorkloadConsented(workload: WorkloadType): boolean {
    return useUnifiedData().workloads[workload].consent.consented;
}

// ============================================================================
// Global State Selectors
// ============================================================================

/**
 * Select sync history (for SyncStatus component)
 */
export function useSyncHistory() {
    return useUnifiedLoading().syncHistory;
}

/**
 * Select active workloads list
 */
export function useActiveWorkloads(): WorkloadType[] {
    return useUnifiedData().activeWorkloads;
}

/**
 * Check if context is initialized
 */
export function useIsInitialized(): boolean {
    return useUnifiedData().initialized;
}

// ============================================================================
// Action Selectors (stable references)
// ============================================================================

/**
 * Get stable refresh function for a workload
 */
export function useRefreshWorkload(workload: WorkloadType): (force?: boolean) => Promise<void> {
    const { refreshWorkload } = useUnifiedActions();

    return useCallback(
        (force?: boolean) => refreshWorkload(workload, force),
        [refreshWorkload, workload]
    );
}

/**
 * Get stable refresh all function
 */
export function useRefreshAllWorkloads(): (force?: boolean) => Promise<void> {
    return useUnifiedActions().refreshAllWorkloads;
}

/**
 * Get Graph client factory (stable reference)
 */
export function useGraphClient(): () => Promise<Client> {
    return useUnifiedActions().getGraphClient;
}

// ============================================================================
// Combined Selectors (for specific use cases)
// ============================================================================

/**
 * Select both data and loading state for a workload
 * Useful for components that need to show loading/data states
 */
export function useWorkloadState<T>(workload: WorkloadType): {
    data: T[];
    loading: WorkloadLoadingState;
    isLoading: boolean;
    isConsented: boolean;
} {
    const data = useWorkloadData<T>(workload);
    const loading = useWorkloadLoading(workload);
    const isLoading = loading.phase === "fetching" || loading.phase === "processing";
    const isConsented = useWorkloadConsented(workload);

    return useMemo(() => ({
        data,
        loading,
        isLoading,
        isConsented
    }), [data, loading, isLoading, isConsented]);
}

/**
 * Select PIM for Groups state (convenience hook)
 */
export function usePimGroupsState() {
    return useWorkloadState<PimGroupData>("pimGroups");
}

// ============================================================================
// Loading-Only Selectors (for progress bars and status indicators)
// ============================================================================

/**
 * Get all workload loading states
 * For components like GlobalProgressBar that need to show combined loading
 */
export function useAllWorkloadsLoading(): {
    directoryRoles: WorkloadLoadingState;
    pimGroups: WorkloadLoadingState;
    anyLoading: boolean;
} {
    const { workloads } = useUnifiedLoading();
    const dr = workloads.directoryRoles;
    const pg = workloads.pimGroups;

    return useMemo(() => ({
        directoryRoles: dr,
        pimGroups: pg,
        anyLoading:
            dr.phase === "fetching" || dr.phase === "processing" ||
            pg.phase === "fetching" || pg.phase === "processing"
    }), [dr, pg]);
}
