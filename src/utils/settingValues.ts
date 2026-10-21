/**
 * Several targets at once (spec 5.6) and "Copy settings to…" (spec 5.8) as data (NG-65): the targets grouped by the
 * value they have now, the Keep or Set choices of the rows, and the changes they make. Pure; the several-targets view
 * and the copy dialog in `app/configure/components/edit` draw it, Guided (NG-70) fills the same choices.
 *
 * Only what is set is written: a target whose value already is the chosen one gets no change, and setting a target back
 * to its value as read drops its change (`setSetting` of the basket).
 */
import type { BasketSetting, ChangeSource, ChangeSourceKind, GroupAccess, SettingField, SettingValue, Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId, findSetting, type Basket } from "@/utils/configureBasket";
import { ACTIVATION_CATEGORIES, ASSIGNMENT_CATEGORIES, GROUP_APPROVERS_REQUIRED, nowValue, readTargetSettings, settingChange } from "@/utils/configureSettingRows";
import { NOTIFICATION_PROPERTIES } from "@/utils/configureNotificationRows";
import { NOTIFICATION_CELLS, notificationField, settingValuesEqualFor, type ApproverRef } from "@/utils/policyRules";

/** One selected target with its policy as read */
export interface SeveralEntry {
    target: Target;
    name: string;
    /** Null while the policy is not read, or when there is none */
    settings: PolicySettings | null;
    rules: readonly unknown[] | null | undefined;
    /** Why there is no value: the policy is still arriving, could not be read, or the group is not under PIM yet */
    missing?: "loading" | "failed" | "notUnderPim" | "notReadable";
}

export interface EntryLoading {
    /** The roles or their policies are still arriving */
    isRolesLoading: boolean;
    isGroupsLoading: boolean;
}

/** A role with its policy as read; a policy not there yet is "loading" while the roles load, else it failed */
export function roleEntry(role: RoleDetailData, loading: EntryLoading): SeveralEntry {
    const rules = role.policy?.details?.rules;
    const settings = readTargetSettings(rules);
    const missing = settings ? undefined : role.policiesForbidden ? "notReadable" : loading.isRolesLoading && !role.configError ? "loading" : "failed";
    return { target: { kind: "role", id: role.definition.id }, name: role.definition.displayName, settings, rules, missing };
}

/** A group's Member or Owner side with its policy; a group not under PIM has none yet */
export function groupEntry(group: PimGroupData, access: GroupAccess, loading: EntryLoading): SeveralEntry {
    const rules = group.policies?.[access]?.rules;
    const settings = readTargetSettings(rules);
    const missing = group.isManaged === false ? "notUnderPim" : group.policiesForbidden ? "notReadable" : settings ? undefined : loading.isGroupsLoading ? "loading" : "failed";
    return { target: { kind: "group", id: group.group.id, access }, name: group.group.displayName, settings, rules, missing };
}

/** The choices of the rows set; a field that is absent is Keep */
export type SeveralDraft = Partial<Record<SettingField, SettingValue>>;

// ---------------------------------------------------------------------------------------------------------------------
// The Now column

export interface ValueGroup {
    /** undefined: no value (see `missing`) */
    value: SettingValue | undefined;
    missing?: SeveralEntry["missing"] | "notInPolicy";
    names: string[];
    targets: Target[];
}

export interface NowColumn {
    /** One value on every target: "on all of them"; else "{k} different values" */
    isSame: boolean;
    groups: ValueGroup[];
    /** Selected targets with a change of this field waiting in the basket */
    waiting: number;
}

/**
 * The targets grouped by the value read from the tenant ("Now in {tenant}"), equal by meaning, in the order of the
 * selection. Targets without a value form their own groups by reason, after the values.
 */
