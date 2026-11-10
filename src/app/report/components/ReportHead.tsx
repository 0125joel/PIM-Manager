"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";

interface ReportHeadProps {
    /** "synced 3 min ago", or nothing while the data is not synced or loads */
    syncedText?: string;
    /** The shared Refresh button (`RefreshButton`); the compact header carries it below 640 */
    refresh: ReactNode;
    isExportDisabled: boolean;
    onExport: () => void;
    /** "Show more details" (calm details spec 2.3); left out with the setting More */
    detailsToggle?: ReactNode;
}

/** Title, the sync time, Refresh and Export (spec 2.1). Export is an icon button below 640. */
export function ReportHead({ syncedText, refresh, isExportDisabled, onExport, detailsToggle }: ReportHeadProps) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            {/* Below 640 the checkbox moves under the sentence, so the title and its sentence stay together */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-4">
                <h1 className={PAGE_TITLE_CLASS}>Report</h1>
                {detailsToggle && <div className="max-sm:order-last max-sm:basis-full">{detailsToggle}</div>}
                <p className="mt-1 basis-full text-sm leading-5 text-body">Roles and groups, as they are now.</p>
            </div>
            <div className="flex items-center gap-3">
                {syncedText && <span className="font-mono text-xs text-muted max-sm:hidden">{syncedText}</span>}
                <span className="max-sm:hidden" data-tour="refresh">{refresh}</span>
                <span className="max-sm:hidden">
                    <Button variant="primary" onClick={onExport} disabled={isExportDisabled} data-tour="report-export">Export</Button>
                </span>
                <span className="sm:hidden">
                    <Button variant="primary" icon="export" iconOnly label="Export" onClick={onExport} disabled={isExportDisabled} data-tour="report-export" />
                </span>
            </div>
        </div>
    );
}
