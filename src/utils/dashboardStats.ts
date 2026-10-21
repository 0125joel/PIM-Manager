import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { buildKindById, buildNameById, buildRoleAssignmentFacts } from "@/utils/dashboardFilter";
import { isActivated, isActivatedGroupAssignment, isPermanentActive, isTimeBoundActive } from "@/utils/assignmentKinds";
import { parseTotalHours } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";
import { isAgentKind } from "@/utils/principalUtils";

/**
 * Every number of the dashboard's Basic view (spec 4.2 and 4.4), computed from raw role and group data.
 * Pure: the page passes what is counted (chips applied, filter applied) and renders what comes back.
 * A value that is not known yet is `null`, never 0 (spec 4.7).
 */

export interface AssignmentCounts {
    /** Active assignments created by activation (card 2) */
    activated: number;
    /** Active assignments created by an administrator without an end (card 3) */
    permanent: number;
    /** Eligibility schedules or instances (card 4) */
    eligible: number;
    /** Every active assignment that has an end date, activated or assigned (Who donut) */
    timeBound: number;
    /** Permanent assignments held by a marked emergency access account */
    emergencyPermanent: number;
}

const EMPTY_COUNTS: AssignmentCounts = { activated: 0, permanent: 0, eligible: 0, timeBound: 0, emergencyPermanent: 0 };

export function countRoleAssignments(roles: RoleDetailData[], emergencyIds: ReadonlySet<string> = new Set()): AssignmentCounts {
    const counts = { ...EMPTY_COUNTS };
    for (const role of roles) {
        counts.eligible += role.assignments.eligible.length;
        for (const item of role.assignments.active) {
            if (isActivated(item)) counts.activated += 1;
            if (isTimeBoundActive(item)) counts.timeBound += 1;
            if (isPermanentActive(item)) {
                counts.permanent += 1;
                if (emergencyIds.has(item.principalId.toLowerCase())) counts.emergencyPermanent += 1;
            }
        }
    }
    return counts;
}

/**
 * Group assignments: activated means Graph's `assignmentType` `activated`; an instance an administrator assigned with an
 * end date is time-bound but not activated. Permanent members and owners have no end date.
 */
export function countGroupAssignments(groups: PimGroupData[], emergencyIds: ReadonlySet<string> = new Set()): AssignmentCounts {
    const counts = { ...EMPTY_COUNTS };
    for (const data of groups) {
        for (const a of data.assignments) {
            if (a.assignmentType === "eligible") {
                counts.eligible += 1;
            } else if (a.assignmentType === "active") {
                if (isActivatedGroupAssignment(a)) counts.activated += 1;
                if (a.endDateTime) counts.timeBound += 1;
            } else if (a.assignmentType === "permanent") {
                counts.permanent += 1;
                if (emergencyIds.has(a.principalId.toLowerCase())) counts.emergencyPermanent += 1;
            }
        }
    }
    return counts;
}

export type CardId = "rolesAndGroups" | "activeNow" | "permanent" | "eligible" | "privileged" | "requireApproval" | "customRoles" | "groupsUnderPim";

export interface CardStat {
    /** Formatted number, "-" when not available, null while it is still loading */
    value: string | null;
    breakdown: string;
    isWarning: boolean;
}

