import type { AuditActor, AuditEnvironment, AuditEvent, AuditSource } from "@/types/audit.types";
import { escapeCsvCell } from "@/utils/exportSchema";
import { AUDIT_KIND_LABELS, AUDIT_KIND_ONE, AZURE_SCOPE_LEVEL_LABELS, formatMinutes, isAzureEvent, isEmergencyEvent } from "@/utils/auditView";
import { HOLDER_LABELS } from "@/utils/holderKinds";
import { AUDIT_KINDS, type AuditUrlState } from "@/utils/auditUrlState";
import type { AuditRange } from "@/utils/auditTimeline";
import { GROUPS_NOT_GRANTED_REASON, STATE_GROUP_WORDS, countNoActivation, stateGroupOf, type NoActivationRow, type StateGroup } from "@/utils/auditNoActivation";

/**
 * What the Audit export holds and how it is written (implementation spec section 6, AU-5 brief). Pure: the dialog hands
 * in what the page shows and gets back a file name and the content, or for the PDF the data its document draws.
 *
 * Every format holds every field of the model, whatever the details toggle says, and nothing beyond the model (no IP
 * address, user agent, oid, tid, wids or acct: they never enter `AuditEvent`). A missing value is an empty cell in CSV and
 * left out in JSON. With `replaceNames` every person becomes `User n` (one number per person, across actor, target, ended
 * by and approver, and in the sentence), the object ids of people, the exporter and the search term are left out, and so
 * are the free text fields Reason and New value and the Ticket, because they can hold a name that no replacing finds.
 *
 * A file with Azure events (AU-14) adds the columns Scope level and Subscription, reads the Scope id column from the Azure
 * scope, and names the Azure source and a closing line in the third person. With `replaceNames` such a file also leaves out
 * the scope and subscription ids. Only the named fields of the model are read: nothing of the log's own request, authorization,
 * claims or addresses can reach a file.
 */

export type AuditExportFormat = "csv" | "json" | "pdf";

export interface AuditExportChoice {
    format: AuditExportFormat;
    replaceNames: boolean;
}

export const DEFAULT_AUDIT_EXPORT_CHOICE: AuditExportChoice = { format: "csv", replaceNames: false };

/** The workloads the export holds. Never stored: a remembered choice could silently leave a workload out. */
export interface AuditExportInclude {
    roles: boolean;
    groups: boolean;
}

export const AUDIT_EXPORT_INCLUDE_ALL: AuditExportInclude = { roles: true, groups: true };

export interface AuditExportCounts {
    roles: number;
    groups: number;
}

export function countEnvironments(rows: readonly { environment: AuditEnvironment }[]): AuditExportCounts {
    let roles = 0;
    let groups = 0;
    for (const row of rows) {
        if (row.environment === "role") roles++;
        else groups++;
    }
    return { roles, groups };
}

/** The rows of the chosen workloads */
export function keepIncluded<T extends { environment: AuditEnvironment }>(rows: readonly T[], include: AuditExportInclude): T[] {
    return rows.filter((row) => (row.environment === "role" ? include.roles : include.groups));
}

/** "Entra roles only" or "PIM for Groups only" when the choice really leaves rows out, else "" (the page filter then already says it) */
export function describeInclude(counts: AuditExportCounts, include: AuditExportInclude): string {
    if (!include.groups && include.roles && counts.groups > 0) return "Entra roles only";
    if (!include.roles && include.groups && counts.roles > 0) return "PIM for Groups only";
    return "";
}

export interface IncludeHintInput {
    workload: "roles" | "groups";
    count: number;
    unit: "assignment" | "action";
    /** No activation only: why PIM for Groups is not included, or null */
    groupsReason?: string | null;
    /** The environment filter of the page (`both` or none: not narrowed) */
    env?: AuditEnvironment | "both";
}

/** The line under a workload of the Include group */
export function includeHint({ workload, count, unit, groupsReason = null, env }: IncludeHintInput): string {
    if (count > 0) return `${count} ${unit}${count === 1 ? "" : "s"}`;
    if (workload === "groups" && groupsReason !== null) return groupsReason === GROUPS_NOT_GRANTED_REASON ? "Not granted yet" : "Could not be read";
    if (env !== undefined && env !== "both" && env !== (workload === "roles" ? "role" : "group")) return "Left out by the current filter";
    return "None in this view";
}

/** The filter sentence with the choice of the dialog after the other filters */
export function withInclude(sentence: string, counts: AuditExportCounts, include: AuditExportInclude): string {
    return [sentence, describeInclude(counts, include)].filter(Boolean).join(", ");
}

/** Its own key: only the format and the option are remembered */
export const AUDIT_EXPORT_STORAGE_KEY = "audit-export";

export const AUDIT_EXPORT_FORMATS: readonly AuditExportFormat[] = ["csv", "json", "pdf"];

