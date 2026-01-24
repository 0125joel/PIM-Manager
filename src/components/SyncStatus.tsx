"use client";

import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";

/**
 * Displays the timestamp of the last sync.
 * Simple indicator showing when data was last refreshed.
 */
export function SyncStatus() {
    const { isWorkloadLoading, syncHistory } = useUnifiedPimData();
    const prevSyncRef = useRef<string | null>(null);

    // Get the most recent sync
    const lastSync = syncHistory && syncHistory.length > 0 ? syncHistory[0] : null;

    // Check if any workload is currently loading
    const isChecking = isWorkloadLoading('directoryRoles') || isWorkloadLoading('pimGroups');

    // Hide during loading - the LoadingStatus component handles this
    if (isChecking) {
        return null;
    }

    // Don't show if no sync history at all
    if (!lastSync) {
        return null;
    }

    const timeString = lastSync.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return (
        <div className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <CheckCircle2 className="h-3 w-3" />
            <span>Last synced at {timeString}</span>
        </div>
    );
}
