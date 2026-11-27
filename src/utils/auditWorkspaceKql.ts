/**
 * The KQL the Audit page sends to a Log Analytics workspace (implementation spec section 7), and the check of a workspace id
 * before it reaches a URL. Pure. The query is built by the app from a whole number of days and fixed text only: nothing a
 * person typed, and nothing from a response, ever becomes part of it.
 */
import { AUDIT_ROW_LIMIT } from "@/utils/auditErrors";

/** The most interactive retention a workspace can have (Learn, Azure Monitor Logs: 30 to 730 days); the longest period a read asks for when the retention is not known */
export const WORKSPACE_MAX_DAYS = 730;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether the text is a GUID, as a workspace `customerId` is */
export function isWorkspaceId(value: unknown): value is string {
    return typeof value === "string" && GUID.test(value);
}

/**
 * The workspace id of what a person typed or pasted: trimmed, in lower case, or null when it is not a GUID. Anything else
 * (a URL, a resource id, a name, a quote) gives null, so it can never reach a URL.
 */
export function normalizeWorkspaceId(text: string): string | null {
    const trimmed = text.trim();
    return GUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

/**
 * The columns the read asks for, in this order: an explicit list, so nothing else of a row enters the app. Measured on a real
 * workspace: `TenantId` is the workspace, the Entra tenant is `AADTenantId`; `ActivityDateTime` is when it happened.
 */
export const WORKSPACE_COLUMNS = [
    "Id", "ActivityDateTime", "Category", "CorrelationId", "Result", "ResultReason", "ActivityDisplayName",
    "LoggedByService", "InitiatedBy", "TargetResources", "AdditionalDetails", "AADTenantId",
] as const;

/**
 * The audit read: the PIM rows and the Core Directory role changes of the last `days` days, the same two sets as the Graph
 * read. `take` stops one row past the limit, so a period that holds too many is told as too many and never cut quietly.
 */
export function buildAuditQuery(days: number): string {
    if (!Number.isInteger(days) || days < 1 || days > WORKSPACE_MAX_DAYS) {
        throw new Error(`buildAuditQuery: days must be a whole number from 1 to ${WORKSPACE_MAX_DAYS}.`);
    }
    return [
        "AuditLogs",
        `| where TimeGenerated >= ago(${days}d)`,
        "| where LoggedByService == 'PIM' or (LoggedByService == 'Core Directory' and Category == 'RoleManagement')",
        `| project ${WORKSPACE_COLUMNS.join(", ")}`,
        `| take ${AUDIT_ROW_LIMIT + 1}`,
    ].join("\n");
}

/** The tables the queries read: asked for by name in the permission block of an answer */
export const AUDIT_LOGS_TABLE = "AuditLogs";
export const AZURE_ACTIVITY_TABLE = "AzureActivity";

/** The check: the oldest and the newest event of the whole AuditLogs table (null values when it holds none) */
export const CHECK_QUERY = "AuditLogs\n| summarize Oldest = min(TimeGenerated), Newest = max(TimeGenerated)";

/**
 * The check of the Azure activity log: per subscription that sends to this workspace its oldest and newest event, so one query
 * gives the dates and "x of the y subscriptions". Measured on a real workspace (azure audit research, section 15); the cost on
 * a large workspace is not.
 */
export const AZURE_CHECK_QUERY = "AzureActivity\n| summarize Oldest = min(TimeGenerated), Newest = max(TimeGenerated) by SubscriptionId";