/** Reads the remembered choice; anything that is not exactly a known format and a boolean gives the default */
export function parseStoredAuditExportChoice(raw: string | null): AuditExportChoice {
    if (!raw) return DEFAULT_AUDIT_EXPORT_CHOICE;
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null) return DEFAULT_AUDIT_EXPORT_CHOICE;
        const { format, replaceNames } = value as Record<string, unknown>;
        return {
            format: AUDIT_EXPORT_FORMATS.find((known) => known === format) ?? DEFAULT_AUDIT_EXPORT_CHOICE.format,
            replaceNames: replaceNames === true,
        };
    } catch {
        return DEFAULT_AUDIT_EXPORT_CHOICE;
    }
}

export interface AuditExportInput {
    /** The events on screen: every filter and the selection applied */
    events: readonly AuditEvent[];
    /** What the export covers: the selection when there is one, else the period of the read */
    period: { from: Date; to: Date };
    /** The filters and the selection as a sentence ("none" is written when this is empty) */
    filterSentence: string;
    /** The search words; left out when names are replaced */
    searchTerm: string;
    /** When the last read finished, ISO */
    readAt: string;
    /** The oldest event the source can give */
    oldestAvailable: Date;
    source: AuditSource;
    /** The sources in words, in place of the name of `source` (the Azure page names its logs) */
    sourceLabel?: string;
    tenant: { id: string; name?: string };
    /** "Alex Wilber (alexw@contoso.com)"; left out when names are replaced */
    exporter?: string;
    emergencyIds: ReadonlySet<string>;
    /** What could not be read; "Nothing" until the workspace package fills it */
    notRead?: string;
    exportedAt: Date;
}

export interface AuditPdfTotal {
    label: string;
    value: number;
    note: string;
}

export interface AuditPdfRow {
    time: string;
    action: string;
    by: string;
    reasonAndTicket: string;
    result: string;
    /** Failed or denied: the Result cell is drawn in the danger colour, next to its word */
    isFailed: boolean;
}

/** The data `AuditReportDocument` draws */
export interface AuditPdfData {
    title: string;
    subtitle: string;
    tenantName: string;
    /** The block on the first page, label and value */
    meta: { label: string; value: string }[];
    totals: AuditPdfTotal[];
    rows: AuditPdfRow[];
    closingNote: string;
}

export type AuditExportFile =
    | { format: "csv" | "json"; fileName: string; mime: string; content: string }
    | { format: "pdf"; fileName: string; mime: string; pdf: AuditPdfData };

export const AUDIT_PDF_CLOSING_NOTE = "This report shows what the Microsoft log held when it was read. PIM Manager does not store the log and cannot prove it was not changed afterwards. Activation shows that a role was switched on, not what it was used for.";
/** The closing line of an Azure report: Azure leaves out what the exporter's roles cannot see, so it says whose view this is */
export const AZURE_PDF_CLOSING_NOTE = "This report shows what the Azure logs held when they were read, on the scopes the exporter could read. Azure leaves out what the exporter's roles cannot see, without saying so, so the report does not prove that nothing else happened. PIM Manager does not store the logs and cannot prove they were not changed afterwards. Activation shows that a role was switched on, not what it was used for.";
export const AUDIT_LATE_EVENTS_NOTE = "Events from the last few minutes can be missing.";
export const AUDIT_EXPORT_SOURCE_LABEL: Record<AuditSource, string> = {
    graph: "Entra audit log",
    workspace: "Log Analytics workspace",
    arm: "PIM requests",
    "activity-log": "Azure activity log",
    "azure-workspace": "Log Analytics workspace",
};

// Text helpers ---------------------------------------------------------------------------------------------------------

const pad = (value: number): string => String(value).padStart(2, "0");

