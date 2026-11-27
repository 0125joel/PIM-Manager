import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { RawActivityEvent, RawArmRequest, RawDirectoryAudit } from "@/types/audit.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { demoGuid } from "@/demo/contoso/ids";
import { MS_PIM_APP_ID } from "@/utils/azureAuditEvents";
import { readAzureAudit, type AzureAuditRawRead } from "@/services/azureAuditService";
import { fetchAuditRows } from "@/services/auditService";
import { readServicePrincipalTypes } from "@/services/servicePrincipalTypeService";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { useAzureAuditData } from "@/hooks/useAzureAuditData";
import { loadAzureRoleDefinitions } from "@/hooks/useAzureDashboardReads";
import { renderHook } from "../support/hookHarness";

/**
 * The Azure Audit page's data hook, through the hook harness. MSAL, the contexts and the reads are replaced; nothing
 * reaches a tenant, and nothing may be written to storage.
 */

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
vi.mock("@/hooks/useAzureDashboardReads", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/useAzureDashboardReads")>()), loadAzureRoleDefinitions: vi.fn() }));
vi.mock("@/services/azureAuditService", () => ({ readAzureAudit: vi.fn() }));
vi.mock("@/services/servicePrincipalTypeService", () => ({ readServicePrincipalTypes: vi.fn() }));
vi.mock("@/services/auditService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditService")>()), fetchAuditRows: vi.fn() }));

const accountA = { homeAccountId: "11111111-0000-0000-0000-000000000001.22222222-0000-0000-0000-000000000001", tenantId: "22222222-0000-0000-0000-000000000001" };
const accountB = { homeAccountId: "33333333-0000-0000-0000-000000000002.44444444-0000-0000-0000-000000000002", tenantId: "44444444-0000-0000-0000-000000000002" };

const readMock = vi.mocked(readAzureAudit);
const fetchMock = vi.mocked(fetchAuditRows);
const typesMock = vi.mocked(readServicePrincipalTypes);
const definitionsMock = vi.mocked(loadAzureRoleDefinitions);
const GONE_ROLE = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";

const SUB = "/subscriptions/s-1";
const AUTH = "/providers/Microsoft.Authorization";
const GROUP_ID = "g-1";

const DAY = 86_400_000;
/** Dates relative to now, so the 90 day window of the hook keeps them */
const daysAgo = (days: number, plusMs = 0) => new Date(Date.now() - days * DAY + plusMs).toISOString();

const request = (name: string, props: Record<string, unknown>): RawArmRequest => ({
    id: `${SUB}${AUTH}/roleAssignmentScheduleRequests/${name}`,
    name,
    properties: { scope: SUB, roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/role-1`, principalId: "u-1", principalType: "User", requestorId: "u-1", requestType: "SelfActivate", status: "Provisioned", createdOn: daysAgo(5), ...(props as RawArmRequest["properties"]) },
});
const logRow = (id: string, at: string, principalId: string): RawActivityEvent[] => [
    { eventDataId: `${id}-a`, correlationId: id, eventTimestamp: at, caller: "admin@contoso.example", resourceId: `${SUB}${AUTH}/roleAssignments/${id}`, operationName: { value: "Microsoft.Authorization/roleAssignments/write" }, status: { value: "Started" }, properties: { requestbody: JSON.stringify({ properties: { principalId, principalType: "ServicePrincipal", roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/role-1` } }) } },
    { eventDataId: `${id}-b`, correlationId: id, eventTimestamp: at, caller: "admin@contoso.example", resourceId: `${SUB}${AUTH}/roleAssignments/${id}`, operationName: { value: "Microsoft.Authorization/roleAssignments/write" }, status: { value: "Succeeded" } },
];

function raw(extra: Partial<AzureAuditRawRead> = {}): AzureAuditRawRead {
    return {
        activity: logRow("l1", daysAgo(3), "sp-unknown"),
        assignmentRequests: [request("r1", {})],
        eligibilityRequests: [],
        notRead: [],
        tried: 3,
        ownRequestCount: 0,
        ...extra,
    };
}

