import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { applyDashboardFilterToGroups, applyDashboardFilterToRoles, filterAppliesToGroups, hasPolicyKey, isEmptyDashboardFilter, narrowAssignmentsToFilter } from "@/utils/dashboardFilter";
import { buildFilterSentence, type DashboardStatsInput } from "@/utils/dashboardStats";

export interface CountingState {
    directoryRoles: boolean;
    pimGroups: boolean;
    unmanagedGroups: boolean;
    /** The chip Agents: false leaves every agent assignment out of every number (the page removes them before the view is built) */
    agents: boolean;
}

export interface StatsViewParams {
    rolesData: RoleDetailData[];
    /** Onboarded and unmanaged groups */
    groupsData: PimGroupData[];
    counting: CountingState;
    /** The effective filter (`getEffectiveDashboardFilter`) */
    effective: DashboardFilter;
    policiesLoading: boolean;
    emergencyAccountIds: ReadonlySet<string>;
    scope: "privileged" | "all";
    /** Advanced: the Privileged roles scope narrows every role number, not only the privileged ones (groups are not roles and stay) */
    narrowToScope?: boolean;
    isGroupsUnavailable?: boolean;
}

export interface StatsView {
    /** Cards, Who and Terms: assignments narrowed to the filter */
    input: DashboardStatsInput;
    /** Easy to miss: whole roles that match */
    roleLevelInput: DashboardStatsInput;
    roles: RoleDetailData[];
    groups: PimGroupData[];
    /** Roles the page counts before the filter: every role, or the privileged ones when Advanced narrows to that scope */
    scopeRoleCount: number;
    /** The privileged scope narrows the roles (Advanced with Privileged roles and `isPrivileged` reported) */
    isScoped: boolean;
    managedCount: number;
    isFiltered: boolean;
    appliesToGroups: boolean;
    /** Groups a policy filter cannot judge: Graph answered 403 on their policy (FIX-11). Zero without a policy filter that applies to groups. */
    notReadableGroupCount: number;
    /** Roles in scope a policy filter cannot judge: Graph answered 403 on their policy (FIX-12). Zero without a policy filter. */
    notReadableRoleCount: number;
}

/**
 * The sentence of the filter bar (spec 4.6), "7 of 33 privileged roles." plus what is not affected. The total is what the
 * page counts before the filter: in Advanced with Privileged roles that is the privileged roles, never every role.
 */
export function buildViewFilterSentence(view: StatsView, rolesData: RoleDetailData[], effective: DashboardFilter, isGroupsCounted: boolean, isAdvanced: boolean): string {
    if (!view.isFiltered) return "";
    const sentence = buildFilterSentenceForView(view, rolesData, effective, isGroupsCounted, isAdvanced);
    const roles = view.notReadableRoleCount;
    const groups = view.notReadableGroupCount;
    if (roles + groups === 0) return sentence;
    const parts = [roles > 0 && `${roles} ${roles === 1 ? "role" : "roles"}`, groups > 0 && `${groups} ${groups === 1 ? "group" : "groups"}`].filter(Boolean).join(" and ");
    return `${sentence} ${parts} with settings not readable with your access ${roles + groups === 1 ? "is" : "are"} not counted.`;
}

function buildFilterSentenceForView(view: StatsView, rolesData: RoleDetailData[], effective: DashboardFilter, isGroupsCounted: boolean, isAdvanced: boolean): string {
    if (effective.privileged === true) {
        return buildFilterSentence(view.roles.length, rolesData.filter((r) => r.definition.isPrivileged === true).length, "privileged roles", view.appliesToGroups, isAdvanced);
    }
    const roleLabel = view.isScoped ? "privileged roles" : "roles";
    if (view.appliesToGroups && isGroupsCounted) {
        return buildFilterSentence(view.roles.length + view.groups.length, view.scopeRoleCount + view.managedCount, view.isScoped ? "privileged roles and groups" : "roles and groups", true, isAdvanced);
    }
    return buildFilterSentence(view.roles.length, view.scopeRoleCount, roleLabel, view.appliesToGroups, isAdvanced);
}

/** The roles, groups and stats input behind the dashboard blocks; the PDF export builds the very same view. */
export function buildStatsView({ rolesData, groupsData, counting, effective, policiesLoading, emergencyAccountIds, scope, narrowToScope = false, isGroupsUnavailable = false }: StatsViewParams): StatsView {
    const isFiltered = !isEmptyDashboardFilter(effective);
    const appliesToGroups = !isFiltered || filterAppliesToGroups(effective);
    const managed = groupsData.filter((g) => g.isManaged !== false);
    // Without `isPrivileged` from Graph the privileged scope has nothing to keep: leave the roles whole and let the sections say so
    const isScoping = narrowToScope && scope === "privileged" && rolesData.some((r) => r.definition.isPrivileged !== undefined);
    const inScope = isScoping ? rolesData.filter((r) => r.definition.isPrivileged === true) : rolesData;
    const roles = counting.directoryRoles ? applyDashboardFilterToRoles(inScope, effective, { emergencyAccountIds }) : [];
    const groups = counting.pimGroups ? applyDashboardFilterToGroups(managed, effective, { emergencyAccountIds }) : [];
    // A policy filter cannot read a role or group whose policy is not readable: it is left out and the sentence says so.
    // Counted with the other keys of the filter, so "privileged and MFA" counts only the privileged ones (FIX-11, FIX-12)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the policy keys are taken out, the rest of the filter stays
    const { approval, justification, mfa, maxDuration, activationNotification, customExtension, ...withoutPolicyKeys } = effective;
    const policyFiltered = hasPolicyKey(effective);
    // Today no policy key applies to groups (the filter is then roles only and shows no group at all), so this stays 0
    // until one does: a group left out by a roles-only filter is not left out because of its access
    const notReadableGroupCount = counting.pimGroups && policyFiltered && appliesToGroups
        ? applyDashboardFilterToGroups(managed.filter((g) => g.policiesForbidden), withoutPolicyKeys, { emergencyAccountIds }).length : 0;
    const notReadableRoleCount = counting.directoryRoles && policyFiltered
        ? applyDashboardFilterToRoles(inScope.filter((r) => r.policiesForbidden), withoutPolicyKeys, { emergencyAccountIds }).length : 0;
    // Cards, Who and Terms count only the assignments the filter is about; Easy to miss reads whole roles
    const narrowed = narrowAssignmentsToFilter(roles, groups, effective, { emergencyAccountIds });
    const input: DashboardStatsInput = {
        roles: narrowed.roles,
        groups: narrowed.groups,
        allRoles: rolesData,
        allGroups: counting.pimGroups && counting.unmanagedGroups ? groupsData : [],
        isDirectoryRolesCounted: counting.directoryRoles,
        isGroupsCounted: counting.pimGroups,
        isGroupsUnavailable,
        isUnmanagedCounted: counting.unmanagedGroups,
        isAgentsCounted: counting.agents,
        isFiltered,
        filterAppliesToGroups: appliesToGroups,
        policiesLoading,
        emergencyAccountIds,
        scope,
    };
    return { input, roleLevelInput: { ...input, roles, groups }, roles, groups, scopeRoleCount: inScope.length, isScoped: isScoping, managedCount: managed.length, isFiltered, appliesToGroups, notReadableGroupCount, notReadableRoleCount };
}
