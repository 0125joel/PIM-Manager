/**
 * The Azure activity log of a Log Analytics workspace (AzureActivity), read next to the Azure Audit page's own reads (AU-19).
 * Pure: the query text, the adapter from a `tables` answer to the raw rows the Azure mapper reads, the merge with the
 * native reads, and how the reads of several workspaces combine with the Entra reads. No request, no state.
 *
 * The column names of AzureActivity are documented (Microsoft Learn, 2026-07); that the extraction works on a real
 * workspace is not measured yet. Only the named columns enter the app: never CallerIpAddress, HTTPRequest, Authorization,
 * or the whole of Properties_d or Claims_d. A test asserts this on the query text.
 */
import type { RawActivityEvent } from "@/types/audit.types";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import type { LimitedLog, WorkspaceRef } from "@/utils/auditWorkspaceMerge";
import type { WorkspaceTable } from "@/utils/auditWorkspaceRows";

/** The longest period the Azure Audit page reads from a workspace (the page offers up to a year with one) */
export const AZURE_WORKSPACE_MAX_DAYS = 365;

/** The Activity Log of the Azure Audit page reads at most this far back from the Azure side: the Activity Log keeps 90 days */
export const ACTIVITY_LOG_DAYS = 90;

/** The columns the read asks for, in this order: an explicit list, so nothing else of a row enters the app */
export const AZURE_ACTIVITY_COLUMNS = [
    "EventDataId", "CorrelationId", "TimeGenerated", "Caller", "ResourceId", "SubscriptionId", "OperationNameValue",
    "ActivityStatusValue", "AppId", "RequestBody", "ResponseBody", "StatusMessage",
] as const;

/**
 * The authorization rows of the activity log, for the last `days` days. Built from fixed text and a whole number of days
 * only; anything else throws. `startswith` ignores case in KQL. `take` stops one row past the limit, so a period that holds
 * too many is told as too many and never cut quietly.
 */
export function buildAzureActivityQuery(days: number): string {
    if (!Number.isInteger(days) || days < 1 || days > AZURE_WORKSPACE_MAX_DAYS) {
        throw new Error(`buildAzureActivityQuery: days must be a whole number from 1 to ${AZURE_WORKSPACE_MAX_DAYS}.`);
    }
    // Column names are documented (Learn, 2026-07) and the extraction is not measured: check it on a real workspace (AU-17)
    return [
        "AzureActivity",
        `| where TimeGenerated >= ago(${days}d)`,
        "| where OperationNameValue startswith 'MICROSOFT.AUTHORIZATION/'",
        `| project ${[
            "EventDataId", "CorrelationId", "TimeGenerated", "Caller", "ResourceId = coalesce(ResourceId, _ResourceId)", "SubscriptionId", "OperationNameValue", "ActivityStatusValue",
            "AppId = tostring(Claims_d.appid)", "RequestBody = tostring(Properties_d.requestbody)", "ResponseBody = tostring(Properties_d.responseBody)", "StatusMessage = tostring(Properties_d.statusMessage)",
        ].join(", ")}`,
        `| take ${AUDIT_ROW_LIMIT + 1}`,
    ].join("\n");
}

/**
 * The status words of the workspace as the Activity Log of the native read writes them (measured: `Start` and `Success` in the
 * workspace, `Started` and `Succeeded` in ARM). Compared without case; anything else is kept as it is.
 */
const STATUS_WORDS: Record<string, string> = { start: "Started", success: "Succeeded", failure: "Failed", accept: "Accepted" };

export function normalizeStatusWord(value: string): string {
    return STATUS_WORDS[value.trim().toLowerCase()] ?? value;
}

function cellOf(table: WorkspaceTable): (row: unknown[], name: string) => unknown {
    const index = new Map<string, number>();
    table.columns.forEach((column, position) => index.set(column.name.toLowerCase(), position));
    return (row, name) => {
        const position = index.get(name.toLowerCase());
        return position === undefined ? undefined : row[position];
    };
}

