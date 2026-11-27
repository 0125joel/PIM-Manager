import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { fetchAuditRows } from "@/services/auditService";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { readWorkspaces } from "@/services/auditWorkspaceService";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import type { WorkspaceRead } from "@/utils/auditWorkspaceMerge";
import { adaptDemoRows } from "../support/workspaceRows";
import { useAuditData } from "@/hooks/useAuditData";
import { renderHook } from "../support/hookHarness";

/** The Audit page's data hook with a choice of workspaces: partial, all failed (the fall-back), no second write, the period maximum. */

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
vi.mock("@/services/auditService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditService")>()), fetchAuditRows: vi.fn() }));
vi.mock("@/services/auditWorkspaceService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditWorkspaceService")>()), readWorkspaces: vi.fn(), listWorkspaces: vi.fn() }));
vi.mock("@/utils/auditWorkspaceChoice", () => ({ readWorkspaceChoice: vi.fn() }));

const readMock = vi.mocked(readWorkspaces);
const graphMock = vi.mocked(fetchAuditRows);
const choiceMock = vi.mocked(readWorkspaceChoice);
const graphRows: RawDirectoryAudit[] = buildDemoAuditRows(new Date());

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const ok = (customerId: string, name: string, ids: string[]): WorkspaceRead => ({ workspace: { customerId, name }, ok: true, rows: adaptDemoRows(graphRows.filter((r) => ids.includes(r.id)), TENANT), dropped: 0, oldestAuditEvent: "2026-01-03T00:00:00.000Z" });
const bad = (customerId: string, name: string): WorkspaceRead => ({ workspace: { customerId, name }, ok: false, reason: "403" });
const someIds = graphRows.filter((r) => r.loggedByService === "PIM").slice(0, 8).map((r) => r.id);

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [{ homeAccountId: `11111111-0000-4000-8000-000000000001.${TENANT}`, tenantId: TENANT }];
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "token" })), acquireTokenPopup: vi.fn() };
    choiceMock.mockReturnValue([WS_A, WS_B]);
    graphMock.mockResolvedValue([]);
});

