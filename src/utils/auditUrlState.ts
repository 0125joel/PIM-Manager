import type { HolderKind } from "@/utils/holderKinds";
import type { AuditEnvironment, AuditKind } from "@/types/audit.types";
import type { AzureScopeLevel } from "@/types/azureResource.types";

/**
 * The URL state of the Audit page (implementation spec section 5): `days` (a whole number from 1 to the longest period of the source: 30 without a workspace, the longest retention of the chosen
 * workspaces with one; 30 is the default and is not written), `kinds` (a comma list; the default is every kind but System and is not written), `env`
 * (`role` or `group`; both is the default and is not written), `who` (`user`, `guest`, `app`, `agent` or `group`; all is the default and is not written), `priv` (`1`, Privileged only), `level` (the Azure scope level; all levels is the default and is not written), `failed` (`1`), `q` (the search term), `view` (`idle` for
 * No activation; Events is the default and is not written) and `event` (an event id), and `from` and `to` (ISO times, the selection on the timeline; written only when something is selected).
 * Rubbish in the URL falls back to the default of that parameter and never throws; a `from` or `to` that does not parse, or
 * a `from` that is not before `to`, gives no selection. Whether the selection lies inside the window of the read is the
 * business of `auditTimeline.parseAuditRange`. Parameters that are none of these stay as they are. Pure;
 * `useAuditUrlState` reads and writes it.
 */

/** The longest period without a workspace */
export const AUDIT_MAX_DAYS = 30;
export const AUDIT_DEFAULT_DAYS = 30;
/** What the page opens on with a workspace (the approved design), as far as the workspaces keep their logs */
const AUDIT_WORKSPACE_DEFAULT_DAYS = 180;

/** The period without a `days` parameter: 30 days of the Entra audit log, or 180 with a workspace, never more than the source keeps */
export function auditDefaultDays(maxDays: number = AUDIT_MAX_DAYS): number {
    return maxDays > AUDIT_MAX_DAYS ? Math.min(AUDIT_WORKSPACE_DEFAULT_DAYS, maxDays) : AUDIT_DEFAULT_DAYS;
}

/** Every kind in the order the chips show them */
export const AUDIT_KINDS: readonly AuditKind[] = ["usage", "assignment", "setting", "outside", "system"];
/** What shows without a `kinds` parameter: everything but the system events */
export const AUDIT_DEFAULT_KINDS: readonly AuditKind[] = ["usage", "assignment", "setting", "outside"];

export type AuditEnvChoice = "both" | AuditEnvironment;
/** The view switch: Events is the default and is not written; `idle` is the No activation view */
export type AuditViewChoice = "idle";
/** The level of the scope of an Azure event (`level`); left out is every level. The tenant root has no choice of its own */
export type AuditLevelChoice = Exclude<AzureScopeLevel, "root">;
/** The choices in the order of the scope tree */
export const AUDIT_LEVEL_CHOICES: readonly AuditLevelChoice[] = ["managementGroup", "subscription", "resourceGroup", "resource"];
/** Who gets or holds the role. Left out is all of them, and only then an event without a holder shows */
export type AuditWhoChoice = Extract<HolderKind, "user" | "guest" | "app" | "agent" | "group">;

/** The choices in the order of the Report */
export const AUDIT_WHO_CHOICES: readonly AuditWhoChoice[] = ["user", "guest", "app", "agent", "group"];

export interface AuditUrlState {
    days: number;
    /** In the order of AUDIT_KINDS, without duplicates; never empty */
    kinds: AuditKind[];
    env: AuditEnvChoice;
    failed: boolean;
    q: string;
    event?: string;
    /** The selection on the timeline, ISO times (UTC), both or neither */
    from?: string;
    to?: string;
    /** `idle` for the No activation view; left out for Events. In that view `event`, `from` and `to` are ignored and kept. */
    view?: AuditViewChoice;
    /** Left out for everyone */
    who?: AuditWhoChoice;
    /** Privileged only; left out for all roles */
    privileged?: boolean;
    /** The Azure scope level (`level`); left out for all levels */
    level?: AuditLevelChoice;
}

