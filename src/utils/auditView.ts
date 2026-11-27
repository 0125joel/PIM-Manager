import type { AuditEvent, AuditKind } from "@/types/audit.types";
import type { AzureScopeLevel } from "@/types/azureResource.types";
import { judgeEventPrivilege, type AuditPrivilege } from "@/utils/auditPrivilege";
import type { AuditFilterKey } from "@/utils/auditFilterControls";
import { HOLDER_LABELS } from "@/utils/holderKinds";
import { isAgentKind, type PrincipalKind } from "@/utils/principalUtils";
import { inRange, type AuditRange } from "@/utils/auditTimeline";
import { AUDIT_KINDS, type AuditUrlState, type AuditWhoChoice } from "@/utils/auditUrlState";

/**
 * What the Audit page shows of the events it holds (implementation spec section 5, canvas `Main.dc.html`): filtering,
 * counts, the days of the list, the detail rows and the coverage line. Pure: no Graph, no state. Times are shown in the
 * browser's zone and the reader's locale unless a caller names them (tests and the fixture do, for a fixed result).
 */

const DAY_MS = 86_400_000;

/** The zone and locale of the shown times; left out they are the browser's */
export interface AuditFormat {
    timeZone?: string;
    locale?: string;
}

/** The kind as a filter chip names it */
export const AUDIT_KIND_LABELS: Record<AuditKind, string> = {
    usage: "Activations",
    assignment: "Assignments",
    setting: "Settings",
    outside: "Outside PIM",
    system: "System",
};

/** The kind of one event, as the second line of a row and the "What" of the detail */
export const AUDIT_KIND_ONE: Record<AuditKind, string> = {
    usage: "Activation",
    assignment: "Assignment",
    setting: "Setting",
    outside: "Outside PIM",
    system: "System",
};

/** The icon of each kind (the icon set, docs/Assets/icons) */
export const AUDIT_KIND_ICONS = {
    usage: "active",
    assignment: "assign",
    setting: "configure",
    outside: "shield-off",
    system: "log",
} as const satisfies Record<AuditKind, string>;

/** What the marks of a point on the timeline mean, for its tooltip and its name */
export interface AuditPointText {
    kind: string;
    /** "Failed" or "Denied"; left out when it succeeded */
    result?: string;
    /** One line per mark that is not the kind: the dashed red ring, the outline of the shown event */
    marks: string[];
}

export function auditPointText(point: { kind: AuditKind; isFailed: boolean; isDenied: boolean }, isSelected: boolean): AuditPointText {
    const result = point.isDenied ? "Denied" : point.isFailed ? "Failed" : undefined;
    const marks: string[] = [];
    if (result) marks.push("Dashed red ring: failed or denied.");
    if (isSelected) marks.push("Outline: this action is shown in the detail.");
    return { kind: AUDIT_KIND_ONE[point.kind], ...(result ? { result } : {}), marks };
}

// Filtering ------------------------------------------------------------------------------------------------------------

/** True when the event is by or about an account marked as emergency access (ids compare in lower case) */
export function isEmergencyEvent(event: AuditEvent, emergencyIds: ReadonlySet<string> | undefined): boolean {
    if (!emergencyIds || emergencyIds.size === 0) return false;
    return [event.actor.id, event.target?.id ?? ""].some((id) => id !== "" && emergencyIds.has(id.toLowerCase()));
}

type Skip = "kinds" | "failed";

function matchesSearch(event: AuditEvent, term: string, isEmergency: boolean): boolean {
    const haystack = [event.sentence, event.actor.name, event.target?.name ?? "", event.role.name, event.ticket ?? "", event.azure?.scopeName ?? "", event.viaGroup ?? "", ...(event.groupRoles ?? []), isEmergency ? "Emergency access" : ""];
    return haystack.some((text) => text.toLowerCase().includes(term));
}

/**
 * Who gets or holds the role of an event: its target, or for an activation without one the person who activated. Null for an
 * event without a holder, such as a setting: it shows only while Who is on all (Joël, 2026-11-06).
 */
