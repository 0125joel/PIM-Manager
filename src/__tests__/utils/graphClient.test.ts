import { describe, expect, it } from "vitest";
import type { Context } from "@microsoft/microsoft-graph-client";
import { RateLimiter } from "@/utils/rateLimiter";
import { parseRetryAfterMs, ThrottleWatcher } from "@/utils/graphClient";

class SpyLimiter extends RateLimiter {
    pauses: number[] = [];
    override backOff(ms: number): void {
        this.pauses.push(ms);
    }
}

const respond = (status: number, headers: Record<string, string> = {}): Context => ({ request: "https://graph.microsoft.com/v1.0/x", response: new Response(null, { status, headers }) });

async function run(watcher: ThrottleWatcher, context: Context): Promise<void> {
    watcher.setNext({ execute: async () => undefined });
    await watcher.execute(context);
}

describe("ThrottleWatcher", () => {
    it("pauses the limiter for the Retry-After of a 429", async () => {
        const limiter = new SpyLimiter();
        await run(new ThrottleWatcher(limiter), respond(429, { "Retry-After": "10" }));
        expect(limiter.pauses).toEqual([10000]);
    });

    it("pauses ten seconds when a 429 has no usable header", async () => {
        const limiter = new SpyLimiter();
        await run(new ThrottleWatcher(limiter), respond(429));
        expect(limiter.pauses).toEqual([10000]);
    });

    it("leaves other answers alone", async () => {
        const limiter = new SpyLimiter();
        await run(new ThrottleWatcher(limiter), respond(200));
        await run(new ThrottleWatcher(limiter), respond(500));
        expect(limiter.pauses).toEqual([]);
    });
});

describe("parseRetryAfterMs", () => {
    it("reads seconds and dates, caps at a minute", () => {
        expect(parseRetryAfterMs("3")).toBe(3000);
        expect(parseRetryAfterMs("600")).toBe(60000);
        expect(parseRetryAfterMs(new Date(5000).toUTCString(), 2000)).toBe(3000);
        expect(parseRetryAfterMs("nonsense")).toBeNull();
        expect(parseRetryAfterMs(null)).toBeNull();
    });
});
