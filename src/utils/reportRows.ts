import type { PimAssignmentSchedule, PimEligibilitySchedule, RoleAssignment, RoleDetailData, ScopeInfo } from "@/types/directoryRole.types";
import type { GroupPimAssignment, PimGroupData } from "@/types/pimGroup.types";
import type { GroupMembership } from "@/types/groupMembership.types";
import { getScopeDisplayName } from "@/utils/scopeUtils";
import type { ReportTermKey } from "@/config/help/reportTerms";
import { getUnscheduledRoleAssignments, hasNoEnd, isActivated, isAssignedActive } from "@/utils/assignmentKinds";
import { AGENT_ORIGIN_NAMES, getAgentOrigin, getPrincipalKind, type PrincipalKind } from "@/utils/principalUtils";
import { isGuestUserType } from "@/utils/userTypeUtils";
import { getRolesHeldByGroups, type RoleHeldByGroup } from "@/utils/groupsOutsidePim";
import { resolveActivationGroup } from "@/utils/viaGroup";

/**
 * The rows of the Report detail as plain data (spec 3.2 and 4): who holds a role or a group, how, until when. Pure and tested; the
 * components only draw them. A group that holds a role is one row (kind group, How Direct) with its members under it, each
 * member How "Via group"; an activation through a group is nested under its group when exactly one candidate is found.
 */

export type RowKind = "user" | "guest" | "app" | "group" | "agentIdentity" | "agentUser" | "agentBlueprint";

export type RowEnd = { type: "expires"; date: string } | { type: "noEnd" } | { type: "permanent" };

export type RowHow = { type: "direct" } | { type: "viaGroup"; groupId?: string; groupName?: string };

export interface AssignmentRowModel {
    /** Unique within the list, for React */
    key: string;
    /** The schedule or assignment id; the key of row marking */
    scheduleId?: string;
    principalId: string;
    name: string;
    /** UPN for a user or an agent's user account, "{n} members" for a group, "App" for a service principal, "Agent identity · {product or blueprint}" for an agent identity */
    secondary: string;
    kind: RowKind;
    how: RowHow;
    scope?: ScopeInfo;
    end: RowEnd;
    /** Active rows only */
    origin?: "activated" | "assigned";
    /** A member row (or a group's member) with the relation, groups only */
    relation?: "member" | "owner";
    isEmergency: boolean;
    /** Matches the assignment keys of the filter (spec 6.3); false for every row when nothing is marked */
    isMarked: boolean;
    /** Member rows under a group row (a group under PIM) */
    children: AssignmentRowModel[];
    /** A group row: its id, and whether its members are read on demand (a group outside PIM) */
    groupId?: string;
    isOutsidePim?: boolean;
    memberCount?: number;
    /** An activation that came through a group Graph does not name and 5.6 could not name */
    isViaGroupUnnamed?: boolean;
    /** A member of a group outside PIM: membership is permanent, nobody activates it ("Always on") */
    isAlwaysOn?: boolean;
}

export interface RoleAssignmentRows {
    eligible: AssignmentRowModel[];
    active: AssignmentRowModel[];
    /** Rows counted at every level */
    total: number;
}

export interface RowContext {
    groups: readonly PimGroupData[];
    emergencyAccountIds: ReadonlySet<string>;
    /** Ids of the assignments that match the filter; null when the filter has no assignment key (nothing to mark) */
    marking: ReadonlySet<string> | null;
    /** Principal name by lower-case id, for principals the list did not expand */
    nameById?: ReadonlyMap<string, string>;
    /** Blueprint name by lower-case blueprint appId (AG-5); a missing name leaves the plain "Agent identity" */
    blueprintNames?: ReadonlyMap<string, string>;
    /** Members read on demand per group (lower-case id): used to name the group of an activation */
    knownMembers?: ReadonlyMap<string, ReadonlySet<string>>;
}

const unknownName = (id: string) => `Unknown (${id.slice(0, 8)})`;

function endOfSchedule(item: PimEligibilitySchedule | PimAssignmentSchedule, isActive: boolean): RowEnd {
    if (hasNoEnd(item)) return isActive && isAssignedActive(item) ? { type: "permanent" } : { type: "noEnd" };
    return { type: "expires", date: item.scheduleInfo?.expiration?.endDateTime ?? "" };
}

/** The row kind of a principal kind; a user is a guest when its userType says so (an agent's user account never is) */
function toRowKind(kind: PrincipalKind, userType: string | undefined): RowKind {
    if (kind === "group") return "group";
    if (kind === "servicePrincipal") return "app";
    if (kind === "agentIdentity") return "agentIdentity";
    if (kind === "agentUser") return "agentUser";
    if (kind === "agentIdentityBlueprintPrincipal") return "agentBlueprint";
    return isGuestUserType(userType) ? "guest" : "user";
}

