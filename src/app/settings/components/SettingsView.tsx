"use client";

import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";
import { AccessModelLabelsSection } from "./AccessModelLabelsSection";
import { AdvancedSection } from "./AdvancedSection";
import { DisplaySection } from "./DisplaySection";
import { EmergencyAccountsSection } from "./EmergencyAccountsSection";
import { PermissionsSection } from "./PermissionsSection";
import { SettingsIndex } from "./SettingsIndex";
import type { SettingsViewProps } from "./settingsTypes";

/** The settings page body, driven by props only (no MSAL, no Graph) so the fixture page can show every state. */
export function SettingsView({ permissions, display, emergency, accessModel, advanced }: SettingsViewProps) {
    return (
        <div className="max-w-[1180px]">
            <h1 className={PAGE_TITLE_CLASS}>Settings</h1>
            <div className="mt-8 grid gap-8 lg:grid-cols-[220px_minmax(0,900px)] lg:gap-14">
                <SettingsIndex />
                <div className="space-y-12 pb-16">
                    <PermissionsSection {...permissions} />
                    <DisplaySection {...display} />
                    <EmergencyAccountsSection {...emergency} />
                    {accessModel && <AccessModelLabelsSection {...accessModel} />}
                    <AdvancedSection {...advanced} />
                </div>
            </div>
        </div>
    );
}
