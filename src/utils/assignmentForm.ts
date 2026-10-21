/**
 * Who has it and Add people (spec 5.7, NG-67) as data: the rows of a role or group with the one action each may have
 * (Remove, Change end) and why not, the last owner rule, the limits the target's policy sets for a new
 * assignment (read from the tenant, never from the basket: bug 9), the form's checks and the changes it puts in the
 * basket. Pure; `app/configure/components/edit` draws it.
 */
import type { BasketAdd, BasketRemove, BasketUpdate, Change, GroupAccess, PrincipalRef, ScheduleRef, Target } from "@/types/configure.types";
import type { RoleDefinition, RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { PolicySettings } from "@/types/wizard.types";
import { findAssignmentChange, type Basket } from "@/utils/configureBasket";
import { describeExpiration } from "@/utils/configureSettingRows";
import { addIsoDurationToDate, isZeroDuration, toGraphDuration } from "@/utils/durationUtils";
import { readSettingValue } from "@/utils/policyRules";
import { getPrincipalKind, toBasicKind } from "@/utils/principalUtils";
import { isGuestUserType } from "@/utils/userTypeUtils";
import { getUnscheduledRoleAssignments } from "@/utils/assignmentKinds";
import { resolveActivationGroup } from "@/utils/viaGroup";

// ---------------------------------------------------------------------------------------------------------------------
// The rows of Who has it

/**
 * "expired": an end in the past that Microsoft still lists (the last active owner of a group stays until another one
 * exists, T2h). Ended assignments otherwise leave the schedule lists at once (tenant run 2026-10-09), so there is no
 * Expired filter and no Renew: Learn documents no list of expired assignments.
 */
export type WhoStatus = "eligible" | "active" | "expired";
export type WhoFilter = "all" | "eligible" | "active";

export interface WhoRow {
    key: string;
    principal: PrincipalRef;
    kind: "user" | "guest" | "group" | "app";
    type: "eligible" | "active";
    /** Groups: the side of the assignment */
    access?: GroupAccess;
    status: WhoStatus;
    /** An activation of an eligible assignment: it ends by itself */
    isActivated: boolean;
    /** Held through a group: changed in the group, not here */
    viaGroup: { id?: string; name?: string } | null;
    /** A start in the future: PIM has not provisioned it yet (T8) */
    isScheduled: boolean;
    scopeLabel: string | null;
    isEmergency: boolean;
    /** The assignment as the basket identifies it */
    target: Target;
    schedule: ScheduleRef;
    /** What may be done and, when Remove may not, why */
    canRemove: boolean;
    canChangeEnd: boolean;
    removeBlockedReason: string | null;
    /** A line instead of the actions (activated, through a group, scheduled) */
    note: string | null;
    /** A change of this assignment waiting in the basket */
    pending: BasketRemove | BasketUpdate | null;
}

export const LAST_OWNER = "A group needs at least one owner. Add another owner first.";
export const LAST_ACTIVE_OWNER = "The only active owner: Microsoft refuses to remove it or change its end while the other owners are eligible. Add another active owner first.";
export const ACTIVATED_NOTE = "Ends when the activation ends.";
export const SCHEDULED_NOTE = "Starts later: PIM blocks changes until it starts.";
export const viaGroupNote = (name: string | undefined) => `Comes from ${name ?? "a group"}. Change the group's members instead.`;

type Principalish = { "@odata.type"?: string; displayName?: string; userPrincipalName?: string } | null | undefined;

function principalOf(id: string, principal: Principalish, nameById: ReadonlyMap<string, string>): PrincipalRef {
    const kind = toBasicKind(getPrincipalKind(principal));
    const displayName = principal?.displayName ?? nameById.get(id.toLowerCase()) ?? `Unknown (${id.slice(0, 8)})`;
    return {
        id,
        kind: kind === "group" ? "group" : kind === "servicePrincipal" ? "servicePrincipal" : "user",
        displayName,
        ...(principal?.userPrincipalName ? { userPrincipalName: principal.userPrincipalName } : {}),
    };
}

function rowKind(principal: PrincipalRef, userType: string | undefined): WhoRow["kind"] {
    if (principal.kind === "group") return "group";
    if (principal.kind === "servicePrincipal") return "app";
    return isGuestUserType(userType) ? "guest" : "user";
}

const isPast = (iso: string | null, now: Date) => iso !== null && new Date(iso).getTime() <= now.getTime();
const isFuture = (iso: string | null, now: Date) => iso !== null && new Date(iso).getTime() > now.getTime();

export interface WhoContext {
    basket: Basket;
    emergencyAccountIds: ReadonlySet<string>;
    now: Date;
    /** Names of principals the list did not expand (lower-case id) */
    nameById?: ReadonlyMap<string, string>;
}

interface RawRow {
    key: string;
    principal: PrincipalRef;
    userType?: string;
    type: "eligible" | "active";
    access?: GroupAccess;
    isActivated: boolean;
    viaGroup: WhoRow["viaGroup"];
    scope: string;
    scopeLabel: string | null;
    start: string | null;
    end: string | null;
    target: Target;
}

function finish(raw: RawRow[], ctx: WhoContext): WhoRow[] {
    const rows = raw.map((r): WhoRow => {
        const schedule: ScheduleRef = { principal: r.principal, type: r.type, scope: r.scope, end: r.end, ...(r.start ? { start: r.start } : {}) };
        const status: WhoStatus = isPast(r.end, ctx.now) ? "expired" : r.type;
        const isScheduled = isFuture(r.start, ctx.now);
        const fixed = r.isActivated || r.viaGroup !== null;
        const note = r.viaGroup ? viaGroupNote(r.viaGroup.name) : r.isActivated ? ACTIVATED_NOTE : isScheduled ? SCHEDULED_NOTE : null;
        const change = fixed ? undefined : findAssignmentChange(ctx.basket, r.target, schedule);
        const pending = change && (change.kind === "remove" || change.kind === "update") ? change : null;
        return {
            key: r.key,
            principal: r.principal,
            kind: rowKind(r.principal, r.userType),
            type: r.type,
            access: r.access,
            status,
            isActivated: r.isActivated,
            viaGroup: r.viaGroup,
            isScheduled,
            scopeLabel: r.scopeLabel,
            isEmergency: ctx.emergencyAccountIds.has(r.principal.id.toLowerCase()),
            target: r.target,
            schedule,
            canRemove: !fixed && !isScheduled && status !== "expired",
            canChangeEnd: !fixed && !isScheduled && status !== "expired" && r.end !== null,
            removeBlockedReason: null,
            note,
            pending,
        };
    });
    applyLastOwner(rows);
    return rows;
}

/**
 * The last owner rules (spec 5.7, T2b): Microsoft does not remove the last owner of a group, eligible ones included. When
 * one direct owner would be left (counting the removals waiting), its Remove is disabled with the reason. The last
 * active owner counts apart: with only eligible owners next to it, Microsoft refuses to remove it and also refuses a
 * change of its end, because `adminUpdate` replaces the schedule (tenant run 2026-10-09: CannotDeleteLastAdminAssignment
 * on the end change of the only active owner while another owner was eligible; the eligible one could be removed).
 */
function applyLastOwner(rows: WhoRow[]): void {
    const owners = rows.filter((r) => r.access === "owner" && r.viaGroup === null && !r.isActivated && r.status !== "expired");
    const staying = owners.filter((r) => r.pending?.kind !== "remove");
    const activeStaying = staying.filter((r) => r.type === "active");
    if (activeStaying.length === 1 && staying.length > 1) {
        const [last] = activeStaying;
        last.canRemove = false;
        last.canChangeEnd = false;
        last.removeBlockedReason = LAST_ACTIVE_OWNER;
    }
    if (staying.length > 1) return;
    for (const r of staying) {
        r.canRemove = false;
        r.removeBlockedReason = LAST_OWNER;
    }
}

function scopeLabelOf(scope: string, info: { type?: string; displayName?: string } | undefined): string {
    if (scope === "/" || info?.type === "tenant-wide") return "Tenant-wide";
    if (scope.startsWith("/administrativeUnits/")) return `Administrative unit: ${info?.displayName ?? scope.slice("/administrativeUnits/".length)}`;
    return info?.displayName ? `${info.type === "application" ? "One application" : "One object"}: ${info.displayName}` : scope;
}

/** The icon of a scope tag: the tenant, an administrative unit, or one object (an application) */
export function scopeIcon(scope: string): "tenant" | "admin-unit" | "app-identity" {
    if (scope === "/") return "tenant";
    return scope.startsWith("/administrativeUnits/") ? "admin-unit" : "app-identity";
}

/** The rows of a role: eligible, active (assigned and activated, through a group) and assignments no schedule covers */
export function buildRoleWhoRows(role: RoleDetailData, groups: readonly PimGroupData[], ctx: WhoContext): WhoRow[] {
    const target: Target = { kind: "role", id: role.definition.id };
    const nameById = ctx.nameById ?? new Map<string, string>();
    const groupName = (id: string) => groups.find((g) => g.group.id.toLowerCase() === id.toLowerCase())?.group.displayName;
    type Schedule = RoleDetailData["assignments"]["eligible"][number] & { assignmentType?: string; viaGroup?: boolean; memberType?: string; principalUserType?: string };
    const toRaw = (s: Schedule, type: "eligible" | "active"): RawRow => {
        const scope = s.directoryScopeId || "/";
        const principal = principalOf(s.principalId, s.principal as Principalish, nameById);
        const isActivated = type === "active" && (s.assignmentType ?? "").toLowerCase() === "activated";
        const via = s.viaGroup === true || (s.memberType ?? "").toLowerCase() === "group";
        return {
            key: `${type}:${s.id}`,
            principal,
            userType: s.principalUserType,
            type,
            isActivated,
            viaGroup: via ? { name: undefined } : null,
            scope,
            scopeLabel: scopeLabelOf(scope, s.scopeInfo),
            start: s.scheduleInfo?.startDateTime ?? null,
            end: s.scheduleInfo?.expiration?.endDateTime ?? null,
            target,
        };
    };
    const raw = [
        ...role.assignments.eligible.map((s) => toRaw(s as Schedule, "eligible")),
        ...role.assignments.active.map((s) => toRaw(s as Schedule, "active")),
        ...getUnscheduledRoleAssignments(role.assignments).map((a): RawRow => ({
            key: `permanent:${a.id}`,
            principal: principalOf(a.principalId, (a as { principal?: Principalish }).principal, nameById),
            type: "active",
            isActivated: false,
            viaGroup: null,
            scope: a.directoryScopeId || "/",
            scopeLabel: scopeLabelOf(a.directoryScopeId || "/", undefined),
            start: null,
            end: null,
            target,
        })),
    ];
    // A row through a group names its group: the one group that holds the role eligibly with the principal as a member
    // (Report spec 5.6); several or none leave it unnamed
    for (const r of raw) {
        if (!r.viaGroup) continue;
        if (r.principal.kind === "group") { r.viaGroup = { id: r.principal.id, name: groupName(r.principal.id) }; continue; }
        const found = resolveActivationGroup(role, r.principal.id, groups);
        if (found.status === "one") r.viaGroup = { id: found.group.id, name: found.group.displayName };
    }
    return finish(raw, ctx);
}

/** The rows of a group, both sides (Member and Owner tags), each with the target of its own side */
export function buildGroupWhoRows(group: PimGroupData, ctx: WhoContext): WhoRow[] {
    const nameById = ctx.nameById ?? new Map<string, string>();
    const raw = group.assignments.map((a): RawRow => {
        const type = a.assignmentType === "eligible" ? "eligible" : "active";
        const access: GroupAccess = a.accessType === "owner" ? "owner" : "member";
        const via = (a.memberType ?? "").toLowerCase() === "group";
        return {
            key: `${access}:${type}:${a.id}`,
            principal: principalOf(a.principalId, a.principal as Principalish, nameById),
            userType: a.principalUserType,
            type,
            access,
            isActivated: type === "active" && a.assignmentOrigin === "activated",
            viaGroup: via ? { name: undefined } : null,
            scope: "/",
            scopeLabel: null,
            start: a.startDateTime ?? a.scheduleInfo?.startDateTime ?? null,
            end: a.endDateTime ?? a.scheduleInfo?.expiration?.endDateTime ?? null,
            target: { kind: "group", id: group.group.id, access },
        };
    });
    return finish(raw, ctx);
}

export function countWhoRows(rows: readonly WhoRow[]): Record<WhoFilter, number> {
    const counts: Record<WhoFilter, number> = { all: rows.length, eligible: 0, active: 0 };
    for (const r of rows) counts[r.type] += 1;
    return counts;
}

export function filterWhoRows(rows: readonly WhoRow[], filter: WhoFilter): WhoRow[] {
    return filter === "all" ? [...rows] : rows.filter((r) => r.type === filter);
}

export function formatDay(iso: string | null): string {
    if (!iso) return "No end date";
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

/** The end tag: "Ends {date}", "No end date", "Ended {date}" */
export function describeEnd(row: Pick<WhoRow, "schedule" | "status">): string {
    if (!row.schedule.end) return "No end date";
    return `${row.status === "expired" ? "Ended" : "Ends"} ${formatDay(row.schedule.end)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The limits of the policy (read from the tenant)

export interface PolicyLimits {
    /** The longest an assignment may run, ISO; null when the policy is not known */
    maxDuration: string | null;
    /** No end date allowed; null when the policy is not known */
    permanentAllowed: boolean | null;
    /** A justification is required (active assignments only) */
    justificationRequired: boolean;
}

export function policyLimits(settings: PolicySettings | null, type: "eligible" | "active"): PolicyLimits {
    if (!settings) return { maxDuration: null, permanentAllowed: null, justificationRequired: false };
    const max = readSettingValue(settings, type === "eligible" ? "eligibleExpiration" : "activeExpiration");
    const permanent = readSettingValue(settings, type === "eligible" ? "allowPermanentEligible" : "allowPermanentActive");
    const justification = type === "active" && readSettingValue(settings, "requireJustificationOnActiveAssignment") === true;
    return { maxDuration: typeof max === "string" ? max : null, permanentAllowed: typeof permanent === "boolean" ? permanent : null, justificationRequired: justification };
}

const isZeroMaximum = (max: string | null) => isZeroDuration(max);

/**
 * A policy that allows permanent assignments with a stored maximum of PT0S accepts only an assignment without an end:
 * Microsoft refuses every dated end, a short one included (tenant run 2026-10-09, Guest Inviter: P30D and P400D refused
 * with RoleAssignmentRequestPolicyValidationFailed, noExpiration granted; M-13)
 */
export function allowsOnlyNoEnd(limits: PolicyLimits): boolean {
    return limits.permanentAllowed !== false && isZeroMaximum(limits.maxDuration);
}

export const ONLY_NO_END = "The policy allows only assignments without an end date.";

/** The end of the policy's maximum duration from a start (the "Policy maximum" choice); null when not known or when only no end is allowed */
export function maxEndFrom(limits: PolicyLimits, start: Date): Date | null {
    if (!limits.maxDuration || isZeroMaximum(limits.maxDuration)) return null;
    return addIsoDurationToDate(start, toGraphDuration(limits.maxDuration));
}

/**
 * The latest end the policy allows from a start: the stored maximum caps an end even while permanent is allowed
 * (tenant test T3: P400D was refused on a role allowing permanent with P365D, M-13). Null without a cap; a PT0S policy
 * has no dated end at all, see `allowsOnlyNoEnd`
 */
export function latestEnd(limits: PolicyLimits, start: Date): Date | null {
    return maxEndFrom(limits, start);
}

/** "The policy decides what is allowed: …" (spec 5.7) */
export function describePolicySentence(settings: PolicySettings | null): string | null {
    if (!settings) return null;
    const eligible = policyLimits(settings, "eligible");
    const active = policyLimits(settings, "active");
    const part = (l: PolicyLimits, noun: string) => (l.permanentAllowed
        ? allowsOnlyNoEnd(l) ? `${noun} assignments must be permanent` : `permanent ${noun} assignments are allowed`
        : l.maxDuration ? `${noun} assignments end within ${describeExpiration(l.maxDuration).toLowerCase()}` : `${noun} assignments need an end`);
    return `The policy decides what is allowed: ${part(eligible, "eligible")}, ${part(active, "active")}${active.justificationRequired ? ", a justification is required for active" : ""}.`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Scopes of a role (spec 5.7; Microsoft Learn "Assign Microsoft Entra roles")

/** Built-in roles Microsoft documents as assignable at an administrative unit */
export const ADMINISTRATIVE_UNIT_ROLES: ReadonlySet<string> = new Set([
    "Authentication Administrator",
    "Attribute Assignment Administrator",
    "Attribute Assignment Reader",
    "Cloud Device Administrator",
    "Groups Administrator",
    "Helpdesk Administrator",
    "License Administrator",
    "Password Administrator",
    "Printer Administrator",
    "Privileged Authentication Administrator",
    "SharePoint Administrator",
    "Teams Administrator",
    "Teams Devices Administrator",
    "User Administrator",
]);

const actionsOf = (role: RoleDefinition) => (role.rolePermissions ?? []).flatMap((p) => p.allowedResourceActions ?? []).map((a) => a.toLowerCase());

/** A built-in role of the documented list, or a custom role with a user, group or device permission */
export function supportsAdministrativeUnit(role: RoleDefinition): boolean {
    if (role.isBuiltIn !== false) return ADMINISTRATIVE_UNIT_ROLES.has(role.displayName);
    return actionsOf(role).some((a) => a.startsWith("microsoft.directory/users/") || a.startsWith("microsoft.directory/groups/") || a.startsWith("microsoft.directory/devices/"));
}

/** Built-in roles with app registration permissions: Application Administrator (named by Learn) and Cloud Application Administrator */
export const APPLICATION_ROLES: ReadonlySet<string> = new Set(["Application Administrator", "Cloud Application Administrator"]);

/**
 * One application: the built-in roles that manage app registrations, or a custom role whose permissions are all about
 * app registrations. Graph refuses any other role (the dry run says so). Needs tenant test.
 */
export function supportsApplication(role: RoleDefinition): boolean {
    if (role.isBuiltIn !== false) return APPLICATION_ROLES.has(role.displayName);
    const actions = actionsOf(role);
    return actions.length > 0 && actions.every((a) => a.startsWith("microsoft.directory/applications/"));
}

export interface ScopeOption {
    value: string;
    label: string;
}

/** Tenant-wide, every administrative unit and the applications found, as far as the role supports them */
export function scopeOptions(role: RoleDefinition, units: readonly { id: string; displayName: string }[], applications: readonly { id: string; displayName: string }[]): ScopeOption[] {
    const options: ScopeOption[] = [{ value: "/", label: "Tenant-wide" }];
    if (supportsAdministrativeUnit(role)) for (const u of units) options.push({ value: `/administrativeUnits/${u.id}`, label: `Administrative unit: ${u.displayName}` });
    if (supportsApplication(role)) for (const a of applications) options.push({ value: `/${a.id}`, label: `One application: ${a.displayName}` });
    return options;
}

// ---------------------------------------------------------------------------------------------------------------------
// The form

export type StartChoice = { kind: "now" } | { kind: "date"; date: string };
export type EndChoice = { kind: "max" } | { kind: "date"; date: string } | { kind: "none" };

export interface AddForm {
    principals: PrincipalRef[];
    type: "eligible" | "active";
    /** Groups */
    access: GroupAccess;
    /** Roles: `directoryScopeId` */
    scope: string;
    start: StartChoice;
    end: EndChoice;
    justification: string;
}

export const EMPTY_FORM = (access: GroupAccess = "member"): AddForm => ({ principals: [], type: "eligible", access, scope: "/", start: { kind: "now" }, end: { kind: "max" }, justification: "" });

/** One target of the form with its policy as read (several in Select several) */
export interface FormTarget {
    target: Target;
    name: string;
    /** Settings of the side the form writes to; null when not read (or a group not under PIM) */
    settings: PolicySettings | null;
    /** Groups: the settings of both sides, so the form reads the side it writes */
    sides?: Record<GroupAccess, PolicySettings | null>;
}

/** The targets as the form writes them: a group with the settings of the side chosen */
export function onSide(targets: readonly FormTarget[], access: GroupAccess): FormTarget[] {
    return targets.map((t) => (t.target.kind === "group" && t.sides ? { ...t, target: { ...t.target, access }, settings: t.sides[access] } : t));
}

/** The date of a `YYYY-MM-DD` input at the start of that day, local time */
function dayStart(date: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The end of a `YYYY-MM-DD` day (an assignment "until 31 March" runs through that day) */
function dayEnd(date: string): Date | null {
    const d = dayStart(date);
    if (!d) return null;
    d.setHours(23, 59, 59, 0);
    return d;
}

/** `YYYY-MM-DD` of a date, local time (the value of a date input) */
export function toDay(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The end of a chosen day, never later than the policy allows (the day of the maximum ends at the maximum); null for no valid day */
export function capEnd(date: string, limits: PolicyLimits, start: Date): string | null {
    const end = dayEnd(date);
    if (!end) return null;
    const latest = latestEnd(limits, start);
    return (latest && end.getTime() > latest.getTime() ? latest : end).toISOString();
}

/** Learn (groups-assign-member-owner): an assignment "can't be assigned for a duration of less than five minutes" (R-53) */
const MIN_ASSIGNMENT_MS = 5 * 60 * 1000;

export interface FormProblems {
    principals?: string;
    start?: string;
    end?: string;
    justification?: string;
}

/**
 * What stops the form (spec 5.7): nobody chosen, a start in the past, no end where every policy requires one, an end
 * beyond the maximum of a policy or before the start, and a justification an active assignment requires. The policy is
 * the one read from the tenant (never the basket).
 */
export function checkForm(form: AddForm, targets: readonly FormTarget[], now: Date): FormProblems {
    const problems: FormProblems = {};
    if (form.principals.length === 0) problems.principals = "Choose at least one person or group.";
    const start = form.start.kind === "date" ? dayStart(form.start.date) : now;
    if (form.start.kind === "date") {
        if (!start) problems.start = "Choose a start date.";
        else if (dayEnd(form.start.date)!.getTime() < now.getTime()) problems.start = "The start cannot be in the past.";
    }
    const limits = targets.map((t) => policyLimits(t.settings, form.type));
    if (form.end.kind === "none" && limits.some((l) => l.permanentAllowed === false)) problems.end = "The policy requires an end date.";
    const noEndOnly = targets.filter((_, i) => allowsOnlyNoEnd(limits[i]));
    if (form.end.kind !== "none" && noEndOnly.length > 0) {
        problems.end = targets.length === 1 ? ONLY_NO_END : `The policy of ${noEndOnly.map((t) => t.name).join(", ")} allows only assignments without an end date.`;
    } else if (form.end.kind === "date") {
        const end = dayEnd(form.end.date);
        if (!end) problems.end = "Choose an end date.";
        else if (start && end.getTime() <= start.getTime()) problems.end = "The end must be after the start.";
        else if (start && end.getTime() - start.getTime() < MIN_ASSIGNMENT_MS) problems.end = "An assignment must last at least five minutes.";
        else if (start) {
            // By calendar day: the day of the maximum itself is allowed (its end is capped at the maximum)
            const tooLate = targets.filter((_, i) => {
                const latest = latestEnd(limits[i], start);
                return latest !== null && form.end.kind === "date" && form.end.date > toDay(latest);
            });
            if (tooLate.length > 0) problems.end = `Later than the policy maximum of ${tooLate.map((t) => t.name).join(", ")}.`;
        }
    }
    if (limits.some((l) => l.justificationRequired) && !form.justification.trim()) problems.justification = "The policy requires a justification for active assignments.";
    return problems;
}

export const hasProblems = (p: FormProblems) => Object.values(p).some(Boolean);

/** The end a choice gives for one target: the policy maximum from the start, the date chosen, or none */
export function endFor(choice: EndChoice, limits: PolicyLimits, start: Date): string | null {
    if (choice.kind === "none") return null;
    if (choice.kind === "date") return capEnd(choice.date, limits, start);
    const max = maxEndFrom(limits, start);
    return max ? max.toISOString() : null;
}

/**
 * The adds of the form: one per person and target, start left out for "when applied" (spec 13), the end per target's
 * policy. Groups use the side chosen in the form; roles the scope.
 */
export function buildAdds(form: AddForm, targets: readonly FormTarget[], now: Date, source: BasketAdd["source"] = { from: "edit" }): BasketAdd[] {
    const startIso = form.start.kind === "date" ? dayStart(form.start.date)?.toISOString() ?? null : null;
    const startAt = startIso ? new Date(startIso) : now;
    const adds: BasketAdd[] = [];
    for (const t of targets) {
        const target: Target = t.target.kind === "group" ? { ...t.target, access: form.access } : t.target;
        const end = endFor(form.end, policyLimits(t.settings, form.type), startAt);
        for (const principal of form.principals) {
            adds.push({
                kind: "add",
                target,
                principal,
                type: form.type,
                scope: target.kind === "role" ? form.scope : "/",
                start: startIso,
                end,
                justification: form.justification.trim(),
                source,
            });
        }
    }
    return adds;
}

/** The end choice under "Policy maximum" with its date (spec 5.7: "Policy maximum: {duration} ({date})") */
export function describeMaxChoice(targets: readonly FormTarget[], type: "eligible" | "active", start: Date): string {
    if (targets.length !== 1) return "The maximum of each policy";
    const limits = policyLimits(targets[0].settings, type);
    if (allowsOnlyNoEnd(limits)) return "No end date (the only end the policy allows)";
    if (!limits.maxDuration) return "Policy maximum";
    const max = maxEndFrom(limits, start);
    return `Policy maximum: ${describeExpiration(limits.maxDuration).toLowerCase()}${max ? ` (${formatDay(max.toISOString())})` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Actions on a row

export function removeChange(row: WhoRow): BasketRemove {
    return { kind: "remove", target: row.target, schedule: row.schedule, source: { from: "edit" } };
}

/**
 * Change end (`adminUpdate`, T8: it accepts any new end); the justification goes along when given (a policy can
 * require it for active assignments, also on an update)
 */
export function endChange(row: WhoRow, end: string | null, justification = ""): BasketUpdate {
    const text = justification.trim();
    return { kind: "update", target: row.target, schedule: row.schedule, end, action: "adminUpdate", ...(text ? { justification: text } : {}), source: { from: "edit" } };
}

/** Adds waiting in the basket for these targets (the "New" rows under the list) */
export function pendingAdds(changes: readonly Change[], targets: readonly Target[]): BasketAdd[] {
    const same = (a: Target, b: Target) => a.kind === b.kind && a.id === b.id;
    return changes.filter((c): c is BasketAdd => c.kind === "add" && targets.some((t) => same(t, c.target)));
}
