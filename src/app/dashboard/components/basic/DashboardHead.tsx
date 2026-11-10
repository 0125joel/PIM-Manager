"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";
import type { ViewMode } from "@/contexts/ViewModeContext";

const VIEW_OPTIONS = [
    { value: "basic" as const, label: "Basic" },
    { value: "advanced" as const, label: "Advanced" },
];

interface DashboardHeadProps {
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    /** "synced 12 min ago" */
    syncStatus: ReactNode;
    /** The shared Refresh button (`RefreshButton`); the head hides it below 640, where the compact header carries it */
    refresh: ReactNode;
    isExportDisabled: boolean;
    onExport: () => void;
    /** Advanced only: the Privileged roles or All roles control (NG-37) */
    scopeControl?: ReactNode;
    /** "Show more details" (calm details spec 2.3); left out with the setting More */
    detailsToggle?: ReactNode;
}

/** Title, Basic or Advanced, the sync time, Refresh and Export (spec 4.1). The chips and the filter bar sit under it. */
export function DashboardHead({ viewMode, onViewModeChange, syncStatus, refresh, isExportDisabled, onExport, scopeControl, detailsToggle }: DashboardHeadProps) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h1 className={PAGE_TITLE_CLASS}>Dashboard</h1>
            <div data-tour="view-mode">
                <SegmentedControl variant="tablist" ariaLabel="Dashboard view" options={VIEW_OPTIONS} value={viewMode} onChange={onViewModeChange} />
            </div>
            {scopeControl && <div data-tour="scope-control">{scopeControl}</div>}
            {/* Below 640 the checkbox goes to its own last line, so Refresh and Export stay on the row of Basic and Advanced */}
            {detailsToggle && <div className="max-sm:order-last max-sm:basis-full">{detailsToggle}</div>}
            {/* Below 640 the compact header carries Refresh (spec 3.2); Export stays here on every width */}
            <div className="ml-auto flex items-center gap-3">
                <span className="max-sm:hidden">{syncStatus}</span>
                <span className="max-sm:hidden" data-tour="refresh">{refresh}</span>
                {/* Below 1024 an icon button, as the Report head does below 640: a primary button without visible text read as an empty blue block */}
                <span className="max-lg:hidden">
                    <Button variant="primary" onClick={onExport} disabled={isExportDisabled} data-tour="dashboard-export-pdf">Export</Button>
                </span>
                <span className="lg:hidden">
                    <Button variant="primary" icon="export" iconOnly label="Export" onClick={onExport} disabled={isExportDisabled} data-tour="dashboard-export-pdf" />
                </span>
            </div>
        </div>
    );
}
