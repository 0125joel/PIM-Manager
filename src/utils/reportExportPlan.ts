import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuthenticationContext } from "@/types/shared.types";
import { anonymisePeople } from "@/utils/exportAnonymise";
import { buildBackup, type BackupWorkload } from "@/utils/exportBackup";
import {
    buildAssignmentRows, buildBulkGroupAssignmentRows, buildBulkRoleAssignmentRows, buildGroupPolicyRows, buildOverviewGroupSettingsRows,
    buildOverviewRoleSettingsRows, buildRolePolicyRows, type ExportLists,
} from "@/utils/exportRows";
import { BACKUP_FILE_NAME, FILE_SCHEMAS, writeCsv, type ExportFileType, type ExportRow } from "@/utils/exportSchema";
import { formatDateTime } from "@/utils/dateFormat";

/**
 * What the Report export dialog offers and what one choice produces (Report spec 10.1): the choice (remembered per
 * viewer), the files with their row counts, and the content of each file built on demand. Pure, so the counts shown
 * in the dialog and the files downloaded come from the same plan.
 */

export type ExportPurpose = "overview" | "bulk" | "backup";

export interface ExportChoice {
    purpose: ExportPurpose;
    overview: { assignments: boolean; roleSettings: boolean; groupSettings: boolean; anonymise: boolean };
    bulk: { rolePolicies: boolean; groupPolicies: boolean; roleAssignments: boolean; groupAssignments: boolean };
    scope: { roles: boolean; groups: boolean; applyFilter: boolean };
}

export const DEFAULT_EXPORT_CHOICE: ExportChoice = {
    purpose: "overview",
    overview: { assignments: true, roleSettings: true, groupSettings: true, anonymise: false },
    bulk: { rolePolicies: true, groupPolicies: true, roleAssignments: true, groupAssignments: true },
    scope: { roles: true, groups: true, applyFilter: true },
};

export const EXPORT_STORAGE_KEY = "report-export";

const PURPOSES: readonly ExportPurpose[] = ["overview", "bulk", "backup"];

function booleans<T extends Record<string, boolean>>(raw: unknown, fallback: T): T {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return Object.fromEntries(Object.keys(fallback).map((key) => [key, typeof source[key] === "boolean" ? source[key] : fallback[key]])) as T;
}

/** The stored choice, field by field; anything missing or of the wrong type falls back to the default */
export function parseStoredChoice(raw: string | null): ExportChoice {
    if (!raw) return DEFAULT_EXPORT_CHOICE;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        return {
            purpose: PURPOSES.includes(value.purpose as ExportPurpose) ? (value.purpose as ExportPurpose) : DEFAULT_EXPORT_CHOICE.purpose,
            overview: booleans(value.overview, DEFAULT_EXPORT_CHOICE.overview),
            bulk: booleans(value.bulk, DEFAULT_EXPORT_CHOICE.bulk),
            scope: booleans(value.scope, DEFAULT_EXPORT_CHOICE.scope),
        };
    } catch {
        return DEFAULT_EXPORT_CHOICE;
    }
}

export interface ExportData {
    allRoles: RoleDetailData[];
    allGroups: PimGroupData[];
    /** What the page shows with the current filter and search, groups and roles alike */
    filteredRoles: RoleDetailData[];
    filteredGroups: PimGroupData[];
    /** PIM for Groups is consented and read */
    canExportGroups: boolean;
    /** The filter chips of the page as a sentence ("Privileged only, Has assignments"), empty without a filter */
    filterSentence: string;
    /** The search words of the page; they can be a person's name, so they stay out of a file whose names are replaced */
    searchTerm: string;
    lists: ExportLists;
    authenticationContexts: readonly AuthenticationContext[];
    emergencyIds: ReadonlySet<string>;
    meta: {
        tenantId: string;
        tenantName?: string;
        exporter?: string;
        appVersion: string;
        readAt: Partial<Record<BackupWorkload, string>>;
        exportedAt: Date;
    };
}

export interface PlannedFile {
    id: string;
    name: string;
    mime: string;
    /** "30 rows", "7 roles, 5 groups" */
    count: string;
    /** The content, built when it is downloaded */
    build: () => string;
}

export interface ExportPlan {
    files: PlannedFile[];
    /** Bulk assignment rows left out and why (spec 10.3) */
    notIncluded: { activated: number; viaGroup: number };
}

/** The filter and the search of the page in one sentence, "" when neither is active */
export function describeFilter(data: Pick<ExportData, "filterSentence" | "searchTerm">, withSearch = true): string {
    return [data.filterSentence, withSearch && data.searchTerm ? `Search "${data.searchTerm}"` : ""].filter(Boolean).join(", ");
}

export const hasActiveFilter = (data: Pick<ExportData, "filterSentence" | "searchTerm">): boolean => data.filterSentence !== "" || data.searchTerm !== "";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const rowsLabel = (n: number): string => plural(n, "row", "rows");
const dateOf = (date: Date): string => date.toISOString().slice(0, 10);