describe("useAuditData with chosen workspaces", () => {
    it("allows the longest period until the retention is known, and reads the workspaces instead of Graph", async () => {
        readMock.mockResolvedValue([ok(WS_A, WS_A, someIds), ok(WS_B, WS_B, someIds)]);
        const hook = renderHook(() => useAuditData());
        expect(hook.result.maxDays).toBe(730);
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.source.kind).toBe("workspace");
        expect(hook.result.source.summary).toMatchObject({ total: 2, read: 2, graphOnly: 0, graphFailure: null });
        expect(hook.result.events.length).toBeGreaterThan(0);
        expect(hook.result.events.every((e) => e.source === "workspace" && e.workspace === WS_A)).toBe(true);
        expect(hook.result.oldest).toBe("2026-01-03T00:00:00.000Z");
        expect(hook.result.maxDays).toBe(730);
    });

    it("some fail: the rest shows and the summary names what is missing", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds), bad(WS_B, "law-b")]);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.source.kind).toBe("workspace");
        expect(hook.result.source.summary?.failed).toEqual([{ name: "law-b", reason: "403" }]);
        expect(hook.result.events.length).toBeGreaterThan(0);
    });

    it("all fail: a visible fall-back to the 30 days of Graph", async () => {
        readMock.mockResolvedValue([bad(WS_A, "law-a"), bad(WS_B, "law-b")]);
        graphMock.mockResolvedValue(graphRows);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(graphMock).toHaveBeenCalledTimes(1);
        expect(hook.result.source).toMatchObject({ kind: "graph", fellBack: true });
        expect(hook.result.source.summary?.failed).toHaveLength(2);
        expect(hook.result.maxDays).toBe(30);
        expect(hook.result.requestedDays).toBe(30);
    });

    it("no consent for Log Analytics: every workspace fails the same way and Graph shows instead", async () => {
        msal.instance = {
            acquireTokenSilent: vi.fn(async (request: unknown) => {
                if ((request as { scopes: string[] }).scopes[0].includes("loganalytics")) throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" });
                return { accessToken: "token" };
            }),
            acquireTokenPopup: vi.fn(),
        };
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(readMock).not.toHaveBeenCalled();
        expect(hook.result.source.fellBack).toBe(true);
        expect(hook.result.source.summary?.failed.map((f) => f.reason)).toEqual(["permission not granted", "permission not granted"]);
        expect(hook.result.status).toBe("ready");
    });

    it("a newer read wins: the older answer does not write a second time", async () => {
        let answerFirst: (value: WorkspaceRead[]) => void = () => undefined;
        readMock.mockImplementationOnce(() => new Promise<WorkspaceRead[]>((resolve) => { answerFirst = resolve; }));
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("loading");
        readMock.mockResolvedValueOnce([ok(WS_A, "law-a", someIds.slice(0, 2))]);
        hook.result.load(7);
        await settle();
        const after = hook.result.events;
        answerFirst([ok(WS_A, "law-old", someIds)]);
        await settle();
        expect(hook.result.events).toBe(after);
        expect(hook.result.events.every((e) => e.workspace === "law-a")).toBe(true);
    });

    it("too many events in the merge is the too-many state", async () => {
        const many: WorkspaceRead = { workspace: { customerId: WS_A, name: "a" }, ok: true, dropped: 0, rows: adaptDemoRows(graphRows, TENANT, 50_002) };
        readMock.mockResolvedValue([many]);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("too-many");
    });

    it("without a choice nothing changes: Graph, 30 days", async () => {
        choiceMock.mockReturnValue([]);
        graphMock.mockResolvedValue(graphRows);
        const hook = renderHook(() => useAuditData());
        expect(hook.result.maxDays).toBe(30);
        hook.result.load();
        await settle();
        expect(readMock).not.toHaveBeenCalled();
        expect(hook.result.source).toEqual({ kind: "graph", summary: null, fellBack: false });
        expect(hook.result.status).toBe("ready");
    });

    it("reads the last 30 days of Graph next to the workspaces, with a silent token, under the same abort", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(graphMock).toHaveBeenCalledTimes(1);
        const [client, startIso, options] = graphMock.mock.calls[0];
        expect(client).toEqual({ token: "token" });
        expect(Math.round((Date.now() - Date.parse(startIso)) / 86_400_000)).toBe(30);
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        expect(msal.instance?.acquireTokenPopup).not.toHaveBeenCalled();
        hook.result.load(7);
        await settle();
        expect(Math.round((Date.now() - Date.parse(graphMock.mock.calls[1][1])) / 86_400_000)).toBe(7);
    });

    it("adds the rows only Graph had, tells their number, and keeps the source of each event", async () => {
        const fromWorkspace = someIds.slice(0, 4);
        const onlyGraph = graphRows.filter((r) => r.loggedByService === "PIM" && !fromWorkspace.includes(r.id)).slice(0, 3);
        readMock.mockResolvedValue([ok(WS_A, "law-a", fromWorkspace)]);
        graphMock.mockResolvedValue([...graphRows.filter((r) => fromWorkspace.includes(r.id)), ...onlyGraph]);
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.source.summary?.graphOnly).toBe(3);
        const graphEvents = hook.result.events.filter((e) => e.source === "graph");
        expect(graphEvents.length).toBeGreaterThan(0);
        expect(graphEvents.every((e) => e.workspace === undefined)).toBe(true);
        expect(hook.result.events.some((e) => e.source === "workspace" && e.workspace === "law-a" || e.workspace === WS_A)).toBe(true);
    });

    it("Graph failing on its own leaves the workspaces and says why", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        const cases: Array<[unknown, string]> = [
            [{ code: "Authentication_RequestFromUnsupportedUserRole", statusCode: 403 }, "no reader role"],
            [{ code: "Authorization_RequestDenied", statusCode: 403 }, "no permission"],
            [Object.assign(new Error("x"), { statusCode: 500, code: "generalException" }), "500 generalException"],
        ];
        for (const [error, reason] of cases) {
            graphMock.mockRejectedValueOnce(error);
            const hook = renderHook(() => useAuditData());
            hook.result.load();
            await settle();
            expect(hook.result.status, reason).toBe("ready");
            expect(hook.result.source.summary?.graphFailure, reason).toBe(reason);
            expect(hook.result.events.length, reason).toBeGreaterThan(0);
        }
    });

    it("no consent for the Entra audit log: no permission, and the workspaces still show, with no popup", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        msal.instance = {
            acquireTokenSilent: vi.fn(async (request: unknown) => {
                if ((request as { scopes: string[] }).scopes[0] === "AuditLog.Read.All") throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" });
                return { accessToken: "token" };
            }),
            acquireTokenPopup: vi.fn(),
        };
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(graphMock).not.toHaveBeenCalled();
        expect(hook.result.source.summary?.graphFailure).toBe("no permission");
        expect(hook.result.status).toBe("ready");
        expect(msal.instance.acquireTokenPopup).not.toHaveBeenCalled();
    });

    it("an abort stays an abort: the stale read writes nothing, also when Graph rejects with it", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds)]);
        graphMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).not.toBe("failed");
        expect(hook.result.source.summary?.graphFailure ?? null).toBeNull();
    });

    it("Graph and the workspaces together over the limit is the too-many state", async () => {
        readMock.mockResolvedValue([ok(WS_A, "law-a", someIds.slice(0, 2))]);
        graphMock.mockRejectedValueOnce(new AuditTooManyEventsError());
        const hook = renderHook(() => useAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("too-many");
    });
});