/** `2026-11-05T09:42:00.000Z` for a date, and the same normal form for an ISO string; an unparsable value stays as it is */
function isoUtc(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

const dayUtc = (value: Date): string => value.toISOString().slice(0, 10);

/** `2026-11-05 11:05 UTC` */
function minuteUtc(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** The kinds, environment, failed-only, selection and search of the page in one sentence, "" when nothing narrows the view */
export function describeAuditFilter(state: Pick<AuditUrlState, "kinds" | "env" | "failed" | "who" | "privileged" | "level">, range?: AuditRange, unjudged = 0, untoldHolders = 0, scopeBar = ""): string {
    const parts: string[] = [];
    for (const kind of AUDIT_KINDS) {
        if (!state.kinds.includes(kind)) parts.push(kind === "system" ? "System events off" : `${AUDIT_KIND_LABELS[kind]} off`);
    }
    if (state.env === "role") parts.push("Entra roles only");
    if (state.env === "group") parts.push("PIM for Groups only");
    if (state.level) parts.push(`Scope level: ${AZURE_SCOPE_LEVEL_LABELS[state.level]} only`);
    // The choices of the Azure scope bar, already as one phrase
    if (scopeBar) parts.push(scopeBar);
    if (state.who) parts.push(untoldHolders > 0 ? `${HOLDER_LABELS[state.who].many} only (${untoldHolders} kept: app or agent could not be told)` : `${HOLDER_LABELS[state.who].many} only`);
    // What it kept without knowing travels with the filter, so an export never reads as privileged only and nothing else
    if (state.privileged) parts.push(unjudged > 0 ? `Privileged only (${unjudged} kept: role could not be judged)` : "Privileged only");
    if (state.failed) parts.push("Failed or denied");
    if (range) parts.push(`Selection ${minuteUtc(new Date(range.from))} to ${minuteUtc(new Date(range.to))}`);
    return parts.join(", ");
}

/** `pim-audit-contoso-2026-11-05`, following the Report's file names; with replaced names the tenant is still named */
export function auditExportStem(tenantName: string | undefined, exportedAt: Date): string {
    const slug = (tenantName ?? "tenant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
    return `pim-audit-${slug}-${dayUtc(exportedAt)}`;
}

/** "12 actions, 2026-10-06 to 2026-11-05, with the current filters." */
export function describeAuditScope(count: number, period: { from: Date; to: Date }): string {
    return `${count} ${count === 1 ? "action" : "actions"}, ${dayUtc(period.from)} to ${dayUtc(period.to)}, with the current filters.`;
}

// Replacing names -------------------------------------------------------------------------------------------------------

interface Namer {
    /** The label of a person known by id and name, or by name alone (an approver) */
    labelOf: (name: string, id?: string) => string;
    /** The text with every known person name replaced, longest names first */
    scrub: (text: string) => string;
}

function createNamer(events: readonly AuditEvent[]): Namer {
    const persons = (event: AuditEvent): AuditActor[] => [event.actor, ...(event.target && !event.targetIsGroup ? [{ ...event.target, kind: "person" as const }] : []), ...(event.endedBy ? [event.endedBy] : [])].filter((person) => person.kind === "person");
    return buildNamer(events.flatMap(persons), events.flatMap((event) => (event.approver ? [event.approver] : [])));
}

/** Numbers people in the order given: first the people (by id and name), then names alone (an approver) */
function buildNamer(people: readonly { name: string; id: string }[], namesOnly: readonly string[] = []): Namer {
    const byId = new Map<string, string>();
    const byName = new Map<string, string>();
    let count = 0;
    const nextLabel = () => `User ${++count}`;
    const labelOf = (name: string, id?: string): string => {
        const idKey = id ? id.toLowerCase() : "";
        const found = (idKey && byId.get(idKey)) || byName.get(name);
        const label = found ?? nextLabel();
        if (idKey) byId.set(idKey, label);
        // A person under two spellings keeps the first label; each spelling is found again by name
        if (name) byName.set(name, label);
        return label;
    };
    for (const person of people) if (person.name || person.id) labelOf(person.name, person.id);
    for (const approver of namesOnly) labelOf(approver);
    const scrub = (text: string): string => {
        let result = text;
        for (const name of [...byName.keys()].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(name).join(byName.get(name) ?? "");
        return result;
    };
    return { labelOf, scrub };
}

// Rows ------------------------------------------------------------------------------------------------------------------

type Cell = string | number | boolean | undefined;

interface Column {
    header: string;
    /** Left out when names are replaced: ids of people, and the free text fields */
    personal?: boolean;
    /** Left out of a file with Azure events when names are replaced: the scope and subscription ids */
    azureId?: boolean;
    value: (event: AuditEvent, ctx: RowContext) => Cell;
}

interface RowContext {
    isEmergency: boolean;
    namer: Namer | null;
}

/**
 * With names replaced only a code stays ("RoleAssignmentExists"): Microsoft's reason can repeat a person's free text, and
 * no replacing can be trusted there.
 */
function failureReasonOf(event: AuditEvent, namer: Namer | null): string | undefined {
    const reason = event.failureReason;
    if (!reason || reason.trim() === "") return undefined;
    // A code is one word of letters, digits and underscores: an address or anything else stays out
    return namer && !/^[A-Za-z][A-Za-z0-9_]*$/.test(reason.trim()) ? undefined : reason;
}

const text = (value: string | undefined): string | undefined => (value === undefined || value.trim() === "" ? undefined : value);
const asNumber = (value: number | undefined): number | undefined => (value !== undefined && Number.isFinite(value) ? value : undefined);
const name = (value: string | undefined, ctx: RowContext): string | undefined => {
    const clean = text(value);
    return clean !== undefined && ctx.namer ? ctx.namer.scrub(clean) : clean;
};
const person = (value: AuditActor | undefined, ctx: RowContext): string | undefined => {
    if (!value || text(value.name) === undefined) return undefined;
    return ctx.namer && value.kind === "person" ? ctx.namer.labelOf(value.name, value.id) : value.name;
};

/** The columns, in this order, as CSV headers and JSON keys */
export const AUDIT_EXPORT_COLUMNS: readonly Column[] = [
    { header: "Time (UTC)", value: (e) => isoUtc(e.time) },
    { header: "Kind", value: (e) => AUDIT_KIND_ONE[e.kind] },
    { header: "Environment", value: (e) => (e.environment === "group" ? "Group" : "Role") },
    { header: "Action", value: (e, c) => name(e.sentence, c) },
    { header: "By", value: (e, c) => person(e.actor, c) },
    { header: "By id", personal: true, value: (e) => text(e.actor.id) },
    { header: "Target", value: (e, c) => (e.target ? (e.targetIsGroup ? text(e.target.name) : person({ ...e.target, kind: "person" }, c)) : undefined) },
    { header: "Target id", personal: true, value: (e) => text(e.target?.id) },
    { header: "Role or group", value: (e) => text(e.role.name) },
    { header: "Role id", value: (e) => text(e.role.id) },
    { header: "Scope", value: (e, c) => name(e.scope, c) },
    { header: "Scope id", azureId: true, value: (e) => text(e.directoryScopeId) ?? text(e.azure?.scopeId) },
        { header: "Result", value: (e) => (e.denied ? "Denied" : e.result === "failure" ? "Failed" : e.requestOnly ? "Requested" : "Succeeded") },
    { header: "Failure reason", value: (e, c) => failureReasonOf(e, c.namer) },
    { header: "Reason", personal: true, value: (e) => text(e.reason) },
    { header: "Ticket", personal: true, value: (e) => text(e.ticket) },
    { header: "Approved by", value: (e, c) => (!e.denied && text(e.approver) !== undefined ? (c.namer ? c.namer.labelOf(e.approver ?? "") : e.approver) : undefined) },
    { header: "Denied by", value: (e, c) => (e.denied && text(e.approver) !== undefined ? (c.namer ? c.namer.labelOf(e.approver ?? "") : e.approver) : undefined) },
    { header: "New value", personal: true, value: (e) => text(e.newValue) },
    { header: "Requested minutes", value: (e) => asNumber(e.requestedDuration) },
    { header: "Used minutes", value: (e) => asNumber(e.usedMinutes) },
    { header: "Ended by", value: (e, c) => person(e.endedBy, c) },
    { header: "Ended at (UTC)", value: (e) => (text(e.endedAt) !== undefined ? isoUtc(e.endedAt ?? "") : undefined) },
    { header: "Ends (UTC)", value: (e) => (text(e.endsAt) !== undefined ? isoUtc(e.endsAt ?? "") : undefined) },
    { header: "MFA", value: (e) => e.mfa },
    { header: "Emergency access", value: (_e, c) => c.isEmergency },
    { header: "Source", value: (e) => AUDIT_EXPORT_SOURCE_LABEL[e.source] },
    // The workspace is not a person: a name-free export keeps it
    { header: "Workspace", value: (e) => text(e.workspace) },
    { header: "Event id", value: (e) => text(e.id) },
    { header: "Correlation id", value: (e) => text(e.correlationId) },
    { header: "Through group", value: (e) => text(e.viaGroup) },
    { header: "Roles through the group", value: (e) => text(e.groupRoles?.join(", ")) },
];

/** The events newest first, as the page lists them */
function sortedEvents(events: readonly AuditEvent[]): AuditEvent[] {
    return [...events].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

/** Whether the file holds Azure events: the columns, the closing line and the ids left out follow from it */
export function isAzureExport(events: readonly AuditEvent[]): boolean {
    return events.some(isAzureEvent);
}

/** The columns of a file that holds Azure events: Scope level after Scope, and Subscription after Scope id */
export const AZURE_EXPORT_COLUMNS: readonly Column[] = AUDIT_EXPORT_COLUMNS.flatMap((column): Column[] => {
    if (column.header === "Scope") return [column, { header: "Scope level", value: (e) => (e.azure ? AZURE_SCOPE_LEVEL_LABELS[e.azure.scopeLevel] : undefined) }];
    if (column.header === "Scope id") return [column, { header: "Subscription", azureId: true, value: (e) => text(e.azure?.subscriptionId) }];
    return [column];
});

function columnsFor(replaceNames: boolean, isAzure = false): Column[] {
    return (isAzure ? AZURE_EXPORT_COLUMNS : AUDIT_EXPORT_COLUMNS).filter((column) => !(replaceNames && column.personal) && !(replaceNames && isAzure && column.azureId));
}

// Heading ---------------------------------------------------------------------------------------------------------------

interface Heading {
    tenant: { id: string; name?: string };
    period: { from: string; to: string };
    source: string;
    oldestAvailable: string;
    readAt: string;
    exportedAt: string;
    exporter?: string;
    filters: string;
    notRead: string;
}

type HeadingInput = Pick<AuditExportInput, "tenant" | "period" | "filterSentence" | "searchTerm" | "readAt" | "oldestAvailable" | "source" | "sourceLabel" | "exporter" | "notRead" | "exportedAt">;

function headingOf(input: HeadingInput & { events: readonly AuditEvent[] }, replaceNames: boolean): Heading {
    return headingWith(input, replaceNames, replaceNames ? createNamer(input.events) : null);
}

function headingWith(input: HeadingInput, replaceNames: boolean, namer: Namer | null): Heading {
    const search = !replaceNames && input.searchTerm.trim() !== "" ? `Search "${input.searchTerm.trim()}"` : "";
    const sentence = [namer ? namer.scrub(input.filterSentence) : input.filterSentence, search].filter(Boolean).join(", ");
    return {
        tenant: input.tenant,
        period: { from: isoUtc(input.period.from), to: isoUtc(input.period.to) },
        source: text(input.sourceLabel) ?? AUDIT_EXPORT_SOURCE_LABEL[input.source],
        oldestAvailable: dayUtc(input.oldestAvailable),
        readAt: isoUtc(input.readAt),
        exportedAt: isoUtc(input.exportedAt),
        exporter: replaceNames ? undefined : text(input.exporter),
        filters: sentence || "none",
        notRead: input.notRead?.trim().replace(/\.+$/, "") || "Nothing",
    };
}

function headingLines(heading: Heading): string[] {
    return [
        `# Tenant: ${heading.tenant.name ? `${heading.tenant.name} (${heading.tenant.id})` : heading.tenant.id}`,
        `# Period (UTC): ${heading.period.from} to ${heading.period.to}`,
        `# Source: ${heading.source}. Oldest event available: ${heading.oldestAvailable}`,
        `# Read (UTC): ${heading.readAt}`,
        `# Exported (UTC): ${heading.exportedAt}${heading.exporter ? ` by ${heading.exporter}` : ""}`,
        `# Filters: ${heading.filters}`,
        `# Not read: ${heading.notRead}. ${AUDIT_LATE_EVENTS_NOTE}`,
    ];
}

// Formats ---------------------------------------------------------------------------------------------------------------

function csvCell(value: Cell): string {
    if (value === undefined) return "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return escapeCsvCell(String(value));
}

function buildCsv(input: AuditExportInput, replaceNames: boolean): string {
    const events = sortedEvents(input.events);
    const namer = replaceNames ? createNamer(events) : null;
    const columns = columnsFor(replaceNames, isAzureExport(events));
    const lines = [
        // Every heading line through `escapeCsvCell` too: the tenant name and the filters are text from outside
        ...headingLines(headingOf(input, replaceNames)).map((line) => escapeCsvCell(line)),
        columns.map((column) => escapeCsvCell(column.header)).join(","),
        ...events.map((event) => {
            const ctx: RowContext = { isEmergency: isEmergencyEvent(event, input.emergencyIds), namer };
            return columns.map((column) => csvCell(column.value(event, ctx))).join(",");
        }),
    ];
    return lines.join("\r\n") + "\r\n";
}

function buildJson(input: AuditExportInput, replaceNames: boolean): string {
    const events = sortedEvents(input.events);
    const namer = replaceNames ? createNamer(events) : null;
    const columns = columnsFor(replaceNames, isAzureExport(events));
    const heading = headingOf(input, replaceNames);
    const meta = {
        schemaVersion: 1,
        tenant: { id: heading.tenant.id, ...(heading.tenant.name ? { name: heading.tenant.name } : {}) },
        period: heading.period,
        source: heading.source,
        oldestEventAvailable: heading.oldestAvailable,
        readAt: heading.readAt,
        exportedAt: heading.exportedAt,
        ...(heading.exporter ? { exportedBy: heading.exporter } : {}),
        filters: heading.filters,
        notRead: heading.notRead,
        note: AUDIT_LATE_EVENTS_NOTE,
        eventCount: events.length,
    };
    const rows = events.map((event) => {
        const ctx: RowContext = { isEmergency: isEmergencyEvent(event, input.emergencyIds), namer };
        const row: Record<string, string | number | boolean> = {};
        for (const column of columns) {
            const value = column.value(event, ctx);
            if (value !== undefined) row[column.header] = value;
        }
        return row;
    });
    return JSON.stringify({ meta, events: rows }, null, 2) + "\n";
}

function pdfResult(event: AuditEvent, namer: Namer | null, isAzure = false): string {
    const failureReason = failureReasonOf(event, namer);
    const parts = [event.denied ? "Denied" : event.result === "failure" ? (failureReason ? `Failed: ${failureReason}` : "Failed") : event.requestOnly ? "Requested; no completion in the log" : "Succeeded"];
    // An Azure report gives the decision its own line, below
    if (event.approver && !isAzure) parts.push(`${event.denied ? "Denied" : "Approved"} by ${namer ? namer.labelOf(event.approver) : event.approver}`);
    if (event.usedMinutes !== undefined) {
        const used = formatMinutes(event.usedMinutes);
        const requested = event.requestedDuration !== undefined ? formatMinutes(event.requestedDuration) : "";
        if (used) parts.push(requested ? `Used for ${used} of ${requested}` : `Used for ${used}`);
    }
    const result = parts.join(". ");
    if (!isAzure || !event.approver) return result;
    return `${result}\n${event.denied ? "Denied by" : "Approvers"}: ${namer ? namer.labelOf(event.approver) : event.approver}`;
}

function pdfReason(event: AuditEvent, replaceNames: boolean): string {
    // Free text and tickets never reach a file with replaced names
    if (replaceNames) return "";
    const parts: string[] = [];
    if (event.kind === "setting") {
        if (text(event.newValue)) parts.push(`New value: ${event.newValue?.trim().replace(/\.+$/, "")}`);
        parts.push("Old value not in the log");
    } else if (text(event.reason)) {
        parts.push(event.reason ?? "");
    }
    if (text(event.ticket)) parts.push(event.ticket ?? "");
    return parts.join(". ");
}

function buildPdf(input: AuditExportInput, replaceNames: boolean): AuditPdfData {
    const events = sortedEvents(input.events);
    const namer = replaceNames ? createNamer(events) : null;
    const heading = headingOf(input, replaceNames);
    const emergency = (event: AuditEvent) => isEmergencyEvent(event, input.emergencyIds);
    const of = (kind: AuditEvent["kind"]) => events.filter((event) => event.kind === kind);
    const failed = (list: readonly AuditEvent[]) => list.filter((event) => event.result === "failure").length;
    const countNote = (n: number, what: string) => (n > 0 ? `${n} ${what}` : "");
    const tenantName = heading.tenant.name ?? heading.tenant.id;
    const isAzure = isAzureExport(events);
    return {
        title: "Audit report",
        subtitle: isAzure ? `Activations and changes in Azure roles, for tenant ${tenantName}.` : `Activations and changes in Entra roles and PIM for Groups, for tenant ${tenantName}.`,
        tenantName,
        meta: [
            { label: "Tenant", value: heading.tenant.name ? `${heading.tenant.name} (${heading.tenant.id})` : heading.tenant.id },
            { label: "Period", value: `${minuteUtc(heading.period.from)} to ${minuteUtc(heading.period.to)}` },
            { label: "Source", value: `${heading.source}. Oldest event available: ${heading.oldestAvailable}` },
            { label: "Read", value: minuteUtc(heading.readAt) },
            { label: "Exported", value: `${minuteUtc(heading.exportedAt)}${heading.exporter ? ` by ${heading.exporter}` : ""}` },
            { label: "Filters", value: heading.filters },
            { label: "Not read", value: `${heading.notRead}. ${AUDIT_LATE_EVENTS_NOTE}` },
        ],
        totals: [
            { label: AUDIT_KIND_LABELS.usage, value: of("usage").length, note: countNote(failed(of("usage")), of("usage").some((event) => event.denied) ? "failed or denied" : "failed") },
            { label: AUDIT_KIND_LABELS.assignment, value: of("assignment").length, note: countNote(failed(of("assignment")), "failed") },
            { label: AUDIT_KIND_LABELS.setting, value: of("setting").length, note: countNote(of("setting").filter(emergency).length, "by emergency access") },
            { label: AUDIT_KIND_LABELS.outside, value: of("outside").length, note: "Without a request or approval" },
        ],
        rows: events.map((event) => {
            const by = person(event.actor, { isEmergency: false, namer });
            const ctx = { isEmergency: false, namer };
            // Azure adds the lines Scope (name and level) and Through (the group the activation came through)
            const scopeName = isAzure ? name(event.scope || event.azure?.scopeName, ctx) : undefined;
            const scopeLine = scopeName ? `\nScope: ${scopeName}${event.azure ? ` (${AZURE_SCOPE_LEVEL_LABELS[event.azure.scopeLevel]})` : ""}` : "";
            const throughName = name(event.viaGroup, ctx);
            return {
                time: minuteUtc(event.time).replace(" UTC", ""),
                action: `${name(event.sentence, ctx) ?? ""}${scopeLine}`,
                by: `${by ?? ""}${emergency(event) ? " (emergency access)" : ""}`.trim() + (throughName ? `\nThrough: ${throughName}` : ""),
                reasonAndTicket: pdfReason(event, replaceNames),
                result: pdfResult(event, namer, isAzure),
                isFailed: event.result === "failure",
            };
        }),
        closingNote: isAzure ? AZURE_PDF_CLOSING_NOTE : AUDIT_PDF_CLOSING_NOTE,
    };
}

/** What one choice produces: the file name and the content, or for the PDF the data its document draws */
export function planAuditExport(input: AuditExportInput, choice: AuditExportChoice): AuditExportFile {
    const stem = auditExportStem(input.tenant.name, input.exportedAt);
    if (choice.format === "csv") return { format: "csv", fileName: `${stem}.csv`, mime: "text/csv;charset=utf-8", content: buildCsv(input, choice.replaceNames) };
    if (choice.format === "json") return { format: "json", fileName: `${stem}.json`, mime: "application/json", content: buildJson(input, choice.replaceNames) };
    return { format: "pdf", fileName: `${stem}.pdf`, mime: "application/pdf", pdf: buildPdf(input, choice.replaceNames) };
}

// No activation view (AU-6) ---------------------------------------------------------------------------------------------

/** What the No activation export holds: the rows on screen, the honesty text and the facts of the heading. CSV and JSON only. */
export interface NoActivationExportInput extends HeadingInput {
    /** The rows on screen: the environment and the search applied */
    rows: readonly NoActivationRow[];
    /** The text above the table; it is in the heading of every file */
    honesty: string;
}

export interface NoActivationExportChoice {
    format: AuditExportFormat;
    replaceNames: boolean;
}

export interface NoActivationPdfRow {
    resource: string;
    /** Left out when every row of the report has the same scope: the block of facts names it then */
    scope?: string;
    who: string;
    isEmergency: boolean;
    /** The group the person is a member of */
    via?: string;
    type: string;
    activation: string;
}

/** The rows of one verdict, with what that verdict means */
export interface NoActivationPdfSection {
    group: StateGroup;
    title: string;
    note: string;
    rows: NoActivationPdfRow[];
}

/** The data `NoActivationReportDocument` draws */
export interface NoActivationPdfData {
    title: string;
    subtitle: string;
    tenantName: string;
    /** The block on the first page, label and value; it holds the honesty text */
    meta: { label: string; value: string }[];
    totals: AuditPdfTotal[];
    /** One per verdict that has rows, the warnings first; together they hold every row of the view */
    sections: NoActivationPdfSection[];
    closingNote: string;
}

export type NoActivationExportFile =
    | { format: "csv" | "json"; fileName: string; mime: string; content: string }
    | { format: "pdf"; fileName: string; mime: string; pdf: NoActivationPdfData };

/** The order of the sections: what needs a look first, what cannot be activated last */
const PDF_SECTIONS: readonly { group: StateGroup; title: string; note: string }[] = [
    { group: "none", title: "No activation", note: "Eligible, assigned before the period, and not activated in it." },
    { group: "new", title: "Assigned in the period", note: "Eligible and not activated, but they had less than the period to do so." },
    { group: "notRead", title: "Not judged", note: "The data to judge these is missing, so this is no verdict." },
    { group: "activated", title: "Activated", note: "Eligible, and activated in the period." },
    { group: "na", title: "Do not activate", note: "Active already, or held by a group, an app or an agent: no activation to look for." },
];

/** Under its own heading the cell of "Do not activate" does not repeat that it is not applicable */
function pdfActivation(row: NoActivationRow): string {
    const own = row.activationText.replace(/^Not applicable: /, "");
    return own.charAt(0).toUpperCase() + own.slice(1);
}

function buildNoActivationPdf(input: NoActivationExportInput, heading: Heading, namer: Namer | null): NoActivationPdfData {
    const counts = countNoActivation(input.rows);
    const tenantName = heading.tenant.name ?? heading.tenant.id;
    const isAzure = input.rows.some((row) => row.scopeLevel !== undefined);
    const scopes = new Set(input.rows.map((row) => row.scopeName));
    const onlyScope = scopes.size === 1 ? [...scopes][0] : undefined;
    // Directory is the default scope of Entra: when scopes differ and one is Directory, name it once and show only the others
    const defaultScope = onlyScope === undefined && scopes.has("Directory") ? "Directory" : undefined;
    const sharedScope = onlyScope || defaultScope;
    const toRow = (row: NoActivationRow): NoActivationPdfRow => ({
        resource: row.resourceName,
        ...(row.scopeName && row.scopeName !== sharedScope ? { scope: row.scopeName } : {}),
        who: namer && row.isPerson ? namer.labelOf(row.who, row.whoId) : row.who,
        isEmergency: row.isEmergency,
        ...(row.viaGroup ? { via: `Through ${row.viaGroup}` } : {}),
        type: row.typeText,
        activation: pdfActivation(row),
    });
    return {
        title: "Audit report: no activation",
        subtitle: `Assignments in ${isAzure ? "Azure roles" : "Entra roles and PIM for Groups"}, and whether they were activated, for tenant ${tenantName}.`,
        tenantName,
        meta: [
            { label: "Tenant", value: heading.tenant.name ? `${heading.tenant.name} (${heading.tenant.id})` : heading.tenant.id },
            { label: "Period", value: `${minuteUtc(heading.period.from)} to ${minuteUtc(heading.period.to)}` },
            { label: "Source", value: `${heading.source}. Oldest event available: ${heading.oldestAvailable}` },
            { label: "Read", value: minuteUtc(heading.readAt) },
            { label: "Exported", value: `${minuteUtc(heading.exportedAt)}${heading.exporter ? ` by ${heading.exporter}` : ""}` },
            { label: "Filters", value: heading.filters },
            ...(onlyScope ? [{ label: "Scope", value: `${onlyScope}, for every assignment` }] : []),
            ...(defaultScope ? [{ label: "Scope", value: `${defaultScope}, unless a row names another` }] : []),
            { label: "Not read", value: `${heading.notRead}. ${AUDIT_LATE_EVENTS_NOTE}` },
            { label: "Reading this", value: input.honesty },
        ],
        // The five groups of the sentence: they add up to the rows of the table
        totals: [
            { label: "No activation", value: counts.none, note: "Assigned before the period" },
            { label: "Assigned in the period", value: counts.new, note: "Had less than the period" },
            { label: "Activated", value: counts.activated, note: "" },
            { label: "Do not activate", value: counts.na, note: "Active, held by a group or an app" },
            { label: "Not judged", value: counts.notRead, note: "Data missing, see Not read" },
        ],
        sections: PDF_SECTIONS.map((section) => ({ ...section, rows: input.rows.filter((row) => stateGroupOf(row.state) === section.group).map(toRow) })).filter((section) => section.rows.length > 0),
        closingNote: AUDIT_PDF_CLOSING_NOTE,
    };
}

interface IdleColumn {
    header: string;
    /** Left out when names are replaced: the id of a person */
    personal?: boolean;
    /** Azure files only; left out when names are replaced, as every scope id is */
    azureId?: boolean;
    value: (row: NoActivationRow, namer: Namer | null) => Cell;
}

const optionalIso = (value: string | undefined): string | undefined => (value ? isoUtc(value) : undefined);

/** The columns of the No activation file, in this order, as CSV headers and JSON keys */
export const NO_ACTIVATION_EXPORT_COLUMNS: readonly IdleColumn[] = [
    { header: "Role or group", value: (r) => text(r.resourceName) },
    { header: "Role id", value: (r) => text(r.resourceId) },
    { header: "Scope", value: (r) => text(r.scopeName) },
    { header: "Who", value: (r, namer) => (namer && r.isPerson ? namer.labelOf(r.who, r.whoId) : text(r.who)) },
    { header: "Who id", personal: true, value: (r) => text(r.whoId) },
    { header: "Through group", value: (r) => text(r.viaGroup) },
    { header: "Type", value: (r) => r.typeText },
    { header: "State", value: (r) => STATE_GROUP_WORDS[stateGroupOf(r.state)] },
    { header: "Activation", value: (r) => r.activationText },
    { header: "Last activated (UTC)", value: (r) => optionalIso(r.lastActivated) },
    { header: "Assigned (UTC)", value: (r) => optionalIso(r.assignedAt) },
    { header: "Ends (UTC)", value: (r) => optionalIso(r.endsAt) },
    { header: "Emergency access", value: (r) => r.isEmergency },
];

const NO_ACTIVATION_AZURE_COLUMNS: readonly IdleColumn[] = [
    { header: "Scope level", value: (r) => (r.scopeLevel ? AZURE_SCOPE_LEVEL_LABELS[r.scopeLevel] : undefined) },
    { header: "Scope id", azureId: true, value: (r) => text(r.scopeId) },
];

/** The columns of one file: Azure rows add the scope level and the scope id after Scope; replaced names leave out ids */
function noActivationColumns(rows: readonly NoActivationRow[], replaceNames: boolean): IdleColumn[] {
    const isAzure = rows.some((row) => row.scopeLevel !== undefined);
    const all = isAzure ? NO_ACTIVATION_EXPORT_COLUMNS.flatMap((column) => (column.header === "Scope" ? [column, ...NO_ACTIVATION_AZURE_COLUMNS] : [column])) : [...NO_ACTIVATION_EXPORT_COLUMNS];
    return all.filter((column) => !(replaceNames && (column.personal || column.azureId)));
}

/** The sentence of the filters of this view: the environment, Who, Privileged only, and on Azure the scope level and the scope bar (the search is added to the heading) */
export function describeNoActivationFilter(state: Pick<AuditUrlState, "env" | "who" | "privileged" | "level">, unjudged = 0, scopeBar = ""): string {
    return describeAuditFilter({ kinds: [...AUDIT_KINDS], env: state.env, who: state.who, privileged: state.privileged, failed: false, level: state.level }, undefined, unjudged, 0, scopeBar);
}

/** "12 assignments, 2026-10-06 to 2026-11-05, with the current filters." */
export function describeNoActivationScope(count: number, period: { from: Date; to: Date }): string {
    return `${count} ${count === 1 ? "assignment" : "assignments"}, ${dayUtc(period.from)} to ${dayUtc(period.to)}, with the current filters.`;
}

export function planNoActivationExport(input: NoActivationExportInput, choice: NoActivationExportChoice): NoActivationExportFile {
    const { replaceNames } = choice;
    const namer = replaceNames ? buildNamer(input.rows.filter((row) => row.isPerson).map((row) => ({ name: row.who, id: row.whoId }))) : null;
    const heading = headingWith(input, replaceNames, namer);
    const columns = noActivationColumns(input.rows, replaceNames);
    const stem = `${auditExportStem(input.tenant.name, input.exportedAt)}-no-activation`;
    if (choice.format === "pdf") return { format: "pdf", fileName: `${stem}.pdf`, mime: "application/pdf", pdf: buildNoActivationPdf(input, heading, namer) };
    if (choice.format === "csv") {
        const lines = [
            ...headingLines(heading).map((line) => escapeCsvCell(line)),
            escapeCsvCell(`# View: No activation. ${input.honesty}`),
            columns.map((column) => escapeCsvCell(column.header)).join(","),
            ...input.rows.map((row) => columns.map((column) => csvCell(column.value(row, namer))).join(",")),
        ];
        return { format: "csv", fileName: `${stem}.csv`, mime: "text/csv;charset=utf-8", content: lines.join("\r\n") + "\r\n" };
    }
    const meta = {
        schemaVersion: 1,
        view: "noActivation",
        tenant: { id: heading.tenant.id, ...(heading.tenant.name ? { name: heading.tenant.name } : {}) },
        period: heading.period,
        source: heading.source,
        oldestEventAvailable: heading.oldestAvailable,
        readAt: heading.readAt,
        exportedAt: heading.exportedAt,
        ...(heading.exporter ? { exportedBy: heading.exporter } : {}),
        filters: heading.filters,
        notRead: heading.notRead,
        note: AUDIT_LATE_EVENTS_NOTE,
        honesty: input.honesty,
        assignmentCount: input.rows.length,
    };
    const assignments = input.rows.map((row) => {
        const out: Record<string, string | number | boolean> = {};
        for (const column of columns) {
            const value = column.value(row, namer);
            if (value !== undefined) out[column.header] = value;
        }
        return out;
    });
    return { format: "json", fileName: `${stem}.json`, mime: "application/json", content: JSON.stringify({ meta, assignments }, null, 2) + "\n" };
}
