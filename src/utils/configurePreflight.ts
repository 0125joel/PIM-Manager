/**
 * The pre-flight of the Configure review (spec 12.4, NG-57): every check of the table as data, pure. The review shows
 * the outcome per check; nothing here reads Graph. The dry run of new assignments (`services/assignmentDryRunService.ts`)
 * and the optional Conditional Access read (`hooks/useConditionalAccess.ts`) come in as input, so does the access check
 * of NG-56 (`deriveWriteAccess`).
 *
 * Outcomes: `block` (fix first), `warn` (check this), `pass` (with `info` it is shown in blue but needs nothing),
 * `prevented` (the editors do not let it happen), `notChecked` (the input to decide is missing; never shown as passed).
 */
import type { ConditionalAccessPolicyLike } from "@/utils/accessModelCatalog";
import type { AssignmentType, BasketAdd, BasketRemove, BasketSetting, BasketUpdate, PrincipalRef, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId, targetKey, type Basket } from "@/utils/configureBasket";
import { describeActivationDuration } from "@/utils/configureTargets";
import { addIsoDurationToDate, isZeroDuration } from "@/utils/durationUtils";
import { detectActivationChanges } from "@/utils/policyConflicts";
import { applySettingChanges } from "@/utils/policyRules";
import type { UndoWarning } from "@/utils/configureHistory";
import { ROLE_TEMPLATES, type WriteAccess } from "@/utils/writeAccess";

export type PreflightOutcome = "pass" | "warn" | "block" | "prevented" | "notChecked";

export type PreflightCheckId =
    | "access"
    | "appPermission"
    | "groupApprovers"
    | "roleApprovers"
    | "mfaAndContext"
    | "existingAssignments"
    | "activationChanges"
    | "permanentPrivileged"
    | "activationEnd"
    | "contextPolicies"
    | "ownAccess"
    | "emergencyAccess"
    | "lastOwner"
    | "onlyActiveOwner"
    | "comesUnderPim"
    | "dryRun"
    | "duplicates"
    | "groupPrincipal"
    | "scheduled"
    | "recentRemoval"
    | "removalViaGroup"
    | "endBeyondMax"
    | "customExtension"
    | "undoChangedMeanwhile"
    | "undoTooRecent"
    | "undoNotRead"
    | "undoLimits";

export type PreflightFix =
    | { kind: "grantPermission"; workloads: ("directoryRoles" | "pimGroups")[] }
    | { kind: "removeInThisApply"; removals: BasketRemove[] }
    | { kind: "checkConditionalAccess" };

/** One line under a check: what it found for one target or assignment */
export interface PreflightItem {
    target: Target;
    text: string;
    /** The basket change the line is about, when there is one */
    changeId?: string;
}

export interface PreflightCheck {
    id: PreflightCheckId;
    outcome: PreflightOutcome;
    /** Shown in blue in the attention list (a pass that is worth knowing) */
    info?: boolean;
    title: string;
    text: string;
    targets: Target[];
    items: PreflightItem[];
    fix?: PreflightFix;
}

export interface PreflightAssignment {
    principal: PrincipalRef;
    type: AssignmentType;
    /** `directoryScopeId` for roles, "/" for groups */
    scope: string;
    start: string | null;
    end: string | null;
    /** Held through a group (an activation through a group), not a direct assignment */
    viaGroup?: boolean;
}

/** One target as read from the tenant */
export interface PreflightTargetState {
    target: Target;
    name: string;
    isPrivileged?: boolean;
    isBuiltIn?: boolean;
    /** The settings as read; null when they could not be read */
    settings: PolicySettings | null;
    /** `Expiration_EndUser_Assignment.isExpirationRequired`; undefined when not known */
    activationEndRequired?: boolean;
    /** The assignments of this target (for a group: of this access) */
    assignments: readonly PreflightAssignment[];
    /** Groups only: false for a group outside PIM */
    isUnderPim?: boolean;
    /** Groups only: role-assignable (decides the area of the access check for a group it does not list) */
    isAssignableToRole?: boolean;
}

export type ContextPolicyState = "enabled" | "reportOnly" | "off" | "none";

/** Per context (spec 12.5): its state, and what its enabled policies require */
export interface ContextPolicySummary {
    state: ContextPolicyState;
    /** Authentication strength ids of the enabled policies */
    authenticationStrengthIds: string[];
    signInFrequencyEveryTime: boolean;
    compliantDevice: boolean;
}

export type ConditionalAccessInput =
    | { status: "ready"; contexts: Readonly<Record<string, ContextPolicySummary>> }
    | { status: "notChecked"; reason: string };

export type DryRunOutcome = { ok: true } | { ok: false; message: string; remediation?: string; transient: boolean };

