"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useRolesData, useRolesLoading, useRolesActions } from "@/hooks/usePimData";
import { useSecurityAlerts } from "./hooks/useSecurityAlerts";
import { LoadingStatus } from "@/components/LoadingStatus";
import { DataWarningBanner } from "@/components/DataWarningBanner";
import { ViewModeProvider, useViewMode } from "@/contexts/ViewModeContext";
import { ExportDialog } from "@/components/ExportDialog";
import { useTenantName } from "@/hooks/useTenantName";
import { SyncStatus } from "@/components/SyncStatus";
import { WorkloadChips, useWorkloadVisibility } from "@/components/WorkloadChips";
import { useUnifiedData, useUnifiedLoading, useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { setWorkloadVisible } from "@/utils/workloadPreferences";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { DashboardHead } from "./components/basic/DashboardHead";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { changeInConfigureHref } from "@/utils/configureLinks";
import { DashboardOverview } from "./components/basic/DashboardOverview";
import { useDashboardFilter } from "@/hooks/useDashboardFilter";
import { useEscapeClearsFilter } from "@/hooks/useEscapeClearsFilter";
import { summarizeAlerts } from "@/utils/alertSummary";
import { useIncrementalConsent } from "@/hooks/useIncrementalConsent";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useDashboardScope } from "@/hooks/useDashboardScope";
import { useCustomExtensions } from "@/hooks/useCustomExtensions";
import { ScopeControl } from "./components/advanced/ScopeControl";
import { buildFilterNames, getFilterLabels, isEmptyDashboardFilter } from "@/utils/dashboardFilter";
import { getEffectiveDashboardFilter } from "@/utils/dashboardStats";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";
import { withoutAgents } from "@/utils/agentCounting";


