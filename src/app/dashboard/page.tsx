"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { usePimData } from "@/hooks/usePimData";
import { useRoleFilters } from "@/hooks/useRoleFilters";
import { useSecurityAlerts } from "./hooks/useSecurityAlerts";
import { OverviewCards } from "./components/OverviewCards";
import { SecurityCharts, ChartsData } from "./components/SecurityCharts";
import { DashboardRoleOverview } from "./components/DashboardRoleOverview";
import { SecurityAlerts } from "./components/SecurityAlerts";
import { RecentActivations } from "./components/RecentActivations";
import { ExpiringSoon } from "./components/ExpiringSoon";
import { TopUsers } from "./components/TopUsers";
import { ApproversOverview } from "./components/ApproversOverview";
import { ConfigurationErrors } from "./components/ConfigurationErrors";
import { GroupsOverview } from "./components/GroupsOverview";
import { ProTip } from "./components/ProTip";
import { RefreshCw, X, ArrowRight, FileDown, User } from "lucide-react";
import { LoadingStatus } from "@/components/LoadingStatus";
import { DataWarningBanner } from "@/components/DataWarningBanner";
import { ViewModeProvider, useViewMode } from "@/contexts/ViewModeContext";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { PdfExportModal } from "@/components/PdfExportModal";
import { SyncStatus } from "@/components/SyncStatus";
import { WorkloadChips, useWorkloadVisibility } from "@/components/WorkloadChips";
import { SettingsModal } from "@/components/SettingsModal";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import Link from "next/link";


