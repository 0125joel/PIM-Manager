import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_LOG_PERMISSION, ALERTS_PERMISSION } from "@/config/constants";
import { setFeatureEnabled, setWorkloadVisible } from "@/utils/workloadPreferences";
import { useWorkloadPermissions } from "@/hooks/useWorkloadPermissions";
import { renderHook } from "../support/hookHarness";

/** The settings permission table: a consent popup that comes back with another account grants nothing. */

const TENANT = "22222222-0000-4000-8000-000000000001";
const HOME_ACCOUNT = `11111111-0000-4000-8000-000000000001.${TENANT}`;
const OTHER_ACCOUNT = `33333333-0000-4000-8000-000000000003.${TENANT}`;

const msal = vi.hoisted(() => ({
    instance: null as { acquireTokenSilent: (r: unknown) => Promise<unknown>; acquireTokenPopup: (r: unknown) => Promise<unknown> } | null,
    accounts: [] as Array<{ homeAccountId: string; tenantId: string }>,
}));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }) }));
vi.mock("@/contexts/UnifiedPimContext", () => ({ useUnifiedActions: () => ({ enableWorkload: vi.fn(async () => undefined) }) }));
vi.mock("@/hooks/useCustomExtensions", () => ({ useCustomExtensions: () => ({ status: "noConsent", loading: false, error: null, requestPermission: vi.fn(), reload: vi.fn() }) }));
vi.mock("@/hooks/useIncrementalConsent", () => ({
    useIncrementalConsent: () => ({ requestConsent: vi.fn(async () => false), requestWriteConsent: vi.fn(async () => false) }),
    WORKLOAD_SCOPES: { pimGroups: ["PrivilegedAccess.Read.AzureADGroup"] },
    WORKLOAD_WRITE_SCOPES: { directoryRoles: ["RoleManagement.ReadWrite.Directory"], pimGroups: ["PrivilegedAccess.ReadWrite.AzureADGroup"] },
    isWriteConsentGranted: () => false,
    setWriteConsentGranted: vi.fn(),
}));
vi.mock("@/utils/workloadPreferences", () => ({ setFeatureEnabled: vi.fn(), setWorkloadVisible: vi.fn() }));
vi.mock("@/utils/logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const enabledMock = vi.mocked(setFeatureEnabled);
const visibleMock = vi.mocked(setWorkloadVisible);

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every silent probe asks for consent, so each row offers its grant */
function consentRequired(): unknown {
    return Object.assign(new Error("consent required"), { errorCode: "consent_required" });
}

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [{ homeAccountId: HOME_ACCOUNT, tenantId: TENANT }];
    msal.instance = {
        acquireTokenSilent: vi.fn(async () => {
            throw consentRequired();
        }),
        acquireTokenPopup: vi.fn(),
    };
});

describe("useWorkloadPermissions grants from a consent popup", () => {
    it("does not mark the Audit log as granted when the popup finished with another account", async () => {
        const popup = vi.mocked(msal.instance!.acquireTokenPopup);
        popup.mockResolvedValue({ account: { homeAccountId: OTHER_ACCOUNT, tenantId: TENANT }, accessToken: "token" });
        const hook = renderHook(() => useWorkloadPermissions());
        await settle();
        const row = hook.result.rows.find((r) => r.id === "auditLog");
        expect(row?.action).toBe("grantRead");
        hook.result.act(row!);
        await settle();
        expect(popup).toHaveBeenCalledWith({ scopes: [AUDIT_LOG_PERMISSION], account: msal.accounts[0] });
        expect(hook.result.message).toEqual({ kind: "error", text: "The permission was not granted. The sign-in window may have been cancelled or blocked. Try again." });
    });

    it("does not switch Security alerts on when the popup returns no account", async () => {
        const popup = vi.mocked(msal.instance!.acquireTokenPopup);
        popup.mockResolvedValue({ account: null, accessToken: "token" });
        const hook = renderHook(() => useWorkloadPermissions());
        await settle();
        const row = hook.result.rows.find((r) => r.id === "securityAlerts");
        expect(row?.action).toBe("grantRead");
        hook.result.act(row!);
        await settle();
        expect(popup).toHaveBeenCalledWith({ scopes: [ALERTS_PERMISSION], account: msal.accounts[0] });
        expect(enabledMock).not.toHaveBeenCalled();
        expect(visibleMock).not.toHaveBeenCalled();
        expect(hook.result.message?.kind).toBe("error");
    });

    it("grants the Audit log when the popup finished with the same account", async () => {
        const popup = vi.mocked(msal.instance!.acquireTokenPopup);
        popup.mockResolvedValue({ account: { homeAccountId: HOME_ACCOUNT, tenantId: TENANT }, accessToken: "token" });
        const hook = renderHook(() => useWorkloadPermissions());
        await settle();
        hook.result.act(hook.result.rows.find((r) => r.id === "auditLog")!);
        await settle();
        expect(hook.result.message).toEqual({ kind: "success", text: "Permission granted." });
    });
});
