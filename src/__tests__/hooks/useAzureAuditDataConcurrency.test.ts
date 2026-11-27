import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawActivityEvent } from "@/types/audit.types";
import type { AzureScope } from "@/types/azureResource.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { readAzureAudit, type AzureAuditRawRead } from "@/services/azureAuditService";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { fetchAuditRows } from "@/services/auditService";
import { listWorkspaces, readWorkspaces } from "@/services/auditWorkspaceService";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import type { WorkspaceRead } from "@/utils/auditWorkspaceMerge";
import { ACTIVITY_LOG_DAYS, AZURE_WORKSPACE_MAX_DAYS, type AzureWorkspaceRead } from "@/utils/azureWorkspaceActivity";
import { useAzureAuditData } from "@/hooks/useAzureAuditData";
import { renderHook } from "../support/hookHarness";

/**
 * AU-22, the Azure Audit page: the independent reads start together, and the result is the same whatever order they answer in.
 * MSAL, the contexts and every read are replaced; nothing reaches a tenant or storage. Only `Date` is faked, so the window is fixed.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-11-14T12:00:00.000Z");
const SUB = "/subscriptions/s-1";
const AUTH = "/providers/Microsoft.Authorization";
const TENANT = "22222222-0000-0000-0000-000000000001";
const WS_A = { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "law-a" };
const WS_B = { customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "law-b" };

const msal = vi.hoisted(() => ({
    instance: null as { acquireTokenSilent: (request: unknown) => Promise<unknown>; acquireTokenPopup: (request: unknown) => Promise<unknown> } | null,
    accounts: [] as Array<{ homeAccountId: string; tenantId: string }>,
    data: { scopes: [] as unknown[], assignments: [] as unknown[] },
}));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }) }));
vi.mock("@/contexts/AzureContext", () => ({
    useAzureData: () => msal.data,
    useAzureActions: () => ({ getArmClient: () => ({ arm: true }) }),
}));
vi.mock("@/hooks/usePimSelectors", () => ({ useGraphClient: () => async () => ({ graph: true }) }));
vi.mock("@/hooks/useAzureConsent", () => ({ useArmToken: () => async () => "arm-token" }));
vi.mock("@/utils/graphClient", () => ({ createGraphClient: vi.fn((token: string) => ({ token })) }));
vi.mock("@/services/azureAuditService", () => ({ readAzureAudit: vi.fn() }));
vi.mock("@/services/azureAuditWorkspaceService", () => ({ readAzureWorkspaces: vi.fn() }));
vi.mock("@/services/servicePrincipalTypeService", () => ({ readServicePrincipalTypes: vi.fn(async () => new Map()) }));
vi.mock("@/services/auditService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditService")>()), fetchAuditRows: vi.fn() }));
vi.mock("@/services/auditWorkspaceService", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/auditWorkspaceService")>()),
    readWorkspaces: vi.fn(),
    listWorkspaces: vi.fn(),
}));
vi.mock("@/utils/auditWorkspaceChoice", () => ({ readWorkspaceChoice: vi.fn() }));

const armMock = vi.mocked(readAzureAudit);
const azureWorkspacesMock = vi.mocked(readAzureWorkspaces);
const entraWorkspacesMock = vi.mocked(readWorkspaces);
const listMock = vi.mocked(listWorkspaces);
const entraGraphMock = vi.mocked(fetchAuditRows);
const choiceMock = vi.mocked(readWorkspaceChoice);

const account = { homeAccountId: `11111111-0000-0000-0000-000000000001.${TENANT}`, tenantId: TENANT };
const scope: AzureScope = { id: SUB, name: "Contoso Production", level: "subscription", parentId: null };
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const later = <T>(value: T, ms: number) => wait(ms).then(() => value);

function nativeRow(id: string, status: string, at: string, corr: string): RawActivityEvent {
    return { eventDataId: id, correlationId: corr, eventTimestamp: at, caller: "admin@contoso.example", resourceId: `${SUB}${AUTH}/roleAssignments/${corr}`, operationName: { value: "Microsoft.Authorization/roleAssignments/write" }, status: { value: status } };
}
const workspaceRow = (id: string, status: string, at: string, corr: string): RawActivityEvent => ({ ...nativeRow(id, status, at, corr), operationName: { value: "MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE" } });

const raw = (extra: Partial<AzureAuditRawRead> = {}): AzureAuditRawRead => ({
    activity: [nativeRow("n-a", "Started", daysAgo(3), "corr-native"), nativeRow("n-b", "Succeeded", daysAgo(3), "corr-native")],
    assignmentRequests: [],
    eligibilityRequests: [],
    notRead: [],
    tried: 2,
    ownRequestCount: 1,
    ...extra,
});
const azureOk = (workspace: typeof WS_A, rows: RawActivityEvent[] = []): AzureWorkspaceRead => ({ workspace, ok: true, rows, dropped: 0, subscriptionIds: ["s-1"], oldest: daysAgo(200) });
const azureBad = (workspace: typeof WS_A): AzureWorkspaceRead => ({ workspace, ok: false, reason: "403" });
const entraOk = (workspace: typeof WS_A): WorkspaceRead => ({ workspace, ok: true, rows: [], dropped: 0, oldestAuditEvent: daysAgo(150) });
const entraBad = (workspace: typeof WS_A): WorkspaceRead => ({ workspace, ok: false, reason: "403" });

async function until(done: () => boolean): Promise<void> {
    for (let i = 0; i < 400 && !done(); i++) await wait(5);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    msal.accounts = [account];
    msal.data = { scopes: [scope], assignments: [] };
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "silent-token" })), acquireTokenPopup: vi.fn() };
    choiceMock.mockReturnValue([]);
    listMock.mockResolvedValue({ workspaces: [], failedSubscriptions: [] });
    entraGraphMock.mockResolvedValue([]);
});
afterEach(() => {
    vi.useRealTimers();
});

describe("useAzureAuditData: the reads start together", () => {
    it("starts the Entra audit log, the workspace list and the native read before any of them finishes", async () => {
        choiceMock.mockReturnValue([WS_A.customerId]);
        const started: string[] = [];
        const open: Array<() => void> = [];
        const hold = (name: string) => new Promise<void>((resolve) => { started.push(name); open.push(resolve); });
        armMock.mockImplementation(async () => { await hold("native"); return raw(); });
        entraGraphMock.mockImplementation(async () => { await hold("entra"); return []; });
        listMock.mockImplementation(async () => { await hold("list"); return { workspaces: [{ customerId: WS_A.customerId, name: "law-a", id: "x", subscriptionId: "s-1", subscriptionName: "s", location: "w" }], failedSubscriptions: [] }; });
        entraWorkspacesMock.mockImplementation(async () => { await hold("entra workspaces"); return [entraOk(WS_A)]; });
        azureWorkspacesMock.mockImplementation(async () => { await hold("azure workspaces"); return [azureOk(WS_A)]; });
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await until(() => started.length >= 3);
        // Nothing has finished yet, and the three that need nothing of each other are running
        expect(started).toEqual(expect.arrayContaining(["native", "entra", "list"]));
        expect(started).not.toContain("entra workspaces");
        // The workspace logs follow the list at once, and are read together
        open.splice(0).forEach((resolve) => resolve());
        await until(() => started.includes("azure workspaces") && started.includes("entra workspaces"));
        expect(started).toEqual(expect.arrayContaining(["entra workspaces", "azure workspaces"]));
        open.splice(0).forEach((resolve) => resolve());
        await until(() => hook.result.status !== "loading");
        expect(hook.result.status).toBe("ready");
    });

    it("computes the start of the native read from the days alone, as before, with and without a choice", async () => {
        const started = NOW.getTime();
        for (const choice of [[], [WS_A.customerId]]) {
            for (const days of [undefined, 1, 7, 30, 90, 180, 400]) {
                choiceMock.mockReturnValue(choice);
                armMock.mockResolvedValue(raw());
                entraWorkspacesMock.mockResolvedValue([entraOk(WS_A)]);
                azureWorkspacesMock.mockResolvedValue([azureOk(WS_A)]);
                // The value of the code before AU-22: the period after the retention is known, cut to the Activity Log
                const offered = choice.length > 0 ? Math.min(Math.max(1, AZURE_WORKSPACE_MAX_DAYS), AZURE_WORKSPACE_MAX_DAYS) : 90;
                const readDays = choice.length > 0 ? Math.min(Math.max(1, Math.floor(days ?? offered)), AZURE_WORKSPACE_MAX_DAYS) : (days ?? 90);
                const expected = new Date(Math.max(started - readDays * DAY, started - ACTIVITY_LOG_DAYS * DAY)).toISOString();
                const hook = renderHook(() => useAzureAuditData());
                hook.result.load(days);
                await until(() => hook.result.status !== "loading");
                const call = armMock.mock.calls.at(-1)?.[0];
                expect(call?.from, `choice ${choice.length}, days ${days}`).toBe(expected);
            }
        }
    });

    it("ends the workspace reads when the native read fails, and still names the period of the read", async () => {
        choiceMock.mockReturnValue([WS_A.customerId]);
        listMock.mockResolvedValue({ workspaces: [{ customerId: WS_A.customerId, name: "law-a", id: "x", subscriptionId: "s-1", subscriptionName: "s", location: "w", retentionDays: 120 }], failedSubscriptions: [] });
        armMock.mockImplementation(async () => { await wait(5); throw new AuditTooManyEventsError(); });
        let signal: AbortSignal | undefined;
        entraWorkspacesMock.mockImplementation(async (_token, _refs, _days, options) => { signal = options?.signal; await wait(60); return [entraOk(WS_A)]; });
        azureWorkspacesMock.mockResolvedValue([azureOk(WS_A)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await until(() => hook.result.status !== "loading");
        expect(hook.result.status).toBe("too-many");
        // The period asked for is the one the retention gives, as when the list was read first
        expect(hook.result.requestedDays).toBe(120);
        expect(hook.result.maxDays).toBe(120);
        expect(signal?.aborted).toBe(true);
    });

    it("a new read replaces one in flight: only the new one writes", async () => {
        choiceMock.mockReturnValue([WS_A.customerId]);
        let calls = 0;
        armMock.mockImplementation(async () => (++calls === 1 ? later(raw({ ownRequestCount: 7 }), 60) : later(raw({ ownRequestCount: 2 }), 5)));
        entraWorkspacesMock.mockImplementation(async () => later([entraOk(WS_A)], 30));
        azureWorkspacesMock.mockImplementation(async () => later([azureOk(WS_A)], 30));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await wait(10);
        hook.result.load();
        await until(() => hook.result.status === "ready");
        await wait(100);
        expect(hook.result.status).toBe("ready");
        expect(hook.result.ownRequestCount).toBe(2);
    });
});

/** Everything the page shows of a finished read */
function snapshot(hook: ReturnType<typeof renderHook<ReturnType<typeof useAzureAuditData>>>) {
    const r = hook.result;
    return {
        status: r.status,
        events: r.events.map((event) => [event.id, event.time, event.source ?? null, event.workspace ?? null]),
        oldest: r.oldest,
        requestedDays: r.requestedDays,
        maxDays: r.maxDays,
        notRead: r.notRead,
        ownRequestCount: r.ownRequestCount,
        entraLog: r.entraLog,
        entraLogDays: r.entraLogDays,
        workspace: r.workspace && { ...r.workspace, sendingSubscriptionIds: r.workspace.sendingSubscriptionIds && [...r.workspace.sendingSubscriptionIds].sort() },
    };
}

