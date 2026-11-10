import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphRateLimiter, RateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";

class SpyLimiter extends RateLimiter {
    backOffs: number[] = [];
    override backOff(ms: number): void {
        this.backOffs.push(ms);
    }
}

/** A 429 the way the Graph SDK throws it, with an optional Retry-After */
function throttled(retryAfter?: string): Error & { statusCode: number; headers: Record<string, string> } {
    const headers: Record<string, string> = retryAfter ? { "Retry-After": retryAfter } : {};
    return Object.assign(new Error("throttled"), { statusCode: 429, headers });
}

/** Fails once with the given error, then succeeds */
function failOnce(error: unknown): () => Promise<string> {
    let calls = 0;
    return async () => {
        calls++;
        if (calls === 1) throw error;
        return "ok";
    };
}

describe("withRetry and the limiter", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("pauses a passed limiter after a 429, not the Graph limiter", async () => {
        const limiter = new SpyLimiter();
        const graphBackOff = vi.spyOn(graphRateLimiter, "backOff");
        const result = withRetry(failOnce(throttled("2")), 3, 1000, "arm", limiter);
        await vi.runAllTimersAsync();
        await expect(result).resolves.toBe("ok");
        expect(limiter.backOffs).toEqual([2000]);
        expect(graphBackOff).not.toHaveBeenCalled();
    });

    it("pauses the Graph limiter when no limiter is passed", async () => {
        const graphBackOff = vi.spyOn(graphRateLimiter, "backOff").mockImplementation(() => {});
        const result = withRetry(failOnce(throttled()), 3, 1000, "graph");
        await vi.runAllTimersAsync();
        await expect(result).resolves.toBe("ok");
        expect(graphBackOff).toHaveBeenCalledWith(1000);
    });

    it("does not pause any limiter on a 5xx", async () => {
        const limiter = new SpyLimiter();
        const result = withRetry(failOnce(Object.assign(new Error("down"), { statusCode: 503 })), 3, 1000, "arm", limiter);
        await vi.runAllTimersAsync();
        await expect(result).resolves.toBe("ok");
        expect(limiter.backOffs).toEqual([]);
    });
});
