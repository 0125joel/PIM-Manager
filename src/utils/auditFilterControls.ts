import { AUDIT_LEVEL_CHOICES, AUDIT_WHO_CHOICES, type AuditEnvChoice, type AuditLevelChoice, type AuditUrlState, type AuditWhoChoice } from "@/utils/auditUrlState";
import type { FilterControlBase } from "@/utils/filterControls";
import { holderOptions } from "@/utils/holderKinds";

/** The controls of the Audit Filters panel as data (Assignments, Role, Result), as the Report's: one control writes one key of the URL state. Pure. */
export type AuditFilterKey = "who" | "env" | "level" | "privileged" | "failed";
export type AuditFilterGroup = "Assignments" | "Role" | "Result";
export type AuditFilterControl = FilterControlBase<AuditFilterKey, AuditFilterGroup>;
export type AuditFilterValues = Pick<AuditUrlState, AuditFilterKey>;

const NEUTRAL: Record<AuditFilterKey, string> = { who: "all", env: "both", level: "all", privileged: "all", failed: "all" };
const ENV_VALUES: readonly string[] = ["both", "role", "group"];
const LEVEL_LABELS: Record<AuditLevelChoice, string> = { managementGroup: "Management group", subscription: "Subscription", resourceGroup: "Resource group", resource: "Resource" };

/** In No activation Result is left out: it reads activations, not results. The count of failed or denied events stands in its option */
export function getAuditFilterControls(isIdle: boolean, failedCount: number, hasEnvironment = true, hasScopeLevel = false): AuditFilterControl[] {
    const all: AuditFilterControl[] = [
        { key: "who", label: "Who", group: "Assignments", neutral: NEUTRAL.who, options: [{ value: "all", label: "All" }, ...holderOptions(AUDIT_WHO_CHOICES)] },
        { key: "env", label: "Environment", group: "Role", neutral: NEUTRAL.env, options: [{ value: "both", label: "All" }, { value: "role", label: "Entra roles" }, { value: "group", label: "PIM for Groups" }] },
        { key: "level", label: "Scope level", group: "Role", neutral: NEUTRAL.level, options: [{ value: "all", label: "All" }, ...AUDIT_LEVEL_CHOICES.map((level) => ({ value: level, label: LEVEL_LABELS[level] }))] },
        { key: "privileged", label: "Roles", group: "Role", neutral: NEUTRAL.privileged, options: [{ value: "all", label: "All roles" }, { value: "privileged", label: "Privileged only" }] },
    ];
    // Azure has no Environment (Entra roles and PIM for Groups are not its pages) and takes Scope level in its place; Entra never gets Scope level
    const controls = all.filter((control) => (control.key === "env" ? hasEnvironment : control.key === "level" ? hasScopeLevel : true));
    if (!isIdle) controls.push({ key: "failed", label: "Result", group: "Result", neutral: NEUTRAL.failed, options: [{ value: "all", label: "All results" }, { value: "failed", label: `Failed or denied (${failedCount})` }] });
    return controls;
}

export function readAuditFilter(key: AuditFilterKey, values: AuditFilterValues): string {
    switch (key) {
        case "who": return values.who ?? NEUTRAL.who;
        case "env": return values.env;
        case "level": return values.level ?? NEUTRAL.level;
        case "privileged": return values.privileged ? "privileged" : NEUTRAL.privileged;
        case "failed": return values.failed ? "failed" : NEUTRAL.failed;
    }
}

/** The URL state after a choice; a value that is not a choice leaves it as it was */
export function writeAuditFilter<S extends AuditFilterValues>(state: S, key: AuditFilterKey, value: string): S {
    switch (key) {
        case "who":
            if (value === NEUTRAL.who) return { ...state, who: undefined };
            return AUDIT_WHO_CHOICES.includes(value as AuditWhoChoice) ? { ...state, who: value as AuditWhoChoice } : state;
        case "env":
            return ENV_VALUES.includes(value) ? { ...state, env: value as AuditEnvChoice } : state;
        case "level":
            if (value === NEUTRAL.level) return { ...state, level: undefined };
            return AUDIT_LEVEL_CHOICES.includes(value as AuditLevelChoice) ? { ...state, level: value as AuditLevelChoice } : state;
        case "privileged":
            return { ...state, privileged: value === "privileged" || undefined };
        case "failed":
            return { ...state, failed: value === "failed" };
    }
}

/** What removing a chip does: the key back to neutral */
export function clearAuditFilter<S extends AuditFilterValues>(state: S, key: AuditFilterKey): S {
    return writeAuditFilter(state, key, NEUTRAL[key]);
}