function text(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** An ISO 8601 UTC time from what the workspace sends; null when it is no time */
function isoTime(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A dynamic column as text: an empty one is nothing, so the mapper reads the field as missing */
function optionalText(value: unknown): string | undefined {
    const plain = text(value);
    return plain === undefined || plain.trim() === "" ? undefined : plain;
}

export interface AzureActivityAdapted {
    rows: RawActivityEvent[];
    /** Rows that could not be read (no event id, no valid time, no operation): not shown, and counted */
    dropped: number;
}

/**
 * The rows of an AzureActivity answer to the raw Activity Log rows the Azure mapper reads (`toRawActivityEvent`'s shape). A
 * row without an event id, a valid time or an operation is dropped and counted, never thrown. Only the named columns are
 * read; the mapper and the merge see the same fields as in the native read.
 */
export function azureActivityTableToRows(table: WorkspaceTable): AzureActivityAdapted {
    const cell = cellOf(table);
    const rows: RawActivityEvent[] = [];
    let dropped = 0;
    for (const row of table.rows) {
        const eventDataId = text(cell(row, "EventDataId"))?.trim() ?? "";
        const time = isoTime(cell(row, "TimeGenerated"));
        const operation = text(cell(row, "OperationNameValue"))?.trim() ?? "";
        if (eventDataId === "" || time === null || operation === "") {
            dropped++;
            continue;
        }
        const status = optionalText(cell(row, "ActivityStatusValue"));
        rows.push({
            eventDataId,
            correlationId: text(cell(row, "CorrelationId")) ?? "",
            eventTimestamp: time,
            caller: text(cell(row, "Caller")) ?? "",
            resourceId: text(cell(row, "ResourceId")) ?? "",
            subscriptionId: text(cell(row, "SubscriptionId")) ?? "",
            operationName: { value: operation },
            status: status === undefined ? undefined : { value: normalizeStatusWord(status) },
            claims: { appid: optionalText(cell(row, "AppId")) },
            properties: {
                requestbody: optionalText(cell(row, "RequestBody")),
                responseBody: optionalText(cell(row, "ResponseBody")),
                statusMessage: optionalText(cell(row, "StatusMessage")),
            },
        });
    }
    return { rows, dropped };
}

/** The read of one workspace's Activity Log: its rows, or why it was not read. `noTable`: the workspace holds no AzureActivity table. */
export type AzureWorkspaceRead =
    | { workspace: WorkspaceRef; ok: true; rows: RawActivityEvent[]; dropped: number; subscriptionIds: string[] | null; oldest: string | null; limitedLogs?: LimitedLog[] }
    | { workspace: WorkspaceRef; ok: false; reason: string; noTable?: boolean };

export interface MergedActivity {
    rows: RawActivityEvent[];
    /** The workspace name of each kept row, by its event id in lower case (the id the mapper gives the event) */
    workspaceOf: Map<string, string>;
    /** Rows left out because the native read or an earlier workspace already had them */
    duplicates: number;
}

/**
 * The key of one action, without `EventDataId` and without its time: the event id does not match between the native read and
 * a workspace (measured, 0 of 12). Operation and status without case, and the correlation id without case. The time is
 * compared apart, within `SAME_ACTION_MS`.
 */
function actionKey(row: RawActivityEvent): string {
    const operation = (row.operationName?.value ?? "").trim().toLowerCase();
    const status = (row.status?.value ?? "").trim().toLowerCase();
    const correlation = (row.correlationId ?? "").trim().toLowerCase();
    return [operation, status, correlation].join("|");
}

/**
 * How far apart the two logs may put one action. Measured on AU-17: 0 to 62.5 ms over 20 rows. Rounding to the second split
 * an action that fell across a second boundary into two rows; a window under one second does not, and still keeps two
 * writes a second or more apart as two.
 */
const SAME_ACTION_MS = 1000;

function timeOf(row: RawActivityEvent): number {
    return Date.parse(row.eventTimestamp ?? "");
}

function isSameMoment(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return !Number.isFinite(a) && !Number.isFinite(b);
    return Math.abs(a - b) < SAME_ACTION_MS;
}

/**
 * Merges the native Activity Log rows with the rows of the workspaces. One deployment can write several role assignments under
 * one correlation id in one second, on different resources, and those are different events, so rows are counted, never
 * collapsed: each row already kept can stand for at most one row of each workspace. All native rows are kept. A workspace row
 * that finds a kept row of the same action within `SAME_ACTION_MS`, not yet taken by that workspace, is a duplicate; otherwise
 * it is kept. Throws AuditTooManyEventsError past `limit`, and when one source alone passes it.
 */
export function mergeAzureActivity(restRows: readonly RawActivityEvent[], reads: readonly AzureWorkspaceRead[], limit: number = AUDIT_ROW_LIMIT): MergedActivity {
    if (restRows.length > limit) throw new AuditTooManyEventsError(limit);
    const rows: RawActivityEvent[] = [...restRows];
    const kept = new Map<string, number[]>();
    for (const row of restRows) {
        const key = actionKey(row);
        const times = kept.get(key) ?? [];
        times.push(timeOf(row));
        kept.set(key, times);
    }
    const workspaceOf = new Map<string, string>();
    let duplicates = 0;
    for (const read of reads) {
        if (!read.ok) continue;
        // The rows that could not be understood were in the answer too: they count for the stop of the query
        if (read.rows.length + read.dropped > limit) throw new AuditTooManyEventsError(limit);
        // Per key, the positions in `kept` this workspace has matched or added: each stands for one of its rows only
        const taken = new Map<string, Set<number>>();
        for (const row of read.rows) {
            const key = actionKey(row);
            const time = timeOf(row);
            const times = kept.get(key) ?? [];
            const used = taken.get(key) ?? new Set<number>();
            const match = times.findIndex((other, index) => !used.has(index) && isSameMoment(other, time));
            if (match >= 0) {
                used.add(match);
                taken.set(key, used);
                duplicates++;
                continue;
            }
            times.push(time);
            used.add(times.length - 1);
            kept.set(key, times);
            taken.set(key, used);
            rows.push(row);
            workspaceOf.set((row.eventDataId ?? "").trim().toLowerCase(), read.workspace.name);
            if (rows.length > limit) throw new AuditTooManyEventsError(limit);
        }
    }
    return { rows, workspaceOf, duplicates };
}

/** The earliest time a workspace's Activity Log reaches back to: its check query, else the earliest row read; null when neither */
export function azureWorkspaceReach(reads: readonly AzureWorkspaceRead[]): string | null {
    let earliest: number | null = null;
    for (const read of reads) {
        if (!read.ok) continue;
        if (read.oldest) {
            const ms = Date.parse(read.oldest);
            if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
            continue;
        }
        for (const row of read.rows) {
            const ms = Date.parse(row.eventTimestamp ?? "");
            if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
        }
    }
    return earliest === null ? null : new Date(earliest).toISOString();
}

/** One workspace's reads of both logs, as the summary of the page counts them */
export interface CombinedWorkspaceRead {
    workspace: WorkspaceRef;
    ok: boolean;
    reason?: string;
    noTable?: boolean;
    dropped: number;
    limitedLogs?: LimitedLog[];
}

/**
 * The reads of both logs per workspace, as one read each: a workspace counts as read when either log was read. It fails only
 * when neither was: its reason is the failure of the log that does not simply lack its table, and it is a missing table only
 * when both lack theirs (a workspace with one of the logs is not a failure, as Settings says).
 */
export function combineWorkspaceReads(
    entra: readonly { workspace: WorkspaceRef; ok: boolean; reason?: string; noTable?: boolean; dropped?: number; limitedLogs?: readonly LimitedLog[] }[],
    azure: readonly { workspace: WorkspaceRef; ok: boolean; reason?: string; noTable?: boolean; dropped?: number; limitedLogs?: readonly LimitedLog[] }[],
): CombinedWorkspaceRead[] {
    return entra.map((first, index) => {
        const second = azure[index];
        const dropped = (first.ok ? first.dropped ?? 0 : 0) + (second?.ok ? second.dropped ?? 0 : 0);
        const limitedLogs = [...(first.ok ? first.limitedLogs ?? [] : []), ...(second?.ok ? second.limitedLogs ?? [] : [])];
        if (first.ok || second?.ok) return { workspace: first.workspace, ok: true, dropped, ...(limitedLogs.length > 0 ? { limitedLogs } : {}) };
        const bothNoTable = first.noTable === true && second?.noTable === true;
        const reasonFrom = first.noTable !== true ? first : second && second.noTable !== true ? second : first;
        return { workspace: first.workspace, ok: false, reason: reasonFrom.reason ?? "no answer", noTable: bothNoTable, dropped };
    });
}

/** One log of a workspace that failed while its other log was read: the workspace counts as read, so this is told on its own */
export interface WorkspaceLogFailure {
    name: string;
    log: "Azure activity log" | "Entra audit log";
    reason: string;
}

/**
 * The logs that failed on a workspace whose other log was read. Without this a refused `AzureActivity` next to a readable
 * `AuditLogs` would be a silent gap. A missing table is no failure: the workspace simply does not hold that log.
 */
export function workspaceLogFailures(
    entra: readonly { workspace: WorkspaceRef; ok: boolean; reason?: string; noTable?: boolean }[],
    azure: readonly { workspace: WorkspaceRef; ok: boolean; reason?: string; noTable?: boolean }[],
): WorkspaceLogFailure[] {
    const failures: WorkspaceLogFailure[] = [];
    entra.forEach((first, index) => {
        const second = azure[index];
        if (!second) return;
        if (first.ok && !second.ok && second.noTable !== true) failures.push({ name: first.workspace.name, log: "Azure activity log", reason: second.reason ?? "no answer" });
        if (second.ok && !first.ok && first.noTable !== true) failures.push({ name: first.workspace.name, log: "Entra audit log", reason: first.reason ?? "no answer" });
    });
    return failures;
}

/** The lower case event ids that a workspace read holds, by id: the lookup of the `workspace` of an event */
export function lowerKeys(map: ReadonlyMap<string, string>): Map<string, string> {
    return new Map([...map.entries()].map(([key, name]) => [key.toLowerCase(), name]));
}

/** The Azure side of a read: which subscriptions send to the workspaces, lower case; null when no workspace could say */
export function sendingSubscriptions(reads: readonly AzureWorkspaceRead[]): Set<string> | null {
    // No chosen workspace has the table: that is known, and it is none
    if (reads.length > 0 && reads.every((read) => !read.ok && read.noTable === true)) return new Set();
    let known = false;
    const ids = new Set<string>();
    for (const read of reads) {
        if (!read.ok || read.subscriptionIds === null) continue;
        known = true;
        for (const id of read.subscriptionIds) ids.add(id.trim().toLowerCase());
    }
    return known ? ids : null;
}
