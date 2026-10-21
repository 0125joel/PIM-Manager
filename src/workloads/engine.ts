import type { Client } from "@microsoft/microsoft-graph-client";
import { createTrailingThrottle, PROGRESS_FLUSH_MS } from "@/utils/throttle";
import { createUpdateBatcher } from "@/utils/updateBatcher";
import { describeLoadFailure, getErrorMessage, isAbortError } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import type { WorkloadState } from "@/types/workload.types";
import type {
    WorkloadAdapter,
    WorkloadContent,
    WorkloadEngine,
    WorkloadEngineDeps,
    WorkloadRunContext,
} from "./types";

/** A loaded workload is fresh for 60 minutes (the architecture standard for every cache) */
export const WORKLOAD_TTL_MS = 60 * 60 * 1000;
/** Background updates (a policy per role) are applied to the state at most this often (NG-07) */
export const BACKGROUND_BATCH_MS = 250;

export function isWorkloadFresh(lastFetched: string | undefined, now: number = Date.now()): boolean {
    if (!lastFetched) return false;
    const at = Date.parse(lastFetched);
    return !Number.isNaN(at) && now - at < WORKLOAD_TTL_MS;
}

function isAborted(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted || isAbortError(error) || getErrorMessage(error) === "Aborted";
}

/**
 * The loading logic every workload shares, written once. It is plain TypeScript (no React): the state lives in a
 * store the provider hands in, so it is tested with a fake adapter and a fake store.
 *
 * Rules it keeps for every workload (see lessons-learned.md):
 * - one run at a time per workload; a second `load` while one runs does nothing, `refresh` replaces the run,
 * - a run that was replaced or aborted never writes state,
 * - a failed run keeps the data that was loaded and says so, it never turns into "no data",
 * - the cache is written only when nothing is loading, so a half loaded workload is never cached.
 */
