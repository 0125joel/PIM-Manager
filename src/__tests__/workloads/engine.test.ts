import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import type { WorkloadState } from "@/types/workload.types";
import { createWorkloadEngine, WORKLOAD_TTL_MS } from "@/workloads/engine";
import type { WorkloadAdapter, WorkloadCache, WorkloadOutcome, WorkloadRunContext, WorkloadStore } from "@/workloads/types";

type Item = { id: string; value?: string };

function initialState(): WorkloadState<Item, undefined> {
    return {
        workload: "pimGroups",
        data: [],
        extras: undefined,
        loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" },
        consent: { consented: true },
        lastFetched: undefined,
    };
}

function makeStore() {
    let state = initialState();
    const store: WorkloadStore<Item, undefined> = {
        get: () => state,
        apply: (updater) => {
            state = updater(state);
        },
    };
    return { store, get: () => state, set: (next: WorkloadState<Item, undefined>) => { state = next; } };
}

function makeCache(initial: { data: Item[]; lastFetched: string } | null = null) {
    let stored = initial;
    const cache: WorkloadCache<Item, undefined> & { writes: number } = {
        writes: 0,
        read: () => (stored ? { data: stored.data, extras: undefined, lastFetched: stored.lastFetched } : null),
        write(content, lastFetched) {
            stored = { data: content.data, lastFetched };
            cache.writes++;
        },
        clear: () => {
            stored = null;
        },
        peekTimestamp: () => stored?.lastFetched ?? null,
    };
    return cache;
}

type RunFn = (ctx: WorkloadRunContext<Item, undefined>) => Promise<WorkloadOutcome<Item, undefined>>;

function makeAdapter(run: RunFn, cache = makeCache(), blocking = true): WorkloadAdapter<Item, undefined> & { run: ReturnType<typeof vi.fn> } {
    return {
        id: "pimGroups",
        initialExtras: undefined,
        cache,
        begin: () => ({ blocking, message: "Loading" }),
        run: vi.fn(run),
    };
}

const client = {} as Client;

function setup(run: RunFn, opts: { cache?: ReturnType<typeof makeCache>; blocking?: boolean } = {}) {
    const holder = makeStore();
    const onSynced = vi.fn();
    const adapter = makeAdapter(run, opts.cache ?? makeCache(), opts.blocking ?? true);
    const engine = createWorkloadEngine(adapter, { store: holder.store, getClient: async () => client, onSynced });
    return { holder, onSynced, adapter, engine };
}

const done = (data: Item[], extra: Partial<WorkloadOutcome<Item, undefined>> = {}): WorkloadOutcome<Item, undefined> => ({ data, extras: undefined, message: `Loaded ${data.length}`, ...extra });