const OWN_PARAMS = ["days", "kinds", "env", "who", "priv", "failed", "q", "event", "from", "to", "view", "level"] as const;

function isKind(value: string): value is AuditKind {
    return (AUDIT_KINDS as readonly string[]).includes(value);
}

/** The kinds of a list in canonical order and without duplicates */
export function normalizeKinds(kinds: readonly AuditKind[]): AuditKind[] {
    return AUDIT_KINDS.filter((kind) => kinds.includes(kind));
}

function sameKinds(a: readonly AuditKind[], b: readonly AuditKind[]): boolean {
    return a.length === b.length && a.every((kind, index) => kind === b[index]);
}

function parseDays(value: string | null, maxDays: number, defaultDays: number): number {
    if (value === null || !/^\d{1,4}$/.test(value)) return defaultDays;
    const days = Number(value);
    return days >= 1 && days <= Math.max(maxDays, AUDIT_MAX_DAYS) ? days : defaultDays;
}

function parseKinds(value: string | null): AuditKind[] {
    if (value === null) return [...AUDIT_DEFAULT_KINDS];
    const found = value.split(",").map((part) => part.trim()).filter(isKind);
    return found.length > 0 ? normalizeKinds(found) : [...AUDIT_DEFAULT_KINDS];
}

/** The selection of `from` and `to` as canonical ISO times, or none when either is missing, does not parse or they are not in order */
function parseSelection(from: string | null, to: string | null): { from: string; to: string } | undefined {
    if (!from || !to) return undefined;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return undefined;
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

/**
 * `maxDays` is the longest period of the source (30 unless workspaces are chosen); a `days` above it falls back to the default.
 * `defaultDays` names the default itself (the Azure Audit page opens on 30 of its 90); left out it is `auditDefaultDays(maxDays)`.
 */
export function parseAuditUrlState(search: string, maxDays: number = AUDIT_MAX_DAYS, defaultDays: number = auditDefaultDays(maxDays)): AuditUrlState {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const env = params.get("env");
    const state: AuditUrlState = {
        days: parseDays(params.get("days"), maxDays, defaultDays),
        kinds: parseKinds(params.get("kinds")),
        env: env === "role" || env === "group" ? env : "both",
        failed: params.get("failed") === "1",
        q: params.get("q") ?? "",
    };
    const event = params.get("event")?.trim();
    if (event) state.event = event;
    const selection = parseSelection(params.get("from"), params.get("to"));
    if (selection) {
        state.from = selection.from;
        state.to = selection.to;
    }
    if (params.get("view") === "idle") state.view = "idle";
    const who = params.get("who");
    if (AUDIT_WHO_CHOICES.includes(who as AuditWhoChoice)) state.who = who as AuditWhoChoice;
    if (params.get("priv") === "1") state.privileged = true;
    const level = params.get("level");
    if (AUDIT_LEVEL_CHOICES.includes(level as AuditLevelChoice)) state.level = level as AuditLevelChoice;
    return state;
}

/** The query string (without `?`) for a state; `currentSearch` supplies the parameters that are not the page's own. */
export function buildAuditSearch(state: AuditUrlState, currentSearch = "", maxDays: number = AUDIT_MAX_DAYS, defaultDays: number = auditDefaultDays(maxDays)): string {
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
    for (const name of OWN_PARAMS) params.delete(name);
    if (Number.isInteger(state.days) && state.days >= 1 && state.days !== defaultDays) params.set("days", String(state.days));
    const kinds = normalizeKinds(state.kinds);
    if (kinds.length > 0 && !sameKinds(kinds, AUDIT_DEFAULT_KINDS)) params.set("kinds", kinds.join(","));
    if (state.env !== "both") params.set("env", state.env);
    if (state.who) params.set("who", state.who);
    if (state.privileged) params.set("priv", "1");
    if (state.level) params.set("level", state.level);
    if (state.failed) params.set("failed", "1");
    if (state.q.trim()) params.set("q", state.q);
    if (state.event) params.set("event", state.event);
    const selection = parseSelection(state.from ?? null, state.to ?? null);
    if (selection) {
        params.set("from", selection.from);
        params.set("to", selection.to);
    }
    if (state.view === "idle") params.set("view", "idle");
    return params.toString();
}