function kindOf(item: { principal?: { "@odata.type"?: string; servicePrincipalType?: string | null } | null; principalUserType?: string }, fallback?: string): RowKind {
    const kind = getPrincipalKind(item.principal);
    if (kind === "unknown" && fallback === "group") return "group";
    return toRowKind(kind, item.principalUserType);
}

function secondaryOf(kind: RowKind, upn: string | undefined, memberCount: number | undefined): string {
    if (kind === "group") return memberCount === undefined ? "Group" : `${memberCount} ${memberCount === 1 ? "member" : "members"}`;
    if (kind === "app") return "App";
    if (kind === "agentUser") return upn ?? "Agent's user account";
    return upn ?? "";
}

/** The second line of an agent row: the Microsoft name of the kind and, for an agent identity, its product or blueprint */
function agentSecondary(kind: RowKind, principal: { agentIdentityBlueprintId?: string | null } | null | undefined, blueprintNames: ReadonlyMap<string, string> | undefined): string | null {
    if (kind === "agentBlueprint") return "Agent identity blueprint principal";
    if (kind !== "agentIdentity") return null;
    const origin = getAgentOrigin(principal);
    if (origin) return `Agent identity · ${AGENT_ORIGIN_NAMES[origin]}`;
    const blueprintId = principal?.agentIdentityBlueprintId?.toLowerCase();
    const name = blueprintId ? blueprintNames?.get(blueprintId) : undefined;
    return name ? `Agent identity · ${name}` : "Agent identity";
}

function endOfGroupAssignment(a: GroupPimAssignment): RowEnd {
    if (a.assignmentType === "permanent") return { type: "permanent" };
    const end = a.endDateTime ?? a.scheduleInfo?.expiration?.endDateTime;
    if (!end || a.scheduleInfo?.expiration?.type === "noExpiration") return { type: "noEnd" };
    return { type: "expires", date: end };
}

/** A membership of a group under PIM as a row under its group row. */
export function buildGroupMemberRow(a: GroupPimAssignment, ctx: Pick<RowContext, "emergencyAccountIds" | "marking" | "nameById" | "blueprintNames">, how: RowHow, isMarked: boolean, keyPrefix: string): AssignmentRowModel {
    const kind = kindOf(a);
    const name = a.principal?.displayName ?? ctx.nameById?.get(a.principalId.toLowerCase()) ?? unknownName(a.principalId);
    return {
        key: `${keyPrefix}:${a.id}`,
        scheduleId: a.id,
        principalId: a.principalId,
        name,
        secondary: agentSecondary(kind, a.principal, ctx.blueprintNames) ?? secondaryOf(kind, a.principal?.userPrincipalName, undefined),
        kind,
        how,
        end: endOfGroupAssignment(a),
        origin: a.assignmentType === "eligible" ? undefined : a.assignmentOrigin,
        relation: a.accessType,
        isEmergency: ctx.emergencyAccountIds.has(a.principalId.toLowerCase()),
        isMarked,
        children: [],
    };
}