interface Setup {
    choice: string[];
    days?: number;
    arm?: () => Promise<AzureAuditRawRead>;
    entraRows?: "rows" | "permission";
    azureWs?: AzureWorkspaceRead[];
    entraWs?: WorkspaceRead[];
}

type Delays = { arm: number; entra: number; list: number; ws: number };

async function runWith(setup: Setup, delays: Delays) {
    choiceMock.mockReturnValue(setup.choice);
    const rows = buildDemoAuditRows(NOW).filter((row) => row.loggedByService === "PIM").slice(0, 6);
    armMock.mockImplementation(async () => later(await (setup.arm ?? (async () => raw()))(), delays.arm));
    entraGraphMock.mockImplementation(async () => {
        await wait(delays.entra);
        if (setup.entraRows === "permission") throw Object.assign(new Error("nope"), { statusCode: 403, code: "Authorization_RequestDenied" });
        return rows;
    });
    listMock.mockImplementation(async () => later({ workspaces: setup.choice.map((customerId) => ({ customerId, name: customerId === WS_A.customerId ? "law-a" : "law-b", id: "x", subscriptionId: "s-1", subscriptionName: "s", location: "w", retentionDays: 200 })), failedSubscriptions: [] }, delays.list));
    entraWorkspacesMock.mockImplementation(async () => later(setup.entraWs ?? [entraOk(WS_A)], delays.ws));
    azureWorkspacesMock.mockImplementation(async () => later(setup.azureWs ?? [azureOk(WS_A)], delays.ws));
    const hook = renderHook(() => useAzureAuditData());
    hook.result.load(setup.days);
    await until(() => hook.result.status !== "loading");
    return snapshot(hook);
}

