import type { ArmClient } from "@/utils/armClient";
import { LOG_ANALYTICS_BASE_URL } from "@/config/constants";
import { parseRetryAfterMs } from "@/utils/graphClient";
import { AUDIT_LOGS_TABLE, AZURE_ACTIVITY_TABLE, AZURE_CHECK_QUERY, buildAuditQuery, CHECK_QUERY, isWorkspaceId } from "@/utils/auditWorkspaceKql";
import type { WorkspaceRead, WorkspaceRef } from "@/utils/auditWorkspaceMerge";
import { azureActivityCoverage, checkTimes, primaryTable, workspaceTableToRows, type WorkspaceTable } from "@/utils/auditWorkspaceRows";
import { answerError, checkFromError, checkFromTimes, failureReason, isTableDenied, isTableLimited, logAnalyticsErrorCode, LogAnalyticsError, TABLE_ACCESS_DENIED, TABLE_NOT_FOUND, type WorkspaceCheck, type WorkspaceLogsCheck } from "@/utils/auditWorkspaceStatus";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { createConcurrencyGate } from "@/utils/concurrencyGate";
import { armRateLimiter, RateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { listSubscriptions } from "@/services/azureScopeService";

/**
 * The Log Analytics workspaces behind the optional workspace source of the Audit page (implementation spec section 7).
 * Two hosts: the workspaces are listed through Azure Resource Manager (the ARM client, `armRateLimiter`), and queried on the
 * Log Analytics API with a token for `https://api.loganalytics.io` (`POST /v1/workspaces/{customerId}/query`). One query per
 * workspace, never a cross-workspace query: a cross-workspace answer can silently leave out what the user may not read.
 */

/** Workspaces - List By Subscription (Learn, `2023-09-01`); measured 2026-11 to return the retention */
export const WORKSPACES_API_VERSION = "2023-09-01";
/**
 * `GET /providers/microsoft.aadiam/diagnosticSettings`, the settings of the Entra diagnostic export. Measured 2026-11 with
 * this version; Learn does not list the route and the role it needs is unknown, so it is a convenience only.
 */
export const DIAGNOSTIC_SETTINGS_API_VERSION = "2017-04-01-preview";

/** The Log Analytics API allows 200 requests per 30 seconds per user (documented) */
export const logAnalyticsRateLimiter = new RateLimiter(200, 30_000);
/** At most 5 queries run at a time: the limit per user (documented) */
export const WORKSPACE_QUERY_CONCURRENCY = 5;
/** One gate for every query the app sends (Entra and Azure pages, read and check), so the limit holds however they are combined */
const queryGate = createConcurrencyGate(WORKSPACE_QUERY_CONCURRENCY);
const WORKSPACE_QUERY_DELAY_MS = 200;
const DEFAULT_PAUSE_MS = 10_000;

export interface WorkspaceInfo {
    /** The id the query API takes (a GUID) */
    customerId: string;
    name: string;
    /** The ARM resource id */
    id: string;
    subscriptionId: string;
    subscriptionName: string;
    location: string;
    /** Days the workspace keeps its logs; absent when the answer does not say */
    retentionDays?: number;
}

export interface SubscriptionFailure {
    subscriptionId: string;
    name: string;
    /** Status and code only, never a message (an ARM message can hold the user and the scope) */
    reason: string;
}

export interface WorkspaceListing {
    workspaces: WorkspaceInfo[];
    /** Subscriptions whose workspaces could not be listed: the list may miss some, so an empty list is not "none exist" */
    failedSubscriptions: SubscriptionFailure[];
}

interface ArmWorkspace {
    id?: string;
    name?: string;
    location?: string;
    properties?: { customerId?: string; retentionInDays?: number };
}

/**
 * Every workspace the user can list, per subscription, as one list. A subscription that fails is named and the rest is
 * returned. Subscriptions of another tenant (Lighthouse) and ones that are not enabled are left out. Throws when the
 * subscriptions themselves cannot be listed.
 */
export async function listWorkspaces(client: ArmClient, homeTenantId: string | undefined, signal?: AbortSignal): Promise<WorkspaceListing> {
    const subscriptions = (await listSubscriptions(client, signal)).filter((s) =>
        s.state === "Enabled" && (!homeTenantId || !s.tenantId || s.tenantId.toLowerCase() === homeTenantId.toLowerCase()));
    type Outcome = { ok: true; items: WorkspaceInfo[] } | { ok: false; failure: SubscriptionFailure };
    const { results } = await runWorkerPool<(typeof subscriptions)[number], Outcome>({
        items: subscriptions,
        workerCount: 4,
        delayMs: 250,
        // No `rateLimiter`: the client counts every request on `armRateLimiter`, so the pool takes nothing
        signal,
        errorLog: "statusAndCode",
        processor: async (subscription) => {
            try {
                const path = `/subscriptions/${encodeURIComponent(subscription.subscriptionId)}/providers/Microsoft.OperationalInsights/workspaces`;
                const found = await withRetry(
                    () => client.getAll<ArmWorkspace>(path, WORKSPACES_API_VERSION, undefined, { signal }),
                    3, 1000, "auditWorkspace list", armRateLimiter,
                );
                const items: WorkspaceInfo[] = [];
                for (const item of found) {
                    const customerId = item.properties?.customerId;
                    if (!isWorkspaceId(customerId) || typeof item.name !== "string" || typeof item.id !== "string") continue;
                    const retention = item.properties?.retentionInDays;
                    items.push({
                        customerId: customerId.toLowerCase(),
                        name: item.name,
                        id: item.id,
                        subscriptionId: subscription.subscriptionId,
                        subscriptionName: subscription.displayName,
                        location: typeof item.location === "string" ? item.location : "",
                        ...(typeof retention === "number" && retention >= 1 ? { retentionDays: retention } : {}),
                    });
                }
                return { ok: true, items };
            } catch (error: unknown) {
                if (signal?.aborted) throw error;
                Logger.warn("auditWorkspaceService", `Listing workspaces failed for a subscription (${failureReason(error)})`);
                return { ok: false, failure: { subscriptionId: subscription.subscriptionId, name: subscription.displayName, reason: failureReason(error) } };
            }
        },
    });
    if (signal?.aborted) throw new DOMException("The workspace list was cancelled.", "AbortError");
    const workspaces: WorkspaceInfo[] = [];
    const failedSubscriptions: SubscriptionFailure[] = [];
    // In the order of the subscription list, not of completion
    for (const subscription of subscriptions) {
        const outcome = results.get(subscription);
        if (!outcome) failedSubscriptions.push({ subscriptionId: subscription.subscriptionId, name: subscription.displayName, reason: "no answer" });
        else if (outcome.ok) workspaces.push(...outcome.items);
        else failedSubscriptions.push(outcome.failure);
    }
    return fillFromResourceGraph(client, workspaces, failedSubscriptions, signal);
}

interface GraphWorkspace {
    id?: string;
    name?: string;
    location?: string;
    subscriptionId?: string;
    customerId?: string;
    retention?: number;
}

const RESOURCE_GRAPH_API_VERSION = "2022-10-01";
const RESOURCE_GRAPH_QUERY = "Resources | where type =~ 'microsoft.operationalinsights/workspaces' | project id, name, location, subscriptionId, customerId=properties.customerId, retention=properties.retentionInDays";

/**
 * Measured: one subscription answered 404 "not found" on its own list while it was Enabled, and held the workspace that
 * receives the audit log; Resource Graph did list it. So failed subscriptions get one try through Resource Graph. What it
 * finds is added, and only a subscription it answers for stops counting as failed. A failure here changes nothing.
 */
async function fillFromResourceGraph(client: ArmClient, workspaces: WorkspaceInfo[], failed: SubscriptionFailure[], signal?: AbortSignal): Promise<WorkspaceListing> {
    if (failed.length === 0) return { workspaces, failedSubscriptions: failed };
    try {
        const answer = await withRetry(
            () => client.postRead<{ data?: GraphWorkspace[] }>("/providers/Microsoft.ResourceGraph/resources", RESOURCE_GRAPH_API_VERSION, { query: RESOURCE_GRAPH_QUERY, subscriptions: failed.map((f) => f.subscriptionId) }, { signal }),
            3, 1000, "auditWorkspace resourceGraph", armRateLimiter,
        );
        const found = new Set<string>();
        const known = new Set(workspaces.map((w) => w.customerId));
        const names = new Map(failed.map((f) => [f.subscriptionId.toLowerCase(), f.name]));
        for (const item of answer.data ?? []) {
            const subscriptionId = item.subscriptionId?.toLowerCase() ?? "";
            if (!isWorkspaceId(item.customerId) || typeof item.name !== "string" || typeof item.id !== "string" || !names.has(subscriptionId)) continue;
            found.add(subscriptionId);
            const customerId = item.customerId.toLowerCase();
            if (known.has(customerId)) continue;
            known.add(customerId);
            workspaces.push({
                customerId,
                name: item.name,
                id: item.id,
                subscriptionId,
                subscriptionName: names.get(subscriptionId) ?? subscriptionId,
                location: typeof item.location === "string" ? item.location : "",
                ...(typeof item.retention === "number" && item.retention >= 1 ? { retentionDays: item.retention } : {}),
            });
        }
        // A subscription without a result stays failed: an empty answer does not prove it holds none
        return { workspaces, failedSubscriptions: failed.filter((f) => !found.has(f.subscriptionId.toLowerCase())) };
    } catch (error: unknown) {
        if (signal?.aborted) throw error;
        Logger.warn("auditWorkspaceService", `Resource Graph could not fill in the failed subscriptions (${failureReason(error)})`);
        return { workspaces, failedSubscriptions: failed };
    }
}

interface DiagnosticSetting {
    properties?: { workspaceId?: string; logs?: { category?: string; enabled?: boolean }[] };
}

/**
 * The ARM ids (lower case) of the workspaces that the Entra diagnostic settings send the audit log to. A convenience mark
 * only. Throws when it cannot be read; the caller then shows no mark.
 */
export async function listAuditLogWorkspaceIds(client: ArmClient, signal?: AbortSignal): Promise<Set<string>> {
    const settings = await withRetry(
        () => client.getAll<DiagnosticSetting>("/providers/microsoft.aadiam/diagnosticSettings", DIAGNOSTIC_SETTINGS_API_VERSION, undefined, { signal }),
        3, 1000, "auditWorkspace diagnosticSettings", armRateLimiter,
    );
    const ids = new Set<string>();
    for (const setting of settings) {
        const workspaceId = setting.properties?.workspaceId;
        const sendsAudit = (setting.properties?.logs ?? []).some((log) => log.category === "AuditLogs" && log.enabled === true);
        if (typeof workspaceId === "string" && sendsAudit) ids.add(workspaceId.toLowerCase());
    }
    return ids;
}

/**
 * `GET /subscriptions/{id}/providers/Microsoft.Insights/diagnosticSettings`, the diagnostic settings of a subscription. Measured
 * 2026-11 with this version: 200 with no setting. The shape of a setting that sends to a workspace, and the role that reads it,
 * are documented but not measured: the mark stays a convenience, and the check decides the status. Learn lists only
 * `2021-05-01-preview` for subscription diagnostic settings (no diagnostic settings route there has a GA version), so the preview stays.
 */
export const SUBSCRIPTION_DIAGNOSTIC_SETTINGS_API_VERSION = "2021-05-01-preview";

interface SubscriptionDiagnosticSetting {
    properties?: { workspaceId?: unknown; logs?: { category?: string; enabled?: boolean }[] };
}

/**
 * The ARM ids (lower case) of the workspaces that receive the Azure activity log of the given subscriptions: a setting with the
 * `Administrative` category enabled. A convenience mark only. A subscription that fails is left out without a message; when
 * none of them could be read the answer is null, so no mark is shown. Throws only on an abort.
 */
export async function listActivityLogWorkspaceIds(client: ArmClient, subscriptionIds: readonly string[], signal?: AbortSignal): Promise<Set<string> | null> {
    const { results } = await runWorkerPool<string, string[]>({
        items: [...subscriptionIds],
        workerCount: 4,
        delayMs: 250,
        // No `rateLimiter`: the client counts every request on `armRateLimiter`, so the pool takes nothing
        signal,
        errorLog: "statusAndCode",
        processor: async (subscriptionId) => {
            const settings = await withRetry(
                () => client.getAll<SubscriptionDiagnosticSetting>(`/subscriptions/${encodeURIComponent(subscriptionId)}/providers/Microsoft.Insights/diagnosticSettings`, SUBSCRIPTION_DIAGNOSTIC_SETTINGS_API_VERSION, undefined, { signal }),
                3, 1000, "auditWorkspace subscription diagnosticSettings", armRateLimiter,
            );
            const ids: string[] = [];
            for (const setting of settings) {
                const workspaceId = setting.properties?.workspaceId;
                const sendsActivity = (setting.properties?.logs ?? []).some((log) => log.category === "Administrative" && log.enabled === true);
                if (typeof workspaceId === "string" && sendsActivity) ids.push(workspaceId.toLowerCase());
            }
            return ids;
        },
    });
    if (signal?.aborted) throw new DOMException("The workspace mark was cancelled.", "AbortError");
    if (results.size === 0) return null;
    const ids = new Set<string>();
    for (const found of results.values()) for (const id of found) ids.add(id);
    return ids;
}

export interface WorkspaceQueryOptions {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
}

interface TableQueryOptions extends WorkspaceQueryOptions {
    /** The table the query reads: when the reader may not read it the query fails with `TABLE_ACCESS_DENIED` */
    table?: string;
}

async function toLogAnalyticsError(response: Response): Promise<LogAnalyticsError> {
    let code = "Unknown";
    let message = `The Log Analytics API answered HTTP ${response.status}`;
    try {
        const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
        code = logAnalyticsErrorCode(body);
        if (typeof body?.error?.message === "string") message = body.error.message;
    } catch {
        // No JSON envelope: keep the status-based message
    }
    return new LogAnalyticsError(response.status, code, message, response.headers);
}

/**
 * One query on one workspace. The workspace id must be a GUID and is checked before it reaches the URL; the query text is
 * built by the caller from fixed text (`auditWorkspaceKql.ts`). A 200 whose body holds an error (a partial result) is a
 * failure, never a complete answer. Log Analytics answers a table the reader may not read with 200 and no data, so every query
 * asks for the permissions too and a denied `table` is a failure, never an empty log. The caller wraps it in `withRetry(..., logAnalyticsRateLimiter)` where it retries.
 */
export async function queryWorkspace(getToken: () => Promise<string>, customerId: string, query: string, options: TableQueryOptions = {}): Promise<WorkspaceTable> {
    if (!isWorkspaceId(customerId)) throw new Error("queryWorkspace: the workspace id must be a GUID.");
    const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    await logAnalyticsRateLimiter.acquire(1, options.signal);
    const token = await getToken();
    const response = await queryGate.run(() => fetchImpl(`${LOG_ANALYTICS_BASE_URL}/v1/workspaces/${customerId.toLowerCase()}/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "include-permissions=true" },
        body: JSON.stringify({ query }),
        signal: options.signal,
    }), options.signal);
    if (response.status === 429) logAnalyticsRateLimiter.backOff(parseRetryAfterMs(response.headers.get("Retry-After")) ?? DEFAULT_PAUSE_MS);
    if (!response.ok) throw await toLogAnalyticsError(response);
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        throw new LogAnalyticsError(response.status, "UnreadableAnswer", "The Log Analytics API answered without readable JSON.", response.headers);
    }
    const inBody = answerError(body);
    if (inBody) throw new LogAnalyticsError(response.status, inBody.code, inBody.message, response.headers);
    if (options.table && isTableDenied(body, options.table)) throw new LogAnalyticsError(response.status, TABLE_ACCESS_DENIED, "The table may not be read.", response.headers);
    const table = primaryTable(body);
    if (!table) throw new LogAnalyticsError(response.status, "UnexpectedAnswer", "The answer holds no table.", response.headers);
    // A condition on the rows: the answer is real but partial, and the caller says so (the permission block is never kept)
    return options.table && isTableLimited(body, options.table) ? { ...table, isLimited: true } : table;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new DOMException("The workspace read was cancelled.", "AbortError");
}

/** Runs one query with the retries of services/AGENTS.md (429 and 5xx only) */
function retried(getToken: () => Promise<string>, customerId: string, query: string, options: TableQueryOptions, name: string): Promise<WorkspaceTable> {
    return withRetry(() => queryWorkspace(getToken, customerId, query, options), 3, 1000, name, logAnalyticsRateLimiter);
}

/** Logs the status and code only: a message can hold tenant data */
function warnFailure(error: unknown): void {
    Logger.warn("auditWorkspaceService", `A workspace query failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
}

/**
 * Reads the audit rows of the last `days` days from each workspace, at most 5 at a time, and returns one read per
 * workspace in the order given. A workspace that fails does not stop the others. A workspace whose rows could not all be
 * understood keeps the count. Throws only on an abort.
 */
export async function readWorkspaces(getToken: () => Promise<string>, workspaces: readonly WorkspaceRef[], days: number, options: WorkspaceQueryOptions = {}): Promise<WorkspaceRead[]> {
    const query = buildAuditQuery(days);
    const { results } = await runWorkerPool<WorkspaceRef, WorkspaceRead>({
        items: [...workspaces],
        workerCount: WORKSPACE_QUERY_CONCURRENCY,
        delayMs: WORKSPACE_QUERY_DELAY_MS,
        signal: options.signal,
        errorLog: "statusAndCode",
        processor: async (workspace) => {
            try {
                // The read and the check run together; the check never decides a failure of the read
                const [read, check] = await Promise.allSettled([
                    retried(getToken, workspace.customerId, query, { ...options, table: AUDIT_LOGS_TABLE }, "auditWorkspace read"),
                    retried(getToken, workspace.customerId, CHECK_QUERY, { ...options, table: AUDIT_LOGS_TABLE }, "auditWorkspace reach"),
                ]);
                if (read.status === "rejected") throw read.reason;
                const adapted = workspaceTableToRows(read.value);
                // Rows came and none could be understood: the columns are not what the app reads, so this is a failure
                if (adapted.rows.length === 0 && adapted.dropped > 0) {
                    return { workspace, ok: false, reason: "rows not understood" };
                }
                let oldestAuditEvent: string | null | undefined;
                try {
                    if (check.status === "rejected") throw check.reason;
                    oldestAuditEvent = checkTimes(check.value).oldest;
                } catch (error: unknown) {
                    if (options.signal?.aborted) throw error;
                    // The reach is a refinement: without it the oldest row read is used
                    warnFailure(error);
                }
                const isLimited = read.value.isLimited === true || (check.status === "fulfilled" && check.value.isLimited === true);
                // The table is there but holds no event at all (measured, AU-17: a workspace that receives only the Azure log has an
                // empty AuditLogs table): it holds only the other log, as when the table is missing, so it counts as no table.
                // With a condition on the rows nothing can be said about the rest: no row may be read, a failure that is named
                if (adapted.rows.length === 0 && oldestAuditEvent === null) {
                    return isLimited ? { workspace, ok: false, reason: "no access to the rows" } : { workspace, ok: false, reason: "holds no Entra audit logs", noTable: true };
                }
                return { workspace, ok: true, rows: adapted.rows, dropped: adapted.dropped, oldestAuditEvent, ...(isLimited ? { limitedLogs: ["Entra audit log" as const] } : {}) };
            } catch (error: unknown) {
                if (options.signal?.aborted) throw error;
                warnFailure(error);
                // A workspace without the AuditLogs table holds only the other log: not a failure when another workspace was read
                if (getErrorCode(error) === TABLE_NOT_FOUND) return { workspace, ok: false, reason: failureReason(error), noTable: true };
                return { workspace, ok: false, reason: failureReason(error) };
            }
        },
    });
    throwIfAborted(options.signal);
    return workspaces.map((workspace) => results.get(workspace) ?? { workspace, ok: false, reason: "no answer" });
}

/** One log of a workspace judged on its own: its check, and the subscriptions that send to it (Azure only) */
interface JudgedLog {
    check: WorkspaceCheck;
    subscriptionIds: string[];
}

/** Reads one log's query and judges it. A failure is judged as that log's own failure, never the other log's. Throws only on an abort. */
async function judgeLog(read: () => Promise<WorkspaceTable>, judge: (table: WorkspaceTable) => JudgedLog, options: WorkspaceQueryOptions): Promise<JudgedLog> {
    try {
        return judge(await read());
    } catch (error: unknown) {
        if (options.signal?.aborted) throw error;
        warnFailure(error);
        return { check: checkFromError(error), subscriptionIds: [] };
    }
}

/**
 * The check of each workspace for each of its logs (AU-18): the Entra audit log from `AuditLogs` and the Azure activity log from
 * `AzureActivity`, two queries one after the other per workspace, at most 5 workspaces at a time. Each log is connected with its
 * oldest and newest event, has no events yet, is refused, or is a named failure. Throws only on an abort.
 */
export async function checkWorkspaceLogs(getToken: () => Promise<string>, customerIds: readonly string[], options: WorkspaceQueryOptions = {}): Promise<Map<string, WorkspaceLogsCheck>> {
    const { results } = await runWorkerPool<string, WorkspaceLogsCheck>({
        items: [...customerIds],
        workerCount: WORKSPACE_QUERY_CONCURRENCY,
        delayMs: WORKSPACE_QUERY_DELAY_MS,
        signal: options.signal,
        errorLog: "statusAndCode",
        processor: async (customerId) => {
            const entra = await judgeLog(
                () => retried(getToken, customerId, CHECK_QUERY, { ...options, table: AUDIT_LOGS_TABLE }, "auditWorkspace check"),
                (table) => ({ check: checkFromTimes(checkTimes(table), table.isLimited === true), subscriptionIds: [] }),
                options,
            );
            const azure = await judgeLog(
                () => retried(getToken, customerId, AZURE_CHECK_QUERY, { ...options, table: AZURE_ACTIVITY_TABLE }, "auditWorkspace azure check"),
                (table) => {
                    const coverage = azureActivityCoverage(table);
                    const check = checkFromTimes(coverage, table.isLimited === true);
                    return { check, subscriptionIds: check.kind === "connected" ? coverage.subscriptionIds : [] };
                },
                options,
            );
            return { entra: entra.check, azure: azure.check, subscriptionIds: azure.subscriptionIds };
        },
    });
    throwIfAborted(options.signal);
    const checks = new Map<string, WorkspaceLogsCheck>();
    const failed: WorkspaceCheck = { kind: "failed", detail: "no answer" };
    for (const id of customerIds) checks.set(id, results.get(id) ?? { entra: failed, azure: failed, subscriptionIds: [] });
    return checks;
}
