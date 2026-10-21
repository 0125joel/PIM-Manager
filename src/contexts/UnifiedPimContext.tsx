"use client";

import { createContext, useContext, useState, useCallback, useMemo, ReactNode, useEffect, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { Client } from "@microsoft/microsoft-graph-client";
import { loginRequest } from "@/config/authConfig";
import { RoleDetailData } from "@/types/directoryRole.types";
import { WorkloadType, WorkloadState, WorkloadLoadingState, WorkloadConsentState } from '@/types/workload.types';
import { PimGroupData as PimGroupDataType } from "@/types/pimGroup.types";
import { useConsentedWorkloads } from "@/hooks/useConsentedWorkloads";
import { setWorkloadEnabled } from "@/hooks/useIncrementalConsent";
import { Logger } from "@/utils/logger";
import { LiveValue } from "@/utils/liveValue";
import { createGraphClient } from "@/utils/graphClient";
import { WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";
import { createWorkloadEngine, isWorkloadFresh } from "@/workloads/engine";
import { directoryRolesAdapter, INITIAL_ROLES_EXTRAS, type DirectoryRolesExtras } from "@/workloads/directoryRolesAdapter";
import { pimGroupsAdapter } from "@/workloads/pimGroupsAdapter";
import type { WorkloadContent, WorkloadEngine, WorkloadEngineDeps } from "@/workloads/types";

// ============================================================================
// Types
// ============================================================================

// For now we only have DirectoryRoles data type implemented
// Future workloads will add their types here
export type DirectoryRolesData = RoleDetailData;

// Re-export actual PimGroupData from groupData.ts
export type { PimGroupData } from "@/types/pimGroup.types";

export interface IntuneRoleData {
    id: string;
    displayName: string;
    // Will be expanded in Fase 4
}

export interface ExchangeRoleData {
    id: string;
    displayName: string;
    // Will be expanded in Fase 4
}

export interface SharePointData {
    id: string;
    displayName: string;
    // Will be expanded in Fase 4
}

export interface DefenderRoleData {
    id: string;
    displayName: string;
    // Will be expanded in Fase 5
}

// ============================================================================
// Sync History (for "what changed" visibility)
// ============================================================================

export interface SyncHistoryEntry {
    id: string;
    timestamp: Date;
    workload: WorkloadType;
}

// ============================================================================
// State Interfaces
// ============================================================================

export interface UnifiedPimState {
    initialized: boolean;
    activeWorkloads: WorkloadType[];
    syncHistory: SyncHistoryEntry[];  // Track recent sync changes
    workloads: {
        directoryRoles: WorkloadState<DirectoryRolesData, DirectoryRolesExtras>;
        pimGroups: WorkloadState<PimGroupDataType>;
        intune: WorkloadState<IntuneRoleData>;
        exchange: WorkloadState<ExchangeRoleData>;
        sharepoint: WorkloadState<SharePointData>;
        defender: WorkloadState<DefenderRoleData>;
    };
}

export interface UnifiedPimContextValue extends UnifiedPimState {
    // Query helpers
    getAvailableWorkloads: () => WorkloadType[];
    getWorkloadData: <T>(workload: WorkloadType) => T[];
    isWorkloadLoading: (workload: WorkloadType) => boolean;
    isWorkloadConsented: (workload: WorkloadType) => boolean;

    // Actions
    refreshWorkload: (workload: WorkloadType, force?: boolean) => Promise<void>;
    refreshAllWorkloads: (force?: boolean) => Promise<void>;
    enableWorkload: (workload: WorkloadType) => Promise<boolean>;
    disableWorkload: (workload: WorkloadType) => void;
    addSyncHistoryEntry: (entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'> & { timestamp?: Date }) => void;

    // Graph client helper
    getGraphClient: () => Promise<Client>;
}

/** Data-only view of a workload: changes only when data, extras, consent, lastFetched or the error change (not on progress ticks) */
export interface WorkloadDataSlice<T, X = undefined> {
    data: T[];
    extras: X;
    consent: WorkloadConsentState;
    lastFetched?: string;
    error?: string;
}

export interface UnifiedWorkloadDataMap {
    directoryRoles: WorkloadDataSlice<DirectoryRolesData, DirectoryRolesExtras>;
    pimGroups: WorkloadDataSlice<PimGroupDataType>;
    intune: WorkloadDataSlice<IntuneRoleData>;
    exchange: WorkloadDataSlice<ExchangeRoleData>;
    sharepoint: WorkloadDataSlice<SharePointData>;
    defender: WorkloadDataSlice<DefenderRoleData>;
}

/** Workload data and consent. Does not change on loading progress ticks. */
export interface UnifiedDataValue {
    initialized: boolean;
    activeWorkloads: WorkloadType[];
    workloads: UnifiedWorkloadDataMap;
    getWorkloadData: <T>(workload: WorkloadType) => T[];
    isWorkloadConsented: (workload: WorkloadType) => boolean;
}

/** Loading phase, progress and sync history. Changes on every progress tick. */
export interface UnifiedLoadingValue {
    workloads: Record<WorkloadType, WorkloadLoadingState>;
    syncHistory: SyncHistoryEntry[];
    isWorkloadLoading: (workload: WorkloadType) => boolean;
    getAvailableWorkloads: () => WorkloadType[];
}

/** Stable action functions. The object identity never changes after mount. */
export interface UnifiedActionsValue {
    /** Page mount: loads what is not loaded, honours the 60 minute TTL and never starts a second load */
    loadWorkload: (workload: WorkloadType) => Promise<void>;
    /** Refresh button (`force` false, a smart refresh) and after a write (`force` true, everything again) */
    refreshWorkload: (workload: WorkloadType, force?: boolean) => Promise<void>;
    refreshAllWorkloads: (force?: boolean) => Promise<void>;
    enableWorkload: (workload: WorkloadType) => Promise<boolean>;
    disableWorkload: (workload: WorkloadType) => void;
    /** Sign out: abort, forget the cache and empty the workload */
    clearWorkload: (workload: WorkloadType) => void;
    /** Change what a workload has loaded (a policy that arrived); batched, `immediate` applies at once */
    patchWorkload: <T, X = undefined>(workload: WorkloadType, updater: (content: WorkloadContent<T, X>) => WorkloadContent<T, X>, immediate?: boolean) => void;
    /** What a workload has loaded right now, read live */
    peekWorkload: <T, X = undefined>(workload: WorkloadType) => WorkloadContent<T, X>;
    addSyncHistoryEntry: (entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'> & { timestamp?: Date }) => void;
    getGraphClient: (scopes?: string[]) => Promise<Client>;
}

// ============================================================================
// Initial State Factory
// ============================================================================

function createInitialWorkloadState<T, X = undefined>(extras: X): WorkloadState<T, X> {
    return {
        workload: "directoryRoles", // Will be overridden
        data: [],
        extras,
        loading: {
            phase: "idle",
            progress: { current: 0, total: 0 },
            message: ""
        },
        consent: {
            consented: false
        },
        lastFetched: undefined
    };
}

function createInitialState(): UnifiedPimState {
    return {
        initialized: false,
        activeWorkloads: [],
        syncHistory: [],
        workloads: {
            directoryRoles: { ...createInitialWorkloadState<DirectoryRolesData, DirectoryRolesExtras>(INITIAL_ROLES_EXTRAS), workload: "directoryRoles", consent: { consented: true } },
            pimGroups: { ...createInitialWorkloadState<PimGroupDataType>(undefined), workload: "pimGroups" },
            intune: { ...createInitialWorkloadState<IntuneRoleData>(undefined), workload: "intune" },
            exchange: { ...createInitialWorkloadState<ExchangeRoleData>(undefined), workload: "exchange" },
            sharepoint: { ...createInitialWorkloadState<SharePointData>(undefined), workload: "sharepoint" },
            defender: { ...createInitialWorkloadState<DefenderRoleData>(undefined), workload: "defender" }
        }
    };
}

/** The workloads that have an engine; the others are planned (spec: Azure, Intune, Exchange, SharePoint join with an adapter) */
type EngineKey = "directoryRoles" | "pimGroups";

// ============================================================================
// Load Priority Order
// ============================================================================

const LOAD_PRIORITY: WorkloadType[] = [
    "directoryRoles",
    "pimGroups",
    "intune",
    "exchange",
    "sharepoint"
    // defender is external, not in auto-load
];

// ============================================================================
// Context
// ============================================================================

// Three contexts rendered by one provider, so a component that only needs data
// (or only actions) does not re-render on loading progress ticks and vice versa.
const UnifiedDataContext = createContext<UnifiedDataValue | undefined>(undefined);
const UnifiedLoadingContext = createContext<UnifiedLoadingValue | undefined>(undefined);
const UnifiedActionsContext = createContext<UnifiedActionsValue | undefined>(undefined);

function useWorkloadDataSlice<T, X>(ws: WorkloadState<T, X>): WorkloadDataSlice<T, X> {
    const error = ws.loading.error;
    return useMemo(
        () => ({ data: ws.data, extras: ws.extras, consent: ws.consent, lastFetched: ws.lastFetched, error }),
        [ws.data, ws.extras, ws.consent, ws.lastFetched, error]
    );
}

export function UnifiedPimProvider({ children }: { children: ReactNode }) {
    const { instance, accounts } = useMsal();
    const { checkConsent } = useConsentedWorkloads();
    const [state, setState] = useState<UnifiedPimState>(createInitialState);
    const initializingRef = useRef(false);

    // Ref mirror of the latest state so stable callbacks (refreshWorkload) never
    // operate on a stale snapshot of workload data or lastFetched
    const stateRef = useRef<UnifiedPimState>(state);
    const [liveState] = useState(() => new LiveValue<UnifiedPimState>(state));
    useEffect(() => {
        stateRef.current = state;
        liveState.set(state);
    }, [state, liveState]);

    // Sync history using refs to avoid re-render cascades
    const syncHistoryRef = useRef<SyncHistoryEntry[]>([]);

    // ========================================================================
    // Graph Client
    // ========================================================================

    const getGraphClient = useCallback(async (scopes?: string[]) => {
        // Default to the login scope set (single source of truth in authConfig.ts)
        const request = {
            scopes: scopes || loginRequest.scopes,
            account: accounts[0],
        };

        let accessToken: string;
        try {
            accessToken = (await instance.acquireTokenSilent(request)).accessToken;
        } catch (error) {
            // Refresh token expired or consent changed: prompt instead of surfacing a dead-end error
            if (error instanceof InteractionRequiredAuthError) {
                accessToken = (await instance.acquireTokenPopup(request)).accessToken;
            } else {
                throw error;
            }
        }

        return createGraphClient(accessToken);
    }, [instance, accounts]);

    // ========================================================================
    // State Update Helpers
    // ========================================================================

    const updateWorkloadState = useCallback(<T,>(
        workload: WorkloadType,
        updater: (prev: WorkloadState<T>) => Partial<WorkloadState<T>>
    ) => {
        setState(prev => {
            const currentState = prev.workloads[workload] as unknown as WorkloadState<T>;
            const updates = updater(currentState);

            return {
                ...prev,
                workloads: {
                    ...prev.workloads,
                    [workload]: {
                        ...currentState,
                        ...updates
                    }
                }
            };
        });
    }, []);

    // ========================================================================
    // Query Helpers
    // ========================================================================

    const getAvailableWorkloads = useCallback((): WorkloadType[] => {
        return Object.entries(state.workloads)
            .filter(([, ws]) => ws.consent.consented && ws.loading.phase === "complete")
            .map(([key]) => key as WorkloadType);
    }, [state.workloads]);

    const getWorkloadData = useCallback(<T,>(workload: WorkloadType): T[] => {
        return state.workloads[workload].data as unknown as T[];
    }, [state.workloads]);

    const isWorkloadLoading = useCallback((workload: WorkloadType): boolean => {
        const phase = state.workloads[workload].loading.phase;
        return phase === "fetching" || phase === "processing" || phase === "consent";
    }, [state.workloads]);

    const isWorkloadConsented = useCallback((workload: WorkloadType): boolean => {
        return state.workloads[workload].consent.consented;
    }, [state.workloads]);

    const addSyncHistoryEntry = useCallback((entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'> & { timestamp?: Date }) => {
        const newEntry: SyncHistoryEntry = {
            ...entry,
            id: crypto.randomUUID(),
            timestamp: entry.timestamp || new Date()
        };

        // Update ref (no re-render)
        syncHistoryRef.current = [
            newEntry,
            ...syncHistoryRef.current.filter(e => e.workload !== entry.workload)
        ].slice(0, 10);

        // Update state to trigger re-render for SyncStatus
        setState(prev => ({
            ...prev,
            syncHistory: syncHistoryRef.current
        }));
    }, []);

    // ========================================================================
    // Actions
    // ========================================================================

    // ========================================================================
    // Workload engines: one per loadable workload, all the loading logic lives in src/workloads
    // ========================================================================

    // The engines are created once and read the latest Graph client through a ref
    const [liveClient] = useState(() => new LiveValue<(scopes?: string[]) => Promise<Client>>(getGraphClient));
    useEffect(() => {
        liveClient.set(getGraphClient);
    }, [getGraphClient, liveClient]);

    const engines = useMemo(() => {
        const deps = <T, X>(workload: EngineKey): WorkloadEngineDeps<T, X> => ({
            store: {
                get: () => liveState.get().workloads[workload] as unknown as WorkloadState<T, X>,
                apply: (updater) => setState(prev => ({
                    ...prev,
                    workloads: { ...prev.workloads, [workload]: updater(prev.workloads[workload] as unknown as WorkloadState<T, X>) }
                })),
            },
            getClient: (scopes) => liveClient.get()(scopes),
            onSynced: (timestamp) => addSyncHistoryEntry({ workload, timestamp }),
        });
        return {
            directoryRoles: createWorkloadEngine(directoryRolesAdapter, deps<DirectoryRolesData, DirectoryRolesExtras>("directoryRoles")),
            pimGroups: createWorkloadEngine(pimGroupsAdapter, deps<PimGroupDataType, undefined>("pimGroups")),
        };
    }, [addSyncHistoryEntry, liveState, liveClient]);

    // Show what the session cache holds. Page effects run before this one, which is why the engine's `load` knows
    // about a cache that is not shown yet. Directory Roles older than the TTL are refreshed here, as before.
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        const rolesTimestamp = engines.directoryRoles.hydrate();
        if (rolesTimestamp !== null && !isWorkloadFresh(rolesTimestamp)) {
            void engines.directoryRoles.refresh(false);
        }
        engines.pimGroups.hydrate();
        return () => {
            engines.directoryRoles.dispose();
            engines.pimGroups.dispose();
        };
    }, [engines]);

    // Write the caches whenever the data or the loading state changed; the engine skips it while anything loads
    const rolesState = state.workloads.directoryRoles;
    const groupsState = state.workloads.pimGroups;
    useEffect(() => {
        engines.directoryRoles.persist();
    }, [engines, rolesState.data, rolesState.extras, rolesState.loading.phase, rolesState.loading.background?.running]);
    useEffect(() => {
        engines.pimGroups.persist();
    }, [engines, groupsState.data, groupsState.loading.phase]);

    const loadWorkload = useCallback(async (workload: WorkloadType): Promise<void> => {
        const engine = engines[workload as EngineKey];
        if (!engine) {
            Logger.debug("UnifiedPim", `Load requested for ${workload} (not implemented)`);
            return;
        }
        await engine.load();
    }, [engines]);

    const refreshWorkload = useCallback(async (workload: WorkloadType, force: boolean = false): Promise<void> => {
        const engine = engines[workload as EngineKey];
        if (!engine) {
            Logger.debug("UnifiedPim", `Refresh requested for ${workload} (not implemented)`);
            return;
        }
        Logger.debug("UnifiedPim", `Refreshing ${workload} (force=${force})`);
        await engine.refresh(force);
    }, [engines]);

    const clearWorkload = useCallback((workload: WorkloadType): void => {
        engines[workload as EngineKey]?.clear();
    }, [engines]);

    const patchWorkload = useCallback(<T, X = undefined>(
        workload: WorkloadType,
        updater: (content: WorkloadContent<T, X>) => WorkloadContent<T, X>,
        immediate?: boolean
    ): void => {
        const engine = engines[workload as EngineKey] as unknown as WorkloadEngine<T, X> | undefined;
        engine?.patch(updater, immediate);
    }, [engines]);

    const peekWorkload = useCallback(<T, X = undefined>(workload: WorkloadType): WorkloadContent<T, X> => {
        const ws = stateRef.current.workloads[workload] as unknown as WorkloadState<T, X>;
        return { data: ws.data, extras: ws.extras };
    }, []);

    const enableWorkload = useCallback(async (workload: WorkloadType): Promise<boolean> => {
        // NOTE: The consent popup is already handled by the caller via the requestConsent hook (settings page, wizard)
        // This function just updates state and triggers data refresh

        const scopes = WORKLOAD_SCOPES[workload];

        if (scopes.length === 0) {
            // Workload like Defender doesn't use Graph scopes
            Logger.debug("UnifiedPim", `Workload ${workload} requires external setup`);
            return false;
        }

        try {
            // Update consent state (assume already consented via requestConsent)
            updateWorkloadState(workload, () => ({
                consent: {
                    consented: true,
                    consentedAt: new Date().toISOString()
                }
            }));

            // Add to active workloads if not already
            setState(prev => {
                if (prev.activeWorkloads.includes(workload)) {
                    return prev;
                }
                return {
                    ...prev,
                    activeWorkloads: [...prev.activeWorkloads, workload]
                };
            });

            // Trigger data load
            Logger.debug("UnifiedPim", `Triggering data load for ${workload}`);
            await loadWorkload(workload);

            return true;
        } catch (error) {
            Logger.error("UnifiedPim", `Failed to enable ${workload}:`, error);
            return false;
        }
    }, [updateWorkloadState, loadWorkload]);

    const disableWorkload = useCallback((workload: WorkloadType): void => {
        if (workload === "directoryRoles") {
            Logger.warn("UnifiedPim", "Cannot disable core workload: directoryRoles");
            return;
        }

        // Abort a load that is going and forget the data and its cache, then withdraw the consent
        clearWorkload(workload);
        updateWorkloadState(workload, () => ({
            consent: {
                consented: false
            }
        }));

        // Remove from active workloads
        setState(prev => ({
            ...prev,
            activeWorkloads: prev.activeWorkloads.filter(w => w !== workload)
        }));

        Logger.debug("UnifiedPim", `Disabled workload: ${workload}`);
    }, [updateWorkloadState, clearWorkload]);

    // refreshAllWorkloads: Refresh all enabled workloads in parallel
    // Reads consent through the state ref so the callback keeps a stable identity
    const refreshAllWorkloads = useCallback(async (force?: boolean): Promise<void> => {
        const enabledWorkloads = Object.entries(stateRef.current.workloads)
            .filter(([, ws]) => ws.consent.consented)
            .map(([w]) => w as WorkloadType);

        Logger.debug("UnifiedPim", `Refreshing all workloads:`, enabledWorkloads);

        await Promise.all(
            enabledWorkloads.map((workload) => refreshWorkload(workload, force))
        );

        Logger.debug("UnifiedPim", "All workloads refreshed");
    }, [refreshWorkload]);

    // ========================================================================
    // Initialization: Check consents and auto-load
    // ========================================================================

    useEffect(() => {
        const initialize = async () => {
            if (initializingRef.current || state.initialized || accounts.length === 0) {
                return;
            }
            initializingRef.current = true;

            Logger.debug("UnifiedPim", "Initializing...");

            try {
                // 1. Check which workloads are already consented
                const consented = await checkConsent();
                Logger.debug("UnifiedPim", "Consented workloads:", consented);

                // Sync to localStorage so UI components (WorkloadChips) are aware. This notifies other components,
                // so it must not run inside the state updater below (React forbids that during render).
                for (const workload of consented) {
                    if (workload !== "directoryRoles") {
                        setWorkloadEnabled(workload, true);
                    }
                }

                // 2. Update consent state for all consented workloads
                setState(prev => {
                    const newWorkloads = { ...prev.workloads } as UnifiedPimState["workloads"];

                    for (const workload of consented) {
                        // Use type assertion to handle dynamic key access
                        (newWorkloads as unknown as Record<WorkloadType, WorkloadState<unknown, unknown>>)[workload] = {
                            ...newWorkloads[workload],
                            consent: {
                                consented: true,
                                consentedAt: new Date().toISOString()
                            }
                        };
                    }

                    return {
                        ...prev,
                        initialized: true,
                        activeWorkloads: consented,
                        workloads: newWorkloads
                    };
                });

                // 3. Auto-load data for consented workloads in priority order.
                // Directory Roles is the core workload: the pages load it when they mount.
                for (const workload of LOAD_PRIORITY) {
                    if (consented.includes(workload) && workload !== "directoryRoles") {
                        Logger.debug("UnifiedPim", `Auto-loading data for ${workload}`);
                        void loadWorkload(workload).catch(err =>
                            Logger.error("UnifiedPim", `Auto-load failed for ${workload}:`, err)
                        );
                    }
                }

            } catch (error) {
                Logger.error("UnifiedPim", "Initialization failed:", error);
            }
        };

        initialize();
    }, [accounts, checkConsent, state.initialized, loadWorkload]);

    // ========================================================================
    // Context Value
    // ========================================================================

    // Data slices: each one only changes when that workload's data, consent or lastFetched change
    const directoryRolesSlice = useWorkloadDataSlice(state.workloads.directoryRoles);
    const pimGroupsSlice = useWorkloadDataSlice(state.workloads.pimGroups);
    const intuneSlice = useWorkloadDataSlice(state.workloads.intune);
    const exchangeSlice = useWorkloadDataSlice(state.workloads.exchange);
    const sharepointSlice = useWorkloadDataSlice(state.workloads.sharepoint);
    const defenderSlice = useWorkloadDataSlice(state.workloads.defender);

    const dataValue = useMemo<UnifiedDataValue>(() => ({
        initialized: state.initialized,
        activeWorkloads: state.activeWorkloads,
        workloads: {
            directoryRoles: directoryRolesSlice,
            pimGroups: pimGroupsSlice,
            intune: intuneSlice,
            exchange: exchangeSlice,
            sharepoint: sharepointSlice,
            defender: defenderSlice
        },
        getWorkloadData,
        isWorkloadConsented
    }), [
        state.initialized, state.activeWorkloads,
        directoryRolesSlice, pimGroupsSlice, intuneSlice, exchangeSlice, sharepointSlice, defenderSlice,
        getWorkloadData, isWorkloadConsented
    ]);

    const { directoryRoles: drLoading, pimGroups: pgLoading, intune: inLoading, exchange: exLoading, sharepoint: spLoading, defender: dfLoading } = state.workloads;
    const loadingValue = useMemo<UnifiedLoadingValue>(() => ({
        workloads: {
            directoryRoles: drLoading.loading,
            pimGroups: pgLoading.loading,
            intune: inLoading.loading,
            exchange: exLoading.loading,
            sharepoint: spLoading.loading,
            defender: dfLoading.loading
        },
        syncHistory: state.syncHistory,
        isWorkloadLoading,
        getAvailableWorkloads
    }), [
        drLoading.loading, pgLoading.loading, inLoading.loading, exLoading.loading, spLoading.loading, dfLoading.loading,
        state.syncHistory, isWorkloadLoading, getAvailableWorkloads
    ]);

    // Every member is a stable useCallback, so this object is created once
    const actionsValue = useMemo<UnifiedActionsValue>(() => ({
        loadWorkload,
        refreshWorkload,
        refreshAllWorkloads,
        enableWorkload,
        disableWorkload,
        clearWorkload,
        patchWorkload,
        peekWorkload,
        addSyncHistoryEntry,
        getGraphClient
    }), [
        loadWorkload, refreshWorkload, refreshAllWorkloads, enableWorkload, disableWorkload,
        clearWorkload, patchWorkload, peekWorkload, addSyncHistoryEntry, getGraphClient
    ]);

    return (
        <UnifiedActionsContext.Provider value={actionsValue}>
            <UnifiedDataContext.Provider value={dataValue}>
                <UnifiedLoadingContext.Provider value={loadingValue}>
                    {children}
                </UnifiedLoadingContext.Provider>
            </UnifiedDataContext.Provider>
        </UnifiedActionsContext.Provider>
    );
}

// ============================================================================
// Hooks
// ============================================================================

/** Workload data and consent only; does not re-render on loading progress. */
export function useUnifiedData(): UnifiedDataValue {
    const context = useContext(UnifiedDataContext);
    if (context === undefined) {
        throw new Error("useUnifiedData must be used within a UnifiedPimProvider");
    }
    return context;
}

/** Loading phases, progress and sync history; re-renders on every progress tick. */
export function useUnifiedLoading(): UnifiedLoadingValue {
    const context = useContext(UnifiedLoadingContext);
    if (context === undefined) {
        throw new Error("useUnifiedLoading must be used within a UnifiedPimProvider");
    }
    return context;
}

/** Stable actions (refresh, enable, disable, Graph client); never re-renders consumers. */
export function useUnifiedActions(): UnifiedActionsValue {
    const context = useContext(UnifiedActionsContext);
    if (context === undefined) {
        throw new Error("useUnifiedActions must be used within a UnifiedPimProvider");
    }
    return context;
}

/**
 * Compatibility hook that merges the three contexts into the previous single
 * value. It re-renders on any change; prefer useUnifiedData, useUnifiedLoading
 * or useUnifiedActions in components.
 */
export function useUnifiedPimData(): UnifiedPimContextValue {
    const data = useUnifiedData();
    const loading = useUnifiedLoading();
    const actions = useUnifiedActions();

    return useMemo<UnifiedPimContextValue>(() => {
        const merge = <T, X = undefined>(workload: WorkloadType): WorkloadState<T, X> => ({
            workload,
            ...(data.workloads[workload] as unknown as WorkloadDataSlice<T, X>),
            loading: loading.workloads[workload]
        });
        return {
            initialized: data.initialized,
            activeWorkloads: data.activeWorkloads,
            syncHistory: loading.syncHistory,
            workloads: {
                directoryRoles: merge<DirectoryRolesData, DirectoryRolesExtras>("directoryRoles"),
                pimGroups: merge<PimGroupDataType>("pimGroups"),
                intune: merge<IntuneRoleData>("intune"),
                exchange: merge<ExchangeRoleData>("exchange"),
                sharepoint: merge<SharePointData>("sharepoint"),
                defender: merge<DefenderRoleData>("defender")
            },
            getAvailableWorkloads: loading.getAvailableWorkloads,
            getWorkloadData: data.getWorkloadData,
            isWorkloadLoading: loading.isWorkloadLoading,
            isWorkloadConsented: data.isWorkloadConsented,
            ...actions
        };
    }, [data, loading, actions]);
}
