import { afterEach, describe, expect, it, vi } from "vitest";
import { ARM_MAX_PAGES, ArmError } from "@/utils/armClient";
import { armRateLimiter, graphRateLimiter, RateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";

class SpyLimiter extends RateLimiter {
    acquires: number[] = [];
    backOffs: number[] = [];
    override async acquire(cost: number = 1): Promise<void> {
        this.acquires.push(cost);
    }
    override backOff(ms: number): void {
        this.backOffs.push(ms);
    }
}

const SUB = "/subscriptions/00000000-0000-0000-0000-000000000001";
const INSTANCES = `${SUB}/providers/Microsoft.Authorization/roleEligibilityScheduleInstances`;

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("armClient: requests", () => {
    it("sends a GET to the ARM base with bearer token, api-version and encoded query", async () => {
        const arm = createRecordingArmClient([{ match: /roleEligibilityScheduleInstances$/, respond: () => ({ body: { value: [] } }) }]);
        await arm.client.get(INSTANCES, "2020-10-01", { $filter: "asTarget()" });
        expect(arm.requests).toHaveLength(1);
        const [request] = arm.requests;
        expect(request.url).toBe(`https://management.azure.com${INSTANCES}?api-version=2020-10-01&$filter=asTarget()`);
        expect(request.method).toBe("GET");
        expect(request.apiVersion).toBe("2020-10-01");
        expect(request.query).toEqual({ $filter: "asTarget()" });
        expect(request.headers.Authorization).toBe("Bearer test-token");
    });

    it("encodes spaces and quotes in query values", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ body: {} }) }]);
        await arm.client.get(INSTANCES, "2020-10-01", { $filter: "principalId eq 'abc'" });
        expect(arm.requests[0].url).toContain("$filter=principalId%20eq%20'abc'");
        expect(arm.requests[0].query.$filter).toBe("principalId eq 'abc'");
    });

    it("rejects a path without a leading slash and sends nothing", async () => {
        const arm = createRecordingArmClient();
        await expect(arm.client.get("subscriptions", "2022-12-01")).rejects.toThrow(/must start with/);
        expect(arm.requests).toHaveLength(0);
    });

    it("acquires 1 from the limiter for every request, pages included", async () => {
        const limiter = new SpyLimiter();
        const arm = createRecordingArmClient([], { limiter });
        arm.on({ match: () => true, respond: (r) => ({ body: { value: [1], nextLink: r.query.$skipToken ? null : `https://management.azure.com${INSTANCES}?api-version=2020-10-01&$skipToken=x` } }) });
        await arm.client.getAll(INSTANCES, "2020-10-01");
        expect(limiter.acquires).toEqual([1, 1]);
    });

    it("uses armRateLimiter by default, a limiter of 200 per window, not the Graph limiter", () => {
        expect(armRateLimiter).not.toBe(graphRateLimiter);
        expect(armRateLimiter.getCurrentUsage().capacity).toBe(200);
    });
});

describe("armClient: getAll and nextLink", () => {
    it("follows nextLink until it is absent and returns every item", async () => {
        const next = (token: string) => `https://management.azure.com${INSTANCES}?api-version=2020-10-01&$skipToken=${token}`;
        const pages: Record<string, { value: string[]; nextLink?: string }> = {
            "": { value: ["a", "b"], nextLink: next("p2") },
            p2: { value: ["c"], nextLink: next("p3") },
            p3: { value: ["d"] },
        };
        const arm = createRecordingArmClient([{ match: () => true, respond: (r) => ({ body: pages[r.query.$skipToken ?? ""] }) }]);
        await expect(arm.client.getAll<string>(INSTANCES, "2020-10-01")).resolves.toEqual(["a", "b", "c", "d"]);
        expect(arm.requests.map((r) => r.query.$skipToken ?? "")).toEqual(["", "p2", "p3"]);
        expect(arm.requests.every((r) => r.apiVersion === "2020-10-01")).toBe(true);
    });

    it("treats a null nextLink and a missing value as the end of the list", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ body: { nextLink: null } }) }]);
        await expect(arm.client.getAll(INSTANCES, "2020-10-01")).resolves.toEqual([]);
        expect(arm.requests).toHaveLength(1);
    });

    it(`fails after ${ARM_MAX_PAGES} pages instead of returning a partial list`, async () => {
        const arm = createRecordingArmClient([{
            match: () => true,
            respond: () => ({ body: { value: [1], nextLink: `https://management.azure.com${INSTANCES}?api-version=2020-10-01&$skipToken=more` } }),
        }]);
        await expect(arm.client.getAll(INSTANCES, "2020-10-01")).rejects.toThrow(/more than 50 pages/);
        expect(arm.requests).toHaveLength(ARM_MAX_PAGES);
    });

    it("never sends the token to a nextLink outside management.azure.com", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ body: { value: [1], nextLink: "https://example.com/steal?x=1" } }) }]);
        await expect(arm.client.getAll(INSTANCES, "2020-10-01")).rejects.toThrow(/leaves https:\/\/management\.azure\.com/);
        expect(arm.requests).toHaveLength(1);
    });
});

