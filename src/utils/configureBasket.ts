/**
 * The basket of changes of the Configure page (spec 10.1), as pure functions. Screens read and add changes; only the
 * apply engine writes them to a tenant.
 *
 * Rules:
 * - one setting change per target and field: a later one replaces it, and setting it back to the value read removes it
 *   (values compare by meaning, `settingValuesEqualFor`);
 * - an add and a remove of the same assignment (principal, target, scope, type) cancel each other; a remove followed by
 *   an add with another end becomes a change of end;
 * - `from` is always the value read from the tenant: each change carries the latest read, and `rebase` brings the basket
 *   in line after a new read.
 */
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, ConfigureTab, ScheduleRef, SettingField, SettingValue, Target } from "@/types/configure.types";
import { isPendingCustomExtensionPick } from "@/utils/customExtensionUtils";
import { settingValuesEqualFor } from "@/utils/policyRules";
import type { CustomExtensionLink } from "@/types/shared.types";

export interface Basket {
    changes: Change[];
}

export const EMPTY_BASKET: Basket = Object.freeze({ changes: Object.freeze([]) as unknown as Change[] });

// ---------------------------------------------------------------------------------------------------------------------
// Keys

export function targetKey(target: Target): string {
    return target.kind === "role" ? `role:${target.id}` : `group:${target.id}:${target.access}`;
}

export function sameTarget(a: Target, b: Target): boolean {
    return targetKey(a) === targetKey(b);
}

/** Principal, target, scope and type: what identifies an assignment (never a schedule id) */
export function assignmentKey(target: Target, principalId: string, scope: string, type: string): string {
    return `${targetKey(target)}|${principalId}|${scope || "/"}|${type}`;
}

function assignmentKeyOf(change: Change): string | null {
    if (change.kind === "add") return assignmentKey(change.target, change.principal.id, change.scope, change.type);
    if (change.kind === "update" || change.kind === "remove") return assignmentKey(change.target, change.schedule.principal.id, change.schedule.scope, change.schedule.type);
    return null;
}

