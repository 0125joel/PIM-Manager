/**
 * What the Azure Report export dialog offers and what one choice produces (like reportExportPlan.ts for Entra): the choice (remembered per viewer), the files with their row counts, and the content of each file built on demand. Pure.
 */
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { endTextFor, flattenScopeTree, principalTypeLabelFor, scopeLineFor, type AzureAssignmentRow, type AzureReportFilters } from "@/utils/azureReport";
import { getAzureFilterChips } from "@/utils/azureReportFilter";
import {
    AZURE_ASSIGNMENT_COLUMNS, AZURE_ROLE_SETTINGS_COLUMNS, anonymiseAzure, buildAzureAssignmentRows, buildAzureRoleSettingsRows, rolePairsOf,
    type AzurePolicyOutcome, type AzureRolePair,
} from "@/utils/azureExportRows";
import { isRootScope } from "@/utils/azureScopes";
import { formatDateTime } from "@/utils/dateFormat";
import type { PlannedFile } from "@/utils/reportExportPlan";
import { writeCsv } from "@/utils/exportSchema";

/** What the table shows when Export is pressed */
export interface AzureExportView {
    rows: AzureAssignmentRow[];
    scope: AzureScope | null;
    filters: AzureReportFilters;
}

export interface AzureExportChoice {
    assignments: boolean;
    roleSettings: boolean;
    /** The rows of the current scope and filter; off is every scope you can read, without filters */
    applyFilter: boolean;
    anonymise: boolean;
}

export const DEFAULT_AZURE_EXPORT_CHOICE: AzureExportChoice = { assignments: true, roleSettings: true, applyFilter: true, anonymise: false };
export const AZURE_EXPORT_STORAGE_KEY = "azure-report-export";

export interface AzureExportData {
    view: AzureExportView;
    /** Every assignment on every readable scope, once, from `allScopeRows` */
    allRows: AzureAssignmentRow[];
    scopes: AzureScope[];
    emergencyIds: ReadonlySet<string>;
    homeTenantId?: string;
    /** Subscriptions still loading: the export is then always the current view */
    isLoading: boolean;
    /** What the page has read for a role at a scope; undefined when not read yet */
    outcomeOf: (pair: AzureRolePair) => AzurePolicyOutcome | undefined;
    meta: { tenantId: string; tenantName?: string | null; exporter?: string; readAt?: string; exportedAt: Date };
}

export interface AzureExportPlan {
    files: PlannedFile[];
    /** The role and scope pairs of the role settings file; empty when that file is not chosen */
    pairs: AzureRolePair[];
    /** Pairs not read yet and not at root: the dialog reads them before it downloads */
    toRead: number;
}

function booleans<T extends object>(raw: unknown, fallback: T): T {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const defaults = fallback as Record<string, boolean>;
    return Object.fromEntries(Object.keys(defaults).map((key) => [key, typeof source[key] === "boolean" ? source[key] : defaults[key]])) as T;
}

/** The stored choice, field by field; anything missing or of the wrong type falls back to the default */
export function parseStoredAzureChoice(raw: string | null): AzureExportChoice {
    if (!raw) return DEFAULT_AZURE_EXPORT_CHOICE;
    try {
        return booleans(JSON.parse(raw), DEFAULT_AZURE_EXPORT_CHOICE);
    } catch {
        return DEFAULT_AZURE_EXPORT_CHOICE;
    }
}

/** Every assignment on a known scope, once, at the scope where it is assigned, in tree order */
export function allScopeRows(assignments: AzureAssignment[], scopes: AzureScope[]): AzureAssignmentRow[] {
    const order = new Map<string, number>();
    const stored = new Map<string, AzureScope>();
    flattenScopeTree(scopes).forEach((treeRow, index) => {
        order.set(treeRow.scope.id.toLowerCase(), index);
        stored.set(treeRow.scope.id.toLowerCase(), treeRow.scope);
    });
    const rows: AzureAssignmentRow[] = [];
    for (const assignment of assignments) {
        const scope = stored.get(assignment.scopeId.toLowerCase());
        if (!scope) continue;
        rows.push({
            assignment,
            scope,
            isInherited: false,
            originText: "This scope",
            endText: endTextFor(assignment.endDateTime),
            principalTypeLabel: principalTypeLabelFor(assignment.principalType),
        });
    }
    const position = (row: AzureAssignmentRow) => order.get(row.scope.id.toLowerCase()) ?? 0;
    return rows.sort(
        (x, y) =>
            position(x) - position(y) ||
            x.assignment.roleName.localeCompare(y.assignment.roleName, "en") ||
            x.assignment.principalName.localeCompare(y.assignment.principalName, "en"),
    );
}

