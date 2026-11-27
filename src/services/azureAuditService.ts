import type { RawActivityEvent, RawArmRequest } from "@/types/audit.types";
import { ArmError, type ArmClient } from "@/utils/armClient";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import { toRawActivityEvent, toRawArmRequest } from "@/utils/azureAuditEvents";
import { dedupeActivity, filtersRequestsToScope, isAtOrBelowScope, isAuthorizationOperation, type AzureAuditNotRead, type AzureAuditNotReadReason, type AzureAuditPlan } from "@/utils/azureAuditRead";
import { AZURE_READ_BELOW_BUDGET, createRequestBudget, planBelowListing, planBelowReading, type BelowItem, type BelowTarget } from "@/utils/azureReadBelow";
import { topReadableScopes } from "@/utils/azureScopes";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { activityLogRateLimiter, armRateLimiter, type RateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { runWorkerPool, type WorkerPoolOptions } from "@/utils/workerPool";
import { AUTHORIZATION_API_VERSION } from "./azureAssignmentService";
import { listResourceGroups, listResources } from "./azureScopeService";

export type { AzureAuditNotRead, AzureAuditNotReadReason } from "@/utils/azureAuditRead";
export { AuditTooManyEventsError } from "@/utils/auditErrors";

/**
 * The reads behind the Azure Audit page: the Activity Log of the authorization provider per subscription, per management
 * group and at the tenant, and the role assignment and eligibility schedule requests per scope. ARM only; the log routes
 * take the client with `activityLogRateLimiter`, the rest the session client. A failed read never gives a partial list:
 * a scope the user may not read is told in `notRead`, any other failure throws.
 */

/** Activity Logs - List, at a subscription and at the tenant (measured 2026-11-07) */
export const ACTIVITY_LOG_API_VERSION = "2015-04-01";
/**
 * The management group route of the Activity Log; `resourceProvider` in its filter answers 400 (measured 2026-11-07). It is a
 * preview because Learn lists no management group route for the Activity Log and no GA version: only `2017-03-01-preview`
 * works on this route (`2015-04-01` answers UnsupportedApiVersion, measured), so the preview stays.
 */
export const MANAGEMENT_GROUP_LOG_API_VERSION = "2017-03-01-preview";

const LOG_PATH = "/providers/Microsoft.Insights/eventtypes/management/values";
const REQUESTS_PATH = "/providers/Microsoft.Authorization";
const MAX_PAGES = 2000;
const WORKERS = 4;
const DELAY_MS = 250;
/** The caller's own requests only (Learn, Role Assignment Schedule Requests - List For Scope) */
const OWN_REQUESTS_FILTER = "asTarget()";

export interface AzureAuditReadInput {
    client: ArmClient;
    logClient: ArmClient;
    plan: AzureAuditPlan;
    /** ISO 8601 in UTC */
    from: string;
    to: string;
    signal?: AbortSignal;
    /** The running count of kept rows over the whole load */
    onRows?: (total: number) => void;
    onProgress?: (done: number, total: number) => void;
}

export interface AzureAuditRawRead {
    activity: RawActivityEvent[];
    assignmentRequests: RawArmRequest[];
    eligibilityRequests: RawArmRequest[];
    notRead: AzureAuditNotRead[];
    /** How many reads were tried, and how many of them were not read */
    tried: number;
    /** How many of the requests came only from the `asTarget()` read: the user's own, on scopes the user cannot read */
    ownRequestCount: number;
}

interface LogJob {
    scopeId: string;
    path: string;
    apiVersion: string;
    filter: string;
    /** The management group and tenant answers hold other providers too: keep only the authorization operations */
    authorizationOnly: boolean;
}

interface OwnRequests {
    assignments: RawArmRequest[];
    eligibilities: RawArmRequest[];
}

function abortError(): DOMException {
    return new DOMException("The audit read was cancelled.", "AbortError");
}

/** 400 `InsufficientPermissions` is refused, 403 forbidden, 404 gone; anything else is a failure */
function reasonOf(error: unknown): Exclude<AzureAuditNotReadReason, "budget"> | null {
    const status = getErrorStatusCode(error);
    if (status === 400 && error instanceof ArmError && error.code === "InsufficientPermissions") return "refused";
    if (status === 403) return "forbidden";
    if (status === 404) return "gone";
    return null;
}

const subscriptionScope = (id: string) => `/subscriptions/${id}`;

/**
 * Reads the audit sources of the period `from` to `to`. Throws on a failed read (no partial list), on more than
 * AUDIT_ROW_LIMIT kept rows (`AuditTooManyEventsError`) and on an abort.
 */
export async function readAzureAudit(input: AzureAuditReadInput): Promise<AzureAuditRawRead> {
    if (input.signal?.aborted) throw abortError();
    const local = new AbortController();
    const follow = () => local.abort();
    input.signal?.addEventListener("abort", follow, { once: true });
    try {
        return await run(input, local);
    } finally {
        input.signal?.removeEventListener("abort", follow);
    }
}

async function run(input: AzureAuditReadInput, local: AbortController): Promise<AzureAuditRawRead> {
    const { plan } = input;
    const activity: RawActivityEvent[] = [];
    const assignmentRequests: RawArmRequest[] = [];
    const eligibilityRequests: RawArmRequest[] = [];
    const notRead: AzureAuditNotRead[] = [];
    let tried = 0;
    let kept = 0;
    let done = 0;
    let total = 0;
    let fatal: unknown;
    let failure: unknown;

    const progress = (finished: number) => {
        done = Math.max(done, finished);
        input.onProgress?.(done, total);
    };
    /** Stops everything with this error; the first one wins and is thrown after the running reads end */
    const stopWith = (error: unknown, isLimit: boolean) => {
        if (isLimit) fatal ??= error;
        else failure ??= error;
        local.abort();
    };
    const throwIfStopped = () => {
        if (fatal) throw fatal;
        if (failure) throw failure;
        if (input.signal?.aborted) throw abortError();
    };
    /** The own-request read starts with the first pool; when the read is stopped it ends first, then the error is thrown */
    let ownRead: Promise<OwnRequests | null> = Promise.resolve(null);
    const throwWhenStopped = async () => {
        try {
            throwIfStopped();
        } catch (error: unknown) {
            await ownRead;
            throw error;
        }
    };
    /** Finished items per pool: the pools run together, so the count is their sum */
    let logDone = 0;
    let requestsDone = 0;
    let belowDone = 0;

    /** One list read with retry. `fn` starts empty each attempt, so a retry does not count a row twice. */
    async function readRows<T>(client: ArmClient, limiter: RateLimiter, name: string, path: string, apiVersion: string, query: Record<string, string> | undefined, convert: (row: unknown) => T | null): Promise<T[]> {
        const rows: T[] = [];
        try {
            return await withRetry(async () => {
                kept -= rows.length;
                rows.length = 0;
                await client.getAll<unknown>(path, apiVersion, query, {
                    signal: local.signal,
                    maxPages: MAX_PAGES,
                    onPage: (page) => {
                        for (const row of page) {
                            const item = convert(row);
                            if (item === null) continue;
                            rows.push(item);
                            kept++;
                        }
                        input.onRows?.(kept);
                        if (kept > AUDIT_ROW_LIMIT) {
                            Logger.warn("azureAuditService", `The Azure audit read stopped: more than ${AUDIT_ROW_LIMIT} events in this period.`);
                            const error = new AuditTooManyEventsError(AUDIT_ROW_LIMIT);
                            stopWith(error, true);
                            throw error;
                        }
                    },
                });
                return rows;
            }, 3, 1000, name, limiter);
        } catch (error: unknown) {
            // A read that gave nothing keeps none of its rows
            kept -= rows.length;
            throw error;
        }
    }

    /** An error of a read: told as not read, or the end of the whole read. An abort or a stop goes on as it is. */
    function classify(error: unknown, name: string): Exclude<AzureAuditNotReadReason, "budget"> {
        if (local.signal.aborted) throw error;
        const reason = reasonOf(error);
        if (reason) return reason;
        // An ARM message can hold names: log status and code only
        Logger.warn("azureAuditService", `${name} failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
        stopWith(error, false);
        throw error;
    }

    function pool<TItem, TResult>(options: Pick<WorkerPoolOptions<TItem, TResult>, "items" | "processor" | "onItemComplete" | "onProgress">) {
        return runWorkerPool<TItem, TResult>({ workerCount: WORKERS, delayMs: DELAY_MS, signal: local.signal, errorLog: "statusAndCode", ...options });
    }

    // 1. The log (read together with step 2 and the user's own requests, below) ---------------------------------------------------------------------------------------------------------------------------------------------
    const window = `eventTimestamp ge '${input.from}' and eventTimestamp le '${input.to}'`;
    const withProvider = `${window} and resourceProvider eq 'Microsoft.Authorization'`;
    const logJobs: LogJob[] = [
        ...plan.subscriptionIds.map((id): LogJob => ({
            scopeId: subscriptionScope(id),
            path: `${subscriptionScope(encodeURIComponent(id))}${LOG_PATH}`,
            apiVersion: ACTIVITY_LOG_API_VERSION,
            filter: withProvider,
            authorizationOnly: false,
        })),
        // `resourceProvider` answers 400 on this route
        ...plan.managementGroupIds.map((id): LogJob => ({ scopeId: id, path: `${id}${LOG_PATH}`, apiVersion: MANAGEMENT_GROUP_LOG_API_VERSION, filter: window, authorizationOnly: true })),
        { scopeId: "/", path: LOG_PATH, apiVersion: ACTIVITY_LOG_API_VERSION, filter: withProvider, authorizationOnly: true },
    ];

    const refusedPlan = new Set(plan.refusedSubscriptionIds.map((id) => id.toLowerCase()));
    const requestScopes = [
        ...plan.subscriptionIds.filter((id) => !refusedPlan.has(id.toLowerCase())).map(subscriptionScope),
        ...plan.managementGroupIds,
    ];
    tried += logJobs.length + requestScopes.length;
    total = logJobs.length + requestScopes.length;
    progress(0);

    // 2. The requests --------------------------------------------------------------------------------------------------
    /** Both request lists at one scope; the rows count only when both lists were read */
    async function readRequestLists(scopeId: string): Promise<{ error: unknown } | null> {
        // A read at a subscription or resource group also answers the requests above it: keep only the rows at or beneath the scope read
        const filtersToScope = filtersRequestsToScope(scopeId);
        const read = (list: string) => readRows<RawArmRequest>(input.client, armRateLimiter, `azureAudit ${list}`, `${scopeId}${REQUESTS_PATH}/${list}`, AUTHORIZATION_API_VERSION, undefined, (row) => {
            const request = toRawArmRequest(row);
            if (!request.properties.scope?.trim()) return null;
            return !filtersToScope || isAtOrBelowScope(request.properties.scope, scopeId) ? request : null;
        });
        const [assignments, eligibilities] = await Promise.allSettled([read("roleAssignmentScheduleRequests"), read("roleEligibilityScheduleRequests")]);
        const rejected = assignments.status === "rejected" ? assignments : eligibilities.status === "rejected" ? eligibilities : null;
        if (rejected) {
            for (const settled of [assignments, eligibilities]) if (settled.status === "fulfilled") kept -= settled.value.length;
            return { error: rejected.reason };
        }
        if (assignments.status === "fulfilled") assignmentRequests.push(...assignments.value);
        if (eligibilities.status === "fulfilled") eligibilityRequests.push(...eligibilities.value);
        return null;
    }

    const refusedHere = new Set<string>();
    // What each pool did not read is kept apart while they run together, and joined in the order the steps have always had
    const logNotRead: AzureAuditNotRead[] = [];
    const requestsNotRead: AzureAuditNotRead[] = [];

    // The log, the request lists and the user's own requests do not need each other: they run together
    // No `rateLimiter` on the log pool: the log client acquires per page, and a second count would halve the budget
    ownRead = readOwnRequests();
    await Promise.all([
        pool<LogJob, null>({
            items: logJobs,
            processor: async (job) => {
                try {
                    const rows = await readRows<RawActivityEvent>(input.logClient, activityLogRateLimiter, "azureAudit log", job.path, job.apiVersion, { $filter: job.filter }, (row) => {
                        const event = toRawActivityEvent(row);
                        if (job.authorizationOnly && !isAuthorizationOperation(event.operationName?.value)) return null;
                        return event;
                    });
                    activity.push(...rows);
                } catch (error: unknown) {
                    logNotRead.push({ part: "log", scopeId: job.scopeId, reason: classify(error, "azureAudit log") });
                }
                return null;
            },
            onProgress: (finished) => {
                logDone = finished;
                progress(logDone + requestsDone + belowDone);
            },
        }),
        pool<string, null>({
            items: requestScopes,
            // No `rateLimiter`: the client counts every request on `armRateLimiter`, so the pool takes nothing
            processor: async (scopeId) => {
                const failed = await readRequestLists(scopeId);
                if (!failed) return null;
                const reason = classify(failed.error, "azureAudit requests");
                const isSubscription = scopeId.toLowerCase().startsWith("/subscriptions/");
                if (reason === "refused" && isSubscription) {
                    // Read below it in step 3: this read is replaced by those
                    refusedHere.add(scopeId.slice("/subscriptions/".length));
                    tried--;
                } else requestsNotRead.push({ part: "requests", scopeId, reason });
                return null;
            },
            onProgress: (finished) => {
                requestsDone = finished;
                progress(logDone + requestsDone + belowDone);
            },
        }),
    ]);
    notRead.push(...logNotRead, ...requestsNotRead);
    await throwWhenStopped();

    // 3. Below a refused subscription ------------------------------------------------------------------------------------
    const below = [...new Set([...plan.refusedSubscriptionIds, ...refusedHere])];
    if (below.length > 0) {
        const budget = createRequestBudget(AZURE_READ_BELOW_BUDGET);
        const targets: BelowTarget[] = below.map((subscriptionId) => ({ subscriptionId, scopeIds: null }));
        const listing = planBelowListing(targets, budget);
        const listed = new Map<string, string[]>();
        const listReason = new Map<string, AzureAuditNotReadReason>();
        if (listing.toList.length > 0) {
            await pool<string, string[]>({
                items: listing.toList,
                // No `rateLimiter`: the client counts every request on `armRateLimiter`, so the pool takes nothing
                processor: async (subscriptionId) => {
                    try {
                        const [groups, resources] = await Promise.all([
                            listResourceGroups(input.client, subscriptionId, local.signal),
                            listResources(input.client, subscriptionId, local.signal),
                        ]);
                        return topReadableScopes(groups, resources);
                    } catch (error: unknown) {
                        listReason.set(subscriptionId, classify(error, "azureAudit listing"));
                        return [];
                    }
                },
                onItemComplete: (subscriptionId, scopes) => listed.set(subscriptionId, scopes),
            });
            await throwWhenStopped();
        }

        const toRead = listing.toList.map((subscriptionId) => ({ subscriptionId, scopeIds: listed.get(subscriptionId) ?? [] }));
        const reading = planBelowReading(toRead, budget);
        // What the budget did not reach, and what has nothing readable below it, is told
        for (const subscriptionId of listing.unlisted) {
            notRead.push({ part: "requests", scopeId: subscriptionScope(subscriptionId), reason: "budget" });
            tried++;
        }
        for (const { subscriptionId, scopeIds } of toRead) {
            if (scopeIds.length > 0) continue;
            notRead.push({ part: "requests", scopeId: subscriptionScope(subscriptionId), reason: listReason.get(subscriptionId) ?? "refused" });
            tried++;
        }
        for (const scopeIds of reading.unread.values()) {
            for (const scopeId of scopeIds) {
                notRead.push({ part: "requests", scopeId, reason: "budget" });
                tried++;
            }
        }
        tried += reading.items.length;
        total += reading.items.length;
        if (reading.items.length > 0) {
            await pool<BelowItem, null>({
                items: reading.items,
                // No `rateLimiter`: the client counts every request on `armRateLimiter`, so the pool takes nothing
                processor: async ({ scopeId }) => {
                    const failed = await readRequestLists(scopeId);
                    if (!failed) return null;
                    notRead.push({ part: "requests", scopeId, reason: classify(failed.error, "azureAudit requests below a subscription") });
                    return null;
                },
                onProgress: (finished) => {
                    belowDone = finished;
                    progress(logDone + requestsDone + belowDone);
                },
            });
            await throwWhenStopped();
        }
    }

    await throwWhenStopped();

    // 4. The user's own requests -----------------------------------------------------------------------------------------
    // Both lists once at the root with `asTarget()`: the caller's own requests, also on scopes the caller cannot read
    // (measured 2026-11-11). Never a wider filter: this read must not show another person's request.
    let ownRequestCount = 0;
    const own = await ownRead;
    if (own) {
        let doubled = 0;
        for (const [rows, into] of [[own.assignments, assignmentRequests], [own.eligibilities, eligibilityRequests]] as const) {
            // Read together with the scope lists, so the requests already read are dropped here, by `name`
            const seen = new Set(into.map((request) => request.name.toLowerCase()));
            for (const request of rows) {
                const name = request.name.toLowerCase();
                // Already in a scope list, or the same request twice in the answer itself
                if (seen.has(name)) {
                    doubled++;
                    continue;
                }
                seen.add(name);
                into.push(request);
                ownRequestCount++;
            }
        }
        if (doubled > 0) {
            kept -= doubled;
            input.onRows?.(kept);
        }
    }

    throwIfStopped();
    return { activity: dedupeActivity(activity), assignmentRequests, eligibilityRequests, notRead, tried, ownRequestCount };

    /**
     * Both `asTarget()` lists, or null when either failed: that is not a failure of the page, it is left out. It runs next to the
     * other reads, so it cannot know the requests they read: the caller drops those (by `name`) once every read is in.
     */
    async function readOwnRequests(): Promise<OwnRequests | null> {
        const read = (list: string) => readRows<RawArmRequest>(input.client, armRateLimiter, `azureAudit own ${list}`, `${REQUESTS_PATH}/${list}`, AUTHORIZATION_API_VERSION, { $filter: OWN_REQUESTS_FILTER }, (row) => {
            const request = toRawArmRequest(row);
            return request.properties.scope?.trim() ? request : null;
        });
        const [assignments, eligibilities] = await Promise.allSettled([read("roleAssignmentScheduleRequests"), read("roleEligibilityScheduleRequests")]);
        if (assignments.status === "fulfilled" && eligibilities.status === "fulfilled") return { assignments: assignments.value, eligibilities: eligibilities.value };
        for (const settled of [assignments, eligibilities]) if (settled.status === "fulfilled") kept -= settled.value.length;
        input.onRows?.(kept);
        // Too many rows or an abort still stop the whole read
        if (fatal || local.signal.aborted) return null;
        const rejected = assignments.status === "rejected" ? assignments.reason : eligibilities.status === "rejected" ? eligibilities.reason : undefined;
        // An ARM message can hold names: log status and code only
        Logger.info("azureAuditService", `Your own requests could not be read and are left out (status ${getErrorStatusCode(rejected) ?? "none"}, code ${getErrorCode(rejected) ?? "none"})`);
        return null;
    }
}
