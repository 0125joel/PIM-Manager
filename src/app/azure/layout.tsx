import type { ReactNode } from "react";
import { AzureProvider } from "@/contexts/AzureContext";
import { AzureConsentGate } from "./components/AzureConsentGate";

/**
 * The Azure environment (Azure spec 1). The Entra provider keeps wrapping every page and loads nothing here, because
 * Entra data loads on page mount; the Azure provider (spec 5) holds the Azure data for the pages below.
 * Until Azure is turned on, every Azure route shows the consent screen (spec 2).
 */
export default function AzureLayout({ children }: { children: ReactNode }) {
    return <AzureProvider><AzureConsentGate>{children}</AzureConsentGate></AzureProvider>;
}
