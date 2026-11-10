"use client";

import { Suspense, useMemo, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { SyncStatusView } from "@/components/SyncStatus";
import { LoadingSentence } from "@/components/LoadingStatus";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { DashboardHead } from "@/app/dashboard/components/basic/DashboardHead";
import { DashboardOverview } from "@/app/dashboard/components/basic/DashboardOverview";
import { DashboardNotices } from "@/app/dashboard/components/DashboardNotices";
import { ScopeControl } from "@/app/dashboard/components/advanced/ScopeControl";
import { parseDashboardFilter } from "@/utils/dashboardFilter";
import { summarizeAlerts } from "@/utils/alertSummary";
import type { ViewMode } from "@/contexts/ViewModeContext";
import { REPORT_EMERGENCY_IDS, REPORT_EXTENSIONS, buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";

/**
 * The Entra dashboard with the Contoso fixture of the design boards and no sign-in. The `.fixture.tsx` extension keeps it out of a
 * normal build: `next.config.ts` adds the extension only with NEXT_PUBLIC_FIXTURES=1 (`npm run visual` builds it that way).
 * Query parameters: `view` = basic (default) | advanced, `state` = default | loading | settings-failed (3 roles whose settings failed, the notices under the head), `f` = the dashboard filter of the URL, `details` = on (default) | off.
 */
function DashboardFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const [openMenu, setOpenMenu] = useState<ShellMenu>(null);
    const isAdvanced = params.get("view") === "advanced";
    const viewMode: ViewMode = isAdvanced ? "advanced" : "basic";
    const isLoading = params.get("state") === "loading";
    const isSettingsFailed = params.get("state") === "settings-failed";
    const isDetailed = params.get("details") !== "off";
    const filter = useMemo(() => parseDashboardFilter(params.get("f")), [params]);
    const rolesData = useMemo(() => buildReportRoles(), []);
    const groupsData = useMemo(() => buildReportGroups(), []);
    const emergencyAccountIds = useMemo(() => new Set<string>(REPORT_EMERGENCY_IDS), []);
    const tenantExtensionIds = useMemo(() => new Set<string>(REPORT_EXTENSIONS.map((e) => e.id)), []);
    const [lastSyncedAt] = useState(() => new Date(Date.now() - 4 * 60_000));
    const alertsSummary = useMemo(() => summarizeAlerts([], new Set()), []);

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    return (
        <ShellFrame
            currentPath="/dashboard"
            account={{
                user: { displayName: "Alex Wilber", userPrincipalName: "alexw@contoso.com", initials: "AW" },
                tenantName: "Contoso",
                tenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63",
                theme,
                onThemeChange: setTheme,
                updateInfo: null,
                appVersion: "v3.2.0",
                hasUnseenWhatsNew: false,
                onOpenWhatsNew: () => undefined,
                onOpenHelp: () => undefined,
                onSignOut: () => undefined,
            }}
            isRefreshing={false}
            onRefresh={() => undefined}
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
        >
            <div className="mx-auto flex max-w-[1376px] flex-col gap-4 outline-none">
                <div className="mb-2 flex flex-col gap-4 border-b border-line pb-5">
                    <DashboardHead
                        viewMode={viewMode}
                        onViewModeChange={() => undefined}
                        syncStatus={<SyncStatusView lastSyncedAt={lastSyncedAt} isLoading={false} />}
                        refresh={<RefreshButtonView isDisabled={false} onRefresh={() => undefined} />}
                        isExportDisabled={false}
                        onExport={() => undefined}
                        scopeControl={isAdvanced ? <ScopeControl scope="privileged" onChange={() => undefined} /> : undefined}
                        detailsToggle={<DetailsToggle isChecked={isDetailed} onChange={() => undefined} />}
                    />
                    {isLoading && <LoadingSentence sentence="Loading role settings, 12 of 33" />}
                </div>
                <DashboardNotices failedCount={isSettingsFailed ? 3 : 0} roleCount={rolesData.length} groupCount={groupsData.length} notReadableRoleCount={0} notReadableGroupCount={0} onRefresh={() => undefined} />
                <DashboardOverview
                    changeHrefFor={() => null}
                    rolesData={rolesData}
                    groupsData={groupsData}
                    counting={{ directoryRoles: true, pimGroups: true, unmanagedGroups: true, agents: true }}
                    filter={filter}
                    isRolesLoading={isLoading}
                    isGroupsLoading={false}
                    policiesLoading={isLoading}
                    emergencyAccountIds={emergencyAccountIds}
                    onSetFilter={() => undefined}
                    onRemoveFilterKey={() => undefined}
                    showBlocks={!isAdvanced}
                    showAdvanced={isAdvanced}
                    isDetailed={isDetailed}
                    scope="privileged"
                    tenantExtensionIds={tenantExtensionIds}
                    rolesError={null}
                    pimGroupsConsented
                    pimGroupsError={null}
                    onGrantPimGroups={() => undefined}
                    onRetryPimGroups={() => undefined}
                    alerts={{
                        state: "ready",
                        summary: alertsSummary,
                        errorMessage: null,
                        isGranting: false,
                        showDismissed: false,
                        onGrant: () => undefined,
                        onRetry: () => undefined,
                        onDismiss: () => undefined,
                        onRestoreDismissed: () => undefined,
                        onShowDismissedChange: () => undefined,
                    }}
                />
            </div>
        </ShellFrame>
    );
}

export default function DashboardFixturePage() {
    return (
        <Suspense fallback={null}>
            <DashboardFixture />
        </Suspense>
    );
}
