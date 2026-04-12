"use client";

import { useState, useCallback } from "react";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { LoadingStatus } from "@/components/LoadingStatus";
import { SyncStatus } from "@/components/SyncStatus";
import { ConfigureWizard } from "@/components/configure/ConfigureWizard";
import { ModeSelector, ConfigMode } from "@/components/configure/ModeSelector";
import { ManualMode, BulkMode } from "@/components/configure/modes";
import { RefreshCw } from "lucide-react";

export default function ConfigurePage() {
    // Mode state: null = show selector, otherwise show selected mode
    const [selectedMode, setSelectedMode] = useState<ConfigMode | null>(null);
    const [activeMode, setActiveMode] = useState<ConfigMode | null>(null);

    const { refreshAllWorkloads, isWorkloadLoading } = useUnifiedPimData();
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Derived global loading state
    const isGlobalLoading = isWorkloadLoading("directoryRoles") || isWorkloadLoading("pimGroups");

    // Unified refresh handler
    const handleRefreshAll = useCallback(async () => {
        setIsRefreshing(true);
        try {
            await refreshAllWorkloads();
        } finally {
            setIsRefreshing(false);
        }
    }, [refreshAllWorkloads]);

    // Handle mode selection confirmation
    const handleContinue = () => {
        if (selectedMode) {
            setActiveMode(selectedMode);
        }
    };

    // Handle back to mode selector — keep selectedMode so the card stays highlighted
    const handleBackToSelector = () => {
        setActiveMode(null);
    };

    return (
        <>
            {/* Header / Top Bar */}
            <div className="flex items-center justify-center relative mb-8">
                <div className="text-center">
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        Configuration
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-2">
                        Manage PIM roles and groups efficiently.
                    </p>
                </div>

                {/* Global Refresh & Status */}
                <div className="absolute right-0 top-0 flex items-center gap-3">
                    <LoadingStatus />
                    <SyncStatus />
                    <button
                        onClick={handleRefreshAll}
                        disabled={isRefreshing || isGlobalLoading}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline">Refresh Data</span>
                    </button>
                </div>
            </div>

            {/* Mode Selector */}
            {!activeMode && (
                <ModeSelector
                    selectedMode={selectedMode}
                    onModeSelect={setSelectedMode}
                    onContinue={handleContinue}
                    disabled={isGlobalLoading}
                />
            )}

            {/* Wizard Mode */}
            {activeMode === "wizard" && (
                <ConfigureWizard onBack={handleBackToSelector} />
            )}

            {/* Manual Mode */}
            {activeMode === "manual" && (
                <ManualMode onBack={handleBackToSelector} />
            )}

            {/* Bulk Mode */}
            {activeMode === "bulk" && (
                <BulkMode onBack={handleBackToSelector} />
            )}
        </>
    );
}
