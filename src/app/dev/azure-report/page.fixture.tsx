"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame } from "@/components/shell/ShellFrame";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureRolePolicyState } from "@/hooks/useAzureRolePolicy";
import { AzureConsentView } from "@/app/azure/components/AzureConsentScreen";
import { AzureExportDialog } from "@/app/azure/report/components/AzureExportDialog";
import { AzureLoadError } from "@/app/azure/report/components/AzureLoadError";
import { AzureReportBody, type UsePrivilegedPolicies } from "@/app/azure/report/components/AzureReportBody";
import { AzureReportEmpty } from "@/app/azure/report/components/AzureReportEmpty";
import { AzureReportHead } from "@/app/azure/report/components/AzureReportHead";
import { AzureReportLoading } from "@/app/azure/report/components/AzureReportLoading";
import { AzureRoleDetail } from "@/app/azure/report/components/AzureRoleDetail";
import { RoleSettingsPanel } from "@/app/azure/report/components/RoleSettingsPanel";
import { ThrottleNotice } from "@/app/azure/report/components/ThrottleNotice";
import { VisibilityLine } from "@/app/azure/report/components/VisibilityLine";
import { DEFAULT_AZURE_FILTERS, buildAssignmentRows, defaultScopeId, findScope, flattenScopeTree, type AzureReportFilters } from "@/utils/azureReport";
import type { AzureListView } from "@/utils/azureRoleView";
import { DEFAULT_AZURE_EXPORT_CHOICE, allScopeRows, type AzureExportData, type AzureExportView } from "@/utils/azureExportPlan";
import { AZURE_FIXTURE_MY_ROLES, AZURE_FIXTURE_PANEL_ID, buildAzurePanelRules, buildAzurePanelSettings, buildAzureReportFixture } from "@/__tests__/fixtures/azureReportFixture";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { withBelowBudgetSpent } from "@/__tests__/fixtures/azureUnreadFixture";
import { topReadableScopes } from "@/utils/azureScopes";
import { DetailsToggle } from "@/components/ui/DetailsToggle";

/**
 * The Azure Report with the Contoso fixture and no sign-in (NG-96). The `.fixture.tsx` extension keeps it out of a normal
 * build (see the Report fixture). Query parameter `state`: none (the report) | scope | filtered | notices | panel |
 * inherited-only | filters-open | panel-loading | panel-missing | panel-failed | panel-unavailable | panel-no-access | tree-partial | loading | empty | empty-roles |
 * empty-roles-only-eligible | empty-roles-failed | failed | consent | consent-admin | export | export-all | export-empty |
 * export-loading | export-reading | roles | roles-selected | roles-marked | roles-policy-failed | roles-scope | roles-no-mfa (the role view,
 * Roles on the switch; the others keep the assignments view) | unread (the first subscription read below its own level with
 * a read budget that ran out: Read the rest). Query parameter `details` = on (default) | off.
 */

const NOBODY = { ...DEFAULT_AZURE_FILTERS, query: "nobody" };

/** roles-no-mfa: the fixture Owner policy without MFA on activation, for every privileged role asked (Azure spec 15.6) */
const NO_MFA_RULES = buildAzurePanelRules().map((rule) => (rule.id === "Enablement_EndUser_Assignment" ? { ...rule, enabledRules: ["Justification"] } : rule));
const useNoMfaPolicies: UsePrivilegedPolicies = (_scopeId, roleIds) => new Map(roleIds.map((id) => [id.toLowerCase(), { status: "loaded", rules: NO_MFA_RULES }]));

/** The sync sentence of the fixture, as the page writes it */
const SYNCED = "synced 3 min ago";

const FAILED_TEXT = "Azure Resource Manager is not available. Azure answered 503. Try again in a few minutes.";

/** The description of the Owner role, as the role definition reads it */
const ROLE_DESCRIPTION = "Grants full access to manage all resources, including the ability to assign roles in Azure RBAC.";

/** unread: the budget pays for the listing and one scope (two requests each), so the rest of the first subscription is not read */
const UNREAD_BUDGET = 4;

/** The root scope `/`, which the fixture list does not contain; used only by the panel-unavailable state */
const ROOT_SCOPE: AzureScope = { id: "/", name: "/", level: "root", parentId: null };

function panelState(state: string): AzureRolePolicyState {
    if (state === "panel-loading") return { status: "loading" };
    if (state === "panel-missing") return { status: "missing" };
    if (state === "panel-unavailable") return { status: "unavailable" };
    if (state === "panel-no-access") return { status: "noAccess" };
    // A failure that Try again can fix; no access is its own state (panel-no-access)
    if (state === "panel-failed") return { status: "failed", title: "Azure Resource Manager is not available", detail: "Azure answered 503. Try again in a few minutes." };
    return { status: "loaded", settings: buildAzurePanelSettings(), rules: buildAzurePanelRules(), lastModified: null };
}

function AzureReportFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const state = params.get("state") ?? "";
    const isDetailed = params.get("details") !== "off";
    const fixture = useMemo(() => {
        const all = buildAzureReportFixture();
        if (state !== "unread") return all;
        // The first subscription in tree order is read below its own level; the planner of the adapter spends the budget
        const first = flattenScopeTree(all.scopes).map((row) => row.scope).find((s) => s.level === "subscription");
        if (!first) return all;
        const inside = all.scopes.filter((s) => s.id.toLowerCase().startsWith(`${first.id.toLowerCase()}/`));
        const top = topReadableScopes(inside.filter((s) => s.level === "resourceGroup"), inside.filter((s) => s.level === "resource"));
        return withBelowBudgetSpent(all, first.id.split("/").filter(Boolean)[1] ?? "", top, UNREAD_BUDGET);
    }, [state]);
    const { scopes } = fixture;
    // inherited-only: rg-sandbox without its own assignments, so the default Origin hides only inherited rows
    const sandbox = scopes.find((s) => s.level === "resourceGroup" && s.name === "rg-sandbox");
    const assignments = useMemo(
        () => (state === "inherited-only" && sandbox ? fixture.assignments.filter((a) => !a.scopeId.toLowerCase().startsWith(sandbox.id.toLowerCase())) : fixture.assignments),
        [state, sandbox, fixture],
    );
    // panel-unavailable: the same assignment at the root scope, the only place the note appears (the list has no root scope)
    const [roleTarget, setRoleTarget] = useState<AzureAssignment | null>(() => {
        const panel = state.startsWith("panel") ? assignments.find((a) => a.id === AZURE_FIXTURE_PANEL_ID) ?? null : null;
        return panel && state === "panel-unavailable" ? { ...panel, scopeId: ROOT_SCOPE.id } : panel;
    });

    // The first active, permanent user of the fixture is marked emergency access, so the fixture shows one such tag
    const emergencyAccountIds = useMemo<ReadonlySet<string>>(() => {
        const first = fixture.assignments.find((a) => a.principalType === "User" && a.state === "active" && a.endDateTime === null);
        return new Set(first ? [first.principalId.toLowerCase()] : []);
    }, [fixture]);

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    const rgWeb = scopes.find((s) => s.level === "resourceGroup" && s.name === "rg-web");
    const isExport = state.startsWith("export");
    const startFilters: AzureReportFilters = state === "filtered" || state === "export-empty" ? NOBODY : state === "filters-open" ? { ...DEFAULT_AZURE_FILTERS, status: "eligible", privileged: true } : state === "roles-marked" ? { ...DEFAULT_AZURE_FILTERS, status: "eligible" } : DEFAULT_AZURE_FILTERS;
    const [selectedId, setSelectedId] = useState<string | null>(state === "scope" || state === "roles-scope" ? rgWeb?.id ?? null : state === "inherited-only" ? sandbox?.id ?? null : null);
    const listView: AzureListView = state.startsWith("roles") ? "roles" : "assignments";
    const panelRoleId = fixture.assignments.find((a) => a.id === AZURE_FIXTURE_PANEL_ID)?.roleDefinitionId ?? null;
    const [roleId, setRoleId] = useState<string | null>(state === "roles-selected" ? panelRoleId : null);
    const rolePolicyState = panelState(state === "roles-policy-failed" ? "panel-failed" : "");
    const [filters, setFilters] = useState<AzureReportFilters>(startFilters);
    const exportView = useMemo<AzureExportView | null>(() => {
        if (!isExport) return null;
        const scopeId = defaultScopeId(scopes);
        const exportFilters = filters;
        return { rows: buildAssignmentRows(assignments, scopes, scopeId, exportFilters), scope: findScope(scopes, scopeId), filters: exportFilters };
    }, [isExport, filters, scopes, assignments]);
    const allRows = useMemo(() => allScopeRows(assignments, scopes), [assignments, scopes]);
    const exportData = useMemo<AzureExportData | null>(() => {
        if (!exportView) return null;
        return {
            view: exportView,
            allRows,
            scopes,
            emergencyIds: emergencyAccountIds,
            homeTenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63",
            isLoading: state === "export-loading",
            outcomeOf: () => undefined,
            meta: {
                tenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63",
                tenantName: "Contoso",
                exporter: "Alex Wilber (alexw@contoso.com)",
                readAt: "2026-10-24T09:55:00Z",
                exportedAt: new Date("2026-10-24T10:00:00Z"),
            },
        };
    }, [exportView, allRows, scopes, emergencyAccountIds, state]);
    // tree-partial: the first subscription in tree order is read as Partial, the second is still Loading (copies, the fixture is not changed)
    const treeScopes = useMemo<AzureScope[]>(() => {
        if (state !== "tree-partial") return scopes;
        const [first, second] = flattenScopeTree(scopes).map((row) => row.scope).filter((s) => s.level === "subscription");
        return scopes.map((s) => (s.id === first?.id ? { ...s, access: "partial" } : s.id === second?.id ? { ...s, access: "loading" } : s));
    }, [state, scopes]);
    const noop = () => undefined;

    let content: ReactNode;
    if (state === "consent" || state === "consent-admin") {
        content = <AzureConsentView status={state === "consent-admin" ? "needsAdmin" : "idle"} onEnable={noop} />;
    } else if (state === "loading" || state === "empty" || state === "empty-roles" || state === "empty-roles-only-eligible" || state === "empty-roles-failed" || state === "failed") {
        content = (
            <div className="mx-auto max-w-[1376px]">
                <AzureReportHead scopeName={null} syncedText={SYNCED} refresh={<RefreshButtonView isDisabled={false} onRefresh={noop} />} />
                {!state.startsWith("empty") && <VisibilityLine className="mt-4" />}
                <div className="mt-4 flex flex-col gap-4">
                    {state === "loading" && <AzureReportLoading message="Loading Azure role assignments: 1 of 2 subscriptions" percent={50} />}
                    {state === "empty" && <AzureReportEmpty myRoles={{ active: [], eligible: [] }} />}
                    {state === "empty-roles" && <AzureReportEmpty myRoles={AZURE_FIXTURE_MY_ROLES} />}
                    {state === "empty-roles-only-eligible" && <AzureReportEmpty myRoles={{ active: [], eligible: AZURE_FIXTURE_MY_ROLES.eligible }} />}
                    {state === "empty-roles-failed" && <AzureReportEmpty myRoles="failed" />}
                    {state === "failed" && <AzureLoadError message={FAILED_TEXT} onRetry={noop} isRetrying={false} />}
                </div>
            </div>
        );
    } else {
        content = (
            <>
                <AzureReportBody
                    syncedText={SYNCED}
                    refresh={<RefreshButtonView isDisabled={false} onRefresh={noop} />}
                    details={{ isDetailed, toggle: <DetailsToggle isChecked={isDetailed} onChange={() => undefined} /> }}
                    scopes={treeScopes}
                    assignments={assignments}
                    onExport={noop}
                    onOpenRole={setRoleTarget}
                    view={listView}
                    onViewChange={noop}
                    roleId={roleId}
                    onSelectRole={setRoleId}
                    onClearRole={() => setRoleId(null)}
                    getShareUrl={(id) => `/azure/report?view=roles&role=${id}`}
                    usePrivilegedPolicies={state === "roles-no-mfa" ? useNoMfaPolicies : undefined}
                    renderRoleDetail={(props) => (
                        <AzureRoleDetail
                            detail={props.detail}
                            scopeName={props.scope.name}
                            description={ROLE_DESCRIPTION}
                            policyState={rolePolicyState}
                            onRetryPolicy={noop}
                            tab={props.tab}
                            onTabChange={props.onTabChange}
                            emergencyAccountIds={emergencyAccountIds}
                            isHiddenByFilter={props.isHiddenByFilter}
                            getShareUrl={props.getShareUrl}
                            onOpenSettings={setRoleTarget}
                        />
                    )}
                    selectedId={selectedId}
                    filters={filters}
                    onSelectScope={setSelectedId}
                    onQueryChange={(query) => setFilters((current) => ({ ...current, query }))}
                    onFiltersChange={setFilters}
                    initialIsFiltersOpen={state === "filters-open"}
                    emergencyAccountIds={emergencyAccountIds}
                    onReadRest={noop}
                    notice={state === "notices" ? <><ThrottleNotice /><AzureLoadError message={FAILED_TEXT} onRetry={noop} isRetrying={false} /></> : undefined}
                />
                <RoleSettingsPanel assignment={roleTarget} scopes={state === "panel-unavailable" ? [ROOT_SCOPE, ...scopes] : scopes} state={panelState(state)} onRetry={noop} onClose={() => setRoleTarget(null)} />
                <AzureExportDialog
                    data={exportData}
                    onClose={noop}
                    loadingCount={state === "export-loading" ? 1 : 0}
                    readPolicies={async () => undefined}
                    initialChoice={state === "export-all" ? { ...DEFAULT_AZURE_EXPORT_CHOICE, applyFilter: false } : DEFAULT_AZURE_EXPORT_CHOICE}
                    initialReading={state === "export-reading" ? { done: 2, total: 5 } : undefined}
                />
            </>
        );
    }

    return (
        <ShellFrame
            currentPath="/azure/report"
            account={{
                user: { displayName: "Alex Wilber", userPrincipalName: "alexw@contoso.com", initials: "AW" },
                tenantName: "Contoso",
                tenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63",
                theme,
                onThemeChange: setTheme,
                updateInfo: null,
                appVersion: "v3.2.0",
                hasUnseenWhatsNew: false,
                onOpenWhatsNew: noop,
                onOpenHelp: noop,
                onSignOut: noop,
            }}
            isRefreshing={false}
            onRefresh={noop}
            openMenu={null}
            onOpenMenuChange={noop}
        >
            {content}
        </ShellFrame>
    );
}

export default function AzureReportFixturePage() {
    return (
        <Suspense fallback={null}>
            <AzureReportFixture />
        </Suspense>
    );
}
