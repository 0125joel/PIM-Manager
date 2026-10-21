/**
 * The setting rows of Edit for one target (spec 5.5; NG-64) as data: the rows per tab under their category heads, the
 * value read from the tenant ("Now in {tenant}"), the value the basket holds, the words of every value, and the rules
 * that prevent a change while editing. Pure; `app/configure/components/edit` draws it.
 */
import type { Basket } from "@/utils/configureBasket";
import { changeId, findSetting } from "@/utils/configureBasket";
import { emptyCustomExtensionLink } from "@/utils/customExtensionUtils";
import type { BasketSetting, SettingField, SettingValue, Target } from "@/types/configure.types";
import type { AuthenticationContext, CustomExtensionLink } from "@/types/shared.types";
import type { PolicySettings } from "@/types/wizard.types";
import { EXPIRATION_OPTIONS, isZeroDuration, isoToApproxDays, toGraphDuration } from "@/utils/durationUtils";
import { parseGraphPolicy } from "@/utils/policyParser";
import { readSettingValue, settingValuesEqualFor, type ActivationRequirementValue, type ApproverRef } from "@/utils/policyRules";
import { completeRules } from "@/utils/policyView";
import { describeActivationDuration } from "@/utils/configureTargets";

export type SettingControl = "duration" | "requirement" | "onOff" | "approvers" | "extension" | "expiration";

export interface SettingRowDef {
    field: SettingField;
    label: string;
    /** The muted line under the label */
    help?: string;
    control: SettingControl;
    /** Approvers sit indented under Require approval */
    isIndented?: boolean;
}

export interface SettingCategory {
    title: string;
    /** "Preview" tag after the title (custom extensions) */
    isPreview?: boolean;
    rows: SettingRowDef[];
    /** The line under the category (custom extensions) */
    note?: string;
}

export const ACTIVATION_CATEGORIES: SettingCategory[] = [
    { title: "Duration", rows: [{ field: "maxActivationDuration", label: "Maximum activation duration", help: "From 1 to 24 hours.", control: "duration" }] },
    {
        title: "Before someone can activate",
        rows: [
            { field: "activationRequirement", label: "On activation, require", help: "One choice: nothing, MFA, or an authentication context. A context replaces MFA.", control: "requirement" },
            { field: "requireJustificationOnActivation", label: "Require justification", control: "onOff" },
            { field: "requireTicketInfo", label: "Require ticket information", control: "onOff" },
        ],
    },
    {
        title: "Approval",
        rows: [
            { field: "requireApproval", label: "Require approval to activate", control: "onOff" },
            { field: "approvers", label: "Approvers", control: "approvers", isIndented: true },
        ],
    },
    {
        title: "Custom extensions",
        isPreview: true,
        note: "Let your own service approve, auto-approve or deny an activation request. A custom extension is a REST API you host: a Logic App, an Azure Function or any service that accepts an HTTP POST. Needs Entra ID Governance or Entra Suite.",
        rows: [
            { field: "customExtensions.preApproval", label: "Before approval", help: "Your service answers Approved, AutoApproved or Denied. Documented by Microsoft.", control: "extension" },
            { field: "customExtensions.postApproval", label: "After approval", help: "Seen in tenants; Microsoft does not document it yet.", control: "extension" },
        ],
    },
];

export const ASSIGNMENT_CATEGORIES: SettingCategory[] = [
    {
        title: "Eligible assignments",
        rows: [
            { field: "allowPermanentEligible", label: "Allow permanent eligible assignment", control: "onOff" },
            { field: "eligibleExpiration", label: "Eligible assignments end after", control: "expiration" },
        ],
    },
    {
        title: "Active assignments",
        rows: [
            { field: "allowPermanentActive", label: "Allow permanent active assignment", control: "onOff" },
            { field: "activeExpiration", label: "Active assignments end after", control: "expiration" },
            { field: "requireMfaOnActiveAssignment", label: "Require MFA on active assignment", control: "onOff" },
            { field: "requireJustificationOnActiveAssignment", label: "Require justification on active assignment", control: "onOff" },
        ],
    },
];

export const ASSIGNMENT_NOTE = "Applies to new assignments. Existing assignments keep their end date; the review lists the ones that no longer fit.";

/** "End after" choices (spec 5.5); "Never" does not exist, permanence is the switch */
// The values come from durationUtils (N-026); the labels are in sentence case on this page
export const EXPIRATION_CHOICES: ReadonlyArray<{ value: string; label: string }> = EXPIRATION_OPTIONS.map((o) => ({ value: o.value, label: o.label.toLowerCase() }));

export const GROUP_APPROVERS_REQUIRED = "Choose at least one approver: groups have no default approvers.";
export const ROLE_DEFAULT_APPROVERS = "Privileged Role Administrators and Global Administrators approve when nobody is chosen.";
export const MISSING_EXTENSION = "Missing extension";
/** A rule the policy as read does not have (a tenant without the post-approval slot): shown, never written */
export const NOT_IN_POLICY = "Not in this policy";
/** A group not under PIM has no policy to read yet (spec 5.2: it comes under PIM when a change is applied) */
export const NOT_UNDER_PIM_SETTINGS = "This group is not under PIM yet, so it has no PIM settings. It comes under PIM with its first assignment (Who has it); its settings can be changed after that.";

