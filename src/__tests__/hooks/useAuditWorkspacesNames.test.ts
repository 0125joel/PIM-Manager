import { beforeEach, describe, expect, it, vi } from "vitest";
import { listWorkspaces } from "@/services/auditWorkspaceService";
import { isAzureEnabled } from "@/utils/azureConsent";
import { readWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import { useAuditWorkspaces } from "@/hooks/useAuditWorkspaces";
import { renderHook } from "../support/hookHarness";

/** The Settings section names a chosen workspace from one silent listing on mount (AU-17): a failed listing changes nothing. */

const TENANT = "22222222-0000-4000-8000-000000000001";
const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const msal = vi.hoisted(() => ({
    instance: null as { acquireTokenSilent: (r: unknown) => Promise<unknown>; acquireTokenPopup: (r: unknown) => Promise<unknown> } | null,
    accounts: [] as Array<{ homeAccountId: string; tenantId: string }>,
}));

vi.mock("react", async () => await import("../support/hookHarness"));
vi.mock("@azure/msal-react", () => ({ useMsal: () => ({ instance: msal.instance, accounts: msal.accounts }) }));
vi.mock("@/hooks/useAzureConsent", () => ({ useAzureConsent: () => ({ enable: vi.fn(async () => false) }) }));
vi.mock("@/utils/azureConsent", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/utils/azureConsent")>()), isAzureEnabled: vi.fn(() => true) }));
vi.mock("@/utils/auditWorkspaceChoice", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/utils/auditWorkspaceChoice")>()), readWorkspaceChoice: vi.fn(() => [WS_A]) }));
vi.mock("@/services/auditWorkspaceService", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/services/auditWorkspaceService")>()), listWorkspaces: vi.fn() }));

const listMock = vi.mocked(listWorkspaces);
const enabledMock = vi.mocked(isAzureEnabled);
const choiceMock = vi.mocked(readWorkspaceChoice);

type Listing = Awaited<ReturnType<typeof listWorkspaces>>;
const listing = (): Listing => ({
    workspaces: [{ id: `/subscriptions/s/resourcegroups/rg/providers/microsoft.operationalinsights/workspaces/law-contoso`, customerId: WS_A, name: "law-contoso", subscriptionName: "Contoso", location: "westeurope", retentionDays: 90 }],
    failedSubscriptions: [],
} as unknown as Listing);

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    vi.clearAllMocks();
    msal.accounts = [{ homeAccountId: `11111111-0000-4000-8000-000000000001.${TENANT}`, tenantId: TENANT }];
    msal.instance = { acquireTokenSilent: vi.fn(async () => ({ accessToken: "token" })), acquireTokenPopup: vi.fn() };
    choiceMock.mockReturnValue([WS_A]);
    enabledMock.mockReturnValue(true);
});

describe("useAuditWorkspaces: the names of the chosen workspaces", () => {
    it("names a chosen workspace from one silent listing on mount, and stays chosen", async () => {
        listMock.mockResolvedValue(listing());
        const hook = renderHook(() => useAuditWorkspaces("Contoso"));
        await settle();
        expect(listMock).toHaveBeenCalledTimes(1);
        expect(hook.result.step).toBe("chosen");
        expect(hook.result.statuses[0]).toMatchObject({ customerId: WS_A, name: expect.stringContaining("law-contoso") });
    });

    it("changes nothing when the listing fails: the id stays", async () => {
        listMock.mockRejectedValue(new Error("offline"));
        const hook = renderHook(() => useAuditWorkspaces("Contoso"));
        await settle();
        expect(hook.result.step).toBe("chosen");
        expect(hook.result.statuses[0]).toMatchObject({ customerId: WS_A, name: WS_A });
    });

    it("reads no listing when Azure access is not enabled", async () => {
        enabledMock.mockReturnValue(false);
        renderHook(() => useAuditWorkspaces("Contoso"));
        await settle();
        expect(listMock).not.toHaveBeenCalled();
    });
});