function DashboardContent() {
    const writeAccess = useWriteAccess();
    const { rolesData, error, failedRoleIds, authenticationContexts } = useRolesData();
    const { loading, policiesLoading } = useRolesLoading();
    const { fetchData, refreshData } = useRolesActions();
    const { accounts } = useMsal();
    const { viewMode, setViewMode, isBasic, isAdvanced } = useViewMode();
    const { filter: dashboardFilter, setFilter: setDashboardFilter, clearFilter: clearDashboardFilter, removeKey: removeDashboardFilterKey, isActive: isDashboardFilterActive } = useDashboardFilter();
    const emergencyAccountIds = useEmergencyAccountIds();
    const [scope, setScope] = useDashboardScope();
    // The side reads (custom extensions, alerts) wait until the roles are in or failed: together with the roles they
    // used to push a cold load over the tenant's request budget (429 on the core reads)
    const rolesSettled = rolesData.length > 0 || error !== null;
    const { extensions: tenantExtensions, hasPermission: hasExtensionsPermission } = useCustomExtensions({ autoLoad: isAdvanced && rolesSettled });
    const tenantExtensionIds = useMemo(() => (hasExtensionsPermission === true ? new Set(tenantExtensions.map((e) => e.id)) : null), [hasExtensionsPermission, tenantExtensions]);

    // Security alerts: the "From Microsoft" block and the PDF export
    const {
        alerts: securityAlerts,
        hasPermission: hasAlertsPermission,
        loading: alertsLoading,
        error: alertsError,
        requestingPermission: alertsRequesting,
        dismissedAlerts,
        loadAlerts,
        requestPermission: requestAlertsPermission,
        dismissAlert,
        restoreAll: restoreAllAlerts,
    } = useSecurityAlerts({ enabled: rolesSettled });
    const [showDismissedAlerts, setShowDismissedAlerts] = useState(false);
    const [dismissedRolesError, setDismissedRolesError] = useState<string | null>(null);
    const alertsSummary = useMemo(() => summarizeAlerts(securityAlerts, dismissedAlerts, showDismissedAlerts), [securityAlerts, dismissedAlerts, showDismissedAlerts]);
    const { requestConsent } = useIncrementalConsent();

    // Workload/feature visibility state
    const isSecurityAlertsVisible = useWorkloadVisibility("securityAlerts");
    const isDirectoryRolesVisible = useWorkloadVisibility("directoryRoles");
    const isPimGroupsVisible = useWorkloadVisibility("pimGroups");
    const isUnmanagedGroupsVisible = useWorkloadVisibility("unmanagedGroups");
    const isAgentsVisible = useWorkloadVisibility("agents");

    // Get PIM for Groups data and refresh function from UnifiedPimContext
    const { workloads } = useUnifiedData();
    const { workloads: workloadLoading } = useUnifiedLoading();
    const { refreshWorkload, enableWorkload } = useUnifiedActions();
    const pimGroupsData = workloads.pimGroups.data;
    // Settings Graph would not show to this admin (FIX-11, FIX-12): the numbers about settings leave them out and say so
    const notReadableRoleCount = rolesData.filter((r) => r.policiesForbidden).length;
    const notReadableGroupCount = pimGroupsData.filter((g) => g.policiesForbidden).length;

    // What the numbers count: the chips on this page, and only workloads that have consent
    const counting = useMemo(() => ({
        directoryRoles: isDirectoryRolesVisible,
        pimGroups: isPimGroupsVisible && workloads.pimGroups.consent.consented,
        unmanagedGroups: isUnmanagedGroupsVisible,
        agents: isAgentsVisible,
    }), [isDirectoryRolesVisible, isPimGroupsVisible, isUnmanagedGroupsVisible, isAgentsVisible, workloads.pimGroups.consent.consented]);

    // The chip Agents off: every number, block and the export leave agent assignments out (decision D4)
    const counted = useMemo(
        () => (counting.agents ? { roles: rolesData, groups: pimGroupsData } : withoutAgents(rolesData, pimGroupsData)),
        [counting.agents, rolesData, pimGroupsData]
    );

    useEscapeClearsFilter(isDashboardFilterActive, clearDashboardFilter);

    // Get account info for display and PDF export (MSAL data only - no extra permissions needed)
    const account = accounts[0];
    const tenantId = account?.tenantId;
    const userPrincipalName = account?.username;

    // Export: the dialog applies its options to the data the page holds
    const [showExport, setShowExport] = useState(false);
    const tenantName = useTenantName(tenantId);
    const { syncHistory } = useUnifiedLoading();
    const effectiveFilter = useMemo(() => getEffectiveDashboardFilter(dashboardFilter), [dashboardFilter]);
    const filterSentence = isEmptyDashboardFilter(effectiveFilter) ? "" : getFilterLabels(effectiveFilter, buildFilterNames(rolesData)).map((l) => l.label).join(", ");

    // Initial load effect: auto-fetch if no data. fetchData honours the 60 minute cache TTL
    // and the sessionStorage cache; refreshData is reserved for explicit refreshes.
    useEffect(() => {
        if (rolesData.length === 0 && !loading && !error) {
            fetchData();
        }
    }, [rolesData.length, loading, error, fetchData]);


    return (
        <div data-focus-fallback tabIndex={-1} className="mx-auto flex max-w-[1376px] flex-col gap-4 outline-none">
            <div className="flex flex-col gap-4">
                <DashboardHead
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    syncStatus={<SyncStatus />}
                    refresh={<RefreshButton />}
                    isExportDisabled={loading || policiesLoading || rolesData.length === 0}
                    onExport={() => setShowExport(true)}
                    scopeControl={isAdvanced ? <ScopeControl scope={scope} onChange={setScope} /> : undefined}
                />
                <LoadingStatus />
                <WorkloadChips />
            </div>

            {/* Data incomplete warning banner */}
            <DataWarningBanner
                failedCount={failedRoleIds.length}
                totalCount={rolesData.length}
                onRefresh={() => refreshData(true)}
                className=""
            />

            {notReadableRoleCount + notReadableGroupCount > 0 && (
                <p role="note" className="text-[13px] leading-5 text-body">
                    {[notReadableRoleCount > 0 && `${notReadableRoleCount} of ${rolesData.length} roles`, notReadableGroupCount > 0 && `${notReadableGroupCount} of ${pimGroupsData.length} groups`].filter(Boolean).join(" and ")}
                    {": "}{POLICY_NOT_READABLE}
                </p>
            )}

            {/* Directory roles failed to load: a block with the cause and Try again, never a toast (spec 4.7) */}
            {error && dismissedRolesError !== error && (
                <StatusBox variant="error" title={rolesData.length === 0 ? "Directory roles could not be loaded" : "Directory roles could not be refreshed"} dismissLabel="Dismiss: Directory roles error" onDismiss={() => setDismissedRolesError(error)} action={<Button size="sm" onClick={() => void refreshData(true)}>Try again</Button>}>
                    {error}{rolesData.length > 0 && " The numbers below are from the last load."}
                </StatusBox>
            )}

            {/* Filter bar, the eight cards and, in Basic, Who and Terms */}
            <DashboardOverview
                changeHrefFor={(target) => changeInConfigureHref(writeAccess.access, target)}
                rolesData={counted.roles}
                groupsData={counted.groups}
                counting={counting}
                filter={dashboardFilter}
                isRolesLoading={loading || (rolesData.length === 0 && !error)}
                isGroupsLoading={["idle", "consent", "fetching", "processing"].includes(workloadLoading.pimGroups.phase)}
                policiesLoading={policiesLoading}
                emergencyAccountIds={emergencyAccountIds}
                onSetFilter={setDashboardFilter}
                onRemoveFilterKey={removeDashboardFilterKey}
                showBlocks={isBasic}
                showAdvanced={isAdvanced}
                scope={isAdvanced ? scope : "privileged"}
                tenantExtensionIds={tenantExtensionIds}
                rolesError={error}
                pimGroupsConsented={workloads.pimGroups.consent.consented}
                pimGroupsError={workloadLoading.pimGroups.phase === "error" ? workloadLoading.pimGroups.error ?? "Microsoft Graph did not answer." : null}
                onRetryPimGroups={() => void refreshWorkload("pimGroups", true)}
                // The popup alone leaves the workload off until a reload: switch it on and read it, as Settings does
                onGrantPimGroups={() => {
                    void requestConsent("pimGroups").then(async (isGranted) => {
                        if (!isGranted) return;
                        await enableWorkload("pimGroups");
                        setWorkloadVisible("pimGroups", true);
                    });
                }}
                alerts={isSecurityAlertsVisible ? {
                    state: hasAlertsPermission === false ? "noConsent" : alertsError ? "error" : alertsLoading || hasAlertsPermission === null ? "loading" : "ready",
                    summary: alertsSummary,
                    errorMessage: alertsError,
                    isGranting: alertsRequesting,
                    showDismissed: showDismissedAlerts,
                    onGrant: requestAlertsPermission,
                    onRetry: loadAlerts,
                    onDismiss: dismissAlert,
                    onRestoreDismissed: restoreAllAlerts,
                    onShowDismissedChange: setShowDismissedAlerts,
                } : null}
            />

            {showExport && (
                <ExportDialog
                    isOpen={showExport}
                    onClose={() => setShowExport(false)}
                    input={{
                        rolesData: counted.roles,
                        groupsData: counted.groups,
                        filter: dashboardFilter,
                        emergencyAccountIds,
                        authenticationContexts,
                        alerts: hasAlertsPermission ? securityAlerts : null,
                        dismissedAlertIds: dismissedAlerts,
                        tenantExtensionIds,
                        policiesLoading,
                    }}
                    meta={{ tenantName, tenantId, exporter: account?.name ? `${account.name} (${userPrincipalName})` : userPrincipalName ?? "unknown", version: process.env.NEXT_PUBLIC_APP_VERSION ?? "", dataReadAt: syncHistory && syncHistory.length > 0 ? new Date(syncHistory[0].timestamp) : undefined }}
                    counting={{ ...counting, securityAlerts: isSecurityAlertsVisible && hasAlertsPermission === true }}
                    availability={{
                        directoryRoles: { available: rolesData.length > 0, count: rolesData.length },
                        pimGroups: { available: workloads.pimGroups.consent.consented, count: pimGroupsData.filter((g) => g.isManaged !== false).length },
                        unmanagedGroups: { available: workloads.pimGroups.consent.consented },
                        securityAlerts: { available: hasAlertsPermission === true },
                    }}
                    filterSentence={filterSentence}
                />
            )}
        </div>
    );
}


export default function DashboardPage() {
    return (
        <ViewModeProvider>
            {/* Before the page can read the URL: the head and the eight cards as skeletons, in the layout of the page (spec 4.7) */}
            <Suspense fallback={
                <div className="mx-auto flex max-w-[1376px] flex-col gap-4">
                    <Skeleton className="block" width={240} height={34} />
                    <Skeleton className="block" width={360} height={28} />
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <Skeleton key={i} className="block w-full" height={92} />
                        ))}
                    </div>
                </div>
            }>
                <DashboardContent />
            </Suspense>
        </ViewModeProvider>
    );
}
