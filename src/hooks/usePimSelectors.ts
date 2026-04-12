/**
 * PIM Context Selector Hooks
 *
 * These hooks implement the selector pattern to prevent unnecessary re-renders.
 * Instead of subscribing to the entire UnifiedPimContext (which triggers re-renders
 * on ANY state change), these hooks select only the specific data needed.
 *
 * Performance Impact:
 * - Before: 1 state change → 20+ component re-renders
 * - After: 1 state change → Only affected components re-render
 *
 * Usage:
 * ```tsx
 * // Instead of:
 * const { workloads } = useUnifiedPimData();
 * const groups = workloads.pimGroups.data;
 *
 * // Use:
 * const groups = usePimGroupsData();
 * ```
 */

import { useMemo, useRef, useCallback } from "react";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { WorkloadType, WorkloadLoadingState } from '@/types/workload.types';
import { PimGroupData } from "@/types/pimGroup.types";
import { Client } from "@microsoft/microsoft-graph-client";

// Re-export for convenience
export { useUnifiedPimData };

// ============================================================================
// Workload Data Selectors
// ============================================================================

/**
 * Select only PIM Groups data
 * Re-renders only when pimGroups.data reference changes
 */
export function usePimGroupsData(): PimGroupData[] {
    const context = useUnifiedPimData();
    return context.workloads.pimGroups.data;
}

/**
 * Select only PIM Groups loading state
 * Re-renders only when loading properties change
 */
export function usePimGroupsLoading(): WorkloadLoadingState {
    const context = useUnifiedPimData();
    const loading = context.workloads.pimGroups.loading;

    const prevRef = useRef<WorkloadLoadingState>(loading);

    return useMemo(() => {
        const prev = prevRef.current;
        if (
            prev.phase === loading.phase &&
            prev.progress.current === loading.progress.current &&
            prev.progress.total === loading.progress.total &&
            prev.message === loading.message
        ) {
            return prev;
        }
        prevRef.current = loading;
        return loading;
    }, [loading.phase, loading.progress.current, loading.progress.total, loading.message]);
}

/**
 * Check if PIM Groups workload is consented
 */
export function usePimGroupsConsented(): boolean {
    const context = useUnifiedPimData();
    return context.workloads.pimGroups.consent.consented;
}

// ============================================================================
// Generic Workload Selectors
// ============================================================================

/**
 * Select data for any workload
 * Type-safe based on workload type
 */
export function useWorkloadData<T>(workload: WorkloadType): T[] {
    const context = useUnifiedPimData();
    return context.workloads[workload].data as unknown as T[];
}

/**
 * Select loading state for any workload
 * Memoized to prevent re-renders on identical values
 */
export function useWorkloadLoading(workload: WorkloadType): WorkloadLoadingState {
    const context = useUnifiedPimData();
    const loading = context.workloads[workload].loading;

    const prevRef = useRef<WorkloadLoadingState>(loading);

    return useMemo(() => {
        const prev = prevRef.current;
        if (
            prev.phase === loading.phase &&
            prev.progress.current === loading.progress.current &&
            prev.progress.total === loading.progress.total
        ) {
            return prev;
        }
        prevRef.current = loading;
        return loading;
    }, [loading.phase, loading.progress.current, loading.progress.total]);
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
    const context = useUnifiedPimData();
    return context.workloads[workload].consent.consented;
}

// ============================================================================
// Global State Selectors
// ============================================================================

/**
 * Select sync history (for SyncStatus component)
 */
export function useSyncHistory() {
    const context = useUnifiedPimData();
    return context.syncHistory;
}

/**
 * Select active workloads list
 */
export function useActiveWorkloads(): WorkloadType[] {
    const context = useUnifiedPimData();
    return context.activeWorkloads;
}

/**
 * Check if context is initialized
 */
export function useIsInitialized(): boolean {
    const context = useUnifiedPimData();
    return context.initialized;
}

// ============================================================================
// Action Selectors (stable references)
// ============================================================================

/**
 * Get stable refresh function for a workload
 */
export function useRefreshWorkload(workload: WorkloadType): (force?: boolean) => Promise<void> {
    const context = useUnifiedPimData();

    return useCallback(
        (force?: boolean) => context.refreshWorkload(workload, force),
        [context.refreshWorkload, workload]
    );
}

/**
 * Get stable refresh all function
 */
export function useRefreshAllWorkloads(): () => Promise<void> {
    const context = useUnifiedPimData();
    return context.refreshAllWorkloads;
}

/**
 * Get Graph client factory (stable reference)
 */
export function useGraphClient(): () => Promise<Client> {
    const context = useUnifiedPimData();
    return context.getGraphClient;
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
 * Select PIM Groups state (convenience hook)
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
    const context = useUnifiedPimData();
    const dr = context.workloads.directoryRoles.loading;
    const pg = context.workloads.pimGroups.loading;

    return useMemo(() => ({
        directoryRoles: dr,
        pimGroups: pg,
        anyLoading:
            dr.phase === "fetching" || dr.phase === "processing" ||
            pg.phase === "fetching" || pg.phase === "processing"
    }), [dr, pg]);
}
