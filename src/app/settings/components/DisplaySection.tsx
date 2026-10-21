"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { DisplayProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

export function DisplaySection({ theme, onThemeChange, viewMode, onViewModeChange }: DisplayProps) {
    return (
        <SettingsSection id="display" title="Display" subline="Preferences for this browser.">
            <div className="flex flex-wrap gap-x-10 gap-y-5">
                <div className="w-full max-w-[300px]">
                    <p className="mb-1.5 text-xs text-muted" id="display-theme-label">Theme</p>
                    <SegmentedControl
                        variant="radiogroup"
                        ariaLabel="Theme"
                        options={[
                            { value: "light", label: "Light" },
                            { value: "dark", label: "Dark" },
                            { value: "system", label: "System" },
                        ]}
                        value={theme}
                        onChange={onThemeChange}
                    />
                </div>
                <div>
                    <p className="mb-1.5 text-xs text-muted">Dashboard opens in</p>
                    <SegmentedControl
                        variant="pill"
                        ariaLabel="Dashboard opens in"
                        options={[
                            { value: "basic", label: "Basic" },
                            { value: "advanced", label: "Advanced" },
                        ]}
                        value={viewMode}
                        onChange={onViewModeChange}
                    />
                </div>
            </div>
        </SettingsSection>
    );
}
