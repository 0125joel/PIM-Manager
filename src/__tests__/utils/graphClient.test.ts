import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@microsoft/microsoft-graph-client";
import { RateLimiter } from "@/utils/rateLimiter";
import { createGraphClient, parseRetryAfterMs, retryOnlyReads, ThrottleWatcher } from "@/utils/graphClient";

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

describe("retryOnlyReads", () => {
    it("retries GET requests", () => {
        expect(retryOnlyReads(0, 1, new Request("https://graph.microsoft.com/v1.0/x"), {}, new Response())).toBe(true);
        expect(retryOnlyReads(0, 1, "https://graph.microsoft.com/v1.0/x", undefined, new Response())).toBe(true);
    });

    it("never retries writes", () => {
        expect(retryOnlyReads(0, 1, new Request("https://graph.microsoft.com/v1.0/x", { method: "POST" }), {}, new Response())).toBe(false);
        expect(retryOnlyReads(0, 1, "https://graph.microsoft.com/v1.0/x", { method: "PATCH" }, new Response())).toBe(false);
    });
});

describe("createGraphClient", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends a write once when the service answers 503", async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: "ServiceUnavailable", message: "busy" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
        }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            createGraphClient("dummy").api("/roleManagement/directory/roleEligibilityScheduleRequests").post({ action: "adminAssign" })
        ).rejects.toBeDefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
