import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { createGraphClient } from "@/utils/graphClient";

const accountA = {
    homeAccountId: "a.t1",
    tenantId: "t1",
    username: "a@t1.example",
    localAccountId: "a",
    environment: "login.microsoftonline.com",
};

const accountB = {
    homeAccountId: "b.t2",
    tenantId: "t2",
    username: "b@t2.example",
    localAccountId: "b",
    environment: "login.microsoftonline.com",
};

const h = vi.hoisted(() => {
    const state: { fakeInstance: unknown; accountsRef: unknown[] } = {
        fakeInstance: null,
        accountsRef: [],
    };
    return state;
});

vi.mock("@azure/msal-react", () => {
    return {
        useMsal: () => ({ instance: h.fakeInstance, accounts: h.accountsRef, inProgress: "none" }),
        useIsAuthenticated: () => true,
        MsalProvider: ({ children }: { children: unknown }) => children,
        AuthenticatedTemplate: ({ children }: { children: unknown }) => children,
        UnauthenticatedTemplate: () => null,
    };
});

vi.mock("@/utils/graphClient", async (importOriginal) => {
    const actual: Record<string, unknown> = await importOriginal();
    return {
        ...actual,
        createGraphClient: vi.fn((token: string) => ({ token })),
    };
});

const mockCreateGraphClient = createGraphClient as unknown as ReturnType<typeof vi.fn>;

type GetGraphClient = () => Promise<unknown>;

async function getGraphClientFromProvider(): Promise<GetGraphClient> {
    const { UnifiedPimProvider, useUnifiedActions } = await import("@/contexts/UnifiedPimContext");

    let captured: GetGraphClient | undefined;
    function Child({ onCapture }: { onCapture: (fn: GetGraphClient) => void }) {
        onCapture((useUnifiedActions() as unknown as { getGraphClient: GetGraphClient }).getGraphClient);
        return null;
    }

    renderToString(React.createElement(UnifiedPimProvider, null, React.createElement(Child, { onCapture: (fn: GetGraphClient) => { captured = fn; } })));
    expect(captured).toBeTypeOf("function");
    return captured!;
}

describe("getGraphClient: account binding of the popup fallback", () => {
    beforeEach(() => {
        mockCreateGraphClient.mockClear();
    });

    it("rejects a popup token that belongs to another account", async () => {
        h.accountsRef = [accountA];
        h.fakeInstance = {
            acquireTokenSilent: vi.fn(async () => {
                throw new InteractionRequiredAuthError("interaction_required", "dummy");
            }),
            acquireTokenPopup: vi.fn(async () => ({
                accessToken: "token-B",
                account: accountB,
                tenantId: "t2",
            })),
            getAllAccounts: () => [accountA],
            getActiveAccount: () => null,
            addEventCallback: () => null,
            removeEventCallback: () => undefined,
        };

        const getGraphClient = await getGraphClientFromProvider();

        await expect(getGraphClient()).rejects.toThrow("sign in with that account");
        expect(mockCreateGraphClient).not.toHaveBeenCalled();
    });

    it("uses a popup token of the shown account itself", async () => {
        h.accountsRef = [accountA];
        h.fakeInstance = {
            acquireTokenSilent: vi.fn(async () => {
                throw new InteractionRequiredAuthError("interaction_required", "dummy");
            }),
            acquireTokenPopup: vi.fn(async () => ({
                accessToken: "token-A2",
                account: accountA,
                tenantId: "t1",
            })),
            getAllAccounts: () => [accountA],
            getActiveAccount: () => null,
            addEventCallback: () => null,
            removeEventCallback: () => undefined,
        };

        const getGraphClient = await getGraphClientFromProvider();

        const client = (await getGraphClient()) as { token: string };
        expect(mockCreateGraphClient).toHaveBeenCalledWith("token-A2");
        expect(client.token).toBe("token-A2");
    });
});
