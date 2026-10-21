import type { Approver, RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { getGroupsOutsidePim } from "@/utils/groupsOutsidePim";
import { getLinkedCustomExtensions, parseCustomExtensionRules } from "@/utils/customExtensionUtils";
import { buildKindById, buildNameById, buildRoleAssignmentFacts } from "@/utils/dashboardFilter";
import { computeTerms, countGroupAssignments, countRoleAssignments, type AssignmentCounts } from "@/utils/dashboardStats";
import { getMaxDurationBucket, isActivatedGroupAssignment } from "@/utils/assignmentKinds";
import { parseTotalHours } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";
import type { DashboardFilter, MaxDurationBucket } from "@/types/dashboardFilter.types";
import type { PrincipalKind } from "@/utils/principalUtils";

/**
 * Pure numbers for the five sections of the Advanced dashboard (spec 4.3). Definitions are in docs/Assets/next-gen/dashboard/plans/ng-37-plan.md;
 * the Basic definitions (`dashboardStats.ts`, `assignmentKinds.ts`) are reused so a number means the same everywhere.
 */

export type DashboardScope = "privileged" | "all";

export function isInScope(role: RoleDetailData, scope: DashboardScope): boolean {
    return scope === "all" || role.definition.isPrivileged === true;
}

export type AdvancedSectionId = "access" | "activation";

/**
 * The Advanced section a filter was set from, or null. That section stays undimmed while the filter is active, so the
 * row you clicked stays readable; every other section is dimmed (spec 4.6). A filter that one of its own rows can set
 * belongs to it: the Has access legend and Direct or Through a group, or the On activation rows.
 */
export function getFilterOwnerSection(filter: DashboardFilter): AdvancedSectionId | null {
    const keys = Object.keys(filter).filter((k) => filter[k as keyof DashboardFilter] !== undefined);
    if (keys.length !== 1) return null;
    if (filter.via !== undefined) return "access";
    if (filter.assignment !== undefined && filter.assignment !== "active") return "access";
    if (filter.approval !== undefined || filter.mfa !== undefined || filter.justification !== undefined || filter.customExtension !== undefined) return "activation";
    if (filter.maxDuration !== undefined && filter.maxDuration !== "over8h") return "activation";
    return null;
}

// ---------------------------------------------------------------------------------------------
// 1. Has access, and how
// ---------------------------------------------------------------------------------------------

export interface AccessRow {
    label: "Directory roles" | "Group members" | "Group owners";
    permanent: number;
    eligible: number;
    activeTimeBound: number;
    total: number;
}

export interface HasAccess {
    rows: AccessRow[];
    /** Directory role assignments held directly (a user or an app) and through a group */
    direct: number;
    viaGroup: number;
    /** Distinct groups that hold a role */
    groupsHoldingRoles: number;
}

function toRow(label: AccessRow["label"], c: AssignmentCounts): AccessRow {
    const total = c.permanent + c.eligible + c.timeBound;
    return { label, permanent: c.permanent, eligible: c.eligible, activeTimeBound: c.timeBound, total };
}

export function computeHasAccess(roles: RoleDetailData[], groups: PimGroupData[]): HasAccess {
    const asAccessType = (type: "member" | "owner"): PimGroupData[] => groups.map((g) => ({ ...g, assignments: g.assignments.filter((a) => a.accessType === type) }));
    const rows = [
        toRow("Directory roles", countRoleAssignments(roles)),
        toRow("Group members", countGroupAssignments(asAccessType("member"))),
        toRow("Group owners", countGroupAssignments(asAccessType("owner"))),
    ];

    const kindById = buildKindById(roles);
    let direct = 0;
    let viaGroup = 0;
    const groupIds = new Set<string>();
    for (const role of roles) {
        for (const fact of buildRoleAssignmentFacts(role, kindById)) {
            if (fact.isViaGroup) viaGroup += 1;
            else direct += 1;
            if (fact.kind === "group") groupIds.add(fact.principalId.toLowerCase());
        }
    }
    return { rows, direct, viaGroup, groupsHoldingRoles: groupIds.size };
}

// ---------------------------------------------------------------------------------------------
// 2. On activation
// ---------------------------------------------------------------------------------------------

export interface ActivationCharts {
    roleCount: number;
    entraMfa: number;
    authContext: number;
    neither: number;
    approvalRequired: number;
    approvalNotRequired: number;
    justificationRequired: number;
    justificationNotRequired: number;
    durations: Record<MaxDurationBucket, number>;
    /** Roles of the scope whose policy is not loaded: not in any number above */
    unloaded: number;
    /** Roles of the scope whose policy Graph answered 403 on (FIX-12): not in any number above, and not in `unloaded` */
    notReadable: number;
}

/** MFA, approval, justification and maximum duration over the roles in scope that have a loaded policy. */
export function computeActivationCharts(roles: RoleDetailData[], scope: DashboardScope): ActivationCharts {
    const inScope = roles.filter((r) => isInScope(r, scope));
    // One implementation for MFA, approval and justification: the Basic Terms block
    const terms = computeTerms({ roles: inScope, groups: [], allRoles: inScope, allGroups: [], isDirectoryRolesCounted: true, isGroupsCounted: false, isUnmanagedCounted: false, isFiltered: false, filterAppliesToGroups: true, policiesLoading: false, scope });
    const loaded = terms.entraMfa + terms.authContext + terms.neither;
    const durations: Record<MaxDurationBucket, number> = { upTo1h: 0, upTo4h: 0, upTo8h: 0, upTo12h: 0, over12h: 0 };
    const notReadable = inScope.filter((r) => r.policiesForbidden).length;
    for (const role of inScope) {
        const bucket = getMaxDurationBucket(parseTotalHours(summarizePolicyRules(role.policy?.details?.rules).maxDuration));
        if (bucket) durations[bucket] += 1;
    }
    return {
        roleCount: inScope.length,
        entraMfa: terms.entraMfa,
        authContext: terms.authContext,
        neither: terms.neither,
        approvalRequired: terms.approval,
        approvalNotRequired: loaded - terms.approval,
        justificationRequired: terms.justification,
        justificationNotRequired: terms.withoutJustification,
        durations,
        unloaded: inScope.length - loaded - notReadable,
        notReadable,
    };
}

export type ExtensionStage = "pre-approval" | "post-approval";

export interface CustomExtensionRow {
    id: string;
    name: string;
    stage: ExtensionStage;
    roleCount: number;
    /** Linked by a policy but missing from the tenant's list (only when the list could be read) */
    isNotFound: boolean;
    /** Roles that cannot be activated because of a missing extension */
    blockedRoles: string[];
}

/** One row per extension and stage over the roles in scope. `tenantExtensionIds` is null when the list cannot be read. */
export function computeCustomExtensionRows(roles: RoleDetailData[], tenantExtensionIds: ReadonlySet<string> | null): CustomExtensionRow[] {
    const rows = new Map<string, CustomExtensionRow & { roleNames: Set<string>; enabledRoleNames: Set<string> }>();
    for (const role of roles) {
        for (const { slot, link } of getLinkedCustomExtensions(parseCustomExtensionRules(role.policy?.details?.rules))) {
            const stage: ExtensionStage = slot === "preApproval" ? "pre-approval" : "post-approval";
            const key = `${link.customExtensionId}|${stage}`;
            const row = rows.get(key) ?? { id: link.customExtensionId, name: link.displayName || link.customExtensionId, stage, roleCount: 0, isNotFound: tenantExtensionIds !== null && !tenantExtensionIds.has(link.customExtensionId), blockedRoles: [], roleNames: new Set<string>(), enabledRoleNames: new Set<string>() };
            row.roleNames.add(role.definition.displayName);
            if (link.isEnabled) row.enabledRoleNames.add(role.definition.displayName);
            rows.set(key, row);
        }
    }
    return [...rows.values()]
        .map(({ roleNames, enabledRoleNames, ...row }) => ({ ...row, roleCount: roleNames.size, blockedRoles: row.isNotFound ? [...enabledRoleNames].sort() : [] }))
        .sort((a, b) => b.roleCount - a.roleCount || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// 3. PIM for Groups
// ---------------------------------------------------------------------------------------------

export interface ManagedGroupRow {
    id: string;
    name: string;
    membersEligible: number;
    membersActive: number;
    ownersEligible: number;
    permanent: number;
    total: number;
}

export interface OutsideGroupRow {
    id: string;
    name: string;
    type: string;
}

export interface GroupsSection {
    outside: OutsideGroupRow[];
    managedCount: number;
    topManaged: ManagedGroupRow[];
}

const GROUP_TYPE_LABELS: Record<string, string> = { security: "security", m365: "microsoft 365", mailEnabled: "mail-enabled", unknown: "group" };

/** Role-assignable groups outside PIM, and the busiest managed groups by total assignments. */
export function computeGroupsSection(groups: PimGroupData[], limit = 5): GroupsSection {
    const types = new Map(groups.map((g) => [g.group.id, GROUP_TYPE_LABELS[g.group.groupType] ?? "group"]));
    // The same rule as the Basic block: role-assignable groups that PIM does not manage
    const outside = getGroupsOutsidePim(groups, [])
        .map((g) => ({ id: g.id, name: g.name, type: types.get(g.id) ?? "group" }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const managed = groups.filter((g) => g.isManaged !== false);
    const rows = managed.map((g): ManagedGroupRow => {
        const count = (access: "member" | "owner", type: string) => g.assignments.filter((a) => a.accessType === access && a.assignmentType === type).length;
        return {
            id: g.group.id,
            name: g.group.displayName,
            membersEligible: count("member", "eligible"),
            membersActive: count("member", "active"),
            ownersEligible: count("owner", "eligible"),
            permanent: g.assignments.filter((a) => a.assignmentType === "permanent").length,
            total: g.assignments.length,
        };
    });
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { outside, managedCount: managed.length, topManaged: rows.slice(0, limit) };
}

// ---------------------------------------------------------------------------------------------
// 4. Most privileged, and who approves
// ---------------------------------------------------------------------------------------------

export interface AccountRow {
    id: string;
    name: string;
    kind: PrincipalKind;
    isEmergency: boolean;
    privilegedRoles: number;
    permanent: number;
    eligible: number;
}

/** Accounts ranked by the number of distinct roles in scope they hold (eligible or active). */
export function computeTopAccounts(roles: RoleDetailData[], scope: DashboardScope, emergencyIds: ReadonlySet<string> = new Set(), limit = 6): AccountRow[] {
    const accounts = new Map<string, AccountRow & { roleIds: Set<string>; permanentRoleIds: Set<string>; eligibleRoleIds: Set<string> }>();
    const scoped = roles.filter((r) => isInScope(r, scope));
    const kindById = buildKindById(roles);
    const nameById = buildNameById(roles);
    for (const role of scoped) {
        const facts = buildRoleAssignmentFacts(role, kindById, nameById);
        for (const fact of facts) {
            if (fact.kind === "group") continue;
            const id = fact.principalId.toLowerCase();
            const entry = accounts.get(id) ?? { id: fact.principalId, name: fact.displayName ?? `Unknown (${fact.principalId.slice(0, 8)})`, kind: fact.kind, isEmergency: emergencyIds.has(id), privilegedRoles: 0, permanent: 0, eligible: 0, roleIds: new Set<string>(), permanentRoleIds: new Set<string>(), eligibleRoleIds: new Set<string>() };
            if (!entry.name || entry.name === "Unknown") entry.name = fact.displayName ?? entry.name;
            entry.roleIds.add(role.definition.id);
            if (fact.isPermanent) entry.permanentRoleIds.add(role.definition.id);
            if (fact.isEligible) entry.eligibleRoleIds.add(role.definition.id);
            accounts.set(id, entry);
        }
    }
    return [...accounts.values()]
        .map(({ roleIds, permanentRoleIds, eligibleRoleIds, ...row }) => ({ ...row, privilegedRoles: roleIds.size, permanent: permanentRoleIds.size, eligible: eligibleRoleIds.size }))
        .sort((a, b) => b.privilegedRoles - a.privilegedRoles || b.permanent - a.permanent || a.name.localeCompare(b.name))
        .slice(0, limit);
}

export interface ApproverRow {
    id: string;
    name: string;
    isGroup: boolean;
    roleCount: number;
}

export interface ApproversSummary {
    approvers: ApproverRow[];
    /** Roles that require approval and have exactly one approver */
    singleApproverRoles: { role: string; approver: string }[];
    /** Roles in scope that require approval */
    requiringApproval: number;
}

/** Who approves, read from the policy rule itself: `user:{id}`, `group:{id}`, or `manager` for the requestor's manager. */
export function getRuleApproverKeys(role: RoleDetailData): string[] {
    const rule = role.policy?.details?.rules?.find((r) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule");
    const keys = new Set<string>();
    for (const stage of rule?.setting?.approvalStages ?? []) {
        for (const approver of stage.primaryApprovers ?? []) {
            if (approver["@odata.type"] === "#microsoft.graph.requestorManager") keys.add("manager");
            else if (approver.groupId) keys.add(`group:${approver.groupId.toLowerCase()}`);
            else if (approver.userId ?? approver.id) keys.add(`user:${(approver.userId ?? approver.id)!.toLowerCase()}`);
        }
    }
    return [...keys];
}

/** Approvers of the roles in scope that require approval, with the roles each covers. Names come from the resolved list. */
export function computeApprovers(roles: RoleDetailData[], scope: DashboardScope, limit = 6): ApproversSummary {
    const byKey = new Map<string, ApproverRow>();
    const single: { role: string; key: string }[] = [];
    const names = new Map<string, { name: string; isGroup: boolean }>();
    let requiring = 0;
    for (const role of roles.filter((r) => isInScope(r, scope))) {
        if (summarizePolicyRules(role.policy?.details?.rules).isApprovalRequired !== true) continue;
        requiring += 1;
        for (const resolved of (role.policy?.approvers ?? []) as Approver[]) {
            names.set(`${resolved.type === "group" ? "group" : "user"}:${resolved.id.toLowerCase()}`, { name: resolved.displayName || "Unknown approver", isGroup: resolved.type === "group" });
        }
        const keys = getRuleApproverKeys(role);
        for (const key of keys) {
            const row = byKey.get(key) ?? { id: key, name: "", isGroup: key.startsWith("group:"), roleCount: 0 };
            row.roleCount += 1;
            byKey.set(key, row);
        }
        if (keys.length === 1) single.push({ role: role.definition.displayName, key: keys[0] });
    }
    const nameOf = (key: string) => (key === "manager" ? "the requestor's manager" : names.get(key)?.name ?? "an approver");
    const approvers = [...byKey.values()]
        .map((row) => ({ ...row, name: row.id === "manager" ? "Requestor's manager" : names.get(row.id)?.name ?? "Unknown approver" }))
        .sort((a, b) => b.roleCount - a.roleCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    return {
        approvers,
        singleApproverRoles: single.map((s) => ({ role: s.role, approver: nameOf(s.key) })).sort((a, b) => a.role.localeCompare(b.role)),
        requiringApproval: requiring,
    };
}

// ---------------------------------------------------------------------------------------------
// 5. Right now
// ---------------------------------------------------------------------------------------------

export interface RightNowRow {
    who: string;
    what: string;
    /** Milliseconds until the end */
    msLeft: number;
    principalId: string;
}

export interface RightNow {
    activated: RightNowRow[];
    activatedCount: number;
    ending: RightNowRow[];
    endingCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Activated assignments that have not ended, and eligibilities that end within 7 days (roles and groups), soonest first. */
export function computeRightNow(roles: RoleDetailData[], groups: PimGroupData[], now: Date, limit = 4): RightNow {
    const nameById = buildNameById(roles);
    const nameOf = (id: string, name?: string) => name ?? nameById.get(id.toLowerCase()) ?? `Unknown (${id.slice(0, 8)})`;
    const nowMs = now.getTime();
    const activated: RightNowRow[] = [];
    const ending: RightNowRow[] = [];

    for (const role of roles) {
        for (const item of role.assignments.active) {
            if ((item.assignmentType ?? "").toLowerCase() !== "activated") continue;
            const end = item.scheduleInfo?.expiration?.endDateTime;
            const endMs = end ? new Date(end).getTime() : NaN;
            if (Number.isNaN(endMs) || endMs <= nowMs) continue;
            activated.push({ who: nameOf(item.principalId, item.principal?.displayName), what: role.definition.displayName, msLeft: endMs - nowMs, principalId: item.principalId });
        }
        for (const item of role.assignments.eligible) {
            const end = item.scheduleInfo?.expiration?.endDateTime;
            const endMs = end ? new Date(end).getTime() : NaN;
            if (Number.isNaN(endMs) || endMs <= nowMs || endMs > nowMs + 7 * DAY_MS) continue;
            ending.push({ who: nameOf(item.principalId, item.principal?.displayName), what: role.definition.displayName, msLeft: endMs - nowMs, principalId: item.principalId });
        }
    }
    for (const data of groups) {
        for (const a of data.assignments) {
            const endMs = a.endDateTime ? new Date(a.endDateTime).getTime() : NaN;
            if (Number.isNaN(endMs) || endMs <= nowMs) continue;
            const what = `${data.group.displayName}, ${a.accessType}`;
            if (isActivatedGroupAssignment(a)) activated.push({ who: nameOf(a.principalId, a.principal?.displayName), what, msLeft: endMs - nowMs, principalId: a.principalId });
            else if (a.assignmentType === "eligible" && endMs <= nowMs + 7 * DAY_MS) ending.push({ who: nameOf(a.principalId, a.principal?.displayName), what, msLeft: endMs - nowMs, principalId: a.principalId });
        }
    }
    const bySoonest = (a: RightNowRow, b: RightNowRow) => a.msLeft - b.msLeft;
    activated.sort(bySoonest);
    ending.sort(bySoonest);
    return { activated: activated.slice(0, limit), activatedCount: activated.length, ending: ending.slice(0, limit), endingCount: ending.length };
}

/** "30 min", "1 h", "3 h" for an activation that ends in `ms`; days for longer. */
export function formatEndsIn(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / 60000));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h`;
    return `${Math.round(hours / 24)} days`;
}

/** Days until an eligibility ends, rounded up, at least 1: "in 2 days". */
export function daysUntil(ms: number): number {
    return Math.max(1, Math.ceil(ms / DAY_MS));
}
