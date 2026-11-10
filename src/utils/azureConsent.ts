/**
 * Consent and token for Azure Resource Manager (spec 2). The MSAL instance and the storage are passed in, so the rules
 * are testable without a browser: the hook `useAzureConsent` and the Azure provider pass the real ones.
 *
 * MSAL errors are read by `errorCode` and `errorNo` (the AADSTS number of a server error), never by message text.
 */
import type { AccountInfo, AuthenticationResult, PopupRequest, SilentRequest } from "@azure/msal-browser";
import { AZURE_SCOPES } from "@/config/authConfig";
import { getErrorName } from "./errorUtils";
import { Logger } from "./logger";
import { notifyWorkloadStateChange } from "./workloadPreferences";

/**
 * localStorage flag, one per account: set once that account turned Azure on in this browser. Per account, because
 * sign-out leaves localStorage: with one flag for the browser, the next account to sign in would get an ARM consent
 * popup on page load without a click. The key ends in a short hash of `homeAccountId`, so no readable id is stored.
 */
export const AZURE_ENABLED_PREFIX = "pim_azure_enabled_";

/** The one flag for the whole browser used before; it no longer turns Azure on, and setting a flag removes it */
export const LEGACY_AZURE_ENABLED_KEY = "pim_azure_enabled";

/** The account a flag belongs to */
type FlagAccount = Pick<AccountInfo, "homeAccountId"> | null | undefined;

export type AzureConsentOutcome = "granted" | "needsAdmin" | "failed";

/** The part of the MSAL instance these functions use */
export interface ArmTokenClient {
    acquireTokenPopup(request: PopupRequest): Promise<AuthenticationResult>;
    acquireTokenSilent(request: SilentRequest): Promise<AuthenticationResult>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

/** FNV-1a, 32 bits, as 8 hex characters: tells accounts apart, it is not a secret */
function shortHash(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The flag key of one account; `homeAccountId` compares case-insensitively */
export function azureEnabledKey(account: Pick<AccountInfo, "homeAccountId">): string {
    return `${AZURE_ENABLED_PREFIX}${shortHash(account.homeAccountId.toLowerCase())}`;
}

export function isAzureEnabled(account: FlagAccount, storage: StorageLike | null = defaultStorage()): boolean {
    if (!account) return false;
    try {
        return storage?.getItem(azureEnabledKey(account)) === "true";
    } catch {
        return false;
    }
}

export function setAzureEnabled(enabled: boolean, account: FlagAccount, storage: StorageLike | null = defaultStorage()): void {
    if (!storage || !account) return;
    try {
        if (enabled) storage.setItem(azureEnabledKey(account), "true");
        else storage.removeItem(azureEnabledKey(account));
        storage.removeItem(LEGACY_AZURE_ENABLED_KEY);
    } catch {
        return;
    }
    notifyWorkloadStateChange();
}

/**
 * MSAL codes after which the admin-approval line shows. `user_cancelled`: the popup was closed, which is what a user
 * does on the "Need admin approval" page (the normal case in a customer tenant, gate U8). `access_denied`: consent was
 * refused in the popup. `consent_required` and `interaction_required`: there is still no grant.
 */
const NEEDS_ADMIN_CODES = new Set(["user_cancelled", "access_denied", "consent_required", "interaction_required"]);

/**
 * AADSTS numbers (Learn, reference-error-codes): 65001 DelegationDoesNotExist, 65004 UserDeclinedConsent,
 * 90094 AdminConsentRequired, 90095 AdminConsentRequiredRequestAccess.
 */
const NEEDS_ADMIN_ERROR_NUMBERS = new Set(["65001", "65004", "90094", "90095"]);

function readStringField(error: unknown, field: "errorCode" | "errorNo"): string | undefined {
    if (error && typeof error === "object" && field in error) {
        const value = (error as Record<string, unknown>)[field];
        if (typeof value === "string") return value;
    }
    return undefined;
}

/** Whether a failed consent asks for an administrator (the line under the button) or is another failure */
export function classifyAzureConsentError(error: unknown): Exclude<AzureConsentOutcome, "granted"> {
    if (getErrorName(error) === "InteractionRequiredAuthError") return "needsAdmin";
    const code = readStringField(error, "errorCode");
    if (code !== undefined && NEEDS_ADMIN_CODES.has(code)) return "needsAdmin";
    const errorNo = readStringField(error, "errorNo");
    if (errorNo !== undefined && NEEDS_ADMIN_ERROR_NUMBERS.has(errorNo)) return "needsAdmin";
    return "failed";
}

/**
 * Whether a token result belongs to the signed-in account. A popup can be finished with another account; a missing
 * account counts as another one. `homeAccountId` compares case-insensitively, as the flag key does.
 */
function isSameAccount(result: AuthenticationResult, account: Pick<AccountInfo, "homeAccountId">): boolean {
    const returned = result.account?.homeAccountId;
    return typeof returned === "string" && returned.toLowerCase() === account.homeAccountId.toLowerCase();
}

/**
 * Turns on Azure: a popup with `AZURE_SCOPES`, and the flag on success. While another popup is open
 * (`interaction_in_progress`) a silent request is tried instead, as `requestConsent` does for a Graph workload.
 * A token of another account never sets the flag: that gives `failed`.
 */
export async function requestAzureConsent(
    client: ArmTokenClient,
    account: AccountInfo,
    storage: StorageLike | null = defaultStorage(),
): Promise<AzureConsentOutcome> {
    const request = { scopes: AZURE_SCOPES, account };
    let result: AuthenticationResult;
    try {
        result = await client.acquireTokenPopup(request);
    } catch (popupError: unknown) {
        if (readStringField(popupError, "errorCode") !== "interaction_in_progress") {
            Logger.error("azureConsent", "Consent failed for Azure Resource Manager", popupError);
            return classifyAzureConsentError(popupError);
        }
        try {
            result = await client.acquireTokenSilent(request);
        } catch {
            // Another popup is still open: not a refusal, so no admin line
            return "failed";
        }
    }
    if (!isSameAccount(result, account)) {
        // No username, no token: only that the accounts differ
        Logger.warn("azureConsent", "The consent window was finished with another account; Azure stays off");
        return "failed";
    }
    setAzureEnabled(true, account, storage);
    return "granted";
}

/**
 * An ARM access token: silent first, a popup when interaction is required, as `getGraphClient` does. A popup finished
 * with another account throws: that token is never used for the account this page shows.
 */
export async function acquireArmToken(client: ArmTokenClient, account: AccountInfo): Promise<string> {
    const request = { scopes: AZURE_SCOPES, account };
    try {
        return (await client.acquireTokenSilent(request)).accessToken;
    } catch (error: unknown) {
        if (getErrorName(error) !== "InteractionRequiredAuthError") throw error;
    }
    const result = await client.acquireTokenPopup(request);
    if (!isSameAccount(result, account)) {
        throw new Error(`The sign-in window was finished as ${result.account?.username ?? "another account"}. PIM Manager is signed in as ${account.username}: sign in with that account.`);
    }
    return result.accessToken;
}