export function auditHolderOf(event: AuditEvent): AuditWhoChoice | null {
    if (event.target) {
        if (event.targetIsGroup) return "group";
        if (event.targetIsApp) return "app";
        return event.targetIsGuest ? "guest" : "user";
    }
    if (event.kind === "usage" && event.actor.kind === "person" && (event.actor.id !== "" || event.actor.name !== "")) return event.actor.isGuest ? "guest" : "user";
    return null;
}

/**
 * An app or agent the role data does not know: it holds no role now, or no longer exists, and the log gives both the type
 * `ServicePrincipal` (measured 2026-11-07). It stays under Apps and under Agents, and the page says how many (Joël, 2026-11-07).
 */
export function isAuditHolderUntold(event: AuditEvent, holderKinds: ReadonlyMap<string, PrincipalKind>): boolean {
    return auditHolderOf(event) === "app" && !holderKinds.has((event.target?.id ?? "").toLowerCase());
}

/** Whether Who keeps this event. Without `holderKinds`, Apps and Agents are not told apart yet; the page waits for the roles */
export function matchesAuditWho(event: AuditEvent, who: AuditWhoChoice, holderKinds?: ReadonlyMap<string, PrincipalKind>): boolean {
    const holder = auditHolderOf(event);
    // A person through a group counts for the person and for the group, as in No activation (Joël, 2026-11-07)
    if (who === "group") return holder === "group" || (holder !== null && (event.viaGroup !== undefined || event.environment === "group"));
    if (who !== "app" && who !== "agent") return holder === who;
    if (!holderKinds) return holder === "app";
    const kind = holderKinds.get((event.target?.id ?? "").toLowerCase());
    // The log has no separate type for an agent's user account: it also stays under Users, as the log calls it
    if (holder === "user") return who === "agent" && kind === "agentUser";
    if (holder !== "app") return false;
    if (kind === undefined) return true;
    return who === "agent" ? isAgentKind(kind) : !isAgentKind(kind);
}

/** The sentence for what Apps or Agents kept without knowing, or null when there is none */
export function untoldHolderText(count: number): string | null {
    if (count === 0) return null;
    return count === 1
        ? "1 event kept because the log does not say whether it is an app or an agent."
        : `${count} events kept because the log does not say whether they are apps or agents.`;
}


/** The active filters of the Filters panel as chips. In No activation Failed is not used, so it is not named or counted there */
export function auditFilterChips(state: AuditUrlState): { key: AuditFilterKey; label: string }[] {
    const chips: { key: AuditFilterKey; label: string }[] = [];
    if (state.who) chips.push({ key: "who", label: `${HOLDER_LABELS[state.who].many} only` });
    if (state.env !== "both") chips.push({ key: "env", label: state.env === "role" ? "Entra roles only" : "PIM for Groups only" });
    if (state.level) chips.push({ key: "level", label: `Scope level: ${AZURE_SCOPE_LEVEL_LABELS[state.level]}` });
    if (state.privileged) chips.push({ key: "privileged", label: "Privileged only" });
    if (state.failed && state.view !== "idle") chips.push({ key: "failed", label: "Failed or denied" });
    return chips;
}

function matches(event: AuditEvent, state: AuditUrlState, cutoff: number, emergencyIds: ReadonlySet<string> | undefined, range: AuditRange | undefined, privilege: AuditPrivilege | undefined, holderKinds: ReadonlyMap<string, PrincipalKind> | undefined, skip?: Skip): boolean {
    const time = Date.parse(event.time);
    if (!Number.isFinite(time) || time < cutoff || !inRange(time, range)) return false;
    if (skip !== "kinds" && !state.kinds.includes(event.kind)) return false;
    if (state.env !== "both" && event.environment !== state.env) return false;
    if (state.level && event.azure?.scopeLevel !== state.level) return false;
    if (state.who && !matchesAuditWho(event, state.who, holderKinds)) return false;
    // Only a role known not to be privileged goes: one that cannot be judged stays, and the page says how many
    if (state.privileged && privilege && judgeEventPrivilege(event, privilege) === false) return false;
    if (skip !== "failed" && state.failed && event.result !== "failure") return false;
    const term = state.q.trim().toLowerCase();
    return term === "" || matchesSearch(event, term, isEmergencyEvent(event, emergencyIds));
}

