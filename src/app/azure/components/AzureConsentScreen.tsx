"use client";

import { Button } from "@/components/ui/Button";
import { PANEL_CLASS } from "@/components/ui/SectionHeader";
import { useAzureConsent, type AzureConsentStatus } from "@/hooks/useAzureConsent";

interface AzureConsentViewProps {
    status: AzureConsentStatus;
    onEnable: () => void;
}

/** The consent screen without MSAL, so a fixture route can render it */
export function AzureConsentView({ status, onEnable }: AzureConsentViewProps) {
    return (
        <div data-visual-section="azure-consent" className="mx-auto max-w-[1376px]">
            <div className={`${PANEL_CLASS} max-w-xl`}>
                <h1 className="text-xl leading-[26px] font-semibold text-ink">Turn on Azure resources</h1>
                <p className="mt-2 text-sm leading-5 text-body">
                    PIM Manager reads your Azure role assignments and role settings through Azure Resource Manager. Microsoft asks you to allow this once. What you see follows your Azure roles: you only see the subscriptions and resource groups you have access to.
                </p>
                <div className="mt-4">
                    <Button variant="primary" isLoading={status === "pending"} onClick={onEnable}>
                        Turn on Azure
                    </Button>
                </div>
                {status === "needsAdmin" && (
                    <p className="mt-3 text-[13px] leading-[18px] text-warn-text">
                        Your organization requires an administrator to approve this. Ask an administrator to grant consent for PIM Manager to Azure Service Management.
                    </p>
                )}
                {status === "failed" && <p className="mt-3 text-[13px] leading-[18px] text-body">Turning on Azure did not finish. Try again.</p>}
            </div>
        </div>
    );
}

/** The consent screen that every Azure route shows until Azure is turned on */
export function AzureConsentScreen() {
    const { status, enable } = useAzureConsent();
    return <AzureConsentView status={status} onEnable={() => void enable()} />;
}
