/**
 * The review of Configure as data (spec 12.1 to 12.3; NG-68): the targets as read for the pre-flight and the apply plan,
 * the approver role holders, and the view model of the review page (verdict, the items that need attention, every check
 * with its outcome, the write steps with Leave out, the removal confirmation). Pure; `app/configure/components/review`
 * draws it and the container runs `buildPreflight` with it.
 */
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, PrincipalRef, Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { GroupPimAssignment, PimGroupData } from "@/types/pimGroup.types";
import type { ApplyTargetState } from "@/utils/applyPlan";
import { changeId, targetKey, touchedTargets, type Basket } from "@/utils/configureBasket";
import type { PreflightAssignment, PreflightCheck, PreflightFix, PreflightOutcome, PreflightTargetState } from "@/utils/configurePreflight";
import { preflightVerdict } from "@/utils/configurePreflight";
import { ACTIVATION_CATEGORIES, ASSIGNMENT_CATEGORIES, describeSettingValue, readTargetSettings, type ValueWords } from "@/utils/configureSettingRows";
import type { GraphRule } from "@/utils/policyRules";
import { getPrincipalKind, toBasicKind } from "@/utils/principalUtils";
import type { ResultRow } from "@/utils/configureResult";
import { ROLE_TEMPLATES } from "@/utils/writeAccess";

// ---------------------------------------------------------------------------------------------------------------------
// The targets as read

type Principalish = { id?: string; displayName?: string; userPrincipalName?: string; "@odata.type"?: string } | undefined;

function principalRef(id: string, principal: Principalish): PrincipalRef {
    const kind = toBasicKind(getPrincipalKind(principal));
    return {
        id,
        kind: kind === "group" ? "group" : kind === "servicePrincipal" ? "servicePrincipal" : "user",
        displayName: principal?.displayName ?? id,
        ...(principal?.userPrincipalName ? { userPrincipalName: principal.userPrincipalName } : {}),
    };
}

interface ScheduleLike {
    principalId: string;
    principal?: Principalish;
    directoryScopeId?: string;
    memberType?: string;
    viaGroup?: boolean;
    scheduleInfo?: { startDateTime?: string; expiration?: { endDateTime?: string } };
}

function roleAssignment(s: ScheduleLike, type: "eligible" | "active"): PreflightAssignment {
    return {
        principal: principalRef(s.principalId, s.principal),
        type,
        scope: s.directoryScopeId || "/",
        start: s.scheduleInfo?.startDateTime ?? null,
        end: s.scheduleInfo?.expiration?.endDateTime ?? null,
        ...(s.viaGroup || (s.memberType ?? "").toLowerCase() === "group" ? { viaGroup: true } : {}),
    };
}

function groupAssignment(a: GroupPimAssignment): PreflightAssignment {
    return {
        principal: principalRef(a.principalId, a.principal),
        type: a.assignmentType === "eligible" ? "eligible" : "active",
        scope: "/",
        start: a.startDateTime ?? a.scheduleInfo?.startDateTime ?? null,
        end: a.endDateTime ?? a.scheduleInfo?.expiration?.endDateTime ?? null,
        ...((a.memberType ?? "").toLowerCase() === "group" ? { viaGroup: true } : {}),
    };
}

/** `Expiration_EndUser_Assignment.isExpirationRequired` of the rules as read; undefined when the rule is absent */
function activationEndRequired(rules: readonly unknown[] | null | undefined): boolean | undefined {
    const rule = (rules ?? []).find((r) => !!r && typeof r === "object" && (r as { id?: unknown }).id === "Expiration_EndUser_Assignment") as { isExpirationRequired?: unknown } | undefined;
    return typeof rule?.isExpirationRequired === "boolean" ? rule.isExpirationRequired : undefined;
}

export interface TargetStates {
    /** By `targetKey`, for `buildPreflight` */
    preflight: Record<string, PreflightTargetState>;
    /** By `targetKey`, for `planApply` */
    apply: Record<string, ApplyTargetState>;
}

