/**
 * The list of Edit roles and groups as data (spec 5.2, 5.3; NG-63): one row per role or group with its tags, the
 * activation summary, the number of people with access, the violet dot for changes in the basket and the lock with its
 * reason. Filter chips combine with AND, the search matches the name. Pure; `app/configure/components/edit` draws it.
 */
import type { RoleDetailData, PimPolicyRule } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuthenticationContext } from "@/types/shared.types";
import type { GroupAccess, Target } from "@/types/configure.types";
import { findCatalogRole, type AccessModelCatalog } from "@/utils/accessModelCatalog";
import { hasChangesFor, type Basket } from "@/utils/configureBasket";
import { parseTotalHours, formatDuration } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";
import { completeRules } from "@/utils/policyView";
import { countGroupAssignments, countRoleAssignments } from "@/utils/reportList";
import { groupLockReason, type WriteAccess } from "@/utils/writeAccess";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";

export type RoleChip = "privileged" | "builtIn" | "custom" | "withAssignments" | "withoutAssignments";
export type GroupChip = "roleAssignable" | "owned" | "notUnderPim";
export type TargetChip = RoleChip | GroupChip;

export const ROLE_CHIPS: ReadonlyArray<{ value: RoleChip; label: string }> = [
    { value: "privileged", label: "Privileged" },
    { value: "builtIn", label: "Built-in" },
    { value: "custom", label: "Custom" },
    { value: "withAssignments", label: "With assignments" },
    { value: "withoutAssignments", label: "Without assignments" },
];

export const GROUP_CHIPS: ReadonlyArray<{ value: GroupChip; label: string }> = [
    { value: "roleAssignable", label: "Role-assignable" },
    { value: "owned", label: "You own it" },
    { value: "notUnderPim", label: "Show groups not under PIM" },
];

export type TargetTag = "privileged" | "custom" | "roleAssignable" | "owned" | "notUnderPim";

export const TAG_LABELS: Record<TargetTag, string> = {
    privileged: "Privileged",
    custom: "Custom",
    roleAssignable: "Role-assignable",
    owned: "You own it",
    notUnderPim: "Not under PIM",
};

export interface TargetRow {
    kind: "role" | "group";
    id: string;
    name: string;
    tags: TargetTag[];
    /** "{requirement} · {duration}" plus " · Approval"; a line about the settings while they are not read */
    summary: string;
    /** Eligible and active assignments (for groups both sides) */
    people: number;
    hasChanges: boolean;
    /** Why the admin may not change it; null when it is selectable */
    lock: string | null;
    section: "main" | "notUnderPim";
    /** For sorting and the filters */
    isPrivileged: boolean;
    isBuiltIn: boolean;
    isOwned: boolean;
    isRoleAssignable: boolean;
}

export interface TargetListContext {
    access: WriteAccess | null;
    basket: Basket;
    authenticationContexts: readonly AuthenticationContext[];
    /** The policies of the roles are still arriving: a row without one says so instead of a default */
    isPoliciesLoading: boolean;
}

export const NO_ROLE_WRITE = "PIM Manager may not write roles yet. Grant the permission on the start page.";
export const NO_GROUP_WRITE = "PIM Manager may not write groups yet. Grant the permission on the start page.";
export const NOT_CHECKED = "Your access to this group is not checked yet.";
export const NOT_UNDER_PIM_LINE = "Comes under PIM when you apply a change";
/** The summary of a group not under PIM: it has no PIM settings to show */
export const NO_PIM_SETTINGS = "No PIM settings yet";
/** The row summary of a group whose policies Graph answered 403 on (FIX-11); the full sentence is the lock of the row */
export const NOT_READABLE_SUMMARY = "Settings not readable";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 hours", "1.5 hours", "30 minutes"; anything longer than a day as the duration utilities say it */
export function describeActivationDuration(iso: string | undefined): string | null {
    const hours = parseTotalHours(iso);
    if (hours === null) return null;
    if (hours < 1) return plural(Math.round(hours * 60), "minute", "minutes");
    if (hours <= 24) return plural(Math.round(hours * 100) / 100, "hour", "hours");
    return formatDuration(iso).toLowerCase();
}

/** The summary of the activation settings of one policy (spec 5.2): "Multifactor authentication · 4 hours · Approval" */
export function describePolicySummary(rules: readonly unknown[] | null | undefined, contexts: readonly AuthenticationContext[]): string | null {
    if (!rules) return null;
    const summary = summarizePolicyRules(completeRules(rules) as unknown as PimPolicyRule[]);
    // One choice in Configure: a context replaces MFA (spec 5.5); a policy that has both reads as the context
    const requirement = summary.hasAuthContext
        ? contexts.find((c) => c.id === summary.contextId)?.displayName ?? "Authentication context"
        : summary.hasPimMfa ? "Multifactor authentication" : "Nothing";
    const parts = [requirement];
    const duration = describeActivationDuration(summary.maxDuration);
    if (duration) parts.push(duration);
    if (summary.isApprovalRequired) parts.push("Approval");
    return parts.join(" · ");
}

