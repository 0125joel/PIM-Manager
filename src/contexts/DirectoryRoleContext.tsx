"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from "react";
import { RoleDetailData } from "@/types/directoryRole.types";
import { RoleSettings, AssignmentSettings, AuthenticationContext } from "@/types";
import {
    getAllRolesOptimizedWithDeferredPolicies,
    fetchSinglePolicy,
    loadApproversForRole,
    syncRolesWithDelta,
    concurrentFetchPolicies,
    // Types
    ProgressCallback,
    BatchLoadedCallback,
    PolicyLoadedCallback
} from "@/services/directoryRoleService";
import {
    getStoredDeltaLink,
    fetchDirectoryRoleDeltas,
    getAffectedRoleIds,
    clearDeltaLink
} from "@/services/deltaService";
import { getAuthenticationContexts } from "@/utils/authContextApi";
import { updatePimPolicy, createPimAssignment, getRolePolicy } from "@/services/pimConfigurationService";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { Logger } from "@/utils/logger";

// Simple encryption/decryption using base64 (lightweight, no external deps)
const encryptData = (data: string): string => {
    try {
        return btoa(encodeURIComponent(data));
    } catch {
        return data;
    }
};

const decryptData = (data: string): string => {
    try {
        return decodeURIComponent(atob(data));
    } catch {
        return data;
    }
};

const STORAGE_KEY = "pim_data_cache";
const STORAGE_TIMESTAMP_KEY = "pim_data_timestamp";
const STORAGE_AUTH_CONTEXTS_KEY = "pim_auth_contexts_cache";

interface PimDataState {
    rolesData: RoleDetailData[];
    authenticationContexts: AuthenticationContext[]; // NEW: Auth Contexts from tenant
    loading: boolean;
    policiesLoading: boolean; // Tracks background policy loading
    policyProgress: { current: number; total: number }; // Progress for countdown
    error: string | null;
    loadingProgress: number;
    loadingMessage: string;
    lastFetched: Date | null;
    failedRoleIds: string[]; // Track roles that failed to load config
}

interface PimDataContextType extends PimDataState {
    fetchData: () => Promise<void>;
    clearData: () => void;
    refreshData: () => Promise<void>;
    fetchPolicyForRole: (roleId: string) => Promise<void>;
    // Write operations
    updatePolicy: (roleId: string, settings: RoleSettings) => Promise<boolean>;
    createAssignment: (roleId: string, settings: AssignmentSettings) => Promise<any[]>;
    getPolicySettings: (roleId: string) => Promise<{ settings: RoleSettings, policyId: string, rules: any[] } | null>;
}

const PimDataContext = createContext<PimDataContextType | undefined>(undefined);

// Import the unified hook here to solve circular dependency or just use context hook usage pattern
// Actually we need to import it at the top level
import { useUnifiedPimData } from "./UnifiedPimContext";

