import type { AuditEvent, AzureEntraLogState } from "@/types/audit.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import {
    TEXT_AGENT,
    TEXT_AGENT_ELIGIBLE,
    TEXT_APP,
    TEXT_APP_ELIGIBLE,
    TEXT_MEMBERS_LOADING,
    TEXT_MEMBERS_UNREAD,
    TEXT_NESTED_GROUP,
    TEXT_NEVER,
    TEXT_NO_MEMBERS,
    endText,
    iso,
    isGuestHolder,
    judgeEligible,
    sortNoActivationRows,
    type AssignmentTypeLabel,
    type GroupMembersLookup,
    type JudgeContext,
    type NoActivationRow,
} from "@/utils/auditNoActivation";
import type { AuditPrivilege } from "@/utils/auditPrivilege";
import type { AuditFormat } from "@/utils/auditView";
import type { AuditWhoChoice } from "@/utils/auditUrlState";
import { isAtOrBelow } from "@/utils/azureDashboardView";
import { levelFromScopeId } from "@/utils/azureScopes";
import { isGuestUpn } from "@/utils/holderKinds";
import { getPrincipalKind, isAgentKind, toBasicKind, type PrincipalKind } from "@/utils/principalUtils";
import { formatAuditDate } from "@/utils/auditView";

/**
 * The No activation view of the Azure Audit page (implementation spec section 6): per eligible or active assignment of a
 * person, app or group to an Azure role on a scope, whether it was activated in the period. Pure: no ARM, no state. It
 * shares the judging, the texts, the sorting and the filters of `auditNoActivation.ts`.
 *
 * The same care applies as there: someone may remove a role because of this table, so an activation counts when the log
 * shows it done for the same role and person on the assignment's scope or below it (an activation on a narrower scope
 * counts and names that scope), an assignment younger than the period is not a warning, and anything that cannot be judged
 * says so. Every assignment is a row, once by id.
 */

const TEXT_GROUP_HOLDS = "Not applicable: held by the group, which has no eligible members in PIM for Groups";
const TEXT_GROUP_NOT_IN_PIM = "Not applicable: held by a group that is not in PIM for Groups";
const TEXT_ENTRA_LOG_MISSING = "The Entra audit log is not included, so who activates membership of the group is not judged";
const TEXT_GROUPS_MISSING = "PIM for Groups is not included, so who activates membership of the group is not judged";
/** The text of a member whose activation may be older than the Entra audit log reaches: the number is the reach of this read */
const beyondLogText = (entraLogDays: number) => `Not judged: the Entra audit log reaches back ${entraLogDays} days and this period is longer`;
/** The text of an eligibility on a scope whose log or request list could not be read: an activation there would not be seen */
const TEXT_SCOPE_UNREAD = "Not judged: the activity of this scope could not be read";
/** How far back the Entra audit log reaches when no workspace holds it, which the group activations come from */
const ENTRA_LOG_DAYS = 30;

export interface AzureNoActivationInput {
    assignments: readonly AzureAssignment[];
    /** The events of the last read (the Azure log, requests and group rows), cut to `days` here */
    events: readonly AuditEvent[];
    scopes: readonly AzureScope[];
    days: number;
    now: Date;
    emergencyIds?: ReadonlySet<string>;
    format?: AuditFormat;
    /** The kind of each app or agent by lower case id, as the events use it */
    holderKinds?: ReadonlyMap<string, PrincipalKind>;
    /** What Privileged only judges by; without it every row cannot be judged (null) */
    privilege?: AuditPrivilege | null;
    /** Members per group id (lower case) for the groups an assignment is eligible for. A group not in it is not judged. */
    membership?: ReadonlyMap<string, GroupMembersLookup>;
    /** PIM for Groups, for who may activate membership of a group that holds a role actively; null when it is not read */
    pimGroups?: readonly PimGroupData[] | null;
    /** How the read of the Entra audit log went: the group activations come from it */
    entraLog?: AzureEntraLogState | null;
    /** How far back the Entra audit log reaches in this read: 30 days, or more with a workspace that holds it (default 30) */
    entraLogDays?: number;
    /**
     * The scopes whose log or request list could not be read. An eligibility at or below one of them, with no activation
     * found, is not judged: the read is silent there, so "none" would rest on nothing (AU-17, P12).
     */
    unreadScopeIds?: readonly string[];
}

