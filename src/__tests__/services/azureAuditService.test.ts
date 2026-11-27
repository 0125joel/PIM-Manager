import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { AZURE_READ_BELOW_BUDGET as REAL_BUDGET } from "@/utils/azureReadBelow";
import { createArmClient } from "@/utils/armClient";
import { activityLogRateLimiter, armRateLimiter, RateLimiter } from "@/utils/rateLimiter";
import { ACTIVITY_LOG_API_VERSION, MANAGEMENT_GROUP_LOG_API_VERSION, readAzureAudit, type AzureAuditReadInput } from "@/services/azureAuditService";
import { armError, createRecordingArmClient, type ArmResponder, type RecordingArmClient } from "../support/recordingArmClient";

const budget = vi.hoisted(() => ({ value: 1200 }));
vi.mock("@/utils/azureReadBelow", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/utils/azureReadBelow")>();
    return { ...original, get AZURE_READ_BELOW_BUDGET() { return budget.value; } };
});

const MG = "/providers/Microsoft.Management/managementGroups/mg-1";
const FROM = "2026-08-09T00:00:00.000Z";
const TO = "2026-11-07T00:00:00.000Z";
const WINDOW = `eventTimestamp ge '${FROM}' and eventTimestamp le '${TO}'`;
const AUTH_OP = "Microsoft.Authorization/roleAssignments/write";

const isLog = (path: string) => path.endsWith("/eventtypes/management/values");
const logRow = (id: string, op = AUTH_OP) => ({ eventDataId: id, operationName: { value: op }, httpRequest: { clientIpAddress: "203.0.113.9" }, claims: { name: "SECRET-NAME", appid: "a" } });
const requestRow = (name: string, scope?: string | null) => ({ id: `/x/${name}`, name, properties: { principalId: "u-1", condition: "SECRET", scope } });
const ok = (rows: unknown[]) => ({ body: { value: rows } });

function setup(plan: AzureAuditReadInput["plan"], session: ArmResponder[] = [], log: ArmResponder[] = [], limiter?: RateLimiter) {
    const client = createRecordingArmClient(session);
    const logClient = createRecordingArmClient(log, limiter ? { limiter } : {});
    const input: AzureAuditReadInput = { client: client.client, logClient: logClient.client, plan, from: FROM, to: TO };
    return { client, logClient, input };
}
const requestsOnly = (client: RecordingArmClient) => client.requests.map((r) => r.path);
const plan = (subs: string[], refused: string[] = [], groups: string[] = []) => ({ subscriptionIds: subs, refusedSubscriptionIds: refused, managementGroupIds: groups });

afterEach(() => {
    vi.useRealTimers();
    budget.value = REAL_BUDGET;
});

