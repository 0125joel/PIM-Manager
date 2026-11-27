/**
 * The adapter from a Log Analytics `tables` answer to the raw rows `mapAuditEvents` reads (implementation spec section 7),
 * so the mapper stays the only mapper. Pure: no request, no state. Only the projected columns are read; anything else in a
 * row never enters the app.
 *
 * Measured on a real workspace (2026-11-05): the dynamic columns arrive as JSON text, with camelCase keys, the same as Graph.
 * An object and another casing are accepted too, because the route and version can differ.
 */
import type { RawAuditDetail, RawAuditTarget, RawDirectoryAudit, RawModifiedProperty } from "@/types/audit.types";

export interface WorkspaceColumn {
    name: string;
    type?: string;
}

/** One table of a query answer: `columns` name the positions of each row */
export interface WorkspaceTable {
    name?: string;
    columns: WorkspaceColumn[];
    rows: unknown[][];
    /** A condition on the rows lets the reader see only part of the queried table (`isTableLimited`) */
    isLimited?: true;
}

/** A row ready for the mapper, with the tenant the workspace says it belongs to (empty when it says nothing) */
export interface WorkspaceRow {
    raw: RawDirectoryAudit;
    tenantId: string;
}

export interface AdaptedRows {
    rows: WorkspaceRow[];
    /** Rows that could not be read (no id, no time, no activity): not shown, and counted so the page can say so */
    dropped: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first table of an answer (the primary result), or null when the answer holds none */
export function primaryTable(body: unknown): WorkspaceTable | null {
    if (!isRecord(body) || !Array.isArray(body.tables)) return null;
    const tables = body.tables.filter(isRecord);
    const table = tables.find((t) => t.name === "PrimaryResult") ?? tables[0];
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return null;
    const columns: WorkspaceColumn[] = [];
    for (const column of table.columns) {
        if (!isRecord(column) || typeof column.name !== "string") return null;
        columns.push({ name: column.name, type: typeof column.type === "string" ? column.type : undefined });
    }
    return { name: typeof table.name === "string" ? table.name : undefined, columns, rows: table.rows.filter(Array.isArray) as unknown[][] };
}

/** The value of a key whatever its casing */
function pick(source: Record<string, unknown>, name: string): unknown {
    if (name in source) return source[name];
    const lower = name.toLowerCase();
    const key = Object.keys(source).find((k) => k.toLowerCase() === lower);
    return key === undefined ? undefined : source[key];
}

/** A dynamic column as a value: a JSON string is parsed, an object or array is taken as it is, anything else is nothing */
function dynamic(value: unknown): unknown {
    if (typeof value !== "string") return value ?? undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return undefined;
    }
}