export function groupByValue(field: SettingField, entries: readonly SeveralEntry[], basket: Basket): NowColumn {
    const groups: ValueGroup[] = [];
    const without: ValueGroup[] = [];
    let waiting = 0;
    for (const entry of entries) {
        if (findSetting(basket, entry.target, field)) waiting += 1;
        const value = nowValue(entry.settings, entry.rules, field);
        if (value === undefined) {
            const missing = entry.missing ?? (entry.settings ? "notInPolicy" : "loading");
            const group = without.find((g) => g.missing === missing);
            if (group) {
                group.names.push(entry.name);
                group.targets.push(entry.target);
            } else without.push({ value: undefined, missing, names: [entry.name], targets: [entry.target] });
            continue;
        }
        const group = groups.find((g) => settingValuesEqualFor(field, g.value, value));
        if (group) {
            group.names.push(entry.name);
            group.targets.push(entry.target);
        } else groups.push({ value, names: [entry.name], targets: [entry.target] });
    }
    const all = [...groups, ...without];
    return { isSame: all.length <= 1, groups: all, waiting };
}

export const MISSING_WORDS: Record<NonNullable<ValueGroup["missing"]>, string> = {
    loading: "Loading",
    failed: "Could not be read",
    notUnderPim: "No PIM settings yet",
    notReadable: "Not readable",
    notInPolicy: "Not in this policy",
};

/** The first names of a value and how many are behind "+{n}" (the render shows two) */
export function splitNames(names: readonly string[], shown = 2): { names: string[]; more: number } {
    if (names.length <= shown) return { names: [...names], more: 0 };
    return { names: names.slice(0, shown), more: names.length - shown };
}

/**
 * The value "Set to" starts with: the value most targets have now (the first in the selection on a tie), so the control
 * shows a value of the tenant, never a default. Undefined when no selected target has the field read.
 */
export function startValue(column: NowColumn): SettingValue | undefined {
    let best: ValueGroup | undefined;
    for (const group of column.groups) if (group.value !== undefined && (!best || group.targets.length > best.targets.length)) best = group;
    return best?.value;
}

// ---------------------------------------------------------------------------------------------------------------------
// From choices to changes

export interface SeveralPlan {
    add: BasketSetting[];
    /** Changes that go with the plan (an approvers change waiting on a target whose approval is set Off) */
    leaveOut: string[];
    /** Why the choices cannot be added (a group's approval without approvers); null when they can */
    problem: string | null;
    /** Targets left alone because a field set is not read for them (not under PIM, not read, not in the policy) */
    skipped: string[];
}

function effective(basket: Basket, entry: SeveralEntry, field: SettingField): SettingValue | undefined {
    const change = findSetting(basket, entry.target, field);
    return change ? change.to : nowValue(entry.settings, entry.rules, field);
}

/**
 * The changes of a set of choices: per target and field a change from the value read to the value chosen when the
 * target does not have it already (a field the target's policy lacks or that is not read is left alone). Approval Off
 * takes a waiting approvers change with it, as on one target; a group whose approval would be on without approvers
 * makes the plan a problem ("groups have no default approvers").
 */
