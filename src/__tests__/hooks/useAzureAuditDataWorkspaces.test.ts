import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawActivityEvent } from "@/types/audit.types";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { demoGuid } from "@/demo/contoso/ids";
import { readAzureAudit, type AzureAuditRawRead } from "@/services/azureAuditService";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { fetchAuditRows } from "@/services/auditService";
import { listWorkspaces, readWorkspaces } from "@/services/auditWorkspaceService";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import type { WorkspaceRead } from "@/utils/auditWorkspaceMerge";
import type { AzureWorkspaceRead } from "@/utils/azureWorkspaceActivity";
import { useAzureAuditData } from "@/hooks/useAzureAuditData";
import { renderHook } from "../support/hookHarness";

/**
 * The Azure Audit page's data hook with a chosen workspace: partial, all failed (the fall-back to 90 days), the reach of the ARM
 * read, and each event once. MSAL, the contexts and the reads are replaced; nothing reaches a tenant or storage.
 */

const DAY = 86_400_000;
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
    listWorkspaces: vi.fn(async () => ({ workspaces: [], failedSubscriptions: [] })),
}));
vi.mock("@/utils/auditWorkspaceChoice", () => ({ readWorkspaceChoice: vi.fn() }));

const armMock = vi.mocked(readAzureAudit);
const azureWorkspacesMock = vi.mocked(readAzureWorkspaces);
const entraWorkspacesMock = vi.mocked(readWorkspaces);
const fetchMock = vi.mocked(fetchAuditRows);
const choiceMock = vi.mocked(readWorkspaceChoice);

const account = { homeAccountId: `11111111-0000-0000-0000-000000000001.${TENANT}`, tenantId: TENANT };
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
/** One instant for the rows that must match to the second (the dedupe key) */
const AT3 = daysAgo(3);
const scope: AzureScope = { id: SUB, name: "Contoso Production", level: "subscription", parentId: null };

/** An Activity Log row of a role assignment write, as the native read gives it */
function nativeRow(id: string, status: string, at: string, corr: string): RawActivityEvent {
    return { eventDataId: id, correlationId: corr, eventTimestamp: at, caller: "admin@contoso.example", resourceId: `${SUB}${AUTH}/roleAssignments/${corr}`, operationName: { value: "Microsoft.Authorization/roleAssignments/write" }, status: { value: status } };
}

/** The same action as the workspace gives it, after the adapter: the status words of ARM and a different event id */
function workspaceRow(id: string, status: string, at: string, corr: string): RawActivityEvent {
    return { ...nativeRow(id, status, at, corr), operationName: { value: "MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE" } };
}

const ok = (workspace: typeof WS_A, rows: RawActivityEvent[] = []): AzureWorkspaceRead => ({ workspace, ok: true, rows, dropped: 0, subscriptionIds: [SUB.slice("/subscriptions/".length)], oldest: null });
const bad = (workspace: typeof WS_A, reason = "403"): AzureWorkspaceRead => ({ workspace, ok: false, reason });
const entraOk = (workspace: typeof WS_A): WorkspaceRead => ({ workspace, ok: true, rows: [], dropped: 0 });
const entraBad = (workspace: typeof WS_A): WorkspaceRead => ({ workspace, ok: false, reason: "403" });

function nativeRaw(extra: Partial<AzureAuditRawRead> = {}): AzureAuditRawRead {
    return {
        activity: [nativeRow("n-a", "Started", AT3, "corr-native"), nativeRow("n-b", "Succeeded", AT3, "corr-native")],
        assignmentRequests: [],
        eligibilityRequests: [],
        notRead: [],
        tried: 2,
        ownRequestCount: 0,
        ...extra,
    };
}

const groupHolding: AzureAssignment = {
    id: "a1", scopeId: SUB, principalId: demoGuid("group:platform"), principalName: "Platform Engineers", principalType: "Group", roleDefinitionId: "role-1", roleName: "Reader", state: "active", memberType: "direct", endDateTime: null,
};

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [account];
    msal.data = { scopes: [scope], assignments: [] };
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "silent-token" })), acquireTokenPopup: vi.fn() };
    choiceMock.mockReturnValue([WS_A.customerId, WS_B.customerId]);
    armMock.mockResolvedValue(nativeRaw());
    entraWorkspacesMock.mockResolvedValue([entraOk(WS_A), entraOk(WS_B)]);
    azureWorkspacesMock.mockResolvedValue([ok(WS_A), ok(WS_B)]);
    fetchMock.mockResolvedValue([]);
});

