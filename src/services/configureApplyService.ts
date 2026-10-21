import type { Client } from "@microsoft/microsoft-graph-client";
import type { Target } from "@/types/configure.types";
import { sameEnd, type AssignmentItem, type ApplyPlan, type ApplyResult, type ChangeResult, type SettingsItem } from "@/utils/applyPlan";
import { SCHEDULE_REQUEST_PATHS } from "@/utils/assignmentRequests";
import { targetKey } from "@/utils/configureBasket";
import { getErrorMessage } from "@/utils/errorUtils";
import { mapGraphError } from "@/utils/graphErrorMapping";
import { Logger } from "@/utils/logger";
import { escapeODataString } from "@/utils/odataUtils";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { runWorkerPool } from "@/utils/workerPool";

/**
 * The one apply engine of Configure (spec 13, NG-58). It runs a plan of `planApply` once per click (bug 2): the caller
 * gives each click a run id, and a second run with the same id throws. Before the first write it saves the snapshot;
 * when that fails nothing is written. Steps run in order (settings, adds, updates, removals), items of a step on
 * `runWorkerPool` with `graphRateLimiter` (4 workers, 500 ms). Every write is v1.0.
 *
 * Retries: a PATCH is retried on 429 and 5xx (`withRetry`). A POST is never sent twice blindly: after a 429 or 5xx the
 * engine first reads whether the schedule is there now (`findSchedule`, by principal, target, scope and type, never by
 * schedule id) and retries once only when it is not. A 4xx is never retried.
 */

export interface RunApplyOptions {
    runId: string;
    /** Saves the snapshot of the touched targets (spec 14.2); a throw stops the apply before any write */
    saveSnapshot: () => Promise<void>;
    /** The schedule of the item's principal, target, scope and type as it is now (null when there is none); read only after a 429 or 5xx */
    findSchedule: (item: AssignmentItem) => Promise<{ end: string | null } | null>;
    /**
     * Whether a request for this item that Microsoft accepted is still being processed (W-07: a POST answered with a 5xx
     * can have been accepted, and a schedule appears only once it is provisioned). Read only after a 429 or 5xx;
     * without it, only the schedule decides
     */
    findPendingRequest?: (item: AssignmentItem) => Promise<boolean>;
    /** Aborted: the write in flight finishes, everything after it is "stopped" */
    signal?: AbortSignal;
    /** Each change as it starts and ends */
    onChange?: (changeId: string, state: "writing" | ChangeResult) => void;
    /** Tests only */
    delayMs?: number;
    now?: () => Date;
}

const usedRunIds = new Set<string>();

const SNAPSHOT_FAILED = "Could not save a snapshot. Nothing was written.";

function failedFrom(error: unknown, context: "policy" | "assignment" | "removal"): ChangeResult {
    const mapped = mapGraphError(error, context);
    return { status: "failed", ...(mapped.rawCode ? { code: mapped.rawCode } : {}), message: mapped.friendlyMessage, ...(mapped.remediation ? { remediation: mapped.remediation } : {}) };
}

const isTransient = (error: unknown) => mapGraphError(error).classification === "transient";

