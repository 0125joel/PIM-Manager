import { buildContosoAzure } from "@/demo/contoso/azure";
import type { DemoActivityRow } from "@/demo/contoso/azureAudit";
import { CONTOSO_TENANT_ID, demoGuid } from "@/demo/contoso/ids";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { DEMO_ACTIVITY_REACH_DAYS, DEMO_ACTIVITY_SUBSCRIPTIONS, DEMO_WORKSPACES } from "@/demo/contoso/workspaces";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { AZURE_CHECK_QUERY, CHECK_QUERY, WORKSPACE_COLUMNS } from "@/utils/auditWorkspaceKql";
import { AZURE_ACTIVITY_COLUMNS, AZURE_WORKSPACE_MAX_DAYS, buildAzureActivityQuery } from "@/utils/azureWorkspaceActivity";

/**
 * A Log Analytics API that lives in the browser (AU-9). It answers `POST /v1/workspaces/{customerId}/query` for the
 * two queries the app builds, in the shape of the API (`tables` with `columns` and `rows`, dynamic columns as JSON text).
 * The first workspace holds the demo's audit log, the second has the table with no event, the third denies the query, and
 * the fourth holds the Azure activity log (`AzureActivity`) with the demo's authorization rows, some of them older than 90 days.
 * Anything else answers 404 and is reported through `onUnhandled`, so the demo test fails on a new query.
 */

export interface LogAnalyticsRequest {
    method: string;
    url: string;
    body?: unknown;
}

export interface LogAnalyticsResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}

export interface FakeLogAnalytics {
    handle(request: LogAnalyticsRequest): LogAnalyticsResponse;
}

const json = (status: number, body: unknown): LogAnalyticsResponse => ({ status, headers: { "content-type": "application/json" }, body });
/** What a workspace answers on a table it does not have (measured on a real workspace) */
const noTable = (): LogAnalyticsResponse => json(400, { error: { code: "BadArgumentError", message: "The request had some invalid properties", innererror: { code: "SemanticError", message: "A semantic error occurred.", innererror: { code: "SEM0100", message: "Failed to resolve table or column expression" } } } });
const PATH = /^\/v1\/workspaces\/([0-9a-f-]{36})\/query$/i;
const DAYS = /^AuditLogs\n\| where TimeGenerated >= ago\((\d+)d\)\n/;
const DAY_MS = 86_400_000;
const ACTIVITY_QUERY = /^AzureActivity\n\| where TimeGenerated >= ago\((\d+)d\)\n/;
/** The demo's activity rows are relative to the time of the build: a copy this many days back is older than the 90 days of ARM */
const OLDER_COPY_DAYS = 120;
/** The status words of the workspace for the status of ARM (measured: `Start` and `Success` in the workspace) */
const WORKSPACE_STATUS: Record<string, string> = { Started: "Start", Succeeded: "Success", Failed: "Failure", Accepted: "Accept" };
/** The first workspace misses every 11th row (from the 6th) that the Entra audit log has, so the demo shows what Graph adds */
const MISSES = (index: number) => index % 11 === 5;

function toTableRow(row: RawDirectoryAudit): unknown[] {
    return [
        row.id, row.activityDateTime, row.category, row.correlationId, row.result, row.resultReason ?? "", row.activityDisplayName,
        row.loggedByService, JSON.stringify(row.initiatedBy), JSON.stringify(row.targetResources), JSON.stringify(row.additionalDetails), CONTOSO_TENANT_ID,
    ];
}

