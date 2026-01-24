"use client";

import { AlertTriangle } from "lucide-react";

interface DataWarningBannerProps {
    failedCount: number;
    totalCount: number;
    onRefresh?: () => void;
}

export function DataWarningBanner({ failedCount, totalCount, onRefresh }: DataWarningBannerProps) {
    if (failedCount === 0) return null;

    return (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <div className="flex-1">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Incomplete data: {failedCount} of {totalCount} roles could not be loaded
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    Some configuration data may be missing.{" "}
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            className="underline hover:no-underline"
                        >
                            Refresh to retry
                        </button>
                    )}
                </p>
            </div>
        </div>
    );
}

/**
 * Inline warning for individual role configuration failures
 */
export function RoleConfigWarning({ error }: { error: string }) {
    return (
        <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Could not load configuration
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {error}. Refresh data to retry.
                </p>
            </div>
        </div>
    );
}