/** The targets of the basket as read from the loaded roles and groups; a target that is not loaded is left out */
export function buildTargetStates(roles: readonly RoleDetailData[], groups: readonly PimGroupData[], targets: readonly Target[]): TargetStates {
    const preflight: Record<string, PreflightTargetState> = {};
    const apply: Record<string, ApplyTargetState> = {};
    for (const target of targets) {
        const key = targetKey(target);
        if (target.kind === "role") {
            const role = roles.find((r) => r.definition.id === target.id);
            if (!role) continue;
            const rules = role.policy?.details?.rules ?? null;
            preflight[key] = {
                target,
                name: role.definition.displayName,
                isPrivileged: role.definition.isPrivileged === true,
                isBuiltIn: role.definition.isBuiltIn !== false,
                settings: readTargetSettings(rules),
                activationEndRequired: activationEndRequired(rules),
                assignments: [
                    ...role.assignments.eligible.map((s) => roleAssignment(s as ScheduleLike, "eligible")),
                    ...role.assignments.active.map((s) => roleAssignment(s as ScheduleLike, "active")),
                ],
            };
            apply[key] = { target, name: role.definition.displayName, policyId: role.policy?.details?.id ?? role.policy?.assignment?.policyId ?? null, rules: (rules as GraphRule[] | null) ?? null };
        } else {
            const group = groups.find((g) => g.group.id === target.id);
            if (!group) continue;
            const policy = group.policies?.[target.access];
            const rules = policy?.rules ?? null;
            preflight[key] = {
                target,
                name: group.group.displayName,
                settings: readTargetSettings(rules),
                activationEndRequired: activationEndRequired(rules),
                assignments: group.assignments.filter((a) => a.accessType === target.access).map(groupAssignment),
                isUnderPim: group.isManaged !== false,
                isAssignableToRole: group.group.isAssignableToRole === true,
            };
            apply[key] = { target, name: group.group.displayName, policyId: policy?.id ?? null, rules: (rules as unknown as GraphRule[] | null) ?? null };
        }
    }
    return { preflight, apply };
}

/**
 * Who approves a role without approvers (spec 12.4, check "roleApprovers"): how many principals hold Privileged Role
 * Administrator or Global Administrator active, and the emergency access accounts among the holders.
 */
export function approverRoleHolders(roles: readonly RoleDetailData[], emergencyAccounts: ReadonlyMap<string, string>): { activeHolders: number; emergencyNames: string[] } | null {
    const approverRoles = roles.filter((r) => {
        const template = (r.definition.templateId ?? r.definition.id).toLowerCase();
        return template === ROLE_TEMPLATES.privilegedRoleAdministrator || template === ROLE_TEMPLATES.globalAdministrator;
    });
    if (approverRoles.length === 0) return null;
    const holders = new Set<string>();
    const all = new Set<string>();
    for (const role of approverRoles) {
        for (const s of role.assignments.active) holders.add(s.principalId.toLowerCase());
        for (const s of [...role.assignments.active, ...role.assignments.eligible]) all.add(s.principalId.toLowerCase());
    }
    const emergencyNames = [...emergencyAccounts.entries()].filter(([id]) => all.has(id.toLowerCase())).map(([, name]) => name);
    return { activeHolders: holders.size, emergencyNames };
}

// ---------------------------------------------------------------------------------------------------------------------
// The review page

export const OUTCOME_LABEL: Record<PreflightOutcome, string> = {
    pass: "Passed",
    warn: "Check this",
    block: "Fix first",
    prevented: "Prevented while editing",
    notChecked: "Not checked",
};

export type Tone = "danger" | "warn" | "info" | "success";

export interface ReviewAttention {
    id: string;
    tone: Tone;
    /** The outcome in words, as "See all" says it: "Fix first", "Check this", "Not checked", "Passed" */
    label: string;
    title: string;
    text: string;
    /** One line per target or assignment */
    items: string[];
    fix?: PreflightCheck["fix"];
}

export interface SettingGroupRow {
    key: string;
    /** "On activation, require" */
    label: string;
    from: string;
    to: string;
    targets: { name: string; changeId: string }[];
}

export interface AssignmentRow {
    changeId: string;
    principal: string;
    target: string;
    /** Adds: "Eligible" or "Active" */
    type?: string;
    scope?: string;
    /** "Starts when applied" or "Starts 1 Apr 2027" */
    start?: string;
    /** "Ends 1 Apr 2027" or "No end date" */
    end?: string;
    /** Updates: the end as read and the new end */
    oldEnd?: string;
    newEnd?: string;
    /** Removals: "Remove eligible" or "Remove active" */
    tag?: string;
    /** The line of the imported file this change came from: "line 4" (Import, spec 7.3) */
    line?: string;
}

