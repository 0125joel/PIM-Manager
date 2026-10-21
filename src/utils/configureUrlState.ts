import type { ConfigureTab, GroupAccess } from "@/types/configure.types";

/**
 * The URL state of the Configure page (spec 2): `mode` selects the view (absent is the start page), `step` the review
 * or result inside the mode that started it. Edit keeps `view` (roles is the default and is not written), `role`,
 * `group`, `access` (member is the default), `tab` and `select=several`; Guided keeps `gstep`. A parameter that does not
 * belong to the mode is dropped; parameters that are not the page's own (`screen` of the fixture) stay. The
 * URL never holds the basket. Pure; `useConfigureUrlState` reads and writes it.
 */

export type ConfigureMode = "edit" | "guided" | "import" | "model";
export type ConfigureStep = "review" | "result";

export interface ConfigureUrlState {
    mode: ConfigureMode | null;
    step: ConfigureStep | null;
    view: "roles" | "groups";
    roleId?: string;
    groupId?: string;
    access: GroupAccess;
    tab?: ConfigureTab;
    select: boolean;
    gstep?: number;
}

export const CONFIGURE_MODES: readonly ConfigureMode[] = ["edit", "guided", "import", "model"];
const TABS: readonly ConfigureTab[] = ["activation", "assignment", "notification", "who"];
const OWN_PARAMS = ["mode", "step", "view", "role", "group", "access", "tab", "select", "gstep"] as const;

export const EMPTY_CONFIGURE_URL_STATE: ConfigureUrlState = { mode: null, step: null, view: "roles", access: "member", select: false };

export function parseConfigureUrlState(search: string): ConfigureUrlState {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const rawMode = params.get("mode");
    const mode = (CONFIGURE_MODES as readonly string[]).includes(rawMode ?? "") ? (rawMode as ConfigureMode) : null;
    const state: ConfigureUrlState = { ...EMPTY_CONFIGURE_URL_STATE, mode };
    if (!mode) return state;

    const step = params.get("step");
    // The access model has no review or result
    if (mode !== "model" && (step === "review" || step === "result")) state.step = step;

    if (mode === "edit") {
        state.view = params.get("view") === "groups" ? "groups" : "roles";
        const role = params.get("role");
        const group = params.get("group");
        if (state.view === "roles" && role) state.roleId = role;
        state.select = params.get("select") === "several";
        if (state.view === "groups" && group) state.groupId = group;
        // The side of a group, or of every selected group in Select several
        if (state.view === "groups" && (group || state.select)) state.access = params.get("access") === "owner" ? "owner" : "member";
        const tab = params.get("tab");
        if ((TABS as readonly string[]).includes(tab ?? "")) state.tab = tab as ConfigureTab;
    }
    if (mode === "guided") {
        const gstep = Number(params.get("gstep"));
        if (Number.isInteger(gstep) && gstep >= 1 && gstep <= 5) state.gstep = gstep;
    }
    return state;
}

/** The query string (without `?`) for a state; `currentSearch` supplies the parameters that are not the page's own */
export function buildConfigureSearch(state: ConfigureUrlState, currentSearch = ""): string {
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
    for (const name of OWN_PARAMS) params.delete(name);
    if (!state.mode) return params.toString();
    params.set("mode", state.mode);
    if (state.step && state.mode !== "model") params.set("step", state.step);
    if (state.mode === "edit") {
        if (state.view === "groups") params.set("view", "groups");
        if (state.view === "roles" && state.roleId) params.set("role", state.roleId);
        if (state.view === "groups" && state.groupId) params.set("group", state.groupId);
        if (state.view === "groups" && (state.groupId || state.select) && state.access === "owner") params.set("access", "owner");
        if (state.tab) params.set("tab", state.tab);
        if (state.select) params.set("select", "several");
    }
    if (state.mode === "guided" && state.gstep) params.set("gstep", String(state.gstep));
    return params.toString();
}

/** The state of entering a mode: everything of the previous mode goes */
export function enterMode(mode: ConfigureMode | null): ConfigureUrlState {
    return { ...EMPTY_CONFIGURE_URL_STATE, mode };
}
