"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/icons/Icon";

interface DataWarningBannerProps {
    failedCount: number;
    totalCount: number;
    onRefresh?: () => void;
    /** Spacing around the banner; the report page keeps its bottom margin, the dashboard lays it out with a gap */
    className?: string;
}

/** Policies of some roles could not be read: a warning with the count and a retry, in the warning tokens (spec 1.1). */
export function DataWarningBanner({ failedCount, totalCount, onRefresh, className = "mb-4" }: DataWarningBannerProps) {
    if (failedCount === 0) return null;

    return (
        <div className={`flex items-start gap-3 rounded bg-warn-tint p-3 ${className}`} style={{ "--pim-icon-accent": "var(--warn-fill)" } as CSSProperties}>
            <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-ink" />
            <div className="min-w-0 flex-1">
                <p className="text-sm leading-5 font-medium text-ink">
                    Incomplete data: {failedCount} of {totalCount} roles could not be loaded
                </p>
                <p className="text-[13px] leading-[18px] text-body">
                    Some configuration data may be missing.{" "}
                    {onRefresh && (
                        <button type="button" onClick={onRefresh} className="inline-flex min-h-6 items-center text-accent underline underline-offset-2 max-sm:min-h-11">
                            Refresh to retry
                        </button>
                    )}
                </p>
            </div>
        </div>
    );
}