/** The choice of the select that a duration read from the tenant matches, by days (P365D is "1 year", P180D "6 months") */
export function expirationChoiceOf(iso: string | undefined): string | null {
    if (!iso) return null;
    const graph = toGraphDuration(iso);
    return EXPIRATION_CHOICES.find((c) => toGraphDuration(c.value) === graph)?.value ?? null;
}

export function describeExpiration(iso: string | undefined): string {
    if (!iso) return "Not set";
    // What Graph stores while permanent is allowed without a maximum; then only assignments without an end are accepted
    if (isZeroDuration(iso)) return "No maximum (permanent only)";
    const choice = EXPIRATION_CHOICES.find((c) => c.value === expirationChoiceOf(iso));
    if (choice) return choice.label;
    const days = Math.round(isoToApproxDays(iso));
    return Number.isFinite(days) ? `${days} ${days === 1 ? "day" : "days"}` : iso;
}

export interface ValueWords {
    contexts: readonly AuthenticationContext[];
    /** The tenant's extensions when the list can be read; null when not (403, no licence) */
    extensions: ReadonlyArray<{ id: string; displayName: string }> | null;
}

export function describeRequirement(value: ActivationRequirementValue, contexts: readonly AuthenticationContext[]): string {
    if (value.kind === "mfa") return "Multifactor authentication";
    if (value.kind === "none") return "Nothing";
    const name = contexts.find((c) => c.id === value.contextId)?.displayName ?? value.contextId;
    return `Auth context: ${name}`;
}

function describeApprovers(list: readonly ApproverRef[]): string {
    if (list.length === 0) return "Nobody chosen";
    return list.map((a) => (a.type === "manager" ? "Manager" : a.displayName && a.displayName !== a.id ? a.displayName : a.id)).join(", ");
}

function describeExtension(link: CustomExtensionLink | undefined, extensions: ValueWords["extensions"]): string {
    if (!link || !link.customExtensionId) return "None";
    const known = extensions?.find((e) => e.id === link.customExtensionId);
    if (known) return known.displayName;
    // The list says it is gone; without the list the rule's own name is all there is
    if (extensions) return MISSING_EXTENSION;
    return link.displayName || link.customExtensionId;
}

/** The words of a value in the Now column and the review */
export function describeSettingValue(field: SettingField, value: SettingValue | undefined, words: ValueWords): string {
    if (value === undefined) return "Not set";
    if (field === "maxActivationDuration") return typeof value === "string" ? describeActivationDuration(value) ?? value : "Not set";
    if (field === "eligibleExpiration" || field === "activeExpiration") return describeExpiration(typeof value === "string" ? value : undefined);
    if (field === "activationRequirement") return describeRequirement(value as ActivationRequirementValue, words.contexts);
    if (field === "approvers") return describeApprovers(value as ApproverRef[]);
    if (field === "customExtensions.preApproval" || field === "customExtensions.postApproval") return describeExtension(value as CustomExtensionLink, words.extensions);
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
    return String(value);
}

/** The settings of a target as read: the role's policy, or the group's Member or Owner policy; null while not read */
export function readTargetSettings(rules: readonly unknown[] | null | undefined): PolicySettings | null {
    if (!rules || rules.length === 0) return null;
    return parseGraphPolicy({ rules: completeRules(rules) });
}

export interface SettingRowState {
    def: SettingRowDef;
    /** Read from the tenant; undefined while the policy is not read */
    now: SettingValue | undefined;
    /** What the control shows: the basket's value, else Now */
    value: SettingValue | undefined;
    change: BasketSetting | undefined;
}

const EXTENSION_RULES: Partial<Record<SettingField, string>> = {
    "customExtensions.preApproval": "CustomExtension_PreApproval_EndUser_Assignment",
    "customExtensions.postApproval": "CustomExtension_PostApproval_EndUser_Assignment",
};

/**
 * The value read for a field. An extension slot whose rule is in the policy but links nothing reads as an empty link
 * (the parser leaves it out), so it can be linked; a slot whose rule the policy lacks stays undefined (never written).
 */
export function nowValue(settings: PolicySettings | null, rules: readonly unknown[] | null | undefined, field: SettingField): SettingValue | undefined {
    if (!settings) return undefined;
    const value = readSettingValue(settings, field);
    const ruleId = EXTENSION_RULES[field];
    if (value !== undefined || !ruleId) return value;
    const hasRule = (rules ?? []).some((r) => !!r && typeof r === "object" && (r as { id?: unknown }).id === ruleId);
    return hasRule ? emptyCustomExtensionLink() : undefined;
}