/** Eligible and Active rows of one role, with group members nested and activations through a group resolved (spec 3.2 and 5.6). */
export function buildRoleAssignmentRows(role: RoleDetailData, ctx: RowContext): RoleAssignmentRows {
    const groupById = new Map(ctx.groups.map((g) => [g.group.id.toLowerCase(), g]));
    const heldByGroup = getRolesHeldByGroups([role], ctx.groups.map((g) => g.group.id));
    const isMarked = (id: string | undefined) => ctx.marking !== null && id !== undefined && ctx.marking.has(id);

    const toRow = (item: PimEligibilitySchedule | PimAssignmentSchedule, isActive: boolean): AssignmentRowModel => {
        const group = groupById.get(item.principalId.toLowerCase());
        const kind = group ? "group" : kindOf(item);
        const name = item.principal?.displayName ?? group?.group.displayName ?? ctx.nameById?.get(item.principalId.toLowerCase()) ?? unknownName(item.principalId);
        // Distinct people: a member who activated an eligible membership has an eligible and an active instance
        const memberCount = group ? (group.isManaged === false ? group.memberCount : new Set(group.assignments.filter((a) => a.accessType === "member").map((a) => a.principalId.toLowerCase())).size) : undefined;
        const viaGroup = isActive && (item as PimAssignmentSchedule).viaGroup === true && kind !== "group";
        return {
            key: `${isActive ? "a" : "e"}:${item.id}`,
            scheduleId: item.id,
            principalId: item.principalId,
            name,
            secondary: agentSecondary(kind, item.principal, ctx.blueprintNames) ?? secondaryOf(kind, item.principal?.userPrincipalName, memberCount),
            kind,
            how: viaGroup ? { type: "viaGroup" } : { type: "direct" },
            scope: item.scopeInfo,
            end: endOfSchedule(item, isActive),
            origin: isActive ? (isActivated(item) ? "activated" : "assigned") : undefined,
            isEmergency: ctx.emergencyAccountIds.has(item.principalId.toLowerCase()),
            isMarked: isMarked(item.id),
            children: [],
            groupId: group ? group.group.id : undefined,
            isOutsidePim: group ? group.isManaged === false : undefined,
            memberCount,
            isViaGroupUnnamed: viaGroup || undefined,
        };
    };

    // A role assignment no active schedule covers (normally none): standing access, shown as Permanent, Assigned
    const toUnscheduledRow = (item: RoleAssignment): AssignmentRowModel => {
        const row = toRow({ ...item, assignmentType: "Assigned", scheduleInfo: { expiration: { type: "noExpiration" } } } as unknown as PimAssignmentSchedule, true);
        return { ...row, key: `p:${item.id}` };
    };

    const eligible = role.assignments.eligible.map((item) => toRow(item, false));
    const active = [...role.assignments.active.map((item) => toRow(item, true)), ...getUnscheduledRoleAssignments(role.assignments).map(toUnscheduledRow)];

    // Group rows by group id, eligible first: the place where members go
    const groupRows = new Map<string, AssignmentRowModel>();
    for (const row of [...eligible, ...active]) {
        if (row.kind === "group" && row.groupId && !groupRows.has(row.groupId.toLowerCase())) groupRows.set(row.groupId.toLowerCase(), row);
    }

    // Only the row that hosts the members keeps the on-demand disclosure; a group that is eligible and active gets it once
    for (const row of [...eligible, ...active]) {
        if (row.kind === "group" && row.groupId && groupRows.get(row.groupId.toLowerCase()) !== row) row.isOutsidePim = undefined;
    }

    // Under PIM: the members of the group as rows under its group row (member relation only), once per principal and group
    const seen = new Set<string>();
    for (const [groupId, row] of groupRows) {
        const data = groupById.get(groupId);
        if (!data || data.isManaged === false) continue;
        for (const a of data.assignments) {
            if (a.accessType !== "member") continue;
            const dedupe = `${a.principalId.toLowerCase()}|${groupId}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            row.children.push(buildGroupMemberRow(a, ctx, { type: "viaGroup", groupId: data.group.id, groupName: data.group.displayName }, row.isMarked, `m:${row.key}`));
        }
    }

    // An activation through a group: nested under its group when exactly one eligible group has the user as a member
    const topLevelActive: AssignmentRowModel[] = [];
    for (const row of active) {
        if (!row.isViaGroupUnnamed) {
            topLevelActive.push(row);
            continue;
        }
        const resolution = resolveActivationGroup(role, row.principalId, ctx.groups, ctx.knownMembers, heldByGroup);
        const parent = resolution.status === "one" ? groupRows.get(resolution.group.id.toLowerCase()) : undefined;
        if (resolution.status === "one" && parent) {
            const dedupe = `${row.principalId.toLowerCase()}|${resolution.group.id.toLowerCase()}`;
            const existing = parent.children.find((child) => child.principalId.toLowerCase() === row.principalId.toLowerCase());
            if (existing) {
                // The group's own data already lists this member: the activation is the same fact, keep its origin and end
                existing.origin = "activated";
                existing.end = row.end;
                existing.isMarked = existing.isMarked || row.isMarked;
            } else if (!seen.has(dedupe)) {
                seen.add(dedupe);
                parent.children.push({ ...row, key: `n:${row.key}`, how: { type: "viaGroup", groupId: resolution.group.id, groupName: resolution.group.displayName }, isViaGroupUnnamed: undefined, children: [] });
            }
            continue;
        }
        topLevelActive.push(row);
    }

    const count = (rows: AssignmentRowModel[]): number => rows.reduce((sum, r) => sum + 1 + count(r.children), 0);
    return { eligible, active: topLevelActive, total: count(eligible) + count(topLevelActive) };
}

// ---------------------------------------------------------------------------------------------
// Members and owners of a group outside PIM (read on demand, spec 4.1) and the scope tag
// ---------------------------------------------------------------------------------------------

export interface MembershipRowOptions {
    emergencyAccountIds: ReadonlySet<string>;
    groupId: string;
    groupName: string;
    /** Role detail: the members get "Via group: {name}"; the group detail shows them as they are (How Direct is not shown) */
    isViaGroup: boolean;
}

/** One row per member and one per owner (a person who is both gets two), members first, each list by name. */
export function buildMembershipRows(membership: GroupMembership, options: MembershipRowOptions): AssignmentRowModel[] {
    const toRow = (p: GroupMembership["members"][number], relation: "member" | "owner"): AssignmentRowModel => {
        const kind = toRowKind(p.kind, p.userType);
        return {
            key: `${relation}:${p.id}`,
            principalId: p.id,
            name: p.displayName,
            secondary: secondaryOf(kind, p.userPrincipalName, undefined),
            kind,
            how: options.isViaGroup ? { type: "viaGroup", groupId: options.groupId, groupName: options.groupName } : { type: "direct" },
            end: { type: "noEnd" },
            relation,
            isEmergency: options.emergencyAccountIds.has(p.id.toLowerCase()),
            isMarked: false,
            isAlwaysOn: true,
            children: [],
        };
    };
    const byName = (a: AssignmentRowModel, b: AssignmentRowModel) => a.name.localeCompare(b.name);
    return [...membership.members.map((p) => toRow(p, "member")).sort(byName), ...membership.owners.map((p) => toRow(p, "owner")).sort(byName)];
}

export interface ScopeTag {
    label: string;
    /** The term the tip comes from, or null when the tip is the scope's own description */
    term: ReportTermKey | null;
    tip: string;
}

/** The scope tag of an assignment row: "Tenant-wide", the administrative unit, the app or the object by name (spec 3.2). */
export function describeScopeTag(scope: ScopeInfo): ScopeTag {
    const name = scope.displayName || "Unknown";
    switch (scope.type) {
        case "tenant-wide":
            return { label: "Tenant-wide", term: "tenantWide", tip: getScopeDisplayName(scope) };
        case "administrative-unit":
        case "rmau":
            return { label: name, term: "administrativeUnit", tip: getScopeDisplayName(scope) };
        case "application":
            return { label: name, term: null, tip: getScopeDisplayName(scope) };
        default:
            return { label: name, term: null, tip: getScopeDisplayName(scope) };
    }
}

// ---------------------------------------------------------------------------------------------
// The Groups detail (spec 4)
// ---------------------------------------------------------------------------------------------

export interface GroupAssignmentRows {
    eligible: AssignmentRowModel[];
    active: AssignmentRowModel[];
    total: number;
}

/** Eligible and Active rows of a group under PIM: every member and owner assignment, by relation then name (spec 4.2). */
export function buildGroupAssignmentRows(group: PimGroupData, ctx: Pick<RowContext, "emergencyAccountIds" | "marking" | "nameById" | "blueprintNames">): GroupAssignmentRows {
    const eligible: AssignmentRowModel[] = [];
    const active: AssignmentRowModel[] = [];
    for (const a of group.assignments) {
        const row = buildGroupMemberRow(a, ctx, { type: "direct" }, ctx.marking !== null && ctx.marking.has(a.id), "g");
        (a.assignmentType === "eligible" ? eligible : active).push(row);
    }
    const byRelationThenName = (a: AssignmentRowModel, b: AssignmentRowModel) => (a.relation === b.relation ? a.name.localeCompare(b.name) : a.relation === "member" ? -1 : 1);
    eligible.sort(byRelationThenName);
    active.sort(byRelationThenName);
    return { eligible, active, total: eligible.length + active.length };
}

export interface RoleHeldRow {
    key: string;
    roleId: string;
    roleName: string;
    isPrivileged: boolean;
    kind: "eligible" | "active" | "permanent";
    end: RowEnd;
    scope?: ScopeInfo;
}

/** "Roles this group holds": one row per role assignment of the group, with End and Scope (spec 4.1). */
export function buildRolesHeldRows(held: readonly RoleHeldByGroup[]): RoleHeldRow[] {
    return held.map((h) => ({
        key: `${h.kind}:${h.scheduleId}`,
        roleId: h.roleId,
        roleName: h.roleName,
        isPrivileged: h.isPrivileged,
        kind: h.kind,
        end: h.isPermanent ? { type: "permanent" } : h.hasNoEnd ? { type: "noEnd" } : { type: "expires", date: h.endDateTime ?? "" },
        scope: h.scope,
    }));
}