export async function runApply(client: Client, plan: ApplyPlan, options: RunApplyOptions): Promise<ApplyResult> {
    if (usedRunIds.has(options.runId)) throw new Error(`Apply ${options.runId} has run already; a result is shown, never applied again.`);
    usedRunIds.add(options.runId);
    const now = options.now ?? (() => new Date());
    const startedAt = now().toISOString();
    const results: Record<string, ChangeResult> = {};
    // A listener that throws must never cost a result
    const notify = (id: string, state: "writing" | ChangeResult) => {
        try {
            options.onChange?.(id, state);
        } catch (error: unknown) {
            Logger.warn("ConfigureApply", "onChange threw", error);
        }
    };
    const settle = (id: string, result: ChangeResult) => {
        results[id] = result;
        notify(id, result);
    };
    const finish = (): ApplyResult => {
        for (const id of plan.changeIds) if (!results[id]) results[id] = { status: "stopped" };
        return { runId: options.runId, results, startedAt, finishedAt: now().toISOString() };
    };

    const failedSettings = new Set<string>();
    for (const problem of plan.problems) {
        settle(problem.changeId, { status: "failed", message: problem.reason });
        // Adds that rely on these settings are skipped, as when a write of them failed
        failedSettings.add(targetKey(problem.target));
    }
    const toWrite = plan.changeIds.filter((id) => !results[id]);
    if (toWrite.length === 0) return finish();
    if (options.signal?.aborted) return finish();

    try {
        await options.saveSnapshot();
    } catch (error: unknown) {
        Logger.error("ConfigureApply", "Snapshot failed, nothing written", error);
        for (const id of toWrite) settle(id, { status: "failed", message: SNAPSHOT_FAILED });
        return finish();
    }

    const writeSettings = async (item: SettingsItem) => {
        for (const id of item.changeIds) notify(id, "writing");
        const written: string[] = [];
        for (const update of item.updates) {
            try {
                // The pool paid for the first attempt of each PATCH; a retry pays again (W-12)
                let attempt = 0;
                await withRetry(
                    async () => {
                        if (attempt++ > 0) await graphRateLimiter.acquire(1, options.signal);
                        return client.api(`/policies/roleManagementPolicies/${encodeURIComponent(item.policyId)}/rules/${encodeURIComponent(update.ruleId)}`).version("v1.0").patch(update.body);
                    },
                    3, 1000, `configureApply:${item.policyId}:${update.ruleId}`,
                );
                written.push(update.ruleId);
            } catch (error: unknown) {
                // The rules after a failed one are not sent: their order guards MfaAndAcrsConflict
                failedSettings.add(targetKey(item.target));
                const failed = failedFrom(error, "policy");
                const message = failed.status === "failed" ? failed.message : getErrorMessage(error);
                const detail = `${message} Rule ${update.ruleId} failed${written.length ? `; written before it: ${written.join(", ")}` : "; nothing of this policy was written"}.`;
                for (const id of item.changeIds) {
                    // A change whose every rule was written before the failure did land (W-04): done, so Undo takes it
                    const rules = item.rulesByChange?.[id];
                    if (rules && rules.length > 0 && rules.every((r) => written.includes(r))) settle(id, { status: "done" });
                    else settle(id, { ...(failed as Extract<ChangeResult, { status: "failed" }>), message: detail });
                }
                return;
            }
        }
        for (const id of item.changeIds) {
            const rules = item.rulesByChange?.[id];
            settle(id, rules && rules.length === 0 ? { status: "skipped", reason: "Nothing to write: the policy already says this, or the setting has no effect here." } : { status: "done" });
        }
    };

    const send = (item: AssignmentItem) => client.api(item.request.url).version(item.request.version).post(item.request.body);

    const writeAssignment = async (item: AssignmentItem) => {
        if (item.dependsOnSettings && failedSettings.has(targetKey(item.target))) {
            settle(item.changeId, { status: "skipped", reason: `Settings for ${describeTarget(item.target)} were not written.` });
            return;
        }
        notify(item.changeId, "writing");
        const context = item.kind === "remove" ? "removal" : "assignment";
        try {
            await send(item);
            settle(item.changeId, { status: "done" });
            return;
        } catch (error: unknown) {
            if (!isTransient(error)) {
                const mapped = mapGraphError(error, context);
                if (mapped.classification === "success-equivalent") {
                    settle(item.changeId, { status: "skipped", reason: item.kind === "remove" ? "Not there any more." : "Already there." });
                } else {
                    settle(item.changeId, failedFrom(error, context));
                }
                return;
            }
            // 429 or 5xx: Microsoft may have done it anyway. Wait (Retry-After, at least two seconds), read, then send once more.
            const wait = Math.max(retryAfterMs(error), RETRY_WAIT_MS);
            graphRateLimiter.backOff(wait);
            await sleep(wait, options.signal);
        }
        try {
            // Every attempt after the first pays the limiter too (W-12); the read still happens after a Stop
            await graphRateLimiter.acquire(1);
            const now = await options.findSchedule(item);
            if (item.kind === "add" && now) return settle(item.changeId, { status: "done" });
            if (item.kind === "remove" && !now) return settle(item.changeId, { status: "done" });
            if (item.kind === "update" && now && sameEnd(now.end, (item.change as { end: string | null }).end)) return settle(item.changeId, { status: "done" });
            // Stopped during the wait: never a new write after Stop
            if (options.signal?.aborted) return settle(item.changeId, { status: "failed", message: "Stopped before it could be sent again; Microsoft did not confirm the first attempt." });
            if (options.findPendingRequest) {
                await graphRateLimiter.acquire(1, options.signal);
                if (await options.findPendingRequest(item)) return settle(item.changeId, { status: "skipped", reason: "Sent: Microsoft accepted it and is still processing it." });
            }
            await graphRateLimiter.acquire(1, options.signal);
            await send(item);
            settle(item.changeId, { status: "done" });
        } catch (error: unknown) {
            const mapped = mapGraphError(error, context);
            settle(item.changeId, mapped.classification === "success-equivalent"
                ? { status: "skipped", reason: item.kind === "remove" ? "Not there any more." : "Already there." }
                : failedFrom(error, context));
        }
    };

    for (const step of plan.steps) {
        if (options.signal?.aborted) break;
        await runWorkerPool<SettingsItem | AssignmentItem, true>({
            items: step.items,
            workerCount: 4,
            delayMs: options.delayMs ?? 500,
            rateLimiter: graphRateLimiter,
            costPerItem: (item) => (item.kind === "settings" ? Math.max(1, item.updates.length) : 1),
            signal: options.signal,
            processor: async (item) => {
                // Stop after this write: an item not started yet is "stopped"
                if (options.signal?.aborted) return true;
                if (item.kind === "settings") await writeSettings(item);
                else await writeAssignment(item);
                return true;
            },
        });
    }
    return finish();
}

const RETRY_WAIT_MS = 2000;