/** One row of the workspace: the event id is a different one, the times and the statuses are the workspace's own */
function toAzureTableRow(row: DemoActivityRow, time: string): unknown[] {
    const status = typeof row.status === "object" && row.status !== null ? String((row.status as { value?: unknown }).value ?? "") : "";
    const claims = (row.claims ?? {}) as Record<string, unknown>;
    const properties = (row.properties ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return [
        demoGuid(`law:activity:${row.eventDataId}:${time}`), text(row.correlationId), time, text(row.caller), text(row.resourceId), text(row.subscriptionId),
        row.operationName.value.toUpperCase(), WORKSPACE_STATUS[status] ?? status, text(claims.appid), text(properties.requestbody), text(properties.responseBody), text(properties.statusMessage),
    ];
}

/** The authorization rows of the two subscriptions that send to the `activity` workspace, and an older copy of each */
function demoActivityRows(now: Date): { time: string; row: DemoActivityRow }[] {
    const sending = new Set(DEMO_ACTIVITY_SUBSCRIPTIONS.map((key) => demoGuid(`azure:sub:${key}`).toLowerCase()));
    const rows = buildContosoAzure(now).audit.activity.filter((row) => typeof row.subscriptionId === "string" && sending.has(row.subscriptionId.toLowerCase()));
    const copies = rows.map((row) => ({ time: new Date(Date.parse(row.eventTimestamp) - OLDER_COPY_DAYS * DAY_MS).toISOString(), row }));
    return [...rows.map((row) => ({ time: row.eventTimestamp, row })), ...copies];
}

export function createFakeLogAnalytics(now: () => Date = () => new Date(), options: { onUnhandled?: (request: LogAnalyticsRequest) => void } = {}): FakeLogAnalytics {
    // Built once a minute: the demo's rows are relative to the time of the answer
    let activityCache: { minute: number; rows: { time: string; row: DemoActivityRow }[] } | null = null;
    const activityRows = (): { time: string; row: DemoActivityRow }[] => {
        const minute = Math.floor(now().getTime() / 60_000);
        if (activityCache?.minute !== minute) activityCache = { minute, rows: demoActivityRows(now()) };
        return activityCache.rows;
    };
    const answer = (request: LogAnalyticsRequest): LogAnalyticsResponse => {
        const url = new URL(request.url);
        const match = PATH.exec(url.pathname);
        const query = (request.body as { query?: unknown } | undefined)?.query;
        if (request.method.toUpperCase() !== "POST" || !match || typeof query !== "string") {
            options.onUnhandled?.(request);
            return json(404, { error: { code: "NotFound", message: "The demo has no answer for this request." } });
        }
        const workspace = DEMO_WORKSPACES.find((w) => w.customerId === match[1].toLowerCase());
        if (!workspace) return json(404, { error: { code: "PathNotFoundError", message: "The requested path does not exist" } });
        if (workspace.behavior === "denied") return json(403, { error: { code: "InsufficientAccessError", message: "The provided credentials have insufficient access to perform the requested operation" } });
        // The read of the rows; the check query (AZURE_CHECK_QUERY) is answered below
        if (query.startsWith("AzureActivity\n| where")) {
            const days = Number(ACTIVITY_QUERY.exec(query)?.[1]);
            // Exactly the text the app builds for this number of days: any other query is not answered
            const known = Number.isInteger(days) && days >= 1 && days <= AZURE_WORKSPACE_MAX_DAYS && query === buildAzureActivityQuery(days);
            if (!known) {
                options.onUnhandled?.(request);
                return json(404, { error: { code: "NotFound", message: "The demo has no answer for this query." } });
            }
            if (workspace.behavior !== "activity") return noTable();
            const since = now().getTime() - days * DAY_MS;
            const kept = activityRows().filter((entry) => Date.parse(entry.time) >= since);
            return json(200, {
                tables: [{ name: "PrimaryResult", columns: AZURE_ACTIVITY_COLUMNS.map((name) => ({ name, type: name === "TimeGenerated" ? "datetime" : "string" })), rows: kept.map((entry) => toAzureTableRow(entry.row, entry.time)) }],
            });
        }
        if (query === AZURE_CHECK_QUERY) {
            if (workspace.behavior !== "activity") return noTable();
            const iso = (ms: number) => new Date(ms).toISOString();
            return json(200, {
                tables: [{
                    name: "PrimaryResult",
                    columns: [{ name: "SubscriptionId", type: "string" }, { name: "Oldest", type: "datetime" }, { name: "Newest", type: "datetime" }],
                    rows: DEMO_ACTIVITY_SUBSCRIPTIONS.map((key) => [demoGuid(`azure:sub:${key}`), iso(now().getTime() - DEMO_ACTIVITY_REACH_DAYS * DAY_MS), iso(now().getTime() - DAY_MS)]),
                }],
            });
        }
        if (workspace.behavior === "activity" && query.startsWith("AuditLogs")) return noTable();
        const rows = workspace.behavior === "entra" ? buildDemoAuditRows(now()).filter((_, index) => !MISSES(index)) : [];
        if (query === CHECK_QUERY) {
            const times = rows.map((r) => Date.parse(r.activityDateTime));
            const iso = (ms: number) => new Date(ms).toISOString();
            return json(200, {
                tables: [{ name: "PrimaryResult", columns: [{ name: "Oldest", type: "datetime" }, { name: "Newest", type: "datetime" }], rows: [times.length > 0 ? [iso(Math.min(...times)), iso(Math.max(...times))] : [null, null]] }],
            });
        }
        const days = DAYS.exec(query)?.[1];
        if (!days || !query.includes(`| project ${WORKSPACE_COLUMNS.join(", ")}`)) {
            options.onUnhandled?.(request);
            return json(404, { error: { code: "NotFound", message: "The demo has no answer for this query." } });
        }
        const since = now().getTime() - Number(days) * DAY_MS;
        const kept = rows.filter((r) => Date.parse(r.activityDateTime) >= since && (r.loggedByService === "PIM" || (r.loggedByService === "Core Directory" && r.category === "RoleManagement")));
        return json(200, {
            tables: [{ name: "PrimaryResult", columns: WORKSPACE_COLUMNS.map((name) => ({ name, type: name === "ActivityDateTime" ? "datetime" : "string" })), rows: kept.map(toTableRow) }],
        });
    };
    /** The app asks for the permissions: a reader with access gets the queried table in `allowTables` and no `denyTables` (measured) */
    const handle = (request: LogAnalyticsRequest): LogAnalyticsResponse => {
        const response = answer(request);
        if (response.status !== 200) return response;
        const queried = (request.body as { query: string }).query.split("\n")[0];
        return { ...response, body: { ...(response.body as object), permissions: { dataSources: [{ resourceId: PATH.exec(new URL(request.url).pathname)?.[1] ?? "", allowTables: [queried] }] } } };
    };
    return { handle };
}
