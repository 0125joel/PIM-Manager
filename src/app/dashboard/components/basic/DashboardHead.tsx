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
}

/** Title, Basic or Advanced, the sync time, Refresh and Export (spec 4.1). The chips and the filter bar sit under it. */
export function DashboardHead({ viewMode, onViewModeChange, syncStatus, refresh, isExportDisabled, onExport, scopeControl }: DashboardHeadProps) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h1 className={PAGE_TITLE_CLASS}>Dashboard</h1>
            <div data-tour="view-mode">
                <SegmentedControl variant="tablist" ariaLabel="Dashboard view" options={VIEW_OPTIONS} value={viewMode} onChange={onViewModeChange} />
            </div>
            {scopeControl}
            {/* Below 640 the compact header carries Refresh (spec 3.2); Export stays here on every width */}
            <div className="ml-auto flex items-center gap-3">
                <span className="max-sm:hidden">{syncStatus}</span>
                <span className="max-sm:hidden">{refresh}</span>
                <Button variant="primary" onClick={onExport} disabled={isExportDisabled} data-tour="dashboard-export-pdf">
                    <span className="max-lg:sr-only">Export</span>
                </Button>
            </div>
        </div>
    );
}
