/**
 * The recommended settings of the access model per role, as a role settings CSV (Configure, Access model page). The file
 * has the columns of "For Configure Import" (the Role settings file), so Import a file reads it back and compares it
 * with the tenant like any other settings file. Pure. A cell that is empty keeps the current value, so a role gets only
 * the settings the catalog recommends for it.
 */
import { configToSetToValues, findCatalogRole, type AccessModelCatalog, type ExpectedConfig } from "@/utils/accessModelCatalog";
import { FILE_SCHEMAS, writeCsv, type ExportRow } from "@/utils/exportSchema";
import { activationDurationFromCatalog } from "@/utils/guidedRoute";
import type { SettingField } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { ActivationRequirementValue } from "@/utils/policyRules";

/** The column key of each setting the catalog can recommend (the keys of `FILE_SCHEMAS.bulkRolePolicies`) */
const COLUMN_KEY: Partial<Record<SettingField, string>> = {
    maxActivationDuration: "maxActivationDuration",
    requireJustificationOnActivation: "justificationRequired",
    requireApproval: "approvalRequired",
    allowPermanentEligible: "allowPermanentEligible",
    allowPermanentActive: "allowPermanentActive",
};

/** The row of one role: its id and name, and the recommended settings the catalog gives it (empty cells keep the current value) */
export function roleCsvRow(role: RoleDetailData, config: ExpectedConfig, resolveContext: (slug: string) => string | null): ExportRow | null {
    const { values } = configToSetToValues(config, resolveContext);
    const row: ExportRow = { roleId: role.definition.id, roleName: role.definition.displayName };
    for (const { field, to } of values) {
        if (field === "maxActivationDuration" && typeof to === "string") {
            const duration = activationDurationFromCatalog(to);
            if (duration) row.maxActivationDuration = duration.value;
        } else if (field === "activationRequirement") {
            const requirement = to as ActivationRequirementValue;
            row.requireOnActivation = requirement.kind;
            if (requirement.kind === "authenticationContext") row.authContextId = requirement.contextId;
        } else if (COLUMN_KEY[field]) {
            row[COLUMN_KEY[field]!] = to;
        }
    }
    return Object.keys(row).length > 2 ? row : null;
}

export interface RoleCsvInput {
    catalog: AccessModelCatalog;
    /** The tenant's roles as loaded: a role is matched to the catalog by its template id, as the compare does */
    roles: readonly RoleDetailData[];
    resolveContext: (slug: string) => string | null;
}

/** One row per tenant role the catalog has a recommendation for, in the order of the tenant's roles */
export function buildRoleCsvRows({ catalog, roles, resolveContext }: RoleCsvInput): ExportRow[] {
    const rows: ExportRow[] = [];
    for (const role of roles) {
        const templateId = role.definition.templateId ?? role.definition.id;
        const catalogRole = findCatalogRole(catalog, templateId);
        if (!catalogRole) continue;
        const row = roleCsvRow(role, catalogRole.expectedConfig, resolveContext);
        if (row) rows.push(row);
    }
    return rows;
}

/** The CSV file of the rows, with a comment line above the header that says where it came from */
export function buildRoleCsv(rows: readonly ExportRow[], preamble: readonly string[]): string {
    return writeCsv({ columns: FILE_SCHEMAS.bulkRolePolicies.columns }, rows, { preamble });
}