interface Activation {
    timeMs: number;
    scopeId: string;
    scopeName: string;
    /** The eligibility the activation used, when the request names it */
    eligibilityId?: string;
}

type HolderKind = "person" | "group" | "app";

const GROUP_TYPES = new Set(["group", "foreigngroup", "groupsecuritynotenabled"]);
const AGENT_TYPES = new Set(["agentidentity", "agentuser", "agentserviceprincipal"]);
const APP_TYPES = new Set(["serviceprincipal", ...AGENT_TYPES]);

function holderOf(principalType: string): HolderKind {
    const type = principalType.trim().toLowerCase();
    if (GROUP_TYPES.has(type)) return "group";
    if (APP_TYPES.has(type)) return "app";
    return "person";
}

const scopeKey = (scopeId: string): string => scopeId.trim().toLowerCase().replace(/\/+$/, "");
const eligibilityIdOf = (id: string): string => id.split("/").filter((part) => part !== "").pop()?.toLowerCase() ?? "";

/** True when `scopeId` is the assignment's scope or below it: through the tree when it knows both, else by path */
function isAtOrBelowScope(scopeId: string, assignmentScopeId: string, byId: ReadonlyMap<string, AzureScope>): boolean {
    const child = scopeKey(scopeId);
    const parent = scopeKey(assignmentScopeId);
    if (parent === "" || parent === "/") return true;
    if (child === parent || child.startsWith(`${parent}/`)) return true;
    return isAtOrBelow(child, parent, byId);
}

/** The id of the person of an event: the target, else the actor when a person */
function personOf(event: AuditEvent): string {
    const target = event.target?.id.trim() ?? "";
    if (target !== "") return target.toLowerCase();
    return event.actor.kind === "person" ? event.actor.id.trim().toLowerCase() : "";
}

/**
 * The completed activations per role and person inside the period: a failed one, a request without a completion, and one
 * outside the period do not count. Only a row with a scope of the tree can be matched to an assignment.
 */
function indexActivations(events: readonly AuditEvent[], cutoffMs: number, nowMs: number, environment: "role" | "group" = "role"): Map<string, Activation[]> {
    const byRolePerson = new Map<string, Activation[]>();
    for (const event of events) {
        if (event.kind !== "usage" || event.environment !== environment || event.result !== "success" || event.requestOnly) continue;
        if (!event.azure) continue;
        const time = Date.parse(event.time);
        if (!Number.isFinite(time) || time < cutoffMs || time > nowMs) continue;
        const person = personOf(event);
        const role = event.role.id.trim().toLowerCase();
        if (person === "" || role === "") continue;
        const key = `${role}|${person}`;
        const list = byRolePerson.get(key) ?? [];
        list.push({ timeMs: time, scopeId: event.azure.scopeId, scopeName: event.azure.scopeName, eligibilityId: event.eligibilityId });
        byRolePerson.set(key, list);
    }
    return byRolePerson;
}

/** The ids of the groups an assignment is eligible for: the members to read (lower case, once) */
export function azureEligibleGroupIds(assignments: readonly AzureAssignment[]): string[] {
    const ids = new Set<string>();
    for (const item of assignments) {
        if (item.state === "eligible" && holderOf(item.principalType) === "group") ids.add(item.principalId.toLowerCase());
    }
    return [...ids];
}

/**
 * One row per eligible or active assignment, once by id; nothing is left out. An eligible group gives one row per member
 * (judged like any eligible person), or the one row that says why there is none. An active assignment never activates, and a
 * group that holds a role actively and an app have their own wording. An instance made by an activation is the event this
 * view looks for, not an assignment, and is left out. Sorted like the Entra view.
 */