const ORDERS: Delays[] = [
    { arm: 5, entra: 40, list: 25, ws: 30 },
    { arm: 60, entra: 5, list: 5, ws: 5 },
    { arm: 30, entra: 30, list: 5, ws: 45 },
];

const wsRows = [workspaceRow("w-1", "Started", daysAgo(2), "corr-ws"), workspaceRow("w-2", "Succeeded", daysAgo(2), "corr-ws")];
const CASES: Array<[string, Setup]> = [
    ["no choice", { choice: [] }],
    ["days in the URL, no choice", { choice: [], days: 30 }],
    ["Entra audit log not permitted", { choice: [], entraRows: "permission" }],
    ["one workspace", { choice: [WS_A.customerId], azureWs: [azureOk(WS_A, wsRows)] }],
    ["one workspace and days", { choice: [WS_A.customerId], days: 7, azureWs: [azureOk(WS_A, wsRows)] }],
    ["a workspace that fails", { choice: [WS_A.customerId, WS_B.customerId], azureWs: [azureOk(WS_A, wsRows), azureBad(WS_B)], entraWs: [entraOk(WS_A), entraBad(WS_B)] }],
    ["every workspace failing", { choice: [WS_A.customerId, WS_B.customerId], azureWs: [azureBad(WS_A), azureBad(WS_B)], entraWs: [entraBad(WS_A), entraBad(WS_B)] }],
    ["a refused subscription and own requests", { choice: [], arm: async () => raw({ notRead: [{ part: "requests", scopeId: "/subscriptions/s-2", reason: "refused" }], tried: 3, ownRequestCount: 3 }) }],
    ["too many rows", { choice: [WS_A.customerId], arm: async () => { throw new AuditTooManyEventsError(); } }],
    ["everything not read", { choice: [], arm: async () => raw({ activity: [], notRead: [{ part: "log", scopeId: SUB, reason: "forbidden" }], tried: 1 }) }],
];