/** Why the admin may not change roles now; null when roles are open and the app may write them */
export function roleLock(access: WriteAccess | null): string | null {
    if (!access) return null;
    if (access.roles.state === "activate-first") {
        const target = access.roles.activate;
        const name = target?.kind === "role" ? (target.role.throughGroup ? `your membership of ${target.role.throughGroup.groupName}` : target.role.name) : "a fitting role";
        return `Activate ${name} first.`;
    }
    if (access.roles.state === "closed") return "Needs Privileged Role Administrator or Global Administrator.";
    if (access.appPermission.directoryRoles !== "granted") return NO_ROLE_WRITE;
    return null;
}

export function groupLock(access: WriteAccess | null, group: PimGroupData): string | null {
    // Dynamic and synced groups cannot come under PIM, whatever the admin holds
    const never = groupLockReason(group.group);
    if (never) return never;
    // The policy is what Edit, Who has it and the review check against: without a readable policy nothing is offered (FIX-11)
    if (group.policiesForbidden) return POLICY_NOT_READABLE;
    if (!access) return null;
    const decision = access.groups[group.group.id];
    if (!decision) return NOT_CHECKED;
    if (decision.state !== "open") return /[.!?]$/.test(decision.reason) ? decision.reason : `${decision.reason}.`;
    if (access.appPermission.pimGroups !== "granted") return NO_GROUP_WRITE;
    return null;
}

export function buildRoleRow(role: RoleDetailData, ctx: TargetListContext): TargetRow {
    const counts = countRoleAssignments(role);
    const isPrivileged = role.definition.isPrivileged === true;
    const isCustom = role.definition.isBuiltIn === false;
    const tags: TargetTag[] = [];
    if (isPrivileged) tags.push("privileged");
    if (isCustom) tags.push("custom");
    const summary = role.policiesForbidden ? NOT_READABLE_SUMMARY
        : describePolicySummary(role.policy?.details?.rules, ctx.authenticationContexts)
        ?? (ctx.isPoliciesLoading && !role.configError ? "Loading settings" : "Settings not loaded");
    return {
        kind: "role",
        id: role.definition.id,
        name: role.definition.displayName,
        tags,
        summary,
        people: counts.eligible + counts.active,
        hasChanges: hasChangesFor(ctx.basket, "role", role.definition.id),
        // Without a readable policy nothing is offered for the role (FIX-12), the same as for a group (FIX-11)
        lock: role.policiesForbidden ? POLICY_NOT_READABLE : roleLock(ctx.access),
        section: "main",
        isPrivileged,
        isBuiltIn: !isCustom,
        isOwned: false,
        isRoleAssignable: false,
    };
}

export function buildGroupRow(group: PimGroupData, ctx: TargetListContext): TargetRow {
    const isUnderPim = group.isManaged !== false;
    const isOwned = ctx.access?.groups[group.group.id]?.owner === true;
    const isRoleAssignable = group.group.isAssignableToRole === true;
    const tags: TargetTag[] = [];
    if (isRoleAssignable) tags.push("roleAssignable");
    if (isOwned) tags.push("owned");
    if (!isUnderPim) tags.push("notUnderPim");
    const counts = countGroupAssignments(group);
    const policy = group.policies?.member;
    const summary = !isUnderPim
        ? NO_PIM_SETTINGS
        : group.policiesForbidden ? NOT_READABLE_SUMMARY : describePolicySummary(policy?.rules, ctx.authenticationContexts) ?? "Loading settings";
    return {
        kind: "group",
        id: group.group.id,
        name: group.group.displayName,
        tags,
        summary,
        people: isUnderPim ? counts.eligible + counts.active : group.memberCount ?? 0,
        hasChanges: hasChangesFor(ctx.basket, "group", group.group.id),
        lock: groupLock(ctx.access, group),
        section: isUnderPim ? "main" : "notUnderPim",
        isPrivileged: false,
        isBuiltIn: true,
        isOwned,
        isRoleAssignable,
    };
}

function matchesRoleChip(row: TargetRow, chip: RoleChip): boolean {
    switch (chip) {
        case "privileged": return row.isPrivileged;
        case "builtIn": return row.isBuiltIn;
        case "custom": return !row.isBuiltIn;
        case "withAssignments": return row.people > 0;
        case "withoutAssignments": return row.people === 0;
    }
}

function matchesGroupChip(row: TargetRow, chip: GroupChip): boolean {
    switch (chip) {
        case "roleAssignable": return row.isRoleAssignable;
        case "owned": return row.isOwned;
        // Not a narrowing filter: it adds the section of groups not under PIM
        case "notUnderPim": return true;
    }
}