/** A stable id per change: what "Leave out" and "Undo" remove */
export function changeId(change: Change): string {
    if (change.kind === "setting") return `setting|${targetKey(change.target)}|${change.field}`;
    return `${change.kind}|${assignmentKeyOf(change)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Values

/** Equality of setting values that ignores the order of object keys (and of plain string lists) */
export function settingValuesEqual(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
    return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) {
        const items = value.map(stableJson);
        return `[${(value.every((v) => typeof v === "string") ? [...items].sort() : items).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([k, v]) => v !== undefined && k !== "displayName")
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reducers (every one returns a new basket; none mutates)

function isPendingPick(change: BasketSetting): boolean {
    return (change.field === "customExtensions.preApproval" || change.field === "customExtensions.postApproval")
        && isPendingCustomExtensionPick(change.to as CustomExtensionLink);
}

/**
 * Adds a setting change, or replaces the one for that target and field. Back to the value read removes it. A custom
 * extension switched on without a pick is never a change (it is never written).
 */
export function setSetting(basket: Basket, change: BasketSetting): Basket {
    if (isPendingPick(change)) return basket;
    const id = changeId(change);
    const index = basket.changes.findIndex((c) => changeId(c) === id);
    if (settingValuesEqualFor(change.field, change.from, change.to)) {
        return index < 0 ? basket : { changes: basket.changes.filter((_, i) => i !== index) };
    }
    if (index < 0) return { changes: [...basket.changes, change] };
    return { changes: basket.changes.map((c, i) => (i === index ? change : c)) };
}

/**
 * Adds an assignment. A pending remove of the same assignment and this add cancel each other; when the add asks for
 * another end than the one read, it becomes a change of end (`adminUpdate`) instead.
 */
export function addAssignment(basket: Basket, change: BasketAdd): Basket {
    const key = assignmentKeyOf(change);
    const remove = basket.changes.find((c): c is BasketRemove => c.kind === "remove" && assignmentKeyOf(c) === key);
    if (remove) {
        const rest = basket.changes.filter((c) => c !== remove);
        if (sameInstant(change.end, remove.schedule.end)) return { changes: rest };
        const update: BasketUpdate = { kind: "update", target: change.target, schedule: remove.schedule, end: change.end, action: "adminUpdate", justification: change.justification, source: change.source };
        return { changes: [...rest, update] };
    }
    const id = changeId(change);
    if (basket.changes.some((c) => changeId(c) === id)) return { changes: basket.changes.map((c) => (changeId(c) === id ? change : c)) };
    return { changes: [...basket.changes, change] };
}

/**
 * Removes an assignment. A pending add of the same assignment and this remove cancel each other; a pending update of it
 * goes, since the assignment will not be there.
 */
export function removeAssignment(basket: Basket, change: BasketRemove): Basket {
    const key = assignmentKeyOf(change);
    const add = basket.changes.find((c) => c.kind === "add" && assignmentKeyOf(c) === key);
    if (add) return { changes: basket.changes.filter((c) => c !== add) };
    const id = changeId(change);
    const existing = basket.changes.findIndex((c) => changeId(c) === id);
    const kept = basket.changes.filter((c) => !(c.kind === "update" && assignmentKeyOf(c) === key));
    if (existing >= 0) return { changes: kept.map((c) => (changeId(c) === id ? change : c)) };
    return { changes: [...kept, change] };
}

/**
 * Changes the end of an assignment: replaces an earlier update of it; an end back to the one read removes it. On an
 * assignment that is only a pending add it changes the add's end; on a pending remove it does nothing.
 */
export function updateAssignment(basket: Basket, change: BasketUpdate): Basket {
    const key = assignmentKeyOf(change);
    const add = basket.changes.find((c): c is BasketAdd => c.kind === "add" && assignmentKeyOf(c) === key);
    if (add) return { changes: basket.changes.map((c) => (c === add ? { ...add, end: change.end } : c)) };
    if (basket.changes.some((c) => c.kind === "remove" && assignmentKeyOf(c) === key)) return basket;
    const id = changeId(change);
    const index = basket.changes.findIndex((c) => changeId(c) === id);
    if (change.action !== "adminRenew" && sameInstant(change.end, change.schedule.end)) {
        return index < 0 ? basket : { changes: basket.changes.filter((_, i) => i !== index) };
    }
    if (index >= 0) return { changes: basket.changes.map((c, i) => (i === index ? change : c)) };
    return { changes: [...basket.changes, change] };
}

function sameInstant(a: string | null, b: string | null): boolean {
    if (a === null || b === null) return a === b;
    return new Date(a).getTime() === new Date(b).getTime();
}

/** Applies any change through the rule of its kind */
export function addChange(basket: Basket, change: Change): Basket {
    switch (change.kind) {
        case "setting": return setSetting(basket, change);
        case "add": return addAssignment(basket, change);
        case "remove": return removeAssignment(basket, change);
        case "update": return updateAssignment(basket, change);
    }
}

export function addChanges(basket: Basket, changes: readonly Change[]): Basket {
    return changes.reduce(addChange, basket);
}

/** "Leave out" and "Undo": removes changes by id */
export function leaveOut(basket: Basket, ids: readonly string[]): Basket {
    const set = new Set(ids);
    const changes = basket.changes.filter((c) => !set.has(changeId(c)));
    return changes.length === basket.changes.length ? basket : { changes };
}

/** Removes every change of one target (or of several), for example when Guided clears dependent work */
export function clearTargets(basket: Basket, targets: readonly Target[]): Basket {
    const keys = new Set(targets.map(targetKey));
    const changes = basket.changes.filter((c) => !keys.has(targetKey(c.target)));
    return changes.length === basket.changes.length ? basket : { changes };
}

/**
 * After a new read (Refresh, a partial apply): each setting change takes the value read now as `from`, and a change
 * that now equals what the tenant has goes. `readNow` answers undefined for a value it does not know (kept as it is).
 */
export function rebase(basket: Basket, readNow: (target: Target, field: SettingField) => SettingValue | undefined): Basket {
    let changed = false;
    const changes: Change[] = [];
    for (const c of basket.changes) {
        if (c.kind !== "setting") { changes.push(c); continue; }
        const now = readNow(c.target, c.field);
        if (now === undefined || settingValuesEqualFor(c.field, now, c.from)) { changes.push(c); continue; }
        changed = true;
        if (!settingValuesEqualFor(c.field, now, c.to)) changes.push({ ...c, from: now });
    }
    return changed ? { changes } : basket;
}

export function discard(): Basket {
    return EMPTY_BASKET;
}

// ---------------------------------------------------------------------------------------------------------------------
// Selectors

const ACTIVATION_FIELDS: ReadonlySet<SettingField> = new Set<SettingField>([
    "maxActivationDuration", "activationRequirement", "requireJustificationOnActivation", "requireTicketInfo",
    "requireApproval", "approvers", "customExtensions.preApproval", "customExtensions.postApproval",
]);
const ASSIGNMENT_FIELDS: ReadonlySet<SettingField> = new Set<SettingField>([
    "allowPermanentEligible", "eligibleExpiration", "allowPermanentActive", "activeExpiration",
    "requireMfaOnActiveAssignment", "requireJustificationOnActiveAssignment",
]);

const NOTIFICATION_FIELD = /^notifications\.(eligibleAssignment|activeAssignment|activation)\.(admin|assignee|requestor|approver)\.(isEnabled|additionalRecipients|criticalOnly)$/;

/** Whether a string is a setting field the app knows (checked on everything read back from storage) */
export function isSettingField(value: unknown): value is SettingField {
    return typeof value === "string" && (ACTIVATION_FIELDS.has(value as SettingField) || ASSIGNMENT_FIELDS.has(value as SettingField) || NOTIFICATION_FIELD.test(value));
}

export function tabOfField(field: SettingField): ConfigureTab {
    if (ACTIVATION_FIELDS.has(field)) return "activation";
    if (ASSIGNMENT_FIELDS.has(field)) return "assignment";
    if (NOTIFICATION_FIELD.test(field)) return "notification";
    throw new Error(`No tab for setting field ${field}`);
}

export function tabOfChange(change: Change): ConfigureTab {
    return change.kind === "setting" ? tabOfField(change.field) : "who";
}

export function changesForTarget(basket: Basket, target: Target): Change[] {
    const key = targetKey(target);
    return basket.changes.filter((c) => targetKey(c.target) === key);
}

/** Number of changes per tab for one target */
export function countsByTab(basket: Basket, target: Target): Record<ConfigureTab, number> {
    const counts: Record<ConfigureTab, number> = { activation: 0, assignment: 0, notification: 0, who: 0 };
    for (const change of changesForTarget(basket, target)) counts[tabOfChange(change)] += 1;
    // Who has it of a group shows both sides, so its badge counts the assignments of both (N-048)
    if (target.kind === "group") {
        const other: Target = { ...target, access: target.access === "owner" ? "member" : "owner" };
        for (const change of changesForTarget(basket, other)) if (tabOfChange(change) === "who") counts.who += 1;
    }
    return counts;
}

/** Every target with at least one change, in the order of their first change */
export function touchedTargets(basket: Basket): Target[] {
    const seen = new Map<string, Target>();
    for (const change of basket.changes) {
        const key = targetKey(change.target);
        if (!seen.has(key)) seen.set(key, change.target);
    }
    return [...seen.values()];
}

/** Whether a role or group (either side) has changes, for the violet dot in the list */
export function hasChangesFor(basket: Basket, kind: Target["kind"], id: string): boolean {
    return basket.changes.some((c) => c.target.kind === kind && c.target.id === id);
}

/**
 * The basket's changes by change id and by assignment, built once per changes array (U-02): the reducers never change
 * an array in place, so the index stays right for as long as the array lives, and lookups no longer scan the basket
 */
const indexes = new WeakMap<readonly Change[], { byId: Map<string, Change>; byAssignment: Map<string, Change> }>();
function indexOf(changes: readonly Change[]) {
    let index = indexes.get(changes);
    if (!index) {
        index = { byId: new Map(), byAssignment: new Map() };
        for (const c of changes) {
            const id = changeId(c);
            if (!index.byId.has(id)) index.byId.set(id, c);
            const key = assignmentKeyOf(c);
            if (key && !index.byAssignment.has(key)) index.byAssignment.set(key, c);
        }
        indexes.set(changes, index);
    }
    return index;
}

export function findSetting(basket: Basket, target: Target, field: SettingField): BasketSetting | undefined {
    return indexOf(basket.changes).byId.get(`setting|${targetKey(target)}|${field}`) as BasketSetting | undefined;
}

/** "Now" with the basket applied: the value the change sets, else the value read */
export function effectiveSetting(basket: Basket, target: Target, field: SettingField, now: SettingValue): SettingValue {
    return findSetting(basket, target, field)?.to ?? now;
}

export function findAssignmentChange(basket: Basket, target: Target, schedule: Pick<ScheduleRef, "principal" | "scope" | "type">): Change | undefined {
    return indexOf(basket.changes).byAssignment.get(assignmentKey(target, schedule.principal.id, schedule.scope, schedule.type));
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage (sessionStorage, so a reload or a consent popup keeps the basket; bug 13)

export const BASKET_STORAGE_PREFIX = "pim-configure-basket:";

interface StoredBasket {
    version: 1;
    changes: Change[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isTarget(value: unknown): value is Target {
    if (!value || typeof value !== "object") return false;
    const t = value as { kind?: unknown; id?: unknown; access?: unknown };
    if (typeof t.id !== "string" || !t.id) return false;
    if (t.kind === "role") return true;
    return t.kind === "group" && (t.access === "member" || t.access === "owner");
}

function isPrincipal(value: unknown): boolean {
    const p = value as { id?: unknown; kind?: unknown } | null;
    return !!p && typeof p.id === "string" && (p.kind === "user" || p.kind === "group" || p.kind === "servicePrincipal");
}

function isSchedule(value: unknown): boolean {
    const s = value as { principal?: unknown; type?: unknown; scope?: unknown } | null;
    return !!s && isPrincipal(s.principal) && (s.type === "eligible" || s.type === "active") && typeof s.scope === "string";
}

/** Every change read back from storage is checked per kind, so a broken entry can never reach a selector */
function isChange(value: unknown): value is Change {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    if (!isTarget(v.target)) return false;
    switch (v.kind) {
        case "setting": return isSettingField(v.field) && "to" in v && "from" in v;
        case "add": return isPrincipal(v.principal) && (v.type === "eligible" || v.type === "active") && typeof v.scope === "string";
        case "update": return isSchedule(v.schedule) && (v.action === "adminUpdate" || v.action === "adminExtend" || v.action === "adminRenew");
        case "remove": return isSchedule(v.schedule);
        default: return false;
    }
}

export function readStoredBasket(storage: StorageLike | null, tenantId: string): Basket {
    if (!storage || !tenantId) return EMPTY_BASKET;
    try {
        const raw = storage.getItem(BASKET_STORAGE_PREFIX + tenantId);
        if (!raw) return EMPTY_BASKET;
        const parsed = JSON.parse(raw) as Partial<StoredBasket>;
        if (parsed.version !== 1 || !Array.isArray(parsed.changes)) return EMPTY_BASKET;
        return { changes: parsed.changes.filter(isChange) };
    } catch {
        return EMPTY_BASKET;
    }
}

/** Stores the basket; returns false when it could not be stored (quota, blocked storage), the page then keeps it in memory */
export function writeStoredBasket(storage: StorageLike | null, tenantId: string, basket: Basket): boolean {
    if (!storage || !tenantId) return false;
    const key = BASKET_STORAGE_PREFIX + tenantId;
    try {
        if (basket.changes.length === 0) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify({ version: 1, changes: basket.changes } satisfies StoredBasket));
        return true;
    } catch {
        try { storage.removeItem(key); } catch { /* storage unusable */ }
        return false;
    }
}

/** Sign-out: no basket of this tab outlives the session of the admin who made it */
export function clearStoredBaskets(storage: (Pick<Storage, "removeItem" | "key" | "length">) | null): void {
    if (!storage) return;
    try {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(BASKET_STORAGE_PREFIX)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
    } catch {
        /* storage unusable: nothing to clear */
    }
}