export interface PreflightInput {
    basket: Basket;
    /** By `targetKey` */
    targets: Readonly<Record<string, PreflightTargetState>>;
    me: { userId: string | null; access: WriteAccess | null };
    /** Emergency access accounts by user id, with their names */
    emergencyAccounts: ReadonlyMap<string, string>;
    /**
     * The holders of Privileged Role Administrator and Global Administrator, who approve a role without approvers:
     * how many hold one active, and the emergency access accounts among the holders. null when not known.
     */
    approverRoles: { activeHolders: number; emergencyNames: string[] } | null;
    conditionalAccess: ConditionalAccessInput;
    /** Context id to display name */
    contextNames: Readonly<Record<string, string>>;
    /** The custom extensions of the tenant by id; null when the list cannot be read */
    customExtensionIds: ReadonlySet<string> | null;
    /** The dry run per change id of a new assignment; null when it has not run yet */
    dryRun: Readonly<Record<string, DryRunOutcome>> | null;
    now: Date;
    /** The warnings of "Undo this apply" when the basket undoes an apply (spec 14.3); absent otherwise */
    undoWarnings?: readonly UndoWarning[] | null;
}

/** The roles that may read Conditional Access (spec 12.5, T7: Privileged Role Administrator alone answers 403) */
export const CONDITIONAL_ACCESS_ROLES = "Security Reader, Global Reader, Security Administrator, Conditional Access Administrator, Global Administrator, Devices Admin or Entra Network Access Administrator";

const FIVE_MINUTES = 5 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

const lower = (v: string) => v.toLowerCase();
const isGroupOwner = (t: Target) => t.kind === "group" && t.access === "owner";
const sameTargetKey = (a: Target, b: Target) => targetKey(a) === targetKey(b);


function uniqueTargets(list: readonly Target[]): Target[] {
    const seen = new Map<string, Target>();
    for (const t of list) seen.set(targetKey(t), t);
    return [...seen.values()];
}

function fmtTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

