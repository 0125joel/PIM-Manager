import type { PimAssignmentSchedule, PimEligibilitySchedule, RoleAssignment, RoleDetailData } from "@/types/directoryRole.types";
import type { GroupAccessType, PimGroupData } from "@/types/pimGroup.types";
import type { AuditEvent } from "@/types/audit.types";
import { getUnscheduledRoleAssignments, hasNoEnd, isActivated } from "@/utils/assignmentKinds";
import { buildKindById, buildNameById } from "@/utils/dashboardFilter";
import { isGuestUpn } from "@/utils/holderKinds";
import { getPrincipalKind, isAgentKind, toBasicKind, type PrincipalKind } from "@/utils/principalUtils";
import { isGuestUserType } from "@/utils/userTypeUtils";
import { buildAuditPrivilege, judgeGroupPrivilege } from "@/utils/auditPrivilege";
import { formatAuditDate, type AuditFormat } from "@/utils/auditView";
import type { AuditEnvChoice, AuditWhoChoice } from "@/utils/auditUrlState";
import type { AzureScopeLevel } from "@/types/azureResource.types";

/**
 * The No activation view of the Audit page (AU-6 and AU-6b briefs, implementation spec section 5): per assignment of a person
 * to a role, or to the member or owner access of a group, whether it was activated in the period. Pure: no Graph, no state.
 *
 * The risk here is a false conclusion, since someone may remove a role because of this table. So an activation counts
 * only when the log shows it done (a success that is not just a request) for the same role, person and scope, a permanent
 * or time-bound active assignment never gives a warning, an assignment younger than the period is not a warning, and
 * anything that cannot be judged says so instead of looking unused. Nothing is left out: every assignment is a row, and
 * the numbers of the sentence add up to the rows.
 */

const DAY_MS = 86_400_000;

export type ActivationState =
    /** Eligible, activated in the period */
    | "activated"
    /** Eligible, assigned before the period and not activated in it: the only warning */
    | "none"
    /** Eligible, not activated, assigned inside the period */
    | "new"
    /** Eligible, not activated, and the start of the assignment is missing or lies ahead: no verdict */
    | "unknown-start"
    /** Permanently or time-bound active */
    | "never-activates"
    /** A service principal or agent that is active */
    | "app"
    /** A group that holds the role actively: the activation is the membership of the group, which has its own rows */
    | "held-by-group"
    /** A group that is eligible for a role and has no members */
    | "no-members"
    /** Cannot be judged: the members could not be read, or the data is not what PIM allows */
    | "not-read"
    /** The members of a group are being read */
    | "loading";

/** The five groups of the sentence, the totals of the PDF and the `State` column */
export type StateGroup = "none" | "new" | "activated" | "na" | "notRead";

export function stateGroupOf(state: ActivationState): StateGroup {
    switch (state) {
        case "none":
            return "none";
        case "new":
            return "new";
        case "activated":
            return "activated";
        case "never-activates":
        case "app":
        case "held-by-group":
        case "no-members":
            return "na";
        default:
            // unknown-start, not-read and loading: not judged
            return "notRead";
    }
}

/** The words of the `State` column of the CSV and JSON */
export const STATE_GROUP_WORDS: Record<StateGroup, string> = {
    none: "no activation",
    new: "assigned during the period",
    activated: "activated",
    na: "does not activate",
    notRead: "not judged",
};

export type AssignmentTypeLabel = "Eligible" | "Permanently active" | "Active until";