/**
 * The events the list shows: inside the last `state.days` days before `now`, of the chosen kinds and environment, failed
 * only when asked, and matching the search (case-insensitive over the sentence, the actor, the target, the role and the
 * ticket; for an emergency access account also the words "Emergency access"). With a `range` (the selection of the timeline,
 * the ends included) only events inside it. `state.who` and, with a `privilege` to judge by, `state.privileged` narrow it
 * further; without a `privilege` Privileged only is not applied, which the page says. Order is kept.
 */
export function filterAuditEvents(events: readonly AuditEvent[], state: AuditUrlState, now: Date, emergencyIds?: ReadonlySet<string>, range?: AuditRange, privilege?: AuditPrivilege, holderKinds?: ReadonlyMap<string, PrincipalKind>): AuditEvent[] {
    const cutoff = now.getTime() - state.days * DAY_MS;
    return events.filter((event) => matches(event, state, cutoff, emergencyIds, range, privilege, holderKinds));
}

/** How many events each kind would show under the other filters (and the selection), so a chip says what clicking it gives */
export function countByKind(events: readonly AuditEvent[], state: AuditUrlState, now: Date, emergencyIds?: ReadonlySet<string>, range?: AuditRange, privilege?: AuditPrivilege, holderKinds?: ReadonlyMap<string, PrincipalKind>): Record<AuditKind, number> {
    const cutoff = now.getTime() - state.days * DAY_MS;
    const counts = Object.fromEntries(AUDIT_KINDS.map((kind) => [kind, 0])) as Record<AuditKind, number>;
    for (const event of events) {
        if (matches(event, state, cutoff, emergencyIds, range, privilege, holderKinds, "kinds")) counts[event.kind] += 1;
    }
    return counts;
}

/** How many failed events "Failed or denied" would show under the other filters (and the selection) */
export function countFailed(events: readonly AuditEvent[], state: AuditUrlState, now: Date, emergencyIds?: ReadonlySet<string>, range?: AuditRange, privilege?: AuditPrivilege, holderKinds?: ReadonlyMap<string, PrincipalKind>): number {
    const cutoff = now.getTime() - state.days * DAY_MS;
    return events.filter((event) => event.result === "failure" && matches(event, state, cutoff, emergencyIds, range, privilege, holderKinds, "failed")).length;
}

/** How many events lie inside the period, whatever the other filters say: nothing here is an empty period */
export function countInPeriod(events: readonly AuditEvent[], days: number, now: Date): number {
    const cutoff = now.getTime() - days * DAY_MS;
    return events.filter((event) => Date.parse(event.time) >= cutoff).length;
}

// Dates and times ------------------------------------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: "date" | "time" | "zone" | "day", format: AuditFormat): Intl.DateTimeFormat {
    const key = `${kind}|${format.locale ?? ""}|${format.timeZone ?? ""}`;
    let found = formatterCache.get(key);
    if (!found) {
        const options: Intl.DateTimeFormatOptions =
            kind === "date" ? { day: "numeric", month: "short", year: "numeric" }
            : kind === "time" ? { hour: "2-digit", minute: "2-digit" }
            : kind === "day" ? { year: "numeric", month: "2-digit", day: "2-digit" }
            : { timeZoneName: "short" };
        // The key of a day is always numeric and in one locale, so equal days compare equal
        found = new Intl.DateTimeFormat(kind === "day" ? "en-CA" : format.locale, { ...options, timeZone: format.timeZone });
        formatterCache.set(key, found);
    }
    return found;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
    if (value === null || value === undefined || value === "") return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** "5 Nov 2026" in the shown zone; an invalid date gives an empty string */
