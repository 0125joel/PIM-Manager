"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Client } from "@microsoft/microsoft-graph-client";
import { createFindSchedule, createFindPendingRequest, runApply } from "@/services/configureApplyService";
import type { BasketSetting, Change, SettingValue, Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { compareWithIntent, planApply, type ChangeResult, type FreshState, type IntentCheck } from "@/utils/applyPlan";
import { changeId, targetKey, touchedTargets, type Basket } from "@/utils/configureBasket";
import { RUN_STORAGE_PREFIX, UNDO_STORAGE_PREFIX, basketFromSnapshot, getHistoryEntry, saveHistoryEntry, updateHistoryResults, type HistoryEntry, type UndoCurrentState, type UndoWarning } from "@/utils/configureHistory";
import { buildTargetStates, type ReviewData } from "@/utils/configureReview";
import { basketAfterRun, describeProgress, describeResult, failedChanges, mayChangeAll, restoreRun, resultsCsv, sortAgainstRead, type ApplyRun, type ResultData, type RunMarker } from "@/utils/configureResult";
import { nowValue, type ValueWords } from "@/utils/configureSettingRows";
import { CSV_BOM } from "@/utils/exportSchema";
import type { Backup } from "@/utils/exportBackup";
import { LiveValue } from "@/utils/liveValue";
import { Logger } from "@/utils/logger";
import type { WriteAccess } from "@/utils/writeAccess";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Workload = "directoryRoles" | "pimGroups";

export interface ConfigureApplyInput {
    tenantId: string;
    /** Who applies, for Last applies */
    by: string;
    basket: Basket;
    /** The basket has been read from sessionStorage (a restored run takes its changes out only then) */
    isBasketReady: boolean;
    roles: readonly RoleDetailData[];
    groups: readonly PimGroupData[];
    getClient: () => Promise<Client>;
    /** Reads the access check again (spec 3.3: before the first write) */
    recheckAccess: () => Promise<WriteAccess | null>;
    /** The snapshot of only these targets as read now (`buildBackup`) */
    makeBackup: (targets: readonly Target[]) => Backup;
    /**
     * Reads the workloads again and resolves when everything is in, the policies included (a background phase too);
     * throws when the read failed. After an apply with `force`; before the snapshot and an undo without.
     */
    refresh: (workloads: Workload[], force: boolean, roleIds?: readonly string[]) => Promise<void>;
    replaceBasket: (changes: Change[]) => void;
    /** The basket's `rebase`: setting changes start from the value read now */
    rebaseBasket: (readNow: (target: Target, field: BasketSetting["field"]) => SettingValue | undefined) => void;
    /** The name of a target, for messages */
    nameOf: (target: Target) => string;
    addToBasket: (changes: Change[]) => void;
    /** Shows the result step when the review is still open (replaces it in the browser history) */
    showResult: () => void;
    /** Opens the review of the basket (retry, undo) */
    openReview: () => void;
    /** localStorage for the history; sessionStorage remembers the run shown, so a remount shows it and never runs again */
    history: StorageLike | null;
    session: StorageLike | null;
    /** The fixture: a run to show from the start (the result render, the progress) */
    initialRun?: ApplyRun | null;
    /** The fixture: what the tenant holds after the read again, and before an undo */
    freshOverride?: FreshState;
    currentOverride?: UndoCurrentState;
}

export interface ConfigureApply {
    run: ApplyRun | null;
    intent: Record<string, IntentCheck> | null;
    isRunning: boolean;
    apply: () => void;
    stop: () => void;
    retryFailed: () => void;
    /** Leaves the result: the run is forgotten */
    forget: () => void;
    /** Undo of an apply of the history: reads the targets again, then fills the basket and opens the review */
    undo: (runId: string) => void;
    undoingRunId: string | null;
    /** The warnings of the undo in the basket, for the review's checks */
    undoWarnings: UndoWarning[] | null;
    /** Why the review is empty after an undo ("Nothing to undo: ...") */
    emptyReason: string | null;
    /** An undo that stopped because the targets could not be read again */
    undoError: { runId: string; message: string } | null;
}

const RUN_KEY = RUN_STORAGE_PREFIX;
const UNDO_KEY = UNDO_STORAGE_PREFIX;

/**
 * The run of a tenant lives outside the component: an apply keeps writing when the page unmounts (Back, a link), and
 * the next mount shows the same run instead of offering Apply on the same basket again (bug 2). The input of the
 * mounted page is registered here, so the end of a run reaches the basket of the page that is mounted then.
 */
interface RunStore {
    run: ApplyRun | null;
    /** The run of this tab was restored from sessionStorage once (a later forget stays forgotten) */
    restored: boolean;
    controller: AbortController | null;
    input: ConfigureApplyInput | null;
    listeners: Set<() => void>;
}
const stores = new Map<string, RunStore>();
function storeOf(tenantId: string): RunStore {
    let store = stores.get(tenantId);
    if (!store) {
        store = { run: null, restored: false, controller: null, input: null, listeners: new Set() };
        stores.set(tenantId, store);
    }
    return store;
}
function setStoreRun(store: RunStore, change: (run: ApplyRun | null) => ApplyRun | null) {
    store.run = change(store.run);
    for (const listener of store.listeners) listener();
}

function readMarker(session: StorageLike | null, tenantId: string): RunMarker | null {
    try {
        const raw = session?.getItem(RUN_KEY + tenantId);
        const parsed = raw ? (JSON.parse(raw) as Partial<RunMarker>) : null;
        return parsed && typeof parsed.runId === "string" ? { runId: parsed.runId, basketCleared: parsed.basketCleared === true } : null;
    } catch {
        return null;
    }
}
function writeMarker(session: StorageLike | null, tenantId: string, marker: RunMarker | null) {
    try {
        if (marker) session?.setItem(RUN_KEY + tenantId, JSON.stringify(marker));
        else session?.removeItem(RUN_KEY + tenantId);
    } catch {
        // the result still shows; only a reload loses it
    }
}

function workloadsOf(targets: readonly Target[]): Workload[] {
    const kinds = new Set(targets.map((t) => t.kind));
    return [...(kinds.has("role") ? ["directoryRoles" as const] : []), ...(kinds.has("group") ? ["pimGroups" as const] : [])];
}

const roleIdsOf = (targets: readonly Target[]) => targets.filter((t) => t.kind === "role").map((t) => t.id);
const targetsOf = (changes: readonly Change[]) => [...new Map(changes.map((c) => [targetKey(c.target), c.target])).values()];

/** What the tenant holds as loaded now: settings and assignments of a target */
export function currentState(roles: readonly RoleDetailData[], groups: readonly PimGroupData[], targets: readonly Target[]): FreshState & UndoCurrentState & { value: NonNullable<FreshState["value"]> } {
    const { preflight, apply } = buildTargetStates(roles, groups, targets);
    const stateOf = (t: Target) => preflight[targetKey(t)];
    const direct = (t: Target) => (stateOf(t)?.assignments ?? []).filter((a) => !a.viaGroup);
    return {
        settings: (t) => stateOf(t)?.settings ?? null,
        // One read for every Now side (W-02): the edit screens read an unlinked extension slot as the empty link
        value: (t, field) => nowValue(stateOf(t)?.settings ?? null, apply[targetKey(t)]?.rules, field),
        assignment: (t, principalId, scope, type) => {
            const found = direct(t).find((a) => a.principal.id.toLowerCase() === principalId.toLowerCase() && (a.scope || "/") === (scope || "/") && a.type === type);
            return found ? { end: found.end } : null;
        },
        assignments: (t) => direct(t).map((a) => ({ principalId: a.principal.id, type: a.type, scope: a.scope, start: a.start, end: a.end })),
    };
}

/** Read again at most twice more, ten seconds apart, while a written assignment does not show as wanted */
const REREAD_RETRIES = 2;
const REREAD_DELAY_MS = 10_000;

/** A written add, change of end or removal that the tenant as loaded does not show yet */
function assignmentsDiffer(changes: readonly Change[], results: Readonly<Record<string, ChangeResult>>, input: Pick<ConfigureApplyInput, "roles" | "groups"> | null, targets: readonly Target[]): boolean {
    if (!input) return false;
    const assignmentChanges = changes.filter((c) => c.kind !== "setting");
    if (assignmentChanges.length === 0) return false;
    const check = compareWithIntent({ changes: assignmentChanges }, results, currentState(input.roles, input.groups, targets));
    return Object.values(check).some((c) => !c.matches);
}

/**
 * The apply of the Configure page (spec 13, 14; NG-69). One run per click (the engine refuses a run id twice, bug 2):
 * the access check is read again, then the touched workloads, and the snapshot of the touched targets is saved in the
 * history before the first write; the engine reports each change, the results go into the history, the settled
 * changes leave the basket and the result shows; then the touched workloads are read again, policies included, and
 * each written change is compared with what was wanted. A marker in sessionStorage keeps the run for this tab: a
 * remount or a reload shows the result from the history and never writes (an apply the page left while it wrote shows
 * every change as not known). Undo reads the targets again and builds the basket from the snapshot.
 */
export function useConfigureApply(input: ConfigureApplyInput): ConfigureApply {
    const { tenantId, history, session } = input;
    const store = storeOf(tenantId);
    // The first mount after a reload restores the run of this tab from the marker and the history, once
    if (!store.restored) {
        store.restored = true;
        if (input.initialRun !== undefined) store.run = input.initialRun;
        else {
            const marker = readMarker(session, tenantId);
            store.run = restoreRun(marker, marker ? getHistoryEntry(history, tenantId, marker.runId) : null, new Date());
            // An apply the page left while it wrote: its "not known" results go into the history, so Last applies
            // shows it with problems instead of "not finished"
            if (store.run?.interrupted) updateHistoryResults(history, tenantId, store.run.runId, store.run.progress as Record<string, ChangeResult>);
        }
    }
    const subscribe = useCallback((listener: () => void) => {
        store.listeners.add(listener);
        return () => {
            store.listeners.delete(listener);
        };
    }, [store]);
    const run = useSyncExternalStore(subscribe, () => store.run, () => store.run);

    const [latestInput] = useState(() => new LiveValue(input));
    useEffect(() => {
        latestInput.set(input);
        store.input = input;
    });
    useEffect(() => () => {
        if (store.input === latestInput.get()) store.input = null;
    }, [store, latestInput]);

    const [undoing, setUndoing] = useState<{ runId: string; phase: "reading" | "ready" } | null>(null);
    const [undoError, setUndoError] = useState<{ runId: string; message: string } | null>(null);
    const [undoState, setUndoState] = useState<{ warnings: UndoWarning[]; emptyReason: string | null } | null>(() => {
        try {
            const raw = session?.getItem(UNDO_KEY + tenantId);
            return raw ? { warnings: JSON.parse(raw) as UndoWarning[], emptyReason: null } : null;
        } catch {
            return null;
        }
    });

    // A restored run whose changes are still in the basket (the page closed or unmounted before the end): out once
    const { isBasketReady } = input;
    useEffect(() => {
        if (!isBasketReady || !run?.finishedAt || !store.input) return;
        const marker = readMarker(session, tenantId);
        if (!marker || marker.runId !== run.runId || marker.basketCleared) return;
        store.input.replaceBasket(basketAfterRun(store.input.basket.changes, run));
        writeMarker(session, tenantId, { runId: run.runId, basketCleared: true });
    }, [isBasketReady, run, store, session, tenantId]);

    const isRunning = !!run && !run.finishedAt;

    const apply = useCallback(() => {
        const current = latestInput.get();
        if (store.controller || (store.run && !store.run.finishedAt) || current.basket.changes.length === 0) return;
        const runId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `run-${Date.now()}`;
        const changes = current.basket.changes;
        const targets = touchedTargets(current.basket);
        const workloads = workloadsOf(targets);
        const startedAt = new Date().toISOString();
        const abort = new AbortController();
        store.controller = abort;
        setUndoState(null);
        try {
            session?.removeItem(UNDO_KEY + tenantId);
        } catch {
            // nothing kept
        }
        setStoreRun(store, () => ({ runId, changes, progress: {}, startedAt, snapshotSaved: false, targetCount: targets.length, reread: "waiting" }));
        writeMarker(session, tenantId, { runId, basketCleared: false });
        const update = (change: (r: ApplyRun) => ApplyRun) => setStoreRun(store, (r) => (r && r.runId === runId ? change(r) : r));
        const settleAll = (result: (c: Change) => ChangeResult) => update((r) => ({
            ...r,
            progress: Object.fromEntries(changes.map((c) => [changeId(c), typeof r.progress[changeId(c)] === "object" ? r.progress[changeId(c)] : result(c)])),
            finishedAt: new Date().toISOString(),
            reread: "done",
        }));
        // Nothing is written before the snapshot is saved: a stop until then keeps every change in the basket (W-05)
        let snapshotSaved = false;
        const stopBefore = (message: string) => {
            keepInBasket = true;
            settleAll(() => ({ status: "failed", message }));
            end();
        };
        let keepInBasket = false;
        const end = () => {
            // The settled changes leave the basket of the page mounted now; without one, the next mount does it
            const finished = store.run;
            if (keepInBasket) writeMarker(session, tenantId, { runId, basketCleared: true });
            else if (finished && finished.runId === runId && store.input) {
                store.input.replaceBasket(basketAfterRun(store.input.basket.changes, finished));
                writeMarker(session, tenantId, { runId, basketCleared: true });
            }
            store.input?.showResult();
        };

        void (async () => {
            let wrote = false;
            try {
                // Spec 3.3: the access check is read again right before the first write
                const access = await current.recheckAccess();
                if (!access) return stopBefore("Could not check your access. Nothing was written.");
                if (!mayChangeAll(changes, access)) return stopBefore("Your access changed: you cannot change every target of this apply now. Nothing was written.");
                // Spec 14.2: the touched targets are read again right before the first write; the plan and the
                // snapshot come from that read, and a setting someone changed since the review stops the apply
                if (!store.input) return stopBefore("The page closed before the first write. Nothing was written.");
                await store.input.refresh(workloads, false, roleIdsOf(targets));
                const fresh = store.input;
                if (!fresh) return stopBefore("The page closed before the first write. Nothing was written.");
                const now = currentState(fresh.roles, fresh.groups, targets);
                const sorted = sortAgainstRead(changes, (t, field) => now.value(t, field));
                if (sorted.moved.length > 0) {
                    // Someone else changed these since the review: nothing is written, the changes stay in the basket
                    // and start from what the tenant holds now (the basket's rebase), so the review shows the real before
                    const names = [...new Set(sorted.moved.map((c) => fresh.nameOf(c.target)))];
                    keepInBasket = true;
                    fresh.rebaseBasket((t, field) => now.value(t, field));
                    return stopBefore(`Changed in the tenant since your review, or not read again: ${names.join(", ")}. Nothing was written. The changes are still waiting and now start from what the tenant holds; review them again.`);
                }
                for (const c of sorted.alreadyThere) update((r) => ({ ...r, progress: { ...r.progress, [changeId(c)]: { status: "skipped", reason: "Already there." } } }));
                const snapshot = fresh.makeBackup(targets);
                const plan = planApply({ changes: sorted.toWrite }, buildTargetStates(fresh.roles, fresh.groups, targets).apply);
                const client = await current.getClient();
                const result = await runApply(client, plan, {
                    runId,
                    signal: abort.signal,
                    findSchedule: createFindSchedule(client),
                    findPendingRequest: createFindPendingRequest(client),
                    saveSnapshot: async () => {
                        const entry: HistoryEntry = { runId, at: startedAt, by: current.by, changes, results: {}, targetCount: targets.length, snapshot };
                        if (!saveHistoryEntry(history, tenantId, entry)) throw new Error("The snapshot could not be stored in this browser.");
                        snapshotSaved = true;
                        update((r) => ({ ...r, snapshotSaved: true }));
                    },
                    onChange: (id, state) => {
                        if (typeof state === "object" && state.status === "done") wrote = true;
                        update((r) => ({ ...r, progress: { ...r.progress, [id]: state } }));
                    },
                });
                const results: Record<string, ChangeResult> = { ...Object.fromEntries(sorted.alreadyThere.map((c) => [changeId(c), { status: "skipped" as const, reason: "Already there." }])), ...result.results };
                const saved = updateHistoryResults(history, tenantId, runId, results);
                const written = Object.values(results).some((r) => r.status === "done");
                update((r) => ({ ...r, progress: results, finishedAt: result.finishedAt, reread: written ? "reading" : "done", ...(saved || !snapshotSaved ? {} : { resultsNotSaved: true }) }));
                end();
                if (written) {
                    try {
                        if (!store.input) throw new Error("The page closed before the read again.");
                        await store.input.refresh(workloads, true, roleIdsOf(targets));
                        // The schedule lists lag a few seconds behind a write (tenant run 2026-10-09: a new active role
                        // assignment read as "not there", a removed one as "still there"): an assignment that differs is
                        // read again after a pause before the result says so
                        for (let attempt = 0; attempt < REREAD_RETRIES && assignmentsDiffer(changes, results, store.input, targets); attempt++) {
                            await new Promise((resolve) => setTimeout(resolve, REREAD_DELAY_MS));
                            if (!store.input) break;
                            await store.input.refresh(workloads, true, roleIdsOf(targets));
                        }
                        update((r) => ({ ...r, reread: "done" }));
                    } catch (error: unknown) {
                        Logger.warn("ConfigureApply", "Read again after the apply failed", error);
                        update((r) => ({ ...r, reread: "failed" }));
                    }
                }
            } catch (error: unknown) {
                Logger.error("ConfigureApply", "Apply stopped", error);
                const reason = error instanceof Error ? error.message : String(error);
                if (!snapshotSaved && !wrote) keepInBasket = true;
                settleAll(() => ({ status: "failed", message: wrote ? `Not known whether this was written: the apply stopped (${reason}). Check it in the Report.` : `Not written: the apply could not go on (${reason}).` }));
                const finished = store.run;
                if (finished?.runId === runId) updateHistoryResults(history, tenantId, runId, Object.fromEntries(Object.entries(finished.progress).filter(([, s]) => typeof s === "object")) as Record<string, ChangeResult>);
                end();
            } finally {
                store.controller = null;
            }
        })();
    }, [store, latestInput, session, tenantId, history]);

    const stop = useCallback(() => {
        store.controller?.abort();
        setStoreRun(store, (r) => (r && !r.finishedAt ? { ...r, isStopping: true } : r));
    }, [store]);

    const forget = useCallback(() => {
        if (store.controller) return;
        setStoreRun(store, () => null);
        writeMarker(session, tenantId, null);
    }, [store, session, tenantId]);

    const setUndo = useCallback((next: { warnings: UndoWarning[]; emptyReason: string | null } | null) => {
        setUndoState(next);
        try {
            if (next && next.warnings.length > 0) session?.setItem(UNDO_KEY + tenantId, JSON.stringify(next.warnings));
            else session?.removeItem(UNDO_KEY + tenantId);
        } catch {
            // the warnings are only lost on a reload
        }
    }, [session, tenantId]);

    const retryFailed = useCallback(() => {
        const current = store.run;
        if (!current?.finishedAt || store.controller) return;
        // A change still in the basket (rebased after "changed since your review") keeps its new starting value (W-06)
        const waiting = new Set((latestInput.get().basket?.changes ?? []).map(changeId));
        const failed = failedChanges(current).filter((c) => !waiting.has(changeId(c)));
        if (failed.length > 0) latestInput.get().addToBasket(failed);
        forget();
        latestInput.get().openReview();
    }, [store, latestInput, forget]);

    const undo = useCallback((runId: string) => {
        const entry = getHistoryEntry(history, tenantId, runId);
        if (!entry || undoing || store.controller) return;
        setUndoing({ runId, phase: "reading" });
        setUndoError(null);
        // Spec 14.3: the comparison with the targets as read now is the only guard, so a failed read stops the undo
        void latestInput.get().refresh(workloadsOf(targetsOf(entry.changes)), false, roleIdsOf(targetsOf(entry.changes)))
            .then(() => setUndoing({ runId, phase: "ready" }))
            .catch((error: unknown) => {
                Logger.warn("ConfigureApply", "Read again before undo failed", error);
                setUndoing(null);
                setUndoError({ runId, message: `Undo stopped: the targets could not be read again (${error instanceof Error ? error.message : String(error)}). Nothing changed; try Undo again.` });
            });
    }, [history, tenantId, undoing, store, latestInput]);

    // The read before an undo is in (the refresh resolves when the policies are in too): the basket from the snapshot
    // against the data as it is now, then the review
    useEffect(() => {
        if (undoing?.phase !== "ready") return;
        const entry = getHistoryEntry(history, tenantId, undoing.runId);
        setUndoing(null);
        if (!entry) return;
        const current = latestInput.get();
        const state = current.currentOverride ?? currentState(current.roles, current.groups, targetsOf(entry.changes));
        const { changes, warnings } = basketFromSnapshot(entry, state, new Date());
        setUndo({ warnings, emptyReason: changes.length === 0 ? "Nothing to undo: every value and assignment of this apply is already as it was before it, or could not be read again." : null });
        // Changes added while the targets were read stay; the undo comes next to them
        if (current.basket.changes.length === 0) current.replaceBasket(changes);
        else current.addToBasket(changes);
        current.openReview();
    }, [undoing, history, tenantId, latestInput, setUndo]);

    // The undo warnings belong to the undo basket: gone when the basket no longer holds an undo change
    const hasUndo = input.basket.changes.some((c) => c.source.from === "undo");
    const undoWarnings = hasUndo ? undoState?.warnings ?? null : null;
    const emptyReason = input.basket.changes.length === 0 ? undoState?.emptyReason ?? null : null;

    const intent = useMemo(() => {
        if (!run?.finishedAt || run.reread !== "done") return null;
        const results = Object.fromEntries(Object.entries(run.progress).filter(([, s]) => typeof s === "object")) as Record<string, ChangeResult>;
        return compareWithIntent({ changes: run.changes }, results, input.freshOverride ?? currentState(input.roles, input.groups, targetsOf(run.changes)));
    }, [run, input.freshOverride, input.roles, input.groups]);

    return { run, intent, isRunning, apply, stop, retryFailed, forget, undo, undoingRunId: undoing?.runId ?? null, undoWarnings, emptyReason, undoError };
}

export interface ApplyScreensInput {
    nameOf: (target: Target) => string;
    words: ValueWords;
    tenantName: string;
    /** The Report with the first target of the run opened */
    reportHref: (target: Target | null) => string;
    /** Why Undo cannot be used for this run, or null */
    undoBlockedReason: (runId: string) => string | null;
    /** "Back to Configure": the start page */
    onBack: () => void;
}

function downloadText(text: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([CSV_BOM, text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/** The progress list of the review and the result page of one apply, from the hook's state (spec 13.2, 14.1) */
export function applyScreens(apply: ConfigureApply, input: ApplyScreensInput): { progress: ReviewData["progress"]; result: ResultData } {
    const { run } = apply;
    const describe = run ? { run, nameOf: input.nameOf, words: input.words, tenantName: input.tenantName, intent: apply.intent } : null;
    const progress = describe && !run?.finishedAt ? { rows: describeProgress(describe), tenantName: input.tenantName, isStopping: run?.isStopping === true, onStop: apply.stop } : null;
    const view = describe && run?.finishedAt ? describeResult(describe) : null;
    const result: ResultData = {
        view,
        onRetry: apply.retryFailed,
        onDownloadCsv: () => {
            if (!view || !run) return;
            downloadText(resultsCsv(view, input.tenantName, run), `pim-apply-results-${(run.finishedAt ?? run.startedAt).slice(0, 10)}.csv`);
        },
        reportHref: input.reportHref(run?.changes[0]?.target ?? null),
        onUndo: () => run && apply.undo(run.runId),
        undoBlockedReason: run ? input.undoBlockedReason(run.runId) : null,
        onBack: () => {
            apply.forget();
            input.onBack();
        },
    };
    return { progress, result };
}
