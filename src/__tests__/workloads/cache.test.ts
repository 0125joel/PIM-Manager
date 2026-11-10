import { describe, expect, it } from "vitest";
import { createSessionCache } from "@/workloads/cache";

function fakeStorage(limit = Infinity) {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
            const size = [...map.entries()].filter(([key]) => key !== k).reduce((n, [, val]) => n + val.length, 0) + v.length;
            if (size > limit) throw new DOMException("full", "QuotaExceededError");
            map.set(k, v);
        },
        removeItem: (k: string) => void map.delete(k),
    };
}

describe("createSessionCache", () => {
    it("round-trips the data, the timestamp and the extras", () => {
        const storage = fakeStorage();
        const cache = createSessionCache<{ id: string }, { tags: string[] }>({
            dataKey: "d", timestampKey: "t", label: "x", storage: () => storage,
            extras: { key: "e", encode: (x) => (x.tags.length ? x.tags : null), decode: (raw) => ({ tags: Array.isArray(raw) ? (raw as string[]) : [] }) },
        }, { tags: [] });
        cache.write({ data: [{ id: "a" }], extras: { tags: ["t1"] } }, "2026-10-01T10:00:00.000Z");
        expect(cache.peekTimestamp()).toBe("2026-10-01T10:00:00.000Z");
        expect(cache.read()).toEqual({ data: [{ id: "a" }], extras: { tags: ["t1"] }, lastFetched: "2026-10-01T10:00:00.000Z" });
    });

    it("reads nothing when data or timestamp is missing, and clear removes every key", () => {
        const storage = fakeStorage();
        const cache = createSessionCache<{ id: string }, undefined>({ dataKey: "d", timestampKey: "t", label: "x", storage: () => storage }, undefined);
        expect(cache.read()).toBeNull();
        cache.write({ data: [{ id: "a" }], extras: undefined }, "ts");
        expect(cache.read()).not.toBeNull();
        cache.clear();
        expect(storage.map.size).toBe(0);
    });

    it("falls back to the minimal data when the full data does not fit", () => {
        const storage = fakeStorage(60);
        const cache = createSessionCache<{ id: string; big: string }, undefined>({
            dataKey: "d", timestampKey: "t", label: "x", storage: () => storage,
            minimal: (data) => data.map((i) => ({ id: i.id, big: "" })),
        }, undefined);
        cache.write({ data: [{ id: "a", big: "x".repeat(200) }], extras: undefined }, "ts");
        expect(cache.read()?.data).toEqual([{ id: "a", big: "" }]);
    });

    it("runs without a cache when even the minimal data does not fit, and without storage", () => {
        const full = fakeStorage(5);
        const cache = createSessionCache<{ id: string }, undefined>({
            dataKey: "d", timestampKey: "t", label: "x", storage: () => full, minimal: (d) => d,
        }, undefined);
        expect(() => cache.write({ data: [{ id: "aaaaaaaaaa" }], extras: undefined }, "ts")).not.toThrow();
        expect(cache.read()).toBeNull();

        const none = createSessionCache<{ id: string }, undefined>({ dataKey: "d", timestampKey: "t", label: "x", storage: () => null }, undefined);
        expect(none.read()).toBeNull();
        expect(none.peekTimestamp()).toBeNull();
        expect(() => none.write({ data: [], extras: undefined }, "ts")).not.toThrow();
    });

    describe("bound to an account (audit run 3)", () => {
        function owned(storage: ReturnType<typeof fakeStorage>, account: { current: string | null }) {
            return createSessionCache<{ id: string }, undefined>({
                dataKey: "d", timestampKey: "t", label: "x", storage: () => storage,
                owner: { key: "o", current: () => account.current },
            }, undefined);
        }

        it("writes the owner next to the data and reads it back for the same account", () => {
            const storage = fakeStorage();
            const cache = owned(storage, { current: "aaaa1111" });
            cache.write({ data: [{ id: "a" }], extras: undefined }, "2026-10-01T10:00:00.000Z");
            expect(storage.map.get("o")).toBe("aaaa1111");
            expect(cache.peekTimestamp()).toBe("2026-10-01T10:00:00.000Z");
            expect(cache.read()?.data).toEqual([{ id: "a" }]);
        });

        it("refuses and removes a cache of another account, also for the timestamp load looks at", () => {
            const storage = fakeStorage();
            const account = { current: "aaaa1111" as string | null };
            const cache = owned(storage, account);
            cache.write({ data: [{ id: "a" }], extras: undefined }, "2026-10-01T10:00:00.000Z");
            account.current = "bbbb2222";
            expect(cache.peekTimestamp()).toBeNull();
            expect(cache.read()).toBeNull();
            expect([...storage.map.keys()]).toEqual([]);
        });

        it("refuses a cache written before the binding, and reads or writes nothing without an account", () => {
            const storage = fakeStorage();
            storage.setItem("d", JSON.stringify([{ id: "old" }]));
            storage.setItem("t", "2026-10-01T10:00:00.000Z");
            const account = { current: null as string | null };
            const cache = owned(storage, account);
            expect(cache.read()).toBeNull();
            cache.write({ data: [{ id: "a" }], extras: undefined }, "ts");
            expect(storage.map.get("d")).toBe(JSON.stringify([{ id: "old" }]));
            account.current = "aaaa1111";
            expect(cache.peekTimestamp()).toBeNull();
            expect(cache.read()).toBeNull();
            expect(storage.map.has("d")).toBe(false);
        });

        it("clear removes the owner too", () => {
            const storage = fakeStorage();
            const cache = owned(storage, { current: "aaaa1111" });
            cache.write({ data: [{ id: "a" }], extras: undefined }, "ts");
            cache.clear();
            expect([...storage.map.keys()]).toEqual([]);
        });
    });
});
