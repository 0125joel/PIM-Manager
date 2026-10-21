import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReliablePool } from "@/services/pimGroupService";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const base = { workerCount: 2, delayMs: 0, cost: 1, noun: "groups" };

describe("runReliablePool", () => {
    it("returns every answer, and null is an answer", async () => {
        const result = await runReliablePool<string>({ ...base, ids: ["a", "b"], processor: async (id) => (id === "a" ? "A" : null) });
        expect([...result.entries()]).toEqual([["a", "A"]]);
    });

    it("asks again for what failed and keeps the result when the second pass works", async () => {
        const calls: Record<string, number> = {};
        const promise = runReliablePool<string>({
            ...base,
            ids: ["a", "b"],
            processor: async (id) => {
                calls[id] = (calls[id] ?? 0) + 1;
                if (id === "b" && calls[id] === 1) throw new Error("throttled");
                return id.toUpperCase();
            },
        });
        await vi.advanceTimersByTimeAsync(10000);
        const result = await promise;
        expect([...result.keys()].sort()).toEqual(["a", "b"]);
        expect(calls.b).toBe(2);
    });

    it("fails the whole load, with the count, when a group keeps failing", async () => {
        const promise = runReliablePool<string>({ ...base, ids: ["a", "b", "c"], processor: async (id) => { if (id === "c") throw new Error("boom"); return id; } });
        const assertion = expect(promise).rejects.toThrow(/1 of 3 groups could not be loaded after retrying/);
        await vi.advanceTimersByTimeAsync(20000);
        await assertion;
    });
});
