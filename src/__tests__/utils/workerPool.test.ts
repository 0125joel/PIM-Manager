import { describe, expect, it } from "vitest";
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
