import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { mapAuditEvents } from "@/utils/auditEvents";
import { AuditTooManyEventsError } from "@/utils/auditErrors";
import { fetchAuditRows } from "@/services/auditService";
import { createGraphClient } from "@/utils/graphClient";
import { useAuditData } from "@/hooks/useAuditData";
import { renderHook } from "../support/hookHarness";

/**
 * The Audit page's data hook, run through the hook harness (no DOM here). MSAL, the Graph client and the audit read are
 * replaced; the rows are the demo's invented ones. Nothing reaches a tenant, and nothing may be written to storage.
 */

type Account = { homeAccountId: string; tenantId: string };
interface MsalStub {
    acquireTokenSilent: (request: unknown) => Promise<unknown>;
    acquireTokenPopup: (request: unknown) => Promise<unknown>;
}

const msal = vi.hoisted(() => ({
    instance: null as MsalStub | null,
    accounts: [] as Array<{ homeAccountId: string; tenantId: string }>,
}));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }) }));
vi.mock("@/utils/graphClient", () => ({ createGraphClient: vi.fn((token: string) => ({ token })) }));
vi.mock("@/services/auditService", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/services/auditService")>()),
    fetchAuditRows: vi.fn(),
}));

const accountA: Account = { homeAccountId: "11111111-0000-0000-0000-000000000001.22222222-0000-0000-0000-000000000001", tenantId: "22222222-0000-0000-0000-000000000001" };
const accountB: Account = { homeAccountId: "33333333-0000-0000-0000-000000000002.44444444-0000-0000-0000-000000000002", tenantId: "44444444-0000-0000-0000-000000000002" };

const fetchMock = vi.mocked(fetchAuditRows);
const graphClientMock = vi.mocked(createGraphClient);
const rows: RawDirectoryAudit[] = buildDemoAuditRows(new Date());

/** Lets queued promises and their state updates run */
async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const silentFails = () => vi.fn(async () => { throw Object.assign(new Error("no consent"), { errorCode: "interaction_required" }); });

