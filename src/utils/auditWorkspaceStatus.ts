/**
 * What a read or a check of one Log Analytics workspace means (implementation spec section 7). Pure: the error class of the
 * workspace service and the rules that turn an error or an answer into a status the pages can show. The class lives here,
 * not in the service, because utils may not import services.
 */
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";

/** A non-2xx answer of the Log Analytics API, or a 200 whose body holds an error (a partial result): never read as complete */
export class LogAnalyticsError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly headers: Headers;

    constructor(statusCode: number, code: string, message: string, headers: Headers = new Headers()) {
        super(message);
        this.name = "LogAnalyticsError";
        this.statusCode = statusCode;
        this.code = code;
        this.headers = headers;
    }
}

/** The error a 200 answer carries (`{ error: { code, message } }`), or null when it has none. A partial result is an error here. */
export function answerError(body: unknown): { code: string; message: string } | null {
    if (typeof body !== "object" || body === null || !("error" in body)) return null;
    const error = (body as { error?: unknown }).error;
    if (error === null || error === undefined) return null;
    if (typeof error === "object") {
        const { code, message } = error as { code?: unknown; message?: unknown };
        return { code: typeof code === "string" ? code : "PartialError", message: typeof message === "string" ? message : "The answer holds an error." };
    }
    return { code: "PartialError", message: "The answer holds an error." };
}

/** What the check of one workspace found */
export type WorkspaceCheck =
    /** `isLimited`: a condition on the rows lets the reader see only part of the table */
    | { kind: "connected"; oldest: string; newest: string; isLimited?: true }
    | { kind: "noLogs" }
    /** `status` null: the workspace answered, but this table may not be read (a 200 without data) */
    | { kind: "noAccess"; status: number | null }
    | { kind: "failed"; detail: string };

/** What the check of one workspace found for each of its two logs (AU-18) */
export interface WorkspaceLogsCheck {
    entra: WorkspaceCheck;
    azure: WorkspaceCheck;
    /** Lower case ids of the subscriptions that send to this workspace; empty when the Azure check did not connect */
    subscriptionIds: string[];
}

/** The code `toLogAnalyticsError` gives a query on a table that is not there */
export const TABLE_NOT_FOUND = "TableNotFound";

/** The code of a query on a table the reader may not read */
export const TABLE_ACCESS_DENIED = "TableAccessDenied";

/** The tables of a permission block under `key`, lower case; empty when the block is missing or not as expected */
function permissionTables(body: unknown, key: "denyTables" | "conditionalTables"): Set<string> {
    const permissions = typeof body === "object" && body !== null ? (body as { permissions?: unknown }).permissions : undefined;
    const dataSources = typeof permissions === "object" && permissions !== null ? (permissions as { dataSources?: unknown }).dataSources : undefined;
    const names = new Set<string>();
    if (!Array.isArray(dataSources)) return names;
    for (const source of dataSources) {
        const list = typeof source === "object" && source !== null ? (source as Record<string, unknown>)[key] : undefined;
        if (Array.isArray(list)) for (const name of list) if (typeof name === "string") names.add(name.toLowerCase());
    }
    return names;
}

/**
 * True when the permission block of an answer (`Prefer: include-permissions=true`) lists `table` as denied. Measured
 * 2026-11-25 with table-level access and with granular RBAC: a denied table answers 200 without data, the same as an empty
 * one; with full access the block holds `allowTables` only. A condition on rows does not show here. Without a readable block nothing is known to be denied.
 */
export function isTableDenied(body: unknown, table: string): boolean {
    return permissionTables(body, "denyTables").has(table.toLowerCase());
}

/**
 * True when the permission block lists `table` under `conditionalTables`: a condition on its rows (granular RBAC) lets the
 * reader see only part of it. Measured 2026-11-26; the key is not documented on Learn or in the REST spec, so without it
 * nothing is known to be limited and the app reads as before.
 */
export function isTableLimited(body: unknown, table: string): boolean {
    return permissionTables(body, "conditionalTables").has(table.toLowerCase());
}

/**
 * The code of an error answer. Measured on a real workspace: a table that is not there answers 400 `BadArgumentError` with
 * an inner `SEM0100` ("Failed to resolve table or column expression"). The query names no column that can be missing (the
 * table reference page lists them all), so here that means the table, which comes with the first log.
 */
export function logAnalyticsErrorCode(body: unknown): string {
    let current: unknown = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    const top = typeof current === "object" && current !== null ? (current as { code?: unknown }).code : undefined;
    for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
        if ((current as { code?: unknown }).code === "SEM0100") return TABLE_NOT_FOUND;
        current = (current as { innererror?: unknown }).innererror;
    }
    return typeof top === "string" ? top : "Unknown";
}

/**
 * The failure of a workspace call as a check. 401 and 403 are "no access" to the workspace; a table that is denied on its own
 * answers 200 and comes here as `TABLE_ACCESS_DENIED`; a missing table is "no audit logs yet"; anything else is a named failure
 * with the status and code.
 */
export function checkFromError(error: unknown): Exclude<WorkspaceCheck, { kind: "connected" }> {
    if (getErrorCode(error) === TABLE_NOT_FOUND) return { kind: "noLogs" };
    if (getErrorCode(error) === TABLE_ACCESS_DENIED) return { kind: "noAccess", status: null };
    const status = getErrorStatusCode(error);
    if (status === 401 || status === 403) return { kind: "noAccess", status };
    const code = getErrorCode(error);
    const parts = [status !== undefined ? `HTTP ${status}` : "", code ?? ""].filter(Boolean);
    return { kind: "failed", detail: parts.length > 0 ? parts.join(" ") : "no answer" };
}

/** The check of a workspace from the oldest and newest event of its AuditLogs table; no event is "no audit logs yet" */
export function checkFromTimes(times: { oldest: string | null; newest: string | null }, isLimited = false): WorkspaceCheck {
    // A table the reader sees only part of, with no row in that part: not a table without logs, but rows that may not be read
    if (!(times.oldest && times.newest)) return isLimited ? { kind: "noAccess", status: null } : { kind: "noLogs" };
    return { kind: "connected", oldest: times.oldest, newest: times.newest, ...(isLimited ? { isLimited: true as const } : {}) };
}

/** A short reason for a failed read of a workspace, for the banner and the export: the status and code, never a message */
export function failureReason(error: unknown): string {
    if (getErrorCode(error) === TABLE_NOT_FOUND) return "no audit logs yet";
    if (getErrorCode(error) === TABLE_ACCESS_DENIED) return "no access to the table";
    const status = getErrorStatusCode(error);
    const code = getErrorCode(error);
    if (status !== undefined) return code && status !== 403 ? `${status} ${code}` : String(status);
    return code ?? "no answer";
}