export function buildAzureNoActivationRows({ assignments, events, scopes, days, now, emergencyIds, format = {}, holderKinds, privilege, membership, pimGroups, entraLog, entraLogDays = ENTRA_LOG_DAYS, unreadScopeIds = [] }: AzureNoActivationInput): NoActivationRow[] {
    const nowMs = now.getTime();
    const ctx: JudgeContext = { cutoffMs: nowMs - days * 86_400_000, nowMs, format };
    const activations = indexActivations(events, ctx.cutoffMs, nowMs);
    const groupActivations = indexActivations(events, ctx.cutoffMs, nowMs, "group");
    const byId = new Map(scopes.map((scope) => [scope.id.toLowerCase(), scope]));
    // The root has the id `/`, which `scopeKey` leaves empty
    const nameOfScope = (scopeId: string): string => byId.get(scopeId.trim().toLowerCase())?.name || byId.get(scopeKey(scopeId))?.name || (scopeId.trim() === "/" ? "Root" : scopeId);
    const rows: NoActivationRow[] = [];
    const seen = new Set<string>();
    const eligibilityIds = new Set(assignments.filter((item) => item.state === "eligible").map((item) => eligibilityIdOf(item.id)));

    const lastFor = (item: AzureAssignment, personId: string, index = activations): Activation | undefined => {
        const found = (index.get(`${item.roleDefinitionId.toLowerCase()}|${personId.toLowerCase()}`) ?? [])
            .filter((activation) => {
                // An activation that names an eligibility we have counts for that one only: a direct role and the same role through a group are two ways in (spec section 6)
                if (activation.eligibilityId && eligibilityIds.has(activation.eligibilityId)) return activation.eligibilityId === eligibilityIdOf(item.id);
                return isAtOrBelowScope(activation.scopeId, item.scopeId, byId);
            });
        return found.reduce<Activation | undefined>((best, activation) => (best === undefined || activation.timeMs > best.timeMs ? activation : best), undefined);
    };

    const judgeFound = (item: AzureAssignment, startIso: string | undefined, found: Activation | undefined) => {
        const verdict = judgeEligible(found?.timeMs, startIso, ctx);
        // An activation on a narrower scope counts, and says where it was
        if (found && verdict.state === "activated" && scopeKey(found.scopeId) !== scopeKey(item.scopeId)) {
            return { ...verdict, activationText: `Last activated ${formatAuditDate(found.timeMs, format)} on ${found.scopeName}` };
        }
        return verdict;
    };

    // An eligibility on an unread scope: an activation found elsewhere still counts, its absence says nothing
    const isUnreadScope = (scopeId: string) => unreadScopeIds.some((unread) => isAtOrBelowScope(scopeId, unread, byId));
    const judgeOrUnread = (item: AzureAssignment, startIso: string | undefined, found: Activation | undefined) =>
        !found && isUnreadScope(item.scopeId) ? { state: "not-read" as const, activationText: TEXT_SCOPE_UNREAD } : judgeFound(item, startIso, found);

    // An extension replaces the eligibility schedule and starts it anew (measured, AU-17): its start then says nothing about
    // when the eligibility was given. The admin requests per role, person and scope tell it (F17).
    const adminRequests = new Map<string, { timeMs: number; typeLc: string }[]>();
    for (const event of events) {
        if (event.kind !== "assignment" || event.result !== "success" || !event.requestType || !event.azure) continue;
        const time = Date.parse(event.time);
        const person = personOf(event);
        if (!Number.isFinite(time) || person === "") continue;
        const key = `${event.role.id.trim().toLowerCase()}|${person}|${scopeKey(event.azure.scopeId)}`;
        const list = adminRequests.get(key) ?? [];
        list.push({ timeMs: time, typeLc: event.requestType.toLowerCase() });
        adminRequests.set(key, list);
    }
    const EXTENSION_WINDOW_MS = 120_000;
    /** The start to judge an eligibility by: its own, or, when an extension made it, the assignment in the period or a time before the period */
    const startOfEligibility = (item: AzureAssignment, personId: string, startIso: string | undefined): string | undefined => {
        const startMs = startIso ? Date.parse(startIso) : Number.NaN;
        if (!Number.isFinite(startMs)) return startIso;
        const requests = adminRequests.get(`${item.roleDefinitionId.trim().toLowerCase()}|${personId.toLowerCase()}|${scopeKey(item.scopeId)}`) ?? [];
        const extended = requests.some((request) => request.typeLc === "adminextend" && Math.abs(request.timeMs - startMs) <= EXTENSION_WINDOW_MS);
        if (!extended) return startIso;
        const assigned = requests.filter((request) => request.typeLc === "adminassign" && request.timeMs >= ctx.cutoffMs && request.timeMs <= startMs).sort((a, b) => a.timeMs - b.timeMs)[0];
        return new Date(assigned ? assigned.timeMs : ctx.cutoffMs - 86_400_000).toISOString();
    };

    const isEmergency = (id: string) => emergencyIds?.has(id.toLowerCase()) ?? false;
    const agentKind = (id: string, type: string): boolean => AGENT_TYPES.has(type.trim().toLowerCase()) || (holderOf(type) === "app" && isAgentKind(holderKinds?.get(id.toLowerCase()) ?? "unknown"));
    const holderKindOf = (kind: HolderKind, isAgent: boolean, isGuest: boolean): AuditWhoChoice => (isAgent ? "agent" : kind === "person" ? (isGuest ? "guest" : "user") : kind);

    for (const item of assignments) {
        // An instance made by an activation is the event, not an assignment
        if (item.state === "active" && item.isActivated) continue;
        const id = item.id.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);

        const holder = holderOf(item.principalType);
        const isAgent = agentKind(item.principalId, item.principalType);
        const level = levelFromScopeId(item.scopeId) ?? undefined;
        const isPrivileged = privilege ? privilege.byRoleId.get(item.roleDefinitionId.toLowerCase()) ?? null : null;
        const startIso = iso(item.startDateTime);
        const endIso = iso(item.endDateTime);
        const common = {
            environment: "role" as const,
            resourceName: item.roleName,
            resourceId: item.roleDefinitionId,
            scopeName: nameOfScope(item.scopeId),
            scopeId: item.scopeId,
            scopeLevel: level,
            isPrivileged,
            assignedAt: startIso,
        };

        const push = (row: Omit<NoActivationRow, "id" | "isWarning" | "typeText" | "isPerson" | "holderKind" | "isEmergency" | "who" | "whoId" | "typeText"> & { typeText?: string }, who: { name: string; id: string; kind: HolderKind; isAgent: boolean; isGuest: boolean }, key: string) => {
            rows.push({
                who: who.name,
                whoId: who.id,
                isPerson: who.kind === "person",
                holderKind: holderKindOf(who.kind, who.isAgent, who.isGuest),
                isEmergency: isEmergency(who.id),
                ...row,
                id: key,
                typeText: row.typeText ?? row.type,
                isWarning: row.state === "none",
            });
        };

        const principal = {
            name: item.principalName || item.principalId,
            id: item.principalId,
            kind: holder,
            isAgent,
            isGuest: holder === "person" && isGuestUpn(item.principalUpn),
        };
        const key = `azure|${id}`;

        if (item.state === "active") {
            const noEnd = endIso === undefined;
            const type: AssignmentTypeLabel = noEnd ? "Permanently active" : "Active until";
            const own = { ...common, type, typeText: noEnd ? type : endText(endIso, format), endsAt: endIso };
            if (holder === "group") {
                const pim = pimGroups?.find((data) => data.group.id.toLowerCase() === item.principalId.toLowerCase());
                const eligible = pim?.assignments.filter((a) => a.assignmentType === "eligible" && a.accessType === "member") ?? [];
                let single: { state: "not-read" | "held-by-group"; activationText: string } | undefined;
                if (entraLog !== "read") single = { state: "not-read", activationText: TEXT_ENTRA_LOG_MISSING };
                else if (!pimGroups) single = { state: "not-read", activationText: TEXT_GROUPS_MISSING };
                else if (!pim) single = { state: "held-by-group", activationText: TEXT_GROUP_NOT_IN_PIM };
                else if (eligible.length === 0) single = { state: "held-by-group", activationText: TEXT_GROUP_HOLDS };
                if (single) {
                    push({ ...own, ...single }, principal, key);
                    continue;
                }
                // One row per member who is eligible for the group, judged by the activations of the group
                for (const member of eligible) {
                    const rawKind: PrincipalKind = member.principal ? getPrincipalKind(member.principal) : "unknown";
                    const kind = toBasicKind(rawKind);
                    const memberKind: HolderKind = kind === "servicePrincipal" ? "app" : kind === "group" ? "group" : "person";
                    const who = { name: member.principal?.displayName || member.principalId, id: member.principalId, kind: memberKind, isAgent: isAgentKind(rawKind), isGuest: memberKind === "person" && isGuestHolder(member.principalUserType, member.principal?.userPrincipalName) };
                    const via = { ...own, viaGroup: principal.name };
                    const memberKey = `${key}|member|${member.principalId.toLowerCase()}`;
                    if (memberKind === "app") push({ ...via, state: "app", activationText: who.isAgent ? TEXT_AGENT : TEXT_APP }, who, memberKey);
                    else if (memberKind === "group") push({ ...via, state: "not-read", activationText: TEXT_NESTED_GROUP }, who, memberKey);
                    else {
                        const found = lastFor(item, member.principalId, groupActivations);
                        if (!found && days > entraLogDays) push({ ...via, state: "not-read", activationText: beyondLogText(entraLogDays) }, who, memberKey);
                        else push({ ...via, ...judgeFound(item, startIso, found) }, who, memberKey);
                    }
                }
                continue;
            }
            const fixed = holder === "app"
                ? { state: "app" as const, activationText: isAgent ? TEXT_AGENT : TEXT_APP }
                : { state: "never-activates" as const, activationText: TEXT_NEVER };
            push({ ...own, ...fixed }, principal, key);
            continue;
        }

        const base = { ...common, type: "Eligible" as const, endsAt: endIso };
        const judge = (personId: string) => judgeOrUnread(item, startOfEligibility(item, personId, startIso), lastFor(item, personId));

        if (holder === "app") {
            push({ ...base, state: "not-read", activationText: isAgent ? TEXT_AGENT_ELIGIBLE : TEXT_APP_ELIGIBLE }, principal, key);
        } else if (holder === "person") {
            push({ ...base, ...judge(item.principalId) }, principal, key);
        } else {
            const entry = membership?.get(item.principalId.toLowerCase());
            if (entry?.status === "loading") {
                push({ ...base, state: "loading", activationText: TEXT_MEMBERS_LOADING }, principal, key);
            } else if (!entry || entry.status === "error") {
                push({ ...base, state: "not-read", activationText: TEXT_MEMBERS_UNREAD, membersUnread: true }, principal, key);
            } else if (entry.members.length === 0) {
                push({ ...base, state: "no-members", activationText: TEXT_NO_MEMBERS }, principal, key);
            } else {
                for (const member of entry.members) {
                    const basic = toBasicKind(member.kind);
                    const kind: HolderKind = basic === "servicePrincipal" ? "app" : basic === "group" ? "group" : "person";
                    const who = { name: member.displayName || member.id, id: member.id, kind, isAgent: isAgentKind(member.kind), isGuest: kind === "person" && isGuestUpn(member.userPrincipalName) };
                    const via = { ...base, viaGroup: principal.name };
                    const memberKey = `${key}|member|${member.id}`;
                    if (kind === "app") push({ ...via, state: "app", activationText: who.isAgent ? TEXT_AGENT : TEXT_APP }, who, memberKey);
                    else if (kind === "group") push({ ...via, state: "not-read", activationText: TEXT_NESTED_GROUP }, who, memberKey);
                    else push({ ...via, ...judge(member.id) }, who, memberKey);
                }
            }
        }
    }
    return sortNoActivationRows(rows);
}
