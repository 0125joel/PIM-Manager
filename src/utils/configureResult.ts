/**
 * The apply and its result as data (spec 13.2, 14.1; NG-69): the progress list while the engine runs, the result page
 * after it (head, counts, one row per change, the read again), the results file, and the changes "Try the failed ones
 * again" puts back. Pure; `app/configure/components/result` draws it and `hooks/useConfigureApply` runs the engine.
 */
import type { BasketSetting, Change, SettingValue, Target } from "@/types/configure.types";
import type { ChangeResult, IntentCheck } from "@/utils/applyPlan";
import { changeId } from "@/utils/configureBasket";
import { fieldLabel } from "@/utils/configureReview";
import { describeSettingValue, type ValueWords } from "@/utils/configureSettingRows";
import { settingValuesEqualFor } from "@/utils/policyRules";
import type { HistoryEntry } from "@/utils/configureHistory";
import { textCodec, writeCsv, type Column } from "@/utils/exportSchema";
import type { WriteAccess } from "@/utils/writeAccess";

export type ProgressState = "waiting" | "writing" | ChangeResult;

export interface ApplyRun {
    runId: string;
    /** The changes of this run, in the order of the basket */
    changes: Change[];
    /** Per change id while it runs; the final results once it ended */
    progress: Record<string, ProgressState>;
    /** ISO times; `finishedAt` once the engine returned */
    startedAt: string;
    finishedAt?: string;
    /** The snapshot was stored before the first write (spec 14.2) */
    snapshotSaved: boolean;
    targetCount: number;
    /** The touched workloads read again after the run (spec 13.3) */
    reread: "waiting" | "reading" | "done" | "failed";
    /** "Stop after this write" was pressed */
    isStopping?: boolean;
    /** The results could not be stored in this browser's history (quota) */
    resultsNotSaved?: boolean;
    /** The page closed while the apply wrote: what landed is not known */
    interrupted?: boolean;
}

export type RowLabel = "Waiting" | "Writing" | "Done" | "Skipped" | "Not written";

export interface ResultRow {
    changeId: string;
    tone: "waiting" | "writing" | "done" | "skipped" | "failed";
    /** "{target}: {setting} {value}" or "{action} {person} · {target}" */
    title: string;
    /** "Was {old}.", "Removed.", the reason, or the value read again when it differs */
    line: string;
    label: RowLabel;
}

export interface ResultView {
    title: string;
    subline: string;
    /** "{k} values differ from what you wanted": one line each */
    differs: string[];
    /** Failed, or skipped because what it depended on failed; stopped changes are counted apart */
    failedCount: number;
    /** Not written because the admin pressed Stop (tenant run 2026-10-09: a stop is not a failure) */
    stoppedCount: number;
    /** "Try the failed ones again", or "Write the stopped ones" when nothing failed */
    retryLabel: string;
    appliedCount: number;
    rows: ResultRow[];
    footer: string;
    /** Something was written that Undo can return */
    canUndo: boolean;
}