describe("readAzureAudit: the calls", () => {
    it("sends the golden URLs and filters of the four calls", async () => {
        const { client, logClient, input } = setup(plan(["s-1"], [], [MG]), [{ match: () => true, respond: () => ok([]) }], [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit(input);
        expect(result.tried).toBe(5);
        expect(logClient.requests.map((r) => [r.path, r.apiVersion, r.query.$filter])).toEqual([
            ["/subscriptions/s-1/providers/Microsoft.Insights/eventtypes/management/values", ACTIVITY_LOG_API_VERSION, `${WINDOW} and resourceProvider eq 'Microsoft.Authorization'`],
            [`${MG}/providers/Microsoft.Insights/eventtypes/management/values`, MANAGEMENT_GROUP_LOG_API_VERSION, WINDOW],
            ["/providers/Microsoft.Insights/eventtypes/management/values", ACTIVITY_LOG_API_VERSION, `${WINDOW} and resourceProvider eq 'Microsoft.Authorization'`],
        ]);
        expect(logClient.requests[1].query.$filter).not.toContain("resourceProvider");
        expect(requestsOnly(client).sort()).toEqual([
            `${MG}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests`,
            `${MG}/providers/Microsoft.Authorization/roleEligibilityScheduleRequests`,
            "/subscriptions/s-1/providers/Microsoft.Authorization/roleAssignmentScheduleRequests",
            "/subscriptions/s-1/providers/Microsoft.Authorization/roleEligibilityScheduleRequests",
            "/providers/Microsoft.Authorization/roleAssignmentScheduleRequests",
            "/providers/Microsoft.Authorization/roleEligibilityScheduleRequests",
        ].sort());
        expect(client.requests.every((r) => r.apiVersion === "2020-10-01")).toBe(true);
        // Only the root read of the user's own requests has a filter, and it is `asTarget()`
        expect(client.requests.filter((r) => r.query.$filter !== undefined).map((r) => [r.path, r.query.$filter])).toEqual([
            ["/providers/Microsoft.Authorization/roleAssignmentScheduleRequests", "asTarget()"],
            ["/providers/Microsoft.Authorization/roleEligibilityScheduleRequests", "asTarget()"],
        ]);
    });

    it("keeps only authorization rows of the management group and tenant answers, and drops the rest of every row", async () => {
        const rows = [logRow("e1"), logRow("e2", "Microsoft.Web/sites/write"), logRow("E3", "MICROSOFT.AUTHORIZATION/roleDefinitions/write")];
        const { input } = setup(plan([], [], [MG]), [{ match: () => true, respond: () => ok([requestRow("r1", MG)]) }], [{ match: isLogRoute, respond: () => ok(rows) }]);
        const result = await readAzureAudit(input);
        // The management group and the tenant answer overlap: one row per eventDataId
        expect(result.activity.map((r) => r.eventDataId)).toEqual(["e1", "E3"]);
        const text = JSON.stringify(result);
        for (const secret of ["httpRequest", "SECRET", "203.0.113"]) expect(text).not.toContain(secret);
        expect(result.assignmentRequests).toHaveLength(1);
    });

    it("drops request rows without a scope at a management group in both lists", async () => {
        const rows = [
            requestRow("management-group", MG),
            requestRow("subscription", "/subscriptions/s-1/resourceGroups/rg-1"),
            requestRow("missing"),
            requestRow("null", null),
            requestRow("empty", ""),
            requestRow("whitespace", " \t "),
        ];
        const counts: number[] = [];
        const { input } = setup(plan([], [], [MG]), [{ match: () => true, respond: () => ok(rows) }], [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit({ ...input, onRows: (total) => counts.push(total) });
        expect(result.assignmentRequests.map((row) => row.name)).toEqual(["management-group", "subscription"]);
        expect(result.eligibilityRequests.map((row) => row.name)).toEqual(["management-group", "subscription"]);
        // The own-request read runs next to the others and counts its rows (the same four) until the duplicates are dropped
        expect(Math.max(...counts)).toBe(8);
        expect(counts.at(-1)).toBe(4);
    });

    it("counts one acquire per log read: no second limiter count", async () => {
        const limiter = new RateLimiter(1000, 10_000);
        const acquire = vi.spyOn(limiter, "acquire");
        const { input } = setup(plan(["s-1", "s-2"]), [{ match: () => true, respond: () => ok([]) }], [{ match: () => true, respond: () => ok([]) }], limiter);
        await readAzureAudit(input);
        expect(acquire).toHaveBeenCalledTimes(3);
    });
});

function isLogRoute(request: { path: string }) {
    return isLog(request.path);
}

describe("readAzureAudit: reads that give nothing", () => {
    it("tells 400, 403 and 404 as not read with the reason, and is no failure", async () => {
        const { input } = setup(
            plan(["s-1"], [], [MG, `${MG}-2`]),
            [{ match: (r) => r.path.startsWith(MG + "/"), respond: () => armError(400, "InsufficientPermissions") }],
            [
                { match: isLogRoute, respond: () => ok([]) },
                { match: (r) => r.path.startsWith("/subscriptions/s-1/"), respond: () => armError(403, "AuthorizationFailed") },
                { match: (r) => r.path.startsWith(MG + "/"), respond: () => armError(404, "NotFound") },
            ],
        );
        const result = await readAzureAudit(input);
        expect(result.notRead).toEqual(expect.arrayContaining([
            { part: "log", scopeId: "/subscriptions/s-1", reason: "forbidden" },
            { part: "log", scopeId: MG, reason: "gone" },
            { part: "requests", scopeId: MG, reason: "refused" },
        ]));
        expect(result.tried).toBe(7);
    });

    it("throws on a 500 and returns nothing", async () => {
        vi.useFakeTimers();
        const { input } = setup(plan(["s-1"]), [{ match: () => true, respond: () => ok([]) }], [{ match: isLogRoute, respond: () => armError(500, "InternalError", "SECRET message") }]);
        const outcome = expect(readAzureAudit(input)).rejects.toMatchObject({ statusCode: 500 });
        await vi.runAllTimersAsync();
        await outcome;
    });
});

describe("readAzureAudit: limit, retry, abort", () => {
    it("stops at more rows than the limit and sends no further call", async () => {
        const rows = Array.from({ length: 50_001 }, (_, i) => logRow(`e${i}`));
        const { client, input } = setup(plan(["s-1"]), [{ match: () => true, respond: () => ok([]) }], [{ match: isLogRoute, respond: () => ok(rows) }]);
        await expect(readAzureAudit(input)).rejects.toBeInstanceOf(AuditTooManyEventsError);
        // The request lists and the own requests start with the log: those four calls were sent, and no further one
        expect(client.requests).toHaveLength(4);
    });

    it("does not count rows of a failed attempt twice", async () => {
        vi.useFakeTimers();
        const counts: number[] = [];
        let calls = 0;
        const next = "https://management.azure.com/subscriptions/s-1/providers/Microsoft.Insights/eventtypes/management/values?api-version=2015-04-01&$skiptoken=2";
        const { input } = setup(plan(["s-1"]), [], [
            { match: () => true, respond: () => ok([]) },
            {
                match: (r) => r.path.startsWith("/subscriptions/s-1/"),
                respond: (r) => {
                    if (r.query.$skiptoken) return ++calls === 2 ? armError(503, "Unavailable") : ok([logRow("e4"), logRow("e5")]);
                    calls++;
                    return { body: { value: [logRow("e1"), logRow("e2"), logRow("e3")], nextLink: next } };
                },
            },
        ]);
        const result = readAzureAudit({ ...input, onRows: (total) => counts.push(total) });
        await vi.runAllTimersAsync();
        expect((await result).activity.map((r) => r.eventDataId)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
        expect(Math.max(...counts)).toBe(5);
    });

    it("throws an abort error and sends nothing when the signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        const { client, logClient, input } = setup(plan(["s-1"]));
        await expect(readAzureAudit({ ...input, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(client.requests.length + logClient.requests.length).toBe(0);
    });
});

describe("readAzureAudit: below a refused subscription", () => {
    const GROUP = "/subscriptions/s-2/resourceGroups/rg-1";
    const session = (): ArmResponder[] => [
        { match: (r) => r.path === "/subscriptions/s-2/resourcegroups", respond: () => ok([{ id: GROUP, name: "rg-1", type: "x" }]) },
        { match: (r) => r.path === "/subscriptions/s-2/resources", respond: () => ok([]) },
        { match: (r) => r.path.startsWith(GROUP), respond: () => ok([requestRow("r1", GROUP)]) },
        { match: (r) => r.path.startsWith("/subscriptions/s-2/providers"), respond: () => armError(400, "InsufficientPermissions") },
    ];

    it("reads the requests at the readable scopes, and the log once at the subscription", async () => {
        const { client, logClient, input } = setup(plan(["s-2"], ["s-2"]), session(), [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit(input);
        expect(requestsOnly(client)).toEqual(expect.arrayContaining([`${GROUP}/providers/Microsoft.Authorization/roleAssignmentScheduleRequests`]));
        expect(requestsOnly(client).some((p) => p.startsWith("/subscriptions/s-2/providers"))).toBe(false);
        expect(result.assignmentRequests).toHaveLength(1);
        expect(result.notRead).toEqual([]);
        expect(logClient.requests.filter((r) => r.path.startsWith("/subscriptions/s-2/"))).toHaveLength(1);
    });

    it("drops the requests above the resource group, the subscription's own, which a reader of one group may not see", async () => {
        const above = [
            { match: (r: { path: string }) => r.path === "/subscriptions/s-2/resourcegroups", respond: () => ok([{ id: GROUP, name: "rg-1", type: "x" }]) },
            { match: (r: { path: string }) => r.path === "/subscriptions/s-2/resources", respond: () => ok([]) },
            { match: (r: { path: string }) => r.path.startsWith(GROUP), respond: () => ok([requestRow("in", GROUP), requestRow("above", "/subscriptions/s-2")]) },
            { match: (r: { path: string }) => r.path.startsWith("/subscriptions/s-2/providers"), respond: () => armError(400, "InsufficientPermissions") },
        ];
        const { input } = setup(plan(["s-2"], ["s-2"]), above, [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit(input);
        expect(result.assignmentRequests.map((r) => r.name)).toEqual(["in"]);
    });

    it("treats a subscription refused at the request as refused too", async () => {
        const { input } = setup(plan(["s-2"]), session(), [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit(input);
        expect(result.assignmentRequests).toHaveLength(1);
        expect(result.notRead).toEqual([]);
    });

    it("tells what the budget does not reach as not read with the reason budget", async () => {
        budget.value = 2;
        const { input } = setup(plan(["s-2"], ["s-2"]), session(), [{ match: () => true, respond: () => ok([]) }]);
        const result = await readAzureAudit(input);
        expect(result.notRead).toEqual([{ part: "requests", scopeId: GROUP, reason: "budget" }]);
    });
});

describe("readAzureAudit: every request counts once", () => {
    const GROUP = "/subscriptions/s-2/resourceGroups/rg-1";

    it("takes one unit of armRateLimiter per session request, pages and the below round included, and none from activityLogRateLimiter", async () => {
        // The last responder that matches wins, so the catch-all comes first
        const session: ArmResponder[] = [
            { match: () => true, respond: () => ok([]) },
            { match: (r) => r.path === "/subscriptions/s-2/resourcegroups", respond: () => ok([{ id: GROUP, name: "rg-1", type: "x" }]) },
            { match: (r) => r.path === "/subscriptions/s-2/resources", respond: () => ok([]) },
            { match: (r) => r.path.startsWith(GROUP), respond: () => ok([requestRow("r1", GROUP)]) },
            { match: (r) => r.path.startsWith("/subscriptions/s-2/providers"), respond: () => armError(400, "InsufficientPermissions") },
            // A second page at s-1: every page is a request and counts
            { match: (r) => r.path === "/subscriptions/s-1/providers/Microsoft.Authorization/roleAssignmentScheduleRequests" && !r.query.page, respond: () => ({ body: { value: [requestRow("p1", "/subscriptions/s-1")], nextLink: "https://management.azure.com/subscriptions/s-1/providers/Microsoft.Authorization/roleAssignmentScheduleRequests?api-version=2020-10-01&page=2" } }) },
        ];
        const sessionRecording = createRecordingArmClient(session);
        const logRecording = createRecordingArmClient([{ match: () => true, respond: () => ok([]) }]);
        // No `limiter` option on the session client: it counts on the real armRateLimiter, as in the app
        const client = createArmClient(async () => "t", { fetchImpl: sessionRecording.fetch });
        const logClient = createArmClient(async () => "t", { fetchImpl: logRecording.fetch, limiter: new RateLimiter(1000, 10_000) });
        // The spies let the limiters pass at once, so the test neither waits nor leaves entries in the shared windows
        const arm = vi.spyOn(armRateLimiter, "acquire").mockResolvedValue(undefined);
        const activity = vi.spyOn(activityLogRateLimiter, "acquire").mockResolvedValue(undefined);
        // `REAL_BUDGET` reads the mock live, so an earlier test that lowered the budget leaves it low: set it here, put it back after
        const budgetBefore = budget.value;
        budget.value = 1200;
        try {
            const result = await readAzureAudit({ client, logClient, plan: plan(["s-1", "s-2"], ["s-2"]), from: FROM, to: TO });
            expect(result.assignmentRequests.length).toBeGreaterThan(0);
            // The below round listed and read below s-2, and the second page was fetched
            expect(sessionRecording.requests.some((r) => r.path.startsWith(GROUP))).toBe(true);
            expect(sessionRecording.requests.some((r) => r.query.page === "2")).toBe(true);
            expect(sessionRecording.requests.length).toBeGreaterThan(0);
            expect(arm).toHaveBeenCalledTimes(sessionRecording.requests.length);
            for (const call of arm.mock.calls) expect(call[0]).toBe(1);
            // The log client counts on its own limiter (a private one here), never on the shared Activity Log one
            expect(activity).not.toHaveBeenCalled();
            expect(logRecording.requests.length).toBeGreaterThan(0);
        } finally {
            budget.value = budgetBefore;
            arm.mockRestore();
            activity.mockRestore();
        }
    });
});

describe("readAzureAudit: guards", () => {
    it("throws on a 400 with another code than InsufficientPermissions and returns nothing", async () => {
        const { input } = setup(plan(["s-1"]), [{ match: () => true, respond: () => armError(400, "BadRequest") }], [{ match: () => true, respond: () => ok([logRow("e1")]) }]);
        await expect(readAzureAudit(input)).rejects.toMatchObject({ statusCode: 400, code: "BadRequest" });
    });

    it("tells a scope not read when one list answers 200 with rows and the other 403, and keeps neither list's rows", async () => {
        const { input } = setup(
            plan(["s-1"]),
            [
                { match: (r) => r.path.endsWith("/roleAssignmentScheduleRequests"), respond: () => ok([requestRow("r1")]) },
                { match: (r) => r.path.endsWith("/roleEligibilityScheduleRequests"), respond: () => armError(403, "AuthorizationFailed") },
            ],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const result = await readAzureAudit(input);
        expect(result.notRead).toEqual([{ part: "requests", scopeId: "/subscriptions/s-1", reason: "forbidden" }]);
        expect(result.assignmentRequests).toEqual([]);
        expect(result.eligibilityRequests).toEqual([]);
    });

    it("does not let the pool count against activityLogRateLimiter", async () => {
        const shared = vi.spyOn(activityLogRateLimiter, "acquire");
        const own = new RateLimiter(1000, 10_000);
        const { input } = setup(plan(["s-1", "s-2"]), [{ match: () => true, respond: () => ok([]) }], [{ match: () => true, respond: () => ok([]) }], own);
        await readAzureAudit(input);
        expect(shared).not.toHaveBeenCalled();
        shared.mockRestore();
    });

    it("tells the refused subscriptions the budget cannot list as not read with the reason budget", async () => {
        vi.useFakeTimers();
        const ids = Array.from({ length: Math.floor(REAL_BUDGET / 2) + 20 }, (_, i) => `s-${i}`);
        const { input } = setup(
            plan(ids, ids),
            [{ match: (r) => r.path.endsWith("/resourcegroups") || r.path.endsWith("/resources"), respond: () => ok([]) }],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const outcome = readAzureAudit(input);
        await vi.runAllTimersAsync();
        const result = await outcome;
        const budgetEntries = result.notRead.filter((n) => n.reason === "budget");
        expect(budgetEntries).toEqual(ids.slice(-20).map((id) => ({ part: "requests", scopeId: `/subscriptions/${id}`, reason: "budget" })));
    }, 60_000);
});

describe("readAzureAudit: the user's own requests (asTarget)", () => {
    const SUB_GROUP = "/subscriptions/s-1/resourceGroups/rg-1";
    const OTHER = "/subscriptions/s-9/resourceGroups/rg-hidden";
    const isOwnRead = (r: { path: string; query: Record<string, string> }) => r.path.startsWith("/providers/Microsoft.Authorization/") && r.query.$filter === "asTarget()";
    const scoped = (rows: unknown[]): ArmResponder => ({ match: (r) => r.path.startsWith("/subscriptions/s-1/"), respond: () => ok(rows) });

    it("adds a request that only the asTarget() answer holds, once", async () => {
        const { input } = setup(
            plan(["s-1"]),
            [
                scoped([]),
                { match: isOwnRead, respond: () => ok([]) },
                // Later responders win
                { match: (r) => isOwnRead(r) && r.path.endsWith("/roleAssignmentScheduleRequests"), respond: () => ok([requestRow("own-1", OTHER), requestRow("own-1", OTHER)]) },
            ],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const result = await readAzureAudit(input);
        expect(result.assignmentRequests.map((r) => r.name)).toEqual(["own-1"]);
        expect(result.eligibilityRequests).toEqual([]);
        expect(result.ownRequestCount).toBe(1);
    });

    it("does not double a request that was already read", async () => {
        const counts: number[] = [];
        const { input } = setup(
            plan(["s-1"]),
            [
                scoped([requestRow("r-1", SUB_GROUP)]),
                { match: isOwnRead, respond: () => ok([requestRow("r-1", SUB_GROUP), requestRow("R-1", SUB_GROUP)]) },
            ],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const result = await readAzureAudit({ ...input, onRows: (total) => counts.push(total) });
        expect(result.assignmentRequests.map((r) => r.name)).toEqual(["r-1"]);
        expect(result.eligibilityRequests.map((r) => r.name)).toEqual(["r-1"]);
        expect(result.ownRequestCount).toBe(0);
        // The own read counts its rows while the others run; the ones already read (and the repeat) are subtracted at the end
        expect(counts.at(-1)).toBe(2);
    });

    it("changes nothing when the asTarget() read fails, and adds no own request", async () => {
        const { input } = setup(
            plan(["s-1"]),
            [
                scoped([requestRow("r-1", SUB_GROUP)]),
                { match: isOwnRead, respond: () => armError(403, "AuthorizationFailed") },
                // Later responders win: the assignment list answers, the eligibility list does not
                { match: (r) => isOwnRead(r) && r.path.endsWith("/roleAssignmentScheduleRequests"), respond: () => ok([requestRow("own-1", OTHER)]) },
            ],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const result = await readAzureAudit(input);
        expect(result.assignmentRequests.map((r) => r.name)).toEqual(["r-1"]);
        expect(result.eligibilityRequests.map((r) => r.name)).toEqual(["r-1"]);
        expect(result.notRead).toEqual([]);
        expect(result.ownRequestCount).toBe(0);
    });

    it("is no failure of the page when the asTarget() read answers 500 after its retries", async () => {
        vi.useFakeTimers();
        const { input } = setup(
            plan(["s-1"]),
            [scoped([requestRow("r-1", SUB_GROUP)]), { match: isOwnRead, respond: () => armError(500, "InternalError", "SECRET message") }],
            [{ match: () => true, respond: () => ok([]) }],
        );
        const outcome = readAzureAudit(input);
        await vi.runAllTimersAsync();
        const result = await outcome;
        expect(result.assignmentRequests.map((r) => r.name)).toEqual(["r-1"]);
        expect(result.ownRequestCount).toBe(0);
    });
});
