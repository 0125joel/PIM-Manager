import { describe, expect, it } from "vitest";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { createArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";
import { readAzureAudit, type AzureAuditRawRead } from "@/services/azureAuditService";

/**
 * AU-22: the Activity Log, the request lists and the user's own requests are read together. Fake reads that answer after different
 * delays, in different orders, give the same result as one after the other; nothing reaches ARM.
 */

const FROM = "2026-08-09T00:00:00.000Z";
const TO = "2026-11-07T00:00:00.000Z";
const AUTH_OP = "Microsoft.Authorization/roleAssignments/write";
const GROUP = "/subscriptions/s-3/resourceGroups/rg-1";

const logRow = (id: string) => ({ eventDataId: id, operationName: { value: AUTH_OP } });
const requestRow = (name: string, scope: string) => ({ id: `/x/${name}`, name, properties: { principalId: "u-1", scope } });
type Kind = "log" | "own" | "request" | "other";

interface Request {
    path: string;
    filter: string | null;
    kind: Kind;
}

interface Answer {
    status?: number;
    body: unknown;
}

const kindOf = (path: string, filter: string | null): Kind => {
    if (path.endsWith("/eventtypes/management/values")) return "log";
    if (path.endsWith("ScheduleRequests") && filter === "asTarget()") return "own";
    if (path.endsWith("ScheduleRequests")) return "request";
    return "other";
};

/** The fixture: s-1 read, s-2 forbidden for the log and the requests, s-3 refused and read below its resource group */
function answerOf(request: Request): Answer {
    const { path, kind } = request;
    const value = (rows: unknown[]) => ({ body: { value: rows } });
    const forbidden = { status: 403, body: { error: { code: "AuthorizationFailed", message: "no" } } };
    if (kind === "log") {
        if (path.startsWith("/subscriptions/s-2/")) return forbidden;
        if (path.startsWith("/subscriptions/s-1/")) return value([logRow("e1"), logRow("e2")]);
        return value([]);
    }
    if (kind === "own") return value([requestRow("r-1", "/subscriptions/s-1"), requestRow("R-1", "/subscriptions/s-1"), requestRow("own-1", "/subscriptions/s-9/resourceGroups/hidden")]);
    if (kind === "request") {
        if (path.startsWith("/subscriptions/s-2/")) return forbidden;
        if (path.startsWith("/subscriptions/s-3/providers")) return { status: 400, body: { error: { code: "InsufficientPermissions", message: "no" } } };
        if (path.startsWith(GROUP)) return value([requestRow("below-1", GROUP)]);
        if (path.startsWith("/subscriptions/s-1/")) return value([requestRow("r-1", "/subscriptions/s-1")]);
        return value([]);
    }
    if (path === "/subscriptions/s-3/resourcegroups") return value([{ id: GROUP, name: "rg-1", type: "x" }]);
    return value([]);
}

interface Harness {
    timeline: string[];
    run: (extra?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }) => Promise<AzureAuditRawRead>;
}

