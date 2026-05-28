/**
 * usePolicyConflicts
 *
 * React hook wrapper around `detectPolicyConflicts` in utils. Use this for
 * reactive cases (ReviewStep / ApplyStep). For imperative paths (Manual mode
 * "Apply Now", Bulk mode CSV apply), call `detectPolicyConflicts` directly
 * from the apply handler instead.
 */

import { useEffect, useState, useCallback } from 'react';
import { useUnifiedPimData } from '@/contexts/UnifiedPimContext';
import { Logger } from '@/utils/logger';
import { PolicySettings } from '@/hooks/useWizardState';
import { detectPolicyConflicts, PolicyConflict } from '@/utils/policyConflicts';

// Re-export for backwards-compatible imports.
export type { PolicyConflict, ConflictReason } from '@/utils/policyConflicts';

export interface PolicyConflictsResult {
    conflicts: PolicyConflict[];
    isLoading: boolean;
    error?: string;
    refresh: () => void;
}

interface UsePolicyConflictsParams {
    workload: "directoryRoles" | "pimGroups";
    selectedIds: string[];
    nameMap: Map<string, string>;
    pendingPolicy?: PolicySettings;
    pendingOwnerPolicy?: PolicySettings;
    enabled: boolean;
}

export function usePolicyConflicts({
    workload,
    selectedIds,
    nameMap,
    pendingPolicy,
    pendingOwnerPolicy,
    enabled,
}: UsePolicyConflictsParams): PolicyConflictsResult {
    const { getGraphClient } = useUnifiedPimData();
    const [conflicts, setConflicts] = useState<PolicyConflict[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [refreshKey, setRefreshKey] = useState(0);

    const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

    useEffect(() => {
        if (!enabled || !pendingPolicy || selectedIds.length === 0) {
            setConflicts([]);
            return;
        }

        let cancelled = false;

        const run = async () => {
            setIsLoading(true);
            setError(undefined);
            try {
                const client = await getGraphClient();
                const found = await detectPolicyConflicts(client, {
                    workload,
                    selectedIds,
                    nameMap,
                    pendingPolicy,
                    pendingOwnerPolicy,
                });
                if (!cancelled) setConflicts(found);
            } catch (e) {
                if (!cancelled) {
                    Logger.error("usePolicyConflicts", "Failed to detect conflicts", e);
                    setError(e instanceof Error ? e.message : String(e));
                    setConflicts([]);
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        run();
        return () => { cancelled = true; };
    // nameMap intentionally excluded — identity changes per render but only
    // affects display labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, workload, selectedIds, pendingPolicy, pendingOwnerPolicy, getGraphClient, refreshKey]);

    return { conflicts, isLoading, error, refresh };
}