export interface DashboardStatsInput {
    /** Roles that count (chip on, filter applied) */
    roles: RoleDetailData[];
    /** Onboarded groups that count (chip on, filter applied) */
    groups: PimGroupData[];
    /** Every role, unfiltered: the denominators of a filtered view */
    allRoles: RoleDetailData[];
    /** Onboarded and unmanaged groups, unfiltered, for the groups under PIM card; empty when that chip is off */
    allGroups: PimGroupData[];
    /** The chip Agents; undefined counts agents (callers outside the dashboard page) */
    isAgentsCounted?: boolean;
    isDirectoryRolesCounted: boolean;
    isGroupsCounted: boolean;
    /** PIM for Groups failed to load: numbers say the groups are missing instead of counting zero */
    isGroupsUnavailable?: boolean;
    isUnmanagedCounted: boolean;
    /** A filter is active */
    isFiltered: boolean;
    /** The filter keeps groups in; false means every group is left out and says so */
    filterAppliesToGroups: boolean;
    /** Policies are still arriving */
    policiesLoading: boolean;
    /** Spec 4.3: "All roles" counts every role as privileged; Basic always counts privileged roles only */
    scope?: "privileged" | "all";
    emergencyAccountIds?: ReadonlySet<string>;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** "{r} roles · {g} groups"; only the roles part when the filter leaves groups out. */
function splitBreakdown(roles: number, groups: number, input: DashboardStatsInput): string {
    if (input.isFiltered && !input.filterAppliesToGroups) return plural(roles, "role", "roles");
    const parts: string[] = [];
    if (input.isDirectoryRolesCounted) parts.push(plural(roles, "role", "roles"));
    if (input.isGroupsCounted) parts.push(input.isGroupsUnavailable ? "groups not loaded" : plural(groups, "group", "groups"));
    return parts.join(" · ");
}

function isPrivilegedRole(role: RoleDetailData, scope: "privileged" | "all"): boolean {
    return scope === "all" || role.definition.isPrivileged === true;
}

/** True when Graph reports `isPrivileged` on at least one role definition. */
export function isPrivilegedReported(roles: RoleDetailData[]): boolean {
    return roles.some((r) => r.definition.isPrivileged !== undefined);
}

export interface PolicyProgress {
    /** Roles of the set whose policy is loaded */
    loaded: number;
    total: number;
    /** Some policy is missing and still on its way */
    isPending: boolean;
}

function policyProgress(roles: RoleDetailData[], policiesLoading: boolean): PolicyProgress {
    const loaded = roles.filter((r) => summarizePolicyRules(r.policy?.details?.rules).isLoaded).length;
    return { loaded, total: roles.length, isPending: policiesLoading && loaded < roles.length };
}

export function computeCards(input: DashboardStatsInput): Record<CardId, CardStat> {
    const emergency = input.emergencyAccountIds ?? new Set<string>();
    const scope = input.scope ?? "privileged";
    const roleCounts = input.isDirectoryRolesCounted ? countRoleAssignments(input.roles, emergency) : EMPTY_COUNTS;
    const groupCounts = input.isGroupsCounted ? countGroupAssignments(input.groups, emergency) : EMPTY_COUNTS;
    const roleCount = input.isDirectoryRolesCounted ? input.roles.length : 0;
    const groupCount = input.isGroupsCounted ? input.groups.length : 0;

    const split = (r: number, g: number) => splitBreakdown(r, g, input);

    // Card 5 and 6 read the role definitions and the loaded policies
    const countedRoles = input.isDirectoryRolesCounted ? input.roles : [];
    const countedAllRoles = input.isDirectoryRolesCounted ? input.allRoles : [];
    const privilegedReported = isPrivilegedReported(input.allRoles);
    const privileged = countedRoles.filter((r) => isPrivilegedRole(r, scope));
    const allPrivileged = countedAllRoles.filter((r) => isPrivilegedRole(r, scope));

    let privilegedCard: CardStat;
    if (!input.isDirectoryRolesCounted) {
        privilegedCard = { value: "-", breakdown: "directory roles not counted", isWarning: false };
    } else if (!privilegedReported && scope === "privileged") {
        privilegedCard = { value: "-", breakdown: "not reported by Graph", isWarning: false };
    } else {
        privilegedCard = {
            value: String(privileged.length),
            breakdown: input.isFiltered ? `of ${allPrivileged.length} ${scope === "all" ? "roles" : "privileged"}` : `of ${countedAllRoles.length} directory roles`,
            isWarning: false,
        };
    }

    let approvalCard: CardStat;
    if (!input.isDirectoryRolesCounted) {
        approvalCard = { value: "-", breakdown: "directory roles not counted", isWarning: false };
    } else {
        // Filtered: of the roles that stay; otherwise of the privileged roles. A role whose policy Graph answered 403 on
        // (FIX-12) is not "no approval": it is left out, and with none readable the card says so instead of 0
        const base = (input.isFiltered ? countedRoles : privileged).filter((r) => !r.policiesForbidden);
        const notReadable = (input.isFiltered ? countedRoles : privileged).length - base.length;
        const progress = policyProgress(base, input.policiesLoading);
        if (notReadable > 0 && base.length === 0) {
            approvalCard = { value: "-", breakdown: "settings not readable", isWarning: false };
        } else if (progress.isPending || (!privilegedReported && !input.isFiltered && scope === "privileged")) {
            approvalCard = {
                value: progress.isPending ? null : "-",
                breakdown: input.isFiltered ? `of ${base.length} roles` : scope === "all" ? `of ${base.length} roles` : `of ${base.length} privileged`,
                isWarning: false,
            };
        } else {
            const required = base.filter((r) => summarizePolicyRules(r.policy?.details?.rules).isApprovalRequired === true).length;
            approvalCard = {
                value: String(required),
                breakdown: input.isFiltered ? `of ${base.length} roles` : scope === "all" ? `of ${base.length} roles` : `of ${base.length} privileged`,
                isWarning: false,
            };
        }
    }

    const custom = countedRoles.filter((r) => r.definition.isBuiltIn === false);
    const customWithAssignments = custom.filter((r) => r.assignments.eligible.length + r.assignments.active.length > 0).length;

    const onboarded = input.allGroups.filter((g) => g.isManaged !== false);
    const roleAssignable = input.allGroups.filter((g) => g.group.isAssignableToRole === true);
    const onboardedAssignable = roleAssignable.filter((g) => g.isManaged !== false).length;
    let underPim: CardStat;
    if (input.isGroupsCounted && input.isGroupsUnavailable) {
        underPim = { value: "-", breakdown: "PIM for Groups not loaded", isWarning: false };
    } else if (!input.isGroupsCounted || !input.isUnmanagedCounted) {
        underPim = { value: "-", breakdown: !input.isGroupsCounted ? "PIM for Groups not counted" : "unmanaged groups not counted", isWarning: false };
    } else if (roleAssignable.length === 0) {
        underPim = { value: "-", breakdown: onboarded.length === 0 ? "no groups in PIM" : "no role-assignable groups", isWarning: false };
    } else {
        underPim = {
            value: `${Math.round((onboardedAssignable / roleAssignable.length) * 100)}%`,
            breakdown: `${onboardedAssignable} of ${roleAssignable.length} role-assignable groups`,
            isWarning: false,
        };
    }

    const totalValue = roleCount + groupCount;
    const rolesAndGroupsBreakdown = input.isFiltered && !input.filterAppliesToGroups ? "roles, groups not affected" : split(roleCount, groupCount);

    return {
        rolesAndGroups: { value: String(totalValue), breakdown: rolesAndGroupsBreakdown, isWarning: false },
        activeNow: { value: String(roleCounts.activated + groupCounts.activated), breakdown: split(roleCounts.activated, groupCounts.activated), isWarning: false },
        permanent: { value: String(roleCounts.permanent + groupCounts.permanent), breakdown: split(roleCounts.permanent, groupCounts.permanent), isWarning: true },
        eligible: { value: String(roleCounts.eligible + groupCounts.eligible), breakdown: split(roleCounts.eligible, groupCounts.eligible), isWarning: false },
        privileged: privilegedCard,
        requireApproval: approvalCard,
        customRoles: {
            value: input.isDirectoryRolesCounted ? String(custom.length) : "-",
            breakdown: input.isDirectoryRolesCounted ? `${customWithAssignments} with assignments` : "directory roles not counted",
            isWarning: false,
        },
        groupsUnderPim: underPim,
    };
}

/** Every card when its data could not be loaded: a dash and the reason, never a 0 (spec 4.7). */
export function unavailableCards(reason: string): Record<CardId, CardStat> {
    const card: CardStat = { value: "-", breakdown: reason, isWarning: false };
    return { rolesAndGroups: card, activeNow: card, permanent: card, eligible: card, privileged: card, requireApproval: card, customRoles: card, groupsUnderPim: card };
}

export interface WhoStats {
    permanent: number;
    eligible: number;
    activeTimeBound: number;
    /** permanent + eligible + active time-bound */
    total: number;
    emergencyPermanent: number;
}

/** The Who donut (spec 4.2): permanent, eligible and active time-bound over everything that is counted. */
export function computeWho(input: DashboardStatsInput): WhoStats {
    const emergency = input.emergencyAccountIds ?? new Set<string>();
    const r = input.isDirectoryRolesCounted ? countRoleAssignments(input.roles, emergency) : EMPTY_COUNTS;
    const g = input.isGroupsCounted ? countGroupAssignments(input.groups, emergency) : EMPTY_COUNTS;
    const permanent = r.permanent + g.permanent;
    const eligible = r.eligible + g.eligible;
    const activeTimeBound = r.timeBound + g.timeBound;
    return { permanent, eligible, activeTimeBound, total: permanent + eligible + activeTimeBound, emergencyPermanent: r.emergencyPermanent + g.emergencyPermanent };
}

export interface TermsStats {
    /** Roles the block is about (privileged in Basic) */
    roleCount: number;
    entraMfa: number;
    authContext: number;
    neither: number;
    approval: number;
    justification: number;
    /** Loaded policies that do not ask for a justification (a role whose policy failed to load is in neither number) */
    withoutJustification: number;
    overEightHours: number;
    /** Policies still arriving: the block shows placeholders */
    isPending: boolean;
}

/** The Terms donut and its three mini figures (spec 4.2). Only roles with a loaded policy are counted. */
export function computeTerms(input: DashboardStatsInput): TermsStats {
    const scope = input.scope ?? "privileged";
    // A role whose policy is not readable (FIX-12) is left out: "0 of 35 ask for MFA" would claim what was never read
    const roles = (input.isDirectoryRolesCounted ? input.roles : []).filter((r) => isPrivilegedRole(r, scope) && !r.policiesForbidden);
    const stats: TermsStats = { roleCount: roles.length, entraMfa: 0, authContext: 0, neither: 0, approval: 0, justification: 0, withoutJustification: 0, overEightHours: 0, isPending: policyProgress(roles, input.policiesLoading).isPending };

    for (const role of roles) {
        const summary = summarizePolicyRules(role.policy?.details?.rules);
        if (!summary.isLoaded) continue;
        if (summary.hasPimMfa) stats.entraMfa += 1;
        else if (summary.hasAuthContext) stats.authContext += 1;
        else stats.neither += 1;
        if (summary.isApprovalRequired) stats.approval += 1;
        if (summary.isJustificationRequired) stats.justification += 1;
        else stats.withoutJustification += 1;
        const hours = parseTotalHours(summary.maxDuration);
        if (hours !== null && hours > 8) stats.overEightHours += 1;
    }
    return stats;
}

/** "{mfa + authContext}" of the Terms donut centre. */
export function getAskForMfaCount(terms: TermsStats): number {
    return terms.entraMfa + terms.authContext;
}

/** The text of the Who annotation (spec 4.2); the middle clause is left out when no emergency account is involved. */
export function buildWhoAnnotation(who: WhoStats, rolesOnly: boolean): string {
    if (rolesOnly) return "Directory roles only, groups are not affected by this filter.";
    const emergency = who.emergencyPermanent > 0 ? `, ${who.emergencyPermanent} of them emergency access` : "";
    return `${who.permanent} permanent${emergency}. The number you want to see go down.`;
}

const ACTIVATION_POLICY_KEYS = ["approval", "mfa", "justification", "maxDuration", "activationNotification", "customExtension"] as const;

/**
 * The filter the Basic dashboard really applies. The activation terms (MFA, approval, justification, duration,
 * notification) are read for privileged roles, so a filter on one of them without an explicit `privileged` key
 * means privileged roles: "7 of 33 privileged roles" (basic-filtered.png). The link to the report carries this
 * filter, so the report lists the same roles.
 */
export function getEffectiveDashboardFilter(filter: DashboardFilter): DashboardFilter {
    const hasTerm = ACTIVATION_POLICY_KEYS.some((key) => filter[key] !== undefined);
    return hasTerm && filter.privileged === undefined ? { ...filter, privileged: true } : filter;
}

/** "7 of 33 privileged roles. Blocks about groups and alerts are not affected." (spec 4.6) */
export function buildFilterSentence(matching: number, scopeTotal: number, scopeLabel: string, affectsGroups: boolean, isAdvanced = false): string {
    const count = `${matching} of ${scopeTotal} ${scopeLabel}.`;
    if (isAdvanced) return `${count} The sections below are not affected.`;
    return affectsGroups ? count : `${count} Blocks about groups and alerts are not affected.`;
}

/** The filter each card sets on a click (spec 4.6); cards 1 and 8 have none. */
export const CARD_FILTERS: Partial<Record<CardId, DashboardFilter>> = {
    activeNow: { assignment: "active" },
    permanent: { assignment: "permanent" },
    eligible: { assignment: "eligible" },
    privileged: { privileged: true },
    requireApproval: { approval: "required" },
    customRoles: { customRole: true },
};

/** True when both filters set the same keys to the same values: a pressed card, legend row or figure. */
export function isSameFilter(a: DashboardFilter, b: DashboardFilter): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof DashboardFilter)[]);
    for (const key of keys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------------------------
// Easy to miss (spec 4.5)
// ---------------------------------------------------------------------------------------------

export const GLOBAL_ADMINISTRATOR_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";

export type EasyToMissCategory = "Access without an end" | "Accounts you may not expect" | "Roles set up halfway";

export type EasyToMissId = "permanentGlobalAdmins" | "eligibleWithoutEnd" | "apps" | "agents" | "guests" | "nobodyNotified" | "onlyPermanent";

export interface EasyToMissRow {
    id: EasyToMissId;
    category: EasyToMissCategory;
    label: string;
    /** null while the policies this row needs are still arriving */
    count: number | null;
    /** "None" for a row with 0 */
    detail: string;
    /** The filter a click sets (spec 4.6) */
    filter: DashboardFilter;
}

const NAME_LIMIT = 3;

function detailOrNone(count: number | null, detail: string): string {
    return count === 0 ? "None" : detail;
}

/** "Megan Bowen, Adele Vance, Alex Wilber, +2" */
export function formatNameList(names: string[]): string {
    const shown = names.slice(0, NAME_LIMIT).join(", ");
    return names.length > NAME_LIMIT ? `${shown}, +${names.length - NAME_LIMIT}` : shown;
}

/** The rows of Easy to miss (seven, six when the chip Agents is off), each from one tested definition. Counts follow the filtered roles and groups like the cards. */
export function computeEasyToMiss(input: DashboardStatsInput): EasyToMissRow[] {
    const emergency = input.emergencyAccountIds ?? new Set<string>();
    const roles = input.isDirectoryRolesCounted ? input.roles : [];
    const groups = input.isGroupsCounted ? input.groups : [];
    const kindById = buildKindById(roles);
    const nameById = buildNameById(input.allRoles);

    // Global Administrator: permanent assignments, marked emergency accounts counted apart
    const globalAdminNames: string[] = [];
    let globalAdminCount = 0;
    const globalAdminEmergencyIds = new Set<string>();
    // Eligible without an end date, roles and groups
    let eligibleWithoutEnd = groups.reduce((sum, g) => sum + g.assignments.filter((a) => a.assignmentType === "eligible" && !a.endDateTime).length, 0);
    const apps = new Set<string>();
    const agents = new Set<string>();
    const guests = new Set<string>();
    let onlyPermanent = 0;

    for (const role of roles) {
        const facts = buildRoleAssignmentFacts(role, kindById, nameById);
        const isPrivileged = role.definition.isPrivileged === true;
        const isGlobalAdmin = role.definition.templateId?.toLowerCase() === GLOBAL_ADMINISTRATOR_TEMPLATE_ID;

        for (const fact of facts) {
            const id = fact.principalId.toLowerCase();
            if (fact.isEligibleWithoutEnd) eligibleWithoutEnd += 1;
            if (isPrivileged && fact.kind === "servicePrincipal") apps.add(id);
            if (isAgentKind(fact.kind)) agents.add(id);
            if (fact.isGuest) guests.add(id);
            if (isGlobalAdmin && fact.isPermanent) {
                if (emergency.has(id)) globalAdminEmergencyIds.add(id);
                else {
                    globalAdminCount += 1;
                    globalAdminNames.push(fact.displayName ?? `Unknown (${fact.principalId.slice(0, 8)})`);
                }
            }
        }

        if (isPrivileged && role.assignments.eligible.length === 0 && facts.some((f) => f.isPermanent)) onlyPermanent += 1;
    }

    const globalAdminEmergency = globalAdminEmergencyIds.size;
    const emergencySentence = `The ${plural(globalAdminEmergency, "emergency access account is", "emergency access accounts are")} not counted.`;
    const privileged = roles.filter((r) => r.definition.isPrivileged === true);
    const progress = policyProgress(privileged, input.policiesLoading);
    const nobodyNotified = progress.isPending
        ? null
        : privileged.filter((r) => {
              const rule = summarizePolicyRules(r.policy?.details?.rules).activationNotification;
              return rule !== undefined && !rule.isDefaultRecipientsEnabled && rule.notificationRecipients.length === 0;
          }).length;

    const globalAdminDetail = [formatNameList(globalAdminNames), globalAdminEmergency > 0 ? emergencySentence : ""].filter(Boolean).join(globalAdminNames.length > 0 ? ". " : "");

    return [
        {
            id: "permanentGlobalAdmins",
            category: "Access without an end",
            label: "Permanent Global Administrators",
            count: globalAdminCount,
            detail: globalAdminCount === 0 ? (globalAdminEmergency > 0 ? `None. ${emergencySentence}` : "None") : globalAdminDetail,
            filter: { assignment: "permanent", roleTemplateId: GLOBAL_ADMINISTRATOR_TEMPLATE_ID, excludeEmergency: true },
        },
        {
            id: "eligibleWithoutEnd",
            category: "Access without an end",
            label: "Eligible without an end date",
            count: eligibleWithoutEnd,
            detail: detailOrNone(eligibleWithoutEnd, "Never comes up for review by itself."),
            filter: { noEndDate: true },
        },
        {
            id: "apps",
            category: "Accounts you may not expect",
            label: "Apps with a privileged role",
            count: apps.size,
            detail: detailOrNone(apps.size, "Service principals that hold the role."),
            filter: { principalType: "servicePrincipal", privileged: true },
        },
        ...(input.isAgentsCounted === false ? [] : [{
            id: "agents" as const,
            category: "Accounts you may not expect" as const,
            label: "Agents with a role",
            count: agents.size,
            detail: detailOrNone(agents.size, "AI agents (Microsoft Entra Agent ID) that hold a role."),
            filter: { principalType: "agent" as const },
        }]),
        {
            id: "guests",
            category: "Accounts you may not expect",
            label: "Guests with a role",
            count: guests.size,
            detail: detailOrNone(guests.size, "Accounts from another tenant."),
            filter: { principalType: "guest" },
        },
        {
            id: "nobodyNotified",
            category: "Roles set up halfway",
            label: "Nobody is notified on activation",
            count: nobodyNotified,
            detail: detailOrNone(nobodyNotified, "Privileged roles where activation goes unnoticed."),
            filter: { privileged: true, activationNotification: "none" },
        },
        {
            id: "onlyPermanent",
            category: "Roles set up halfway",
            label: "Only permanent members",
            count: onlyPermanent,
            detail: detailOrNone(onlyPermanent, "Privileged roles that nobody activates, PIM is not used."),
            filter: { privileged: true, assignment: "permanent", hasEligible: false },
        },
    ];
}