export interface DescribeInput {
    run: ApplyRun;
    nameOf: (target: Target) => string;
    words: ValueWords;
    tenantName: string;
    /** Per done change after the read again; null while it runs or when it could not be read */
    intent: Readonly<Record<string, IntentCheck>> | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** 13:42 */
export function clockTime(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function day(iso: string | null): string {
    if (!iso) return "no end date";
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

/** The title of a change, as the result render: "Privileged Role Administrator: Maximum activation duration 2 hours" */
export function changeTitle(change: Change, nameOf: (t: Target) => string, words: ValueWords): string {
    const target = nameOf(change.target);
    if (change.kind === "setting") return `${target}: ${fieldLabel(change.field)} ${describeSettingValue(change.field, change.to, words)}`;
    if (change.kind === "add") return `Add ${change.type} ${change.principal.displayName} · ${target}`;
    if (change.kind === "update") return `${change.action === "adminRenew" ? "Renew" : "Change end of"} ${change.schedule.principal.displayName} · ${target}`;
    return `Remove ${change.schedule.type} ${change.schedule.principal.displayName} · ${target}`;
}

function doneLine(change: Change, words: ValueWords): string {
    if (change.kind === "setting") return `Was ${describeSettingValue(change.field, change.from, words)}.`;
    if (change.kind === "add") return change.end ? `Added, ends ${day(change.end)}.` : "Added, no end date.";
    if (change.kind === "update") return change.end ? `Ends ${day(change.end)}.` : "No end date.";
    return "Removed.";
}

function stateRow(change: Change, state: ProgressState | undefined, input: DescribeInput): ResultRow {
    const id = changeId(change);
    const title = changeTitle(change, input.nameOf, input.words);
    if (!state || state === "waiting") return { changeId: id, tone: "waiting", title, line: "", label: "Waiting" };
    if (state === "writing") return { changeId: id, tone: "writing", title, line: "", label: "Writing" };
    if (state.status === "done") {
        const check = input.intent?.[id];
        const line = check && !check.matches ? `${doneLine(change, input.words)} Read again afterwards: ${check.now}.` : doneLine(change, input.words);
        return { changeId: id, tone: "done", title, line, label: "Done" };
    }
    if (state.status === "skipped") return isAppliedSkip(state)
        ? { changeId: id, tone: "skipped", title, line: state.reason, label: "Skipped" }
        : { changeId: id, tone: "failed", title, line: state.reason, label: "Not written" };
    if (state.status === "stopped") return { changeId: id, tone: "failed", title, line: "Not written (stopped).", label: "Not written" };
    // Microsoft's answer in the user's words; the remediation texts of the mapper name the old screens, so they stay out
    return { changeId: id, tone: "failed", title, line: state.message, label: "Not written" };
}

/** The progress list while the engine runs (spec 13.2): one row per change, Waiting, Writing, Done, Not written */
export function describeProgress(input: DescribeInput): ResultRow[] {
    return input.run.changes.map((c) => stateRow(c, input.run.progress[changeId(c)], input));
}

/** The skips that leave the tenant as wanted; any other skip (settings it depends on were not written) is a problem */
export const APPLIED_SKIPS: readonly string[] = ["Already there.", "Not there any more."];
const isAppliedSkip = (s: ProgressState | undefined) => typeof s === "object" && s.status === "skipped" && APPLIED_SKIPS.includes(s.reason);
const isProblem = (s: ProgressState | undefined) => typeof s === "object" && (s.status === "failed" || (s.status === "skipped" && !isAppliedSkip(s)));
const isStopped = (s: ProgressState | undefined) => typeof s === "object" && s.status === "stopped";
const isApplied = (s: ProgressState | undefined) => typeof s === "object" && (s.status === "done" || isAppliedSkip(s));

/** The result page (spec 14.1) */
export function describeResult(input: DescribeInput): ResultView {
    const { run } = input;
    const states = run.changes.map((c) => run.progress[changeId(c)]);
    const failedCount = states.filter(isProblem).length;
    const stoppedCount = states.filter(isStopped).length;
    const appliedCount = states.filter(isApplied).length;
    const written = states.filter((s) => typeof s === "object" && s.status === "done").length;
    const total = run.changes.length;
    const title = run.interrupted ? "Apply interrupted"
        : written === 0 && appliedCount === 0 ? "Nothing was written"
            : failedCount > 0 ? `Applied with ${plural(failedCount, "problem", "problems")}`
                : stoppedCount > 0 ? "Stopped" : "Applied";
    const retryCount = failedCount + stoppedCount;
    const retryLabel = failedCount === 0 ? (stoppedCount === 1 ? "Write the stopped one" : "Write the stopped ones") : retryCount === 1 ? "Try the failed one again" : "Try the failed ones again";

    const differs = run.changes.flatMap((c) => {
        const check = input.intent?.[changeId(c)];
        return check && !check.matches ? [`${changeTitle(c, input.nameOf, input.words)}: now ${check.now}`] : [];
    });
    // Written changes the read again could not compare (a policy not read again)
    const notCompared = input.intent ? run.changes.filter((c) => {
        const state = run.progress[changeId(c)];
        return typeof state === "object" && state.status === "done" && !input.intent?.[changeId(c)];
    }).length : 0;
    const at = clockTime(run.finishedAt ?? run.startedAt);
    const readLine = written === 0 ? ""
        : run.reread === "reading" || run.reread === "waiting" ? " Reading the targets again…"
            : run.reread === "failed" ? " The targets could not be read again; check them in the Report."
                : notCompared > 0 ? ` Read again afterwards; ${plural(notCompared, "change", "changes")} could not be compared, check ${notCompared === 1 ? "it" : "them"} in the Report.${differs.length ? ` ${plural(differs.length, "value differs", "values differ")} from what you wanted.` : ""}`
                    : differs.length === 0 ? " Everything was read again afterwards and matches."
                        : ` Everything was read again afterwards; ${plural(differs.length, "value differs", "values differ")} from what you wanted.`;
    const subline = run.interrupted
        ? `The page closed at ${at} while the apply wrote to ${input.tenantName}. Check the targets in the Report before you try again.`
        : `${written} of ${total} written to ${input.tenantName} at ${at}.${readLine}`;

    const footer = (run.snapshotSaved
        ? `The result stays here until you leave. A snapshot of the ${plural(run.targetCount, "target", "targets")} was saved at ${clockTime(run.startedAt)} for "Undo this apply".`
        : "The result stays here until you leave. No snapshot was saved, so nothing was written.")
        + (run.resultsNotSaved ? " The results could not be stored in this browser, so Last applies shows this apply as not finished." : "");
    return {
        title,
        subline,
        differs,
        failedCount,
        stoppedCount,
        retryLabel,
        appliedCount,
        rows: run.changes.map((c) => stateRow(c, run.progress[changeId(c)], input)),
        footer,
        canUndo: run.snapshotSaved && written > 0,
    };
}

/** "Try the failed ones again": the changes that failed or were stopped, as they were (spec 14.1) */
export function failedChanges(run: ApplyRun): Change[] {
    return run.changes.filter((c) => isProblem(run.progress[changeId(c)]) || isStopped(run.progress[changeId(c)]));
}

const RESULT_COLUMNS: Column[] = [
    { header: "Change", key: "title", codec: textCodec },
    { header: "Result", key: "label", codec: textCodec },
    { header: "Detail", key: "line", codec: textCodec },
];

/** "Results as CSV" (bug 16): `writeCsv` with `escapeCsvCell`, a comment row with the tenant and the time */
export function resultsCsv(view: ResultView, tenantName: string, run: ApplyRun): string {
    return writeCsv({ columns: RESULT_COLUMNS }, view.rows.map((r) => ({ title: r.title, label: r.label, line: r.line })), {
        preamble: [`PIM Manager apply results, ${tenantName}, ${run.finishedAt ?? run.startedAt}`],
    });
}

/** What the result page gets from its container (the app page or the fixture route) */
export interface ResultData {
    /** null when there is no apply to show (the result was left) */
    view: ResultView | null;
    onRetry: () => void;
    onDownloadCsv: () => void;
    reportHref: string;
    onUndo: () => void;
    /** Why Undo cannot be used now, or null */
    undoBlockedReason: string | null;
    onBack: () => void;
    /** An undo of this apply that stopped (the targets could not be read again) */
    notice?: string | null;
}

/**
 * Why "Undo this apply" cannot be used now (spec 14.3), or null: an apply is running, changes are waiting in the
 * basket (Undo would replace them), nothing of the apply was written, or the admin may not change one of its targets.
 */
export function undoBlockedReason(entry: Pick<HistoryEntry, "changes" | "results"> | null, ctx: { access: WriteAccess | null; basketCount: number; isRunning: boolean; isLoading?: boolean }): string | null {
    if (!entry) return "This apply is no longer in the history of this browser.";
    if (ctx.isRunning) return "An apply is running.";
    if (ctx.isLoading) return "Wait until the roles and groups are read.";
    if (!entry.changes.some((c) => entry.results[changeId(c)]?.status === "done")) return "Nothing of this apply was written.";
    if (ctx.basketCount > 0) return `Apply or discard the ${plural(ctx.basketCount, "change", "changes")} waiting first.`;
    if (!ctx.access) return "Your access is still being checked.";
    return mayChangeAll(entry.changes, ctx.access) ? null : "You cannot change every target of this apply now.";
}

// ---------------------------------------------------------------------------------------------------------------------
// A run kept for this tab

/** What sessionStorage keeps of the run shown: its id, and whether its changes already left the basket */
export interface RunMarker {
    runId: string;
    basketCleared: boolean;
}

export const INTERRUPTED = "Not known whether this was written: the page closed while the apply was writing. Check it in the Report before you try again.";

/**
 * The run to show after a remount or a reload (spec 13.1: a remount shows the result, never runs again). Pure: from
 * the marker and the history entry. An entry with results is the result; an entry without results is an apply the
 * page left while it wrote, shown with every change as not known. Nothing here starts the engine.
 */
export function restoreRun(marker: RunMarker | null, entry: HistoryEntry | null, now: Date): ApplyRun | null {
    if (!marker || !entry || entry.runId !== marker.runId) return null;
    const hasResults = Object.keys(entry.results).length > 0;
    // Results written by an earlier restore of the same interrupted apply stay "interrupted" on every later reload
    const wasInterrupted = hasResults && Object.values(entry.results).every((r) => r.status === "failed" && r.message === INTERRUPTED);
    return {
        runId: entry.runId,
        changes: entry.changes,
        progress: hasResults ? entry.results : Object.fromEntries(entry.changes.map((c) => [changeId(c), { status: "failed" as const, message: INTERRUPTED }])),
        startedAt: entry.at,
        finishedAt: hasResults ? entry.at : now.toISOString(),
        snapshotSaved: true,
        targetCount: entry.targetCount,
        reread: "done",
        ...(!hasResults || wasInterrupted ? { interrupted: true } : {}),
    };
}

/**
 * The basket after a run: every change the run settled leaves it (done, skipped, failed or stopped; "Try the failed
 * ones again" puts the failed back); a change that is not exactly the one the run took (edited meanwhile) stays.
 * Changes are compared whole, not by id: an id names a target and field, not a value.
 */
export function basketAfterRun(current: readonly Change[], run: Pick<ApplyRun, "changes" | "progress">): Change[] {
    const settled = new Set(run.changes.filter((c) => typeof run.progress[changeId(c)] === "object").map((c) => JSON.stringify(c)));
    return current.filter((c) => !settled.has(JSON.stringify(c)));
}

/** True when the admin may change every target of these changes now (the access check per area and group, with the app permission) */
export function mayChangeAll(changes: readonly Change[], access: WriteAccess | null): boolean {
    if (!access) return false;
    return changes.every((c) => c.target.kind === "role"
        ? access.roles.state === "open" && access.appPermission.directoryRoles === "granted"
        : access.groups[c.target.id]?.state === "open" && access.appPermission.pimGroups === "granted");
}

/**
 * The run's changes against the read right before the first write (spec 14.2): a setting that already holds the new
 * value (written by an earlier apply, or by the part of a policy that landed before a later rule failed) is skipped as
 * "Already there."; a setting that holds neither the value the review started from nor the new one was changed by
 * someone else, and the apply stops for it; a setting that could not be read stops it too. Assignments pass unchanged.
 */
export function sortAgainstRead(changes: readonly Change[], readNow: (target: Target, field: BasketSetting["field"]) => SettingValue | undefined): { toWrite: Change[]; alreadyThere: Change[]; moved: BasketSetting[] } {
    const toWrite: Change[] = [];
    const alreadyThere: Change[] = [];
    const moved: BasketSetting[] = [];
    for (const c of changes) {
        if (c.kind !== "setting") { toWrite.push(c); continue; }
        const now = readNow(c.target, c.field);
        if (now !== undefined && settingValuesEqualFor(c.field, now, c.from)) toWrite.push(c);
        else if (now !== undefined && settingValuesEqualFor(c.field, now, c.to)) alreadyThere.push(c);
        else moved.push(c);
    }
    return { toWrite, alreadyThere, moved };
}
