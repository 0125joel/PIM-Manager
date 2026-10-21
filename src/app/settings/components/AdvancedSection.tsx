"use client";

import { Button } from "@/components/ui/Button";
import type { AdvancedProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

export function AdvancedSection({ logLevel, logLevels, onLogLevelChange, onClearCache, isClearing, clearStatus, version }: AdvancedProps) {
    return (
        <SettingsSection id="advanced" title="Advanced" subline="For troubleshooting. The log level controls what the browser console shows (press F12 to open it).">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div>
                    <label htmlFor="log-level" className="mb-1.5 block text-xs text-muted">Log level</label>
                    <select
                        id="log-level"
                        value={logLevel}
                        onChange={(event) => onLogLevelChange(event.target.value)}
                        className="h-[34px] min-w-[200px] rounded-md border border-line bg-surface px-3 text-[13px] text-ink max-sm:h-11"
                    >
                        {logLevels.map((level) => (
                            <option key={level} value={level}>
                                {level.charAt(0) + level.slice(1).toLowerCase()}
                            </option>
                        ))}
                    </select>
                </div>
                <Button isLoading={isClearing} onClick={onClearCache}>Clear cached data</Button>
                {version && <p className="pb-2 font-mono text-xs text-muted">PIM Manager {version.replace(/^v/, "")}</p>}
            </div>
            <div role="status" className="mt-3 min-h-5">
                {clearStatus && <p className={`text-[13px] ${clearStatus.kind === "error" ? "text-danger-text" : "text-success-text"}`}>{clearStatus.text}</p>}
            </div>
        </SettingsSection>
    );
}
