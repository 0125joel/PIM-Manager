import type { RoleDetailData } from "@/types/directoryRole.types";
import { getUnscheduledRoleAssignments } from "@/utils/assignmentKinds";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { GroupMembershipPrincipal } from "@/types/groupMembership.types";

/**
 * Report search (spec 5.5): one box for a role, a group or a person. Case-insensitive; every word of the term must be in
 * the same text (the name of the role or group, or one principal's display name or UPN). A match on a person keeps the
 * role in the list and names the matching assignments, so the detail can mark their rows (spec 6.3 and 7.6).
 */

export interface RoleSearchHit {
    role: RoleDetailData;
    /** The role's own name matched */
    isNameMatch: boolean;
    /** Ids of the eligible and active schedules whose principal matched, for row marking */
    assignmentIds: Set<string>;
}

export interface GroupSearchHit {
    data: PimGroupData;
    isNameMatch: boolean;
    /** Ids of the group assignments that matched */
    assignmentIds: Set<string>;
    /** Ids (lowercase) of members and owners read on demand that matched */
    memberIds: Set<string>;
}

export function parseSearchTerm(raw: string | null | undefined): string[] {
    return (raw ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(words: readonly string[], ...texts: Array<string | null | undefined>): boolean {
    const haystack = texts.filter(Boolean).join(" ").toLowerCase();
    return words.every((word) => haystack.includes(word));
}

export function searchRoles(roles: RoleDetailData[], raw: string | null | undefined): RoleSearchHit[] {
    const words = parseSearchTerm(raw);
    if (words.length === 0) return roles.map((role) => ({ role, isNameMatch: false, assignmentIds: new Set<string>() }));

    const hits: RoleSearchHit[] = [];
    for (const role of roles) {
        const isNameMatch = matches(words, role.definition.displayName);
        const assignmentIds = new Set<string>();
        for (const item of [...role.assignments.eligible, ...role.assignments.active, ...getUnscheduledRoleAssignments(role.assignments)]) {
            if (matches(words, item.principal?.displayName, item.principal?.userPrincipalName)) assignmentIds.add(item.id);
        }
        if (isNameMatch || assignmentIds.size > 0) hits.push({ role, isNameMatch, assignmentIds });
    }
    return hits;
}

/**
 * The rows a person search marks in the detail (spec 6.3 and 7.6): the matching assignments when the item is in the list
 * because of a person, null when nothing is searched or the item's own name matched (then every row is relevant).
 */
export function getSearchMarking(hit: Pick<RoleSearchHit, "isNameMatch" | "assignmentIds"> | undefined): ReadonlySet<string> | null {
    if (!hit || hit.isNameMatch || hit.assignmentIds.size === 0) return null;
    return hit.assignmentIds;
}

/** Filter marks and search marks together: a row is marked when it satisfies both; null when neither marks anything. */
export function combineMarking(a: ReadonlySet<string> | null, b: ReadonlySet<string> | null): ReadonlySet<string> | null {
    if (a === null) return b;
    if (b === null) return a;
    return new Set([...a].filter((id) => b.has(id)));
}

/**
 * `membersByGroup` holds the members and owners read so far (group id to principals); groups outside PIM have no
 * assignments, so a person is only found in a group once its members have been read.
 */
export function searchGroups(
    groups: PimGroupData[],
    raw: string | null | undefined,
    membersByGroup?: ReadonlyMap<string, readonly GroupMembershipPrincipal[]>
): GroupSearchHit[] {
    const words = parseSearchTerm(raw);
    if (words.length === 0) return groups.map((data) => ({ data, isNameMatch: false, assignmentIds: new Set<string>(), memberIds: new Set<string>() }));

    const hits: GroupSearchHit[] = [];
    for (const data of groups) {
        const isNameMatch = matches(words, data.group.displayName);
        const assignmentIds = new Set<string>();
        for (const a of data.assignments) {
            if (matches(words, a.principal?.displayName, a.principal?.userPrincipalName)) assignmentIds.add(a.id);
        }
        const memberIds = new Set<string>();
        for (const principal of membersByGroup?.get(data.group.id) ?? []) {
            if (matches(words, principal.displayName, principal.userPrincipalName)) memberIds.add(principal.id.toLowerCase());
        }
        if (isNameMatch || assignmentIds.size > 0 || memberIds.size > 0) hits.push({ data, isNameMatch, assignmentIds, memberIds });
    }
    return hits;
}
