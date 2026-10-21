/**
 * The plan of one apply (spec 13.1, NG-58): the steps of the review in their order, Settings, then New assignments,
 * then Updates, then Removals; a step starts when the one before is done. Pure: the engine
 * (`services/configureApplyService.ts`) runs it.
 *
 * Settings of one policy stay one item (its rules in the order of `buildRuleUpdates`, which sorts for
 * `MfaAndAcrsConflict`); items of different policies may run side by side.
 */
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Target } from "@/types/configure.types";
import { requestForChange, type ScheduleRequest } from "@/utils/assignmentRequests";
import { changeId, targetKey, type Basket } from "@/utils/configureBasket";
import { buildRuleUpdates, readSettingValue, settingValuesEqualFor, type GraphRule, type RuleUpdate, type SettingField, type SettingValue } from "@/utils/policyRules";
import type { PolicySettings } from "@/types/wizard.types";

/** One target as read before the apply: the policy it writes to */
export interface ApplyTargetState {
    target: Target;
    name: string;
    /** null when the policy could not be read: its setting changes cannot be applied */
    policyId: string | null;
    /** The rules as read (group rules may come without `target`) */
    rules: readonly GraphRule[] | null;
}

export interface SettingsItem {
    kind: "settings";
    target: Target;
    policyId: string;
    /** In the order they are written */
    updates: RuleUpdate[];
    /** The basket changes this item fulfils */
    changeIds: string[];
    /**
     * The rules each change writes (W-04): a change is written when all its rules were written, so a policy that fails
     * half way reports the changes that landed as done. A change with no rule to write (W-08) is skipped, never done
     */
    rulesByChange?: Record<string, string[]>;
}

export interface AssignmentItem {
    kind: "add" | "update" | "remove";
    target: Target;
    changeId: string;
    change: BasketAdd | BasketUpdate | BasketRemove;
    request: ScheduleRequest;
    /** An add whose end or permanence relies on a setting changed in this apply: skipped when those settings failed */
    dependsOnSettings: boolean;
}

export interface ApplyStep {
    kind: "settings" | "adds" | "updates" | "removals";
    items: (SettingsItem | AssignmentItem)[];
}

export interface ApplyPlan {
    steps: ApplyStep[];
    /** Changes that cannot be planned (their policy was not read): failed before any write */
    problems: { changeId: string; target: Target; reason: string }[];
    /** Every change id of the basket, in the order of the plan */
    changeIds: string[];
}

/** The rules an add of this type depends on: permanence and the maximum of that assignment type */
const DEPENDS: Record<"eligible" | "active", ReadonlySet<SettingField>> = {
    eligible: new Set<SettingField>(["allowPermanentEligible", "eligibleExpiration"]),
    active: new Set<SettingField>(["allowPermanentActive", "activeExpiration", "requireMfaOnActiveAssignment", "requireJustificationOnActiveAssignment"]),
};

export function planApply(basket: Basket, targets: Readonly<Record<string, ApplyTargetState>>): ApplyPlan {
    const settings = basket.changes.filter((c): c is BasketSetting => c.kind === "setting");
    const problems: ApplyPlan["problems"] = [];

    // Settings: one item per target (= per policy), in the order the targets first appear in the basket
    const byTarget = new Map<string, BasketSetting[]>();
    for (const c of settings) byTarget.set(targetKey(c.target), [...(byTarget.get(targetKey(c.target)) ?? []), c]);
    const settingsItems: SettingsItem[] = [];
    for (const [key, list] of byTarget) {
        const state = targets[key];
        const target = list[0].target;
        if (!state?.policyId || !state.rules) {
            for (const c of list) problems.push({ changeId: changeId(c), target, reason: `The settings of ${state?.name ?? target.id} were not read, so they cannot be changed.` });
            continue;
        }
        const workload = target.kind === "role" ? "directoryRoles" : "pimGroups";
        const rules = state.rules;
        const updates = buildRuleUpdates(workload, rules, list.map((c) => ({ field: c.field, to: c.to })));
        // A rule carries a change when the write differs without that change (approvers only write next to approval)
        const bodies = new Map(updates.map((u) => [u.ruleId, JSON.stringify(u.body)]));
        const rulesByChange = Object.fromEntries(list.map((c) => {
            const without = new Map(buildRuleUpdates(workload, rules, list.filter((o) => o !== c).map((o) => ({ field: o.field, to: o.to }))).map((u) => [u.ruleId, JSON.stringify(u.body)]));
            return [changeId(c), [...bodies].filter(([id, body]) => without.get(id) !== body).map(([id]) => id)];
        }));
        settingsItems.push({ kind: "settings", target, policyId: state.policyId, updates, changeIds: list.map(changeId), rulesByChange });
    }

    const assignmentItem = (change: BasketAdd | BasketUpdate | BasketRemove): AssignmentItem => {
        const type = change.kind === "add" ? change.type : change.schedule.type;
        const dependsOnSettings = change.kind === "add" && settings.some((s) => targetKey(s.target) === targetKey(change.target) && DEPENDS[type].has(s.field));
        return { kind: change.kind, target: change.target, changeId: changeId(change), change, request: requestForChange(change), dependsOnSettings };
    };
    const adds = basket.changes.filter((c): c is BasketAdd => c.kind === "add").map(assignmentItem);
    const updates = basket.changes.filter((c): c is BasketUpdate => c.kind === "update").map(assignmentItem);
    const removals = basket.changes.filter((c): c is BasketRemove => c.kind === "remove").map(assignmentItem);

    const steps: ApplyStep[] = [
        { kind: "settings" as const, items: settingsItems },
        { kind: "adds" as const, items: adds },
        { kind: "updates" as const, items: updates },
        { kind: "removals" as const, items: removals },
    ].filter((s) => s.items.length > 0);

    const changeIds = [
        ...problems.map((p) => p.changeId),
        ...settingsItems.flatMap((i) => i.changeIds),
        ...[...adds, ...updates, ...removals].map((i) => i.changeId),
    ];
    return { steps, problems, changeIds };
}