export interface NoActivationRow {
    /** Stable key of the row */
    id: string;
    /** The schedule itself says memberType Group: the same access may also come from expanding the group */
    isGroupMemberEntry?: boolean;
    environment: "role" | "group";
    /** Role name, or `Member of {group}` / `Owner of {group}` */
    resourceName: string;
    /** Role definition id, or group id */
    resourceId: string;
    /** The name the Report shows for the scope; `Directory` for tenant-wide, and for a group */
    scopeName: string;
    /** The scope id, `/` for tenant-wide */
    scopeId: string;
    /** Azure only: the level of the scope, for the Scope level filter and the search */
    scopeLevel?: AzureScopeLevel;
    who: string;
    whoId: string;
    /** The group this person is a member of, when the role is eligible for that group: shown as `Through {group}` */
    viaGroup?: string;
    isPerson: boolean;
    /** What `who` is, for the Who filter: a member of a group is the person, and has `viaGroup` next to it */
    holderKind: AuditWhoChoice;
    /** The role is privileged, or the group holds a privileged role; null when that cannot be judged, which never reads as not privileged */
    isPrivileged: boolean | null;
    isEmergency: boolean;
    type: AssignmentTypeLabel;
    /** `Eligible`, `Permanently active` or `Active until {date}` */
    typeText: string;
    state: ActivationState;
    /** The Activation cell */
    activationText: string;
    /** Only `none` is a warning */
    isWarning: boolean;
    /** The members of this group could not be read (a row of the group, state `not-read`) */
    membersUnread?: boolean;
    /** Entra only: the roles the group holds, on the rows of its membership, so the search finds a person by the role they get through it */
    groupRoles?: readonly string[];
    /** ISO time of the last activation in the period */
    lastActivated?: string;
    /** ISO time the assignment started */
    assignedAt?: string;
    /** ISO time the assignment ends */
    endsAt?: string;
}

/** What is known of the members of one group the roles are eligible for */
export type GroupMembersLookup =
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; members: readonly { id: string; displayName: string; kind: PrincipalKind; userType?: string; userPrincipalName?: string }[] };

export interface NoActivationInput {
    roles: readonly RoleDetailData[];
    /** Left out (or empty) when PIM for Groups is not included */
    groups: readonly PimGroupData[];
    /** The audit events of the last read, whatever the period: they are cut to `days` here */
    events: readonly AuditEvent[];
    /** The period in days, from the URL, never the selection of the timeline */
    days: number;
    now: Date;
    emergencyIds?: ReadonlySet<string>;
    format?: AuditFormat;
    /** Members per group id (lower case) for the groups that are eligible for a role. A group not in it is not judged. */
    membership?: ReadonlyMap<string, GroupMembersLookup>;
}

export const TEXT_NONE = "None in this period";
export const TEXT_NEVER = "Not applicable: never activates";
export const TEXT_APP = "Not applicable: an app does not activate";
export const TEXT_AGENT = "Not applicable: an agent does not activate";
export const TEXT_HELD_BY_GROUP = "Not applicable: held by the group. Membership has its own rows when the group is under PIM.";
export const TEXT_NO_MEMBERS = "No members, so nobody can activate this";
export const TEXT_MEMBERS_UNREAD = "Members could not be read, so this is not judged";
export const TEXT_MEMBERS_LOADING = "Reading the members of this group";
export const TEXT_APP_ELIGIBLE = "An app cannot be eligible; check this assignment";
export const TEXT_AGENT_ELIGIBLE = "An agent cannot be eligible; check this assignment";
export const TEXT_NESTED_GROUP = "A group inside a group is not judged; check this assignment";
export const TEXT_SELECTION_IGNORED = "The selection does not apply to this view.";
const TEXT_PERIOD_NOTE = "This shows a role was not activated in the period, not that it can go: a role used once a quarter needs a longer period.";

export interface NoActivationCounts {
    total: number;
    none: number;
    new: number;
    activated: number;
    na: number;
    notRead: number;
}

/** The rows by group of state: the five parts always add up to `total`, the number of rows */
export function countNoActivation(rows: readonly NoActivationRow[]): NoActivationCounts {
    const counts: NoActivationCounts = { total: rows.length, none: 0, new: 0, activated: 0, na: 0, notRead: 0 };
    for (const row of rows) counts[stateGroupOf(row.state)]++;
    return counts;
}

/**
 * The sentence above the table, literal (AU-6b brief). It names every row: a part that is zero is left out, except no
 * activation.
 */
