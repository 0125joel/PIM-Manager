import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountInfo, AuthenticationResult } from "@azure/msal-browser";
import { AZURE_SCOPES } from "@/config/authConfig";
import {
    acquireArmToken,
    AZURE_ENABLED_PREFIX,
    azureEnabledKey,
    classifyAzureConsentError,
    LEGACY_AZURE_ENABLED_KEY,
    isAzureEnabled,
    requestAzureConsent,
    setAzureEnabled,
    type ArmTokenClient,
} from "@/utils/azureConsent";
import { Logger } from "@/utils/logger";
import { DEMO_HOME_ACCOUNT_ID } from "@/demo/contoso/account";

const ACCOUNT: AccountInfo = {
    homeAccountId: "home",
    environment: "login.microsoftonline.com",
    tenantId: "tenant",
    username: "user@contoso.example",
    localAccountId: "local",
};

function memoryStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
        removeItem: (key: string) => { data.delete(key); },
    };
}

const OTHER_ACCOUNT: AccountInfo = { ...ACCOUNT, homeAccountId: "second-home", username: "second@contoso.example", localAccountId: "other-local" };

/** A token result as MSAL returns it: the token and the account that finished the request (the signed-in one by default) */
function token(accessToken: string, account: AccountInfo | null = ACCOUNT): AuthenticationResult {
    return { accessToken, account } as AuthenticationResult;
}

/** An MSAL error as the library builds it: `errorCode`, and for a server error the AADSTS number in `errorNo` */
function msalError(errorCode: string, extra: { name?: string; errorNo?: string } = {}): Error {
    return Object.assign(new Error("message text is never read"), { errorCode, ...extra });
}

function client(popup: () => Promise<AuthenticationResult>, silent: () => Promise<AuthenticationResult>) {
    return {
        acquireTokenPopup: vi.fn(popup),
        acquireTokenSilent: vi.fn(silent),
    } satisfies ArmTokenClient;
}

beforeEach(() => {
    vi.spyOn(Logger, "error").mockImplementation(() => undefined);
    vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("azure consent: the flag", () => {
    const OTHER: Pick<AccountInfo, "homeAccountId"> = { homeAccountId: "other" };

    it("is a key per account that holds no readable id", () => {
        const key = azureEnabledKey(ACCOUNT);
        expect(key).toMatch(new RegExp(`^${AZURE_ENABLED_PREFIX}[0-9a-f]{8}$`));
        expect(key).not.toContain("home");
        expect(azureEnabledKey({ homeAccountId: "HOME" })).toBe(key);
        expect(azureEnabledKey(OTHER)).not.toBe(key);
    });

    it("is off without storage or account, off when absent, on only for the string true", () => {
        expect(isAzureEnabled(ACCOUNT, null)).toBe(false);
        expect(isAzureEnabled(undefined, memoryStorage({ [azureEnabledKey(ACCOUNT)]: "true" }))).toBe(false);
        expect(isAzureEnabled(ACCOUNT, memoryStorage())).toBe(false);
        expect(isAzureEnabled(ACCOUNT, memoryStorage({ [azureEnabledKey(ACCOUNT)]: "1" }))).toBe(false);
        expect(isAzureEnabled(ACCOUNT, memoryStorage({ [azureEnabledKey(ACCOUNT)]: "true" }))).toBe(true);
    });

    it("of one account does not turn Azure on for another account in the same browser", () => {
        const storage = memoryStorage();
        setAzureEnabled(true, ACCOUNT, storage);
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(true);
        expect(isAzureEnabled(OTHER, storage)).toBe(false);
    });

    it("of the browser from before no longer turns Azure on, and setting a flag removes it", () => {
        const storage = memoryStorage({ [LEGACY_AZURE_ENABLED_KEY]: "true" });
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
        setAzureEnabled(true, ACCOUNT, storage);
        expect(storage.getItem(LEGACY_AZURE_ENABLED_KEY)).toBeNull();
        setAzureEnabled(false, ACCOUNT, storage);
        expect(storage.getItem(azureEnabledKey(ACCOUNT))).toBeNull();
    });

    it("treats a storage that throws as off", () => {
        const storage = { ...memoryStorage(), getItem: () => { throw new Error("blocked"); } };
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
    });
});

describe("azure consent: which failure shows the admin line", () => {
    it.each([
        ["user_cancelled"],
        ["access_denied"],
        ["consent_required"],
        ["interaction_required"],
    ])("errorCode %s needs an administrator", (code) => {
        expect(classifyAzureConsentError(msalError(code))).toBe("needsAdmin");
    });

    it.each([["65001"], ["65004"], ["90094"], ["90095"]])("AADSTS%s needs an administrator", (errorNo) => {
        expect(classifyAzureConsentError(msalError("invalid_request", { errorNo }))).toBe("needsAdmin");
    });

    it("an InteractionRequiredAuthError needs an administrator", () => {
        expect(classifyAzureConsentError(msalError("some_code", { name: "InteractionRequiredAuthError" }))).toBe("needsAdmin");
    });

    it.each([
        ["a blocked popup", msalError("popup_window_error")],
        ["another server error", msalError("invalid_request", { errorNo: "50011" })],
        ["a network error", new TypeError("Failed to fetch")],
        ["a message that only mentions consent", new Error("AADSTS65001 consent_required")],
        ["undefined", undefined],
    ])("%s is another failure", (_label, error) => {
        expect(classifyAzureConsentError(error)).toBe("failed");
    });
});

describe("azure consent: turning Azure on", () => {
    it("asks a popup with the ARM scope and sets the flag when it succeeds", async () => {
        const storage = memoryStorage();
        const msal = client(async () => token("t"), async () => token("t"));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("granted");
        expect(msal.acquireTokenPopup).toHaveBeenCalledWith({ scopes: AZURE_SCOPES, account: ACCOUNT });
        expect(AZURE_SCOPES).toEqual(["https://management.azure.com/user_impersonation"]);
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(true);
    });

    it("a refused consent gives needsAdmin and leaves the flag off", async () => {
        const storage = memoryStorage();
        const msal = client(async () => { throw msalError("access_denied", { errorNo: "65004" }); }, async () => token("t"));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("needsAdmin");
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
        expect(Logger.error).toHaveBeenCalledOnce();
    });

    it("a closed popup on the admin-approval page gives needsAdmin", async () => {
        const msal = client(async () => { throw msalError("user_cancelled"); }, async () => token("t"));
        await expect(requestAzureConsent(msal, ACCOUNT, memoryStorage())).resolves.toBe("needsAdmin");
    });

    it("a blocked popup gives failed", async () => {
        const msal = client(async () => { throw msalError("popup_window_error"); }, async () => token("t"));
        await expect(requestAzureConsent(msal, ACCOUNT, memoryStorage())).resolves.toBe("failed");
    });

    it("with another popup open, a silent token turns Azure on", async () => {
        const storage = memoryStorage();
        const msal = client(async () => { throw msalError("interaction_in_progress"); }, async () => token("t"));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("granted");
        expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: AZURE_SCOPES, account: ACCOUNT });
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(true);
    });

    it("with another popup open and no silent token, it fails without the admin line", async () => {
        const storage = memoryStorage();
        const msal = client(
            async () => { throw msalError("interaction_in_progress"); },
            async () => { throw msalError("consent_required", { name: "InteractionRequiredAuthError" }); },
        );

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("failed");
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
    });

    it("a popup finished with the same account sets the flag, also when homeAccountId differs in case", async () => {
        const storage = memoryStorage();
        const msal = client(async () => token("t", { ...ACCOUNT, homeAccountId: "HOME" }), async () => token("t"));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("granted");
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(true);
    });

    it.each([
        ["another account", OTHER_ACCOUNT],
        ["no account", null],
    ])("a popup finished with %s gives failed and sets no flag", async (_label, returned) => {
        const storage = memoryStorage();
        const msal = client(async () => token("t", returned), async () => token("t"));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("failed");
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
        expect(isAzureEnabled(OTHER_ACCOUNT, storage)).toBe(false);
        expect(Logger.warn).toHaveBeenCalledOnce();
        // The log names no account and holds no token
        const logged = JSON.stringify(vi.mocked(Logger.warn).mock.calls);
        expect(logged).not.toContain(ACCOUNT.username);
        expect(logged).not.toContain(OTHER_ACCOUNT.username);
        expect(logged).not.toContain(OTHER_ACCOUNT.homeAccountId);
    });

    it("with another popup open, a silent token of another account sets no flag", async () => {
        const storage = memoryStorage();
        const msal = client(async () => { throw msalError("interaction_in_progress"); }, async () => token("t", OTHER_ACCOUNT));

        await expect(requestAzureConsent(msal, ACCOUNT, storage)).resolves.toBe("failed");
        expect(isAzureEnabled(ACCOUNT, storage)).toBe(false);
    });
});

