/**
 * Last applies and Undo (spec 14.2, 14.3, NG-58). An entry is saved right before the first write of an apply, with the
 * snapshot of the touched targets (`buildBackup`, schema 1) and the changes as applied; the results are added when the
 * apply ends. Kept per tenant in `localStorage` `pim-configure-history:{tenantId}`, the last ten, newest first; on a
 * quota error the oldest entries go until it fits. Sign-out clears it (`clearConfigureHistory`, decision N-030). Every read and write is guarded: a broken entry is dropped, never
 * thrown.
 *
 * `basketFromSnapshot` is the undo planner: changes with source `undo` that return each written value and assignment,
 * plus the warnings the review shows as checks.
 */
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import type { ChangeResult } from "@/utils/applyPlan";
import { changeId, isSettingField, targetKey } from "@/utils/configureBasket";
import type { Backup } from "@/utils/exportBackup";
import { fieldLabel } from "@/utils/configureReview";
import { readSettingValue, settingValuesEqualFor, type SettingField, type SettingValue } from "@/utils/policyRules";

export const HISTORY_STORAGE_PREFIX = "pim-configure-history:";
export const HISTORY_LIMIT = 10;
/** sessionStorage keys of `useConfigureApply`: the run marker and the undo basket with its warnings (names) */
export const RUN_STORAGE_PREFIX = "pim-configure-run:";
export const UNDO_STORAGE_PREFIX = "pim-configure-undo:";

type ClearableStorage = Pick<Storage, "removeItem" | "key" | "length">;

function removeByPrefix(storage: ClearableStorage | null, prefixes: readonly string[]): void {
    if (!storage) return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
    } catch {
        /* storage unusable: nothing to clear */
    }
}

/**
 * Sign-out (decision N-030, 2026-10-08: safe by design): Last applies, their snapshots with names and the undo state
 * of every tenant never outlive the session of the admin who made them. Undo is lost after a sign-out.
 */
export function clearConfigureHistory(local: ClearableStorage | null, session: ClearableStorage | null): void {
    removeByPrefix(local, [HISTORY_STORAGE_PREFIX]);
    removeByPrefix(session, [RUN_STORAGE_PREFIX, UNDO_STORAGE_PREFIX]);
}
const HISTORY_VERSION = 1;

export interface HistoryEntry {
    runId: string;
    /** ISO time the apply started */
    at: string;
    /** Who applied (display name or UPN) */
    by: string;
    /** The changes as applied */
    changes: Change[];
    /** Filled in when the apply ends; empty while it runs or when the page closed mid-apply */
    results: Record<string, ChangeResult>;
    targetCount: number;
    snapshot: Backup;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function isEntry(value: unknown): value is HistoryEntry {
    if (!value || typeof value !== "object") return false;
    const e = value as Partial<HistoryEntry>;
    return typeof e.runId === "string" && typeof e.at === "string" && typeof e.by === "string" && Array.isArray(e.changes)
        && !!e.results && typeof e.results === "object" && typeof e.targetCount === "number"
        && !!e.snapshot && typeof e.snapshot === "object" && (e.snapshot as Backup).schemaVersion === 1
        && e.changes.every((c) => !!c && typeof c === "object" && ["setting", "add", "update", "remove"].includes((c as Change).kind) && ((c as Change).kind !== "setting" || isSettingField((c as BasketSetting).field)));
}

export function listHistory(storage: StorageLike | null, tenantId: string): HistoryEntry[] {
    if (!storage || !tenantId) return [];
    try {
        const raw = storage.getItem(HISTORY_STORAGE_PREFIX + tenantId);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown };
        if (parsed?.version !== HISTORY_VERSION || !Array.isArray(parsed.entries)) return [];
        return parsed.entries.filter(isEntry);
    } catch {
        return [];
    }
}