export function noActivationHonesty(counts: NoActivationCounts): string {
    const parts = [`${counts.none} with no activation`];
    if (counts.new > 0) parts.push(`${counts.new} assigned during the period`);
    if (counts.activated > 0) parts.push(`${counts.activated} activated`);
    if (counts.na > 0) parts.push(`${counts.na} that ${counts.na === 1 ? "does" : "do"} not activate`);
    if (counts.notRead > 0) parts.push(`${counts.notRead} not judged`);
    return `${counts.total} ${counts.total === 1 ? "assignment" : "assignments"}: ${parts.join(", ")}. ${TEXT_PERIOD_NOTE}`;
}

/** The reason when PIM for Groups was never consented; the export dialog tells it from a read that failed */
export const GROUPS_NOT_GRANTED_REASON = "read access to PIM for Groups has not been granted";

export function groupsNotIncludedText(reason: string): string {
    return `PIM for Groups is not included: ${reason}`;
}

export interface NoActivationLimitsInput {
    /** Why PIM for Groups is not included, or null when it is */
    groupsReason: string | null;
    /** The rows before the filters: a filter never hides a limit */
    rows: readonly NoActivationRow[];
    /** The oldest event the source gives, and the start of the period asked for */
    sourceFrom: Date;
    periodFrom: Date;
    format?: AuditFormat;
}

/**
 * Everything that limits the table, one line each with its reason (AU-6b brief 8): PIM for Groups not included, groups whose
 * members could not be read, and a source that reaches less than the period. The export carries the same lines.
 */
export function noActivationLimits({ groupsReason, rows, sourceFrom, periodFrom, format = {} }: NoActivationLimitsInput): string[] {
    const lines: string[] = [];
    if (groupsReason !== null) lines.push(`${groupsNotIncludedText(groupsReason)}.`);
    const unread = [...new Set(rows.filter((row) => row.membersUnread).map((row) => row.who))].sort((a, b) => a.localeCompare(b));
    if (unread.length > 0) lines.push(`The members of ${unread.length === 1 ? "this group" : "these groups"} could not be read, so their rows are not judged: ${unread.join(", ")}.`);
    if (sourceFrom.getTime() > periodFrom.getTime()) {
        lines.push(`The audit log reaches back to ${formatAuditDate(sourceFrom, format)}, less than the period chosen, so an activation before that is not in the data.`);
    }
    return lines;
}

// Activations ----------------------------------------------------------------------------------------------------------

type Access = GroupAccessType | "unknown";

/**
 * The access of a group event. The model keeps it only in the role name (`member of {group}`, `owner of {group}`); when the
 * log gave no such label it stays unknown.
 */
export function accessOfEvent(event: AuditEvent): Access {
    const name = event.role.name.trim().toLowerCase();
    if (name.startsWith("member of ")) return "member";
    if (name.startsWith("owner of ")) return "owner";
    return "unknown";
}

/** The name of the group of a group event, without the access in its label */
export function groupNameOfEvent(event: AuditEvent): string {
    return event.role.name.trim().replace(/^(member|owner) of /i, "").trim();
}

/** The person of an event: the target, else the actor when the actor is a person */
function personOf(event: AuditEvent): string {
    const target = event.target?.id.trim() ?? "";
    if (target !== "") return target.toLowerCase();
    return event.actor.kind === "person" ? event.actor.id.trim().toLowerCase() : "";
}

/** A scope id as compared: no case, and an empty one is tenant-wide, the same as `/` */
export function normalizeScopeId(value: string | undefined | null): string {
    const clean = (value ?? "").trim().toLowerCase();
    return clean === "" ? "/" : clean;
}

const roleKey = (roleId: string, personId: string, scopeId: string) => `r|${roleId.toLowerCase()}|${personId.toLowerCase()}|${normalizeScopeId(scopeId)}`;
const groupKey = (groupId: string, access: GroupAccessType, personId: string) => `g|${groupId.toLowerCase()}|${access}|${personId.toLowerCase()}`;