export function planSeveral(draft: SeveralDraft, entries: readonly SeveralEntry[], basket: Basket, source: ChangeSourceKind | ChangeSource = "edit"): SeveralPlan {
    const add: BasketSetting[] = [];
    const leaveOut: string[] = [];
    const blocked: string[] = [];
    const skipped: string[] = [];
    const fields = Object.keys(draft) as SettingField[];
    // Approval Off makes its approvers meaningless: they are not written with it
    const writes = draft.requireApproval === false ? fields.filter((f) => f !== "approvers") : fields;

    for (const entry of entries) {
        for (const field of writes) {
            const to = draft[field] as SettingValue;
            const now = nowValue(entry.settings, entry.rules, field);
            // Approvers only count where approval is on after this plan (W-08): a target whose approval stays off gets none
            if (field === "approvers" && (draft.requireApproval ?? effective(basket, entry, "requireApproval")) !== true) continue;
            if (now === undefined && !skipped.includes(entry.name)) skipped.push(entry.name);
            if (now === undefined || settingValuesEqualFor(field, effective(basket, entry, field), to)) continue;
            const change = settingChange(entry.target, field, now, to);
            if (change) add.push({ ...change, source: typeof source === "string" ? { from: source } : source });
        }
        if (draft.requireApproval === false) {
            const waiting = findSetting(basket, entry.target, "approvers");
            if (waiting) leaveOut.push(changeId(waiting));
        }
        if (entry.target.kind === "group" && ("requireApproval" in draft || "approvers" in draft)) {
            const approval = draft.requireApproval ?? effective(basket, entry, "requireApproval");
            const approvers = (("approvers" in draft ? draft.approvers : effective(basket, entry, "approvers")) as ApproverRef[] | undefined) ?? [];
            const isRead = nowValue(entry.settings, entry.rules, "requireApproval") !== undefined;
            if (isRead && approval === true && approvers.length === 0) blocked.push(entry.name);
        }
    }
    const problem = blocked.length > 0 ? `${GROUP_APPROVERS_REQUIRED} No approvers: ${blocked.join(", ")}.` : null;
    return { add, leaveOut, problem, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------
// Copy settings to… (spec 5.8)

export type CopyCategory = "activation" | "assignment" | "notification";

export const COPY_CATEGORIES: ReadonlyArray<{ value: CopyCategory; label: string }> = [
    { value: "activation", label: "Activation" },
    { value: "assignment", label: "Assignment" },
    { value: "notification", label: "Notification" },
];


/** The fields of a category, in the order of the tabs */
export function fieldsOf(category: CopyCategory): SettingField[] {
    if (category === "activation") return ACTIVATION_CATEGORIES.flatMap((c) => c.rows.map((r) => r.field));
    if (category === "assignment") return ASSIGNMENT_CATEGORIES.flatMap((c) => c.rows.map((r) => r.field));
    // The additional recipients of an activation's approvers cannot be set (spec 5.10)
    return NOTIFICATION_CELLS.flatMap((cell) => NOTIFICATION_PROPERTIES.map((p) => notificationField(cell.section, cell.recipient, p)))
        .filter((f) => f !== "notifications.activation.approver.additionalRecipients");
}

/**
 * The choices a copy makes: every field of the chosen categories with the value the source shows now (its change in the
 * basket, else the value read). A field the source does not have is left out.
 */
export function copyDraft(source: SeveralEntry, categories: readonly CopyCategory[], basket: Basket): SeveralDraft {
    const draft: SeveralDraft = {};
    for (const category of categories) {
        for (const field of fieldsOf(category)) {
            const value = effective(basket, source, field);
            if (value !== undefined) draft[field] = value;
        }
    }
    return draft;
}

/** The plan of "Copy to {n}": one change per target and field where the value differs, with source `copy` */
export function planCopy(source: SeveralEntry, categories: readonly CopyCategory[], targets: readonly SeveralEntry[], basket: Basket): SeveralPlan {
    return planSeveral(copyDraft(source, categories, basket), targets, basket, "copy");
}

/** "{n} changes for {k} roles": the targets the plan touches */
export function countTouched(plan: SeveralPlan): number {
    return new Set(plan.add.map((c) => changeId(c).split("|")[1])).size;
}

/**
 * The plan in numbers: new changes, and waiting changes it undoes (the chosen value is the value read, so the basket
 * drops the change instead of adding one)
 */
export function countPlan(plan: SeveralPlan): { changes: number; undone: number; targets: number } {
    const undone = plan.add.filter((c) => settingValuesEqualFor(c.field, c.from, c.to)).length;
    return { changes: plan.add.length - undone, undone, targets: countTouched(plan) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What a plan does in words, "adds 3 changes and undoes 1 waiting change for 2 roles" (or "added ... undid" after
 * the fact); null when it does nothing. `noun` is "roles" or "groups".
 */
export function describePlan(plan: SeveralPlan, noun: string, tense: "present" | "past" = "present"): string | null {
    const { changes, undone, targets } = countPlan(plan);
    if (changes + undone === 0) return null;
    const [adds, undoes] = tense === "past" ? ["added", "undid"] : ["adds", "undoes"];
    const parts = [changes > 0 ? `${adds} ${plural(changes, "change", "changes")}` : "", undone > 0 ? `${undoes} ${plural(undone, "waiting change", "waiting changes")}` : ""].filter(Boolean);
    return `${parts.join(" and ")} for ${plural(targets, noun.replace(/s$/, ""), noun)}`;
}

/** The line under Select several: the one place for it (Edit and the Notification tab) */
export const keepSetNote = (noun: "roles" | "groups"): string => `Only what you set is written. "Keep" leaves each ${noun === "groups" ? "group" : "role"} as it is now.`;