/** Privileged first, then the most people, then the name */
export function compareTargetRows(a: TargetRow, b: TargetRow): number {
    if (a.isPrivileged !== b.isPrivileged) return a.isPrivileged ? -1 : 1;
    return b.people - a.people || a.name.localeCompare(b.name);
}

export interface TargetList {
    /** Rows of the main section, sorted */
    rows: TargetRow[];
    /** Groups not under PIM, only when "Show groups not under PIM" is on */
    notUnderPim: TargetRow[];
    /** Every row of the main section before search and filters (the count of the segment) */
    total: number;
    /** Groups not under PIM before search and filters, also while the section is hidden */
    outsideTotal: number;
}

export function filterTargetRows(all: readonly TargetRow[], chips: ReadonlySet<TargetChip>, query: string): TargetList {
    const q = query.trim().toLowerCase();
    const showOutside = chips.has("notUnderPim");
    const kept = all.filter((row) => {
        if (q && !row.name.toLowerCase().includes(q)) return false;
        for (const chip of chips) {
            const isRoleChip = ROLE_CHIPS.some((c) => c.value === chip);
            if (row.kind === "role" ? isRoleChip && !matchesRoleChip(row, chip as RoleChip) : !isRoleChip && !matchesGroupChip(row, chip as GroupChip)) return false;
        }
        return true;
    });
    return {
        rows: kept.filter((r) => r.section === "main").sort(compareTargetRows),
        notUnderPim: showOutside ? kept.filter((r) => r.section === "notUnderPim").sort(compareTargetRows) : [],
        total: all.filter((r) => r.section === "main").length,
        outsideTotal: all.filter((r) => r.section === "notUnderPim").length,
    };
}

export function buildTargetList(view: "roles" | "groups", roles: readonly RoleDetailData[], groups: readonly PimGroupData[], ctx: TargetListContext, chips: ReadonlySet<TargetChip>, query: string): TargetList {
    const rows = view === "roles" ? roles.map((r) => buildRoleRow(r, ctx)) : groups.map((g) => buildGroupRow(g, ctx));
    return filterTargetRows(rows, chips, query);
}

/** Toggling a chip of the view; chips of the other view are dropped */
export function toggleChip(chips: ReadonlySet<TargetChip>, chip: TargetChip, view: "roles" | "groups"): Set<TargetChip> {
    const own = new Set<TargetChip>((view === "roles" ? ROLE_CHIPS : GROUP_CHIPS).map((c) => c.value));
    const next = new Set([...chips].filter((c) => own.has(c)));
    if (next.has(chip)) next.delete(chip);
    else next.add(chip);
    return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Detail head (spec 5.3)

export interface TargetHead {
    target: Target;
    name: string;
    tags: TargetTag[];
    /** "Control plane · Privileged" when the catalog knows the role */
    place: string | null;
    /** "{n} with access" (a role, a group outside PIM), "{m} members · {o} owners" (a group under PIM) */
    withAccess: string;
    /** From the row before search and filters: a deep link to a locked target that the search hides stays locked */
    lock: string | null;
}

export function describeRoleHead(role: RoleDetailData, catalog: AccessModelCatalog | null, ctx: TargetListContext): TargetHead {
    const row = buildRoleRow(role, ctx);
    const known = catalog ? findCatalogRole(catalog, role.definition.templateId ?? role.definition.id) : undefined;
    return {
        target: { kind: "role", id: role.definition.id },
        name: row.name,
        tags: row.tags,
        place: known ? `${known.plane} plane · ${known.securityLevel}` : null,
        withAccess: `${row.people} with access`,
        lock: row.lock,
    };
}

export function describeGroupHead(group: PimGroupData, access: GroupAccess, ctx: TargetListContext): TargetHead {
    const row = buildGroupRow(group, ctx);
    // Both sides by name: one side's count read as "0 with access" while Who has it lists the owners (tenant run 2026-10-09)
    const count = (side: GroupAccess) => group.assignments.filter((a) => a.accessType === side).length;
    const members = count("member");
    const owners = count("owner");
    return {
        target: { kind: "group", id: group.group.id, access },
        name: row.name,
        tags: row.tags,
        place: null,
        withAccess: group.isManaged === false ? `${row.people} with access` : `${members} ${members === 1 ? "member" : "members"} · ${owners} ${owners === 1 ? "owner" : "owners"}`,
        lock: row.lock,
    };
}

/** The target shown without a selection (from 1024 up): the first row of the list that can be changed */
export function defaultTargetId(list: TargetList): string | undefined {
    return [...list.rows, ...list.notUnderPim].find((r) => r.lock === null)?.id;
}

/** The tab order of spec 5.4 with their labels */
export const EDIT_TABS = [
    { value: "activation", label: "Activation" },
    { value: "assignment", label: "Assignment" },
    { value: "notification", label: "Notification" },
    { value: "who", label: "Who has it" },
] as const;