/**
 * The time (ms) of the last completed activation per person, role and scope, or per person, group and access, inside the
 * period. A failed activation, a request without a completion and an event outside the period do not count. A group event
 * whose access is unknown counts for both member and owner: not to say "unused" where the log is silent. An event without
 * a scope in the log is tenant-wide.
 */
export function indexActivations(events: readonly AuditEvent[], cutoffMs: number, nowMs: number): Map<string, number> {
    const last = new Map<string, number>();
    const put = (key: string, time: number) => {
        if (time > (last.get(key) ?? -Infinity)) last.set(key, time);
    };
    for (const event of events) {
        if (event.kind !== "usage" || event.result !== "success" || event.requestOnly) continue;
        const time = Date.parse(event.time);
        if (!Number.isFinite(time) || time < cutoffMs || time > nowMs) continue;
        const person = personOf(event);
        const resource = event.role.id.trim();
        if (person === "" || resource === "") continue;
        if (event.environment === "role") {
            put(roleKey(resource, person, event.directoryScopeId ?? "/"), time);
        } else {
            const access = accessOfEvent(event);
            for (const side of access === "unknown" ? (["member", "owner"] as const) : [access]) put(groupKey(resource, side, person), time);
        }
    }
    return last;
}

// Rows -----------------------------------------------------------------------------------------------------------------

interface Judgement {
    state: ActivationState;
    activationText: string;
    lastActivated?: string;
}

export interface JudgeContext {
    cutoffMs: number;
    nowMs: number;
    format: AuditFormat;
}

export function dateOf(value: string | null | undefined): number {
    return value ? Date.parse(value) : Number.NaN;
}

/** The verdict for an eligible assignment of a person */
export function judgeEligible(lastMs: number | undefined, startIso: string | undefined, ctx: JudgeContext): Judgement {
    if (lastMs !== undefined) {
        return { state: "activated", activationText: `Last activated ${formatAuditDate(lastMs, ctx.format)}`, lastActivated: new Date(lastMs).toISOString() };
    }
    const start = dateOf(startIso);
    // No start: the assignment cannot be placed against the period, so no verdict and no warning
    if (!Number.isFinite(start)) return { state: "unknown-start", activationText: `${TEXT_NONE}; start date not known` };
    // A start still ahead: it has not had any of the period
    if (start > ctx.nowMs) return { state: "unknown-start", activationText: `Starts ${formatAuditDate(start, ctx.format)}` };
    // Assigned after the start of the period: it had less than the period to be used. Exactly at the start it had all of it.
    if (start > ctx.cutoffMs) {
        const ago = Math.floor((ctx.nowMs - start) / DAY_MS);
        return { state: "new", activationText: ago === 0 ? `${TEXT_NONE}; assigned today` : `${TEXT_NONE}; assigned ${ago} ${ago === 1 ? "day" : "days"} ago` };
    }
    return { state: "none", activationText: TEXT_NONE };
}

interface PrincipalLike {
    "@odata.type"?: string;
    servicePrincipalType?: string | null;
}

type Who = "person" | "group" | "app";

/** `userType` when it is read, else the principal name */
export function isGuestHolder(userType: string | undefined, upn: string | undefined): boolean {
    return userType ? isGuestUserType(userType) : isGuestUpn(upn);
}

function whoKind(principal: PrincipalLike | undefined, fallback: PrincipalKind | undefined): Who {
    const kind = getPrincipalKind(principal);
    const basic = toBasicKind(kind === "unknown" && fallback ? fallback : kind);
    if (basic === "group") return "group";
    if (basic === "servicePrincipal") return "app";
    // A principal of unknown kind is taken for a person
    return "person";
}

export function endText(endIso: string | undefined, format: AuditFormat): string {
    const text = endIso ? formatAuditDate(endIso, format) : "";
    return text ? `Active until ${text}` : "Active until";
}

