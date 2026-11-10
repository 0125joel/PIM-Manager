import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@/utils/logger";
import { RateLimiter } from "@/utils/rateLimiter";
import { runWorkerPool } from "@/utils/workerPool";

class SpyLimiter extends RateLimiter {
    costs: number[] = [];
    backOffs: number[] = [];
    override async acquire(cost = 1): Promise<void> {
        this.costs.push(cost);
    }
    override backOff(ms: number): void {
        this.backOffs.push(ms);
    }
}

describe("runWorkerPool costs", () => {
    it("asks the limiter for the cost of every item", async () => {
        const limiter = new SpyLimiter();
        await runWorkerPool({ items: ["a", "bb", "ccc"], workerCount: 1, delayMs: 0, rateLimiter: limiter, costPerItem: (item) => item.length, processor: async (item) => item });
        expect(limiter.costs).toEqual([1, 2, 3]);
    });

    it("defaults to 1 and takes a fixed number", async () => {
        const limiter = new SpyLimiter();
        await runWorkerPool({ items: [1, 2], workerCount: 1, delayMs: 0, rateLimiter: limiter, processor: async (n) => n });
        expect(limiter.costs).toEqual([1, 1]);
        const fixed = new SpyLimiter();
        await runWorkerPool({ items: [1, 2], workerCount: 1, delayMs: 0, rateLimiter: fixed, costPerItem: 5, processor: async (n) => n });
        expect(fixed.costs).toEqual([5, 5]);
    });

    it("a retry after a 429 pays again and tells every worker to wait", async () => {
        const limiter = new SpyLimiter();
        let calls = 0;
        const result = await runWorkerPool({
            items: ["x"],
            workerCount: 1,
            delayMs: 0,
            maxRetries: 1,
            rateLimiter: limiter,
            costPerItem: 2,
            processor: async (item) => {
                calls += 1;
                if (calls === 1) throw Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
                return item;
            },
        });
        expect(result.succeeded).toBe(1);
        expect(limiter.costs).toEqual([2, 2]);
        expect(limiter.backOffs).toEqual([2000]);
    }, 10000);
});

describe("RateLimiter backOff", () => {
    it("holds every acquire until the back off is over", async () => {
        const limiter = new RateLimiter(100, 10_000);
        limiter.backOff(300);
        const start = Date.now();
        await limiter.acquire(1);
        expect(Date.now() - start).toBeGreaterThanOrEqual(250);
    });
});

describe("runWorkerPool errorLog", () => {
    afterEach(() => vi.restoreAllMocks());

    const failing = async () => {
        throw Object.assign(new Error("The client 'admin@contoso.com' with object id 'abc' does not have authorization over scope '/subscriptions/x'"), { statusCode: 403, code: "AuthorizationFailed" });
    };

    it("logs the message by default", async () => {
        const spy = vi.spyOn(Logger, "error").mockImplementation(() => {});
        await runWorkerPool({ items: ["a"], workerCount: 1, delayMs: 0, processor: failing });
        expect(spy).toHaveBeenCalledWith("WorkerPool", expect.stringContaining("admin@contoso.com"));
    });

    it("logs only status and code when asked, and still hands the message to onItemError", async () => {
        const spy = vi.spyOn(Logger, "error").mockImplementation(() => {});
        const errors: string[] = [];
        const result = await runWorkerPool({ items: ["a"], workerCount: 1, delayMs: 0, errorLog: "statusAndCode", processor: failing, onItemError: (_item, error) => errors.push(error) });
        expect(result.failed).toBe(1);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][1]).toBe("Worker 1 failed for item: status 403, code AuthorizationFailed");
        expect(errors[0]).toContain("admin@contoso.com");
    });

    it("says unknown for an error without status or code", async () => {
        const spy = vi.spyOn(Logger, "error").mockImplementation(() => {});
        await runWorkerPool({ items: ["a"], workerCount: 1, delayMs: 0, errorLog: "statusAndCode", processor: async () => { throw new Error("secret detail"); } });
        expect(spy.mock.calls[0][1]).toBe("Worker 1 failed for item: status unknown, code unknown");
    });
});
