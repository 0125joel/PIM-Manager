import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";

/** Words for the states of the Report (spec 7), as pure functions so the sentences are tested. */

/** "{status} after 3 tries" where the read really retried (429 and 5xx), "{status}" otherwise, a plain sentence without a status. */
export function summarizeFailureCause(errors: ReadonlyArray<string | undefined>): string {
    const statuses = [...new Set(errors.map((e) => e?.match(/\b([45]\d\d)\b/)?.[1]).filter((s): s is string => !!s))];
    if (statuses.length === 0) return "Microsoft Graph did not return them.";
    const text = statuses.map((s) => (s === "429" || s.startsWith("5") ? `${s} after 3 tries` : s)).join(", ");
    return `Microsoft Graph answered ${text}.`;
}

export interface FailedRolesSummary {
    ids: string[];
    title: string;
    cause: string;
}

/** The box above the list when the settings of some roles could not be read (spec 7.6). Null when none failed. */
export function summarizeFailedRoles(roles: readonly RoleDetailData[], failedRoleIds: readonly string[]): FailedRolesSummary | null {
    if (failedRoleIds.length === 0) return null;
    const failed = new Set(failedRoleIds);
    const errors = roles.filter((r) => failed.has(r.definition.id)).map((r) => r.configError);
    return {
        ids: [...failedRoleIds],
        title: `Settings of ${failedRoleIds.length} ${failedRoleIds.length === 1 ? "role" : "roles"} could not be loaded`,
        cause: summarizeFailureCause(errors),
    };
}

/** "No roles match" with the search term and the active filters named, so the reader sees why (spec 7.4). */
export function describeNoMatch(view: "roles" | "groups", query: string, filterLabels: readonly string[]): { title: string; detail: string } {
    const parts: string[] = [];
    if (query.trim()) parts.push(`Search: "${query.trim()}".`);
    if (filterLabels.length > 0) parts.push(`Filters: ${filterLabels.join(", ")}.`);
    return { title: `No ${view} match`, detail: parts.join(" ") };
}

/** Graph did not report `isPrivileged` for some role: the warning line of spec 7, read from the data as it is now. */
export function isPrivilegedStatusMissing(roles: readonly RoleDetailData[]): boolean {
    return roles.length > 0 && roles.some((r) => r.definition.isPrivileged === undefined);
}

/**
 * Whether the settings a policy filter needs are still missing in this view. A smart refresh runs the policy
 * phase again while every policy is already loaded, so "loading" alone would switch the filters off for nothing:
 * only a role without a policy (and without a read error) or a group under PIM without policies is waiting.
 */
export function areSettingsPending(input: {
    view: "roles" | "groups";
    rolePoliciesLoading: boolean;
    groupsLoading: boolean;
    roles: ReadonlyArray<Pick<RoleDetailData, "policy" | "configError">>;
    groups: ReadonlyArray<Pick<PimGroupData, "isManaged" | "policies" | "policiesForbidden">>;
}): boolean {
    if (input.view === "roles") return input.rolePoliciesLoading && input.roles.some((r) => !r.policy && !r.configError);
    return input.groupsLoading && (input.groups.length === 0 || input.groups.some((g) => g.isManaged !== false && !g.policies && !g.policiesForbidden));
}