export function formatAuditDate(value: Date | string | number | null | undefined, format: AuditFormat = {}): string {
    const date = toDate(value);
    return date ? formatter("date", format).format(date) : "";
}

/** "09:42" in the shown zone; an invalid time gives an empty string */
export function formatAuditTime(value: Date | string | number | null | undefined, format: AuditFormat = {}): string {
    const date = toDate(value);
    return date ? formatter("time", format).format(date) : "";
}

/** The short name of the zone at that moment, for example "UTC" or "GMT+1" */
export function auditZoneLabel(value: Date | string | number | null | undefined, format: AuditFormat = {}): string {
    const date = toDate(value);
    if (!date) return "";
    return formatter("zone", format).formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "";
}

export interface AuditDay {
    /** `2026-11-05`, the day in the shown zone */
    key: string;
    /** "5 Nov 2026" */
    label: string;
    events: AuditEvent[];
}

/** The events by day in the shown zone, the newest day and the newest event first */
export function groupByDay(events: readonly AuditEvent[], timeZone?: string, locale?: string): AuditDay[] {
    const format: AuditFormat = { timeZone, locale };
    const sorted = events.filter((event) => toDate(event.time) !== null).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const days: AuditDay[] = [];
    for (const event of sorted) {
        const key = formatter("day", format).format(new Date(event.time));
        const last = days[days.length - 1];
        if (last && last.key === key) last.events.push(event);
        else days.push({ key, label: formatAuditDate(event.time, format), events: [event] });
    }
    return days;
}

/** A length in whole minutes: "19 min", "1 hour", "1 h 12 min", "2 days" */
export function formatMinutes(minutes: number): string {
    if (!Number.isFinite(minutes) || minutes < 0) return "";
    const whole = Math.floor(minutes);
    if (whole < 60) return `${whole} min`;
    const hours = Math.floor(whole / 60);
    const rest = whole % 60;
    if (rest > 0) return `${hours} h ${rest} min`;
    if (hours >= 24 && hours % 24 === 0) {
        const days = hours / 24;
        return days === 1 ? "1 day" : `${days} days`;
    }
    return hours === 1 ? "1 hour" : `${hours} hours`;
}

/** "Used for 19 min" of a list row, or null when the end is not in the log */
export function auditUsedForShort(event: AuditEvent): string | null {
    if (event.usedMinutes === undefined) return null;
    const text = formatMinutes(event.usedMinutes);
    return text ? `Used for ${text}` : null;
}

/** "by Megan Bowen" of a list row: not when the actor is already in the sentence, nor for a system event or a nameless actor */
export function auditRowBy(event: AuditEvent): string | null {
    const name = event.actor.name.trim();
    if (event.kind === "system" || name === "" || event.sentence.includes(name)) return null;
    return `by ${name}`;
}

/** "5 actions" */
export function formatActionCount(count: number): string {
    return `${count} ${count === 1 ? "action" : "actions"}`;
}

// Detail ---------------------------------------------------------------------------------------------------------------

export interface AuditDetailRow {
    label: string;
    value: string;
    /** Takes the whole width of the card: a new value of a setting was measured up to 272 characters */
    isWide?: boolean;
}

/** An event of the Azure Audit page: it names its Azure scope, or comes from an Azure source */
export function isAzureEvent(event: AuditEvent): boolean {
    return event.azure !== undefined || event.source === "arm" || event.source === "activity-log" || event.source === "azure-workspace";
}

/**
 * The whole failure of an Azure event, `{code}: {message}`, when it has a message: the detail shows the code in Result and this in
 * the note. Null for an Entra event, a denial, a failure without a message and an event that did not fail.
 */
export function azureFailureMessage(event: AuditEvent): string | null {
    if (!isAzureEvent(event) || event.denied || event.result !== "failure") return null;
    const reason = event.failureReason?.trim() ?? "";
    return reason.includes(": ") ? reason : null;
}

export const AZURE_SCOPE_LEVEL_LABELS: Record<AzureScopeLevel, string> = {
    root: "Root",
    managementGroup: "Management group",
    subscription: "Subscription",
    resourceGroup: "Resource group",
    resource: "Resource",
};