describe("azure consent: the ARM token", () => {
    it("is taken silently when it can be", async () => {
        const msal = client(async () => token("popup"), async () => token("silent"));

        await expect(acquireArmToken(msal, ACCOUNT)).resolves.toBe("silent");
        expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: AZURE_SCOPES, account: ACCOUNT });
        expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
    });

    it("falls back to a popup when interaction is required", async () => {
        const msal = client(
            async () => token("popup"),
            async () => { throw msalError("interaction_required", { name: "InteractionRequiredAuthError" }); },
        );

        await expect(acquireArmToken(msal, ACCOUNT)).resolves.toBe("popup");
        expect(msal.acquireTokenPopup).toHaveBeenCalledWith({ scopes: AZURE_SCOPES, account: ACCOUNT });
    });

    it("passes any other error on, without a popup", async () => {
        const failure = msalError("no_network_connectivity");
        const msal = client(async () => token("popup"), async () => { throw failure; });

        await expect(acquireArmToken(msal, ACCOUNT)).rejects.toBe(failure);
        expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
    });

    it.each([
        ["another account", OTHER_ACCOUNT, "The sign-in window was finished as second@contoso.example. PIM Manager is signed in as user@contoso.example: sign in with that account."],
        ["no account", null, "The sign-in window was finished as another account. PIM Manager is signed in as user@contoso.example: sign in with that account."],
    ])("refuses the popup token of %s", async (_label, returned, message) => {
        const msal = client(
            async () => token("popup", returned),
            async () => { throw msalError("interaction_required", { name: "InteractionRequiredAuthError" }); },
        );

        await expect(acquireArmToken(msal, ACCOUNT)).rejects.toThrow(message);
    });
});

describe("azure consent: the demo", () => {
    it("signs in and finishes every token request with the same account, so Azure turns on and the token is used", async () => {
        const { demoMsalInstance } = await import("@/demo/runtime/DemoAuthProvider");
        const account = demoMsalInstance.getAllAccounts()[0];
        const storage = memoryStorage();

        expect(account.homeAccountId).toBe(DEMO_HOME_ACCOUNT_ID);
        await expect(requestAzureConsent(demoMsalInstance, account, storage)).resolves.toBe("granted");
        expect(isAzureEnabled(account, storage)).toBe(true);
        expect((await demoMsalInstance.acquireTokenPopup({ scopes: AZURE_SCOPES, account })).account?.homeAccountId).toBe(DEMO_HOME_ACCOUNT_ID);
    });
});
