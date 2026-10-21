"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";

interface ReportHeadProps {
    /** "Synced 3 min ago." or nothing while the data is not synced or loads */
    syncedText?: string;
    /** The shared Refresh button (`RefreshButton`); the compact header carries it below 640 */
    refresh: ReactNode;
    isExportDisabled: boolean;
    onExport: () => void;
}

/** Title, the sync time, Refresh and Export (spec 2.1). Export is an icon button below 640. */
export function ReportHead({ syncedText, refresh, isExportDisabled, onExport }: ReportHeadProps) {
    return (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0">
                <h1 className={PAGE_TITLE_CLASS}>Report</h1>
                <p className="mt-1 text-sm leading-5 text-body">Roles and groups, as they are now.{syncedText ? ` ${syncedText}` : ""}</p>
            </div>
            <div className="flex items-center gap-3">
                <span className="max-sm:hidden">{refresh}</span>
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
