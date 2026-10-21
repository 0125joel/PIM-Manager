"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import type { ReportUrlActions } from "@/hooks/useReportUrlState";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { DashboardFilterKey } from "@/types/dashboardFilter.types";
import type { AuthenticationContext } from "@/types/shared.types";
import { applyReportFilterToGroups, applyReportFilterToRoles, buildFilterNames, buildKindById, buildNameById, countKeysOfView, getMatchingAssignmentIds, getReportFilterLabels, hasPolicyKey, hasReportAssignmentKey, keysOfView, removeFilterKey } from "@/utils/dashboardFilter";
import type { PolicyTabId } from "@/utils/policyView";
import { buildGroupListRow, buildRoleListRow, sortGroups, sortRoles, type ReportSort } from "@/utils/reportList";
import { getRolesHeldByGroups } from "@/utils/groupsOutsidePim";
import type { RowContext } from "@/utils/reportRows";
import { areSettingsPending, describeNoMatch, isPrivilegedStatusMissing, summarizeFailedRoles, summarizeFailureCause } from "@/utils/reportStates";
import { combineMarking, getSearchMarking, searchGroups, searchRoles } from "@/utils/reportSearch";
import { MembershipProvider, type UseMembership } from "./MembershipContext";
import { GroupDetail } from "./groups/GroupDetail";
import type { ConfigureLinkTarget } from "@/utils/configureLinks";
import { GroupList } from "./groups/GroupList";
import { RoleDetail } from "./roles/RoleDetail";
import { RoleList } from "./roles/RoleList";
import { ReportHead } from "./ReportHead";
import { ReportFilterPanel } from "./ReportFilterPanel";
import { ReportLayout } from "./ReportLayout";
import { AllFailedBox, DetailSkeleton, FailedRolesBox, ListSkeleton, NoMatch, PrivilegedStatusWarning } from "./ReportStates";
import { ReportToolbar } from "./ReportToolbar";

export interface ReportBodyProps {
    roles: RoleDetailData[];
    /** Every group: onboarded to PIM and role-assignable groups outside it */
    groups: PimGroupData[];
    emergencyAccountIds: ReadonlySet<string>;
    /** Directory Roles fast phase: definitions and assignments */
    isRolesLoading: boolean;
    isGroupsConsented: boolean;
    isGroupsLoading: boolean;
    /** The settings (policies) of roles or groups are still arriving: the policy filters are off */
    policiesLoading: boolean;
    /** The tenant's custom extensions; null when the list cannot be read (licence or consent) */
    customExtensions: ReadonlyArray<{ id: string; displayName: string }> | null;
    /** Blueprint names by lower-case appId (AG-5); the fixture passes its own */
    blueprintNames?: ReadonlyMap<string, string>;
    authenticationContexts: readonly AuthenticationContext[];
    /** The hook that reads the members and owners of a group (the page passes the real one) */
    useMembership: UseMembership;
    onGrantGroups: () => void;
    /** Graph answered with an error and no roles are loaded: the whole area is replaced by one box (spec 7.7) */
    rolesError: string | null;
    onRetryAll: () => void;
    /** Roles whose settings could not be read, and the retry that asks for those roles only (spec 7.6) */
    failedRoleIds: readonly string[];
    onRetryFailed: () => void;
    /** The retry of the failed roles is running (the spinner in its button) */
    isRetryingFailed?: boolean;
    groupsError: string | null;
    onRetryGroups: () => void;
    syncedText?: string;
    refresh: ReactNode;
    /** The one status sentence under the toolbar (spec 7.2) */
    status?: ReactNode;
    /** Export, with the roles and groups the current filter shows */
    onExport: (scope: { roles: RoleDetailData[]; groups: PimGroupData[]; filterSentence: string; searchTerm: string }) => void;
    url: ReportUrlActions;
    /** "Change in Configure" (spec 16): the link for a role or group the admin may change, else null; the fixture passes none */
    changeHrefFor?: (target: ConfigureLinkTarget) => string | null;
}

/**
 * The Report page without any context: head, toolbar and the master-detail layout, driven by props and the URL state, so
 * the page and the fixture route (`/dev/report`) render the same body. The data container is `app/report/page.tsx`.
 */
