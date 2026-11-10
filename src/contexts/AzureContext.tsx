"use client";

import { useMsal } from "@azure/msal-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WorkloadLoadingState } from "@/types/workload.types";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { useArmToken } from "@/hooks/useAzureConsent";
import { createArmClient, type ArmClient } from "@/utils/armClient";
import { isAzureEnabled } from "@/utils/azureConsent";
import { LiveValue } from "@/utils/liveValue";
import { SHELL_REFRESH_EVENT } from "@/utils/refreshEvents";
import { createUnmountAbort, createWorkloadEngine } from "@/workloads/engine";
import { AZURE_INITIAL_EXTRAS, azureCacheOwner, createAzureAssignmentsAdapter, type AzureExtras } from "@/workloads/azureAssignmentsAdapter";
import type { EngineState } from "@/workloads/types";

/**
 * The Azure data (Azure spec 5): one workload engine with the Azure adapter and the ARM client, mounted in the Azure
 * layout. Split in three contexts like `UnifiedPimContext`, so a component that only needs data does not re-render on
 * progress ticks. The page loads on mount (`load`), the shell's Refresh reloads (`SHELL_REFRESH_EVENT`). Leaving the
 * Azure pages unmounts it and aborts its run; the session cache, bound to the account, shows the data again on return.
 */

type AzureState = EngineState<AzureAssignment, AzureExtras>;

export interface AzureDataValue {
    assignments: AzureAssignment[];
    scopes: AzureScope[];
    lastFetched?: string;
    /**
     * What the reads that follow the assignments are kept by (service principal types, alerts): the load and how many
     * assignments it holds. Read the rest adds assignments to the same load and keeps `lastFetched`, so this key is new
     * when it brought new ones.
     */
    loadKey: string;
    /** The last load failed; the data that was loaded stays */
    error?: string;
}

export interface AzureLoadingValue {
    loading: WorkloadLoadingState;
}

export interface AzureActionsValue {
    /** Page mount: honours the 60 minute TTL and never starts a second run */
    load: () => Promise<void>;
    /** Refresh: reads everything again */
    refresh: () => Promise<void>;
    /** Read the rest: one more round, with the same budget, over the resource groups and resources the last one did not reach */
    readRest: () => Promise<void>;
    /** The ARM client of this session, for reads outside the engine (a role's settings) */
    getArmClient: () => ArmClient;
}

function createInitialState(): AzureState {
    return {
        data: [],
        extras: AZURE_INITIAL_EXTRAS,
        loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" },
        consent: { consented: false },
        lastFetched: undefined,
    };
}

/**
 * The Azure engines that are mounted, or unmounted less than `UNMOUNT_ABORT_DELAY_MS` ago. Sign-out runs in the shell,
 * outside `/azure` where this provider lives, so it cannot use the context: it calls `clearAzureSession` instead.
 */
const mountedEngines = new Set<{ clear(): void }>();

/** Sign-out: abort every Azure run and forget its data and cache, so nothing is written back after the caches are wiped */
export function clearAzureSession(): void {
    for (const engine of mountedEngines) engine.clear();
}

const AzureDataContext = createContext<AzureDataValue | undefined>(undefined);
const AzureLoadingContext = createContext<AzureLoadingValue | undefined>(undefined);
const AzureActionsContext = createContext<AzureActionsValue | undefined>(undefined);