// ---------------------------------------------------------------------------------------------------------------------
// Results

export type ChangeResult =
    | { status: "done" }
    | { status: "failed"; code?: string; message: string; remediation?: string }
    | { status: "skipped"; reason: string }
    | { status: "stopped" };

export interface ApplyResult {
    runId: string;
    results: Record<string, ChangeResult>;
    startedAt: string;
    finishedAt: string;
}

/** What the tenant holds after the apply, read again (spec 13.3) */
export interface FreshState {
    settings: (target: Target) => PolicySettings | null;
    /** The assignment of this principal, scope and type on the target, or null when there is none */
    assignment: (target: Target, principalId: string, scope: string, type: "eligible" | "active") => { end: string | null } | null;
    /**
     * The value of one field as the edit screens read it (`nowValue`: an unlinked custom extension slot is the empty
     * link, not undefined). Optional; without it the value comes from `settings`.
     */
    value?: (target: Target, field: SettingField) => SettingValue | undefined;
}

export type IntentCheck = { matches: true } | { matches: false; now: string };

/** Ends within a minute count as equal: Graph rounds and a "when applied" start moves the end of a duration */
export function sameEnd(a: string | null, b: string | null): boolean {
    if (!a || !b) return a === b;
    return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;
}

function describeValue(value: SettingValue | undefined): string {
    if (value === undefined) return "not set";
    if (typeof value === "boolean") return value ? "on" : "off";
    if (typeof value === "string") return value || "empty";
    if (Array.isArray(value)) return value.length === 0 ? "none" : value.map((v) => (typeof v === "string" ? v : (v as { displayName?: string; id: string }).displayName ?? (v as { id: string }).id)).join(", ");
    if ("kind" in value) return value.kind === "authenticationContext" ? `authentication context ${value.contextId}` : value.kind === "mfa" ? "MFA" : "nothing";
    // A custom extension slot: its name (or id), never the raw object
    if ("customExtensionId" in value) {
        const link = value as { customExtensionId: string; isEnabled: boolean; displayName?: string };
        if (!link.customExtensionId.trim()) return "none";
        return `${link.displayName || link.customExtensionId}${link.isEnabled ? "" : " (off)"}`;
    }
    return JSON.stringify(value);
}

/**
 * After the read again: each change that was written either matches what the tenant holds now, or differs with the
 * value read (someone else may have changed it, Learn L11). Only `done` changes are compared.
 */
export function compareWithIntent(basket: Basket, results: Readonly<Record<string, ChangeResult>>, fresh: FreshState): Record<string, IntentCheck> {
    const out: Record<string, IntentCheck> = {};
    for (const change of basket.changes) {
        const id = changeId(change);
        if (results[id]?.status !== "done") continue;
        if (change.kind === "setting") {
            const settings = fresh.settings(change.target);
            if (!settings) continue;
            const now = fresh.value ? fresh.value(change.target, change.field) : readSettingValue(settings, change.field);
            out[id] = settingValuesEqualFor(change.field, now, change.to) ? { matches: true } : { matches: false, now: describeValue(now) };
            continue;
        }
        const principalId = change.kind === "add" ? change.principal.id : change.schedule.principal.id;
        const scope = change.kind === "add" ? change.scope : change.schedule.scope;
        const type = change.kind === "add" ? change.type : change.schedule.type;
        const found = fresh.assignment(change.target, principalId, scope, type);
        if (change.kind === "remove") {
            out[id] = found ? { matches: false, now: "still there" } : { matches: true };
        } else {
            const wanted = change.end;
            out[id] = !found ? { matches: false, now: "not there" } : sameEnd(found.end, wanted) ? { matches: true } : { matches: false, now: found.end ? `ends ${found.end}` : "no end" };
        }
    }
    return out;
}
