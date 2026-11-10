import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "@/utils/rateLimiter";

/** The 429 pause as a page sees it: until when it lasts, and a call when it starts or grows (Azure spec 7) */
describe("RateLimiter backOff", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("has nothing to wait for before a 429", () => {
        expect(new RateLimiter(10, 1000).getBlockedUntil()).toBeLessThanOrEqual(Date.now());
    });

    it("waits until now plus the pause, and a shorter later pause does not shorten it", () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
        const limiter = new RateLimiter(10, 1000);
        limiter.backOff(10_000);
        expect(limiter.getBlockedUntil()).toBe(1_010_000);
        limiter.backOff(2_000);
        expect(limiter.getBlockedUntil()).toBe(1_010_000);
    });

    it("tells every listener on each backOff, until it unsubscribes", () => {
        const limiter = new RateLimiter(10, 1000);
        const first = vi.fn();
        const second = vi.fn();
        const stopFirst = limiter.subscribe(first);
        limiter.subscribe(second);
        limiter.backOff(100);
        stopFirst();
        limiter.backOff(100);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
    });
});