function str(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function nullableStr(value: unknown): string | null | undefined {
    return value === null ? null : str(value);
}

function list(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

function initiatedBy(value: unknown): RawDirectoryAudit["initiatedBy"] {
    const source = dynamic(value);
    if (!isRecord(source)) return {};
    const result: RawDirectoryAudit["initiatedBy"] = {};
    const user = pick(source, "user");
    if (isRecord(user)) result.user = { id: nullableStr(pick(user, "id")), displayName: nullableStr(pick(user, "displayName")) };
    const app = pick(source, "app");
    if (isRecord(app)) result.app = { displayName: nullableStr(pick(app, "displayName")) };
    return result;
}

function modifiedProperties(value: unknown): RawModifiedProperty[] {
    return list(value).map((property) => ({
        displayName: nullableStr(pick(property, "displayName")),
        oldValue: nullableStr(pick(property, "oldValue")),
        newValue: nullableStr(pick(property, "newValue")),
    }));
}

function targetResources(value: unknown): RawAuditTarget[] {
    return list(dynamic(value)).map((target) => ({
        type: nullableStr(pick(target, "type")),
        id: nullableStr(pick(target, "id")),
        displayName: nullableStr(pick(target, "displayName")),
        userPrincipalName: nullableStr(pick(target, "userPrincipalName")),
        modifiedProperties: modifiedProperties(pick(target, "modifiedProperties")),
    }));
}

function additionalDetails(value: unknown): RawAuditDetail[] {
    const details: RawAuditDetail[] = [];
    for (const detail of list(dynamic(value))) {
        const key = str(pick(detail, "key"));
        if (key) details.push({ key, value: nullableStr(pick(detail, "value")) });
    }
    return details;
}

/** An ISO 8601 UTC time, the form Graph gives, from what the workspace sends; null when it is no time */
function isoTime(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Rows of a table to raw audit rows. A row that cannot be read is dropped and counted, never thrown. */
export function workspaceTableToRows(table: WorkspaceTable): AdaptedRows {
    const index = new Map<string, number>();
    table.columns.forEach((column, position) => index.set(column.name.toLowerCase(), position));
    const cell = (row: unknown[], name: string): unknown => {
        const position = index.get(name.toLowerCase());
        return position === undefined ? undefined : row[position];
    };
    const rows: WorkspaceRow[] = [];
    let dropped = 0;
    for (const row of table.rows) {
        const id = str(cell(row, "Id"));
        const time = isoTime(cell(row, "ActivityDateTime"));
        const activity = str(cell(row, "ActivityDisplayName"));
        if (!id || !time || !activity) {
            dropped++;
            continue;
        }
        rows.push({
            raw: {
                id,
                category: str(cell(row, "Category")) ?? "",
                correlationId: str(cell(row, "CorrelationId")) ?? "",
                result: str(cell(row, "Result")) ?? "",
                resultReason: nullableStr(cell(row, "ResultReason")) ?? null,
                activityDisplayName: activity,
                activityDateTime: time,
                loggedByService: str(cell(row, "LoggedByService")) ?? "",
                initiatedBy: initiatedBy(cell(row, "InitiatedBy")),
                targetResources: targetResources(cell(row, "TargetResources")),
                additionalDetails: additionalDetails(cell(row, "AdditionalDetails")),
            },
            tenantId: (str(cell(row, "AADTenantId")) ?? "").trim().toLowerCase(),
        });
    }
    return { rows, dropped };
}

/** What the check of the Azure activity log found in one workspace: its reach, and the subscriptions that send to it (lower case) */
export interface AzureActivityCoverage {
    oldest: string | null;
    newest: string | null;
    subscriptionIds: string[];
}

/** The answer of `AZURE_CHECK_QUERY`, one row per subscription, as one reach. A row without a subscription or a time adds nothing. */
export function azureActivityCoverage(table: WorkspaceTable): AzureActivityCoverage {
    const position = (name: string) => table.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
    const [subscription, oldestAt, newestAt] = [position("SubscriptionId"), position("Oldest"), position("Newest")];
    let oldest: string | null = null;
    let newest: string | null = null;
    const subscriptionIds = new Set<string>();
    for (const row of table.rows) {
        const id = subscription < 0 ? undefined : str(row[subscription])?.trim().toLowerCase();
        const from = oldestAt < 0 ? null : isoTime(row[oldestAt]);
        const to = newestAt < 0 ? null : isoTime(row[newestAt]);
        if (!id || !from || !to) continue;
        subscriptionIds.add(id);
        if (oldest === null || from < oldest) oldest = from;
        if (newest === null || to > newest) newest = to;
    }
    return { oldest, newest, subscriptionIds: [...subscriptionIds] };
}

/** The oldest and newest time of the check query, as ISO times; null when the table holds nothing */
export function checkTimes(table: WorkspaceTable): { oldest: string | null; newest: string | null } {
    const row = table.rows[0];
    if (!row) return { oldest: null, newest: null };
    const find = (name: string): string | null => {
        const position = table.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
        return position < 0 ? null : isoTime(row[position]);
    };
    return { oldest: find("Oldest"), newest: find("Newest") };
}
