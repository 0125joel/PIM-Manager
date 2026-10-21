import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { buildSearchWithFilter, parseDashboardFilter } from "@/utils/dashboardFilter";

/**
 * The URL state of the Report page (spec 2): `view` (roles is the default and is not written), `q` (the search term, not
 * part of `f`), `f` (the filter language of the dashboard), `role` (a role definition id) and `group` (a group id). The
 * selection belongs to its view: `role` is only read and written in the roles view, `group` in the groups view. Parameters
 * that are none of these stay as they are. Pure; `useReportUrlState` reads and writes it.
 */

export type ReportView = "roles" | "groups";

export interface ReportUrlState {
    view: ReportView;
    q: string;
    filter: DashboardFilter;
    roleId?: string;
    groupId?: string;
}

const OWN_PARAMS = ["view", "q", "role", "group", "f"] as const;

export function parseReportUrlState(search: string): ReportUrlState {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const view: ReportView = params.get("view") === "groups" ? "groups" : "roles";
    const state: ReportUrlState = { view, q: params.get("q") ?? "", filter: parseDashboardFilter(params.get("f")) };
    const role = params.get("role");
    const group = params.get("group");
    if (view === "roles" && role) state.roleId = role;
    if (view === "groups" && group) state.groupId = group;
    return state;
}

/** The query string (without `?`) for a state; `currentSearch` supplies the parameters that are not the page's own. */
export function buildReportSearch(state: ReportUrlState, currentSearch = ""): string {
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
    for (const name of OWN_PARAMS) params.delete(name);
    if (state.view === "groups") params.set("view", "groups");
    if (state.q.trim()) params.set("q", state.q);
    if (state.view === "roles" && state.roleId) params.set("role", state.roleId);
    if (state.view === "groups" && state.groupId) params.set("group", state.groupId);
    return buildSearchWithFilter(params.toString(), state.filter);
}