export function buildSettingRows(categories: readonly SettingCategory[], settings: PolicySettings | null, basket: Basket, target: Target, rules?: readonly unknown[] | null): { title: string; isPreview?: boolean; note?: string; rows: SettingRowState[] }[] {
    return categories.map((category) => ({
        title: category.title,
        isPreview: category.isPreview,
        note: category.note,
        rows: category.rows.map((def) => {
            const now = nowValue(settings, rules, def.field);
            const change = findSetting(basket, target, def.field);
            return { def, now, value: change ? change.to : now, change };
        }),
    }));
}

/**
 * The setting change for the basket, from the value read; null while the value is not read (never a default). Setting
 * it back to the value read is still a change object: the basket then drops the change (`setSetting`).
 */
export function settingChange(target: Target, field: SettingField, now: SettingValue | undefined, to: SettingValue): BasketSetting | null {
    if (now === undefined) return null;
    return { kind: "setting", target, field, from: now, to, source: { from: "edit" } };
}

/** Whether the control's value differs from the value read (the changed row style) */
export function isChanged(field: SettingField, now: SettingValue | undefined, value: SettingValue | undefined): boolean {
    return now !== undefined && value !== undefined && !settingValuesEqualFor(field, now, value);
}

/**
 * The warning under the context select (spec 5.5, 12.5): a context only protects when an enabled Conditional Access
 * policy targets it. Null when it does, or when Conditional Access could not be read (`state` undefined).
 */
export function contextWarning(state: "enabled" | "reportOnly" | "off" | "none" | undefined): string | null {
    if (state === undefined || state === "enabled") return null;
    if (state === "reportOnly") return "Every Conditional Access policy for this context is report-only, so activation asks nothing extra.";
    if (state === "off") return "Every Conditional Access policy for this context is off, so activation asks nothing extra.";
    return "No Conditional Access policy uses this context, so activation asks nothing extra.";
}

// ---------------------------------------------------------------------------------------------------------------------
// Approval and its approvers belong together (spec 5.5, prevented rules)

export interface ApprovalState {
    target: Target;
    nowApproval: SettingValue | undefined;
    nowApprovers: SettingValue | undefined;
    basket: Basket;
    /** A group's approval switched on and waiting for its first approver (not in the basket yet) */
    pending: boolean;
}

export type ApprovalAction =
    | { kind: "toggle"; on: boolean }
    | { kind: "approvers"; list: ApproverRef[] }
    | { kind: "undo"; field: "requireApproval" | "approvers" };

export interface ApprovalPlan {
    add: BasketSetting[];
    leaveOut: string[];
    pending: boolean;
}

/**
 * What one edit of the approval rows does to the basket. A group has no default approvers, so its approval never goes
 * into the basket without one: switching it on waits (`pending`) until the first approver, the last approver cannot go
 * while approval is on, and undoing the approvers also undoes the approval when nobody would be left. Approval going
 * off (switched, or its change undone) takes the approvers change with it, which would otherwise wait unseen.
 */
export function planApprovalEdit(state: ApprovalState, action: ApprovalAction): ApprovalPlan {
    const { target, basket } = state;
    const approvalChange = findSetting(basket, target, "requireApproval");
    const approversChange = findSetting(basket, target, "approvers");
    const approval = approvalChange ? approvalChange.to : state.nowApproval;
    const approvers = ((approversChange ? approversChange.to : state.nowApprovers) as ApproverRef[] | undefined) ?? [];
    const isGroup = target.kind === "group";
    const none: ApprovalPlan = { add: [], leaveOut: [], pending: state.pending };
    const set = (field: SettingField, now: SettingValue | undefined, to: SettingValue) => settingChange(target, field, now, to);
    const dropApprovers = approversChange ? [changeId(approversChange)] : [];

    switch (action.kind) {
        case "toggle": {
            if (state.nowApproval === undefined) return none;
            if (action.on) {
                if (isGroup && approvers.length === 0) return { add: [], leaveOut: [], pending: true };
                return { add: [set("requireApproval", state.nowApproval, true)!], leaveOut: [], pending: false };
            }
            return { add: [set("requireApproval", state.nowApproval, false)!], leaveOut: dropApprovers, pending: false };
        }
        case "approvers": {
            if (state.nowApprovers === undefined) return none;
            const on = approval === true || state.pending;
            if (isGroup && on && action.list.length === 0) return none;
            const add = [set("approvers", state.nowApprovers, action.list)!];
            if (state.pending && action.list.length > 0 && state.nowApproval !== undefined) add.unshift(set("requireApproval", state.nowApproval, true)!);
            return { add, leaveOut: [], pending: state.pending && action.list.length === 0 };
        }
        case "undo": {
            if (action.field === "requireApproval") {
                return { add: [], leaveOut: [...(approvalChange ? [changeId(approvalChange)] : []), ...dropApprovers], pending: false };
            }
            const nowList = (state.nowApprovers as ApproverRef[] | undefined) ?? [];
            const alsoApproval = isGroup && approval === true && nowList.length === 0 && approvalChange ? [changeId(approvalChange)] : [];
            return { add: [], leaveOut: [...dropApprovers, ...alsoApproval], pending: false };
        }
    }
}
