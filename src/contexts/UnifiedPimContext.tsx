"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { RoleDetailData } from "@/types/directoryRole.types";
import {
    WorkloadType,
    WorkloadLoadingState,
    WorkloadState,
    WorkloadConsentState
} from "@/types/workload";
import { PimGroupData as PimGroupDataType } from "@/types/pimGroup.types";
import { fetchAllPimGroupData, syncGroupsWithDelta } from "@/services/pimGroupService";
import { getStoredGroupDeltaLink, fetchGroupDeltas, clearGroupDeltaLink } from "@/services/deltaService";
import { useConsentedWorkloads } from "@/hooks/useConsentedWorkloads";
import { setWorkloadEnabled } from "@/hooks/useIncrementalConsent";
import { Logger } from "@/utils/logger";

// SessionStorage keys for PIM Groups data caching
const PIM_GROUPS_STORAGE_KEY = "pim_groups_data_cache";
const PIM_GROUPS_TIMESTAMP_KEY = "pim_groups_timestamp";

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
// Sync History (for timestamp tracking)
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
        directoryRoles: WorkloadState<DirectoryRolesData>;
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
    refreshAllWorkloads: () => Promise<void>;
    enableWorkload: (workload: WorkloadType) => Promise<boolean>;
    disableWorkload: (workload: WorkloadType) => void;
    clearSyncHistory: () => void;
    addSyncHistoryEntry: (entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => void;

    // Registration for modular workload refresh (allows child contexts to register their refresh)
    registerWorkloadRefresh: (workload: WorkloadType, refreshFn: () => Promise<void>) => void;

    // Graph client helper
    getGraphClient: () => Promise<Client>;

    // Internal: update workload state (used by workload-specific services)
    updateWorkloadState: <T>(
        workload: WorkloadType,
        updater: (prev: WorkloadState<T>) => Partial<WorkloadState<T>>
    ) => void;
}

// ============================================================================
// Initial State Factory
// ============================================================================

function createInitialWorkloadState<T>(): WorkloadState<T> {
    return {
        workload: "directoryRoles", // Will be overridden
        data: [],
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
            directoryRoles: { ...createInitialWorkloadState<DirectoryRolesData>(), workload: "directoryRoles", consent: { consented: true } },
            pimGroups: { ...createInitialWorkloadState<PimGroupDataType>(), workload: "pimGroups" },
            intune: { ...createInitialWorkloadState<IntuneRoleData>(), workload: "intune" },
            exchange: { ...createInitialWorkloadState<ExchangeRoleData>(), workload: "exchange" },
            sharepoint: { ...createInitialWorkloadState<SharePointData>(), workload: "sharepoint" },
            defender: { ...createInitialWorkloadState<DefenderRoleData>(), workload: "defender" }
        }
    };
}

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

const UnifiedPimContext = createContext<UnifiedPimContextValue | undefined>(undefined);