const scope = (id: string, level: AzureScope["level"]): AzureScope => ({ id, name: id, level, parentId: null });
const groupHolding: AzureAssignment = {
    id: "a1", scopeId: SUB, principalId: GROUP_ID, principalName: "Platform Engineers", principalType: "Group", roleDefinitionId: "role-1", roleName: "Reader", state: "active", memberType: "direct", endDateTime: null,
};

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
const silentFails = () => vi.fn(async () => { throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" }); });

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [accountA];
    msal.data = { scopes: [scope(SUB, "subscription")], assignments: [groupHolding] };
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "silent-token" })), acquireTokenPopup: vi.fn() };
    readMock.mockResolvedValue(raw());
    fetchMock.mockResolvedValue([]);
    typesMock.mockResolvedValue(new Map());
    definitionsMock.mockResolvedValue({ status: "loaded", byId: new Map(), source: "tenant" });
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useAzureAuditData", () => {
    it("does nothing before load is called", () => {
        const hook = renderHook(() => useAzureAuditData());
        expect(hook.result.status).toBe("idle");
        expect(readMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("gives ready with events, the window of 90 days and the Entra state", async () => {
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.events.length).toBeGreaterThan(0);
        expect(hook.result.entraLog).toBe("read");
        const call = readMock.mock.calls[0][0];
        expect(Math.round((Date.parse(call.to) - Date.parse(call.from)) / 86_400_000)).toBe(90);
        expect(hook.result.oldest).toBe(call.from);
        expect(hook.result.readAt).not.toBeNull();
    });

    it("an Entra token failure leaves the page ready with no permission, and no popup", async () => {
        msal.instance = { acquireTokenSilent: silentFails(), acquireTokenPopup: vi.fn() };
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.entraLog).toBe("no permission");
        expect(msal.instance.acquireTokenPopup).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tells the Entra read errors by their reason", async () => {
        const hook = renderHook(() => useAzureAuditData());
        const cases: Array<[unknown, string]> = [
            [{ code: "Authentication_RequestFromUnsupportedUserRole", statusCode: 403 }, "no reader role"],
            [{ code: "Authorization_RequestDenied", statusCode: 403 }, "no permission"],
            [new AuditTooManyEventsError(), "too many"],
            [new Error("network"), "failed"],
        ];
        for (const [error, state] of cases) {
            fetchMock.mockRejectedValueOnce(error);
            hook.result.load();
            await settle();
            expect(hook.result.status, state).toBe("ready");
            expect(hook.result.entraLog, state).toBe(state);
        }
    });

    it("shows the approver and the group rows with Entra rows", async () => {
        const rows: RawDirectoryAudit[] = buildDemoAuditRows(new Date());
        fetchMock.mockResolvedValue(rows);
        msal.data = { scopes: [scope(SUB, "subscription")], assignments: [{ ...groupHolding, principalId: "g-platform" }] };
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.entraLog).toBe("read");
        const times = hook.result.events.map((e) => Date.parse(e.time));
        expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("looks up the kinds of unknown apps, and keeps them unknown when that fails", async () => {
        typesMock.mockResolvedValueOnce(new Map([["sp-unknown", "ServiceIdentity"]]));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(typesMock).toHaveBeenCalledWith(expect.anything(), ["sp-unknown"], expect.any(AbortSignal));
        expect(hook.result.holderKinds.get("sp-unknown")).toBe("agentIdentity");
        typesMock.mockRejectedValueOnce(new Error("graph down"));
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.holderKinds.has("sp-unknown")).toBe(false);
    });

    it("everything not read is failed, and notRead stays in the result", async () => {
        const notRead = [{ part: "log" as const, scopeId: SUB, reason: "forbidden" as const }];
        readMock.mockResolvedValue(raw({ activity: [], assignmentRequests: [], notRead, tried: 1 }));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("failed");
        expect(hook.result.notRead).toEqual(notRead);
        // The Entra audit log starts with the other reads, but its rows are not used when everything was not read
        expect(hook.result.events).toEqual([]);
        expect(hook.result.entraLog).toBeNull();
    });

    it("maps too many and any other error, and a failed reload keeps the events", async () => {
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        const kept = hook.result.events.length;
        readMock.mockRejectedValueOnce(new AuditTooManyEventsError());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("too-many");
        readMock.mockRejectedValueOnce(Object.assign(new Error("SECRET"), { statusCode: 500 }));
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("failed");
        expect(hook.result.events).toHaveLength(kept);
    });

    it("a new account clears the events and aborts the read", async () => {
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.events.length).toBeGreaterThan(0);
        let signal: AbortSignal | undefined;
        readMock.mockImplementationOnce((input) => { signal = input.signal; return new Promise(() => undefined); });
        hook.result.load();
        await settle();
        msal.accounts = [accountB];
        hook.rerender();
        await settle();
        expect(signal?.aborted).toBe(true);
        expect(hook.result.events).toEqual([]);
        expect(hook.result.readAt).toBeNull();
        expect(hook.result.status).toBe("idle");
    });

    it("a newer load wins over an older answer", async () => {
        const hook = renderHook(() => useAzureAuditData());
        let answerFirst: (value: AzureAuditRawRead) => void = () => undefined;
        readMock.mockImplementationOnce(() => new Promise<AzureAuditRawRead>((resolve) => { answerFirst = resolve; }));
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("loading");
        readMock.mockResolvedValueOnce(raw({ assignmentRequests: [], activity: [] }));
        hook.result.load();
        await settle();
        answerFirst(raw());
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.events).toEqual([]);
    });

    it("sets the approver from the Entra rows on the right request, and none without them", async () => {
        const name = demoGuid("azure:audit:request:approved");
        readMock.mockResolvedValue(raw({ activity: [], assignmentRequests: [request(name, { createdOn: daysAgo(13) }), request("other", { createdOn: daysAgo(4) })] }));
        fetchMock.mockResolvedValue(buildDemoAuditRows(new Date()));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        const approver = (id: string) => hook.result.events.find((e) => e.correlationId === id.toLowerCase())?.approver;
        expect(hook.result.events.map((e) => e.correlationId)).toContain(name);
        expect(approver(name)).toBe("Alex Wilber");
        expect(approver("other")).toBeUndefined();

        msal.instance = { acquireTokenSilent: silentFails(), acquireTokenPopup: vi.fn() };
        hook.rerender();
        hook.result.load();
        await settle();
        expect(hook.result.events.map((e) => e.correlationId)).toContain(name);
        expect(approver(name)).toBeUndefined();
    });

    it("adds a row per Azure role of a group from the Entra activations, and none without Entra rows", async () => {
        msal.data = { scopes: [scope(SUB, "subscription")], assignments: [{ ...groupHolding, principalId: demoGuid("group:platform") }] };
        fetchMock.mockResolvedValue(buildDemoAuditRows(new Date()));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        const viaGroup = hook.result.events.filter((e) => e.viaGroup !== undefined);
        expect(viaGroup).toHaveLength(1);
        expect(viaGroup[0].role.name).toBe("Reader");
        expect(viaGroup[0].sentence).toContain("activated Reader on");

        msal.instance = { acquireTokenSilent: silentFails(), acquireTokenPopup: vi.fn() };
        hook.rerender();
        hook.result.load();
        await settle();
        expect(hook.result.events.filter((e) => e.viaGroup !== undefined)).toEqual([]);
    });

    it("a second load aborts the signal of the first read", async () => {
        const signals: AbortSignal[] = [];
        readMock.mockImplementation((input) => {
            if (input.signal) signals.push(input.signal);
            return signals.length === 1 ? new Promise(() => undefined) : Promise.resolve(raw());
        });
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(signals[0].aborted).toBe(false);
        hook.result.load();
        await settle();
        expect(signals).toHaveLength(2);
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
    });

    it("keeps no event older than 90 days, still ends a request inside them by its log row, and keeps an event without a time", async () => {
        const start = Date.now() - 10 * DAY;
        const resource = `${SUB}${AUTH}/roleAssignments/d1`;
        const end = start + 3_600_000 + 60_000;
        const deleteRow = (suffix: string, status: string, extra: Partial<RawActivityEvent>): RawActivityEvent => ({
            eventDataId: `d-${suffix}`, correlationId: "d1", eventTimestamp: new Date(end + (suffix === "b" ? 2000 : 0)).toISOString(), caller: "pim", resourceId: resource,
            operationName: { value: "Microsoft.Authorization/roleAssignments/delete" }, status: { value: status }, ...extra,
        });
        const body = JSON.stringify({ properties: { principalId: "u-1", roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/role-1`, scope: SUB } });
        readMock.mockResolvedValue(raw({
            activity: [deleteRow("a", "Started", { claims: { appid: MS_PIM_APP_ID } }), deleteRow("b", "Succeeded", { claims: { appid: MS_PIM_APP_ID }, properties: { responseBody: body } })],
            assignmentRequests: [
                request("old", { createdOn: daysAgo(100) }),
                request("inside", { createdOn: new Date(start).toISOString(), scheduleInfo: { startDateTime: new Date(start).toISOString(), expiration: { duration: "PT1H" } } }),
                request("timeless", { createdOn: "" }),
            ],
        }));
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        const byId = (id: string) => hook.result.events.find((e) => e.correlationId === id);
        expect(byId("old")).toBeUndefined();
        expect(byId("inside")?.endedAt).toBeDefined();
        expect(byId("timeless")).toBeDefined();
        expect(byId("timeless")?.time).toBe("");
    });

    it("writes nothing to localStorage or sessionStorage", async () => {
        const storage = () => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
        const local = storage();
        const session = storage();
        vi.stubGlobal("localStorage", local);
        vi.stubGlobal("sessionStorage", session);
        const hook = renderHook(() => useAzureAuditData());
        hook.result.load();
        await settle();
        expect(hook.result.status).toBe("ready");
        for (const store of [local, session]) {
            expect(store.setItem).not.toHaveBeenCalled();
            expect(store.removeItem).not.toHaveBeenCalled();
        }
    });

    it("reads the period it is asked for, names it in requestedDays, and keeps the Entra read at 30 days", async () => {
        const hook = renderHook(() => useAzureAuditData());
        expect(hook.result.requestedDays).toBe(90);
        hook.result.load(7);
        await settle();
        const call = readMock.mock.calls[0][0];
        expect(Math.round((Date.parse(call.to) - Date.parse(call.from)) / DAY)).toBe(7);
        expect(hook.result.requestedDays).toBe(7);
        expect(hook.result.oldest).toBe(call.from);
        expect(Math.round((Date.now() - Date.parse(fetchMock.mock.calls[0][1])) / DAY)).toBe(30);
        hook.result.load();
        await settle();
        const again = readMock.mock.calls[1][0];
        expect(Math.round((Date.parse(again.to) - Date.parse(again.from)) / DAY)).toBe(90);
        expect(hook.result.requestedDays).toBe(90);
    });

    describe("the name of a role nobody holds any more", () => {
        const goneRequest = () => request("r-gone", { roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/${GONE_ROLE}` });
        const roleNames = (events: { role: { name: string } }[]) => events.map((event) => event.role.name);

        it("reads no definitions when every role is named", async () => {
            const hook = renderHook(() => useAzureAuditData());
            hook.result.load();
            await settle();
            expect(hook.result.status).toBe("ready");
            expect(definitionsMock).not.toHaveBeenCalled();
        });

        it("reads the definitions once and names the role by its definition", async () => {
            readMock.mockResolvedValue(raw({ assignmentRequests: [goneRequest()] }));
            definitionsMock.mockResolvedValue({ status: "loaded", source: "tenant", byId: new Map([[GONE_ROLE, { id: GONE_ROLE, name: GONE_ROLE, type: "CustomRole", properties: { roleName: "Contoso Old Operator" } }]]) });
            const hook = renderHook(() => useAzureAuditData());
            hook.result.load();
            await settle();
            expect(definitionsMock).toHaveBeenCalledTimes(1);
            expect(roleNames(hook.result.events)).toContain("Contoso Old Operator");
            expect(roleNames(hook.result.events)).not.toContain(GONE_ROLE);
        });

        it("keeps the events as they were when the read fails or is stopped", async () => {
            readMock.mockResolvedValue(raw({ assignmentRequests: [goneRequest()] }));
            for (const outcome of [{ status: "failed" as const }, { status: "loading" as const }, new Error("network")]) {
                if (outcome instanceof Error) definitionsMock.mockRejectedValueOnce(outcome);
                else definitionsMock.mockResolvedValueOnce(outcome);
                const hook = renderHook(() => useAzureAuditData());
                hook.result.load();
                await settle();
                expect(hook.result.status).toBe("ready");
                expect(roleNames(hook.result.events)).toContain(GONE_ROLE);
            }
        });
    });
});
