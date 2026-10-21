"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import type { GroupMembershipState } from "@/hooks/useGroupMembership";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { ReportBody } from "@/app/report/components/ReportBody";
import { changeInConfigureHref } from "@/utils/configureLinks";
import { buildFixtureAccess } from "@/__tests__/fixtures/configureFixture";
import { ReportExportDialog } from "@/app/report/components/ReportExportDialog";
import type { ExportData } from "@/utils/reportExportPlan";
import { useReportUrlState } from "@/hooks/useReportUrlState";
import { LoadingSentence } from "@/components/LoadingStatus";
import { buildLoadingSentence } from "@/utils/loadingStatus";
import { REPORT_AUTH_CONTEXTS, buildReportMembership, REPORT_EMERGENCY_IDS, REPORT_EXTENSIONS, FIXTURE_BLUEPRINT_NAMES, buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";

/**
 * The Report with the Contoso fixture of the design boards and no sign-in. The `.fixture.tsx` extension keeps it out of a
 * normal build: `next.config.ts` adds the extension only with NEXT_PUBLIC_FIXTURES=1 (`npm run visual` builds it that way).
 * The page state is the real URL state: `view`, `q`, `f`, `role`, `group`. Extra query parameters: `state` =
 * default | loading | noGroups (PIM for Groups not granted), `emergency=0` for no marked accounts, `menu` = top | bottom (the
 * account menu open).
 */
/** The membership read of the fixture: the Contoso members after a short wait; `?state=membersError` fails it, `?state=membersLoading` never finishes */
function useFixtureMembership(groupId: string | undefined): GroupMembershipState {
    const params = useSearchParams();
    const mode = params.get("state");
    const [done, setDone] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (!groupId || mode === "membersLoading") return;
        const timer = setTimeout(() => setDone(`${groupId}:${attempt}`), 400);
        return () => clearTimeout(timer);
    }, [groupId, mode, attempt]);
    if (!groupId) return { status: "idle", members: [], owners: [], retry: () => undefined };
    if (done !== `${groupId}:${attempt}`) return { status: "loading", members: [], owners: [], retry: () => undefined };
    if (mode === "membersError") return { status: "error", members: [], owners: [], error: "Microsoft Graph did not allow reading the members and owners of this group (403). The signed-in account needs permission to read group members.", retry: () => setAttempt((n) => n + 1) };
    const membership = buildReportMembership(groupId);
    return { status: "ready", members: membership.members, owners: membership.owners, retry: () => undefined };
}

const CHANGE_ACCESS = buildFixtureAccess("pra", { groups: buildReportGroups().map((g) => ({ id: g.group.id, displayName: g.group.displayName, isAssignableToRole: g.group.isAssignableToRole ?? null, isUnderPim: g.isManaged !== false })), ownedGroup: { id: "g-helpdesk1", displayName: "Helpdesk Tier 1" } });

function ReportFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const state = params.get("state") ?? "default";
    // `?menu=top` opens the account menu of the top bar, `?menu=bottom` the account sheet of the bottom navigation
    const [openMenu, setOpenMenu] = useState<ShellMenu>(() => {
        const menu = params.get("menu");
        return menu === "top" || menu === "bottom" ? menu : null;
    });
    const url = useReportUrlState();
    // `?export=1` opens the export dialog on load; the filter of the render ("Privileged only, Has assignments: 7 of 146 roles")
    const [exportScope, setExportScope] = useState<{ roles: ReturnType<typeof buildReportRoles>; groups: ReturnType<typeof buildReportGroups>; filterSentence: string; searchTerm: string } | null>(() =>
        params.get("export") !== null ? { roles: buildReportRoles().slice(0, 7), groups: buildReportGroups().slice(0, 2), filterSentence: "Privileged only, Has assignments", searchTerm: "" } : null);

    // `?roles=forbidden`: Graph answered 403 on every role policy (FIX-12): the lists and the role detail say so, no retry banner
    const rolesSwitch = params.get("roles");
    const roles = useMemo(() => {
        if (state === "loading" || state === "allFailed") return [];
        const all = buildReportRoles();
        if (rolesSwitch === "forbidden") return all.map((r) => ({ ...r, policy: null, configError: undefined, policiesForbidden: true }));
        // policies: the fast phase is done, no settings yet; privWarn: Graph did not report isPrivileged for one role
        if (state === "policies") return all.map((r) => ({ ...r, policy: null }));
        if (state === "privWarn") return all.map((r, i) => (i === 3 ? { ...r, definition: { ...r.definition, isPrivileged: undefined } } : r));
        return all;
    }, [state, rolesSwitch]);
    // `?groups=forbidden`: Graph answered 403 on the policy of Finance Approvers (FIX-11), group detail and the lists say so
    const groupsSwitch = params.get("groups");
    const groups = useMemo(() => {
        if (state === "loading" || state === "noGroups" || state === "groupsFailed") return [];
        const all = buildReportGroups();
        const shown = state === "allClear" ? all.filter((g) => g.isManaged !== false) : all;
        if (groupsSwitch !== "forbidden") return shown;
        return shown.map((g) => (g.group.id === "g-finance" ? { ...g, policies: undefined, settings: undefined, policiesForbidden: true } : g));
    }, [state, groupsSwitch]);
    const emergency = useMemo(() => new Set<string>(params.get("emergency") === "0" ? [] : REPORT_EMERGENCY_IDS), [params]);

    if (!FIXTURES_ENABLED) {
        notFound();
    }

    const exportData: ExportData | null = exportScope
        ? {
            allRoles: roles,
            allGroups: groups,
            filteredRoles: exportScope.roles,
            filteredGroups: exportScope.groups,
            canExportGroups: groups.length > 0,
            filterSentence: exportScope.filterSentence,
            searchTerm: exportScope.searchTerm,
            lists: { authenticationContexts: REPORT_AUTH_CONTEXTS, customExtensions: REPORT_EXTENSIONS },
            authenticationContexts: REPORT_AUTH_CONTEXTS,
            emergencyIds: emergency,
            meta: { tenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63", tenantName: "Contoso", exporter: "Alex Wilber (alexw@contoso.com)", appVersion: "3.2.0", readAt: { directoryRoles: "2026-10-02T11:00:00Z", pimGroups: "2026-10-02T11:00:00Z" }, exportedAt: new Date("2026-10-02T12:00:00Z") },
        }
        : null;

    return (
        <ShellFrame
            currentPath="/report"
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
            <ReportBody
                // `change=1`: the admin of the Configure fixture (Privileged Role Administrator) sees "Change in Configure" (NG-74); the other states pass none
                changeHrefFor={params.get("change") === "1" ? (target) => changeInConfigureHref(CHANGE_ACCESS, target) : undefined}
                roles={roles}
                groups={groups}
                blueprintNames={FIXTURE_BLUEPRINT_NAMES}
                emergencyAccountIds={emergency}
                isRolesLoading={state === "loading"}
                isGroupsConsented={state !== "noGroups"}
                isGroupsLoading={state === "loading"}
                policiesLoading={state === "policies"}
                customExtensions={REPORT_EXTENSIONS}
                authenticationContexts={REPORT_AUTH_CONTEXTS}
                useMembership={useFixtureMembership}
                onGrantGroups={() => undefined}
                rolesError={state === "allFailed" ? "Request failed with status 503" : null}
                onRetryAll={() => undefined}
                failedRoleIds={state === "failed" ? ["role-failed", "role-nobody"] : []}
                onRetryFailed={() => undefined}
                groupsError={state === "groupsFailed" ? "Request failed with status 403" : null}
                onRetryGroups={() => undefined}
                syncedText="Synced 3 min ago."
                status={state === "policies" ? <LoadingSentence sentence={buildLoadingSentence({ rolesLoading: false, rolesProgress: 100, policiesLoading: true, policyProgress: { current: 61, total: 146 }, groupsLoading: false, groupsProgress: null }, "settings") ?? ""} /> : undefined}
                refresh={<RefreshButtonView isDisabled={false} onRefresh={() => undefined} />}
                onExport={(scope) => setExportScope({ ...scope })}
                url={url}
            />
            <ReportExportDialog isOpen={exportScope !== null} onClose={() => setExportScope(null)} data={exportData} />
        </ShellFrame>
    );
}

export default function ReportFixturePage() {
    return (
        <Suspense fallback={null}>
            <ReportFixture />
        </Suspense>
    );
}