const AZURE_SOURCE_LABELS: Partial<Record<AuditEvent["source"], string>> = {
    graph: "Entra audit log",
    arm: "PIM requests",
    "activity-log": "Azure activity log",
    "azure-workspace": "Log Analytics workspace",
};

function usedForText(event: AuditEvent, format: AuditFormat): string | null {
    if (event.usedMinutes === undefined) return null;
    const length = formatMinutes(event.usedMinutes);
    if (!length) return null;
    const endTime = formatAuditTime(event.endedAt, format);
    if (!endTime) return length;
    const ender = event.endedBy?.name.trim();
    if (event.endedBy) return ender ? `${length}, ended by ${ender} at ${endTime}` : `${length}, ended at ${endTime}`;
    return `${length}, expired at ${endTime}`;
}

/**
 * The rows of the detail (rounds 3 and 6 of the redesign). Always: What, By, Role, When with the zone, Result, Through,
 * Reason (or New value and "Old value: Not in the log" for a setting), Ticket, Approved by and Account. Only with
 * details: Used for, Requested duration, MFA on activation (an activation of a role), Where and Source. A missing value
 * stays an empty row, never "Unknown". The export holds everything whatever `isDetailed` says.
 */
export function auditDetailRows(event: AuditEvent, isDetailed: boolean, isEmergency: boolean, format: AuditFormat = {}): AuditDetailRow[] {
    const rows: AuditDetailRow[] = [];
    // Joël, 2026-11-06: every event shows the same fields in the same place; one without a value stays empty
    const add = (label: string, value: string | undefined) => {
        rows.push({ label, value: value !== undefined && value.trim() !== "" ? value : "" });
    };

    add("What", AUDIT_KIND_ONE[event.kind]);
    add("By", event.actor.name);
    // Through a group the role is what the person got: Entra's event names the group, so the role comes from `groupRoles`
    add("Role", event.groupRoles?.length ? event.groupRoles.join(", ") : event.role.name);
    const isAzure = isAzureEvent(event);
    if (isAzure) add("Scope", event.scope);
    const when = formatAuditDate(event.time, format);
    add("When", when ? `${when}, ${formatAuditTime(event.time, format)} ${auditZoneLabel(event.time, format)}`.trim() : "");
    if (event.denied) add("Result", "Denied");
    else if (event.result === "failure") {
        // An Azure failure shows its code; the message is in the note
        const reason = isAzure && event.failureReason ? event.failureReason.split(": ")[0] : event.failureReason;
        add("Result", reason ? `Failed: ${reason}` : "Failed");
    }
    else add("Result", event.requestOnly ? "Requested; no completion in the log" : "Succeeded");
    add("Through", event.viaGroup);
    add("Reason", event.kind === "setting" ? undefined : event.reason);
    add("Ticket", event.ticket);
    add(event.denied ? "Denied by" : "Approved by", event.approver);
    add("Old value", event.kind === "setting" ? "Not in the log" : undefined);
    add("Ends", event.endsAt ? formatAuditDate(event.endsAt, format) : undefined);
    add("Account", isEmergency ? "Emergency access" : undefined);

    if (isDetailed) {
        add("Used for", usedForText(event, format) ?? undefined);
        add("Starts", event.startsAt ? `${formatAuditDate(event.startsAt, format)}, ${formatAuditTime(event.startsAt, format)}`.trim() : undefined);
        add(event.denied ? "Denied after" : "Approved after", event.decidedAfterMinutes !== undefined ? formatMinutes(event.decidedAfterMinutes) : undefined);
        add("Requested duration", event.kind === "usage" && event.requestedDuration !== undefined ? formatMinutes(event.requestedDuration) : undefined);
        if (isAzure) {
            add("Scope level", event.azure ? AZURE_SCOPE_LEVEL_LABELS[event.azure.scopeLevel] : undefined);
            // As on Entra: a workspace event names its workspace when it has a name
            add("Source", event.source === "azure-workspace" ? (event.workspace ? `Workspace ${event.workspace}` : AZURE_SOURCE_LABELS[event.source]) : AZURE_SOURCE_LABELS[event.source]);
        } else {
            add("MFA on activation", event.kind === "usage" && event.environment === "role" && event.mfa !== undefined ? (event.mfa ? "Yes" : "No") : undefined);
            add("Where", event.scope);
            add("Source", event.source === "workspace" ? (event.workspace ? `Workspace ${event.workspace}` : "Log Analytics workspace") : "Entra audit log");
        }
    }
    // Last, across the whole width: its text was measured up to 272 characters
    add("New value", event.kind === "setting" ? event.newValue : undefined);
    rows[rows.length - 1].isWide = true;
    return rows;
}