export function getHistoryEntry(storage: StorageLike | null, tenantId: string, runId: string): HistoryEntry | null {
    return listHistory(storage, tenantId).find((e) => e.runId === runId) ?? null;
}

function write(storage: StorageLike, tenantId: string, entries: HistoryEntry[]): boolean {
    // Drop the oldest until it fits; an entry that does not fit alone is not saved
    for (let keep = entries.length; keep > 0; keep--) {
        try {
            storage.setItem(HISTORY_STORAGE_PREFIX + tenantId, JSON.stringify({ version: HISTORY_VERSION, entries: entries.slice(0, keep) }));
            return true;
        } catch {
            // quota: try with one fewer
        }
    }
    return false;
}

/** Saves a new entry first in the list (the snapshot before the first write); false when it could not be stored */
export function saveHistoryEntry(storage: StorageLike | null, tenantId: string, entry: HistoryEntry): boolean {
    if (!storage || !tenantId) return false;
    const rest = listHistory(storage, tenantId).filter((e) => e.runId !== entry.runId);
    const ok = write(storage, tenantId, [entry, ...rest].slice(0, HISTORY_LIMIT));
    // The new entry must be the one that survived
    return ok && listHistory(storage, tenantId)[0]?.runId === entry.runId;
}

/** Adds the results when the apply ends */
export function updateHistoryResults(storage: StorageLike | null, tenantId: string, runId: string, results: Record<string, ChangeResult>): boolean {
    if (!storage || !tenantId) return false;
    const entries = listHistory(storage, tenantId);
    const index = entries.findIndex((e) => e.runId === runId);
    if (index < 0) return false;
    entries[index] = { ...entries[index], results };
    return write(storage, tenantId, entries);
}

// ---------------------------------------------------------------------------------------------------------------------
// Undo

export interface UndoCurrentState {
    settings: (target: Target) => PolicySettings | null;
    /** The assignments of the target now, as identified by principal, scope and type */
    assignments: (target: Target) => ReadonlyArray<{ principalId: string; type: "eligible" | "active"; scope: string; start: string | null; end: string | null }>;
    /**
     * The value of one field as the edit screens read it (`nowValue`: an unlinked custom extension slot is the empty
     * link, not undefined). Optional; without it the value comes from `settings`.
     */
    value?: (target: Target, field: SettingField) => SettingValue | undefined;
}

