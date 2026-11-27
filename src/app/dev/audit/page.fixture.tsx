"use client";

import { Suspense, useMemo, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { AuditView } from "@/app/audit/components/AuditView";
import { useAuditUrlState } from "@/hooks/useAuditUrlState";
import type { AuditStatus } from "@/hooks/useAuditData";
import { AUDIT_DEMO_GROUP_ID, AUDIT_DEMO_ROLES, buildDemoAuditRows } from "@/demo/contoso/audit";
import { demoGuid } from "@/demo/contoso/ids";
import { mapAuditEvents } from "@/utils/auditEvents";
import { linkGroupRoles } from "@/utils/auditGroupRoles";
import { buildAuditPrivilege } from "@/utils/auditPrivilege";
import type { RoleDetailData } from "@/types/directoryRole.types";
import { workspaceCoverageNotes, workspaceNotice, workspaceNotRead, type WorkspaceSummary } from "@/utils/auditWorkspaceMerge";
import { workspaceSourceLabel } from "@/utils/auditView";
import type { AuditEvent, AuditKind } from "@/types/audit.types";
import { AzureAuditFixture } from "./AzureAuditFixture";
import { IDLE_EMERGENCY_IDS, IDLE_NOW, buildIdleEvents, buildIdleGroups, buildIdleMembership, buildIdleRoles, groupsMissingReason } from "./idleData";

/**
 * The Audit page with the Contoso events of the demo and no sign-in. The `.fixture.tsx` extension keeps it out of a normal
 * build: `next.config.ts` adds the extension only with NEXT_PUBLIC_FIXTURES=1 (`npm run visual` builds it that way). The
 * events are `buildDemoAuditRows` through `mapAuditEvents` at a fixed time, shown in UTC, so a screenshot does not move.
 * The page state is the real URL state: `days`, `kinds`, `env`, `failed`, `q`, `event`, and the selection of the timeline,
 * `from` and `to` (ISO times). Extra query parameter `state` =
 * default | workspace | workspace-nograph (the Entra audit log could not be read next to the workspaces) | workspace-partial (one of three workspaces not read) | workspace-failed (all failed, 30 days of Graph shown) | export (the export dialog open) | permission | role-missing | loading | failed | too-many | empty (a read that worked, with no event) | dense (the
 * demo plus 72 invented events inside one week, to see the points overlap on the timeline) | groups-missing (the No activation
 * view, `view=idle`, without PIM for Groups). With `view=idle` the page shows the No activation table on invented assignments
 * and events (`idleData.ts`) at its own fixed time;
 * `details=on` shows more details; `menu` = top | bottom opens the account menu. No match is `?q=` with a term nobody has.
 * `filters=open` opens the Filters panel. `priv=1` is Privileged only, judged by the roles below; `roles` = loading | failed |
 * no-flag shows it while the roles are read, when that read failed and when Graph gave no privileged flag.
 */
const FIXED_NOW = new Date("2026-11-05T12:00:00Z");
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;
/** The emergency access account of the demo (`Break Glass 01`), in lower case as the app keeps the ids */
const EMERGENCY_IDS: ReadonlySet<string> = new Set([demoGuid("user:bg01").toLowerCase()]);
const READ_AT = "2026-11-05T11:58:00Z";
const WINDOW_START = "2026-10-06T11:58:00Z";
/** How far back the invented workspaces reach (178 days before the read) */
const WORKSPACE_REACH = "2026-05-11T11:58:00Z";
const WORKSPACE_MAX_DAYS = 180;

const WORKSPACE_STATES: Record<string, { summary: WorkspaceSummary; fellBack: boolean }> = {
    workspace: { summary: { total: 2, read: 2, failed: [], dropped: 0, otherTenant: 0, graphOnly: 3 }, fellBack: false },
    "workspace-nograph": { summary: { total: 2, read: 2, failed: [], dropped: 0, otherTenant: 0, graphOnly: 0, graphFailure: "no reader role" }, fellBack: false },
    "workspace-partial": { summary: { total: 3, read: 2, failed: [{ name: "law-contoso-apps", reason: "403" }], dropped: 0, otherTenant: 0 }, fellBack: false },
    "workspace-failed": { summary: { total: 2, read: 0, failed: [{ name: "law-contoso-entra", reason: "403" }, { name: "law-contoso-apps", reason: "403" }], dropped: 0, otherTenant: 0 }, fellBack: true },
};

/**
 * 72 invented events between 25 Oct and 1 Nov 2026, spread over the kinds with some failures, close enough together that
 * the points of a row overlap at 1440 px. Names and sentences are made up.
 */
function buildDenseEvents(): AuditEvent[] {
    const kinds: AuditKind[] = ["usage", "usage", "assignment", "usage", "setting", "outside", "usage", "assignment", "system"];
    const verbs: Record<AuditKind, string> = {
        usage: "activated Helpdesk Administrator",
        assignment: "made eligible for Reports Reader",
        setting: "Maximum activation duration set for Teams Administrator",
        outside: "added to Directory Readers outside PIM",
        system: "Activation of Helpdesk Administrator ended",
    };
    const first = Date.UTC(2026, 9, 25, 6, 0);
    return Array.from({ length: 72 }, (_, index) => {
        const kind = kinds[index % kinds.length];
        const time = first + index * 138 * 60_000 + ((index * 7919) % 41) * 60_000;
        const person = ["Adele Vance", "Allan Deyoung", "Grady Archie", "Johanna Lorenz"][index % 4];
        return {
            id: `dense-${index}`,
            time: new Date(time).toISOString(),
            kind,
            environment: index % 5 === 0 ? "group" : "role",
            sentence: kind === "setting" ? verbs[kind] : `${person} ${verbs[kind]}`,
            actor: { name: kind === "system" ? "PIM" : person, id: `dense-actor-${index % 4}`, kind: kind === "system" ? "system" : "person" },
            role: { name: "Helpdesk Administrator", id: "dense-role" },
            scope: "Directory",
            result: index % 11 === 0 ? "failure" : "success",
            source: "graph",
            correlationId: `dense-corr-${index}`,
        } satisfies AuditEvent;
    });
}

/** The roles Privileged only judges the demo log by: the group is eligible for Intune Administrator, Reports Reader is not privileged, and Teams Administrator has no flag, so it is kept and counted */
function buildEventRoles(hasFlag: boolean): RoleDetailData[] {
    const privileged = ["globalAdmin", "privilegedRoleAdmin", "securityAdmin", "exchangeAdmin", "helpdeskAdmin", "intuneAdmin"] as const;
    const definition = (key: keyof typeof AUDIT_DEMO_ROLES, isPrivileged: boolean | undefined): RoleDetailData => ({
        definition: { id: AUDIT_DEMO_ROLES[key], templateId: AUDIT_DEMO_ROLES[key], displayName: key, description: "", isBuiltIn: true, isPrivileged: hasFlag ? isPrivileged : undefined },
        assignments: { permanent: [], active: [], eligible: key === "intuneAdmin" ? [{ principalId: AUDIT_DEMO_GROUP_ID } as RoleDetailData["assignments"]["eligible"][number]] : [] },
    });
    // The log calls an app and an agent the same: these holders tell them apart. The retired bot of the demo log holds nothing
    const holder = (principalId: string, type: string) => ({ principalId, principal: { "@odata.type": `#microsoft.graph.${type}` } }) as unknown as RoleDetailData["assignments"]["active"][number];
    const holders: RoleDetailData = { ...definition("reportsReader", false), assignments: { permanent: [], eligible: [], active: [holder(demoGuid("sp:deploy"), "servicePrincipal"), holder(demoGuid("agent:ops"), "agentIdentity"), holder(AUDIT_DEMO_GROUP_ID, "group")] } };
    return [...privileged.map((key) => definition(key, true)), holders, definition("teamsAdmin", undefined)];
}

const STATUS_OF_STATE: Record<string, AuditStatus> = {
    permission: "permission",
    "role-missing": "role-missing",
    loading: "loading",
    failed: "failed",
    "too-many": "too-many",
};

function AuditFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const state = params.get("state") ?? "default";
    const [openMenu, setOpenMenu] = useState<ShellMenu>(() => {
        const menu = params.get("menu");
        return menu === "top" || menu === "bottom" ? menu : null;
    });
    const workspaceState = WORKSPACE_STATES[state];
    const isWorkspace = workspaceState !== undefined && !workspaceState.fellBack;
    const graphOnlyCount = workspaceState?.summary.graphOnly ?? 0;
    const url = useAuditUrlState(isWorkspace ? WORKSPACE_MAX_DAYS : 30);
    const isIdle = url.state.view === "idle";
    const idleAssignments = useMemo(() => ({
        roles: buildIdleRoles(),
        groups: state === "groups-missing" ? [] : buildIdleGroups(),
        membership: buildIdleMembership(),
        isLoading: false,
        error: null,
        groupsNotIncluded: state === "groups-missing" ? groupsMissingReason() : null,
        onRetry: () => undefined,
    }), [state]);
    const events = useMemo(() => {
        if (isIdle) return buildIdleEvents();
        if (state === "empty") return [];
        const mapped = linkGroupRoles(mapAuditEvents(buildDemoAuditRows(FIXED_NOW)), buildEventRoles(true));
        const demo = isWorkspace ? mapped.map((event, index): AuditEvent => (index < graphOnlyCount ? event : { ...event, source: "workspace", workspace: "law-contoso-entra" })) : mapped;
        return state === "dense" ? [...demo, ...buildDenseEvents()] : demo;
    }, [state, isIdle, isWorkspace, graphOnlyCount]);
    const isDetailed = params.get("details") === "on";
    const rolesState = params.get("roles");
    const privilege = useMemo(() => {
        const roles = isIdle ? buildIdleRoles() : buildEventRoles(rolesState !== "no-flag");
        return {
            lookup: rolesState === "loading" || rolesState === "failed" ? null : buildAuditPrivilege(roles),
            error: rolesState === "failed" ? "Microsoft Graph did not return the roles" : null,
            onRetry: () => undefined,
        };
    }, [isIdle, rolesState]);

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    return (
        <ShellFrame
            currentPath="/audit"
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
            <AuditView
                status={STATUS_OF_STATE[state] ?? "ready"}
                events={events}
                windowStart={isWorkspace ? WORKSPACE_REACH : WINDOW_START}
                maxDays={isWorkspace ? WORKSPACE_MAX_DAYS : 30}
                source={workspaceState ? {
                    kind: isWorkspace ? "workspace" : "graph",
                    label: isWorkspace ? workspaceSourceLabel(workspaceState.summary.read, workspaceState.summary.total) : undefined,
                    notice: workspaceNotice(workspaceState.summary, workspaceState.fellBack),
                    notRead: workspaceNotRead(workspaceState.summary, workspaceState.fellBack) || undefined,
                    coverageNotes: isWorkspace ? workspaceCoverageNotes(workspaceState.summary) : undefined,
                } : undefined}
                readAt={READ_AT}
                loadedCount={state === "loading" ? 2000 : 0}
                requestedDays={30}
                isRequestingPermission={false}
                now={isIdle ? IDLE_NOW : FIXED_NOW}
                emergencyIds={isIdle ? IDLE_EMERGENCY_IDS : EMERGENCY_IDS}
                assignments={isIdle ? idleAssignments : undefined}
                privilege={privilege}
                startFiltersOpen={params.get("filters") === "open"}
                url={url}
                details={{ isDetailed, toggle: <DetailsToggle isChecked={isDetailed} onChange={() => undefined} /> }}
                refresh={<RefreshButtonView isDisabled={false} onRefresh={() => undefined} />}
                onGrant={() => undefined}
                onRetry={() => undefined}
                onLoadDays={() => undefined}
                banner={state === "default" ? { onDismiss: () => undefined } : undefined}
                format={FORMAT}
                exportContext={{ tenant: { id: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", name: "Contoso" }, exporter: "Alex Wilber (alexw@contoso.com)", appVersion: "v3.2.0" }}
                startExportOpen={state === "export"}
            />
        </ShellFrame>
    );
}

/** `surface=azure` shows the Azure Audit page; the choice is made before any hook of the Entra fixture runs */
function AuditSurface() {
    const params = useSearchParams();
    return params.get("surface") === "azure" ? <AzureAuditFixture /> : <AuditFixture />;
}

export default function AuditFixturePage() {
    return (
        <Suspense fallback={null}>
            <AuditSurface />
        </Suspense>
    );
}