describe("workload engine", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("loads, commits the data and reports the sync", async () => {
        const { engine, holder, onSynced } = setup(async () => done([{ id: "a" }, { id: "b" }]));
        await engine.load();
        const s = holder.get();
        expect(s.data).toHaveLength(2);
        expect(s.loading.phase).toBe("complete");
        expect(s.loading.message).toBe("Loaded 2");
        expect(s.lastFetched).toBeDefined();
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it("does not load fresh data again, but loads data older than the TTL", async () => {
        const { engine, holder, adapter } = setup(async () => done([{ id: "a" }]));
        await engine.load();
        await engine.load();
        expect(adapter.run).toHaveBeenCalledTimes(1);

        holder.set({ ...holder.get(), lastFetched: new Date(Date.now() - WORKLOAD_TTL_MS - 1000).toISOString() });
        await engine.load();
        expect(adapter.run).toHaveBeenCalledTimes(2);
    });

    it("never starts a second run while one is going (strict mode, two pages)", async () => {
        let release: () => void = () => {};
        const { engine, adapter } = setup(() => new Promise((resolve) => { release = () => resolve(done([{ id: "a" }])); }));
        const first = engine.load();
        const second = engine.load();
        await vi.advanceTimersByTimeAsync(0);
        release();
        await Promise.all([first, second]);
        expect(adapter.run).toHaveBeenCalledTimes(1);
    });

    it("waits for a fresh cache that the state has not been filled from yet", async () => {
        const cache = makeCache({ data: [{ id: "cached" }], lastFetched: new Date().toISOString() });
        const { engine, adapter } = setup(async () => done([{ id: "a" }]), { cache });
        await engine.load();
        expect(adapter.run).not.toHaveBeenCalled();
    });

    it("refresh replaces a run: the replaced run writes nothing", async () => {
        const releases: Array<() => void> = [];
        const { engine, holder } = setup((ctx) => new Promise((resolve) => {
            const n = releases.length;
            releases.push(() => resolve(done([{ id: `run-${n}` }])));
            void ctx;
        }));
        const first = engine.refresh(false);
        await vi.advanceTimersByTimeAsync(0);
        const second = engine.refresh(true);
        await vi.advanceTimersByTimeAsync(0);
        releases[0]();
        releases[1]();
        await Promise.all([first, second]);
        expect(holder.get().data).toEqual([{ id: "run-1" }]);
    });

    it("keeps the loaded data when a refresh fails and says so", async () => {
        let fail = false;
        const { engine, holder } = setup(async () => {
            if (fail) throw Object.assign(new Error("boom"), { statusCode: 429 });
            return done([{ id: "a" }]);
        });
        await engine.refresh(false);
        fail = true;
        await engine.refresh(true);
        const s = holder.get();
        expect(s.data).toEqual([{ id: "a" }]);
        expect(s.loading.phase).toBe("error");
        expect(s.loading.error).toContain("429");
        expect(s.loading.background?.running ?? false).toBe(false);
    });

    it("an aborted run ends quietly", async () => {
        const { engine, holder } = setup(async () => {
            throw new Error("Aborted");
        });
        await engine.refresh(false);
        expect(holder.get().loading.phase).toBe("fetching");
        expect(holder.get().loading.error).toBeUndefined();
    });

    it("blocking progress is throttled into the loading state", async () => {
        const { engine, holder } = setup(async (ctx) => {
            ctx.progress(1, 4, "one");
            ctx.progress(2, 4, "two");
            await vi.advanceTimersByTimeAsync(300);
            return done([{ id: "a" }]);
        });
        const promise = engine.load();
        await vi.advanceTimersByTimeAsync(0);
        await promise;
        expect(holder.get().loading.percent).toBe(100);
    });

    it("background phase: data shows first, patches are batched, the end flushes and syncs", async () => {
        let finish: () => void = () => {};
        const { engine, holder, onSynced } = setup(async (ctx) => {
            const background = new Promise<void>((resolve) => { finish = resolve; }).then(() => undefined);
            ctx.patch((c) => ({ ...c, data: c.data.map((i) => (i.id === "a" ? { ...i, value: "policy" } : i)) }));
            return done([{ id: "a" }, { id: "b" }], { background, backgroundTotal: 2 });
        });
        await engine.load();
        expect(holder.get().loading.phase).toBe("processing");
        expect(holder.get().loading.background?.running).toBe(true);
        expect(holder.get().loading.background?.progress.total).toBe(2);
        expect(onSynced).not.toHaveBeenCalled();
        // nothing is cached while loading
        engine.persist();
        expect(holder.get().data).toHaveLength(2);

        engine.patch((c) => ({ ...c, data: c.data.map((i) => (i.id === "b" ? { ...i, value: "late" } : i)) }));
        finish();
        await vi.advanceTimersByTimeAsync(0);
        const s = holder.get();
        expect(s.loading.phase).toBe("complete");
        expect(s.loading.background?.running).toBe(false);
        expect(s.data.find((i) => i.id === "b")?.value).toBe("late");
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it("a failed background phase still ends the loading state and keeps the data", async () => {
        const { engine, holder } = setup(async () => done([{ id: "a" }], { background: Promise.reject(new Error("policies failed")) }));
        await engine.load();
        await vi.advanceTimersByTimeAsync(0);
        expect(holder.get().data).toHaveLength(1);
        expect(holder.get().loading.background?.running).toBe(false);
        expect(holder.get().loading.phase).toBe("complete");
    });

    it("hydrate shows the cache and reports a fresh sync", () => {
        const stamp = new Date().toISOString();
        const cache = makeCache({ data: [{ id: "cached" }], lastFetched: stamp });
        const { engine, holder, onSynced } = setup(async () => done([]), { cache });
        expect(engine.hydrate()).toBe(stamp);
        expect(holder.get().data).toEqual([{ id: "cached" }]);
        expect(holder.get().loading.phase).toBe("complete");
        expect(onSynced).toHaveBeenCalledTimes(1);
    });

    it("hydrate runs the adapter's follow-up once, after the cache is shown, and its patches land", async () => {
        const cache = makeCache({ data: [{ id: "cached" }], lastFetched: new Date().toISOString() });
        const { engine, holder, adapter } = setup(async () => done([]), { cache });
        const followUp = vi.fn(async (content: { data: Item[] }, ctx: { patch: (u: (c: { data: Item[]; extras: undefined }) => { data: Item[]; extras: undefined }) => void }) => {
            expect(content.data).toEqual([{ id: "cached" }]);
            ctx.patch((c) => ({ ...c, data: c.data.map((item) => ({ ...item, value: "named" })) }));
        });
        adapter.afterHydrate = followUp;
        engine.hydrate();
        expect(followUp).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(300);
        expect(followUp).toHaveBeenCalledTimes(1);
        expect(holder.get().data).toEqual([{ id: "cached", value: "named" }]);
        expect(adapter.run).not.toHaveBeenCalled();
    });

    it("a run or clear aborts the follow-up of the cache", async () => {
        const cache = makeCache({ data: [{ id: "cached" }], lastFetched: new Date().toISOString() });
        const { engine, adapter } = setup(async () => done([{ id: "fresh" }]), { cache });
        let signal: AbortSignal | undefined;
        adapter.afterHydrate = vi.fn(async (_content, ctx) => { signal = ctx.signal; await new Promise(() => undefined); });
        engine.hydrate();
        await vi.advanceTimersByTimeAsync(0);
        expect(signal?.aborted).toBe(false);
        await engine.refresh(true);
        expect(signal?.aborted).toBe(true);
    });

    it("hydrate does nothing without a cache or when data is already there", async () => {
        const { engine, holder } = setup(async () => done([{ id: "a" }]));
        expect(engine.hydrate()).toBeNull();
        await engine.load();
        const cache = makeCache({ data: [{ id: "cached" }], lastFetched: new Date().toISOString() });
        const second = setup(async () => done([{ id: "loaded" }]), { cache });
        await second.engine.refresh(false);
        expect(second.engine.hydrate()).toBeNull();
        expect(second.holder.get().data).toEqual([{ id: "loaded" }]);
        expect(holder.get().data).toEqual([{ id: "a" }]);
    });

    it("persist writes the cache only when nothing is loading", async () => {
        const cache = makeCache();
        const { engine } = setup(async () => done([{ id: "a" }]), { cache });
        engine.persist();
        expect(cache.writes).toBe(0);
        await engine.load();
        engine.persist();
        expect(cache.writes).toBe(1);
    });

    it("clear aborts, forgets the cache and empties the state", async () => {
        const cache = makeCache();
        const { engine, holder } = setup(async () => done([{ id: "a" }]), { cache });
        await engine.load();
        engine.persist();
        engine.clear();
        expect(holder.get().data).toEqual([]);
        expect(holder.get().loading.phase).toBe("idle");
        expect(cache.read()).toBeNull();
    });

    it("a quiet refresh does not block: it runs in the background state", async () => {
        const seen: string[] = [];
        const { engine, holder } = setup(async () => {
            seen.push(holder.get().loading.phase);
            return done([{ id: "a" }]);
        }, { blocking: false });
        await engine.refresh(false);
        expect(seen).toEqual(["processing"]);
        expect(holder.get().loading.phase).toBe("complete");
    });
});
