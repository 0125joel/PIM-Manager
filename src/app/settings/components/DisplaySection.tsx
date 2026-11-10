"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { DisplayProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

export function DisplaySection({ theme, onThemeChange, viewMode, onViewModeChange, azureReportView, onAzureReportViewChange, details, onDetailsChange, tours, onToursChange }: DisplayProps) {
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
                <div className="max-w-[300px]">
                    <p className="mb-1.5 text-xs text-muted">Details</p>
                    <SegmentedControl
                        variant="pill"
                        ariaLabel="Details"
                        options={[
                            { value: "fewer", label: "Fewer" },
                            { value: "more", label: "More" },
                        ]}
                        value={details}
                        onChange={onDetailsChange}
                    />
                    <p className="mt-1.5 text-xs leading-4 text-muted">On the Dashboard and the Report. With Fewer, each page remembers its own &quot;Show more details&quot;. With More, every page shows everything. Changing this resets the pages.</p>
                </div>
                <div>
                    <p className="mb-1.5 text-xs text-muted">Azure Report opens in</p>
                    <SegmentedControl
                        variant="pill"
                        ariaLabel="Azure Report opens in"
                        options={[
                            { value: "roles", label: "Roles" },
                            { value: "assignments", label: "Assignments" },
                        ]}
                        value={azureReportView}
                        onChange={onAzureReportViewChange}
                    />
                </div>
                <div className="max-w-[300px]">
                    <p className="mb-1.5 text-xs text-muted">Tours</p>
                    <SegmentedControl
                        variant="pill"
                        ariaLabel="Tours"
                        options={[
                            { value: "on", label: "On" },
                            { value: "off", label: "Off" },
                        ]}
                        value={tours}
                        onChange={onToursChange}
                    />
                    <p className="mt-1.5 text-xs leading-4 text-muted">A short tour starts the first time you open a page. With Off, none start by themselves; Start the tour in Help still works.</p>
                </div>
            </div>
        </SettingsSection>
    );
}
