"use client";

import { Suspense, useMemo, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { SyncStatusView } from "@/components/SyncStatus";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { AzurePlaceholder } from "@/app/azure/components/AzurePlaceholder";
import { AzureDashboardBody, countNotReadable } from "@/app/azure/components/dashboard/AzureDashboard";
import { useDashboardScope } from "@/hooks/useDashboardScope";
import type { ViewMode } from "@/contexts/ViewModeContext";
import { definitionsOf, planAzureDashboardReads, type AzureAlertOutcome, type AzureDashboardReads } from "@/hooks/useAzureDashboardReads";
import type { AzureRolePolicyOutcome } from "@/hooks/useAzureRolePolicy";
import type { ArmRoleDefinition, ArmRoleManagementAlert, ArmRoleManagementPolicy, AzureAssignment, AzureScope, AzureScopeLevel } from "@/types/azureResource.types";
import { graphRulesOf, parseArmPolicy } from "@/utils/armPolicyRules";
import { DELETED_PRINCIPAL } from "@/utils/azureDashboard";
import { azurePolicyKey } from "@/utils/azureScopes";
import { parseAzureReportUrlState } from "@/utils/azureReportFilter";
import { AZURE_CUSTOM_ROLES, AZURE_ROLES, AZURE_SCOPE_IDS, buildContosoAzure, DELETED_AZURE_PRINCIPAL, type DemoAzure, type DemoAzureLevel, type DemoAzureRole } from "@/demo/contoso/azure";
import { createFakeArm } from "@/demo/arm/server";
import { PEOPLE, SERVICE_PRINCIPALS } from "@/demo/contoso/tenant";
import { AZURE_FIXTURE_NOW } from "@/__tests__/fixtures/azureReportFixture";
import { withBelowBudgetSpent } from "@/__tests__/fixtures/azureUnreadFixture";
import { topReadableScopes } from "@/utils/azureScopes";

/**
 * The Azure environment in the shell with no sign-in (NG-85, NG-102b). Query parameters: `page` = dashboard (default) |
 * configure, `menu` = top | bottom (the account menu open), and for the dashboard `view` = advanced, `scope` (a scope
 * id), `delegated=0`, `details` = on (default) | off, `f` (the Report's filter), `export=1` (the export dialog open) and `state` = loading | failed | failed-stale | empty | throttled |
 * partial (one subscription not loaded) | unknown-kinds (the service principal types failed) | not-readable (two
 * privileged role settings not readable) | settings-failed (the reads of three privileged role settings failed) |
 * definitions-failed (the role definitions could not be read) | definitions-partial (the custom roles of one
 * subscription could not be read) | unread (the read budget below Contoso Labs ran out: Read the rest). The `.fixture.tsx` extension keeps it out of a normal build (see the
 * Report fixture).
 *
 * The dashboard is the real `AzureDashboardBody` with the demo's Azure data (`buildContosoAzure`, dated from a fixed
 * moment). The reads are what the fake ARM of the demo answers, taken synchronously: every role setting of the privileged
 * pairs, the PIM alerts per subscription, the role definitions and the service principal types.
 */

const LEVEL: Record<DemoAzureLevel, AzureScopeLevel> = {
    tenant: "root",
    managementgroup: "managementGroup",
    subscription: "subscription",
    resourcegroup: "resourceGroup",
    resource: "resource",
};

/** The scope the demo account cannot see (Contoso Labs, rg-private): the app never lists it */
const HIDDEN_SCOPE = AZURE_SCOPE_IDS.rgPrivate.toLowerCase();

const isHidden = (id: string) => id.toLowerCase() === HIDDEN_SCOPE || id.toLowerCase().startsWith(`${HIDDEN_SCOPE}/`);

/** `Microsoft.KeyVault/vaults` from `/subscriptions/{id}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{name}` */
function resourceTypeOf(id: string): string {
    const segs = id.split("/").filter((s) => s !== "");
    return `${segs[5]}/${segs[6]}`;
}

function buildScopes(azure: DemoAzure): AzureScope[] {
    return azure.scopes.filter((s) => !isHidden(s.id)).map((s) => {
        const level = LEVEL[s.level];
        const subscription = level === "subscription" ? azure.subscriptions.find((sub) => `/subscriptions/${sub.subscriptionId}`.toLowerCase() === s.id.toLowerCase()) : undefined;
        return {
            id: s.id,
            name: s.displayName,
            level,
            parentId: s.parentId,
            ...(level === "resource" ? { resourceType: resourceTypeOf(s.id) } : {}),
            ...(subscription ? { tenantId: subscription.tenantId ?? azure.tenantId } : {}),
            // A subscription the demo account reads only below its own level
            ...(subscription?.readableScopes ? { access: "partial" as const } : {}),
        };
    });
}

function buildAssignments(azure: DemoAzure): AzureAssignment[] {
    return azure.instances.filter((i) => !isHidden(i.scope)).map((i) => ({
        id: `fixture:${i.key}`,
        scopeId: i.scope,
        principalId: i.principal.id,
        principalName: i.principal.displayName,
        principalType: i.principal.type,
        ...(i.principal.userPrincipalName ? { principalUpn: i.principal.userPrincipalName } : {}),
        roleDefinitionId: i.role.id,
        roleName: i.role.displayName,
        state: i.kind === "active" ? "active" : "eligible",
        memberType: "direct",
        endDateTime: i.endDateTime,
        ...(i.assignmentType === "Activated" ? { isActivated: true as const } : {}),
        ...(i.role.custom ? { isCustomRole: true as const } : {}),
    }));
}

function definitionOf(role: DemoAzureRole): ArmRoleDefinition {
    return {
        id: `/providers/Microsoft.Authorization/roleDefinitions/${role.id}`,
        name: role.id,
        type: "Microsoft.Authorization/roleDefinitions",
        properties: { roleName: role.displayName, description: role.description, type: role.custom ? "CustomRole" : "BuiltInRole", permissions: [role.permissions] },
    };
}

const ARM_HOST = "https://management.azure.com";

/** The reads of the dashboard as the demo's fake ARM answers them, with every role setting loaded */
function buildReads(azure: DemoAzure, scopes: AzureScope[], assignments: AzureAssignment[]): AzureDashboardReads {
    const fake = createFakeArm(azure);
    const definitions = new Map([...Object.values<DemoAzureRole>(AZURE_ROLES), ...Object.values<DemoAzureRole>(AZURE_CUSTOM_ROLES)].map((role) => [role.id.toLowerCase(), definitionOf(role)]));
    const plan = planAzureDashboardReads({ assignments, scopes, definitions, scope: "all" });

    const settings = new Map<string, AzureRolePolicyOutcome>();
    for (const pair of plan.settingsPairs) {
        const url = new URL(`${ARM_HOST}${pair.scopeId}/providers/Microsoft.Authorization/roleManagementPolicies`);
        url.searchParams.set("api-version", "2020-10-01");
        url.searchParams.set("$filter", `roleDefinitionId eq '${pair.scopeId}/providers/Microsoft.Authorization/roleDefinitions/${pair.roleDefinitionId}'`);
        const answer = fake.handle({ method: "GET", url: url.toString() });
        const key = `${pair.scopeId.toLowerCase()}|${pair.roleDefinitionId.toLowerCase()}`;
        const policy = (answer.body as { value?: ArmRoleManagementPolicy[] }).value?.[0];
        if (answer.status === 200 && policy) settings.set(key, { status: "loaded", settings: parseArmPolicy(policy), rules: graphRulesOf(policy), lastModified: policy.properties.lastModifiedDateTime ?? null });
        else settings.set(key, { status: "missing" });
    }

    const alerts = new Map<string, AzureAlertOutcome>();
    for (const id of plan.alertSubscriptionIds) {
        const url = new URL(`${ARM_HOST}/subscriptions/${id}/providers/Microsoft.Authorization/roleManagementAlerts`);
        url.searchParams.set("api-version", "2022-08-01-preview");
        const answer = fake.handle({ method: "GET", url: url.toString() });
        alerts.set(id.toLowerCase(), answer.status === 200 ? { status: "loaded", alerts: (answer.body as { value: ArmRoleManagementAlert[] }).value } : { status: "noAccess" });
    }

    const spTypes = new Map(Object.values(SERVICE_PRINCIPALS).map((sp) => [sp.id.toLowerCase(), "isManagedIdentity" in sp && sp.isManagedIdentity ? "ManagedIdentity" : "Application"]));
    // As the reads mark him: the fake Graph does not find the deleted user
    spTypes.set(DELETED_AZURE_PRINCIPAL.id.toLowerCase(), DELETED_PRINCIPAL);
    return {
        definitions: { status: "loaded", byId: definitions, source: "tenant" },
        spTypes: { status: "loaded", byId: spTypes, isDeletedChecked: true },
        settings,
        settingsProgress: { done: settings.size, total: settings.size },
        alerts,
        alertsProgress: { done: alerts.size, total: alerts.size },
    };
}

/**
 * unread: the budget of the round below Contoso Labs pays for its listing and one scope (two requests each), so of
 * rg-labs and vm-labs-build only rg-labs is read
 */
const UNREAD_BUDGET = 4;

/** Contoso Labs with the read budget spent, as the adapter's planner leaves it (`withBelowBudgetSpent`) */
function withLabsUnread(azure: DemoAzure, content: { scopes: AzureScope[]; assignments: AzureAssignment[] }): { scopes: AzureScope[]; assignments: AzureAssignment[] } {
    const labs = azure.subscriptions.find((s) => s.readableScopes);
    if (!labs?.readableScopes) return content;
    const readable = labs.readableScopes.map((id) => ({ id }));
    const top = topReadableScopes(readable.filter((r) => r.id.split("/").filter(Boolean).length === 4), readable.filter((r) => r.id.split("/").filter(Boolean).length > 4));
    return withBelowBudgetSpent(content, labs.subscriptionId, top, UNREAD_BUDGET);
}

/** The text of a failed load, as the Azure Report fixture */
const FAILED_TEXT = "Azure Resource Manager is not available. Azure answered 503. Try again in a few minutes.";

/** Nothing read yet: the reads of a dashboard with no data */
const NO_READS: AzureDashboardReads = {
    definitions: { status: "loading" },
    spTypes: { status: "loading" },
    settings: new Map(),
    settingsProgress: { done: 0, total: 0 },
    alerts: new Map(),
    alertsProgress: { done: 0, total: 0 },
};

function AzureFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const page = params.get("page") === "configure" ? "Configure" : "Dashboard";
    const [openMenu, setOpenMenu] = useState<ShellMenu>(() => {
        const menu = params.get("menu");
        return menu === "top" || menu === "bottom" ? menu : null;
    });

    const azure = useMemo(() => buildContosoAzure(AZURE_FIXTURE_NOW), []);
    const state = params.get("state") ?? "";
    const isDetailed = params.get("details") !== "off";
    const hasNoData = state === "loading" || state === "failed" || state === "empty";
    const unread = useMemo(() => (state === "unread" ? withLabsUnread(azure, { scopes: buildScopes(azure), assignments: buildAssignments(azure) }) : null), [azure, state]);
    const scopes = useMemo(() => {
        if (hasNoData) return [];
        if (unread) return unread.scopes;
        const all = buildScopes(azure);
        if (state !== "partial") return all;
        // One subscription that could not be read: the partial load banner
        const failed = all.find((s) => s.level === "subscription" && s.access === undefined);
        return all.map((s) => (s === failed ? { ...s, access: "failed" as const } : s));
    }, [azure, hasNoData, state, unread]);
    const assignments = useMemo(() => (hasNoData ? [] : unread ? unread.assignments : buildAssignments(azure)), [azure, hasNoData, unread]);
    const reads = useMemo<AzureDashboardReads>(() => {
        if (hasNoData) return NO_READS;
        const read = buildReads(azure, scopes, assignments);
        if (state === "unknown-kinds") return { ...read, spTypes: { status: "failed" } };
        if (state === "definitions-failed") return { ...read, definitions: { status: "failed" } };
        if (read.definitions.status !== "loaded") return read;
        if (state === "definitions-partial") {
            const subscriptionCount = planAzureDashboardReads({ assignments: [], scopes, definitions: null, scope: "all" }).alertSubscriptionIds.length;
            return { ...read, definitions: { status: "partial", byId: read.definitions.byId, source: "subscriptions", failedSubscriptions: 1, subscriptionCount } };
        }
        if (state !== "not-readable" && state !== "settings-failed") return read;
        // not-readable: the first two privileged pairs cannot be read with the current access; settings-failed: the reads of the first three failed
        const pairs = planAzureDashboardReads({ assignments, scopes, definitions: read.definitions.byId, scope: "privileged" }).settingsPairs.slice(0, state === "not-readable" ? 2 : 3);
        const settings = new Map(read.settings);
        for (const pair of pairs) settings.set(azurePolicyKey(pair.scopeId, pair.roleDefinitionId), { status: state === "not-readable" ? "noAccess" : "failed" });
        return { ...read, settings };
    }, [azure, scopes, assignments, hasNoData, state]);
    const notReadable = useMemo(() => countNotReadable(assignments, definitionsOf(reads.definitions), reads.settings), [assignments, reads]);
    const view = state === "loading" ? "loading" : state === "failed" ? "failed" : state === "empty" ? "empty" : "report";
    // The two break-glass accounts of the demo tenant, as its settings mark them
    const emergencyIds = useMemo<ReadonlySet<string>>(() => new Set([PEOPLE.breakGlass1.id.toLowerCase(), PEOPLE.breakGlass2.id.toLowerCase()]), []);

    const url = useMemo(() => parseAzureReportUrlState(params.toString()), [params]);
    const [viewMode, setViewMode] = useState<ViewMode>(params.get("view") === "advanced" ? "advanced" : "basic");
    const [chosenScopeId, setChosenScopeId] = useState<string | null>(url.scopeId);
    const [filters, setFilters] = useState(() => ({ ...url.filters, query: "" }));
    const [includeDelegated, setIncludeDelegated] = useState(params.get("delegated") !== "0");
    const [advancedScope, setAdvancedScope] = useDashboardScope("azure-dashboard-scope");
    const [lastSyncedAt] = useState(() => new Date(Date.now() - 4 * 60_000));

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    const noop = () => undefined;

    return (
        <ShellFrame
            currentPath={page === "Configure" ? "/azure/configure" : "/azure"}
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
            {page === "Configure" ? (
                <AzurePlaceholder page={page} />
            ) : (
                <AzureDashboardBody
                    scopes={scopes}
                    assignments={assignments}
                    homeTenantId={azure.tenantId}
                    tenantName="Contoso"
                    chosenScopeId={chosenScopeId}
                    filters={filters}
                    includeDelegated={includeDelegated}
                    reads={reads}
                    emergencyIds={emergencyIds}
                    now={AZURE_FIXTURE_NOW}
                    isLoading={state === "loading"}
                    isThrottled={state === "throttled"}
                    view={view}
                    error={state === "failed" || state === "failed-stale" ? FAILED_TEXT : undefined}
                    myRoles={null}
                    notReadable={notReadable}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                    advancedScope={advancedScope}
                    onAdvancedScopeChange={setAdvancedScope}
                    syncStatus={<SyncStatusView lastSyncedAt={lastSyncedAt} isLoading={false} />}
                    refresh={<RefreshButtonView isDisabled={false} onRefresh={noop} />}
                    onRefresh={noop}
                    onSelectScope={setChosenScopeId}
                    onFiltersChange={setFilters}
                    onIncludeDelegatedChange={setIncludeDelegated}
                    exporter="Alex Wilber (alexw@contoso.com)"
                    version="v3.2.0"
                    dataReadAt={lastSyncedAt}
                    isExportInitiallyOpen={params.get("export") !== null}
                    details={{ isDetailed, canToggle: true, setDetailed: () => undefined }}
                    onReadRest={noop}
                />
            )}
        </ShellFrame>
    );
}

export default function AzureFixturePage() {
    return (
        <Suspense fallback={null}>
            <AzureFixture />
        </Suspense>
    );
}
