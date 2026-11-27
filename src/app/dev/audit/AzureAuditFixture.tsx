"use client";

import { useMemo } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { AzureAuditBody } from "@/app/azure/audit/components/AzureAuditBody";
import { useAzureAuditUrlState } from "@/hooks/useAzureAuditUrlState";
import type { AzureAuditStatus, AzureWorkspaceInfo } from "@/hooks/useAzureAuditData";
import { AZURE_CUSTOM_ROLES, AZURE_ROLES, AZURE_SCOPE_IDS, buildContosoAzure, type DemoAzure, type DemoAzureLevel, type DemoAzureRole } from "@/demo/contoso/azure";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { demoGuid } from "@/demo/contoso/ids";
import type { AuditEvent, AzureEntraLogState, RawDirectoryAudit } from "@/types/audit.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope, AzureScopeLevel } from "@/types/azureResource.types";
import { mapAuditEvents } from "@/utils/auditEvents";
import { applyApprovers, buildAzureHolderKinds, expandGroupActivations, mapAzureAuditEvents, toRawActivityEvent, toRawArmRequest } from "@/utils/azureAuditEvents";
import { buildAzureAuditContext, holdingsOf, isAuthorizationOperation, type AzureAuditNotRead } from "@/utils/azureAuditRead";
import { buildAzureAuditPrivilege } from "@/utils/azureAuditView";
import { AZURE_FIXTURE_MY_ROLES, AZURE_FIXTURE_MY_ROLES_NO_CONSENT } from "@/__tests__/fixtures/azureReportFixture";

/**
 * The Azure Audit page with the Contoso events of the demo and no sign-in. The `.fixture.tsx` extension keeps it out of a
 * normal build (see the Audit fixture). It is not a page: the audit fixture route renders it for `surface=azure`, so it adds no route of its own. The events are `buildContosoAzure` and `buildDemoAzureAudit` through the real mapper
 * at a fixed time, shown in UTC, so a screenshot does not move. The page state is the real URL state: `days`, `kinds`, `who`,
 * `priv`, `failed`, `q`, `event`. Extra query parameter `state` = default | loading | failed | too-many | nothing (a read that
 * worked, with no event) | unreadable (every subscription refused) | partial (two subscriptions and the root not read) |
 * workspace, workspace-partial and workspace-failed (a chosen Log Analytics workspace read; partial: one of two failed; failed: all failed, back to 90 days) | no-entra (the Entra audit log was not read: no permission) | scope (a subscription chosen) | inherited (a resource group
 * chosen, Include inherited on) | export (the export dialog open). `roles=no-consent` with `state=unreadable` shows the note that PIM Manager has no read access to PIM for Groups; `details=on` shows more details;`filters=open` opens the Filters panel.
 */
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;
const READ_AT = "2026-11-05T11:58:00Z";
const WINDOW_START = "2026-08-07T11:58:00Z";
const DAY_MS = 86_400_000;
const ENTRA_ROW_DAYS = 30;

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
            ...(subscription?.readableScopes ? { access: "partial" as const } : {}),
        };
    });
}