/** The lines above the header of an overview file; a "#" row is a comment to the Configure Import reader too */
export function overviewPreamble(data: ExportData, scope: { roles: boolean; groups: boolean }, filtered: boolean, anonymise = false): string[] {
    const { meta } = data;
    const read = [scope.roles && meta.readAt.directoryRoles ? `directory roles ${formatDateTime(meta.readAt.directoryRoles)}` : "", scope.groups && meta.readAt.pimGroups ? `PIM for Groups ${formatDateTime(meta.readAt.pimGroups)}` : ""].filter(Boolean);
    return [
        `# Tenant: ${meta.tenantName ? `${meta.tenantName} (${meta.tenantId})` : meta.tenantId}`,
        `# Data read: ${read.length > 0 ? read.join(", ") : "unknown"}`,
        `# Filter: ${filtered ? describeFilter(data, !anonymise) || "none" : "none"}`,
        // Replacing names leaves the exporter out too
        `# Exported ${formatDateTime(meta.exportedAt)}${meta.exporter && !anonymise ? ` by ${meta.exporter}` : ""}`,
    ];
}

export function planExport(data: ExportData, choice: ExportChoice): ExportPlan {
    const date = dateOf(data.meta.exportedAt);
    const useRoles = choice.scope.roles && data.allRoles.length > 0;
    const useGroups = choice.scope.groups && data.canExportGroups;
    const hasFilter = hasActiveFilter(data);
    const filtered = choice.purpose !== "backup" && choice.scope.applyFilter && hasFilter;
    const roles = useRoles ? (filtered ? data.filteredRoles : data.allRoles) : [];
    const groups = useGroups ? (filtered ? data.filteredGroups : data.allGroups) : [];
    const files: PlannedFile[] = [];
    const notIncluded = { activated: 0, viaGroup: 0 };

    const csv = (type: ExportFileType, rows: ExportRow[], preamble?: string[]): PlannedFile => ({
        id: type,
        name: FILE_SCHEMAS[type].fileName(date),
        mime: "text/csv;charset=utf-8",
        count: rowsLabel(rows.length),
        build: () => writeCsv(FILE_SCHEMAS[type], rows, { preamble }),
    });

    if (choice.purpose === "overview") {
        const { assignments, roleSettings, groupSettings, anonymise } = choice.overview;
        const source = anonymise ? anonymisePeople(roles, groups) : { roles, groups, ids: undefined };
        const preamble = overviewPreamble(data, { roles: useRoles, groups: useGroups }, filtered, anonymise);
        if (assignments && (useRoles || useGroups)) {
            const rows = buildAssignmentRows(source.roles, source.groups, { anonymisedIds: source.ids, emergencyIds: data.emergencyIds }) as unknown as ExportRow[];
            files.push(csv("overviewAssignments", rows, preamble));
        }
        if (roleSettings && useRoles) files.push(csv("overviewRoleSettings", buildOverviewRoleSettingsRows(source.roles, data.lists), preamble));
        if (groupSettings && useGroups) files.push(csv("overviewGroupSettings", buildOverviewGroupSettingsRows(source.groups, data.lists), preamble));
    } else if (choice.purpose === "bulk") {
        const { rolePolicies, groupPolicies, roleAssignments, groupAssignments } = choice.bulk;
        if (rolePolicies && useRoles) files.push(csv("bulkRolePolicies", buildRolePolicyRows(roles, data.lists)));
        if (groupPolicies && useGroups) files.push(csv("bulkGroupPolicies", buildGroupPolicyRows(groups, data.lists)));
        if (roleAssignments && useRoles) {
            const result = buildBulkRoleAssignmentRows(roles, { now: data.meta.exportedAt });
            notIncluded.activated += result.skipped.activated;
            notIncluded.viaGroup += result.skipped.viaGroup;
            files.push(csv("bulkRoleAssignments", result.rows));
        }
        if (groupAssignments && useGroups) {
            const result = buildBulkGroupAssignmentRows(groups, { now: data.meta.exportedAt });
            notIncluded.activated += result.skipped.activated;
            notIncluded.viaGroup += result.skipped.viaGroup;
            files.push(csv("bulkGroupAssignments", result.rows));
        }
    } else {
        const workloads: BackupWorkload[] = [...(useRoles ? ["directoryRoles" as const] : []), ...(useGroups ? ["pimGroups" as const] : [])];
        if (workloads.length > 0) {
            const parts = [useRoles ? plural(data.allRoles.length, "role", "roles") : "", useGroups ? plural(data.allGroups.length, "group", "groups") : ""].filter(Boolean);
            files.push({
                id: "backup",
                name: BACKUP_FILE_NAME(date),
                mime: "application/json",
                count: parts.join(", "),
                build: () => JSON.stringify(buildBackup({
                    roles: data.allRoles,
                    groups: data.allGroups,
                    tenant: { id: data.meta.tenantId, displayName: data.meta.tenantName },
                    readAt: data.meta.readAt,
                    appVersion: data.meta.appVersion,
                    exportedAt: data.meta.exportedAt,
                    workloads,
                    authenticationContexts: data.authenticationContexts,
                    customExtensions: data.lists.customExtensions ?? null,
                }), null, 2),
            });
        }
    }
    return { files, notIncluded };
}