/** "line 4" for a change that came from an imported file, else nothing */
const lineOf = (c: Change): { line: string } | Record<string, never> => (c.source.from === "import" && c.source.line !== undefined ? { line: `line ${c.source.line}` } : {});

export interface ReviewView {
    isEmpty: boolean;
    verdict: { tone: "success" | "warn" | "danger"; sentence: string };
    /** "PIM Manager checked {n} things: ..." */
    checkedLine: string;
    targetNames: string[];
    attention: ReviewAttention[];
    allChecks: { id: string; title: string; outcome: string }[];
    steps: {
        settings: SettingGroupRow[];
        settingsCount: number;
        adds: AssignmentRow[];
        updates: AssignmentRow[];
        removals: AssignmentRow[];
    };
    changeCount: number;
    targetCount: number;
    /** Apply is not allowed while a check says Fix first */
    canApply: boolean;
    /** Names for "Remove {n} assignments: {names}" */
    removalNames: string[];
    /** From 20 targets on the confirmation lists the count per setting (spec 12.3) */
    countPerSetting: { label: string; count: number }[] | null;
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries([...ACTIVATION_CATEGORIES, ...ASSIGNMENT_CATEGORIES].flatMap((c) => c.rows.map((r) => [r.field, r.label])));

const NOTIFICATION_SECTION: Record<string, string> = { eligibleAssignment: "When someone is made eligible", activeAssignment: "When someone is assigned active", activation: "When someone activates" };
const NOTIFICATION_PROPERTY: Record<string, string> = { isEnabled: "default recipients", additionalRecipients: "additional recipients", criticalOnly: "critical emails only" };

/** The label of a setting field in the review: the row of Edit, or "{when}: {recipient}, {property}" for a notification cell */
export function fieldLabel(field: string): string {
    if (field.startsWith("notifications.")) {
        const [, section, recipient, property] = field.split(".");
        return `${NOTIFICATION_SECTION[section] ?? section}: ${recipient}, ${NOTIFICATION_PROPERTY[property] ?? property}`;
    }
    return FIELD_LABELS[field] ?? field;
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "No end date";
    const d = new Date(iso);
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`;
}

function toneOf(check: PreflightCheck): Tone | null {
    if (check.outcome === "block") return "danger";
    if (check.outcome === "warn" || check.outcome === "notChecked") return "warn";
    if (check.info) return "info";
    return null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface ReviewInput {
    basket: Basket;
    checks: readonly PreflightCheck[];
    /** The name of a target (role name, "{group} · Member") */
    nameOf: (target: Target) => string;
    words: ValueWords;
}

export function describeReview({ basket, checks, nameOf, words }: ReviewInput): ReviewView {
    const changes = basket.changes;
    const targets = touchedTargets(basket);
    const verdict = preflightVerdict(checks);
    const verdictView: ReviewView["verdict"] = verdict.kind === "fix"
        ? { tone: "danger", sentence: `${plural(verdict.count, "thing", "things")} to fix before you can apply` }
        : verdict.kind === "lookAt"
            ? { tone: "warn", sentence: `Ready to apply, ${plural(verdict.count, "thing", "things")} to look at` }
            : { tone: "success", sentence: "Ready to apply" };

    const attention: ReviewAttention[] = [];
    for (const check of checks) {
        const tone = toneOf(check);
        if (!tone) continue;
        attention.push({ id: check.id, tone, label: OUTCOME_LABEL[check.outcome], title: check.title, text: check.text, items: check.items.map((i) => i.text), ...(check.fix ? { fix: check.fix } : {}) });
    }
    const order: Record<Tone, number> = { danger: 0, warn: 1, info: 2, success: 3 };
    attention.sort((a, b) => order[a.tone] - order[b.tone]);

    // Settings, grouped by field and the pair of values
    const settingGroups = new Map<string, SettingGroupRow>();
    const settings = changes.filter((c): c is BasketSetting => c.kind === "setting");
    for (const change of settings) {
        const from = describeSettingValue(change.field, change.from, words);
        const to = describeSettingValue(change.field, change.to, words);
        const key = `${change.field}|${from}|${to}`;
        const row = settingGroups.get(key) ?? { key, label: fieldLabel(change.field), from, to, targets: [] };
        row.targets.push({ name: nameOf(change.target), changeId: changeId(change) });
        settingGroups.set(key, row);
    }

    const adds = changes.filter((c): c is BasketAdd => c.kind === "add").map((c): AssignmentRow => ({
        changeId: changeId(c),
        principal: c.principal.displayName,
        target: nameOf(c.target),
        type: c.type === "eligible" ? "Eligible" : "Active",
        scope: c.scope === "/" ? "Tenant-wide" : c.scopeName ?? c.scope,
        start: c.start ? `Starts ${formatDate(c.start)}` : "Starts when applied",
        end: c.end ? `Ends ${formatDate(c.end)}` : "No end date",
        ...lineOf(c),
    }));
    const updates = changes.filter((c): c is BasketUpdate => c.kind === "update").map((c): AssignmentRow => ({
        changeId: changeId(c),
        principal: c.schedule.principal.displayName,
        target: nameOf(c.target),
        oldEnd: formatDate(c.schedule.end),
        newEnd: formatDate(c.end),
        ...lineOf(c),
    }));
    const removalChanges = changes.filter((c): c is BasketRemove => c.kind === "remove");
    const removals = removalChanges.map((c): AssignmentRow => ({
        changeId: changeId(c),
        principal: c.schedule.principal.displayName,
        target: nameOf(c.target),
        tag: c.schedule.type === "eligible" ? "Remove eligible" : "Remove active",
        ...lineOf(c),
    }));

    const countPerSetting = targets.length >= 20
        ? [...new Set(settings.map((c) => c.field))].map((field) => ({ label: fieldLabel(field), count: settings.filter((c) => c.field === field).length }))
        : null;

    return {
        isEmpty: changes.length === 0,
        verdict: verdictView,
        checkedLine: `PIM Manager checked ${checks.length} things: what Microsoft would reject, what changes for the people who activate, and your own access. A snapshot of ${targets.length === 1 ? "this target" : `these ${targets.length} targets`} is saved before the first write, so you can undo this apply.`,
        targetNames: targets.map(nameOf),
        attention,
        allChecks: checks.map((c) => ({ id: c.id, title: c.title, outcome: OUTCOME_LABEL[c.outcome] })),
        steps: { settings: [...settingGroups.values()], settingsCount: settings.length, adds, updates, removals },
        changeCount: changes.length,
        targetCount: targets.length,
        canApply: changes.length > 0 && verdict.kind !== "fix",
        removalNames: removalChanges.map((c) => `${c.schedule.principal.displayName} (${nameOf(c.target)})`),
        countPerSetting,
    };
}

/** "Global Administrator", "Helpdesk Tier 1 · Member" */
export function targetName(target: Target, roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): string {
    if (target.kind === "role") return roles.find((r) => r.definition.id === target.id)?.definition.displayName ?? target.id;
    const name = groups.find((g) => g.group.id === target.id)?.group.displayName ?? target.id;
    return `${name} · ${target.access === "owner" ? "Owner" : "Member"}`;
}

/** The new assignments the dry run sends (spec 12.4, T3): every add of the basket by its change id */
export function dryRunItems(basket: Basket): { id: string; change: BasketAdd }[] {
    return basket.changes.filter((c): c is BasketAdd => c.kind === "add").map((c) => ({ id: changeId(c), change: c }));
}

export type { Change };

/** What the review page gets from its container (the app page or the fixture route, NG-68) */
export interface ReviewData {
    /** The review as data; null while the checks run (the access check is read again and the dry run sends) */
    view: ReviewView | null;
    /** Leave out: removes these changes from the basket; the review updates */
    onLeaveOut: (changeIds: string[]) => void;
    /** "Back to changes" */
    onBack: () => void;
    /** "Apply {n} changes": starts the apply (NG-69) */
    onApply: () => void;
    /** Why Apply cannot start now; null when it can */
    applyBlockedReason: string | null;
    /** While the apply runs the review content is replaced by the progress list (spec 13.2); null otherwise */
    progress?: { rows: ResultRow[]; tenantName: string; isStopping: boolean; onStop: () => void } | null;
    /** The action of an attention item: grant the write permission, check Conditional Access, remove in this apply */
    onFix: (fix: PreflightFix) => void;
    /** Why the review is empty (an undo with nothing to undo); null for "Every change was left out." */
    emptyReason?: string | null;
    /** The fixture: the removal confirmation open from the start */
    startConfirming?: boolean;
}