function buildAssignments(azure: DemoAzure): AzureAssignment[] {
    // A removed assignment is left out, as the read engine does (reconcileInstances, AU-20c)
    return azure.instances.filter((i) => !isHidden(i.scope) && !i.removed).map((i) => ({
        // An eligibility has the id of its schedule, so an activation linked to it can tell the group it came through
        id: i.kind === "active" ? `fixture:${i.key}` : `${i.scope === "/" ? "" : i.scope}/providers/Microsoft.Authorization/roleEligibilitySchedules/${demoGuid(`azure:schedule:${i.key}`)}`,
        scopeId: i.scope,
        principalId: i.principal.id,
        principalName: i.principal.displayName,
        principalType: i.principal.type,
        ...(i.principal.userPrincipalName ? { principalUpn: i.principal.userPrincipalName } : {}),
        roleDefinitionId: i.role.id,
        roleName: i.role.displayName,
        state: i.kind === "active" ? "active" : "eligible",
        memberType: "direct",
        startDateTime: i.startDateTime,
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

/** The Entra audit log rows of the demo, as the directory log gives them: only the approval is read here */
function entraRows(): RawDirectoryAudit[] {
    const from = FIXED_NOW.getTime() - ENTRA_ROW_DAYS * DAY_MS;
    return buildDemoAuditRows(FIXED_NOW).filter((row) => Date.parse(row.activityDateTime) >= from);
}

interface Built {
    scopes: AzureScope[];
    assignments: AzureAssignment[];
    events: AuditEvent[];
    holderKinds: ReturnType<typeof buildAzureHolderKinds>;
    definitions: ReadonlyMap<string, ArmRoleDefinition>;
    homeTenantId: string;
}

function build(hasEntra: boolean): Built {
    const azure = buildContosoAzure(FIXED_NOW);
    const scopes = buildScopes(azure);
    const assignments = buildAssignments(azure);
    const context = buildAzureAuditContext(scopes, assignments);
    const assignmentRequests = azure.audit.assignmentRequests.map((row) => toRawArmRequest(row));
    const eligibilityRequests = azure.audit.eligibilityRequests.map((row) => toRawArmRequest(row));
    // As the real read: the management group and tenant answers keep only the authorization operations
    const activity = azure.audit.activity.map((row) => toRawActivityEvent(row)).filter((row) => isAuthorizationOperation(row.operationName?.value));
    let mapped = mapAzureAuditEvents({ assignmentRequests, eligibilityRequests, activity, context });
    if (hasEntra) {
        const rows = entraRows();
        mapped = [...applyApprovers(mapped, rows), ...expandGroupActivations(mapAuditEvents(rows), holdingsOf(assignments), context)];
    }
    const events = [...mapped].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const holderKinds = buildAzureHolderKinds({ requests: [...assignmentRequests, ...eligibilityRequests], assignments, servicePrincipalTypes: new Map() });
    const definitions = new Map([...Object.values<DemoAzureRole>(AZURE_ROLES), ...Object.values<DemoAzureRole>(AZURE_CUSTOM_ROLES)].map((role) => [role.id.toLowerCase(), definitionOf(role)]));
    return { scopes, assignments, events, holderKinds, definitions, homeTenantId: azure.tenantId };
}

const STATUS_OF_STATE: Record<string, AzureAuditStatus> = {
    loading: "loading",
    failed: "failed",
    "too-many": "too-many",
};

/** The chosen workspace of the states `workspace`, `workspace-partial` and `workspace-failed` (AU-19): what was read, and what was not */
const WORKSPACE_REACH = "2026-06-15T00:00:00Z";
const SENDING = new Set([demoGuid("azure:sub:production"), demoGuid("azure:sub:test")].map((id) => id.toLowerCase()));
const WORKSPACE_FACTS = { name: "law-contoso-activity", customerId: demoGuid("law:activity") };
function workspaceFor(state: string): AzureWorkspaceInfo | null {
    const read = { name: WORKSPACE_FACTS.name, customerId: WORKSPACE_FACTS.customerId };
    if (state === "workspace") return { summary: { total: 2, read: 2, failed: [], dropped: 0, otherTenant: 0, graphOnly: 0, graphFailure: null }, fellBack: false, sendingSubscriptionIds: SENDING, oldest: WORKSPACE_REACH };
    if (state === "workspace-partial") return { summary: { total: 2, read: 1, failed: [{ name: "law-contoso-apps", reason: "403" }], dropped: 0, otherTenant: 0, graphOnly: 0, graphFailure: null }, fellBack: false, sendingSubscriptionIds: SENDING, oldest: WORKSPACE_REACH };
    if (state === "workspace-failed") return { summary: { total: 2, read: 0, failed: [{ name: read.name, reason: "403" }, { name: "law-contoso-apps", reason: "403" }], dropped: 0, otherTenant: 0, graphOnly: 0, graphFailure: null }, fellBack: true, sendingSubscriptionIds: null, oldest: null };
    return null;
}

export function AzureAuditFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const state = params.get("state") ?? "default";
    // The workspace states offer a year, as a chosen workspace does; the others 90 days
    // After `workspace-failed` the page is back at the native 90 days, as the real read does
    const isWorkspaceState = state === "workspace" || state === "workspace-partial";
    const realUrl = useAzureAuditUrlState(isWorkspaceState ? 365 : 90);
    const hasEntra = state !== "no-entra" && state !== "unreadable";
    const builtBase = useMemo(() => build(hasEntra), [hasEntra]);
    // What a workspace adds: rows older than the 90 days of the native log, naming the workspace
    const built = useMemo(() => {
        if (!isWorkspaceState) return builtBase;
        const older = builtBase.events.filter((event) => event.kind === "usage").slice(0, 6).map((event): AuditEvent => ({
            ...event,
            id: `${event.id}|older`,
            time: new Date(Date.parse(event.time) - 100 * 86_400_000).toISOString(),
            source: "azure-workspace",
            workspace: WORKSPACE_FACTS.name,
        }));
        return { ...builtBase, events: [...builtBase.events, ...older] };
    }, [builtBase, isWorkspaceState]);
    const workspaceInfo = useMemo(() => workspaceFor(state), [state]);
    const subscriptions = useMemo(() => built.scopes.filter((scope) => scope.level === "subscription"), [built.scopes]);

    // The scope bar of the states `scope` and `inherited` is set here; any other state reads the URL
    const url = useMemo(() => {
        if (state === "scope") return { ...realUrl, scopeId: AZURE_SCOPE_IDS.production };
        if (state === "inherited") return { ...realUrl, scopeId: AZURE_SCOPE_IDS.rgWeb, includeInherited: true };
        // `select=group` shows the first row that an activation of a group membership gave for an Azure role the group holds
        const groupRow = params.get("select") === "group" ? built.events.find((event) => event.environment === "group") : undefined;
        if (groupRow) return { ...realUrl, state: { ...realUrl.state, event: groupRow.id } };
        return realUrl;
    }, [state, realUrl, params, built.events]);

    const { events, notRead } = useMemo(() => {
        if (state === "nothing" || state === "unreadable") {
            const refused: AzureAuditNotRead[] = state === "unreadable" ? subscriptions.map((scope) => ({ part: "requests", scopeId: scope.id, reason: "refused" })) : [];
            return { events: [] as AuditEvent[], notRead: refused };
        }
        if (state === "partial") {
            const [first, second] = subscriptions;
            const unread: AzureAuditNotRead[] = [
                { part: "requests", scopeId: first.id, reason: "refused" },
                { part: "log", scopeId: second.id, reason: "forbidden" },
                { part: "log", scopeId: "/", reason: "forbidden" },
            ];
            const gone = new Set([first.id.toLowerCase(), second.id.toLowerCase()]);
            return { events: built.events.filter((event) => !event.azure || !gone.has(`/subscriptions/${event.azure.subscriptionId}`.toLowerCase())), notRead: unread };
        }
        return { events: built.events, notRead: [] as AzureAuditNotRead[] };
    }, [state, built.events, subscriptions]);

    const entraLog: AzureEntraLogState = hasEntra ? "read" : "no permission";
    const privilege = useMemo(() => ({
        lookup: buildAzureAuditPrivilege(built.definitions, built.holderKinds),
        error: null,
        onRetry: () => undefined,
    }), [built.definitions, built.holderKinds]);
    const isDetailed = params.get("details") === "on";
    // PIM for Groups as read: the person who activated the group that holds a role, and one who did not, so both verdicts show
    const pimGroups = useMemo(() => {
        const activated = built.events.find((event) => event.environment === "group");
        const holding = built.assignments.find((item) => item.state === "active" && item.principalType === "Group" && item.principalName === activated?.viaGroup);
        if (!holding) return [];
        const member = (principalId: string, displayName: string) => ({ assignmentType: "eligible", accessType: "member", principalId, principal: { displayName } });
        return [{
            group: { id: holding.principalId, displayName: holding.principalName },
            assignments: [member(activated?.target?.id ?? "", activated?.target?.name ?? ""), member(demoGuid("user:fixture-member"), "Nestor Wilke")],
        }] as unknown as PimGroupData[];
    }, [built.events, built.assignments]);

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    return (
        <ShellFrame
            currentPath="/azure/audit"
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
            openMenu={null}
            onOpenMenuChange={() => undefined}
        >
            <AzureAuditBody
                status={STATUS_OF_STATE[state] ?? "ready"}
                events={events}
                notRead={notRead}
                entraLog={entraLog}
                scopes={built.scopes}
                assignments={built.assignments}
                holderKinds={built.holderKinds}
                pimGroups={pimGroups}
                homeTenantId={built.homeTenantId}
                tenantName="Contoso"
                readAt={READ_AT}
                windowStart={isWorkspaceState ? WORKSPACE_REACH : WINDOW_START}
                loadedCount={state === "loading" ? 1200 : 0}
                progress={state === "loading" ? { done: 4, total: built.scopes.length } : { done: 0, total: 0 }}
                requestedDays={isWorkspaceState ? 180 : 90}
                maxDays={isWorkspaceState ? 365 : 90}
                entraLogDays={isWorkspaceState ? 180 : 30}
                workspace={workspaceInfo}
                banner={state === "default" ? { onDismiss: () => undefined } : undefined}
                now={FIXED_NOW}
                emergencyIds={new Set([demoGuid("user:bg01").toLowerCase()])}
                url={url}
                details={{ isDetailed, toggle: <DetailsToggle isChecked={isDetailed} onChange={() => undefined} /> }}
                refresh={<RefreshButtonView isDisabled={false} onRefresh={() => undefined} />}
                onRetry={() => undefined}
                onRefresh={() => undefined}
                onLoadDays={() => undefined}
                privilege={privilege}
                myRoles={state === "unreadable" ? (params.get("roles") === "no-consent" ? AZURE_FIXTURE_MY_ROLES_NO_CONSENT : AZURE_FIXTURE_MY_ROLES) : null}
                format={FORMAT}
                startFiltersOpen={params.get("filters") === "open"}
                startExportOpen={state === "export"}
                exportContext={{ tenantName: "Contoso", exporter: "Alex Wilber (alexw@contoso.com)", appVersion: "v3.2.0" }}
            />
        </ShellFrame>
    );
}