export const iso = (value: string | null | undefined): string | undefined => {
    const ms = dateOf(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
};

/** The name of a scope as the Report shows it (`scopeInfo`, else the id); tenant-wide is `Directory` */
function scopeNameOf(item: { directoryScopeId?: string; scopeInfo?: { displayName?: string } }): string {
    if (normalizeScopeId(item.directoryScopeId) === "/") return "Directory";
    return item.scopeInfo?.displayName || item.directoryScopeId || "Directory";
}

/** An active assignment never activates; a group holding it and an app have their own wording */
function fixedJudgement(kind: Who, isAgent: boolean): Pick<Judgement, "state" | "activationText"> {
    if (kind === "app") return { state: "app", activationText: isAgent ? TEXT_AGENT : TEXT_APP };
    if (kind === "group") return { state: "held-by-group", activationText: TEXT_HELD_BY_GROUP };
    return { state: "never-activates", activationText: TEXT_NEVER };
}

interface Who3 {
    who: string;
    whoId: string;
    isEmergency: boolean;
    kind: Who;
    /** An agent identity, blueprint or agent user: judged as the app or person it is, filtered under Agents */
    isAgent: boolean;
    /** A person from outside the tenant */
    isGuest: boolean;
}

type Common = Pick<NoActivationRow, "environment" | "resourceName" | "resourceId" | "scopeName" | "scopeId" | "isPrivileged" | "groupRoles">;

/** The names of the Entra roles each group holds actively or permanently, by lower case group id */
export function roleNamesByGroup(roles: readonly RoleDetailData[]): Map<string, string[]> {
    const byGroup = new Map<string, Set<string>>();
    for (const role of roles) {
        for (const item of [...role.assignments.active, ...role.assignments.permanent]) {
            if (getPrincipalKind(item.principal) !== "group") continue;
            const id = item.principalId.toLowerCase();
            const names = byGroup.get(id) ?? new Set<string>();
            names.add(role.definition.displayName);
            byGroup.set(id, names);
        }
    }
    return new Map([...byGroup].map(([id, names]) => [id, [...names].sort((a, b) => a.localeCompare(b))]));
}
type Pushed = Omit<NoActivationRow, "id" | "isWarning" | "typeText" | "isPerson" | "holderKind" | "isEmergency" | "who" | "whoId" | "typeText"> & { typeText?: string };

/**
 * One row per assignment of a person to a role, and to the member or owner access of a group; nothing is left out. An
 * eligible group gives one row per member (judged like any eligible person), a group that holds a role actively and an
 * app have their own wording. Activations of an eligibility (active, activated) are not assignments and are left out.
 * Sorted: warnings first, then assigned inside the period, then activated (oldest activation first), then not applicable;
 * within those by role name, then person.
 */
export function buildNoActivationRows({ roles, groups, events, days, now, emergencyIds, format = {}, membership }: NoActivationInput): NoActivationRow[] {
    const nowMs = now.getTime();
    const ctx: JudgeContext = { cutoffMs: nowMs - days * DAY_MS, nowMs, format };
    const last = indexActivations(events, ctx.cutoffMs, nowMs);
    const kindById = buildKindById([...roles]);
    const nameById = buildNameById([...roles]);
    const privilege = buildAuditPrivilege(roles);
    const rows: NoActivationRow[] = [];

    const person = (principalId: string, principal: (PrincipalLike & { displayName?: string; userPrincipalName?: string }) | undefined, userType?: string): Who3 => {
        const id = principalId.toLowerCase();
        return {
            who: principal?.displayName || nameById.get(id) || principalId,
            whoId: principalId,
            isEmergency: emergencyIds?.has(id) ?? false,
            kind: whoKind(principal, kindById.get(principalId)),
            isAgent: isAgentKind(getPrincipalKind(principal) === "unknown" ? kindById.get(principalId) ?? "unknown" : getPrincipalKind(principal)),
            isGuest: isGuestHolder(userType, principal?.userPrincipalName),
        };
    };

    const push = (who: Who3, row: Pushed, key: string, isPerson = who.kind === "person") => {
        rows.push({ who: who.who, whoId: who.whoId, isPerson, holderKind: who.isAgent ? "agent" : who.kind === "person" ? (who.isGuest ? "guest" : "user") : who.kind, isEmergency: who.isEmergency, ...row, id: key, typeText: row.typeText ?? row.type, isWarning: row.state === "none" });
    };

    /** The rows of an eligible group: one per member, or the one row that says why there is none */
    const expandGroup = (group: Who3, common: Common, base: Pick<NoActivationRow, "type" | "assignedAt" | "endsAt">, key: string, lastFor: (personId: string) => number | undefined, startIso: string | undefined) => {
        const entry = membership?.get(group.whoId.toLowerCase());
        if (entry?.status === "loading") {
            push(group, { ...common, ...base, state: "loading", activationText: TEXT_MEMBERS_LOADING }, key, false);
            return;
        }
        if (!entry || entry.status === "error") {
            push(group, { ...common, ...base, state: "not-read", activationText: TEXT_MEMBERS_UNREAD, membersUnread: true }, key, false);
            return;
        }
        if (entry.members.length === 0) {
            push(group, { ...common, ...base, state: "no-members", activationText: TEXT_NO_MEMBERS }, key, false);
            return;
        }
        for (const member of entry.members) {
            const basic = toBasicKind(member.kind);
            const kind: Who = basic === "servicePrincipal" ? "app" : basic === "group" ? "group" : "person";
            const memberWho: Who3 = { who: member.displayName || member.id, whoId: member.id, isEmergency: emergencyIds?.has(member.id.toLowerCase()) ?? false, kind, isAgent: isAgentKind(member.kind), isGuest: isGuestHolder(member.userType, member.userPrincipalName) };
            const memberKey = `${key}|member|${member.id}`;
            const via = { ...common, ...base, viaGroup: group.who };
            if (kind === "app") push(memberWho, { ...via, state: "app", activationText: memberWho.isAgent ? TEXT_AGENT : TEXT_APP }, memberKey);
            else if (kind === "group") push(memberWho, { ...via, state: "not-read", activationText: TEXT_NESTED_GROUP }, memberKey);
            else push(memberWho, { ...via, ...judgeEligible(lastFor(member.id.toLowerCase()), startIso, ctx) }, memberKey);
        }
    };

    for (const role of roles) {
        const definition = role.definition;
        const ids = [definition.id, definition.templateId].filter((id): id is string => !!id);
        const lastFor = (personId: string, scopeId: string): number | undefined => {
            const found = ids.map((id) => last.get(roleKey(id, personId, scopeId))).filter((time): time is number => time !== undefined);
            return found.length > 0 ? Math.max(...found) : undefined;
        };
        const roleCommon = (item: { directoryScopeId?: string; scopeInfo?: { displayName?: string } }): Common => ({
            environment: "role",
            resourceName: definition.displayName,
            resourceId: definition.id,
            scopeName: scopeNameOf(item),
            scopeId: normalizeScopeId(item.directoryScopeId),
            isPrivileged: definition.isPrivileged ?? null,
        });

        role.assignments.eligible.forEach((item: PimEligibilitySchedule, index) => {
            const who = person(item.principalId, item.principal, item.principalUserType);
            const startIso = iso(item.scheduleInfo?.startDateTime) ?? iso(item.createdDateTime);
            const common = roleCommon(item);
            const base = { type: "Eligible" as const, assignedAt: startIso, endsAt: iso(item.scheduleInfo?.expiration?.endDateTime) };
            const key = `role|${definition.id}|eligible|${item.id || index}`;
            if (who.kind === "app") push(who, { ...common, ...base, state: "not-read", activationText: who.isAgent ? TEXT_AGENT_ELIGIBLE : TEXT_APP_ELIGIBLE }, key);
            else if (who.kind === "group") expandGroup(who, common, base, key, (personId) => lastFor(personId, common.scopeId), startIso);
            else push(who, { ...common, ...base, ...(item.memberType?.toLowerCase() === "group" ? { isGroupMemberEntry: true } : {}), ...judgeEligible(lastFor(who.whoId.toLowerCase(), common.scopeId), startIso, ctx) }, key);
        });

        const activeRow = (item: PimAssignmentSchedule | RoleAssignment, startIso: string | undefined, endIso: string | undefined, noEnd: boolean, key: string) => {
            const who = person(item.principalId, item.principal, item.principalUserType);
            const type: AssignmentTypeLabel = noEnd ? "Permanently active" : "Active until";
            push(who, { ...roleCommon(item), type, typeText: type === "Active until" ? endText(endIso, format) : type, assignedAt: startIso, endsAt: noEnd ? undefined : endIso, ...fixedJudgement(who.kind, who.isAgent) }, key);
        };
        role.assignments.active.forEach((item, index) => {
            // An activation of an eligibility is the event this view looks for, not an assignment
            if (isActivated(item)) return;
            activeRow(item, iso(item.scheduleInfo?.startDateTime) ?? iso(item.createdDateTime), iso(item.scheduleInfo?.expiration?.endDateTime), hasNoEnd(item), `role|${definition.id}|active|${item.id || index}`);
        });
        // Role assignments no active schedule covers: standing access the schedules miss
        getUnscheduledRoleAssignments(role.assignments).forEach((item, index) => {
            activeRow(item, iso(item.createdDateTime), undefined, true, `role|${definition.id}|permanent|${item.id || index}`);
        });
    }

    const rolesOfGroup = roleNamesByGroup(roles);
    for (const data of groups) {
        for (const [index, a] of data.assignments.entries()) {
            const who = person(a.principalId, a.principal, a.principalUserType);
            const access = a.accessType === "owner" ? "Owner" : "Member";
            const common: Common = { environment: "group", resourceName: `${access} of ${data.group.displayName}`, resourceId: data.group.id, scopeName: "Directory", scopeId: "/", isPrivileged: judgeGroupPrivilege(data.group.id, privilege) };
            const heldRoles = a.accessType === "owner" ? undefined : rolesOfGroup.get(data.group.id.toLowerCase());
            if (heldRoles) common.groupRoles = heldRoles;
            const startIso = iso(a.startDateTime) ?? iso(a.scheduleInfo?.startDateTime) ?? iso(a.createdDateTime);
            const endIso = iso(a.endDateTime) ?? iso(a.scheduleInfo?.expiration?.endDateTime);
            const key = `group|${data.group.id}|${a.accessType}|${a.assignmentType}|${a.id || index}`;
            if (a.assignmentType === "eligible") {
                const base = { type: "Eligible" as const, assignedAt: startIso, endsAt: endIso };
                const lastFor = (personId: string) => last.get(groupKey(data.group.id, a.accessType, personId));
                if (who.kind === "app") push(who, { ...common, ...base, state: "not-read", activationText: who.isAgent ? TEXT_AGENT_ELIGIBLE : TEXT_APP_ELIGIBLE }, key);
                else if (who.kind === "group") expandGroup(who, common, base, key, lastFor, startIso);
                else push(who, { ...common, ...base, ...judgeEligible(lastFor(who.whoId.toLowerCase()), startIso, ctx) }, key);
                continue;
            }
            // An instance made by activating an eligibility is the event, not an assignment
            if (a.assignmentType === "active" && a.assignmentOrigin === "activated") continue;
            const noEnd = a.assignmentType === "permanent" || !endIso;
            const type: AssignmentTypeLabel = noEnd ? "Permanently active" : "Active until";
            push(who, { ...common, type, typeText: type === "Active until" ? endText(endIso, format) : type, assignedAt: startIso, endsAt: noEnd ? undefined : endIso, ...fixedJudgement(who.kind, who.isAgent) }, key);
        }
    }
    return sortNoActivationRows(withoutDuplicates(rows));
}

/**
 * One row per way a person holds a role. A list of instances can name a member of a group with memberType Group as well,
 * next to the row expanded from the group: that row has no group to name, so the expanded one stays.
 */
function withoutDuplicates(rows: readonly NoActivationRow[]): NoActivationRow[] {
    const place = (row: NoActivationRow) => [row.environment, row.resourceId, row.resourceName, row.scopeId, row.whoId].join("|").toLowerCase();
    const expanded = new Set(rows.filter((row) => row.viaGroup).map(place));
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (row.isGroupMemberEntry && expanded.has(place(row))) return false;
        const key = `${place(row)}|${row.viaGroup ?? ""}|${row.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function rankOf(row: NoActivationRow): number {
    if (row.state === "none") return 0;
    const group = stateGroupOf(row.state);
    if (group === "new" || group === "notRead") return 1;
    if (group === "activated") return 2;
    return 3;
}

/** Warnings, assigned inside the period and not judged, activated (oldest activation first), not applicable; then role name, scope, person */
export function sortNoActivationRows(rows: readonly NoActivationRow[]): NoActivationRow[] {
    return [...rows].sort((a, b) => {
        const rank = rankOf(a) - rankOf(b);
        if (rank !== 0) return rank;
        if (a.state === "activated" && b.state === "activated") {
            const byTime = Date.parse(a.lastActivated ?? "") - Date.parse(b.lastActivated ?? "");
            if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
        }
        return a.resourceName.localeCompare(b.resourceName) || a.scopeName.localeCompare(b.scopeName) || a.who.localeCompare(b.who) || a.id.localeCompare(b.id);
    });
}

/** The ids of the groups that are eligible for a role or for the access of a group: the members to read (lower case, once) */
export function eligibleGroupIds(roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): string[] {
    const kindById = buildKindById([...roles]);
    const ids = new Set<string>();
    const add = (principalId: string, principal: PrincipalLike | undefined) => {
        if (whoKind(principal, kindById.get(principalId)) === "group") ids.add(principalId.toLowerCase());
    };
    for (const role of roles) for (const item of role.assignments.eligible) add(item.principalId, item.principal);
    for (const data of groups) for (const a of data.assignments) if (a.assignmentType === "eligible") add(a.principalId, a.principal);
    return [...ids];
}

// Filters --------------------------------------------------------------------------------------------------------------

function matchesWho(row: NoActivationRow, who: AuditWhoChoice): boolean {
    // A person through a group counts for the person and for the group, as in Events (Joël, 2026-11-06 and 2026-11-07)
    if (who === "group") return row.holderKind === "group" || row.viaGroup !== undefined || row.environment === "group";
    return row.holderKind === who;
}

export interface NoActivationFilters {
    who?: AuditWhoChoice;
    /** Leaves out what is known not to be privileged; what cannot be judged stays */
    isPrivilegedOnly?: boolean;
    /** Azure only: keeps the rows of this scope level */
    level?: AzureScopeLevel;
}

/** The environment, Who, Privileged only and the search (role, group, the roles a group holds and person; for an emergency access account also those words) */
export function filterNoActivationRows(rows: readonly NoActivationRow[], env: AuditEnvChoice, query: string, { who, isPrivilegedOnly = false, level }: NoActivationFilters = {}): NoActivationRow[] {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
        if (env !== "both" && row.environment !== env) return false;
        if (who && !matchesWho(row, who)) return false;
        if (isPrivilegedOnly && row.isPrivileged === false) return false;
        if (level && row.scopeLevel !== level) return false;
        if (term === "") return true;
        return [row.resourceName, row.who, row.viaGroup ?? "", ...(row.groupRoles ?? []), row.isEmergency ? "Emergency access" : "", row.scopeLevel ? row.scopeName : ""].some((text) => text.toLowerCase().includes(term));
    });
}