export function UnifiedPimProvider({ children }: { children: ReactNode }) {
    const { instance, accounts } = useMsal();
    const { checkConsent, WORKLOAD_SCOPES } = useConsentedWorkloads();
    const [state, setState] = useState<UnifiedPimState>(createInitialState);
    const initializingRef = useRef(false);

    // Sync history using refs to avoid re-render cascades
    const syncHistoryRef = useRef<SyncHistoryEntry[]>([]);

    // Registry for modular workload refresh functions
    const workloadRefreshRegistry = useRef<Map<WorkloadType, () => Promise<void>>>(new Map());

    // AbortControllers for each workload to support cancellation
    const workloadAbortControllers = useRef<Map<WorkloadType, AbortController>>(new Map());

    // ========================================================================
    // PIM Groups SessionStorage Cache (matches DirectoryRoleContext behavior)
    // ========================================================================

    // Load PIM Groups from sessionStorage on mount
    useEffect(() => {
        if (typeof window === "undefined") return;

        try {
            const cached = sessionStorage.getItem(PIM_GROUPS_STORAGE_KEY);
            const timestamp = sessionStorage.getItem(PIM_GROUPS_TIMESTAMP_KEY);

            if (cached && timestamp) {
                const data = JSON.parse(cached) as PimGroupDataType[];
                const lastFetched = timestamp;

                Logger.debug("UnifiedPim", `Loaded ${data.length} PIM Groups from cache`);

                setState(prev => ({
                    ...prev,
                    workloads: {
                        ...prev.workloads,
                        pimGroups: {
                            ...prev.workloads.pimGroups,
                            data,
                            lastFetched,
                            loading: {
                                phase: "complete",
                                progress: { current: 100, total: 100 },
                                message: "Loaded from cache"
                            }
                        }
                    }
                }));
            }
        } catch (e) {
            Logger.error("UnifiedPim", "Failed to load PIM Groups from cache", e);
            sessionStorage.removeItem(PIM_GROUPS_STORAGE_KEY);
            sessionStorage.removeItem(PIM_GROUPS_TIMESTAMP_KEY);
            // Also clear delta link to force fresh fetch
            clearGroupDeltaLink();
        }

        // Safety: if no cached data, clear delta link to ensure fresh fetch
        const hasCachedData = sessionStorage.getItem(PIM_GROUPS_STORAGE_KEY);
        if (!hasCachedData) {
            Logger.debug("UnifiedPim", "No cached PIM Groups data, clearing delta link for fresh fetch");
            clearGroupDeltaLink();
        }
    }, []);

    // Save PIM Groups to sessionStorage when data changes
    useEffect(() => {
        if (typeof window === "undefined") return;

        const data = state.workloads.pimGroups.data;
        if (data && data.length > 0) {
            try {
                sessionStorage.setItem(PIM_GROUPS_STORAGE_KEY, JSON.stringify(data));
                sessionStorage.setItem(PIM_GROUPS_TIMESTAMP_KEY, new Date().toISOString());
            } catch (e) {
                if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                    Logger.warn("UnifiedPim", "SessionStorage quota exceeded for PIM Groups");
                } else {
                    Logger.error("UnifiedPim", "Failed to save PIM Groups to cache", e);
                }
            }
        }
    }, [state.workloads.pimGroups.data]);


    // ========================================================================
    // Graph Client
    // ========================================================================

    const getGraphClient = useCallback(async (scopes?: string[]) => {
        const defaultScopes = [
            "User.Read",
            "RoleManagement.Read.Directory",
            "RoleAssignmentSchedule.Read.Directory",
            "RoleEligibilitySchedule.Read.Directory",
            "RoleManagementPolicy.Read.Directory",
            "Policy.Read.ConditionalAccess",
            "User.Read.All",
            "Group.Read.All",
            "AdministrativeUnit.Read.All",
            "Application.Read.All"
        ];

        const request = {
            scopes: scopes || defaultScopes,
            account: accounts[0],
        };

        const response = await instance.acquireTokenSilent(request);

        return Client.init({
            authProvider: (done) => {
                done(null, response.accessToken);
            },
        });
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
            .filter(([_, ws]) => ws.consent.consented && ws.loading.phase === "complete")
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

    // Sync history functions using refs (no re-renders on update)
    const clearSyncHistory = useCallback(() => {
        syncHistoryRef.current = [];
    }, []);

    const addSyncHistoryEntry = useCallback((entry: Omit<SyncHistoryEntry, 'id' | 'timestamp'>) => {
        const newEntry: SyncHistoryEntry = {
            ...entry,
            id: crypto.randomUUID(),
            timestamp: new Date()
        };

        // Update ref (no re-render)
        syncHistoryRef.current = [
            newEntry,
            ...syncHistoryRef.current.filter(e => e.workload !== entry.workload)
        ].slice(0, 10);
    }, []);

    // ========================================================================
    // Actions
    // ========================================================================

    const refreshWorkload = useCallback(async (workload: WorkloadType, force: boolean = false): Promise<void> => {
        // Check if a workload-specific refresh function is registered (modular pattern)
        const registeredRefresh = workloadRefreshRegistry.current.get(workload);
        if (registeredRefresh) {
            Logger.debug("UnifiedPim", `Delegating refresh to registered handler for: ${workload}`);
            await registeredRefresh();
            return;
        }

        // Cancel previous request for this workload
        if (workloadAbortControllers.current.has(workload)) {
            Logger.debug("UnifiedPim", `Cancelling previous refresh for ${workload}`);
            workloadAbortControllers.current.get(workload)?.abort();
            workloadAbortControllers.current.delete(workload);
        }

        // Create new controller
        const controller = new AbortController();
        workloadAbortControllers.current.set(workload, controller);
        const signal = controller.signal;

        try {
            // Freshness check (unless forced)
            const workloadState = state.workloads[workload];
            if (!force && workloadState.lastFetched) {
                const now = new Date();
                const lastFetchedDate = new Date(workloadState.lastFetched);
                const diff = now.getTime() - lastFetchedDate.getTime();
                if (diff < 5 * 60 * 1000) {
                    Logger.debug("UnifiedPim", `Data for ${workload} is fresh, skipping fetch`);

                    // Restore SyncStatus indicator by logging sync timestamp
                    addSyncHistoryEntry({
                        workload: workload
                    });

                    return;
                }
            }

            switch (workload) {
                case "pimGroups": {
                    // Get current data for Smart Sync check
                    const currentData = (state.workloads.pimGroups.data || []) as PimGroupDataType[];
                    const hasExistingData = currentData.length > 0;

                    // Update loading state
                    updateWorkloadState(workload, () => ({
                        loading: {
                            phase: "fetching",
                            progress: { current: 0, total: 3 },
                            message: "Loading PIM Groups data..."
                        }
                    }));

                    // Get client with PIM Groups scope
                    const client = await getGraphClient([
                        ...WORKLOAD_SCOPES.directoryRoles,
                        ...WORKLOAD_SCOPES.pimGroups
                    ]);

                    if (signal.aborted) throw new Error("Aborted");

                    // Phase 1: Smart Sync (Delta) - only if we have existing data
                    const storedDeltaLink = getStoredGroupDeltaLink();
                    let smartSyncSuccess = false;

                    // Match DirectoryRoles behavior: check hasExistingData BEFORE delta fetch
                    if (storedDeltaLink && hasExistingData) {
                        try {
                            updateWorkloadState(workload, () => ({
                                loading: {
                                    phase: "fetching",
                                    progress: { current: 0, total: 100 },
                                    message: "Checking for updates..."
                                }
                            }));

                            const deltaResult = await fetchGroupDeltas(client, storedDeltaLink);

                            if (signal.aborted) throw new Error("Aborted");

                            if (deltaResult) {
                                // Smart Sync Possible
                                const { changes, newDeltaLink } = deltaResult;

                                if (changes.length === 0) {
                                    Logger.debug("UnifiedPim", "Smart Sync: No changes found.");
                                    updateWorkloadState(workload, () => ({
                                        loading: {
                                            phase: "complete",
                                            progress: { current: 100, total: 100 },
                                            message: "Up to date"
                                        },
                                        lastFetched: new Date().toISOString()
                                    }));

                                    // Record sync timestamp for UI notification
                                    addSyncHistoryEntry({
                                        workload: 'pimGroups'
                                    });

                                    smartSyncSuccess = true;
                                } else {
                                    Logger.debug("UnifiedPim", `Smart Sync: Processing ${changes.length} changes...`);


                                    // Get current data to merge into
                                    const currentData = (state.workloads.pimGroups.data || []) as PimGroupDataType[];

                                    const updatedData = await syncGroupsWithDelta(
                                        client,
                                        currentData,
                                        changes,
                                        (current, total, status) => {
                                            if (signal.aborted) return;
                                            updateWorkloadState(workload, () => ({
                                                loading: {
                                                    phase: "fetching",
                                                    progress: { current, total },
                                                    message: status
                                                }
                                            }));
                                        }
                                    );

                                    if (signal.aborted) throw new Error("Aborted");

                                    updateWorkloadState(workload, () => ({
                                        data: updatedData,
                                        loading: {
                                            phase: "complete",
                                            progress: { current: 100, total: 100 },
                                            message: `Synced ${changes.length} updates`
                                        },
                                        lastFetched: new Date().toISOString()
                                    }));

                                    // Record sync timestamp
                                    addSyncHistoryEntry({
                                        workload: 'pimGroups'
                                    });

                                    smartSyncSuccess = true;
                                }
                            }
                        } catch (err) {
                            if (err instanceof Error && err.message === "Aborted") throw err;
                            Logger.warn("UnifiedPim", "Group Smart Sync failed, falling back to full fetch", err);
                        }
                    }

                    if (smartSyncSuccess) {
                        return; // Done!
                    }

                    // Phase 2: Full Content Fetch (Assignments + Policies)
                    // User Requirement: "Reliability First" - always fetch policies too.
                    updateWorkloadState(workload, () => ({
                        loading: {
                            phase: "fetching",
                            progress: { current: 0, total: 100 },
                            message: "Refreshing PIM Groups..."
                        }
                    }));

                    const groupData = await fetchAllPimGroupData(
                        client,
                        (current, total, status) => {
                            if (signal.aborted) return;
                            updateWorkloadState(workload, () => ({
                                loading: {
                                    phase: "fetching",
                                    progress: { current, total },
                                    message: status
                                }
                            }));
                        },
                        signal
                    );

                    // Update state with data
                    updateWorkloadState(workload, () => ({
                        data: groupData,
                        loading: {
                            phase: "complete",
                            progress: { current: 1, total: 1 },
                            message: `Loaded ${groupData.length} PIM Groups`
                        },
                        lastFetched: new Date().toISOString()
                    }));

                    // Record sync timestamp
                    addSyncHistoryEntry({
                        workload: 'pimGroups'
                    });

                    // Initialize delta link for future smart refreshes (fire-and-forget)
                    if (!signal.aborted) {
                        fetchGroupDeltas(client).then(() => {
                            Logger.debug("UnifiedPim", "Group Delta link initialized for future smart refreshes");
                        }).catch((err) => {
                            Logger.warn("UnifiedPim", "Failed to initialize group delta link:", err);
                        });
                    }

                    break;
                }
                case "directoryRoles":
                    // Directory Roles is loaded via PimDataContext (backward compat)
                    Logger.debug("UnifiedPim", "Directory Roles managed by PimDataContext");
                    break;
                default:
                    Logger.debug("UnifiedPim", `Refresh requested for ${workload} (not implemented)`);
            }
        } catch (error: any) {
            if (error.message === "Aborted" || signal.aborted) {
                Logger.info("UnifiedPim", `Refresh aborted for ${workload}`);
                return;
            }

            Logger.error("UnifiedPim", `Failed to refresh ${workload}:`, error);
            updateWorkloadState(workload, () => ({
                loading: {
                    phase: "error",
                    progress: { current: 0, total: 0 },
                    message: "Failed to load data",
                    error: error instanceof Error ? error.message : "Unknown error"
                }
            }));
        }
    }, [getGraphClient, updateWorkloadState]);

    const enableWorkload = useCallback(async (workload: WorkloadType): Promise<boolean> => {
        // NOTE: Consent popup is already handled by SettingsModal via requestConsent hook
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
            Logger.debug("UnifiedPim", `Triggering data refresh for ${workload}`);
            await refreshWorkload(workload);

            return true;
        } catch (error) {
            Logger.error("UnifiedPim", `Failed to enable ${workload}:`, error);
            return false;
        }
    }, [WORKLOAD_SCOPES, updateWorkloadState, refreshWorkload]);

    const disableWorkload = useCallback((workload: WorkloadType): void => {
        if (workload === "directoryRoles") {
            Logger.warn("UnifiedPim", "Cannot disable core workload: directoryRoles");
            return;
        }

        // Update consent state
        updateWorkloadState(workload, () => ({
            consent: {
                consented: false
            },
            data: [],
            loading: {
                phase: "idle",
                progress: { current: 0, total: 0 },
                message: ""
            }
        }));

        // Remove from active workloads
        setState(prev => ({
            ...prev,
            activeWorkloads: prev.activeWorkloads.filter(w => w !== workload)
        }));

        Logger.debug("UnifiedPim", `Disabled workload: ${workload}`);
    }, [updateWorkloadState]);

    // refreshAllWorkloads: Refresh all enabled workloads in parallel
    const refreshAllWorkloads = useCallback(async (): Promise<void> => {
        const enabledWorkloads = Object.entries(state.workloads)
            .filter(([, ws]) => ws.consent.consented)
            .map(([w]) => w as WorkloadType);

        Logger.debug("UnifiedPim", `Refreshing all workloads:`, enabledWorkloads);

        await Promise.all(
            enabledWorkloads.map((workload) => refreshWorkload(workload))
        );

        Logger.debug("UnifiedPim", "All workloads refreshed");
    }, [state.workloads, refreshWorkload]);

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

                // 2. Update consent state for all consented workloads
                setState(prev => {
                    const newWorkloads = { ...prev.workloads } as UnifiedPimState["workloads"];

                    for (const workload of consented) {
                        // Sync to localStorage to ensure UI components (WorkloadChips) are aware
                        if (workload !== "directoryRoles") {
                            setWorkloadEnabled(workload, true);
                        }

                        // Use type assertion to handle dynamic key access
                        (newWorkloads as Record<WorkloadType, WorkloadState<unknown>>)[workload] = {
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

                // 3. Auto-load data for consented workloads in priority order
                // Note: directoryRoles is handled by PimDataProvider (backward compat)
                // Other workloads are loaded here
                for (const workload of LOAD_PRIORITY) {
                    if (consented.includes(workload) && workload !== "directoryRoles") {
                        Logger.debug("UnifiedPim", `Auto-loading data for ${workload}`);
                        // Use standard refresh logic
                        refreshWorkload(workload);
                    }
                }

            } catch (error) {
                Logger.error("UnifiedPim", "Initialization failed:", error);
            }
        };

        initialize();
    }, [accounts, checkConsent, state.initialized]);

    // ========================================================================
    // Context Value
    // ========================================================================

    // Register a workload-specific refresh function (modular pattern)
    const registerWorkloadRefresh = useCallback((workload: WorkloadType, refreshFn: () => Promise<void>) => {
        workloadRefreshRegistry.current.set(workload, refreshFn);
        Logger.debug("UnifiedPim", `Registered refresh handler for: ${workload}`);
    }, []);

    const contextValue: UnifiedPimContextValue = {
        ...state,
        getAvailableWorkloads,
        getWorkloadData,
        isWorkloadLoading,
        isWorkloadConsented,
        refreshWorkload,
        refreshAllWorkloads,
        enableWorkload,
        disableWorkload,
        clearSyncHistory,
        addSyncHistoryEntry,
        registerWorkloadRefresh,
        getGraphClient,
        updateWorkloadState
    };

    return (
        <UnifiedPimContext.Provider value={contextValue}>
            {children}
        </UnifiedPimContext.Provider>
    );
}

// ============================================================================
// Hook
// ============================================================================

export function useUnifiedPimData() {
    const context = useContext(UnifiedPimContext);
    if (context === undefined) {
        throw new Error("useUnifiedPimData must be used within a UnifiedPimProvider");
    }
    return context;
}
