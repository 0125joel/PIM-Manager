"use client";

import { useMemo } from "react";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { useNow } from "@/hooks/useNow";
import { isPrivilegedReported } from "@/utils/dashboardStats";
import { computeActivationCharts, computeApprovers, computeCustomExtensionRows, computeGroupsSection, computeHasAccess, computeRightNow, getFilterOwnerSection, isInScope, computeTopAccounts, type DashboardScope } from "@/utils/dashboardAdvanced";
import type { CountingState } from "../basic/DashboardOverview";
import { AccountsSection } from "./AccountsSection";
import { ActivationSection } from "./ActivationSection";
import { HasAccessSection } from "./HasAccessSection";
import { PimGroupsSection, type GroupsSectionState } from "./PimGroupsSection";
import { RightNowSection } from "./RightNowSection";

export interface AdvancedSectionsProps {
    rolesData: RoleDetailData[];
    groupsData: PimGroupData[];
    counting: CountingState;
    scope: DashboardScope;
    emergencyAccountIds: ReadonlySet<string>;
    /** Ids of the tenant's custom extensions; null when the list cannot be read */
    tenantExtensionIds: ReadonlySet<string> | null;
    filter: DashboardFilter;
    /** A filter is active: the sections use the whole tenant and are dimmed (spec 4.6) */
    isFiltered: boolean;
    onSetFilter: (filter: DashboardFilter) => void;
    isRolesLoading: boolean;
    isGroupsLoading: boolean;
    policiesLoading: boolean;
    rolesError?: string | null;
    pimGroupsConsented: boolean;
    pimGroupsError?: string | null;
    onGrantPimGroups: () => void;
    onRetryPimGroups: () => void;
}

/** The five sections of the Advanced dashboard (spec 4.3). Whole tenant data; the filter dims them instead of narrowing them. */
export function AdvancedSections(props: AdvancedSectionsProps) {
    const { rolesData, groupsData, counting, scope, emergencyAccountIds, tenantExtensionIds, filter, isFiltered, onSetFilter, isRolesLoading, isGroupsLoading, policiesLoading, rolesError, pimGroupsConsented, pimGroupsError, onGrantPimGroups, onRetryPimGroups } = props;
    const now = useNow();

    const rolesFailed = counting.directoryRoles && !!rolesError && rolesData.length === 0;
    const rolesLoading = counting.directoryRoles && isRolesLoading && rolesData.length === 0;
    const roles = useMemo(() => (counting.directoryRoles ? rolesData : []), [counting.directoryRoles, rolesData]);
    const managed = useMemo(() => (counting.pimGroups ? groupsData.filter((g) => g.isManaged !== false) : []), [counting.pimGroups, groupsData]);
    const allGroups = useMemo(() => (counting.pimGroups ? (counting.unmanagedGroups ? groupsData : groupsData.filter((g) => g.isManaged !== false)) : []), [counting.pimGroups, counting.unmanagedGroups, groupsData]);

    const rolesNotice = !counting.directoryRoles ? "Directory roles are not counted. Switch the chip on to see this." : rolesFailed ? "Not available until the Directory roles load." : undefined;
    const isUnknown = rolesLoading;
    // Without `isPrivileged` from Graph the privileged scope has nothing to show: say so instead of zeros
    const isPrivilegedUnreported = scope === "privileged" && rolesData.length > 0 && !isPrivilegedReported(rolesData);
    const scopedNotice = rolesNotice ?? (isPrivilegedUnreported ? "Graph does not report which roles are privileged. Switch to All roles to see this." : undefined);

    // The scope decides which roles every section counts; groups are not roles and stay whole
    const scoped = useMemo(() => (isPrivilegedUnreported ? roles : roles.filter((r) => isInScope(r, scope))), [isPrivilegedUnreported, roles, scope]);
    const access = useMemo(() => (isUnknown ? null : computeHasAccess(scoped, managed)), [isUnknown, scoped, managed]);
    const charts = useMemo(() => (isUnknown ? null : computeActivationCharts(roles, scope)), [isUnknown, roles, scope]);
    const extensions = useMemo(() => computeCustomExtensionRows(roles.filter((r) => scope === "all" || r.definition.isPrivileged === true), tenantExtensionIds), [roles, scope, tenantExtensionIds]);
    const groupsSection = useMemo(() => computeGroupsSection(allGroups), [allGroups]);
    const accounts = useMemo(() => (isUnknown ? null : computeTopAccounts(roles, scope, emergencyAccountIds)), [isUnknown, roles, scope, emergencyAccountIds]);
    const approvers = useMemo(() => (isUnknown ? null : computeApprovers(roles, scope)), [isUnknown, roles, scope]);
    const rightNow = useMemo(() => (isUnknown ? null : computeRightNow(scoped, managed, now)), [isUnknown, scoped, managed, now]);

    const policiesPending = policiesLoading && charts !== null && charts.unloaded > 0;
    // The section a filter was set from stays readable; the others are dimmed
    const owner = isFiltered ? getFilterOwnerSection(filter) : null;
    const dimmed = (section: "access" | "activation" | "other") => isFiltered && owner !== section;

    let groupsState: GroupsSectionState = "ready";
    if (!pimGroupsConsented) groupsState = "noConsent";
    else if (pimGroupsError) groupsState = "error";
    else if (!counting.pimGroups) groupsState = "notCounted";
    else if (isGroupsLoading && groupsData.length === 0) groupsState = "loading";
    const groupsNote = groupsState === "ready" ? undefined : "PIM for Groups is not included: it is not counted, not granted or not loaded.";

    return (
        <div className="mt-4 flex flex-col gap-4">
            <HasAccessSection access={access} notice={rolesNotice} groupsNote={groupsNote} isDimmed={dimmed("access")} filter={filter} onSetFilter={onSetFilter} />
            <ActivationSection charts={charts} scope={scope} isPending={policiesPending || isUnknown} notice={scopedNotice} isPolicyLoading={policiesLoading} extensions={extensions} filter={filter} onSetFilter={onSetFilter} isDimmed={dimmed("activation")} />
            <PimGroupsSection state={groupsState} section={groupsSection} errorMessage={pimGroupsError} onGrant={onGrantPimGroups} onRetry={onRetryPimGroups} isDimmed={isFiltered} />
            <AccountsSection accounts={accounts} approvers={approvers} scope={scope} isPending={policiesPending || isUnknown} notice={scopedNotice} isDimmed={isFiltered} />
            <RightNowSection data={rightNow} groupsNote={groupsNote} emergencyAccountIds={emergencyAccountIds} isDimmed={isFiltered} />
        </div>
    );
}
