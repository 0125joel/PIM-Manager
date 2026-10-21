"use client";

import { useSyncExternalStore } from "react";
import { useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { formatSyncedAgo } from "@/utils/loadingStatus";

const MINUTE_MS = 60000;

// One timer per mounted label; the snapshot is the current minute so the text only re-renders when it can change
function subscribeToMinute(onChange: () => void) {
    const id = setInterval(onChange, MINUTE_MS);
    return () => clearInterval(id);
}
const getMinute = () => Math.floor(Date.now() / MINUTE_MS);
const getServerMinute = () => 0;

/**
 * "synced 12 min ago" in mono, hidden while a workload loads (the status sentence takes over)
 * and when there is no sync yet.
 */
export function SyncStatus() {
    const { isWorkloadLoading, syncHistory } = useUnifiedLoading();
    const minute = useSyncExternalStore(subscribeToMinute, getMinute, getServerMinute);
    const lastSync = syncHistory && syncHistory.length > 0 ? syncHistory[0] : null;

    if (isWorkloadLoading("directoryRoles") || isWorkloadLoading("pimGroups") || !lastSync) {
        return null;
    }

    return <span className="font-mono text-xs text-muted">{formatSyncedAgo(lastSync.timestamp, new Date(minute * MINUTE_MS))}</span>;
}