export interface UndoWarning {
    /** Changed by someone else after the apply, added less than five minutes ago, the last owner of a group */
    kind: "changedMeanwhile" | "tooRecent" | "lastOwner" | "notRead";
    target: Target;
    text: string;
    changeId?: string;
    /** tooRecent: when the assignment can be removed (ISO) */
    from?: string;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * The basket that undoes an apply (spec 14.3): a setting the apply wrote goes back to the value read before it
 * (`from`); an added assignment is removed; a removed one is added again with its end and a new start; a changed end
 * goes back. Only changes that were written (`done`) are undone. Warnings: a value someone else changed after the
 * apply ("undo would overwrite it"), an added assignment younger than five minutes, the last owner of a group.
 */
export function basketFromSnapshot(entry: HistoryEntry, current: UndoCurrentState, now: Date): { changes: Change[]; warnings: UndoWarning[] } {
    const changes: Change[] = [];
    const warnings: UndoWarning[] = [];
    const source = { from: "undo" as const };
    const done = (c: Change) => entry.results[changeId(c)]?.status === "done";
    const has = (t: Target, principalId: string, scope: string, type: string) =>
        current.assignments(t).find((a) => a.principalId.toLowerCase() === principalId.toLowerCase() && (a.scope || "/") === (scope || "/") && a.type === type);

    for (const c of entry.changes) {
        if (!done(c)) continue;
        if (c.kind === "setting") {
            const settings = current.settings(c.target);
            if (!settings) {
                // Never silently: the review names the setting that is left out
                warnings.push({ kind: "notRead", target: c.target, text: `${fieldLabel(c.field)} could not be read again, so it is left out of the undo.` });
                continue;
            }
            const now = current.value ? current.value(c.target, c.field) : readSettingValue(settings, c.field);
            if (settingValuesEqualFor(c.field, now, c.from)) continue;
            const back: BasketSetting = { kind: "setting", target: c.target, field: c.field, from: now ?? c.to, to: c.from, source };
            // The warning names the undo change, so the review shows it while that change is in the basket
            if (!settingValuesEqualFor(c.field, now, c.to)) {
                warnings.push({ kind: "changedMeanwhile", target: c.target, changeId: changeId(back), text: `${fieldLabel(c.field)} was changed by someone else after this apply; undo would overwrite it.` });
            }
            changes.push(back);
            continue;
        }
        if (c.kind === "add") {
            const found = has(c.target, c.principal.id, c.scope, c.type);
            if (!found) continue;
            const remove: BasketRemove = { kind: "remove", target: c.target, schedule: { principal: c.principal, type: c.type, scope: c.scope, start: found.start, end: found.end }, source };
            const startedAt = found.start ? new Date(found.start).getTime() : new Date(entry.at).getTime();
            if (now.getTime() - startedAt < FIVE_MINUTES) {
                warnings.push({ kind: "tooRecent", target: c.target, changeId: changeId(remove), from: new Date(startedAt + FIVE_MINUTES).toISOString(), text: `${c.principal.displayName} can be removed from ${new Date(startedAt + FIVE_MINUTES).toISOString()}.` });
            }
            changes.push(remove);
            continue;
        }
        if (c.kind === "remove") {
            if (has(c.target, c.schedule.principal.id, c.schedule.scope, c.schedule.type)) continue;
            const end = c.schedule.end && new Date(c.schedule.end).getTime() <= now.getTime() ? null : c.schedule.end;
            if (c.schedule.end && end === null) continue; // its end has passed: nothing to give back
            changes.push({ kind: "add", target: c.target, principal: c.schedule.principal, type: c.schedule.type, scope: c.schedule.scope, start: null, end, justification: "Undo of an apply in PIM Manager", source } satisfies BasketAdd);
            continue;
        }
        const found = has(c.target, c.schedule.principal.id, c.schedule.scope, c.schedule.type);
        if (!found) continue;
        // The end before the apply has passed (a renewal, or an extension that ran out since): without the apply the
        // assignment would have ended, so undo removes it; Graph refuses a new end in the past (W-10)
        if (c.schedule.end && new Date(c.schedule.end).getTime() <= now.getTime()) {
            changes.push({ kind: "remove", target: c.target, schedule: { ...c.schedule, start: found.start, end: found.end }, source } satisfies BasketRemove);
            continue;
        }
        changes.push({ kind: "update", target: c.target, schedule: { ...c.schedule, start: found.start, end: found.end }, end: c.schedule.end, action: "adminUpdate", justification: "Undo of an apply in PIM Manager", source } satisfies BasketUpdate);
    }

    // The last owner: undoing adds of owners must leave one
    const ownerTargets = new Map<string, Target>();
    for (const c of changes) if (c.target.kind === "group" && c.target.access === "owner") ownerTargets.set(targetKey(c.target), c.target);
    for (const t of ownerTargets.values()) {
        const removed = changes.filter((c): c is BasketRemove => c.kind === "remove" && targetKey(c.target) === targetKey(t));
        const added = changes.filter((c) => c.kind === "add" && targetKey(c.target) === targetKey(t)).length;
        const left = current.assignments(t).filter((a) => !removed.some((r) => r.schedule.principal.id.toLowerCase() === a.principalId.toLowerCase() && r.schedule.type === a.type)).length + added;
        if (left === 0) warnings.push({ kind: "lastOwner", target: t, text: "Undo would remove the last owner of this group; Microsoft refuses that. Add another owner first." });
    }
    return { changes, warnings };
}
