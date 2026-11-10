/**
 * The role view of the Azure Report (Azure spec 15.2): the roles of a scope with their counts, their order, and one
 * role's assignments with the marking of the Entra Report. Built from the rows of the assignments view, so the scope
 * tree, Origin, the filters and the search mean the same in both views. Pure logic, no React.
 */
import { AZURE_PRIVILEGED_ROLE_IDS, DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, type AzureAssignmentRow, type AzureReportFilters } from "@/utils/azureReport";
import type { PimPolicyRule } from "@/types/directoryRole.types";
import { summarizePolicyRules } from "@/utils/policySummary";
import type { ReportSort } from "@/utils/reportList";

/** The two views of the Azure Report; the URL writes them as `view=roles` and `view=assignments` */
export type AzureListView = "roles" | "assignments";

export function isAzureListView(value: string | null | undefined): value is AzureListView {
    return value === "roles" || value === "assignments";
}

export interface AzureRoleListRow {
    /** The role GUID, lowercase */
    id: string;
    name: string;
    isPrivileged: boolean;
    isCustom: boolean;
    eligible: number;
    active: number;
    /** Active rows with no end that did not come from an activation */
    permanent: number;
    hasPermanentActive: boolean;
    /** A privileged role whose policy at the scope asks for neither MFA nor an authentication context; null while not known (G8) */
    hasNoMfaSignal: boolean | null;
}

export interface AzureRoleAssignmentItem {
    row: AzureAssignmentRow;
    /** The row is also in the filtered rows; only read when the detail is marking */
    isMarked: boolean;
    /** The row sits on another scope than the selected one (below it, or inherited from above) */
    isOtherScope: boolean;
}

export interface AzureRoleDetailModel {
    id: string;
    name: string;
    isPrivileged: boolean;
    isCustom: boolean;
    total: number;
    /** The search or a filter other than Origin is set: matching rows get the accent edge, the others are muted */
    isMarking: boolean;
    eligible: AzureRoleAssignmentItem[];
    active: AzureRoleAssignmentItem[];
}

/** The filters that decide which rows belong to the role: Origin only, as the scope does */
export function baseFiltersOf(filters: AzureReportFilters): AzureReportFilters {
    return { ...EMPTY_AZURE_FILTERS, origin: filters.origin };
}

/** Whether the detail marks rows: a search, or any filter other than Origin that differs from the start */
export function hasAssignmentMarking(filters: AzureReportFilters): boolean {
    if (filters.query.trim() !== "") return true;
    return (Object.keys(DEFAULT_AZURE_FILTERS) as Array<keyof AzureReportFilters>)
        .some((key) => key !== "query" && key !== "origin" && filters[key] !== DEFAULT_AZURE_FILTERS[key]);
}

const roleKey = (row: AzureAssignmentRow) => row.assignment.roleDefinitionId.toLowerCase();

const isPermanentActive = (row: AzureAssignmentRow) =>
    row.assignment.state === "active" && row.assignment.endDateTime === null && row.assignment.isActivated !== true;

/**
 * One row per role that has at least one row in `rows` (the filtered rows), with its counts over `baseRows` (every row
 * of the scope under the chosen Origin), as the Entra list counts every assignment of a role. Unsorted.
 */
export function buildAzureRoleList(rows: readonly AzureAssignmentRow[], baseRows: readonly AzureAssignmentRow[]): AzureRoleListRow[] {
    const shown = new Set(rows.map(roleKey));
    const byRole = new Map<string, AzureRoleListRow>();
    for (const row of baseRows) {
        const id = roleKey(row);
        if (!shown.has(id)) continue;
        let entry = byRole.get(id);
        if (!entry) {
            entry = {
                id,
                name: row.assignment.roleName,
                isPrivileged: AZURE_PRIVILEGED_ROLE_IDS.has(id),
                isCustom: row.assignment.isCustomRole === true,
                eligible: 0,
                active: 0,
                permanent: 0,
                hasPermanentActive: false,
                hasNoMfaSignal: null,
            };
            byRole.set(id, entry);
        }
        if (row.assignment.state === "eligible") entry.eligible++;
        else entry.active++;
        if (isPermanentActive(row)) {
            entry.permanent++;
            entry.hasPermanentActive = true;
        }
    }
    return [...byRole.values()];
}

/** The Entra orders (`REPORT_SORT_OPTIONS`): most assignments, name, most permanent; ties by name */
export function sortAzureRoles(list: readonly AzureRoleListRow[], sort: ReportSort): AzureRoleListRow[] {
    return [...list].sort((a, b) => {
        if (sort !== "name") {
            const diff = sort === "assignments" ? b.eligible + b.active - (a.eligible + a.active) : b.permanent - a.permanent;
            if (diff !== 0) return diff;
        }
        return a.name.localeCompare(b.name, "en");
    });
}

/**
 * One role's assignments on the selected scope: the role's `baseRows` grouped Eligible and Active in table order, each
 * marked when it is also in `rows`. Null when the role has no row under the chosen Origin.
 */
export function buildAzureRoleDetail(roleId: string, rows: readonly AzureAssignmentRow[], baseRows: readonly AzureAssignmentRow[], selectedScopeId: string, filters: AzureReportFilters): AzureRoleDetailModel | null {
    const id = roleId.toLowerCase();
    const own = baseRows.filter((row) => roleKey(row) === id);
    if (own.length === 0) return null;
    const matching = new Set(rows.filter((row) => roleKey(row) === id).map((row) => row.assignment.id));
    const selected = selectedScopeId.toLowerCase();
    const item = (row: AzureAssignmentRow): AzureRoleAssignmentItem => ({
        row,
        isMarked: matching.has(row.assignment.id),
        isOtherScope: row.scope.id.toLowerCase() !== selected,
    });
    const first = own[0].assignment;
    return {
        id,
        name: first.roleName,
        isPrivileged: AZURE_PRIVILEGED_ROLE_IDS.has(id),
        isCustom: own.some((row) => row.assignment.isCustomRole === true),
        total: own.length,
        isMarking: hasAssignmentMarking(filters),
        eligible: own.filter((row) => row.assignment.state === "eligible").map(item),
        active: own.filter((row) => row.assignment.state === "active").map(item),
    };
}

/**
 * The red "No MFA on activation" of the role list (Azure spec 15.6), as Entra's `buildRoleListRow`: only a privileged
 * role, whose policy at the selected scope asks for neither MFA nor an authentication context. Null while the policy is
 * not known, when the role has none at the scope or the read failed: never guessed.
 */
export function noMfaSignalFor(isPrivileged: boolean, policy: { status: string; rules?: readonly unknown[] } | undefined): boolean | null {
    if (!policy || policy.status !== "loaded" || !policy.rules) return null;
    if (!isPrivileged) return false;
    const summary = summarizePolicyRules(policy.rules as PimPolicyRule[]);
    return summary.hasPimMfa !== true && summary.hasAuthContext !== true;
}

/** The roles of the list whose policy the signal needs: the privileged ones, at most five (AZURE_PRIVILEGED_ROLE_IDS) */
export function privilegedRoleIds(list: readonly AzureRoleListRow[]): string[] {
    return list.filter((row) => row.isPrivileged).map((row) => row.id);
}
