"use client";

import { useMsal } from "@azure/msal-react";
import { useCallback, useState, useSyncExternalStore } from "react";
import { acquireArmToken, isAzureEnabled, requestAzureConsent } from "@/utils/azureConsent";
import { WORKLOAD_STATE_EVENT } from "@/utils/workloadPreferences";

/** `needsAdmin` shows the admin-approval line under the button of the consent screen (spec 2) */
export type AzureConsentStatus = "idle" | "pending" | "needsAdmin" | "failed";

function subscribe(onChange: () => void): () => void {
    // `storage` covers other tabs, WORKLOAD_STATE_EVENT this tab (setAzureEnabled dispatches it)
    window.addEventListener("storage", onChange);
    window.addEventListener(WORKLOAD_STATE_EVENT, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(WORKLOAD_STATE_EVENT, onChange);
    };
}

/** Whether Azure is turned on in this browser, and `enable()` to turn it on with a consent popup */
export function useAzureConsent() {
    const { instance, accounts } = useMsal();
    const isEnabled = useSyncExternalStore(subscribe, () => isAzureEnabled(accounts[0]), () => false);
    const [status, setStatus] = useState<AzureConsentStatus>("idle");

    const enable = useCallback(async (): Promise<boolean> => {
        if (accounts.length === 0) {
            setStatus("failed");
            return false;
        }
        setStatus("pending");
        const outcome = await requestAzureConsent(instance, accounts[0]);
        setStatus(outcome === "granted" ? "idle" : outcome);
        return outcome === "granted";
    }, [instance, accounts]);

    return { isEnabled, status, enable };
}

/** The token function for the Azure provider: an ARM access token for the signed-in account */
export function useArmToken(): () => Promise<string> {
    const { instance, accounts } = useMsal();
    return useCallback(async () => {
        if (accounts.length === 0) throw new Error("No signed-in account for Azure Resource Manager");
        return acquireArmToken(instance, accounts[0]);
    }, [instance, accounts]);
}
