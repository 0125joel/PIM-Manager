import type { Client } from "@microsoft/microsoft-graph-client";
import type { WorkloadState, WorkloadType } from "@/types/workload.types";

/**
 * One interface for every workload (NG-09). A workload says how to read its data, how to refresh it and where
 * to cache it; the engine (`engine.ts`) owns everything around that: freshness, one load at a time, aborting,
 * progress, errors, batching of background updates, the cache and the sync history. A new workload (Azure,
 * Intune, ...) is one adapter, not a new provider.
 */

/** What a workload holds: its items and whatever else must be saved with them. */
export interface WorkloadContent<T, X> {
    data: T[];
    extras: X;
}

/** The sessionStorage cache of one workload. Failures to read or write are the cache's own business. */
export interface WorkloadCache<T, X> {
    read(): { data: T[]; extras: X; lastFetched: string } | null;
    write(content: WorkloadContent<T, X>, lastFetched: string): void;
    clear(): void;
    /** The timestamp in storage, to see a cache the state has not been filled from yet (page effects run before the provider's). */
    peekTimestamp(): string | null;
}

export interface WorkloadRunContext<T, X> {
    client: Client;
    signal: AbortSignal;
    /** True after a write, from the wizard and for "Full refresh": reload everything */
    force: boolean;
    /** What is loaded right now (live, never a stale snapshot) */
    current(): WorkloadContent<T, X>;
    /** Progress of the blocking phase (the data is not shown until it ends) */
    progress(current: number, total: number, message: string): void;
    /** Progress of the background phase */
    backgroundProgress(current: number, total: number): void;
    /** A status sentence without a count */
    message(text: string): void;
    /** A smart refresh starts non-blocking and falls back to a full load: tell the engine when it does */
    setBlocking(blocking: boolean): void;
    /** Change what is loaded from the background phase; applied in batches (NG-07) */
    patch(updater: (content: WorkloadContent<T, X>) => WorkloadContent<T, X>): void;
}

export interface WorkloadOutcome<T, X> extends WorkloadContent<T, X> {
    /** Sentence shown when the run is complete; the engine adds none of its own */
    message: string;
    /**
     * Work that goes on after the data is shown. The engine marks the workload as still loading until it settles,
     * then flushes pending patches and writes the cache. A rejection is logged; the data stays.
     */
    background?: Promise<unknown>;
    /** Sentence shown while the background phase runs */
    backgroundMessage?: string;
    /** Items the background phase will read, for its progress */
    backgroundTotal?: number;
}

export interface WorkloadStart {
    /** Blocking: the loading line shows and the data is not trustworthy yet. Otherwise the run is a quiet refresh. */
    blocking: boolean;
    message: string;
}

export interface WorkloadAdapter<T, X = undefined> {
    id: WorkloadType;
    /** Scopes of the Graph token for this workload; undefined means the login scopes */
    scopes?: string[];
    initialExtras: X;
    cache: WorkloadCache<T, X>;
    /** What the run begins with, from what is loaded and whether the run is forced */
    begin(current: WorkloadContent<T, X>, force: boolean): WorkloadStart;
    run(ctx: WorkloadRunContext<T, X>): Promise<WorkloadOutcome<T, X>>;
    /**
     * Quiet work after the cache was shown, for what a reload cut short (group approver names). It runs once per
     * hydrate, outside any phase, and may only patch; a rejection is logged and the cached data stays.
     */
    afterHydrate?(content: WorkloadContent<T, X>, ctx: WorkloadFollowUpContext<T, X>): Promise<void>;
}

export interface WorkloadFollowUpContext<T, X> {
    getClient(): Promise<Client>;
    signal: AbortSignal;
    patch(updater: (content: WorkloadContent<T, X>) => WorkloadContent<T, X>): void;
}

/** What the engine needs from the place the state lives (the unified provider). */
export interface WorkloadStore<T, X> {
    get(): WorkloadState<T, X>;
    apply(updater: (state: WorkloadState<T, X>) => WorkloadState<T, X>): void;
}

export interface WorkloadEngineDeps<T, X> {
    store: WorkloadStore<T, X>;
    getClient: (scopes?: string[]) => Promise<Client>;
    /** The loaded data is now as fresh as `timestamp` (default: now) */
    onSynced: (timestamp?: Date) => void;
}

export interface WorkloadEngine<T, X> {
    /** Page mount and first use: honours the 60 minute TTL and a cache not yet shown, and never starts a second run */
    load(): Promise<void>;
    /** Refresh button and after a write: no TTL check; `force` reloads everything */
    refresh(force: boolean): Promise<void>;
    /** Change what is loaded, batched; `immediate` applies at once */
    patch(updater: (content: WorkloadContent<T, X>) => WorkloadContent<T, X>, immediate?: boolean): void;
    /** Fill the state from the cache; the cache's timestamp, or null when there was nothing to show */
    hydrate(): string | null;
    /** Write the cache when nothing is loading; the provider calls it whenever the data or the loading state changed */
    persist(): void;
    /** Sign out: abort, forget the cache and reset the state */
    clear(): void;
    dispose(): void;
}
