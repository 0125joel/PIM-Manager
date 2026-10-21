import type { Client } from "@microsoft/microsoft-graph-client";
import type { BasketAdd } from "@/types/configure.types";
import { requestForChange } from "@/utils/assignmentRequests";
import { mapGraphError } from "@/utils/graphErrorMapping";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { runWorkerPool } from "@/utils/workerPool";

/**
 * The dry run of the pre-flight (spec 12.4, NG-57): every new assignment is sent once with `isValidationOnly: true`,
 * so Microsoft checks it against the policy and writes nothing (T3). Removals and updates are never sent. A request
 * that is refused gets Microsoft's reason in the user's words (`mapGraphError`); 429 and 5xx are retried, the request
 * writes nothing, so a retry is safe.
 */

const REJECTIONS: ReadonlySet<string> = new Set(["policy-rejected", "duration-limit", "stale-state", "not-found"]);

export type DryRunResult =
    | { ok: true }
    | { ok: false; code?: string; message: string; remediation?: string; transient: boolean };

export interface DryRunItem {
    /** The change id of the basket (`changeId`) */
    id: string;
    change: BasketAdd;
}

export async function dryRunAssignments(client: Client, items: readonly DryRunItem[], signal?: AbortSignal): Promise<Record<string, DryRunResult>> {
    const results: Record<string, DryRunResult> = {};
    await runWorkerPool<DryRunItem, DryRunResult>({
        items: [...items],
        workerCount: 4,
        delayMs: 500,
        rateLimiter: graphRateLimiter,
        costPerItem: 1,
        signal,
        processor: async (item) => {
            const request = requestForChange(item.change, { isValidationOnly: true });
            let result: DryRunResult;
            try {
                const answer: unknown = await withRetry(() => client.api(request.url).version(request.version).post(request.body), 3, 1000, "configure dryRun");
                // Microsoft echoes the request; an answer that does not confirm a check-only request is no pass
                const confirmed = !answer || typeof answer !== "object" || Object.keys(answer).length === 0 || (answer as { isValidationOnly?: unknown }).isValidationOnly === true;
                // Graph may have written it: a refusal that says so, never "not checked"
                result = confirmed ? { ok: true } : { ok: false, message: "Microsoft did not confirm that it only checked this request; the assignment may have been written. Check it in the Report before you apply.", transient: false };
            } catch (error: unknown) {
                const mapped = mapGraphError(error, "assignment");
                // "Already exists" is no rejection: the apply skips a duplicate (pre-flight "Duplicates are skipped")
                result = mapped.classification === "success-equivalent" ? { ok: true } : {
                    ok: false,
                    ...(mapped.rawCode ? { code: mapped.rawCode } : {}),
                    message: mapped.friendlyMessage,
                    ...(mapped.remediation ? { remediation: mapped.remediation } : {}),
                    // Only an answer about the request itself is a refusal; throttling, network or an unknown answer is "not checked"
                    transient: !REJECTIONS.has(mapped.classification),
                };
            }
            results[item.id] = result;
            return result;
        },
    });
    return results;
}