describe("useAzureAuditData with chosen workspaces", () => {
    it("some workspaces fail: the rest shows and the summary names the ones that did not", async () => {
        azureWorkspacesMock.mockResolvedValue([ok(WS_A, [workspaceRow("w-1", "Started", daysAgo(2), "corr-ws"), workspaceRow("w-2", "Succeeded", daysAgo(2), "corr-ws")]), bad(WS_B)]);
        entraWorkspacesMock.mockResolvedValue([entraOk(WS_A), entraBad(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.workspace?.fellBack).toBe(false);
        expect(hook.result.workspace?.summary.failed).toEqual([{ name: WS_B.name, reason: "403" }]);
        expect(hook.result.events.some((event) => event.source === "azure-workspace" && event.workspace === WS_A.name)).toBe(true);
    });

    it("every workspace fails: a visible fall-back to at most 90 days, and the page offers 90 again", async () => {
        armMock.mockClear();
        azureWorkspacesMock.mockResolvedValue([bad(WS_A), bad(WS_B)]);
        entraWorkspacesMock.mockResolvedValue([entraBad(WS_A), entraBad(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(180);
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.workspace).toMatchObject({ fellBack: true, sendingSubscriptionIds: null, oldest: null });
        expect(hook.result.maxDays).toBe(90);
        expect(hook.result.requestedDays).toBe(90);
        expect(hook.result.events.some((event) => event.source === "azure-workspace")).toBe(false);
    });

    it("reads the ARM log of at most 90 days however long the period, because the Activity Log keeps 90 days", async () => {
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(300);
        await settle();
        const from = armMock.mock.calls.at(-1)?.[0].from;
        expect(from).toBeDefined();
        expect(Date.now() - Date.parse(from ?? "")).toBeLessThanOrEqual(90 * DAY + 60_000);
        expect(Date.now() - Date.parse(from ?? "")).toBeGreaterThanOrEqual(90 * DAY - 60_000);
    });

    it("a row that only a workspace holds, older than 90 days, stays in a period of 180 days", async () => {
        azureWorkspacesMock.mockResolvedValue([
            ok(WS_A, [workspaceRow("w-old-a", "Started", daysAgo(120), "corr-old"), workspaceRow("w-old-b", "Succeeded", daysAgo(120), "corr-old")]),
            ok(WS_B),
        ]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(180);
        await settle();
        const old = hook.result.events.find((event) => event.id === "w-old-b");
        expect(old).toMatchObject({ source: "azure-workspace", workspace: WS_A.name });
        expect(hook.result.maxDays).toBe(365);
    });

    it("a row in the native read and in a workspace shows once", async () => {
        azureWorkspacesMock.mockResolvedValue([
            ok(WS_A, [workspaceRow("w-n-a", "Started", AT3, "corr-native"), workspaceRow("w-n-b", "Succeeded", AT3, "corr-native")]),
            ok(WS_B),
        ]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(30);
        await settle();
        const shown = hook.result.events.filter((event) => event.correlationId === "corr-native");
        expect(shown).toHaveLength(1);
        expect(shown[0].source).toBe("activity-log");
    });

    it("reads the Activity Log of each workspace for the same period, as the Entra read does", async () => {
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(60);
        await settle();
        // The names are the ids until the workspace list names them
        const refs = [{ customerId: WS_A.customerId, name: WS_A.customerId }, { customerId: WS_B.customerId, name: WS_B.customerId }];
        expect(azureWorkspacesMock).toHaveBeenCalledWith(expect.any(Function), refs, 60, expect.any(Object));
        expect(entraWorkspacesMock).toHaveBeenCalledWith(expect.any(Function), refs, 60, expect.any(Object));
    });

    it("the Entra log reaches what a workspace really holds, never the period asked for, and 30 days otherwise", async () => {
        entraWorkspacesMock.mockResolvedValue([{ workspace: WS_A, ok: true, rows: [], dropped: 0, oldestAuditEvent: daysAgo(45) }, entraOk(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(120);
        await settle();
        expect(hook.result.entraLogDays).toBe(45);
        choiceMock.mockReturnValue([]);
        const plain = renderHook(() => useAzureAuditData());
        plain.result.load();
        await settle();
        expect(plain.result.entraLogDays).toBe(30);
        expect(plain.result.workspace).toBeNull();
        expect(plain.result.maxDays).toBe(90);
    });

    it("the oldest event available is what the native read and the workspaces hold, never the whole period", async () => {
        azureWorkspacesMock.mockResolvedValue([{ workspace: WS_A, ok: true, rows: [], dropped: 0, subscriptionIds: [], oldest: daysAgo(100) }, ok(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(180);
        await settle();
        const reach = Date.parse(hook.result.oldest ?? "");
        expect(reach).toBeGreaterThan(Date.now() - 101 * DAY);
        expect(reach).toBeLessThan(Date.now() - 99 * DAY);
        azureWorkspacesMock.mockResolvedValue([ok(WS_A), ok(WS_B)]);
        hook.result.load(180);
        await settle();
        expect(Date.parse(hook.result.oldest ?? "")).toBeGreaterThan(Date.now() - 91 * DAY);
    });

    it("a workspace with an empty audit table does not hide that the Entra log could not be read", async () => {
        msal.instance = {
            acquireTokenSilent: vi.fn(async (request: unknown) => {
                if ((request as { scopes: string[] }).scopes.some((scope) => scope.includes("AuditLog"))) throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" });
                return { accessToken: "silent-token" };
            }),
            acquireTokenPopup: vi.fn(),
        };
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(60);
        await settle();
        expect(hook.result.entraLog).toBe("no permission");
        expect(hook.result.entraLogDays).toBe(30);
        expect(hook.result.workspace?.summary.graphFailure).toBeNull();
    });

    it("tells that Graph could not check the last 30 days when a workspace holds the Entra log", async () => {
        msal.instance = {
            acquireTokenSilent: vi.fn(async (request: unknown) => {
                if ((request as { scopes: string[] }).scopes.some((scope) => scope.includes("AuditLog"))) throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" });
                return { accessToken: "silent-token" };
            }),
            acquireTokenPopup: vi.fn(),
        };
        entraWorkspacesMock.mockResolvedValue([{ workspace: WS_A, ok: true, rows: [], dropped: 0, oldestAuditEvent: daysAgo(10) }, entraOk(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(60);
        await settle();
        expect(hook.result.entraLog).toBe("read");
        expect(hook.result.entraLogDays).toBe(10);
        expect(hook.result.workspace?.summary.graphFailure).toBe("no permission");
    });

    it("a workspace that keeps less than 90 days takes nothing away from the page", async () => {
        vi.mocked(listWorkspaces).mockResolvedValueOnce({
            workspaces: [WS_A, WS_B].map((w) => ({ customerId: w.customerId, name: w.name, id: w.name, subscriptionId: "s-1", subscriptionName: "s", location: "", retentionDays: 30 })),
            failedSubscriptions: [],
        });
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.maxDays).toBe(90);
        expect(hook.result.requestedDays).toBe(90);
    });

    it("names one log that was refused while the other log of that workspace was read", async () => {
        azureWorkspacesMock.mockResolvedValue([bad(WS_A), ok(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.workspace?.summary.failed).toEqual([]);
        expect(hook.result.workspace?.logFailures).toEqual([{ name: WS_A.name, log: "Azure activity log", reason: "403" }]);
    });

    it("no chosen workspace holds the Azure activity log: that is known, not unknown", async () => {
        const none = (workspace: typeof WS_A): AzureWorkspaceRead => ({ workspace, ok: false, reason: "no activity log yet", noTable: true });
        azureWorkspacesMock.mockResolvedValue([none(WS_A), none(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(180);
        await settle();
        expect(hook.result.workspace?.sendingSubscriptionIds?.size).toBe(0);
        expect(hook.result.workspace?.logFailures).toEqual([]);
    });

    it("a group activation that only a workspace holds, older than 30 days, has its row and names the workspace", async () => {
        msal.data = { scopes: [scope], assignments: [groupHolding] };
        const older = buildDemoAuditRows(new Date()).map((raw) => ({ raw: { ...raw, activityDateTime: new Date(Date.parse(raw.activityDateTime) - 40 * DAY).toISOString() }, tenantId: TENANT }));
        entraWorkspacesMock.mockResolvedValue([{ workspace: WS_A, ok: true, rows: older, dropped: 0 }, entraOk(WS_B)]);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(120);
        await settle();
        const viaGroup = hook.result.events.filter((event) => event.viaGroup !== undefined);
        expect(viaGroup).toHaveLength(1);
        expect(viaGroup[0]).toMatchObject({ source: "azure-workspace", workspace: WS_A.name });
        expect(Date.parse(viaGroup[0].time)).toBeLessThan(Date.now() - 30 * DAY);
    });

    it("an older read that answers late writes nothing", async () => {
        let answerFirst: (value: AzureAuditRawRead) => void = () => undefined;
        armMock.mockImplementationOnce(() => new Promise<AzureAuditRawRead>((resolve) => { answerFirst = resolve; }));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load(30);
        await settle();
        hook.result.load(60);
        await settle();
        expect(hook.result.requestedDays).toBe(60);
        const events = hook.result.events;
        answerFirst(nativeRaw({ activity: [nativeRow("late", "Succeeded", daysAgo(1), "corr-late")] }));
        await settle();
        expect(hook.result.requestedDays).toBe(60);
        expect(hook.result.events).toEqual(events);
    });
});
