"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useAzureActions, useAzureData, useAzureLoading } from "@/contexts/AzureContext";
import { useArmThrottle } from "@/hooks/useArmThrottle";
import { useAzureConsent } from "@/hooks/useAzureConsent";
import { resetAzureDashboardForRefresh } from "@/hooks/useAzureDashboardReads";
import { readAzureRolePolicyPairs, settledPolicyFor, useAzureRolePolicies, useAzureRolePolicy } from "@/hooks/useAzureRolePolicy";
import { useAzureReportFilterContext } from "@/hooks/useAzureReportFilterContext";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useAzureReportUrlState } from "@/hooks/useAzureReportUrlState";
import { useMyAzureRoles } from "@/hooks/useMyAzureRoles";
import { useTenantName } from "@/hooks/useTenantName";
import { useShowDetails } from "@/hooks/useShowDetails";
import { useTourPage } from "@/hooks/useTourPage";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import type { AzureAssignment } from "@/types/azureResource.types";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useNow } from "@/hooks/useNow";
import { allScopeRows, type AzureExportData, type AzureExportView } from "@/utils/azureExportPlan";
import type { AzureRolePair } from "@/utils/azureExportRows";
import { azureReportView, azureSyncedText, loadingPercent, loadingSubscriptionCount } from "@/utils/azureReportStates";
import { defaultScopeId, findScope } from "@/utils/azureReport";
import { readAzureReportView } from "@/utils/azureReportViewPreference";
import { AzureExportDialog } from "./components/AzureExportDialog";
import { AzureLoadError } from "./components/AzureLoadError";
import { AzureReportBody } from "./components/AzureReportBody";
import { AzureReportEmpty } from "./components/AzureReportEmpty";
import { AzureReportHead } from "./components/AzureReportHead";
import { AzureReportLoading } from "./components/AzureReportLoading";
import { AzureRoleDetailContainer } from "./components/AzureRoleDetailContainer";
import { RoleSettingsPanel } from "./components/RoleSettingsPanel";
import { ThrottleNotice } from "./components/ThrottleNotice";
import { VisibilityLine } from "./components/VisibilityLine";