export function ReportBody({ roles, groups, emergencyAccountIds, isRolesLoading, isGroupsConsented, isGroupsLoading, policiesLoading, customExtensions, blueprintNames, authenticationContexts, useMembership, onGrantGroups, rolesError, onRetryAll, failedRoleIds, onRetryFailed, isRetryingFailed = false, groupsError, onRetryGroups, syncedText, refresh, status, onExport, url, changeHrefFor }: ReportBodyProps) {
    const { state } = url;
    const view = state.view;
    const [isFiltersOpen, setIsFiltersOpen] = useState(readFiltersOpen);
    const [sort, setSort] = useState<ReportSort>("assignments");
    // The tab of the configuration is kept when another role is selected (spec 3.3)
    const [tab, setTab] = useState<PolicyTabId>("activation");
    // Member or Owner settings of a group, kept when another group is selected (spec 4.2)
    const [relation, setRelation] = useState<"member" | "owner">("member");

    const filterNames = useMemo(() => buildFilterNames(roles), [roles]);
    const options = useMemo(() => ({ emergencyAccountIds }), [emergencyAccountIds]);
    // Role select: every loaded role by name under its template id; extension select: the tenant's list, else what the policies link
    const roleOptions = useMemo(() => [...filterNames.roles].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), [filterNames]);
    const extensionOptions = useMemo(() => {
        const entries = customExtensions ? customExtensions.map((e) => [e.id, e.displayName] as const) : [...filterNames.extensions];
        return entries.map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [customExtensions, filterNames]);

    // Filter first, over every role, so a principal's kind is resolved from all roles as in the row marking; typing then
    // only runs the search over what the filter kept
    const rolesInFilter = useMemo(() => applyReportFilterToRoles(roles, state.filter, options), [roles, state.filter, options]);
    const filteredRoles = useMemo(() => sortRoles(searchRoles(rolesInFilter, state.q).map((hit) => hit.role), sort), [rolesInFilter, state.q, sort]);
    const groupsInFilter = useMemo(() => applyReportFilterToGroups(groups, roles, state.filter, options), [groups, roles, state.filter, options]);
    const filteredGroups = useMemo(() => sortGroups(searchGroups(groupsInFilter, state.q).map((hit) => hit.data), sort), [groupsInFilter, state.q, sort]);

    const isGroupsView = view === "groups";
    const total = isGroupsView ? groups.length : roles.length;
    const shownCount = isGroupsView ? filteredGroups.length : filteredRoles.length;
    const urlSelectedId = isGroupsView ? state.groupId : state.roleId;
    // A shared link to something that is not (or no longer) there never opens an empty panel: it counts as no selection
    const selectedId = urlSelectedId !== undefined && (isGroupsView ? groups.some((g) => g.group.id === urlSelectedId) : roles.some((r) => r.definition.id === urlSelectedId)) ? urlSelectedId : undefined;
    const hasSelection = selectedId !== undefined;
    const firstShownId = isGroupsView ? filteredGroups[0]?.group.id : filteredRoles[0]?.definition.id;
    // The URL selection wins even when the filter hides it; without one the first item of the list is shown (not written to the URL)
    const shownRole = !isGroupsView ? roles.find((r) => r.definition.id === (selectedId ?? firstShownId)) : undefined;
    const shownGroup = isGroupsView ? groups.find((g) => g.group.id === (selectedId ?? firstShownId)) : undefined;
    const shownId = shownRole?.definition.id ?? shownGroup?.group.id;
    const isShownHidden = selectedId !== undefined && !(isGroupsView ? filteredGroups.some((g) => g.group.id === selectedId) : filteredRoles.some((r) => r.definition.id === selectedId));

    const chips = useMemo(() => getReportFilterLabels(state.filter, view, filterNames), [state.filter, view, filterNames]);
    const removeChip = (key: DashboardFilterKey) => url.setFilter(removeFilterKey(state.filter, key));
    const clearAll = () => url.setFilter({});

    const isRolesUnknown = isRolesLoading && roles.length === 0;
    const isGroupsLocked = !isGroupsConsented;
    const groupCount = isGroupsLocked ? undefined : isGroupsLoading && groups.length === 0 ? null : groups.length;

    const roleRows = useMemo(() => filteredRoles.map(buildRoleListRow), [filteredRoles]);
    const nameById = useMemo(() => buildNameById(roles), [roles]);
    const kindById = useMemo(() => buildKindById(roles), [roles]);

    const heldByGroup = useMemo(() => getRolesHeldByGroups(roles, groups.map((g) => g.group.id)), [roles, groups]);
    const groupRows = useMemo(() => filteredGroups.map((g) => buildGroupListRow(g, new Set((heldByGroup.get(g.group.id.toLowerCase()) ?? []).map((h) => h.roleId)).size)), [filteredGroups, heldByGroup]);
    const roleAssignableCount = groups.length === 0 ? null : groups.filter((g) => g.group.isAssignableToRole === true).length;

    // A policy key matches nothing before the settings are in (spec 6.2): an empty list then means "not yet", not "no match"
    const isSettingsPending = areSettingsPending({ view, rolePoliciesLoading: policiesLoading, groupsLoading: isGroupsLoading, roles, groups });
    const isWaitingForSettings = !isGroupsView && isSettingsPending && hasPolicyKey(keysOfView(state.filter, "roles"));
    // Only the keys that narrow this view are named; a key of the other view (with its suffix) is not why nothing matches
    const noMatch = shownCount === 0 && total > 0 && !isWaitingForSettings ? describeNoMatch(view, state.q, chips.filter((c) => !c.suffix).map((c) => c.label)) : null;
    const failedSummary = !isGroupsView ? summarizeFailedRoles(roles, failedRoleIds) : null;
    const isAllFailed = !isGroupsView && rolesError !== null && roles.length === 0;
    const isGroupsFailed = isGroupsView && groupsError !== null && groups.length === 0;
    const isGroupsUnknown = isGroupsView && isGroupsLoading && groups.length === 0 && !isGroupsFailed;

    const list = noMatch ? (
        <NoMatch title={noMatch.title} detail={noMatch.detail} onClear={() => { url.setFilter({}); url.setQuery(""); }} />
    ) : isGroupsUnknown ? (
        <ListSkeleton />
    ) : isGroupsView ? (
        <GroupList rows={groupRows} currentId={shownId} onSelect={url.select} sort={sort} onSortChange={setSort} roleAssignableCount={roleAssignableCount} outsideTotal={groups.filter((g) => g.isManaged === false).length} />
    ) : isRolesUnknown || (isWaitingForSettings && shownCount === 0) ? (
        <ListSkeleton />
    ) : (
        <RoleList rows={roleRows} currentId={shownId} onSelect={url.select} sort={sort} onSortChange={setSort} />
    );

    const rowContext = useMemo<RowContext | null>(() => {
        if (!shownRole) return null;
        const matching = hasReportAssignmentKey(keysOfView(state.filter, "roles")) ? getMatchingAssignmentIds(shownRole, state.filter, { emergencyAccountIds, kindById }) : null;
        // A person search marks that person's rows too (spec 6.3 and 7.6)
        return { groups, emergencyAccountIds, marking: combineMarking(matching, getSearchMarking(searchRoles([shownRole], state.q)[0])), nameById, blueprintNames };
    }, [shownRole, state.filter, state.q, emergencyAccountIds, kindById, groups, nameById, blueprintNames]);

    const groupRowContext = useMemo(() => {
        if (!shownGroup) return null;
        const matching = hasReportAssignmentKey(keysOfView(state.filter, "groups")) ? getMatchingAssignmentIds(shownGroup, state.filter, { emergencyAccountIds }) : null;
        return { emergencyAccountIds, marking: combineMarking(matching, getSearchMarking(searchGroups([shownGroup], state.q)[0])), nameById, blueprintNames };
    }, [shownGroup, state.filter, state.q, emergencyAccountIds, nameById, blueprintNames]);

    const detailBody = shownRole && rowContext ? (
        <RoleDetail
            role={shownRole}
            rowContext={rowContext}
            emergencyAccountIds={emergencyAccountIds}
            authenticationContexts={authenticationContexts}
            customExtensions={customExtensions}
            isPoliciesLoading={policiesLoading}
            tab={tab}
            onTabChange={setTab}
            isHiddenByFilter={isShownHidden}
            getShareUrl={() => url.getShareUrl(shownId)}
            changeHref={changeHrefFor?.({ kind: "role", id: shownRole.definition.id, tab }) ?? null}
        />
    ) : shownGroup ? (
        <GroupDetail
            key={shownGroup.group.id}
            data={shownGroup}
            held={heldByGroup.get(shownGroup.group.id.toLowerCase()) ?? []}
            rowContext={groupRowContext as NonNullable<typeof groupRowContext>}
            authenticationContexts={authenticationContexts}
            customExtensions={customExtensions}
            relation={relation}
            onRelationChange={setRelation}
            tab={tab}
            onTabChange={setTab}
            isHiddenByFilter={isShownHidden}
            getShareUrl={() => url.getShareUrl(shownId)}
            onOpenRole={url.openRole}
            changeHref={changeHrefFor?.({ kind: "group", id: shownGroup.group.id, access: shownGroup.isManaged === false ? undefined : relation, tab: shownGroup.isManaged === false ? "who" : tab }) ?? null}
        />
    ) : isRolesUnknown || isGroupsUnknown || isWaitingForSettings ? (
        <DetailSkeleton />
    ) : (
        <div className="rounded border border-line bg-surface p-6 text-sm text-muted">{shownCount === 0 ? "Nothing to show." : "Select an item."}</div>
    );

    return (
        <div data-focus-fallback tabIndex={-1} className="mx-auto flex max-w-[1376px] flex-col gap-4 outline-none">
            <ReportHead syncedText={syncedText} refresh={refresh} isExportDisabled={roles.length === 0} onExport={() => onExport({ roles: filteredRoles, groups: filteredGroups, filterSentence: chips.map((c) => c.label).join(", "), searchTerm: state.q.trim() })} />
            <ReportToolbar
                view={view}
                onViewChange={url.setView}
                roleCount={isRolesUnknown ? null : roles.length}
                groupCount={groupCount}
                isGroupsLocked={isGroupsLocked}
                query={state.q}
                onQueryChange={url.setQuery}
                filterCount={countKeysOfView(state.filter, view)}
                isFiltersOpen={isFiltersOpen}
                onFiltersToggle={() => {
                    writeFiltersOpen(!isFiltersOpen);
                    setIsFiltersOpen(!isFiltersOpen);
                }}
                panel={<ReportFilterPanel view={view} filter={state.filter} onChange={url.setFilter} roleOptions={roleOptions} extensionOptions={extensionOptions} chips={chips} policiesLoading={isSettingsPending} />}
                chips={chips}
                onRemoveChip={removeChip}
                onClearAll={clearAll}
                resultText={total > 0 ? `${shownCount} of ${total} ${isGroupsView ? "groups" : "roles"}` : null}
            />
            {status}
            {!isGroupsView && !isRolesUnknown && isPrivilegedStatusMissing(roles) && <PrivilegedStatusWarning />}
            {failedSummary && <FailedRolesBox summary={failedSummary} onRetry={onRetryFailed} isRetrying={isRetryingFailed} />}
            {isAllFailed ? (
                <AllFailedBox cause={summarizeFailureCause([rolesError])} onRetry={onRetryAll} />
            ) : isGroupsFailed ? (
                <AllFailedBox what="groups" cause={summarizeFailureCause([groupsError])} onRetry={onRetryGroups} />
            ) : isGroupsView && isGroupsLocked ? (
                <StatusBox variant="consent" title="PIM for Groups is not granted yet" action={<Button variant="primary" onClick={onGrantGroups}>Grant read access</Button>}>
                    Groups under PIM and role-assignable groups outside it need read access to PIM for Groups. The Roles view works without it.
                </StatusBox>
            ) : (
                <MembershipProvider useMembership={useMembership}>
                    <ReportLayout list={list} detail={detailBody} hasSelection={hasSelection} backLabel={isGroupsView ? "All groups" : "All roles"} onBack={url.clearSelection} />
                </MembershipProvider>
            )}
        </div>
    );
}

const FILTERS_OPEN_KEY = "report-filters-open";

/** The panel is closed by default; open or closed is remembered per viewer (a convenience, so storage may be missing) */
function readFiltersOpen(): boolean {
    try {
        return window.localStorage.getItem(FILTERS_OPEN_KEY) === "true";
    } catch {
        return false;
    }
}

function writeFiltersOpen(isOpen: boolean): void {
    try {
        window.localStorage.setItem(FILTERS_OPEN_KEY, String(isOpen));
    } catch {
        // storage blocked: the panel just starts closed next time
    }
}
