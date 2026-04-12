
import React, { useState, useMemo } from 'react';
import { WizardStep } from '../WizardStep';
import {
    useSyncHistory,
    useIsWorkloadLoading,
    useRefreshAllWorkloads,
    useWorkloadData
} from '@/hooks/usePimSelectors';
import { AlertCircle, Check, Download, RefreshCw, Loader2, Save } from 'lucide-react';
import { Logger } from '@/utils/logger';
import { RoleDetailData } from '@/types/directoryRole.types';
import { PimGroupData } from '@/types/pimGroup.types';

/**
 * BackupStep - First step in configuration wizard
 *
 * Uses selector hooks to minimize re-renders:
 * - useSyncHistory: Only for sync timestamp
 * - useIsWorkloadLoading: Only for loading state
 * - useRefreshAllWorkloads: Stable function reference
 * - useWorkloadData: Only for data export
 */
export function BackupStep({ onNext }: { onNext: () => void }) {
    // Use selector hooks to minimize re-renders
    const syncHistory = useSyncHistory();
    const isDirectoryRolesLoading = useIsWorkloadLoading("directoryRoles");
    const isPimGroupsLoading = useIsWorkloadLoading("pimGroups");
    const refreshAllWorkloads = useRefreshAllWorkloads();
    const directoryRolesData = useWorkloadData<RoleDetailData>("directoryRoles");
    const pimGroupsData = useWorkloadData<PimGroupData>("pimGroups");

    // Derived state
    const isLoading = isDirectoryRolesLoading || isPimGroupsLoading;
    const lastSync = syncHistory && syncHistory.length > 0 ? syncHistory[0] : null;
    const displayTime = lastSync?.timestamp;

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [hasDownloaded, setHasDownloaded] = useState(false);
    const [isVerified, setIsVerified] = useState(false);

    const handleRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshAllWorkloads();
        } catch (error) {
            Logger.error("BackupStep", "Failed to refresh", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleDownloadBackup = () => {
        const backupData = {
            metadata: {
                timestamp: new Date().toISOString(),
                version: "1.0",
                type: "full-backup"
            },
            data: {
                directoryRoles: directoryRolesData,
                groups: pimGroupsData
            }
        };

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pim-manager-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setHasDownloaded(true);
    };

    // Block next if not verified OR if data is currently syncing
    const isNextDisabled = !isVerified || isLoading;

    // Check if we have any data to backup
    const hasData = directoryRolesData.length > 0 || pimGroupsData.length > 0;

    return (
        <WizardStep
            title="Safety Check"
            description="Refresh your data and save a backup before making changes."
            onNext={onNext}
            isNextDisabled={isNextDisabled}
        >
            <div className="space-y-6">

                {/* 1. Data Freshness */}
                <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-sm">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                            <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                1. Ensure Data is Fresh
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-3">
                                Sync with Entra ID to ensure you are configuring the latest state.
                            </p>

                            <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                                <div className="text-sm">
                                    <span className="text-zinc-500">Last Synced: </span>
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                        {displayTime ? new Date(displayTime).toLocaleTimeString() : 'Never'}
                                    </span>
                                </div>
                                <button
                                    onClick={handleRefresh}
                                    disabled={isRefreshing || isLoading}
                                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {(isRefreshing || isLoading) && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Refresh Data
                                </button>

                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Backup */}
                <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl shadow-sm">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                            <Save className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                2. Save Configuration Backup
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 mb-3">
                                Download a full JSON export of your current configuration. This serves as a snapshot you can reference or restore (future).
                            </p>

                            <button
                                onClick={handleDownloadBackup}
                                disabled={isLoading || isRefreshing || !hasData}
                                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download className="w-4 h-4" />
                                Download Backup ({hasDownloaded ? "Saved" : "JSON"})
                            </button>
                        </div>
                    </div>
                </div>

                {/* 3. Verification */}
                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-xl">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className="relative flex items-center mt-0.5">
                            <input
                                type="checkbox"
                                checked={isVerified}
                                onChange={(e) => setIsVerified(e.target.checked)}
                                className="w-5 h-5 border-2 border-amber-400 rounded text-amber-600 focus:ring-amber-500 focus:ring-offset-amber-50 dark:focus:ring-offset-ziinc-900 transition-colors"
                            />
                        </div>
                        <div className="flex-1">
                            <span className="font-medium text-amber-900 dark:text-amber-100">
                                I confirm my data is synced and backed up
                            </span>
                            <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-1">
                                You must verify this to proceed to configuration.
                            </p>
                        </div>
                    </label>
                </div>

            </div>
        </WizardStep>
    );
}