/** MSAL with a silent token (`silent`), and a popup that answers `popupAccount` */
function stubMsal(options: { silent?: boolean; popupAccount?: Account } = {}): void {
    const { silent = true, popupAccount = accountA } = options;
    msal.instance = {
        acquireTokenSilent: silent ? vi.fn(async () => ({ accessToken: "silent-token" })) : silentFails(),
        acquireTokenPopup: vi.fn(async () => ({ accessToken: "popup-token", account: popupAccount })),
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [accountA];
    stubMsal();
    fetchMock.mockResolvedValue(rows);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("useAuditData", () => {
    it("does not read until load is called", () => {
        const hook = renderHook(() => useAuditData());
        expect(hook.result.status).toBe("idle");
        expect(hook.result.events).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("without a silent token: permission, and no Graph call", async () => {
        stubMsal({ silent: false });
        const hook = renderHook(() => useAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("permission");
        expect(fetchMock).not.toHaveBeenCalled();
        expect(graphClientMock).not.toHaveBeenCalled();
    });

    it("a token failure that is not about consent is a failed read, never a question about permission", async () => {
        msal.instance = { acquireTokenSilent: vi.fn(async () => { throw Object.assign(new Error("offline"), { errorCode: "network_error" }); }), acquireTokenPopup: vi.fn() };
        const hook = renderHook(() => useAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("failed");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a closed consent popup keeps asking for the permission", async () => {
        msal.instance = { acquireTokenSilent: silentFails(), acquireTokenPopup: vi.fn(async () => { throw Object.assign(new Error("closed"), { errorCode: "user_cancelled" }); }) };
        const hook = renderHook(() => useAuditData());
        await hook.result.requestPermission();
        await settle();
        expect(hook.result.status).toBe("permission");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a load gives ready, with the mapped events, the read time and the start of the window", async () => {
        const hook = renderHook(() => useAuditData());
        const before = Date.now();
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.events).toEqual(mapAuditEvents(rows));
        expect(hook.result.events.some((e) => e.kind === "usage")).toBe(true);
        expect(Date.parse(hook.result.readAt ?? "")).toBeGreaterThanOrEqual(before);
        const oldest = Date.parse(hook.result.oldest ?? "");
        expect(Math.round((Date.now() - oldest) / 86_400_000)).toBe(30);
        expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ token: "silent-token" }), hook.result.oldest, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    it("maps each error to its status, and a failed reload of the same tenant keeps the events", async () => {
        const hook = renderHook(() => useAuditData());
        hook.result.load(30);
        await settle();
        const kept = hook.result.events.length;
        expect(kept).toBeGreaterThan(0);
        const cases: Array<[unknown, string]> = [
            [{ code: "Authentication_RequestFromUnsupportedUserRole", statusCode: 403 }, "role-missing"],
            [{ code: "Authorization_RequestDenied", statusCode: 403 }, "permission"],
            [new AuditTooManyEventsError(), "too-many"],
            [new Error("network"), "failed"],
        ];
        for (const [error, status] of cases) {
            fetchMock.mockRejectedValueOnce(error);
            hook.result.load(30);
            await settle();
            expect(hook.result.status, status).toBe(status);
            expect(hook.result.events.length, status).toBe(kept);
        }
    });

    it("a new account or tenant clears the events, the read time and the window", async () => {
        const hook = renderHook(() => useAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.events.length).toBeGreaterThan(0);
        msal.accounts = [accountB];
        hook.rerender();
        await settle();
        expect(hook.result.events).toEqual([]);
        expect(hook.result.readAt).toBeNull();
        expect(hook.result.oldest).toBeNull();
        expect(hook.result.status).toBe("idle");
    });

    it("writes nothing to localStorage or sessionStorage", async () => {
        const storage = () => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), key: vi.fn(), length: 0 });
        const local = storage();
        const session = storage();
        vi.stubGlobal("localStorage", local);
        vi.stubGlobal("sessionStorage", session);
        const hook = renderHook(() => useAuditData());
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("ready");
        for (const store of [local, session]) {
            expect(store.setItem).not.toHaveBeenCalled();
            expect(store.removeItem).not.toHaveBeenCalled();
        }
    });

    it("a new load aborts the read in flight, and the stale answer does not overwrite", async () => {
        const hook = renderHook(() => useAuditData());
        let answerFirst: (value: RawDirectoryAudit[]) => void = () => undefined;
        fetchMock.mockImplementationOnce(() => new Promise<RawDirectoryAudit[]>((resolve) => { answerFirst = resolve; }));
        hook.result.load(30);
        await settle();
        expect(hook.result.status).toBe("loading");
        const newer = rows.slice(0, 5);
        fetchMock.mockResolvedValueOnce(newer);
        hook.result.load(7);
        await settle();
        answerFirst(rows);
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.events).toEqual(mapAuditEvents(newer));
    });

    it("requestPermission asks by popup, then reads with the days of the last load", async () => {
        stubMsal({ silent: false });
        const hook = renderHook(() => useAuditData());
        hook.result.load(7);
        await settle();
        expect(hook.result.status).toBe("permission");
        expect(fetchMock).not.toHaveBeenCalled();

        await hook.result.requestPermission();
        await settle();
        expect(hook.result.status).toBe("ready");
        expect(hook.result.isRequestingPermission).toBe(false);
        expect(fetchMock).toHaveBeenLastCalledWith(expect.objectContaining({ token: "popup-token" }), expect.any(String), expect.anything());
        const oldest = Date.parse(hook.result.oldest ?? "");
        expect(Math.round((Date.now() - oldest) / 86_400_000)).toBe(7);
    });

    it("a consent popup finished with another account reads nothing", async () => {
        stubMsal({ silent: false, popupAccount: accountB });
        const hook = renderHook(() => useAuditData());
        await hook.result.requestPermission();
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hook.result.status).toBe("permission");
        expect(hook.result.isRequestingPermission).toBe(false);
    });
});
