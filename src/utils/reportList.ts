import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { getUnscheduledRoleAssignments, isPermanentActive } from "@/utils/assignmentKinds";
import { summarizePolicyRules } from "@/utils/policySummary";

/**
 * Order of the Report list (spec 2.4): "Most assignments" (the default), "Name A to Z" and "Most permanent". Pure; ties
 * always fall back to the name so the order is stable between renders.
 */

export type ReportSort = "assignments" | "name" | "permanent";

export const REPORT_SORT_OPTIONS: ReadonlyArray<{ value: ReportSort; label: string }> = [
    { value: "assignments", label: "Most assignments" },
    { value: "name", label: "Name A to Z" },
    { value: "permanent", label: "Most permanent" },
];

export function isReportSort(value: string | null | undefined): value is ReportSort {
    return value === "assignments" || value === "name" || value === "permanent";
}

export function countRoleAssignments(role: RoleDetailData): { eligible: number; active: number; permanent: number } {
    // A role assignment no schedule covers is a permanent active row in the detail, so it counts here too
    const unscheduled = getUnscheduledRoleAssignments(role.assignments).length;
    return {
        eligible: role.assignments.eligible.length,
        active: role.assignments.active.length + unscheduled,
        permanent: role.assignments.active.filter(isPermanentActive).length + unscheduled,
    };
}

export function countGroupAssignments(group: PimGroupData): { eligible: number; active: number; permanent: number } {
    let eligible = 0;
    let active = 0;
    let permanent = 0;
    for (const a of group.assignments) {
        if (a.assignmentType === "eligible") eligible++;
        else {
            active++;
            if (a.assignmentType === "permanent") permanent++;
        }
    }
    return { eligible, active, permanent };
}

function compareBy<T>(sort: ReportSort, name: (item: T) => string, counts: (item: T) => { eligible: number; active: number; permanent: number }) {
    return (a: T, b: T): number => {
        if (sort !== "name") {
            const ca = counts(a);
            const cb = counts(b);
            const diff = sort === "assignments" ? cb.eligible + cb.active - (ca.eligible + ca.active) : cb.permanent - ca.permanent;
            if (diff !== 0) return diff;
        }
        return name(a).localeCompare(name(b));
    };
}

export function sortRoles(roles: readonly RoleDetailData[], sort: ReportSort): RoleDetailData[] {
    return [...roles].sort(compareBy(sort, (r) => r.definition.displayName, countRoleAssignments));
}

export function sortGroups(groups: readonly PimGroupData[], sort: ReportSort): PimGroupData[] {
    return [...groups].sort(compareBy(sort, (g) => g.group.displayName, countGroupAssignments));
}

// ---------------------------------------------------------------------------------------------
// Rows of the list (spec 2.4)
// ---------------------------------------------------------------------------------------------

export interface RoleListRow {
    id: string;
    name: string;
    isPrivileged: boolean;
    isCustom: boolean;
    eligible: number;
    active: number;
    /** A privileged role whose policy asks for neither Entra MFA nor an authentication context; null while the policy is not known */
    hasNoMfaSignal: boolean | null;
    /** Any permanent active assignment */
    hasPermanentActive: boolean;
    /** The settings of this role could not be read: the row says "Settings not loaded" instead of a signal */
    isPolicyFailed: boolean;
}

export function buildRoleListRow(role: RoleDetailData): RoleListRow {
    const counts = countRoleAssignments(role);
    const summary = summarizePolicyRules(role.policy?.details?.rules);
    return {
        id: role.definition.id,
        name: role.definition.displayName,
        isPrivileged: role.definition.isPrivileged === true,
        isCustom: role.definition.isBuiltIn === false,
        eligible: counts.eligible,
        active: counts.active,
        // The policy signal is left out while the policy loads, never guessed (spec 2.4)
        hasNoMfaSignal: !summary.isLoaded ? null : role.definition.isPrivileged === true && summary.hasPimMfa !== true && summary.hasAuthContext !== true,
        hasPermanentActive: counts.permanent > 0,
        isPolicyFailed: role.configError !== undefined && !summary.isLoaded,
    };
}

export interface GroupListRow {
    id: string;
    name: string;
    isOutsidePim: boolean;
    /** Roles the group holds (distinct roles) */
    roleCount: number;
    memberCount?: number;
    eligible: number;
    active: number;
}

export function buildGroupListRow(group: PimGroupData, roleCount: number): GroupListRow {
    const counts = countGroupAssignments(group);
    return {
        id: group.group.id,
        name: group.group.displayName,
        isOutsidePim: group.isManaged === false,
        roleCount,
        memberCount: group.memberCount,
        eligible: counts.eligible,
        active: counts.active,
    };
}