/** The line under the detail: what is missing for a setting or an outside-PIM change, else (with details) the merged action */
export function auditDetailNote(event: AuditEvent, isDetailed: boolean): string | null {
    if (isAzureEvent(event)) {
        const failure = azureFailureMessage(event);
        if (failure) return failure;
        if (event.environment === "group") return "Activating the membership gives every role the group holds. This shows the role on the scope you can read.";
        if (event.kind === "setting") return "Azure logs the rule that changed, not what it was before.";
    }
    if (event.kind === "setting") return "Microsoft logs only the new value of a setting, in its own words.";
    if (event.kind === "outside") return "This did not go through PIM, so there is no request, reason or approval.";
    return isDetailed ? "Requested and completed are shown as one action." : null;
}

// Coverage -------------------------------------------------------------------------------------------------------------

/** The oldest event the page can have: the later of the start of the window that was read and today minus `days` */
export function oldestAvailable(windowStart: string | null | undefined, days: number, now: Date): Date {
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const start = toDate(windowStart);
    return start && start.getTime() > cutoff.getTime() ? start : cutoff;
}

export interface CoverageInput extends AuditFormat {
    /** The start of the window the last read covered (`oldest` of useAuditData) */
    windowStart: string | null;
    /** When the last read finished */
    readAt: string | null;
    days: number;
    now: Date;
    /** What the source is called in the line; left out it is the Entra audit log. With workspaces: "2 workspaces", "2 of 3 workspaces" */
    sourceLabel?: string;
    /** Sentences at the end: what a workspace is, and what the Entra audit log added */
    notes?: readonly string[];
}

/** The coverage line, always shown with data: source, oldest event available, read time, zone and the delay */
export function buildCoverageLine({ windowStart, readAt, days, now, timeZone, locale, sourceLabel = "Entra audit log", notes = [] }: CoverageInput): string {
    const format: AuditFormat = { timeZone, locale };
    const parts = [`Source: ${sourceLabel}.`, `Oldest event available: ${formatAuditDate(oldestAvailable(windowStart, days, now), format)}.`];
    const read = formatAuditTime(readAt, format);
    if (read) parts.push(`Read ${read}.`);
    parts.push(`Times in ${auditZoneLabel(readAt ?? now, format)}.`, "New events can take a few minutes to appear.", ...notes);
    return parts.join(" ");
}

/** How the coverage line names workspaces that were read: "1 workspace", "2 workspaces", "2 of 3 workspaces" when some failed */
export function workspaceSourceLabel(read: number, total: number): string {
    const noun = (n: number) => (n === 1 ? "workspace" : "workspaces");
    return read === total ? `${read} ${noun(read)}` : `${read} of ${total} ${noun(total)}`;
}

/**
 * The hint beside the period field when it stands at its limit. A workspace is named only when it really reaches past the
 * page's own log; one that keeps no more leaves the limit with the own log, so it must not be credited with it.
 */
export function periodLimitHint(isWorkspace: boolean, maxDays: number, ownLogDays: number): string {
    if (!isWorkspace) return "The longest period without a workspace";
    return maxDays > ownLogDays ? "The longest your workspaces keep their logs" : "The longest the audit log keeps";
}
