import { buildAzureActivityQuery, azureActivityTableToRows, type AzureWorkspaceRead } from "@/utils/azureWorkspaceActivity";
import { azureActivityCoverage, type WorkspaceTable } from "@/utils/auditWorkspaceRows";
import type { WorkspaceRef } from "@/utils/auditWorkspaceMerge";
import { AZURE_ACTIVITY_TABLE, AZURE_CHECK_QUERY, isWorkspaceId } from "@/utils/auditWorkspaceKql";
import { failureReason, TABLE_NOT_FOUND } from "@/utils/auditWorkspaceStatus";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { logAnalyticsRateLimiter, queryWorkspace, WORKSPACE_QUERY_CONCURRENCY, type WorkspaceQueryOptions } from "@/services/auditWorkspaceService";

/**
 * The Azure activity log of the chosen Log Analytics workspaces, for the Azure Audit page (AU-19). One query per workspace on
 * `AzureActivity` with the explicit column list of `azureWorkspaceActivity.ts`, and one check query for the subscriptions that
 * send to it. The same limit, pool and retries as the Entra read (`auditWorkspaceService.ts`). A workspace that fails does not
 * stop the others; only an abort throws.
 */

const DELAY_MS = 200;
const RETRY_ATTEMPTS = 3;
const RETRY_PAUSE_MS = 1000;

function warnFailure(error: unknown): void {
    Logger.warn("azureAuditWorkspaceService", `A workspace query failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
}

/** One query with the retries of services/AGENTS.md (429 and 5xx only) */
function queried(getToken: () => Promise<string>, customerId: string, query: string, options: WorkspaceQueryOptions, name: string): Promise<WorkspaceTable> {
    return withRetry(() => queryWorkspace(getToken, customerId, query, { ...options, table: AZURE_ACTIVITY_TABLE }), RETRY_ATTEMPTS, RETRY_PAUSE_MS, name, logAnalyticsRateLimiter);
}

/**
 * Reads the Azure activity log of the last `days` days from each workspace, at most 5 at a time, and returns one read per
 * workspace in the order given. A workspace without an AzureActivity table is `noTable`, not a failure of its own. Throws only
 * on an abort.
 */
export async function readAzureWorkspaces(getToken: () => Promise<string>, workspaces: readonly WorkspaceRef[], days: number, options: WorkspaceQueryOptions = {}): Promise<AzureWorkspaceRead[]> {
    const query = buildAzureActivityQuery(days);
    const { results } = await runWorkerPool<WorkspaceRef, AzureWorkspaceRead>({
        items: [...workspaces],
        workerCount: WORKSPACE_QUERY_CONCURRENCY,
        delayMs: DELAY_MS,
        signal: options.signal,
        errorLog: "statusAndCode",
        processor: async (workspace) => {
            if (!isWorkspaceId(workspace.customerId)) return { workspace, ok: false, reason: "no workspace id" };
            try {
                // The read and the check run together; the check never decides a failure of the read
                const [read, check] = await Promise.allSettled([
                    queried(getToken, workspace.customerId, query, options, "azureAuditWorkspace read"),
                    queried(getToken, workspace.customerId, AZURE_CHECK_QUERY, options, "azureAuditWorkspace check"),
                ]);
                if (read.status === "rejected") throw read.reason;
                const adapted = azureActivityTableToRows(read.value);
                // Rows came and none could be understood: the columns are not what the app reads, so this is a failure
                if (adapted.rows.length === 0 && adapted.dropped > 0) return { workspace, ok: false, reason: "rows not understood" };
                let subscriptionIds: string[] | null = null;
                let oldest: string | null = null;
                try {
                    if (check.status === "rejected") throw check.reason;
                    const coverage = azureActivityCoverage(check.value);
                    subscriptionIds = coverage.subscriptionIds;
                    oldest = coverage.oldest;
                } catch (error: unknown) {
                    if (options.signal?.aborted) throw error;
                    // The check is a refinement: the subscriptions are then unknown, and the reach is the oldest row read
                    warnFailure(error);
                }
                const isLimited = read.value.isLimited === true || (check.status === "fulfilled" && check.value.isLimited === true);
                return { workspace, ok: true, rows: adapted.rows, dropped: adapted.dropped, subscriptionIds, oldest, ...(isLimited ? { limitedLogs: ["Azure activity log" as const] } : {}) };
            } catch (error: unknown) {
                if (options.signal?.aborted) throw error;
                warnFailure(error);
                if (getErrorCode(error) === TABLE_NOT_FOUND) return { workspace, ok: false, reason: "no activity log yet", noTable: true };
                return { workspace, ok: false, reason: failureReason(error) };
            }
        },
    });
    if (options.signal?.aborted) throw new DOMException("The workspace read was cancelled.", "AbortError");
    return workspaces.map((workspace): AzureWorkspaceRead => results.get(workspace) ?? { workspace, ok: false, reason: "no answer" });
}
