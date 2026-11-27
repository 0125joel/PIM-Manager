import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { fetchAuditRows } from "@/services/auditService";
import { listWorkspaces, readWorkspaces } from "@/services/auditWorkspaceService";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import type { WorkspaceRead } from "@/utils/auditWorkspaceMerge";
import { adaptDemoRows } from "../support/workspaceRows";
import { useAuditData } from "@/hooks/useAuditData";
import { renderHook } from "../support/hookHarness";

/**
 * AU-22, the Entra Audit page: the Entra audit log starts at once, next to the workspace list and the workspace reads, and the result
 * is the same whatever order they answer in. MSAL and every read are replaced; nothing reaches a tenant. Only `Date` is faked.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-11-14T12:00:00.000Z");
const TENANT = "22222222-0000-4000-8000-000000000001";
const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const msal = vi.hoisted(() => ({
    instance: null as { acquireTokenSilent: (r: unknown) => Promise<unknown>; acquireTokenPopup: (r: unknown) => Promise<unknown> } | null,
    accounts: [] as Array<{ homeAccountId: string; tenantId: string }>,
}));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }) }));
vi.mock("@/utils/graphClient", () => ({ createGraphClient: vi.fn((token: string) => ({ token })) }));
vi.mock("@/utils/azureConsent", () => ({ isAzureEnabled: () => true }));
vi.mock("@/services/auditService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditService")>()), fetchAuditRows: vi.fn() }));
vi.mock("@/services/auditWorkspaceService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditWorkspaceService")>()), readWorkspaces: vi.fn(), listWorkspaces: vi.fn() }));
vi.mock("@/utils/auditWorkspaceChoice", () => ({ readWorkspaceChoice: vi.fn() }));

const readMock = vi.mocked(readWorkspaces);
const listMock = vi.mocked(listWorkspaces);
const graphMock = vi.mocked(fetchAuditRows);
const choiceMock = vi.mocked(readWorkspaceChoice);

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const later = <T>(value: T, ms: number) => wait(ms).then(() => value);
async function until(done: () => boolean): Promise<void> {
    for (let i = 0; i < 400 && !done(); i++) await wait(5);
}

const pim = buildDemoAuditRows(NOW).filter((row) => row.loggedByService === "PIM");
const someIds = pim.slice(0, 8).map((row) => row.id);
const ok = (customerId: string, name: string, ids: string[]): WorkspaceRead => ({ workspace: { customerId, name }, ok: true, rows: adaptDemoRows(pim.filter((r) => ids.includes(r.id)), TENANT), dropped: 0, oldestAuditEvent: daysAgo(100) });
const bad = (customerId: string, name: string): WorkspaceRead => ({ workspace: { customerId, name }, ok: false, reason: "403" });
const info = (customerId: string, retentionDays?: number) => ({ customerId, name: customerId === WS_A ? "law-a" : "law-b", id: "x", subscriptionId: "s", subscriptionName: "s", location: "w", ...(retentionDays ? { retentionDays } : {}) });

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    msal.accounts = [{ homeAccountId: `11111111-0000-4000-8000-000000000001.${TENANT}`, tenantId: TENANT }];
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "token" })), acquireTokenPopup: vi.fn() };
    choiceMock.mockReturnValue([WS_A, WS_B]);
    listMock.mockResolvedValue({ workspaces: [], failedSubscriptions: [] });
    graphMock.mockResolvedValue([]);
});
afterEach(() => {
    vi.useRealTimers();
});

describe("useAuditData: the Entra audit log starts with the workspace reads", () => {
    it("starts the Graph read and the workspace list before any of them finishes", async () => {
        const started: string[] = [];
        const open: Array<() => void> = [];
        const hold = (name: string) => new Promise<void>((resolve) => { started.push(name); open.push(resolve); });
        graphMock.mockImplementation(async () => { await hold("graph"); return []; });
        listMock.mockImplementation(async () => { await hold("list"); return { workspaces: [info(WS_A)], failedSubscriptions: [] }; });
        readMock.mockImplementation(async () => { await hold("workspaces"); return [ok(WS_A, "law-a", someIds)]; });
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await until(() => started.length >= 2);
        expect(started).toEqual(expect.arrayContaining(["graph", "list"]));
        expect(started).not.toContain("workspaces");
        open.splice(0).forEach((resolve) => resolve());
        await until(() => started.includes("workspaces"));
        open.splice(0).forEach((resolve) => resolve());
        await until(() => hook.result.status !== "loading");
        expect(hook.result.status).toBe("ready");
        // One Graph read, not a second one after the workspaces
        expect(graphMock).toHaveBeenCalledTimes(1);
    });

    it("asks Graph for the same window as before: 30 days, or the period asked for when it is shorter", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        for (const [days, expected] of [[undefined, 30], [7, 7], [30, 30], [90, 30], [1, 1]] as const) {
            graphMock.mockClear();
            const hook = renderHook(() => useAuditData());
            hook.result.load(days);
            await until(() => hook.result.status !== "loading");
            expect((NOW.getTime() - Date.parse(graphMock.mock.calls[0][1])) / DAY, `days ${days}`).toBe(expected);
        }
    });

    it("a workspace that keeps fewer than 30 days: only the rows of its window are added, and oldest is that window's start", async () => {
        listMock.mockResolvedValue({ workspaces: [info(WS_A, 10)], failedSubscriptions: [] });
        choiceMock.mockReturnValue([WS_A]);
        const [first, second] = pim;
        const recent: RawDirectoryAudit = { ...first, id: "g-recent", correlationId: "c-recent", activityDateTime: daysAgo(5) };
        const old: RawDirectoryAudit = { ...second, id: "g-old", correlationId: "c-old", activityDateTime: daysAgo(20) };
        // Graph answers what its filter asks for: the rows from the start of the window on
        graphMock.mockImplementation(async (_client, startIso) => [recent, old].filter((row) => Date.parse(row.activityDateTime) >= Date.parse(startIso)));
        readMock.mockResolvedValue([{ workspace: { customerId: WS_A, name: "law-a" }, ok: true, rows: [], dropped: 0, oldestAuditEvent: daysAgo(10) }]);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await until(() => hook.result.status !== "loading");
        expect(hook.result.status).toBe("ready");
        expect(hook.result.requestedDays).toBe(10);
        expect(hook.result.maxDays).toBe(10);
        // The early read covers 30 days; the 20-day-old row is outside the 10 days that the read is for
        expect(hook.result.source.summary?.graphOnly).toBe(1);
        expect(hook.result.oldest).toBe(daysAgo(10));
        expect(hook.result.events.map((event) => event.id).join()).not.toContain("g-old");
    });

    it("every workspace failing: the early read of 30 days is the fallback, no second read; a shorter period reads again", async () => {
        readMock.mockResolvedValue([bad(WS_A, "law-a"), bad(WS_B, "law-b")]);
        graphMock.mockResolvedValue(pim);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await until(() => hook.result.status !== "loading");
        expect(graphMock).toHaveBeenCalledTimes(1);
        expect(hook.result.status).toBe("ready");
        expect(hook.result.source).toMatchObject({ kind: "graph", fellBack: true });
        expect(hook.result.requestedDays).toBe(30);
        expect(hook.result.maxDays).toBe(30);
        expect(hook.result.oldest).toBe(daysAgo(30));
        expect(hook.result.events.length).toBeGreaterThan(0);
        graphMock.mockClear();
        hook.result.load(7);
        await until(() => hook.result.status !== "loading");
        // Seven days were read early; the fallback is for 30 days, so it reads them itself
        expect(graphMock).toHaveBeenCalledTimes(2);
        expect((NOW.getTime() - Date.parse(graphMock.mock.calls[1][1])) / DAY).toBe(30);
    });

    it("every workspace failing and the early read failing: the fallback reads Graph as before and the states stay", async () => {
        readMock.mockResolvedValue([bad(WS_A, "law-a"), bad(WS_B, "law-b")]);
        graphMock.mockRejectedValue({ code: "Authorization_RequestDenied", statusCode: 403 });
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await until(() => hook.result.status !== "loading");
        expect(graphMock).toHaveBeenCalledTimes(2);
        expect(hook.result.status).toBe("permission");
    });

    it("too many rows of Graph next to the workspaces ends the read as too many, once it is awaited", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        graphMock.mockRejectedValue(new AuditTooManyEventsError());
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await until(() => hook.result.status !== "loading");
        expect(hook.result.status).toBe("too-many");
    });

    it("a new read replaces one in flight: the older Graph answer writes nothing", async () => {
        readMock.mockImplementation(async () => later([ok(WS_A, "law-a", someIds)], 20));
        let calls = 0;
        graphMock.mockImplementation(async () => (++calls === 1 ? later(pim, 80) : later([], 5)));
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await wait(10);
        hook.result.load(7);
        await until(() => hook.result.status === "ready");
        const after = hook.result.events;
        await wait(120);
        expect(hook.result.status).toBe("ready");
        expect(hook.result.events).toBe(after);
    });
});

function snapshot(hook: ReturnType<typeof renderHook<ReturnType<typeof useAuditData>>>) {
    const r = hook.result;
    return {
        status: r.status,
        events: r.events.map((event) => [event.id, event.time, event.source ?? null, event.workspace ?? null]),
        oldest: r.oldest,
        requestedDays: r.requestedDays,
        maxDays: r.maxDays,
        source: r.source,
    };
}

interface Setup {
    choice: string[];
    days?: number;
    retention?: number;
    graph?: "rows" | "denied" | "many";
    reads?: WorkspaceRead[];
}
type Delays = { graph: number; list: number; ws: number };

async function runWith(setup: Setup, delays: Delays) {
    choiceMock.mockReturnValue(setup.choice);
    graphMock.mockImplementation(async () => {
        await wait(delays.graph);
        if (setup.graph === "denied") throw { code: "Authorization_RequestDenied", statusCode: 403 };
        if (setup.graph === "many") throw new AuditTooManyEventsError();
        return pim;
    });
    listMock.mockImplementation(async () => later({ workspaces: setup.choice.map((id) => info(id, setup.retention)), failedSubscriptions: [] }, delays.list));
    readMock.mockImplementation(async () => later(setup.reads ?? [ok(WS_A, "law-a", someIds)], delays.ws));
    const hook = renderHook(() => useAuditData());
    hook.result.load(setup.days);
    await until(() => hook.result.status !== "loading");
    return snapshot(hook);
}

const ORDERS: Delays[] = [
    { graph: 5, list: 30, ws: 30 },
    { graph: 70, list: 5, ws: 5 },
    { graph: 30, list: 5, ws: 50 },
];
const CASES: Array<[string, Setup]> = [
    ["no choice", { choice: [] }],
    ["days in the URL, no choice", { choice: [], days: 7 }],
    ["one workspace", { choice: [WS_A] }],
    ["one workspace and days", { choice: [WS_A], days: 7 }],
    ["a workspace that fails", { choice: [WS_A, WS_B], reads: [ok(WS_A, "law-a", someIds), bad(WS_B, "law-b")] }],
    ["every workspace failing (the fallback)", { choice: [WS_A, WS_B], reads: [bad(WS_A, "law-a"), bad(WS_B, "law-b")] }],
    ["every workspace failing, shorter period", { choice: [WS_A, WS_B], days: 7, reads: [bad(WS_A, "law-a"), bad(WS_B, "law-b")] }],
    ["a workspace that keeps fewer than 30 days", { choice: [WS_A], retention: 10 }],
    ["Graph not permitted next to the workspaces", { choice: [WS_A], graph: "denied" }],
    ["Graph not permitted, every workspace failing", { choice: [WS_A], graph: "denied", reads: [bad(WS_A, "law-a")] }],
    ["too many rows", { choice: [WS_A], graph: "many" }],
];

describe("useAuditData: the same result whatever order the reads answer in", () => {
    for (const [name, setup] of CASES) {
        it(name, async () => {
            const results = [];
            for (const delays of ORDERS) results.push(await runWith(setup, delays));
            expect(results[1]).toEqual(results[0]);
            expect(results[2]).toEqual(results[0]);
        });
    }
});