/** `delay` gives the wait of each request in ms; `answer` replaces the fixture answers */
function harness(delay: (kind: Kind) => number, answer: (request: Request) => Answer = answerOf): Harness {
    const timeline: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const filter = url.searchParams.get("$filter");
        const request: Request = { path: url.pathname, filter, kind: kindOf(url.pathname, filter) };
        timeline.push(`start ${request.kind}`);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay(request.kind));
            init?.signal?.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
        });
        timeline.push(`end ${request.kind}`);
        const given = answer(request);
        return new Response(JSON.stringify(given.body), { status: given.status ?? 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const client = createArmClient(async () => "t", { fetchImpl: fakeFetch, limiter: new RateLimiter(1000, 10_000) });
    const logClient = createArmClient(async () => "t", { fetchImpl: fakeFetch, limiter: new RateLimiter(1000, 10_000) });
    return {
        timeline,
        run: (extra = {}) => readAzureAudit({
            client,
            logClient,
            plan: { subscriptionIds: ["s-1", "s-2", "s-3"], refusedSubscriptionIds: [], managementGroupIds: [] },
            from: FROM,
            to: TO,
            ...extra,
        }),
    };
}

/** What the page can see of a read, sorted where the order is not part of the result */
const view = (raw: AzureAuditRawRead) => ({
    activity: raw.activity.map((row) => row.eventDataId).sort(),
    assignments: raw.assignmentRequests.map((row) => row.name).sort(),
    eligibilities: raw.eligibilityRequests.map((row) => row.name).sort(),
    notRead: [...raw.notRead].sort((a, b) => `${a.part}${a.scopeId}`.localeCompare(`${b.part}${b.scopeId}`)),
    tried: raw.tried,
    ownRequestCount: raw.ownRequestCount,
});

describe("readAzureAudit: the reads run together", () => {
    it("starts the log, the request lists and the own requests before any of them finishes", async () => {
        const { timeline, run } = harness(() => 20);
        await run();
        const firstEnd = timeline.findIndex((entry) => entry.startsWith("end"));
        const before = timeline.slice(0, firstEnd);
        for (const kind of ["log", "request", "own"]) expect(before).toContain(`start ${kind}`);
    });

    it("gives the same result whatever the order in which the reads answer", async () => {
        const orders: Array<(kind: Kind) => number> = [
            (kind) => ({ log: 5, request: 40, own: 20, other: 5 })[kind],
            (kind) => ({ log: 40, request: 5, own: 5, other: 5 })[kind],
            (kind) => ({ log: 20, request: 20, own: 50, other: 5 })[kind],
        ];
        const results = [];
        for (const delay of orders) results.push(view(await harness(delay).run()));
        expect(results[1]).toEqual(results[0]);
        expect(results[2]).toEqual(results[0]);
        // s-1 and the group below the refused s-3 are read; s-2 is forbidden for both; the own request already read is dropped
        expect(results[0]).toEqual({
            activity: ["e1", "e2"],
            assignments: ["below-1", "own-1", "r-1"],
            eligibilities: ["below-1", "own-1", "r-1"],
            notRead: [
                { part: "log", scopeId: "/subscriptions/s-2", reason: "forbidden" },
                { part: "requests", scopeId: "/subscriptions/s-2", reason: "forbidden" },
            ],
            tried: 7,
            ownRequestCount: 2,
        });
    });

    it("keeps each own request once per list when it is already in a scope list or comes twice", async () => {
        const raw = await harness(() => 5).run();
        // r-1 (the scope-list copy; the own answer's "r-1" and "R-1" are dropped), own-1 and below-1, in both lists
        expect(raw.assignmentRequests).toHaveLength(3);
        expect(raw.eligibilityRequests).toHaveLength(3);
    });

    it("counts progress over all pools: the total is the same and the count never goes down", async () => {
        const steps: Array<[number, number]> = [];
        const { run } = harness((kind) => ({ log: 30, request: 10, own: 5, other: 5 })[kind]);
        await run({ onProgress: (done, total) => steps.push([done, total]) });
        const dones = steps.map(([done]) => done);
        expect([...dones].sort((a, b) => a - b)).toEqual(dones);
        // 4 log reads (3 subscriptions and the tenant) + 3 request scopes, then 1 group below the refused subscription
        expect(steps[0]).toEqual([0, 7]);
        expect(steps.at(-1)).toEqual([8, 8]);
        expect(new Set(steps.slice(0, -1).map(([, total]) => total)).size).toBeLessThanOrEqual(2);
    });

    it("throws the too-many error after the running reads ended, whichever read hit it", async () => {
        const rows = Array.from({ length: 50_001 }, (_, i) => logRow(`x${i}`));
        for (const delay of [(kind: Kind) => (kind === "log" ? 5 : 30), (kind: Kind) => (kind === "log" ? 30 : 5)]) {
            const { timeline, run } = harness(delay, (request) => (request.kind === "log" && request.path.startsWith("/subscriptions/s-1/") ? { body: { value: rows } } : answerOf(request)));
            await expect(run()).rejects.toBeInstanceOf(AuditTooManyEventsError);
            // Every read that started was either finished or aborted before the error came back
            const settled = timeline.filter((entry) => entry.startsWith("end")).length;
            expect(settled).toBeLessThanOrEqual(timeline.filter((entry) => entry.startsWith("start")).length);
        }
    });

    it("a read that fails with another error ends the whole read with that error", async () => {
        const { run } = harness(() => 5, (request) => (request.kind === "request" && request.path.startsWith("/subscriptions/s-1/") ? { status: 400, body: { error: { code: "BadRequest", message: "x" } } } : answerOf(request)));
        await expect(run()).rejects.toMatchObject({ statusCode: 400, code: "BadRequest" });
    });

    it("leaves the own requests out without failing the page when their read fails", async () => {
        const { run } = harness(() => 5, (request) => (request.kind === "own" ? { status: 403, body: { error: { code: "AuthorizationFailed", message: "x" } } } : answerOf(request)));
        const raw = await run();
        expect(raw.ownRequestCount).toBe(0);
        expect(view(raw).assignments).toEqual(["below-1", "r-1"]);
    });

    it("stops with an AbortError when the signal aborts halfway", async () => {
        const controller = new AbortController();
        const { run } = harness(() => 30);
        const outcome = expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        setTimeout(() => controller.abort(), 10);
        await outcome;
    });
});
