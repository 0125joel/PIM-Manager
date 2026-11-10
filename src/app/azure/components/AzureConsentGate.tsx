"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useAzureConsent } from "@/hooks/useAzureConsent";
import { AzureConsentScreen } from "./AzureConsentScreen";

interface AzureConsentGateProps {
    children: ReactNode;
}

const noSubscribe = () => () => undefined;

/** Shows the consent screen instead of the Azure routes until Azure is turned on */
export function AzureConsentGate({ children }: AzureConsentGateProps) {
    const { isEnabled } = useAzureConsent();
    // False in the static HTML and during hydration, true after: the flag is only known in the browser
    const isClient = useSyncExternalStore(noSubscribe, () => true, () => false);
    if (!isClient) return null;
    if (!isEnabled) return <AzureConsentScreen />;
    return <>{children}</>;
}
