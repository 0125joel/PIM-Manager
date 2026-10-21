"use client";

import { useCallback, useMemo } from "react";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { AuthenticationContext } from "@/types/shared.types";
import { useUnifiedActions, useUnifiedData, useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { createPolicyLoadedHandler, type DirectoryRolesExtras, type RolesContent } from "@/workloads/directoryRolesAdapter";
import { fetchSinglePolicy } from "@/services/directoryRoleService";

import { Logger } from "@/utils/logger";
import { isForbiddenRead } from "@/utils/policyReadAccess";

/**
 * Directory Roles through the unified provider (NG-09). The shapes are the ones the pages have always read; the
 * state itself lives in `UnifiedPimContext` and is loaded by `workloads/directoryRolesAdapter.ts`.
 */

/** Roles, auth contexts and errors. Does not change on loading progress ticks. */
export interface RolesDataValue {
    rolesData: RoleDetailData[];
    authenticationContexts: AuthenticationContext[];
    error: string | null;
    lastFetched: Date | null;
    /** Roles whose policy could not be read, even after the second pass */
    failedRoleIds: string[];
}

/** Loading flags and progress. Changes on every progress tick. */
export interface RolesLoadingValue {
    /** The fast phase (definitions and assignments) */
    loading: boolean;
    /** The background phase (a policy per role), and a quiet smart refresh */
    policiesLoading: boolean;
    policyProgress: { current: number; total: number };
    /** Percentage of the fast phase */
    loadingProgress: number;
    loadingMessage: string;
}

/** Stable action functions. */
export interface RolesActionsValue {
    /** Page mount: loads what is not loaded, honours the 60 minute TTL and the session cache, one load at a time */
    fetchData: () => Promise<void>;
    clearData: () => void;
    /** Refresh directory roles. Without `force` the loaded data stays visible while assignments and every policy are read again in the background; `force` reloads everything and blocks. */
    refreshData: (force?: boolean) => Promise<void>;
    fetchPolicyForRole: (roleId: string) => Promise<void>;
}

export type PimDataContextType = RolesDataValue & RolesLoadingValue & RolesActionsValue;

/** Directory Roles data only; does not re-render on loading progress. */
export function useRolesData(): RolesDataValue {
    const slice = useUnifiedData().workloads.directoryRoles;
    const lastFetched = useMemo(() => (slice.lastFetched ? new Date(slice.lastFetched) : null), [slice.lastFetched]);
    return useMemo(() => ({
        rolesData: slice.data,
        authenticationContexts: slice.extras.authenticationContexts,
        error: slice.error ?? null,
        lastFetched,
        failedRoleIds: slice.extras.failedRoleIds,
    }), [slice.data, slice.extras, slice.error, lastFetched]);
}

/** Directory Roles loading flags and progress; re-renders on every progress tick. */
export function useRolesLoading(): RolesLoadingValue {
    const state = useUnifiedLoading().workloads.directoryRoles;
    return useMemo(() => ({
        loading: state.phase === "fetching",
        policiesLoading: state.background?.running ?? false,
        policyProgress: state.background?.progress ?? { current: 0, total: 0 },
        loadingProgress: state.percent ?? 0,
        loadingMessage: state.message,
    }), [state]);
}

/** Stable Directory Roles actions; never re-renders consumers. */
export function useRolesActions(): RolesActionsValue {
    const { loadWorkload, refreshWorkload, clearWorkload, patchWorkload, peekWorkload, getGraphClient } = useUnifiedActions();

    const fetchData = useCallback(() => loadWorkload("directoryRoles"), [loadWorkload]);
    const clearData = useCallback(() => clearWorkload("directoryRoles"), [clearWorkload]);
    const refreshData = useCallback((force: boolean = false) => refreshWorkload("directoryRoles", force), [refreshWorkload]);

    // Priority fetch for one role (its card was opened): reads live data, stable identity
    const fetchPolicyForRole = useCallback(async (roleId: string) => {
        const role = peekWorkload<RoleDetailData, DirectoryRolesExtras>("directoryRoles").data.find((r) => r.definition.id === roleId);
        if (role?.policy) return;
        const patch = (updater: (content: RolesContent) => RolesContent) =>
            patchWorkload<RoleDetailData, DirectoryRolesExtras>("directoryRoles", updater, true);
        // null means we checked and found nothing; the state must record that too
        const current = () => peekWorkload<RoleDetailData, DirectoryRolesExtras>("directoryRoles");
        try {
            const client = await getGraphClient();
            const policy = await fetchSinglePolicy(client, roleId);
            createPolicyLoadedHandler(client, patch, current)(roleId, policy);
        } catch (error) {
            // A 403 is recorded as not readable; any other failure leaves the role untouched so the user can try again
            if (isForbiddenRead(error)) createPolicyLoadedHandler(await getGraphClient(), patch, current)(roleId, null, undefined, true);
            else Logger.error("PimData", `Priority fetch failed for ${roleId}`, error);
        }
    }, [peekWorkload, patchWorkload, getGraphClient]);




    return useMemo(() => ({
        fetchData, clearData, refreshData, fetchPolicyForRole,
    }), [fetchData, clearData, refreshData, fetchPolicyForRole]);
}

/**
 * Compatibility hook that merges the three into the previous single value. It re-renders on any change; prefer
 * useRolesData, useRolesLoading or useRolesActions in components.
 */
export function usePimData(): PimDataContextType {
    const data = useRolesData();
    const loading = useRolesLoading();
    const actions = useRolesActions();
    return useMemo(() => ({ ...data, ...loading, ...actions }), [data, loading, actions]);
}