describe("armClient: errors", () => {
    it("throws ArmError with status, code and message from the envelope, and the headers", async () => {
        const arm = createRecordingArmClient([{
            match: () => true,
            respond: () => armError(403, "AuthorizationFailed", "The client does not have authorization", { "x-ms-request-id": "r1" }),
        }]);
        const error = await arm.client.get(SUB, "2022-12-01").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ArmError);
        const armErr = error as ArmError;
        expect(armErr.statusCode).toBe(403);
        expect(armErr.code).toBe("AuthorizationFailed");
        expect(armErr.message).toBe("The client does not have authorization");
        expect(armErr.headers.get("x-ms-request-id")).toBe("r1");
    });

    it("keeps a status-based message when the body is not the envelope", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ status: 502, body: "Bad gateway" }) }]);
        const error = (await arm.client.get(SUB, "2022-12-01").catch((e: unknown) => e)) as ArmError;
        expect(error.statusCode).toBe(502);
        expect(error.code).toBe("Unknown");
        expect(error.message).toBe("ARM request failed with HTTP 502");
    });

    it("answers an unknown path with a 404 from the recording client, never the network", async () => {
        const arm = createRecordingArmClient();
        const error = (await arm.client.get(SUB, "2022-12-01").catch((e: unknown) => e)) as ArmError;
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe("NotFound");
    });
});

describe("armClient: 429", () => {
    it("pauses the limiter for the Retry-After when the browser can read it", async () => {
        const limiter = new SpyLimiter();
        const arm = createRecordingArmClient([{ match: () => true, respond: () => armError(429, "TooManyRequests", "slow down", { "Retry-After": "7" }) }], { limiter });
        await expect(arm.client.get(SUB, "2022-12-01")).rejects.toMatchObject({ statusCode: 429 });
        expect(limiter.backOffs).toEqual([7000]);
    });

    it("pauses the limiter for 10 seconds when Retry-After is not readable", async () => {
        const limiter = new SpyLimiter();
        const arm = createRecordingArmClient([{ match: () => true, respond: () => armError(429, "TooManyRequests") }], { limiter });
        await expect(arm.client.get(SUB, "2022-12-01")).rejects.toMatchObject({ statusCode: 429 });
        expect(limiter.backOffs).toEqual([10_000]);
    });

    it("does not pause on other errors", async () => {
        const limiter = new SpyLimiter();
        const arm = createRecordingArmClient([{ match: () => true, respond: () => armError(503, "ServiceUnavailable") }], { limiter });
        await expect(arm.client.get(SUB, "2022-12-01")).rejects.toMatchObject({ statusCode: 503 });
        expect(limiter.backOffs).toEqual([]);
    });

    it("retries through withRetry with the ARM limiter and leaves the Graph limiter alone", async () => {
        vi.useFakeTimers();
        const limiter = new SpyLimiter();
        const graphBackOff = vi.spyOn(graphRateLimiter, "backOff");
        const arm = createRecordingArmClient([], { limiter });
        let calls = 0;
        arm.on({ match: () => true, respond: () => (++calls === 1 ? armError(429, "TooManyRequests", "slow", { "Retry-After": "2" }) : { body: { id: SUB } }) });
        const result = withRetry(() => arm.client.get<{ id: string }>(SUB, "2022-12-01"), 3, 1000, "arm", limiter);
        await vi.runAllTimersAsync();
        await expect(result).resolves.toEqual({ id: SUB });
        expect(arm.requests).toHaveLength(2);
        expect(limiter.backOffs).toEqual([2000, 2000]);
        expect(graphBackOff).not.toHaveBeenCalled();
    });
});