describe("useAzureAuditData: the same result whatever order the reads answer in", () => {
    for (const [name, setup] of CASES) {
        it(name, async () => {
            const results = [];
            for (const delays of ORDERS) results.push(await runWith(setup, delays));
            expect(results[1]).toEqual(results[0]);
            expect(results[2]).toEqual(results[0]);
            expect(["ready", "too-many", "failed"]).toContain(results[0].status);
        });
    }

    it("holds the values of the reads that matter", async () => {
        const one = await runWith({ choice: [WS_A.customerId, WS_B.customerId], azureWs: [azureOk(WS_A, wsRows), azureBad(WS_B)], entraWs: [entraOk(WS_A), entraBad(WS_B)] }, ORDERS[1]);
        expect(one.status).toBe("ready");
        expect(one.requestedDays).toBe(200);
        expect(one.maxDays).toBe(200);
        expect(one.ownRequestCount).toBe(1);
        expect(one.entraLog).toBe("read");
        expect(one.workspace?.fellBack).toBe(false);
        const fallback = await runWith({ choice: [WS_A.customerId], azureWs: [azureBad(WS_A)], entraWs: [entraBad(WS_A)] }, ORDERS[1]);
        expect(fallback.workspace?.fellBack).toBe(true);
        expect(fallback.requestedDays).toBe(90);
        expect(fallback.maxDays).toBe(90);
    });
});