export function createWorkloadEngine<T, X>(
    adapter: WorkloadAdapter<T, X>,
    deps: WorkloadEngineDeps<T, X>
): WorkloadEngine<T, X> {
    const { store, getClient, onSynced } = deps;
    const label = adapter.id;

    let controller: AbortController | null = null;
    // The follow-up of a hydrate (afterHydrate); aborted by a run and by clear
    let followUp: AbortController | null = null;
    let runId = 0;
    let inflight: Promise<void> | null = null;

    const setLoading = (patch: Partial<WorkloadState<T, X>["loading"]>) => {
        store.apply((s) => ({ ...s, loading: { ...s.loading, ...patch } }));
    };

    const backgroundOf = (s: WorkloadState<T, X>) => s.loading.background ?? { running: false, progress: { current: 0, total: 0 } };

    const batcher = createUpdateBatcher<WorkloadState<T, X>>(
        (combined) => store.apply(combined),
        BACKGROUND_BATCH_MS,
        (count) => Logger.info("Workload", `${label}: applied ${count} background updates in one state update`)
    );

    const current = (): WorkloadContent<T, X> => {
        const s = store.get();
        return { data: s.data, extras: s.extras };
    };

    const readCachedTimestamp = (): string | null => {
        try {
            return adapter.cache.peekTimestamp();
        } catch {
            return null;
        }
    };

    const run = (force: boolean): Promise<void> => {
        controller?.abort();
        // A run reads everything the follow-up of the cache would have completed
        followUp?.abort();
        followUp = null;
        const thisController = new AbortController();
        controller = thisController;
        const signal = thisController.signal;
        const id = ++runId;
        const isCurrent = () => id === runId && !signal.aborted;

        const start = adapter.begin(current(), force);
        let blocking = start.blocking;

        const blockingProgress = createTrailingThrottle<{ current: number; total: number; message: string }>(
            (p) => {
                if (!isCurrent()) return;
                setLoading({
                    progress: { current: p.current, total: p.total },
                    percent: p.total > 0 ? Math.round((p.current / p.total) * 100) : 0,
                    message: p.message,
                });
            },
            PROGRESS_FLUSH_MS,
            (p) => p.current >= p.total
        );
        const backgroundProgress = createTrailingThrottle<{ current: number; total: number }>(
            (p) => {
                if (!isCurrent()) return;
                store.apply((s) => ({ ...s, loading: { ...s.loading, background: { running: true, progress: p } } }));
            },
            PROGRESS_FLUSH_MS,
            (p) => p.current >= p.total
        );

        store.apply((s) => ({
            ...s,
            loading: blocking
                ? { phase: "fetching", progress: { current: 0, total: 0 }, message: start.message, percent: 0, background: { running: false, progress: backgroundOf(s).progress } }
                : { ...s.loading, phase: "processing", message: start.message, error: undefined, background: { running: true, progress: { current: 0, total: 0 } } },
        }));

        const doRun = async (): Promise<void> => {
            try {
                const client: Client = await getClient(adapter.scopes);
                if (!isCurrent()) return;

                const ctx: WorkloadRunContext<T, X> = {
                    client,
                    signal,
                    force,
                    current,
                    progress: (c, t, message) => blockingProgress.push({ current: c, total: t, message }),
                    backgroundProgress: (c, t) => backgroundProgress.push({ current: c, total: t }),
                    message: (text) => {
                        if (isCurrent()) setLoading({ message: text });
                    },
                    setBlocking: (next) => {
                        if (next === blocking || !isCurrent()) return;
                        blocking = next;
                        store.apply((s) => ({
                            ...s,
                            loading: next
                                ? { phase: "fetching", progress: { current: 0, total: 0 }, message: s.loading.message, percent: 0, background: { running: false, progress: backgroundOf(s).progress } }
                                : { ...s.loading, phase: "processing", background: { running: true, progress: backgroundOf(s).progress } },
                        }));
                    },
                    patch: (updater) => {
                        if (!isCurrent()) return;
                        batcher.push((s) => ({ ...s, ...updater({ data: s.data, extras: s.extras }) }));
                    },
                };

                const outcome = await adapter.run(ctx);
                if (!isCurrent()) return;
                blockingProgress.cancel();

                const lastFetched = new Date().toISOString();
                const hasBackground = outcome.background !== undefined;
                store.apply((s) => ({
                    ...s,
                    data: outcome.data,
                    extras: outcome.extras,
                    lastFetched,
                    loading: {
                        phase: hasBackground ? "processing" : "complete",
                        progress: hasBackground ? s.loading.progress : { current: 1, total: 1 },
                        message: hasBackground ? outcome.backgroundMessage ?? outcome.message : outcome.message,
                        percent: 100,
                        background: { running: hasBackground, progress: { current: 0, total: outcome.backgroundTotal ?? 0 } },
                    },
                }));

                if (!hasBackground) {
                    onSynced();
                    return;
                }

                void outcome.background!
                    .catch((error: unknown) => {
                        if (!isAborted(error, signal)) Logger.error("Workload", `${label}: background phase failed`, error);
                    })
                    .then(() => {
                        // A replaced run has its own ending; the one that finished first must not close the newer one
                        if (!isCurrent()) return;
                        backgroundProgress.cancel();
                        batcher.flush();
                        store.apply((s) => ({
                            ...s,
                            loading: { ...s.loading, phase: "complete", message: "Synced", background: { running: false, progress: backgroundOf(s).progress } },
                        }));
                        onSynced();
                    });
            } catch (error: unknown) {
                blockingProgress.cancel();
                backgroundProgress.cancel();
                if (isAborted(error, signal) || id !== runId) {
                    Logger.info("Workload", `${label}: run cancelled`);
                    return;
                }
                Logger.error("Workload", `${label}: load failed`, error);
                batcher.flush();
                store.apply((s) => ({
                    ...s,
                    loading: {
                        ...s.loading,
                        phase: "error",
                        message: "Failed to load data",
                        error: describeLoadFailure(error),
                        background: { running: false, progress: backgroundOf(s).progress },
                    },
                }));
            }
        };

        const promise = doRun().finally(() => {
            if (inflight === promise) inflight = null;
        });
        inflight = promise;
        return promise;
    };

    return {
        load() {
            const s = store.get();
            if (s.data.length > 0 && isWorkloadFresh(s.lastFetched)) {
                Logger.debug("Workload", `${label}: data is fresh, nothing to load`);
                return Promise.resolve();
            }
            // Page effects run before the provider has filled the state from the cache (F5): do not load what is about to appear
            if (s.data.length === 0 && !s.lastFetched && isWorkloadFresh(readCachedTimestamp() ?? undefined)) {
                Logger.debug("Workload", `${label}: fresh data in storage, waiting for the cache to be shown`);
                return Promise.resolve();
            }
            if (inflight) {
                Logger.debug("Workload", `${label}: a run is already going, not starting a second one`);
                return inflight;
            }
            return run(false);
        },

        refresh(force: boolean) {
            return run(force);
        },

        patch(updater, immediate = false) {
            batcher.push((s) => ({ ...s, ...updater({ data: s.data, extras: s.extras }) }));
            if (immediate) batcher.flush();
        },

        hydrate() {
            const s = store.get();
            if (s.data.length > 0 || inflight) return null;
            let cached: ReturnType<typeof adapter.cache.read> = null;
            try {
                cached = adapter.cache.read();
            } catch (error) {
                Logger.error("Workload", `${label}: could not read the cache`, error);
                adapter.cache.clear();
                return null;
            }
            if (!cached) return null;
            Logger.debug("Workload", `${label}: loaded ${cached.data.length} items from the cache`);
            store.apply((prev) => ({
                ...prev,
                data: cached.data,
                extras: cached.extras,
                lastFetched: cached.lastFetched,
                loading: { phase: "complete", progress: { current: 1, total: 1 }, message: "Loaded from cache", percent: 100 },
            }));
            if (isWorkloadFresh(cached.lastFetched)) onSynced(new Date(cached.lastFetched));
            if (adapter.afterHydrate) {
                followUp?.abort();
                const ownController = new AbortController();
                followUp = ownController;
                const content = { data: cached.data, extras: cached.extras };
                // After this update is applied, so the first patch finds the cached items
                setTimeout(() => {
                    if (ownController.signal.aborted) return;
                    adapter.afterHydrate?.(content, {
                        getClient: () => getClient(adapter.scopes),
                        signal: ownController.signal,
                        patch: (updater) => batcher.push((s) => ({ ...s, ...updater({ data: s.data, extras: s.extras }) })),
                    }).catch((error: unknown) => {
                        if (!ownController.signal.aborted) Logger.warn("Workload", `${label}: follow-up after the cache failed`, error);
                    });
                }, 0);
            }
            return cached.lastFetched;
        },

        persist() {
            const s = store.get();
            const background = backgroundOf(s);
            if (s.loading.phase === "fetching" || background.running || s.data.length === 0) return;
            adapter.cache.write({ data: s.data, extras: s.extras }, s.lastFetched ?? new Date().toISOString());
        },

        clear() {
            controller?.abort();
            controller = null;
            followUp?.abort();
            followUp = null;
            runId++;
            inflight = null;
            batcher.cancel();
            adapter.cache.clear();
            store.apply((s) => ({
                ...s,
                data: [],
                extras: adapter.initialExtras,
                lastFetched: undefined,
                loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" },
            }));
        },

        dispose() {
            // Only timers: a run that is going must survive React strict mode's simulated unmount
            batcher.cancel();
        },
    };
}
