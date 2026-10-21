/**
 * Types of the NextGen Configure page (spec 10.1): targets, changes and their sources. The basket holds changes only;
 * nothing here is written to a tenant until the review applies it.
 */
import type { SettingField, SettingValue } from "@/utils/policyRules";

export type { SettingField, SettingValue } from "@/utils/policyRules";

export type GroupAccess = "member" | "owner";

export type Target =
    | { kind: "role"; id: string }
    | { kind: "group"; id: string; access: GroupAccess };

export type AssignmentType = "eligible" | "active";

export type ChangeSourceKind = "edit" | "guided" | "import" | "model" | "copy" | "undo";

export interface ChangeSource {
    from: ChangeSourceKind;
    /** Line number in an imported file */
    line?: number;
    file?: string;
}

export interface PrincipalRef {
    id: string;
    kind: "user" | "group" | "servicePrincipal";
    displayName: string;
    userPrincipalName?: string;
}

/**
 * Identifies an assignment by principal, target, scope and type, never by schedule id: an `adminUpdate` replaces the
 * schedule and its id (tenant test T8).
 */
export interface ScheduleRef {
    principal: PrincipalRef;
    type: AssignmentType;
    /** `directoryScopeId` for roles ("/" tenant-wide), "/" for groups */
    scope: string;
    /** The end as read, ISO date time, or null for no end */
    end: string | null;
    start?: string | null;
}

export type UpdateAction = "adminUpdate" | "adminExtend" | "adminRenew";

export interface BasketSetting {
    kind: "setting";
    target: Target;
    field: SettingField;
    /** The value read from the tenant, so the basket shows the real before */
    from: SettingValue;
    to: SettingValue;
    source: ChangeSource;
}

export interface BasketAdd {
    kind: "add";
    target: Target;
    principal: PrincipalRef;
    type: AssignmentType;
    scope: string;
    /** The scope as the admin chose it ("Administrative unit: Sales"), for the review (C2-05); absent for tenant-wide */
    scopeName?: string;
    /** ISO date time, or null for "when applied" */
    start: string | null;
    /** ISO date time, or null for no end */
    end: string | null;
    justification: string;
    source: ChangeSource;
}

export interface BasketUpdate {
    kind: "update";
    target: Target;
    schedule: ScheduleRef;
    end: string | null;
    action: UpdateAction;
    justification?: string;
    source: ChangeSource;
}

export interface BasketRemove {
    kind: "remove";
    target: Target;
    schedule: ScheduleRef;
    source: ChangeSource;
}

export type Change = BasketSetting | BasketAdd | BasketUpdate | BasketRemove;

/** The four tabs of a target in Edit (spec 5.4) */
export type ConfigureTab = "activation" | "assignment" | "notification" | "who";