function names(list: readonly string[]): string {
    if (list.length <= 1) return list.join("");
    return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function sameAssignment(a: { principal: PrincipalRef; type: AssignmentType; scope: string }, b: { principal: PrincipalRef; type: AssignmentType; scope: string }): boolean {
    return lower(a.principal.id) === lower(b.principal.id) && a.type === b.type && (a.scope || "/") === (b.scope || "/");
}

function check(id: PreflightCheckId, title: string, partial: Partial<Omit<PreflightCheck, "id" | "title">> & { outcome: PreflightOutcome; text: string }): PreflightCheck {
    const items = partial.items ?? [];
    return { id, title, targets: partial.targets ?? uniqueTargets(items.map((i) => i.target)), items, ...partial };
}

/** Per context: enabled when one policy that targets it is on, else report-only, off or none, with what the enabled ones require (spec 12.5) */
export function summarizeContextPolicies(policies: readonly ConditionalAccessPolicyLike[], contextIds: readonly string[]): Record<string, ContextPolicySummary> {
    const result: Record<string, ContextPolicySummary> = {};
    for (const contextId of contextIds) {
        const targeting = policies.filter((p) => (p.conditions?.applications?.includeAuthenticationContextClassReferences ?? []).includes(contextId));
        const states = targeting.map((p) => lower(p.state ?? ""));
        const enabled = targeting.filter((p) => lower(p.state ?? "") === "enabled");
        result[contextId] = {
            state: states.includes("enabled") ? "enabled" : states.includes("enabledforreportingbutnotenforced") ? "reportOnly" : states.length > 0 ? "off" : "none",
            authenticationStrengthIds: [...new Set(enabled.map((p) => p.grantControls?.authenticationStrength?.id).filter((id): id is string => !!id))],
            signInFrequencyEveryTime: enabled.some((p) => p.sessionControls?.signInFrequency?.isEnabled === true && lower(p.sessionControls.signInFrequency.frequencyInterval ?? "") === "everytime"),
            compliantDevice: enabled.some((p) => (p.grantControls?.builtInControls ?? []).some((c) => lower(c) === "compliantdevice")),
        };
    }
    return result;
}

/**
 * The input of the context check from the state of `useConditionalAccess` (spec 12.5): only a completed read is
 * "ready"; no permission, no fitting role (403), a read that failed or is still running are "Not checked", never passed.
 */
export function conditionalAccessInput(
    status: "idle" | "checking" | "ready" | "notGranted" | "forbidden" | "failed",
    policies: readonly ConditionalAccessPolicyLike[] | null,
    contextIds: readonly string[],
): ConditionalAccessInput {
    if (status === "ready" && policies) return { status: "ready", contexts: summarizeContextPolicies(policies, contextIds) };
    const reason = status === "forbidden" ? `needs ${CONDITIONAL_ACCESS_ROLES}, active.`
        : status === "failed" ? "Conditional Access could not be read."
            : status === "checking" ? "Conditional Access is being read."
                : "needs permission to read Conditional Access (Policy.Read.All). Choose Check Conditional Access.";
    return { status: "notChecked", reason };
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks

export function buildPreflight(input: PreflightInput): PreflightCheck[] {
    const { basket, targets, now } = input;
    const changes = basket.changes;
    const settings = changes.filter((c): c is BasketSetting => c.kind === "setting");
    const adds = changes.filter((c): c is BasketAdd => c.kind === "add");
    const updates = changes.filter((c): c is BasketUpdate => c.kind === "update");
    const removals = changes.filter((c): c is BasketRemove => c.kind === "remove");
    const touched = uniqueTargets(changes.map((c) => c.target));
    const stateOf = (t: Target) => targets[targetKey(t)];
    const nameOf = (t: Target) => {
        const name = stateOf(t)?.name ?? t.id;
        return t.kind === "group" ? `${name} (${t.access === "owner" ? "Owner" : "Member"})` : name;
    };
    const settingsFor = (t: Target) => settings.filter((c) => sameTargetKey(c.target, t));
    const effective = (t: Target): PolicySettings | null => {
        const current = stateOf(t)?.settings;
        return current ? applySettingChanges(current, settingsFor(t).map((c) => ({ field: c.field, to: c.to }))) : null;
    };
    const isRemoved = (t: Target, a: PreflightAssignment) => removals.some((r) => sameTargetKey(r.target, t) && sameAssignment(r.schedule, a));

    const checks: PreflightCheck[] = [];

    // 1. Your access is still open for every target (3.3)
    {
        const access = input.me.access;
        if (!access) {
            checks.push(check("access", "Your access", { outcome: touched.length ? "block" : "pass", targets: touched, text: touched.length ? "Your roles could not be checked. Refresh to read them again." : "Nothing to change." }));
        } else {
            const closed = touched.filter((t) => {
                if (t.kind === "role") return access.roles.state !== "open";
                const decision = access.groups[t.id];
                if (decision) return decision.state !== "open";
                // A group the check does not list: open only when a role opens its whole area
                const area = stateOf(t)?.isAssignableToRole ? access.roleAssignableGroups : access.otherGroups;
                return !(area.state === "open" && area.reach === "all");
            });
            checks.push(check("access", "Your access", closed.length
                ? { outcome: "block", items: closed.map((t) => ({ target: t, text: `You can no longer change ${nameOf(t)}.` })), text: "Your access changed. Activate a fitting role, or leave these targets out." }
                : { outcome: "pass", targets: touched, text: "Your active roles and ownerships allow every change." }));
        }
    }

    // 2. App permission granted for every workload in the basket
    {
        const needed = new Set<"directoryRoles" | "pimGroups">(touched.map((t) => (t.kind === "role" ? "directoryRoles" : "pimGroups")));
        const missing = input.me.access ? [...needed].filter((w) => input.me.access!.appPermission[w] !== "granted") : [];
        checks.push(check("appPermission", "App permission", !input.me.access && needed.size > 0
            ? { outcome: "notChecked", targets: touched, text: "The app permission could not be checked. Refresh to check it again." }
            : missing.length
            ? { outcome: "block", targets: touched.filter((t) => missing.includes(t.kind === "role" ? "directoryRoles" : "pimGroups")), text: "Give PIM Manager permission to write first.", fix: { kind: "grantPermission", workloads: missing } }
            : { outcome: "pass", text: "PIM Manager may write to every workload of this apply." }));
    }

    // 3. Approval on a group without approvers (bug 6, Learn): prevented while editing; block from Import
    {
        const hits = touched.filter((t) => t.kind === "group" && settingsFor(t).length > 0).filter((t) => {
            const s = effective(t);
            return !!s && s.requireApproval && (s.approvers ?? []).length === 0;
        });
        const fromImport = hits.filter((t) => settingsFor(t).some((c) => c.source.from === "import"));
        checks.push(check("groupApprovers", "Approval on a group without approvers", fromImport.length
            ? { outcome: "block", items: fromImport.map((t) => ({ target: t, text: `${nameOf(t)} requires approval but names no approver. Microsoft refuses it for groups.` })), text: "Name at least one approver, or switch approval off." }
            : { outcome: "prevented", targets: hits, text: "A group that requires approval needs an approver; the editor asks for one." }));
    }

    // 4. Approval on a role without approvers (Learn L3)
    {
        const hits = touched.filter((t) => t.kind === "role" && settingsFor(t).length > 0).filter((t) => {
            const s = effective(t);
            return !!s && s.requireApproval && (s.approvers ?? []).length === 0;
        });
        if (hits.length === 0) {
            checks.push(check("roleApprovers", "Approval on a role without approvers", { outcome: "pass", text: "Every role that requires approval names its approvers." }));
        } else if (input.approverRoles && input.approverRoles.activeHolders === 0) {
            const emergency = input.approverRoles.emergencyNames;
            checks.push(check("roleApprovers", "Approval on a role without approvers", {
                outcome: "warn",
                items: hits.map((t) => ({ target: t, text: `Privileged Role Administrators and Global Administrators approve ${nameOf(t)}.` })),
                text: `Every Privileged Role Administrator and Global Administrator is only eligible, so nobody approves until one of them activates.${emergency.length ? ` The emergency access accounts ${names(emergency)} hold one of these roles.` : ""}`,
            }));
        } else {
            checks.push(check("roleApprovers", "Approval on a role without approvers", {
                outcome: "pass",
                info: true,
                items: hits.map((t) => ({ target: t, text: `Privileged Role Administrators and Global Administrators approve ${nameOf(t)}.` })),
                text: "Without named approvers, Privileged Role Administrators and Global Administrators approve.",
            }));
        }
    }

    // 5. MFA and a context at once: the requirement is one choice
    checks.push(check("mfaAndContext", "MFA and an authentication context at once", { outcome: "prevented", text: "On activation, require is one choice: nothing, MFA, or an authentication context." }));

    // 6. Existing assignments that break the new rules (detectPolicyConflicts)
    {
        const items: PreflightItem[] = [];
        const blocks: PreflightItem[] = [];
        const fixes: BasketRemove[] = [];
        const ruleFields = new Set(["allowPermanentEligible", "eligibleExpiration", "allowPermanentActive", "activeExpiration"]);
        for (const t of touched) {
            const changes = settingsFor(t);
            if (!changes.some((c) => ruleFields.has(c.field))) continue;
            const s = effective(t);
            const state = stateOf(t);
            if (!s || !state) continue;
            // W-01: permanent going off needs a maximum. Where the tenant stores none (PT0S) and the basket sets none,
            // the write would have to pick one the admin never saw, so the review blocks and asks for it instead
            for (const [permanent, expiration, label] of [["allowPermanentEligible", "eligibleExpiration", "Eligible assignments end after"], ["allowPermanentActive", "activeExpiration", "Active assignments end after"]] as const) {
                const off = changes.some((c) => c.field === permanent && c.to === false);
                if (off && !changes.some((c) => c.field === expiration) && isBlankMaximum(s[expiration])) {
                    blocks.push({ target: t, text: `${nameOf(t)}: permanent ${permanent === "allowPermanentEligible" ? "eligible" : "active"} assignments go off, but no maximum is set. Choose "${label}" as well.` });
                }
            }
            for (const read of state.assignments) {
                if (read.viaGroup || isRemoved(t, read)) continue;
                // An end changed in the same apply counts as the end
                const update = updates.find((u) => sameTargetKey(u.target, t) && sameAssignment(u.schedule, read));
                const a = update ? { ...read, end: update.end } : read;
                const allowPermanent = a.type === "eligible" ? s.allowPermanentEligible : s.allowPermanentActive;
                if (allowPermanent) continue;
                const max = a.type === "eligible" ? s.eligibleExpiration : s.activeExpiration;
                const latest = max && !isBlankMaximum(max) ? addIsoDurationToDate(now, max) : null;
                const who = a.principal.displayName;
                let text: string | null = null;
                if (!a.end) text = `${who} has a permanent ${a.type} assignment of ${nameOf(t)}; permanent is no longer allowed.`;
                else if (latest && new Date(a.end) > latest) text = `${who}'s ${a.type} assignment of ${nameOf(t)} ends ${fmtTime(a.end)}, beyond the new maximum.`;
                if (!text) continue;
                const removal: BasketRemove = { kind: "remove", target: t, schedule: { principal: a.principal, type: a.type, scope: a.scope, end: a.end, start: a.start }, source: { from: "edit" } };
                items.push({ target: t, text });
                fixes.push(removal);
            }
        }
        checks.push(check("existingAssignments", "Existing assignments that break the new rules", blocks.length
            ? { outcome: "block", items: [...blocks, ...items], text: "A maximum must be set before permanent assignments can go off.", ...(fixes.length ? { fix: { kind: "removeInThisApply" as const, removals: fixes } } : {}) }
            : items.length
            ? { outcome: "warn", items, text: "Microsoft does not apply new rules to assignments that exist. They keep their terms until they end or you remove them.", fix: { kind: "removeInThisApply", removals: fixes } }
            : { outcome: "pass", text: "No existing assignment breaks the new rules." }));
    }

    // 7. What changes for people who activate (detectActivationChanges), one line per change in the words of the review
    {
        const items: PreflightItem[] = [];
        for (const t of touched) {
            if (settingsFor(t).length === 0) continue;
            const before = stateOf(t)?.settings;
            const after = effective(t);
            if (!before || !after) continue;
            const eligible = (stateOf(t)?.assignments ?? []).filter((a) => a.type === "eligible" && !a.viaGroup).length;
            const people = `${eligible} eligible ${eligible === 1 ? "person" : "people"}`;
            const lines = detectActivationChanges(before, after).flatMap((c): string[] => {
                // A requirement only changes something for people who can activate
                if (eligible === 0 && c.reason !== "max-duration-shortened") return [];
                switch (c.reason) {
                    case "approval-added": return [`${nameOf(t)}: activations of ${people} wait for an approver from the next activation.`];
                    case "mfa-added": return [`${nameOf(t)}: ${people} must use multifactor authentication at the next activation.`];
                    case "auth-context-changed": return after.authenticationContextId ? [`${nameOf(t)}: ${people} must meet "${input.contextNames[after.authenticationContextId] ?? after.authenticationContextId}" at the next activation.`] : [];
                    case "justification-added": return [`${nameOf(t)}: ${people} must give a justification at the next activation.`];
                    case "ticket-added": return [`${nameOf(t)}: ${people} must give ticket information at the next activation.`];
                    case "max-duration-shortened": return [`${nameOf(t)}: activations get shorter, ${describeActivationDuration(before.maxActivationDuration) ?? before.maxActivationDuration} becomes ${describeActivationDuration(after.maxActivationDuration) ?? after.maxActivationDuration}. Running activations keep their end time.`];
                    default: return [];
                }
            });
            for (const text of lines) items.push({ target: t, text });
        }
        checks.push(check("activationChanges", "What changes for people who activate", items.length
            ? { outcome: "pass", info: true, items, text: "They notice it at their next activation; nothing changes for running activations." }
            : { outcome: "pass", text: "Activation stays as it is for everyone." }));
    }

    // 8. Permanent allowed on a built-in privileged role
    {
        const hits = touched.filter((t) => t.kind === "role" && stateOf(t)?.isPrivileged && stateOf(t)?.isBuiltIn !== false)
            .filter((t) => settingsFor(t).some((c) => (c.field === "allowPermanentEligible" || c.field === "allowPermanentActive") && c.to === true && c.from !== true));
        checks.push(check("permanentPrivileged", "Permanent assignments allowed on a built-in privileged role", hits.length
            ? { outcome: "warn", targets: hits, text: `Microsoft may answer InvalidPolicy for ${hits.map(nameOf).join(", ")}.` }
            : { outcome: "pass", text: "No privileged role is opened to permanent assignments." }));
    }

    // 9. Activation without a required end (T5)
    {
        const hits = touched.filter((t) => stateOf(t)?.activationEndRequired === false);
        checks.push(check("activationEnd", "Activation without a required end", hits.length
            ? { outcome: "warn", items: hits.map((t) => ({ target: t, text: `An activation of ${nameOf(t)} lasts until it is deactivated.` })), text: "These targets do not require an end on activation. PIM Manager does not change this rule; set it in Entra." }
            : { outcome: "pass", text: "Every activation of these targets has an end." }));
    }

    // 10. A context whose policies are all report-only or off, or that has none (T7, Learn L5)
    {
        const used = new Map<string, Target[]>();
        for (const c of settings) {
            if (c.field !== "activationRequirement") continue;
            const to = c.to as { kind: string; contextId?: string };
            if (to.kind !== "authenticationContext" || !to.contextId) continue;
            used.set(to.contextId, [...(used.get(to.contextId) ?? []), c.target]);
        }
        const contextName = (id: string) => input.contextNames[id] ?? id;
        if (used.size === 0) {
            checks.push(check("contextPolicies", "Conditional Access behind the authentication context", { outcome: "pass", text: "No authentication context is set in this apply." }));
        } else if (input.conditionalAccess.status !== "ready") {
            checks.push(check("contextPolicies", "Conditional Access behind the authentication context", {
                outcome: "notChecked",
                targets: uniqueTargets([...used.values()].flat()),
                text: `Not checked: ${input.conditionalAccess.reason}`,
                fix: { kind: "checkConditionalAccess" },
            }));
        } else {
            const states = input.conditionalAccess.contexts;
            const items: PreflightItem[] = [];
            for (const [contextId, list] of used) {
                const state = states[contextId]?.state ?? "none";
                if (state === "enabled") continue;
                const why = state === "reportOnly" ? "every policy for it is report-only" : state === "off" ? "every policy for it is off" : "no Conditional Access policy uses it";
                for (const t of uniqueTargets(list)) items.push({ target: t, text: `${contextName(contextId)} on ${nameOf(t)}: ${why}, so activation asks nothing extra.` });
            }
            checks.push(check("contextPolicies", "Conditional Access behind the authentication context", items.length
                ? { outcome: "warn", items, text: "An authentication context only protects when an enabled Conditional Access policy targets it." }
                : { outcome: "pass", targets: uniqueTargets([...used.values()].flat()), text: "An enabled Conditional Access policy stands behind every context of this apply." }));
        }
    }

    // 11. Removing your own access
    {
        const me = input.me.userId ? lower(input.me.userId) : null;
        const hits = me ? removals.filter((r) => lower(r.schedule.principal.id) === me) : [];
        checks.push(check("ownAccess", "Removing your own access", hits.length
            ? { outcome: "warn", items: hits.map((r) => ({ target: r.target, changeId: changeId(r), text: `You remove your own ${r.schedule.type} assignment of ${nameOf(r.target)}.` })), text: "You may lose the access you need to undo this." }
            : { outcome: "pass", text: "You keep your own assignments." }));
    }

    // 12. An emergency access account loses access
    {
        const items: PreflightItem[] = [];
        for (const r of removals) {
            const name = input.emergencyAccounts.get(lower(r.schedule.principal.id)) ?? input.emergencyAccounts.get(r.schedule.principal.id);
            if (name) items.push({ target: r.target, changeId: changeId(r), text: `${name} loses ${r.schedule.type} ${nameOf(r.target)}.` });
        }
        for (const u of updates) {
            const name = input.emergencyAccounts.get(lower(u.schedule.principal.id)) ?? input.emergencyAccounts.get(u.schedule.principal.id);
            if (name && u.end) items.push({ target: u.target, changeId: changeId(u), text: `${name}'s ${u.schedule.type} ${nameOf(u.target)} gets an end: ${fmtTime(u.end)}.` });
        }
        checks.push(check("emergencyAccess", "Emergency access accounts", items.length
            ? { outcome: "warn", items, text: "Emergency access accounts should keep permanent access." }
            : { outcome: "pass", text: "No emergency access account loses access." }));
    }

    // 13 and 14. Owners of a group (T2b, T2h)
    {
        const lastOwner: PreflightItem[] = [];
        const onlyActive: PreflightItem[] = [];
        for (const t of touched.filter(isGroupOwner)) {
            const state = stateOf(t);
            if (!state) continue;
            const direct = state.assignments.filter((a) => !a.viaGroup);
            const after = [
                ...direct.filter((a) => !isRemoved(t, a)).map((a) => {
                    const update = updates.find((u) => sameTargetKey(u.target, t) && sameAssignment(u.schedule, a));
                    return { ...a, end: update ? update.end : a.end };
                }),
                ...adds.filter((a) => sameTargetKey(a.target, t)).map((a) => ({ principal: a.principal, type: a.type, scope: a.scope, start: a.start, end: a.end })),
            ];
            const groupName = state.name;
            const activeAfter = after.filter((a) => a.type === "active");
            if (direct.length > 0 && after.length === 0) lastOwner.push({ target: t, text: `${groupName} would have no owner left, eligible or active.` });
            else if (direct.some((a) => a.type === "active") && activeAfter.length === 0) lastOwner.push({ target: t, text: `${groupName} would have no active owner left. Microsoft does not remove the last active owner.` });
            else if (activeAfter.length === 1 && after.length > 1) {
                // A change of end replaces the schedule, so Microsoft treats it as removing the only active owner
                // (tenant run 2026-10-09: CannotDeleteLastAdminAssignment while the other owner was eligible)
                const only = activeAfter[0];
                const changed = updates.find((u) => sameTargetKey(u.target, t) && u.action === "adminUpdate" && sameAssignment(u.schedule, only));
                if (changed) lastOwner.push({ target: t, text: `${only.principal.displayName} is the only active owner of ${groupName}: Microsoft refuses a change of its end while the other owners are eligible. Add another active owner first.` });
            }
            if (activeAfter.length === 1 && activeAfter[0].end) {
                const owner = activeAfter[0].principal.displayName;
                onlyActive.push({ target: t, text: `When ${owner}'s ownership ends, Microsoft keeps it until ${groupName} has another active owner, and after 30 days for good. Add a permanent owner.` });
            }
        }
        // The last active Global Administrator assignment cannot be removed either (Learn, pim-how-to-add-role-to-user; M-26)
        for (const t of touched.filter((x) => x.kind === "role" && x.id === ROLE_TEMPLATES.globalAdministrator)) {
            const active = (stateOf(t)?.assignments ?? []).filter((a) => !a.viaGroup && a.type === "active");
            const kept = active.filter((a) => !isRemoved(t, a));
            if (active.length > 0 && kept.length === 0) lastOwner.push({ target: t, text: "Global Administrator would have no active assignment left. Microsoft does not remove the last one." });
        }
        checks.push(check("lastOwner", "The last owner of a group", lastOwner.length
            ? { outcome: "block", items: lastOwner, text: "Microsoft does not remove the last owner of a group, nor the last active Global Administrator. Add another one first." }
            : { outcome: "pass", text: "Every group keeps an owner." }));
        checks.push(check("onlyActiveOwner", "The only active owner of a group has an end", onlyActive.length
            ? { outcome: "warn", items: onlyActive, text: "A group whose only active owner has an end keeps that owner after the end." }
            : { outcome: "pass", text: "No group depends on one active owner with an end." }));
    }

    // 15. A group comes under PIM (T6)
    {
        // One line per group, whichever of Member and Owner the basket touches
        const groups = new Map<string, Target>();
        for (const t of touched) if (t.kind === "group" && stateOf(t)?.isUnderPim === false && !groups.has(t.id)) groups.set(t.id, t);
        checks.push(check("comesUnderPim", "Groups that come under PIM", groups.size
            ? { outcome: "pass", info: true, items: [...groups.values()].map((t) => ({ target: t, text: `${stateOf(t)?.name ?? t.id} comes under PIM. Its Member and Owner settings stay as they are now.` })), text: "These groups come under PIM with this apply." }
            : { outcome: "pass", text: "No group comes under PIM in this apply." }));
    }

    // 16 and 17. New assignments: duplicates are skipped, the rest is checked by Microsoft (T3)
    {
        const duplicates = adds.filter((a) => (stateOf(a.target)?.assignments ?? []).some((e) => !e.viaGroup && sameAssignment(e, a)));
        const toCheck = adds.filter((a) => !duplicates.includes(a));
        const rejected: PreflightItem[] = [];
        const unchecked: PreflightItem[] = [];
        for (const a of toCheck) {
            const id = changeId(a);
            const result = input.dryRun?.[id];
            const label = `${a.principal.displayName}, ${a.type} ${nameOf(a.target)}`;
            if (!result) unchecked.push({ target: a.target, changeId: id, text: `${label}: not checked yet.` });
            else if (!result.ok && result.transient) unchecked.push({ target: a.target, changeId: id, text: `${label}: Microsoft could not be asked (${result.message}).` });
            else if (!result.ok) rejected.push({ target: a.target, changeId: id, text: `${label}: ${result.message}${result.remediation ? ` ${result.remediation}` : ""}` });
        }
        checks.push(check("dryRun", "New assignments, checked by Microsoft", rejected.length
            ? { outcome: "block", items: [...rejected, ...unchecked], text: "Microsoft would refuse these assignments. Change or leave them out." }
            : unchecked.length
                ? { outcome: "notChecked", items: unchecked, text: "Microsoft checks each new assignment before you apply." }
                : { outcome: "pass", targets: uniqueTargets(toCheck.map((a) => a.target)), text: toCheck.length ? "Microsoft accepts every new assignment." : "No new assignments." }));
        checks.push(check("duplicates", "Assignments already there", duplicates.length
            ? { outcome: "pass", info: true, items: duplicates.map((a) => ({ target: a.target, changeId: changeId(a), text: `${a.principal.displayName} already has ${a.type} ${nameOf(a.target)}.` })), text: "Duplicates are skipped." }
            : { outcome: "pass", text: "No new assignment is there already." }));
    }

    // 18. A group as role principal that is not role-assignable: the picker offers only role-assignable groups
    checks.push(check("groupPrincipal", "Groups as role principal", { outcome: "prevented", text: "Only role-assignable groups can be picked for a role." }));

    // 19. A pending or scheduled request on the same assignment (T8, PendingRoleAssignmentRequest)
    {
        const items: PreflightItem[] = [];
        let blocks = false;
        for (const a of adds) {
            if (a.start && new Date(a.start) > now) items.push({ target: a.target, changeId: changeId(a), text: `${a.principal.displayName}, ${a.type} ${nameOf(a.target)}: waits for the scheduled start at ${fmtTime(a.start)}.` });
        }
        for (const c of [...updates, ...removals]) {
            const start = c.schedule.start;
            if (start && new Date(start) > now) {
                blocks = true;
                items.push({ target: c.target, changeId: changeId(c), text: `${c.schedule.principal.displayName}, ${c.schedule.type} ${nameOf(c.target)}, starts ${fmtTime(start)}. Microsoft refuses a change before the scheduled start.` });
            }
        }
        checks.push(check("scheduled", "Scheduled assignments", items.length
            ? { outcome: blocks ? "block" : "warn", items, text: blocks ? "Leave out the changes of scheduled assignments, or apply them after the start." : "These assignments start later." }
            : { outcome: "pass", text: "No change waits for a scheduled start." }));
    }

    // 20. A removal of an assignment made less than five minutes ago (L7)
    {
        const items: PreflightItem[] = [];
        for (const r of removals) {
            const start = r.schedule.start;
            if (!start) continue;
            const from = new Date(start).getTime() + FIVE_MINUTES;
            if (from > now.getTime() && new Date(start).getTime() <= now.getTime()) {
                items.push({ target: r.target, changeId: changeId(r), text: `${r.schedule.principal.displayName}, ${r.schedule.type} ${nameOf(r.target)}: can be removed from ${fmtTime(new Date(from).toISOString())}.` });
            }
        }
        checks.push(check("recentRemoval", "Assignments made less than five minutes ago", items.length
            ? { outcome: "warn", items, text: "Microsoft removes an assignment only five minutes after it started." }
            : { outcome: "pass", text: "Every removal is of an assignment older than five minutes." }));
    }

    // 21 and 22. Prevented by the editors
    checks.push(check("removalViaGroup", "Removals through a group", { outcome: "prevented", text: "Access through a group is removed at the group; the editor links to it." }));
    checks.push(check("endBeyondMax", "Ends beyond the maximum", { outcome: "prevented", text: "The date fields stop at the maximum of the settings." }));

    // 23. A custom extension that no longer exists
    {
        const items: PreflightItem[] = [];
        if (input.customExtensionIds) {
            for (const t of touched) {
                const s = effective(t);
                for (const slot of ["preApproval", "postApproval"] as const) {
                    const link = s?.customExtensions?.[slot];
                    const id = link && "customExtensionId" in link ? (link as { customExtensionId?: string }).customExtensionId : undefined;
                    if (id && !input.customExtensionIds.has(id)) items.push({ target: t, text: `${nameOf(t)} links a custom extension that no longer exists (${slot === "preApproval" ? "before approval" : "after approval"}).` });
                }
            }
        }
        checks.push(check("customExtension", "Custom extensions", items.length
            ? { outcome: "warn", items, text: "Activation calls an extension that is gone. Unlink it or pick another." }
            : input.customExtensionIds
                ? { outcome: "pass", text: "Every linked custom extension exists." }
                : { outcome: "pass", text: "Picking a missing extension is prevented; the linked ones cannot be listed without the permission." }));
    }

    // Undo of an apply (spec 14.3): what changed meanwhile, what cannot be removed yet, the last owner, and the limits
    if (input.undoWarnings) {
        const inBasket = new Set(basket.changes.map(changeId));
        const live = input.undoWarnings.filter((w) => !w.changeId || inBasket.has(w.changeId));
        const of = (kind: UndoWarning["kind"]) => live.filter((w) => w.kind === kind);
        const changed = of("changedMeanwhile");
        checks.push(check("undoChangedMeanwhile", "Changed by someone else after this apply", changed.length
            ? { outcome: "warn", items: changed.map((w) => ({ target: w.target, changeId: w.changeId, text: `${nameOf(w.target)} was changed by someone else after this apply; undo would overwrite it.` })), text: "A policy rule has no version: the comparison before writing is the only guard." }
            : { outcome: "pass", text: "Nothing this apply wrote was changed since." }));
        const recent = of("tooRecent");
        checks.push(check("undoTooRecent", "Added less than five minutes ago", recent.length
            ? { outcome: "warn", items: recent.map((w) => ({ target: w.target, changeId: w.changeId, text: w.from ? w.text.replace(w.from, fmtTime(w.from)) : w.text })), text: "Microsoft refuses to remove an assignment in its first five minutes. Wait, or leave it out." }
            : { outcome: "pass", text: "Every assignment this apply added can be removed now." }));
        // The last owner is the live check "lastOwner" on the data read again; the planner's copy would go stale
        const notRead = of("notRead");
        checks.push(check("undoNotRead", "Settings not read again", notRead.length
            ? { outcome: "warn", items: notRead.map((w) => ({ target: w.target, text: `${nameOf(w.target)}: ${w.text}` })), text: "These settings are left out of the undo. Refresh, then undo again, or change them in Edit." }
            : { outcome: "pass", text: "Every target was read again before the undo." }));
        const readds = basket.changes.some((c) => c.kind === "add" && c.source.from === "undo");
        checks.push(check("undoLimits", "What undo cannot give back", readds
            ? { outcome: "pass", info: true, text: "A removed assignment comes back with a new start; its end stays as it was.", items: [] }
            : { outcome: "pass", text: "Every change goes back to the value read before the apply." }));
    }

    return checks;
}

/** The verdict of the review (spec 12.1) */
export function preflightVerdict(checks: readonly PreflightCheck[]): { kind: "ready" | "lookAt" | "fix"; count: number } {
    const blocks = checks.filter((c) => c.outcome === "block").length;
    if (blocks) return { kind: "fix", count: blocks };
    const warns = checks.filter((c) => c.outcome === "warn" || c.outcome === "notChecked").length;
    return warns ? { kind: "lookAt", count: warns } : { kind: "ready", count: 0 };
}

/** PT0S (what Graph stores while permanent is allowed), P0D or nothing: no maximum to measure an end against */
function isBlankMaximum(value: unknown): boolean {
    return typeof value !== "string" || value === "" || isZeroDuration(value);
}
