"use client";

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "@/config/authConfig";
import { ReactNode } from "react";

// Created on first render, not at module load, so importing this file on the
// redirect bridge page does not construct an MSAL instance there.
// MsalProvider calls initialize() and handleRedirectPromise() itself.
let msalInstance: PublicClientApplication | null = null;

function getMsalInstance(): PublicClientApplication {
    if (!msalInstance) {
        msalInstance = new PublicClientApplication(msalConfig);
    }
    return msalInstance;
}

export function AuthProvider({ children }: { children: ReactNode }) {
    return (
        <MsalProvider instance={getMsalInstance()}>
            {children}
        </MsalProvider>
    );
}