export function AzureProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<AzureState>(createInitialState);
    const [liveState] = useState(() => new LiveValue<AzureState>(state));
    useEffect(() => {
        liveState.set(state);
    }, [state, liveState]);

    // One ARM client per mount; it reads the latest token function through a holder
    const getArmToken = useArmToken();
    const [liveToken] = useState(() => new LiveValue<() => Promise<string>>(getArmToken));
    useEffect(() => {
        liveToken.set(getArmToken);
    }, [getArmToken, liveToken]);
    const [armClient] = useState(() => createArmClient(() => liveToken.get()()));

    // The cache belongs to the signed-in account: another account's cache is never shown (audit run 3)
    const { accounts } = useMsal();
    const account = accounts[0];
    const owner = azureCacheOwner(account);

    const engine = useMemo(() => createWorkloadEngine(createAzureAssignmentsAdapter(() => owner), {
        store: {
            get: () => liveState.get(),
            apply: (updater) => setState(updater),
        },
        getClient: async () => armClient,
        // The shell's sync line follows the Entra workloads; Azure has none yet
        onSynced: () => undefined,
    }), [liveState, armClient, owner]);

    // Show what the session cache holds, once per engine (a new one comes with another account); the page's `load`
    // knows about a cache that is not shown yet
    const hydratedRef = useRef<object | null>(null);
    useEffect(() => {
        if (hydratedRef.current !== engine) {
            hydratedRef.current = engine;
            engine.hydrate();
        }
    }, [engine]);

    // Leaving /azure aborts the run and its background phase (readBelow), so no orphaned run keeps using the ARM
    // limiter. Strict mode unmounts and remounts at once: the abort waits a moment and the remount cancels it.
    const unmountAbort = useMemo(() => createUnmountAbort(() => {
        engine.abort();
        mountedEngines.delete(engine);
    }), [engine]);
    useEffect(() => {
        unmountAbort.mounted();
        mountedEngines.add(engine);
        return () => {
            engine.dispose();
            unmountAbort.unmounted();
        };
    }, [engine, unmountAbort]);

    // Write the cache whenever the data or the loading state changed; the engine skips it while anything loads
    useEffect(() => {
        engine.persist();
    }, [engine, state.data, state.extras, state.loading.phase]);

    const load = useCallback(() => engine.load(), [engine]);
    const refresh = useCallback(() => engine.refresh(false), [engine]);
    const readRest = useCallback(() => engine.resume(), [engine]);
    const getArmClient = useCallback(() => armClient, [armClient]);

    // The shell's Refresh on an Azure page reloads Azure, not Entra (AppShell); only when this account turned Azure on
    useEffect(() => {
        const onRefresh = () => {
            if (isAzureEnabled(account)) void engine.refresh(false);
        };
        window.addEventListener(SHELL_REFRESH_EVENT, onRefresh);
        return () => window.removeEventListener(SHELL_REFRESH_EVENT, onRefresh);
    }, [engine, account]);

    const error = state.loading.error;
    const dataValue = useMemo<AzureDataValue>(() => ({
        assignments: state.data,
        scopes: state.extras.scopes,
        lastFetched: state.lastFetched,
        loadKey: `${state.lastFetched ?? ""}#${state.data.length}`,
        error,
    }), [state.data, state.extras.scopes, state.lastFetched, error]);

    const loadingValue = useMemo<AzureLoadingValue>(() => ({ loading: state.loading }), [state.loading]);

    const actionsValue = useMemo<AzureActionsValue>(() => ({ load, refresh, readRest, getArmClient }), [load, refresh, readRest, getArmClient]);

    return (
        <AzureActionsContext.Provider value={actionsValue}>
            <AzureDataContext.Provider value={dataValue}>
                <AzureLoadingContext.Provider value={loadingValue}>
                    {children}
                </AzureLoadingContext.Provider>
            </AzureDataContext.Provider>
        </AzureActionsContext.Provider>
    );
}

/** Azure assignments and scopes only; does not re-render on loading progress. */
export function useAzureData(): AzureDataValue {
    const context = useContext(AzureDataContext);
    if (context === undefined) throw new Error("useAzureData must be used within an AzureProvider");
    return context;
}

/** The loading phase and progress of the Azure data; re-renders on every progress tick. */
export function useAzureLoading(): AzureLoadingValue {
    const context = useContext(AzureLoadingContext);
    if (context === undefined) throw new Error("useAzureLoading must be used within an AzureProvider");
    return context;
}

/** Stable actions (load, refresh, read the rest, ARM client); never re-renders consumers. */
export function useAzureActions(): AzureActionsValue {
    const context = useContext(AzureActionsContext);
    if (context === undefined) throw new Error("useAzureActions must be used within an AzureProvider");
    return context;
}