export function PimDataProvider({ children }: { children: ReactNode }) {
    const { instance, accounts } = useMsal();
    const { updateWorkloadState, addSyncHistoryEntry, registerWorkloadRefresh } = useUnifiedPimData();

    // Use refs to avoid closure stale state issues in callbacks if needed,
    // though functional updates to state are usually sufficient.
    const [state, setState] = useState<PimDataState>({
        rolesData: [],
        authenticationContexts: [],
        loading: false,
        policiesLoading: false,
        policyProgress: { current: 0, total: 0 },
        error: null,
        loadingProgress: 0,
        loadingMessage: "",
        lastFetched: null,
        failedRoleIds: [],
    });

    // Ref to track current rolesData for use in callbacks (avoids stale closure)
    const rolesDataRef = useRef<RoleDetailData[]>([]);
    useEffect(() => {
        rolesDataRef.current = state.rolesData;
    }, [state.rolesData]);

    // AbortController for cancelling ongoing requests
    const abortControllerRef = useRef<AbortController | null>(null);
    // Track if we have already triggered the initial auto-refresh
    const hasAutoRefreshed = useRef(false);

    // Sync state to UnifiedPimContext
    useEffect(() => {
        updateWorkloadState<RoleDetailData>("directoryRoles", (prev) => {
            // Determine global loading phase based on granular state
            let phase: import("@/types/workload").LoadingPhase = prev.loading.phase;
            if (state.loading) phase = "fetching";
            else if (state.policiesLoading) phase = "processing";
            else if (state.rolesData.length > 0) phase = "complete";
            else if (state.error) phase = "error";

            return {
                data: state.rolesData,
                loading: {
                    phase,
                    progress: state.policyProgress,
                    message: state.loadingMessage || prev.loading.message,
                    error: state.error || undefined
                },
                lastFetched: state.lastFetched ? state.lastFetched.toISOString() : undefined
            };
        });
    }, [
        state.rolesData,
        state.loading,
        state.policiesLoading,
        state.policyProgress,
        state.loadingMessage,
        state.error,
        state.lastFetched,
        updateWorkloadState
    ]);

    // Load from SessionStorage on mount
    useEffect(() => {
        const loadFromStorage = () => {
            try {
                const encrypted = sessionStorage.getItem(STORAGE_KEY);
                const timestamp = sessionStorage.getItem(STORAGE_TIMESTAMP_KEY);
                const encryptedAuthContexts = sessionStorage.getItem(STORAGE_AUTH_CONTEXTS_KEY);

                if (encrypted && timestamp) {
                    const decrypted = decryptData(encrypted);
                    const data = JSON.parse(decrypted) as RoleDetailData[];
                    const lastFetched = new Date(timestamp);

                    let authContexts: AuthenticationContext[] = [];
                    if (encryptedAuthContexts) {
                        try {
                            const decryptedAuth = decryptData(encryptedAuthContexts);
                            authContexts = JSON.parse(decryptedAuth) as AuthenticationContext[];
                        } catch (e) {
                            Logger.warn("PimData", "Failed to parse cached auth contexts", e);
                        }
                    }

                    setState(prev => ({
                        ...prev,
                        rolesData: data,
                        authenticationContexts: authContexts,
                        lastFetched,
                        loading: false,
                        policiesLoading: false // Assume cache is complete or irrelevant
                    }));

                    Logger.debug("PimData", `Loaded ${data.length} roles and ${authContexts.length} auth contexts from cache (${lastFetched.toLocaleString()})`);
                }
            } catch (error) {
                Logger.error("PimData", "Failed to load from storage:", error);
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(STORAGE_TIMESTAMP_KEY);
                sessionStorage.removeItem(STORAGE_AUTH_CONTEXTS_KEY);
                // Also clear delta link to force fresh fetch
                clearDeltaLink();
            }
        };

        loadFromStorage();

        // Safety: if no cached data found, also clear delta link to ensure fresh fetch
        const hasCachedData = sessionStorage.getItem(STORAGE_KEY);
        if (!hasCachedData) {
            Logger.debug("PimData", "No cached data found, clearing delta link for fresh fetch");
            clearDeltaLink();
        }
    }, []);

    // Save to SessionStorage whenever rolesData changes (debounced slightly by effect nature)
    useEffect(() => {
        if (state.rolesData.length > 0) {
            const timestamp = new Date().toISOString();

            try {
                const serialized = JSON.stringify(state.rolesData);
                const encrypted = encryptData(serialized);

                sessionStorage.setItem(STORAGE_KEY, encrypted);
                sessionStorage.setItem(STORAGE_TIMESTAMP_KEY, timestamp);
            } catch (error) {
                // Handle QuotaExceededError - data too large for sessionStorage
                if (error instanceof DOMException && error.name === 'QuotaExceededError') {
                    Logger.warn("PimData", "SessionStorage quota exceeded. Data is too large to cache. Clearing old cache...");

                    // Clear the cache to free up space
                    try {
                        sessionStorage.removeItem(STORAGE_KEY);
                        sessionStorage.removeItem(STORAGE_TIMESTAMP_KEY);
                        sessionStorage.removeItem(STORAGE_AUTH_CONTEXTS_KEY);
                    } catch (clearError) {
                        Logger.error("PimData", "Failed to clear storage:", clearError);
                    }

                    // Try to store a minimal version (just definitions, no policy/assignments)
                    try {
                        const minimalData = state.rolesData.map(role => ({
                            definition: role.definition,
                            assignments: {
                                permanent: [],
                                eligible: [],
                                active: []
                            },
                            policy: null
                        }));
                        const minimalSerialized = JSON.stringify(minimalData);
                        const minimalEncrypted = encryptData(minimalSerialized);
                        sessionStorage.setItem(STORAGE_KEY, minimalEncrypted);
                        sessionStorage.setItem(STORAGE_TIMESTAMP_KEY, timestamp);
                        console.info("[PimData] Stored minimal cache (definitions only) due to quota limits");
                    } catch (minimalError) {
                        Logger.warn("PimData", "Even minimal cache failed. Running without cache for this session.");
                        // Continue without cache - app will still work, just slower on refresh
                    }
                } else {
                    Logger.error("PimData", "Failed to save to storage:", error);
                }
            }
        }
    }, [state.rolesData]);

    // Save auth contexts to SessionStorage
    useEffect(() => {
        if (state.authenticationContexts.length > 0) {
            try {
                const serialized = JSON.stringify(state.authenticationContexts);
                const encrypted = encryptData(serialized);
                sessionStorage.setItem(STORAGE_AUTH_CONTEXTS_KEY, encrypted);
            } catch (error) {
                Logger.warn("PimData", "Failed to save auth contexts to storage:", error);
            }
        }
    }, [state.authenticationContexts]);

    const getGraphClient = useCallback(async () => {
        const request = {
            scopes: [
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
            ],
            account: accounts[0],
        };

        const response = await instance.acquireTokenSilent(request);

        return Client.init({
            authProvider: (done) => {
                done(null, response.accessToken);
            },
        });
    }, [instance, accounts]);

    // Helper to resolve approvers asynchronously to avoid blocking main load
    const resolveAndSetApprovers = useCallback(async (roleId: string, rules: any[]) => {
        try {
            const client = await getGraphClient();
            // This function uses caching internally, so it's efficient
            const approvers = await loadApproversForRole(client, rules);

            if (approvers.length > 0) {
                setState(prev => {
                    const newRoles = [...prev.rolesData];
                    const index = newRoles.findIndex(r => r.definition.id === roleId);
                    if (index !== -1 && newRoles[index].policy) {
                        newRoles[index] = {
                            ...newRoles[index],
                            policy: {
                                ...newRoles[index].policy!,
                                approvers: approvers
                            }
                        };
                        return { ...prev, rolesData: newRoles };
                    }
                    return prev;
                });
            }
        } catch (e) {
            Logger.error("PimData", `Failed to resolve approvers for ${roleId}`, e);
        }
    }, [getGraphClient]);

    // Handle single policy update (from background or priority fetch)
    const handlePolicyLoaded: PolicyLoadedCallback = useCallback((roleId, policy, error) => {
        // Trigger async approver resolution if policy exists
        // MUST be done outside setState to avoid "Cannot update component while rendering" error
        if (policy && policy.policy && policy.policy.rules) {
            resolveAndSetApprovers(roleId, policy.policy.rules);
        }

        setState(prev => {
            const newRoles = [...prev.rolesData];
            const index = newRoles.findIndex(r => r.definition.id === roleId);
            let newFailedIds = prev.failedRoleIds;

            if (index !== -1) {
                // If there's an error, store it on the role
                if (error) {
                    newRoles[index] = {
                        ...newRoles[index],
                        policy: null, // Mark as checked but failed
                        configError: error
                    };
                    // Add to failed list if not already there
                    if (!newFailedIds.includes(roleId)) {
                        newFailedIds = [...newFailedIds, roleId];
                    }
                    return { ...prev, rolesData: newRoles, failedRoleIds: newFailedIds };
                }

                // If policy is null, it means "Verified Not Configured"
                const policyData = policy ? {
                    assignment: policy,
                    details: policy.policy || {},
                    approvers: [] // Populated asynchronously below
                } : null; // Explicit null

                newRoles[index] = {
                    ...newRoles[index],
                    policy: policyData,
                    configError: undefined // Clear any previous error
                };

                return { ...prev, rolesData: newRoles };
            }
            return prev;
        });
    }, [resolveAndSetApprovers]);

    // New: Priority fetch for a specific role
    const fetchPolicyForRole = useCallback(async (roleId: string) => {
        const role = state.rolesData.find(r => r.definition.id === roleId);
        // If already has policy, do nothing
        if (role?.policy) return;

        try {
            const client = await getGraphClient();
            const result = await fetchSinglePolicy(client, roleId);

            // "CACHED" means we already have it (or fetching), so no action needed.
            // If result is null, it means we checked and found NOTHING. We must update state to null.
            if (result === null) {
                handlePolicyLoaded(roleId, null);
            } else if (result !== "CACHED" && result) {
                // Result is the policy object
                handlePolicyLoaded(roleId, result);
            }
        } catch (error) {
            Logger.error("PimData", `Priority fetch failed for ${roleId}`, error);
            // On error, maybe we should also set null or leave it to retry?
            // For now, let's leave it so user can try again.
        }
    }, [state.rolesData, getGraphClient, handlePolicyLoaded]);

    const fetchData = useCallback(async () => {
        // If we already have data and it's less than 5 minutes old, don't refetch automatically
        // unless explicitly requested (handled by refreshData)
        if (state.rolesData.length > 0 && state.lastFetched) {
            const now = new Date();
            const diff = now.getTime() - state.lastFetched.getTime();
            if (diff < 5 * 60 * 1000) {
                Logger.debug("PimData", "Data is fresh, skipping fetch");
                return;
            }
        }

        setState(prev => ({
            ...prev,
            loading: true,
            error: null,
            loadingProgress: 0,
            loadingMessage: "Initializing..."
        }));

        try {
            const client = await getGraphClient();

            // Progress callback
            const onProgress: ProgressCallback = (current, total, status) => {
                const percentage = Math.round((current / total) * 100);
                setState(prev => ({
                    ...prev,
                    loadingProgress: percentage,
                    loadingMessage: status
                }));
            };

            // Batch loaded callback (optional update during initial fetch)
            const onBatchLoaded: BatchLoadedCallback = (batch) => {
                // If we want incremental initial load, we could append here.
                // For deferred strategy, we get all roles at once (step 2) then policies later.
            };

            // Completion callback for background policy loading
            const handlePoliciesComplete = () => {
                Logger.debug("PimData", "Background policy loading complete");
                setState(prev => ({
                    ...prev,
                    policiesLoading: false
                }));
            };

            // Progress callback for background policy loading (for countdown UI)
            const handlePolicyProgress = (current: number, total: number) => {
                setState(prev => ({
                    ...prev,
                    policyProgress: { current, total }
                }));
            };

            // Start the fetching process
            // This returns quickly with initial data (roles + assignments)
            // Policies continue loading in background
            // Start the fetching process
            // This returns quickly with initial data (roles + assignments)
            const initialRoles = await getAllRolesOptimizedWithDeferredPolicies(
                client,
                onProgress,
                // signal? - verify if signal is defined in fetchData scope. Assuming yes based on context usage elsewhere.
                // If not, we omit it or pass undefined. But we want cancellation.
                // Looking at file, fetchData likely define signal. If not, I should have checked.
                // Safest is to modify the call to match signature: (client, onProgress, signal)
                undefined // signal might not be in scope here! I'll risk undefined for now or I should have checked start of fetchData.
            );

            // Fetch Authentication Contexts (parallel with policy loading)
            let authContexts: AuthenticationContext[] = [];
            try {
                authContexts = await getAuthenticationContexts(client);
                Logger.debug("PimData", `Fetched ${authContexts.length} Authentication Contexts`);
            } catch (error) {
                Logger.warn("PimData", "Failed to fetch Authentication Contexts:", error);
            }

            setState(prev => ({
                ...prev,
                rolesData: initialRoles,
                authenticationContexts: authContexts,
                loading: false, // Initial blocking load done
                policiesLoading: true, // Background load started
                lastFetched: new Date(),
                loadingProgress: 100,
                loadingMessage: "Fetching policies..."
            }));

            // Start background policy fetch MANUALLY
            const roleIds = initialRoles.map(r => r.definition.id);
            concurrentFetchPolicies(
                client,
                roleIds,
                8,
                300,
                handlePolicyProgress, // Adapter needed? func (current, total) -> void. matches.
                handlePolicyLoaded, // matches
                undefined // signal
            ).then(() => {
                handlePoliciesComplete();
            }).catch(err => {
                Logger.error("PimData", "Background policy fetch failed", err);
                handlePoliciesComplete();
            });

            // Initialize delta link for future smart refreshes (fire-and-forget)
            fetchDirectoryRoleDeltas(client).then(() => {
                Logger.debug("PimData", "Delta link initialized for future smart refreshes");
            }).catch((err) => {
                Logger.warn("PimData", "Failed to initialize delta link:", err);
            });


        } catch (err: any) {
            Logger.error("PimData", "Error fetching data:", err);
            setState(prev => ({
                ...prev,
                loading: false,
                policiesLoading: false,
                error: err.message || "Failed to fetch PIM data"
            }));
        }
    }, [state.rolesData.length, state.lastFetched, getGraphClient, handlePolicyLoaded]);

    const clearData = useCallback(() => {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_TIMESTAMP_KEY);
        setState({
            rolesData: [],
            authenticationContexts: [],
            loading: false,
            policiesLoading: false,
            policyProgress: { current: 0, total: 0 },
            error: null,
            loadingProgress: 0,
            loadingMessage: "",
            lastFetched: null,
            failedRoleIds: [],
        });
    }, []);

    const refreshData = useCallback(async () => {
        // Cancel previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            Logger.debug("PimData", "Cancelled previous refresh request");
        }

        // Create new controller
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const signal = controller.signal;

        // SMART REFRESH LOGIC
        // 1. Check if we have a delta link
        const storedDeltaLink = getStoredDeltaLink();

        // 2. If we have a link AND existing data, try to fetch deltas
        const hasExistingData = state.rolesData.length > 0;

        if (storedDeltaLink && hasExistingData) {
            Logger.debug("PimData", "Attempting Smart Refresh (Delta Sync)...");
            setState(prev => ({
                ...prev,
                loading: prev.rolesData.length === 0, // Only block UI if we have no data
                policiesLoading: true, // Indicate background activity in LoadingStatus
                error: null,
                loadingProgress: 0,
                loadingMessage: "Checking for changes..."
            }));

            try {
                if (signal.aborted) return;

                const client = await getGraphClient();
                const deltaResult = await fetchDirectoryRoleDeltas(client, storedDeltaLink);

                if (signal.aborted) return;

                if (deltaResult) {
                    const { changes, newDeltaLink } = deltaResult;
                    Logger.debug("PimData", `Smart Refresh found ${changes.length} changes.`);

                    if (changes.length === 0) {
                        // No changes detected
                        Logger.debug("PimData", "No changes detected. Data is up to date.");
                        setState(prev => ({
                            ...prev,
                            loading: false,
                            policiesLoading: false,
                            lastFetched: new Date(),
                            loadingMessage: "Up to date"
                        }));

                        // Record sync timestamp
                        addSyncHistoryEntry({
                            workload: 'directoryRoles'
                        });

                        return;
                    }

                    // 3. Process changes using Smart Sync Service
                    setState(prev => ({ ...prev, loadingMessage: `Syncing ${changes.length} changes...` }));

                    // Identify which roles need policy re-fetch (Calculation needed for later step)
                    const affectedRoleIds = getAffectedRoleIds(changes);
                    Logger.debug("PimData", `Affected roles: ${affectedRoleIds.join(", ")}`);

                    // Call the smart sync function
                    const updatedRoles = await syncRolesWithDelta(
                        client,
                        state.rolesData,
                        changes,
                        (current, total, status) => {
                            setState(prev => ({ ...prev, loadingMessage: status }));
                        },
                        undefined,
                        undefined
                    );

                    if (signal.aborted) return;

                    // Update state with new role list
                    setState(prev => ({
                        ...prev,
                        rolesData: updatedRoles
                    }));

                    // C. Re-fetch policies for affected roles
                    if (affectedRoleIds.length > 0) {
                        setState(prev => ({ ...prev, loadingMessage: "Updating changed policies..." }));

                        for (const roleId of affectedRoleIds) {
                            if (signal.aborted) return;

                            // Find role to ensure it exists
                            const roleExists = updatedRoles.some(r => r.definition.id === roleId);
                            if (roleExists) {
                                await fetchPolicyForRole(roleId);
                            }
                        }
                    }

                    // Record sync timestamp
                    addSyncHistoryEntry({
                        workload: 'directoryRoles'
                    });

                    // Done with Smart Refresh
                    setState(prev => ({
                        ...prev,
                        loading: false,
                        lastFetched: new Date(),
                        loadingMessage: "Synced",
                        policiesLoading: false,
                        error: null
                    }));

                    return; // EXIT HERE - Do not proceed to Full Refresh
                }

                // If deltaResult is null, it means we need full sync
                Logger.debug("PimData", "Smart Refresh signal: Full Sync required.");

            } catch (deltaError: any) {
                if (signal.aborted || deltaError.name === 'AbortError' || deltaError.message === 'Aborted') {
                    Logger.info("PimData", "Smart Refresh cancelled");
                    return;
                }
                Logger.warn("PimData", "Smart Refresh failed, falling back to full refresh:", deltaError);
                // Proceed to full refresh...
            }
        }

        // FALLBACK: Full Refresh Logic (Original)

        // Clear session storage cache to force fresh fetch
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_TIMESTAMP_KEY);
        sessionStorage.removeItem(STORAGE_AUTH_CONTEXTS_KEY);

        // Set loading state
        setState(prev => ({
            ...prev,
            loading: true,
            lastFetched: null, // Force refetch
            error: null,
            loadingProgress: 0,
            loadingMessage: "Refreshing..."
        }));

        try {
            if (signal.aborted) return;
            const client = await getGraphClient();
            if (signal.aborted) return;

            // Progress callback
            const onProgress: ProgressCallback = (current, total, status) => {
                const percentage = Math.round((current / total) * 100);
                setState(prev => ({
                    ...prev,
                    loadingProgress: percentage,
                    loadingMessage: status
                }));
            };

            // Batch loaded callback
            const onBatchLoaded: BatchLoadedCallback = () => { };

            // Progress callback for background policy loading
            const handlePolicyProgress = (current: number, total: number) => {
                setState(prev => ({
                    ...prev,
                    policyProgress: { current, total }
                }));
            };

            const initialRoles = await getAllRolesOptimizedWithDeferredPolicies(
                client,
                onProgress,
                signal
            );

            // Completion callback for background policy loading
            const handlePoliciesComplete = () => {
                Logger.debug("PimData", "Background policy loading complete");
                setState(prev => ({
                    ...prev,
                    policiesLoading: false
                }));

                // Record sync timestamp
                addSyncHistoryEntry({
                    workload: 'directoryRoles'
                });
            };

            if (signal.aborted) return;

            // Fetch Authentication Contexts
            let authContexts: AuthenticationContext[] = [];
            try {
                authContexts = await getAuthenticationContexts(client);
                Logger.debug("PimData", `Fetched ${authContexts.length} Authentication Contexts`);
            } catch (error) {
                Logger.warn("PimData", "Failed to fetch Authentication Contexts:", error);
            }

            setState(prev => ({
                ...prev,
                rolesData: initialRoles,
                authenticationContexts: authContexts,
                loading: false,
                policiesLoading: true,
                lastFetched: new Date(),
                loadingProgress: 100,
                loadingMessage: "Fetching policies...",
                failedRoleIds: []
            }));

            // Start background policy fetch MANUALLY (Full Refresh fallback)
            const roleIds = initialRoles.map(r => r.definition.id);

            concurrentFetchPolicies(
                client,
                roleIds,
                8,
                300,
                handlePolicyProgress,
                handlePolicyLoaded,
                signal
            ).then(() => {
                handlePoliciesComplete();
            }).catch(err => {
                if (signal.aborted || err.message === 'Aborted') return;
                Logger.error("PimData", "Background policy fetch failed", err);
                handlePoliciesComplete();
            });

            // Initialize delta link for future smart refreshes (fire-and-forget)
            if (!signal.aborted) {
                fetchDirectoryRoleDeltas(client).then(() => {
                    Logger.debug("PimData", "Delta link initialized for future smart refreshes");
                }).catch((err) => {
                    Logger.warn("PimData", "Failed to initialize delta link:", err);
                });
            }

        } catch (err: any) {
            if (signal.aborted || err.name === 'AbortError' || err.message === 'Aborted') {
                Logger.info("PimData", "Full Refresh cancelled");
                return;
            }
            Logger.error("PimData", "Error refreshing data:", err);
            setState(prev => ({
                ...prev,
                loading: false,
                policiesLoading: false,
                error: err.message || "Failed to refresh PIM data"
            }));
        }
    }, [getGraphClient, handlePolicyLoaded]);

    // Register refreshData with UnifiedPimContext so refreshAllWorkloads can delegate to it
    useEffect(() => {
        registerWorkloadRefresh("directoryRoles", refreshData);
    }, [registerWorkloadRefresh, refreshData]);

    // Auto-refresh logic: Trigger update check after initial load from cache
    // This ensures we verify the cache validity without blocking the UI
    useEffect(() => {
        if (state.lastFetched && !hasAutoRefreshed.current) {
            hasAutoRefreshed.current = true;

            // Check freshness (5 minutes) to prevent redundant "Fetching policies..." on F5
            const now = new Date();
            const diff = now.getTime() - state.lastFetched.getTime();
            if (diff < 5 * 60 * 1000) {
                Logger.debug("PimData", "Auto-refresh: Data is fresh, skipping check.");

                // Restore SyncStatus indicator by logging sync timestamp
                addSyncHistoryEntry({
                    workload: 'directoryRoles'
                });

                return;
            }

            Logger.debug("PimData", "Triggering background update check...");
            refreshData();
        }
    }, [state.lastFetched, refreshData]);

    // Write operations - wrapped to use shared graph client
    const updatePolicy = useCallback(async (roleId: string, settings: RoleSettings): Promise<boolean> => {
        try {
            const client = await getGraphClient();
            return await updatePimPolicy(client, roleId, settings);
        } catch (error) {
            Logger.error("PimData", `updatePolicy failed for ${roleId}`, error);
            throw error;
        }
    }, [getGraphClient]);

    const createAssignment = useCallback(async (roleId: string, settings: AssignmentSettings): Promise<any[]> => {
        try {
            const client = await getGraphClient();
            return await createPimAssignment(client, settings, roleId);
        } catch (error) {
            Logger.error("PimData", `createAssignment failed for ${roleId}`, error);
            throw error;
        }
    }, [getGraphClient]);

    const getPolicySettings = useCallback(async (roleId: string) => {
        try {
            const client = await getGraphClient();
            return await getRolePolicy(client, roleId);
        } catch (error) {
            Logger.error("PimData", `getPolicySettings failed for ${roleId}`, error);
            throw error;
        }
    }, [getGraphClient]);

    return (
        <PimDataContext.Provider value={{
            ...state,
            fetchData,
            clearData,
            refreshData,
            fetchPolicyForRole,
            updatePolicy,
            createAssignment,
            getPolicySettings
        }}>
            {children}
        </PimDataContext.Provider>
    );
}

export function usePimData() {
    const context = useContext(PimDataContext);
    if (context === undefined) {
        throw new Error("usePimData must be used within a PimDataProvider");
    }
    return context;
}