/** Retry-After of a 429 in milliseconds: the SDK's `headers` (a Headers object) or a plain map */
function retryAfterMs(error: unknown): number {
    const e = error as { headers?: { get?: (name: string) => string | null }; responseHeaders?: Record<string, string> } | null;
    const raw = e?.headers?.get?.("Retry-After") ?? e?.responseHeaders?.["Retry-After"] ?? e?.responseHeaders?.["retry-after"];
    const seconds = Number(raw ?? 0);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}


function describeTarget(target: Target): string {
    return target.kind === "role" ? `role ${target.id}` : `group ${target.id} (${target.access})`;
}

/**
 * `findSchedule` against Graph (v1.0): the schedules of the principal on the target, filtered by what identifies an
 * assignment (principal, target, scope, type), never by schedule id. Scope and access are compared after the read,
 * since the schedule lists filter on principal and target only.
 */
export function createFindSchedule(client: Client): (item: AssignmentItem) => Promise<{ end: string | null } | null> {
    return async (item) => {
        const principalId = item.change.kind === "add" ? item.change.principal.id : item.change.schedule.principal.id;
        const type = item.change.kind === "add" ? item.change.type : item.change.schedule.type;
        const scope = item.change.kind === "add" ? item.change.scope : item.change.schedule.scope;
        const base = item.target.kind === "role"
            ? SCHEDULE_REQUEST_PATHS.role[type].replace(/Requests$/, "s")
            : SCHEDULE_REQUEST_PATHS.group[type].replace(/Requests$/, "s");
        const filter = item.target.kind === "role"
            ? `principalId eq '${escapeODataString(principalId)}' and roleDefinitionId eq '${escapeODataString(item.target.id)}'`
            : `principalId eq '${escapeODataString(principalId)}' and groupId eq '${escapeODataString(item.target.id)}'`;
        type Schedule = { directoryScopeId?: string; accessId?: string; assignmentType?: string; memberType?: string; scheduleInfo?: { expiration?: { endDateTime?: string | null } } };
        const answer = await withRetry(() => client.api(base).version("v1.0").filter(filter).get() as Promise<{ value?: Schedule[] }>, 3, 1000, "configureApply findSchedule");
        const found = (answer.value ?? []).find((s) => {
            const sameTarget = item.target.kind === "role" ? (s.directoryScopeId || "/") === (scope || "/") : (s.accessId ?? "").toLowerCase() === item.target.access;
            // An activation is not an assignment an admin made: only Assigned counts for active, only Direct for both
            const assigned = type !== "active" || (s.assignmentType ?? "assigned").toLowerCase() === "assigned";
            const direct = (s.memberType ?? "direct").toLowerCase() === "direct";
            return sameTarget && assigned && direct;
        });
        return found ? { end: found.scheduleInfo?.expiration?.endDateTime ?? null } : null;
    };
}

/** Request statuses after which nothing more happens: such a request is no reason to hold back a new one */
const ENDED_REQUEST_STATUSES = new Set(["denied", "canceled", "failed", "revoked", "provisioned"]);

/**
 * `findPendingRequest` against Graph (v1.0, W-07): a request of the same action for the principal, target, scope and
 * side, made in the last ten minutes, that has not ended (PendingProvisioning, Provisioning, Granted with a later start,
 * PendingScheduleCreation). The request lists filter on principal and target; the rest is compared after the read.
 */
export function createFindPendingRequest(client: Client, now: () => Date = () => new Date()): (item: AssignmentItem) => Promise<boolean> {
    return async (item) => {
        const principalId = item.change.kind === "add" ? item.change.principal.id : item.change.schedule.principal.id;
        const type = item.change.kind === "add" ? item.change.type : item.change.schedule.type;
        const scope = item.change.kind === "add" ? item.change.scope : item.change.schedule.scope;
        const action = (item.request.body as { action?: string }).action?.toLowerCase();
        const path = item.target.kind === "role" ? SCHEDULE_REQUEST_PATHS.role[type] : SCHEDULE_REQUEST_PATHS.group[type];
        const filter = item.target.kind === "role"
            ? `principalId eq '${escapeODataString(principalId)}' and roleDefinitionId eq '${escapeODataString(item.target.id)}'`
            : `principalId eq '${escapeODataString(principalId)}' and groupId eq '${escapeODataString(item.target.id)}'`;
        type Request = { action?: string; status?: string; createdDateTime?: string; directoryScopeId?: string; accessId?: string };
        const answer = await withRetry(() => client.api(path).version("v1.0").filter(filter).get() as Promise<{ value?: Request[] }>, 3, 1000, "configureApply findPendingRequest");
        const since = now().getTime() - 10 * 60_000;
        return (answer.value ?? []).some((r) => {
            const sameTarget = item.target.kind === "role" ? (r.directoryScopeId || "/") === (scope || "/") : (r.accessId ?? "").toLowerCase() === item.target.access;
            const recent = !!r.createdDateTime && new Date(r.createdDateTime).getTime() >= since;
            return sameTarget && recent && (r.action ?? "").toLowerCase() === action && !ENDED_REQUEST_STATUSES.has((r.status ?? "").toLowerCase());
        });
    };
}
