"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";
import { scopeLineFor, type AzureOriginFilter } from "@/utils/azureReport";

interface AzureReportHeadProps {
    /** The name of the selected scope, or null while none is selected */
    scopeName: string | null;
    /** The Origin filter, which the line under the title names; All when omitted */
    origin?: AzureOriginFilter;
    /** The Export button shows only when this is passed */
    onExport?: () => void;
    /** For example "synced 3 min ago"; shown next to Refresh */
    syncedText?: string;
    /** The Refresh button; hidden below 640 where the compact header carries Refresh */
    refresh?: ReactNode;
    /** "Show more details" (calm details spec 2.3); left out with the setting More */
    detailsToggle?: ReactNode;
}

/** The title, the selected scope, the sync time, Refresh and Export. Export is an icon button below 640. */
export function AzureReportHead({ scopeName, origin = "all", onExport, syncedText, refresh, detailsToggle }: AzureReportHeadProps) {
    const scopeText = scopeName !== null ? `${scopeLineFor(scopeName, origin)}.` : "";
    return (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            {/* Below 640 the checkbox moves under the sentence, so the title and its sentence stay together */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-4">
                <h1 className={PAGE_TITLE_CLASS}>Report</h1>
                {detailsToggle && <div className="max-sm:order-last max-sm:basis-full">{detailsToggle}</div>}
                {scopeName !== null && <p className="mt-1 basis-full text-sm leading-5 text-body">{scopeText}</p>}
            </div>
            {(refresh || onExport || syncedText) && (
                <div className="flex items-center gap-3">
                    {syncedText && <span className="font-mono text-xs text-muted max-sm:hidden">{syncedText}</span>}
                    {refresh && <span className="max-sm:hidden" data-tour="refresh">{refresh}</span>}
                    {onExport && (
                        <>
                            <span className="max-sm:hidden">
                                <Button variant="primary" data-tour="report-export" onClick={onExport}>Export</Button>
                            </span>
                            <span className="sm:hidden">
                                <Button variant="primary" data-tour="report-export" icon="export" iconOnly label="Export" onClick={onExport} />
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
