"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRolesActions, useRolesData, useRolesLoading } from "@/hooks/usePimData";
import { useUnifiedActions, useUnifiedData, useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useNow } from "@/hooks/useNow";
import { useCustomExtensions } from "@/hooks/useCustomExtensions";
import { useAgentBlueprintNames } from "@/hooks/useAgentBlueprintNames";
import { useTenantName } from "@/hooks/useTenantName";
import { useMsal } from "@azure/msal-react";
import { useGroupMembership } from "@/hooks/useGroupMembership";
import { useIncrementalConsent } from "@/hooks/useIncrementalConsent";
import { setWorkloadVisible } from "@/utils/workloadPreferences";
import { useReportUrlState } from "@/hooks/useReportUrlState";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { LoadingStatus } from "@/components/LoadingStatus";
import { runWorkerPool } from "@/utils/workerPool";
import { formatSyncedAgo } from "@/utils/loadingStatus";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { ExportData } from "@/utils/reportExportPlan";
import { useWriteAccess } from "@/hooks/useWriteAccess";
import { changeInConfigureHref } from "@/utils/configureLinks";
import { ReportBody } from "./components/ReportBody";
import { ReportExportDialog } from "./components/ReportExportDialog";

/** The data container of the Report: workload state, the first load, consent and Export. The body is `ReportBody`. */
function ReportPageContent() {
    const writeAccess = useWriteAccess();
    const { rolesData, error, failedRoleIds, authenticationContexts } = useRolesData();
    const { loading, policiesLoading } = useRolesLoading();
    const { fetchData, refreshData, fetchPolicyForRole } = useRolesActions();
    const { workloads } = useUnifiedData();
    const { workloads: workloadLoading, syncHistory, isWorkloadLoading } = useUnifiedLoading();
    const { enableWorkload, refreshWorkload } = useUnifiedActions();
    const { requestConsent } = useIncrementalConsent();
    const emergencyAccountIds = useEmergencyAccountIds();
    const url = useReportUrlState();
    const customExtensions = useCustomExtensions();
    const blueprintNames = useAgentBlueprintNames(rolesData, workloads.pimGroups.data);
    const now = useNow();
    const retryingRef = useRef(false);
    // The spinner of "Try again" in the failed settings box; the ref also ignores a second click while it runs
    const [isRetryingFailed, setIsRetryingFailed] = useState(false);
    const [exportScope, setExportScope] = useState<{ roles: RoleDetailData[]; groups: PimGroupData[]; filterSentence: string; searchTerm: string; at: Date } | null>(null);
    const { accounts } = useMsal();
    const account = accounts[0];
    const tenantName = useTenantName(account?.tenantId);

    // Page mount: fetchData honours the 60 minute TTL and the session cache; refreshData would wipe that cache
    // before the provider has filled the state from it (docs/architecture/graph-and-data.md, Refresh semantics)
    useEffect(() => {
        if (rolesData.length === 0 && !loading && !error) fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once on mount
    }, []);

    const groupsPhase = workloadLoading.pimGroups.phase;
    const isGroupsLoading = groupsPhase === "fetching" || groupsPhase === "processing" || groupsPhase === "consent" || groupsPhase === "idle";
    const lastSync = syncHistory && syncHistory.length > 0 ? syncHistory[0] : null;
    const isAnyLoading = isWorkloadLoading("directoryRoles") || isWorkloadLoading("pimGroups");
    const synced = lastSync && !isAnyLoading ? formatSyncedAgo(lastSync.timestamp, now) : null;
    // "synced 3 min ago" reads "Synced 3 min ago." in the sentence under the title
    const syncedText = synced ? `${synced.charAt(0).toUpperCase()}${synced.slice(1)}.` : undefined;

    const extensionList = customExtensions.status === "granted" && !customExtensions.loading ? customExtensions.extensions : null;
    const exportData: ExportData | null = exportScope
        ? {
            allRoles: rolesData,
            allGroups: workloads.pimGroups.data,
            filteredRoles: exportScope.roles,
            filteredGroups: exportScope.groups,
            canExportGroups: workloads.pimGroups.consent.consented && workloads.pimGroups.data.length > 0,
            filterSentence: exportScope.filterSentence,
            searchTerm: exportScope.searchTerm,
            lists: { authenticationContexts, customExtensions: extensionList },
            authenticationContexts,
            emergencyIds: emergencyAccountIds,
            meta: {
                tenantId: account?.tenantId ?? "",
                tenantName: tenantName ?? undefined,
                exporter: account?.name ? `${account.name} (${account.username})` : account?.username,
                appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
                readAt: { directoryRoles: workloads.directoryRoles.lastFetched, pimGroups: workloads.pimGroups.lastFetched },
                exportedAt: exportScope.at,
            },
        }
        : null;

    return (
        <>
            <ReportBody
                changeHrefFor={(target) => changeInConfigureHref(writeAccess.access, target)}
                roles={rolesData}
                groups={workloads.pimGroups.data}
                blueprintNames={blueprintNames}
                emergencyAccountIds={emergencyAccountIds}
                isRolesLoading={loading}
                isGroupsConsented={workloads.pimGroups.consent.consented}
                isGroupsLoading={isGroupsLoading}
                policiesLoading={policiesLoading}
                authenticationContexts={authenticationContexts}
                useMembership={useGroupMembership}
                customExtensions={customExtensions.status === "granted" && !customExtensions.loading ? customExtensions.extensions : null}
                // The consent popup first (enableWorkload assumes it happened), then the workload is switched on and read
                onGrantGroups={() => {
                    void requestConsent("pimGroups").then(async (isGranted) => {
                        if (!isGranted) return;
                        await enableWorkload("pimGroups");
                        setWorkloadVisible("pimGroups", true);
                    });
                }}
                rolesError={error ?? null}
                onRetryAll={() => void refreshData(false)}
                failedRoleIds={failedRoleIds}
                // Only the roles whose settings failed are asked again, not the whole load
                onRetryFailed={() => {
                    if (retryingRef.current) return;
                    retryingRef.current = true;
                    setIsRetryingFailed(true);
                    void runWorkerPool({ items: failedRoleIds, workerCount: 4, delayMs: 300, processor: (id) => fetchPolicyForRole(id) })
                        .finally(() => {
                            retryingRef.current = false;
                            setIsRetryingFailed(false);
                        });
                }}
                isRetryingFailed={isRetryingFailed}
                groupsError={groupsPhase === "error" ? (workloadLoading.pimGroups.error ?? "Microsoft Graph did not answer.") : null}
                onRetryGroups={() => void refreshWorkload("pimGroups", false)}
                syncedText={syncedText}
                refresh={<RefreshButton />}
                status={<LoadingStatus subject="settings" />}
                onExport={(scope) => setExportScope({ ...scope, at: new Date() })}
                url={url}
            />
            <ReportExportDialog isOpen={exportScope !== null} onClose={() => setExportScope(null)} data={exportData} />
        </>
    );
}

export default function ReportPage() {
    return (
        <Suspense fallback={
            <div className="mx-auto max-w-[1376px]">
                <Skeleton className="mb-2 block" width={160} height={32} />
                <Skeleton className="mb-8 block" width={320} height={16} />
            </div>
        }>
            <ReportPageContent />
        </Suspense>
    );
}
