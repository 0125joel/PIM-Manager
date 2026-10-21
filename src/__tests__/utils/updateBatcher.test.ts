import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdateBatcher } from "@/utils/updateBatcher";

describe("createUpdateBatcher", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("commits many updaters as one, in order", () => {
        const commit = vi.fn();
        const batcher = createUpdateBatcher<number[]>(commit, 250);
        for (let i = 0; i < 100; i++) batcher.push((s) => [...s, i]);
        expect(commit).not.toHaveBeenCalled();
        vi.advanceTimersByTime(250);
        expect(commit).toHaveBeenCalledTimes(1);
        const result = commit.mock.calls[0][0]([]);
        expect(result).toHaveLength(100);
        expect(result[0]).toBe(0);
        expect(result[99]).toBe(99);
    });

    it("flush applies the queue at once and stops the timer", () => {
        const commit = vi.fn();
        const batcher = createUpdateBatcher<number>(commit, 250);
        batcher.push((s) => s + 1);
        batcher.flush();
        expect(commit).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it("flush with an empty queue commits nothing", () => {
        const commit = vi.fn();
        createUpdateBatcher<number>(commit, 250).flush();
        expect(commit).not.toHaveBeenCalled();
    });

    it("starts a new window after a commit", () => {
        const commit = vi.fn();
        const batcher = createUpdateBatcher<number>(commit, 250);
        batcher.push((s) => s + 1);
        vi.advanceTimersByTime(250);
        batcher.push((s) => s + 1);
        vi.advanceTimersByTime(250);
        expect(commit).toHaveBeenCalledTimes(2);
    });

    it("cancel drops what is queued", () => {
        const commit = vi.fn();
        const batcher = createUpdateBatcher<number>(commit, 250);
        batcher.push((s) => s + 1);
        batcher.cancel();
        vi.advanceTimersByTime(1000);
        expect(commit).not.toHaveBeenCalled();
    });
});