function DashboardContent() {
    const { rolesData, loading, error, refreshData, failedRoleIds, policiesLoading, authenticationContexts } = usePimData();
    const { accounts } = useMsal();
    const { isBasic, isAdvanced } = useViewMode();
    const searchParams = useSearchParams();

    // Security alerts for PDF export (uses the same hook as SecurityAlerts component)
    const { alerts: securityAlerts, hasPermission: hasAlertsPermission } = useSecurityAlerts();

    // Workload/feature visibility state
    const isSecurityAlertsVisible = useWorkloadVisibility("securityAlerts");
    const isDirectoryRolesVisible = useWorkloadVisibility("directoryRoles");
    const isPimGroupsVisible = useWorkloadVisibility("pimGroups");
    const isUnmanagedGroupsVisible = useWorkloadVisibility("unmanagedGroups");

    // Get PIM Groups data and refresh function from UnifiedPimContext
    const { workloads, refreshAllWorkloads } = useUnifiedPimData();
    const pimGroupsData = workloads.pimGroups.data;
    const pimGroupsLoading = workloads.pimGroups.loading.phase === "fetching" ||
        workloads.pimGroups.loading.phase === "processing" ||
        workloads.pimGroups.loading.phase === "consent";

    // Get account info for display and PDF export (MSAL data only - no extra permissions needed)
    const account = accounts[0];
    const tenantId = account?.tenantId;
    const userPrincipalName = account?.username;
    const userName = account?.name;

    // Universal filter system - reads from URL, filters data, provides setters
    const {
        filteredRoles,
        hasActiveFilters,
        activeFilterCount,
        resetFilters,
        toggleFilter,
        updateURLParam
    } = useRoleFilters(rolesData);

    // PDF Export state
    const [showPdfModal, setShowPdfModal] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [chartsData, setChartsData] = useState<ChartsData | null>(null);
    const handleChartsDataReady = useCallback((data: ChartsData) => {
        setChartsData(data);
    }, []);

    // Unified refresh handler - uses central refreshAllWorkloads (modular, universal)
    const handleRefreshAll = useCallback(async () => {
        await refreshAllWorkloads();
    }, [refreshAllWorkloads]);

    // Initial load effect - auto-fetch if no data
    useEffect(() => {
        if (rolesData.length === 0 && !loading && !error) {
            refreshData();
        }
    }, [rolesData.length, loading, error, refreshData]);

    const totalRoles = rolesData.length;

    // Helper to convert RoleFilterState keys to URL param names
    const handleFilterClick = (key: string, value: string) => {
        const paramMap: Record<string, string> = {
            filterAssignmentType: 'assignmentType',
            filterMemberType: 'memberType',
            filterMfaRequired: 'mfaType',
            filterApprovalRequired: 'approval',
            filterMaxDuration: 'maxDuration',
            filterPrivileged: 'privileged',
            filterPimConfigured: 'pimConfigured',
            filterRoleType: 'roleType',
            filterHasAssignments: 'hasAssignments',
        };
        const paramName = paramMap[key] || key;
        toggleFilter(paramName, value);
    };

    return (
        <div className="container mx-auto px-4 py-8 max-w-7xl">
            <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                        Security dashboard
                    </h1>
                    <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                        Overview of your Privileged Identity Management posture
                    </p>
                    {/* User and Tenant Info Subtitle */}
                    {userPrincipalName && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2 flex items-center gap-2">
                            <User className="h-3 w-3" />
                            <span>Signed in as {userPrincipalName}</span>
                            {tenantId && (
                                <>
                                    <span className="text-zinc-300 dark:text-zinc-600">•</span>
                                    <span>Tenant ID: {tenantId}</span>
                                </>
                            )}
                        </p>
                    )}
                </div>
                <div className="flex items-start gap-3 w-full md:w-auto">
                    <ViewModeToggle />
                    <div className="flex flex-col gap-2 flex-1 md:flex-none">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleRefreshAll}
                                disabled={loading || policiesLoading || pimGroupsLoading}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 whitespace-nowrap flex-1 md:flex-none"
                            >
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                Refresh data
                            </button>
                            <button
                                onClick={() => setShowPdfModal(true)}
                                disabled={loading || policiesLoading || !chartsData}
                                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex-1 md:flex-none"
                            >
                                <FileDown className="h-4 w-4" />
                                Export PDF
                            </button>
                        </div>
                        <LoadingStatus />
                        <SyncStatus />
                    </div>
                </div>
            </div>

            {/* Workload Chips */}
            <div className="mb-6">
                <WorkloadChips onOpenSettings={() => setShowSettingsModal(true)} />
            </div>

            {/* Active Filters Banner */}
            {hasActiveFilters && (
                <div className="mb-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                                Showing {filteredRoles.length} of {totalRoles} roles ({activeFilterCount} {activeFilterCount === 1 ? 'filter' : 'filters'} active)
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Link
                                href={searchParams?.toString() ? `/report?${searchParams.toString()}` : '/report'}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md transition-colors"
                            >
                                View Report
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                            <button
                                onClick={resetFilters}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-md transition-colors"
                            >
                                <X className="h-4 w-4" />
                                Clear all filters
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Data incomplete warning banner */}
            <DataWarningBanner
                failedCount={failedRoleIds.length}
                totalCount={rolesData.length}
                onRefresh={refreshData}
            />

            {/* Overview Cards */}
            <OverviewCards
                rolesData={filteredRoles}
                loading={loading}
                policiesLoading={policiesLoading}
                onFilterClick={handleFilterClick}
                viewMode={isAdvanced ? "advanced" : "basic"}
            />

            {/* Security Charts - combines data from all enabled workloads */}
            <SecurityCharts
                rolesData={filteredRoles}
                groupsData={pimGroupsData}
                loading={loading}
                policiesLoading={policiesLoading}
                onFilterClick={handleFilterClick}
                viewMode={isAdvanced ? "advanced" : "basic"}
                activeFilters={{
                    assignmentType: searchParams?.get('assignmentType') || undefined,
                    memberType: searchParams?.get('memberType') || undefined,
                }}
                onChartsDataReady={handleChartsDataReady}
                authenticationContexts={authenticationContexts}
            />

            {/* Pro Tip - Basic mode only */}
            {isBasic && (
                <div className="mb-8">
                    <ProTip />
                </div>
            )}

            {/* Recent Activity Section - Advanced only */}
            {isAdvanced && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    <RecentActivations rolesData={rolesData} loading={loading} />
                    <ExpiringSoon rolesData={rolesData} loading={loading} />
                </div>
            )}

            {/* Main Content Section - Role & Groups Overview side by side */}
            {(isDirectoryRolesVisible || isPimGroupsVisible) && (
                <div className={`grid gap-6 mb-8 items-stretch ${isDirectoryRolesVisible && isPimGroupsVisible
                    ? "grid-cols-1 lg:grid-cols-2"
                    : "grid-cols-1"
                    }`}>
                    {/* Role Overview - only if toggle ON */}
                    {isDirectoryRolesVisible && (
                        <DashboardRoleOverview
                            rolesData={rolesData}
                            loading={loading}
                            viewMode={isAdvanced ? "advanced" : "basic"}
                            hasUnmanagedGroups={isUnmanagedGroupsVisible && pimGroupsData.some(g => g.isManaged === false)}
                        />
                    )}

                    {/* Groups Overview - only if toggle ON */}
                    {isPimGroupsVisible && (
                        <GroupsOverview
                            groupsData={pimGroupsData}
                            loading={pimGroupsLoading}
                            viewMode={isAdvanced ? "advanced" : "basic"}
                        />
                    )}
                </div>
            )}

            {/* Security Alerts - Basic mode, separate row */}
            {isBasic && isSecurityAlertsVisible && (
                <div className="mb-8">
                    <SecurityAlerts />
                </div>
            )}

            {/* Top Users - Advanced mode */}
            {isAdvanced && (
                <div className="mb-8">
                    <TopUsers rolesData={rolesData} loading={loading} />
                </div>
            )}

            {/* Bottom Section - Advanced only */}
            {isAdvanced && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <ApproversOverview rolesData={rolesData} loading={loading} />
                    <ConfigurationErrors rolesData={rolesData} loading={loading} onRefresh={refreshData} />
                </div>
            )}

            {/* PDF Export Modal */}
            {chartsData && (
                <PdfExportModal
                    isOpen={showPdfModal}
                    onClose={() => setShowPdfModal(false)}
                    chartData={{
                        assignmentData: chartsData.assignmentData,
                        assignmentMethodData: chartsData.assignmentMethodData,
                        mfaData: chartsData.mfaData,
                        approvalData: chartsData.approvalData,
                        durationData: chartsData.durationData,
                        authContextData: chartsData.authContextData,
                        managedData: chartsData.managedData,
                    }}
                    rolesData={filteredRoles}
                    groupsData={pimGroupsData}
                    initialWorkloadSelection={{
                        directoryRoles: isDirectoryRolesVisible,
                        pimGroups: isPimGroupsVisible
                    }}
                    viewMode={isAdvanced ? "advanced" : "basic"}
                    filterSummary={hasActiveFilters ? `${activeFilterCount} filters active` : undefined}
                    tenantId={tenantId}
                    userPrincipalName={userPrincipalName}
                    securityAlerts={hasAlertsPermission ? securityAlerts : undefined}
                />
            )}

            {/* Settings Modal */}
            <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
        </div>
    );
}


export default function DashboardPage() {
    return (
        <ViewModeProvider>
            <Suspense fallback={
                <div className="container mx-auto px-4 py-8 max-w-7xl">
                    <div className="animate-pulse">
                        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded mb-2" />
                        <div className="h-4 w-96 bg-zinc-200 dark:bg-zinc-800 rounded mb-8" />
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
                            ))}
                        </div>
                    </div>
                </div>
            }>
                <DashboardContent />
            </Suspense>
        </ViewModeProvider>
    );
}
