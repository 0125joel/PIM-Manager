"use client";

import { useMemo, type ReactNode } from "react";
import { MsalContext } from "@azure/msal-react";
import {
    InteractionStatus,
    Logger,
    stubbedPublicClientApplication,
    type AccountInfo,
    type AuthenticationResult,
    type IPublicClientApplication,
} from "@azure/msal-browser";
import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { exitDemo } from "./session";

/**
 * MSAL for the demo: Alex Wilber of Contoso is signed in and has consented to every permission, so every silent token
 * request and every consent popup succeeds at once with a token that only the fake Graph accepts. No MSAL instance is
 * created and nothing is sent to Microsoft Entra ID. Signing out leaves the demo.
 */

const account: AccountInfo = {
    homeAccountId: `${DEMO_ACCOUNT.id}.${DEMO_ACCOUNT.tenantId}`,
    environment: "login.microsoftonline.com",
    tenantId: DEMO_ACCOUNT.tenantId,
    username: DEMO_ACCOUNT.userPrincipalName,
    localAccountId: DEMO_ACCOUNT.id,
    name: DEMO_ACCOUNT.displayName,
};

function tokenFor(request?: { scopes?: string[] }): AuthenticationResult {
    return {
        authority: `https://login.microsoftonline.com/${DEMO_ACCOUNT.tenantId}`,
        uniqueId: DEMO_ACCOUNT.id,
        tenantId: DEMO_ACCOUNT.tenantId,
        scopes: request?.scopes ?? [],
        account,
        idToken: "",
        idTokenClaims: {},
        accessToken: "demo-token",
        fromCache: true,
        expiresOn: new Date(Date.now() + 3_600_000),
        tokenType: "Bearer",
        correlationId: "demo",
    };
}

const logger = new Logger({});

export const demoMsalInstance: IPublicClientApplication = {
    ...stubbedPublicClientApplication,
    initialize: () => Promise.resolve(),
    handleRedirectPromise: () => Promise.resolve(null),
    getAllAccounts: () => [account],
    getAccount: () => account,
    getActiveAccount: () => account,
    setActiveAccount: () => undefined,
    acquireTokenSilent: (request) => Promise.resolve(tokenFor(request)),
    acquireTokenPopup: (request) => Promise.resolve(tokenFor(request)),
    ssoSilent: (request) => Promise.resolve(tokenFor(request)),
    loginPopup: (request) => Promise.resolve(tokenFor(request)),
    acquireTokenRedirect: () => Promise.resolve(),
    loginRedirect: () => Promise.resolve(),
    logoutRedirect: () => {
        exitDemo();
        return Promise.resolve();
    },
    logoutPopup: () => {
        exitDemo();
        return Promise.resolve();
    },
    addEventCallback: () => "demo",
    removeEventCallback: () => undefined,
    getLogger: () => logger,
    initializeWrapperLibrary: () => undefined,
};

export function DemoAuthProvider({ children }: { children: ReactNode }) {
    const value = useMemo(() => ({ instance: demoMsalInstance, inProgress: InteractionStatus.None, accounts: [account], logger }), []);
    return <MsalContext.Provider value={value}>{children}</MsalContext.Provider>;
}
