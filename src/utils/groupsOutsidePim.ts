import type { RoleDetailData, ScopeInfo } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { hasNoEnd, isPermanentActive } from "@/utils/assignmentKinds";

/** One role a group holds (Report spec 5.4): one entry per eligible or active schedule whose principal is the group. */
export interface RoleHeldByGroup {
    roleId: string;
    roleName: string;
    isPrivileged: boolean;
    /** `permanent` is an entry of the legacy role assignment list; the Report shows eligible and active only */
    kind: "eligible" | "active" | "permanent";
    /** Resolved end of the schedule; undefined for no end date */
    endDateTime?: string;
    hasNoEnd: boolean;
    /** Active and assigned by an administrator without an end (a legacy permanent entry is permanent too) */
    isPermanent: boolean;
    scope?: ScopeInfo;
    /** Id of the schedule, to key a row and to find it again */
    scheduleId: string;
}

const KIND_ORDER = { eligible: 0, active: 1, permanent: 2 } as const;

/**
 * Every role each of the given groups holds, in one pass over the roles: each schedule whose principal is one of the groups.
 * Keys are lower-case group ids; a group that holds nothing has no entry. Lists are sorted by role name, eligible before active.
 * Use this for many groups; `getRolesHeldByGroup` is the single group form.
 */
export function getRolesHeldByGroups(roles: RoleDetailData[], groupIds: Iterable<string>): Map<string, RoleHeldByGroup[]> {
    const wanted = new Set<string>();
    for (const id of groupIds) wanted.add(id.toLowerCase());
    const held = new Map<string, RoleHeldByGroup[]>();
    if (wanted.size === 0) return held;

    const add = (principalId: string | undefined, entry: RoleHeldByGroup) => {
        const id = principalId?.toLowerCase();
        if (!id || !wanted.has(id)) return;
        const list = held.get(id);
        if (list) list.push(entry);
        else held.set(id, [entry]);
    };

    for (const role of roles) {
        const base = { roleId: role.definition.id, roleName: role.definition.displayName, isPrivileged: role.definition.isPrivileged === true };
        for (const item of role.assignments.eligible) {
            add(item.principalId, { ...base, kind: "eligible", endDateTime: item.scheduleInfo?.expiration?.endDateTime, hasNoEnd: hasNoEnd(item), isPermanent: false, scope: item.scopeInfo, scheduleId: item.id });
        }
        for (const item of role.assignments.active) {
            add(item.principalId, { ...base, kind: "active", endDateTime: item.scheduleInfo?.expiration?.endDateTime, hasNoEnd: hasNoEnd(item), isPermanent: isPermanentActive(item), scope: item.scopeInfo, scheduleId: item.id });
        }
        for (const item of role.assignments.permanent) {
            add(item.principalId, { ...base, kind: "permanent", hasNoEnd: true, isPermanent: true, scheduleId: item.id });
        }
    }
    for (const list of held.values()) list.sort((a, b) => a.roleName.localeCompare(b.roleName) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    return held;
}

/** The roles of one group (Report spec 5.4); see `getRolesHeldByGroups` for many. */
export function getRolesHeldByGroup(roles: RoleDetailData[], groupId: string): RoleHeldByGroup[] {
    return getRolesHeldByGroups(roles, [groupId]).get(groupId.toLowerCase()) ?? [];
}

/** A role-assignable group that PIM does not manage (spec 4.2 item 3). */
export interface GroupOutsidePim {
    id: string;
    name: string;
    /** Names of the roles the group holds, sorted; empty when it holds none */
    holds: string[];
    /** Direct members; undefined when the count is not read (yet or it failed) */
    memberCount?: number;
}

/**
 * Role-assignable groups outside PIM with the roles each one holds. A group holds a role when it is the principal of
 * any schedule of that role (eligible or active). Groups that hold a role come first (those are the ones that matter),
 * then by name.
 */
export function getGroupsOutsidePim(groups: PimGroupData[], roles: RoleDetailData[]): GroupOutsidePim[] {
    const outside = groups.filter((g) => g.isManaged === false && g.group.isAssignableToRole === true);
    if (outside.length === 0) return [];

    const heldByGroup = getRolesHeldByGroups(roles, outside.map((g) => g.group.id));
    return outside
        .map((g) => ({
            id: g.group.id,
            name: g.group.displayName,
            holds: [...new Set((heldByGroup.get(g.group.id.toLowerCase()) ?? []).map((held) => held.roleName))].sort((a, b) => a.localeCompare(b)),
            memberCount: g.memberCount,
        }))
        .sort((a, b) => (b.holds.length > 0 ? 1 : 0) - (a.holds.length > 0 ? 1 : 0) || a.name.localeCompare(b.name));
}

/** The Microsoft Entra admin center page of a group; "Bring under PIM" links here until Configure can onboard a group. */
export function getEntraGroupUrl(groupId: string): string {
    return `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Overview/groupId/${encodeURIComponent(groupId)}`;
}