/** The filters that are set, as one line; `None` when there are none */
export function describeAzureFilters(filters: AzureReportFilters, withSearch = true): string {
    const parts: string[] = [];
    const query = filters.query.trim();
    if (withSearch && query !== "") parts.push(`Search "${query}"`);
    for (const chip of getAzureFilterChips(filters)) parts.push(chip.label);
    return parts.length > 0 ? parts.join(", ") : "None";
}

/** Loading subscriptions force the current view: the full set is not known yet */
export function isFilterApplied(data: Pick<AzureExportData, "isLoading">, choice: AzureExportChoice): boolean {
    return data.isLoading || choice.applyFilter;
}

export function exportSourceRows(data: AzureExportData, choice: AzureExportChoice): AzureAssignmentRow[] {
    return isFilterApplied(data, choice) ? data.view.rows : data.allRows;
}

/** The lines above the header of an overview file; a "#" row is a comment to a reader too */
export function azurePreamble(data: AzureExportData, filtered: boolean, anonymise: boolean): string[] {
    const { meta, view } = data;
    const described = describeAzureFilters(view.filters, !anonymise);
    return [
        `# Tenant: ${meta.tenantName ? `${meta.tenantName} (${meta.tenantId})` : meta.tenantId}`,
        `# Data read: ${meta.readAt ? `Azure ${formatDateTime(meta.readAt)}` : "unknown"}`,
        `# Scope: ${filtered ? scopeLineFor(view.scope?.name ?? "", view.filters.origin) : "All scopes you can read"}`,
        `# Filter: ${filtered && described !== "None" ? described : "none"}`,
        "# Partial view: only the scopes your Azure roles let you read",
        // Replacing names leaves the exporter out too
        `# Exported ${formatDateTime(meta.exportedAt)}${meta.exporter && !anonymise ? ` by ${meta.exporter}` : ""}`,
    ];
}

const rowsLabel = (n: number): string => `${n} ${n === 1 ? "row" : "rows"}`;

export function planAzureExport(data: AzureExportData, choice: AzureExportChoice): AzureExportPlan {
    const date = data.meta.exportedAt.toISOString().slice(0, 10);
    const filtered = isFilterApplied(data, choice);
    const source = exportSourceRows(data, choice);
    const { rows, outcomeOf, ids } = choice.anonymise
        ? anonymiseAzure(source, data.outcomeOf)
        : { rows: source, outcomeOf: data.outcomeOf, ids: undefined };
    const preamble = azurePreamble(data, filtered, choice.anonymise);
    const mime = "text/csv;charset=utf-8";
    const files: PlannedFile[] = [];
    let pairs: AzureRolePair[] = [];
    let toRead = 0;

    if (choice.assignments) {
        files.push({
            id: "azureAssignments",
            name: `pim-azure-overview-assignments-${date}.csv`,
            mime,
            count: rowsLabel(rows.length),
            build: () => writeCsv(
                { columns: AZURE_ASSIGNMENT_COLUMNS },
                buildAzureAssignmentRows(rows, { scopes: data.scopes, emergencyIds: data.emergencyIds, homeTenantId: data.homeTenantId, anonymisedIds: ids }),
                { preamble },
            ),
        });
    }
    if (choice.roleSettings) {
        pairs = rolePairsOf(source, data.scopes);
        toRead = pairs.filter((pair) => data.outcomeOf(pair) === undefined && !isRootScope(pair.scopeId)).length;
        const chosen = pairs;
        files.push({
            id: "azureRoleSettings",
            name: `pim-azure-overview-role-settings-${date}.csv`,
            mime,
            count: `${rowsLabel(chosen.length)}${toRead > 0 ? `, ${toRead} to read` : ""}`,
            // The dialog reads the missing pairs between the plan and the build, so the outcomes are looked up when the file is built
            build: () => writeCsv({ columns: AZURE_ROLE_SETTINGS_COLUMNS }, buildAzureRoleSettingsRows(chosen, outcomeOf), { preamble }),
        });
    }
    return { files, pairs, toRead };
}