/** The Azure Report (Azure spec 6 and 7): the data container and the choice of view; the body is `AzureReportBody` */
function AzureReportContent() {
    const url = useAzureReportUrlState();
    const details = useShowDetails("azure-report");
    const [preferredView] = useState(() => readAzureReportView());
    const listView = url.state.view ?? preferredView;
    const { scopes, assignments, error, lastFetched } = useAzureData();
    const { loading } = useAzureLoading();
    const { load, refresh, readRest, getArmClient } = useAzureActions();
    const { isEnabled } = useAzureConsent();
    const isThrottled = useArmThrottle();
    const [roleTarget, setRoleTarget] = useState<AzureAssignment | null>(null);
    const [isRetrying, setIsRetrying] = useState(false);
    const { accounts } = useMsal();
    const tenantId = accounts[0]?.tenantId;
    const tenantName = useTenantName(tenantId);
    const [exportView, setExportView] = useState<AzureExportView | null>(null);
    const emergencyAccountIds = useEmergencyAccountIds();
    const filterState = useAzureReportFilterContext(url.state.filters, assignments, scopes, url.state.scopeId, emergencyAccountIds, tenantId);
    const allRows = useMemo(() => allScopeRows(assignments, scopes), [assignments, scopes]);
    const account = accounts[0];
    const loadingCount = loadingSubscriptionCount(scopes);
    const exportData = useMemo<AzureExportData | null>(
        () => exportView
            ? {
                view: exportView,
                allRows,
                scopes,
                emergencyIds: emergencyAccountIds,
                homeTenantId: tenantId,
                isLoading: loadingCount > 0,
                outcomeOf: (pair) => settledPolicyFor(pair.scopeId, pair.roleDefinitionId),
                meta: {
                    tenantId: tenantId ?? "",
                    tenantName,
                    exporter: account?.name ? `${account.name} (${account.username})` : account?.username,
                    readAt: lastFetched,
                    exportedAt: new Date(),
                },
            }
            : null,
        [exportView, allRows, scopes, emergencyAccountIds, tenantId, loadingCount, tenantName, account, lastFetched]
    );
    // The role settings file reads what the page has not read yet, on the worker pool with the ARM limiter
    const readExportPolicies = useCallback(
        async (pairs: AzureRolePair[], onProgress: (done: number, total: number) => void, signal: AbortSignal) => {
            await readAzureRolePolicyPairs(getArmClient(), pairs, { signal, onProgress });
        },
        [getArmClient]
    );
    const { state: policyState, retry: retryPolicy } = useAzureRolePolicy(roleTarget ? { scopeId: roleTarget.scopeId, roleDefinitionId: roleTarget.roleDefinitionId } : null);
    const view = azureReportView({ phase: loading.phase, scopeCount: scopes.length });
    useTourPage("azure-report", view === "report" && loading.phase === "complete");
    const myRoles = useMyAzureRoles(isEnabled && view === "empty");
    const now = useNow();
    const syncedText = azureSyncedText(lastFetched, loading.phase, now);

    // Page mount, and the moment Azure is turned on: load honours the 60 minute TTL and the session cache, and never starts a second run
    useEffect(() => {
        if (isEnabled) void load();
    }, [isEnabled, load]);

    const retry = () => {
        // Role settings and role definitions are read again after a refresh, as the assignments are
        resetAzureDashboardForRefresh();
        setIsRetrying(true);
        void refresh().finally(() => setIsRetrying(false));
    };
    const errorBox = error ? <AzureLoadError message={error} onRetry={retry} isRetrying={isRetrying} /> : null;
    const throttle = isThrottled ? <ThrottleNotice /> : null;
    const refreshButton = <RefreshButtonView isDisabled={loading.phase === "fetching" || loading.phase === "processing"} isLoading={isRetrying} onRefresh={retry} />;

    if (view === "report") {
        return (
            <>
                <AzureReportBody details={{ isDetailed: details.isDetailed, toggle: details.canToggle ? <DetailsToggle isChecked={details.isDetailed} onChange={details.setDetailed} /> : undefined }} scopes={scopes} assignments={assignments} selectedId={url.state.scopeId} filters={url.state.filters} onSelectScope={url.selectScope} onQueryChange={url.setQuery} onFiltersChange={url.setFilters} onOpenRole={setRoleTarget} onExport={setExportView} view={listView} onViewChange={url.setView} roleId={url.state.roleId} onSelectRole={url.selectRole} onClearRole={url.clearRole} getShareUrl={(roleId) => url.getShareUrl({ view: "roles", scopeId: findScope(scopes, url.state.scopeId)?.id ?? defaultScopeId(scopes), roleId })} usePrivilegedPolicies={useAzureRolePolicies} renderRoleDetail={(props) => <AzureRoleDetailContainer {...props} onOpenSettings={setRoleTarget} emergencyAccountIds={emergencyAccountIds} />} notice={throttle || errorBox ? <>{throttle}{errorBox}</> : undefined} emergencyAccountIds={emergencyAccountIds} filterContext={filterState.context} settingsProgress={filterState.settingsProgress} syncedText={syncedText} refresh={refreshButton} homeTenantId={tenantId} onReadRest={() => void readRest()} isReadingRest={loading.phase === "fetching" || loading.phase === "processing"} />
                <RoleSettingsPanel assignment={roleTarget} scopes={scopes} state={policyState} onRetry={retryPolicy} onClose={() => setRoleTarget(null)} />
                <AzureExportDialog data={exportData} onClose={() => setExportView(null)} loadingCount={loadingCount} readPolicies={readExportPolicies} />
            </>
        );
    }

    return (
        <div className="mx-auto max-w-[1376px]">
            <AzureReportHead scopeName={null} syncedText={syncedText} refresh={refreshButton} />
            {/* With nothing readable the empty state says so; "Partial view" would claim there is something to see */}
            {view !== "empty" && <VisibilityLine className="mt-4" />}
            <div className="mt-4 flex flex-col gap-4">
                {throttle}
                {view === "loading" && <AzureReportLoading message={loading.message || "Loading Azure role assignments..."} percent={loadingPercent(loading.progress)} />}
                {view === "failed" && (errorBox ?? <AzureLoadError message="Azure Resource Manager did not answer." onRetry={retry} isRetrying={isRetrying} />)}
                {view === "empty" && <AzureReportEmpty myRoles={myRoles} />}
            </div>
        </div>
    );
}

export default function AzureReportPage() {
    return (
        <Suspense fallback={
            <div className="mx-auto max-w-[1376px]">
                <Skeleton className="mb-2 block" width={160} height={32} />
                <Skeleton className="mb-8 block" width={320} height={16} />
            </div>
        }>
            <AzureReportContent />
        </Suspense>
    );
}
