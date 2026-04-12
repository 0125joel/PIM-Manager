/**
 * csvParserService
 *
 * Service for parsing and validating CSV files for bulk PIM configuration.
 * Matches the export format from the Report page.
 *
 * Any row whose first cell starts with "#" is automatically skipped during parsing
 * (treated as a comment row).
 */

// Types are defined in @/types/csvParser.types — re-exported here for backward compatibility
export type {
    ParsedRolePolicyRow,
    ParsedRoleAssignmentRow,
    ParsedGroupAssignmentRow,
    ParsedGroupPolicyRow,
    ParsedRoleAssignmentRemovalRow,
    ParsedGroupAssignmentRemovalRow,
    ValidationError,
    ParseResult,
    AnyParsedRow,
} from "@/types/csvParser.types";

import type {
    ParsedRolePolicyRow,
    ParsedRoleAssignmentRow,
    ParsedGroupAssignmentRow,
    ParsedGroupPolicyRow,
    ParsedRoleAssignmentRemovalRow,
    ParsedGroupAssignmentRemovalRow,
    ValidationError,
    ParseResult,
    AnyParsedRow,
} from "@/types/csvParser.types";
import { DEFAULT_DURATIONS } from "@/utils/durationUtils";

// CSV Column mappings for Role Policies (matching ReportExportModal)
const ROLE_POLICY_HEADERS = [
    "Role ID",
    "Role Name", "Description", "Built-in", "Privileged", "PIM Configured",
    "Max Activation Duration", "MFA Required", "Justification Required",
    "Approval Required", "Approvers", "Auth Context",
    "Permanent Count", "Eligible Count", "Active Count", "Total Assignments"
];

// CSV Column mappings for Group Policies
const GROUP_POLICY_HEADERS = [
    "Group ID",
    "Group Name", "Group Type", "Role-Assignable",
    "Eligible Members", "Eligible Owners", "Active Members", "Active Owners",
    "Member Max Duration", "Member MFA", "Member Approval",
    "Owner Max Duration", "Owner MFA", "Owner Approval"
];

// CSV Column mappings for Role Assignments
const ROLE_ASSIGNMENT_HEADERS = [
    "Role ID", "Role Name", "Principal ID", "Principal UPN",
    "Assignment Type", "Duration Days", "Justification", "Action"
];

// CSV Column mappings for Group Assignments
const GROUP_ASSIGNMENT_HEADERS = [
    "Group ID", "Group Name", "Principal ID", "Principal UPN",
    "Access Type", "Assignment Type", "Duration Days", "Justification", "Action"
];

// CSV Column mappings for Role Assignment Removals
const ROLE_REMOVAL_HEADERS = [
    "Role ID", "Role Name", "Principal ID", "Principal UPN",
    "Assignment Type", "Scope ID", "Action"
];

// CSV Column mappings for Group Assignment Removals
const GROUP_REMOVAL_HEADERS = [
    "Group ID", "Group Name", "Principal ID", "Principal UPN",
    "Access Type", "Assignment Type", "Action"
];

/**
 * Detect the field delimiter used in a CSV header line.
 * Counts unquoted commas vs semicolons; semicolons win if more frequent.
 * This handles European Excel locales that use ';' as the list separator.
 */
function detectDelimiter(headerLine: string): ',' | ';' {
    let commas = 0, semis = 0, inQ = false;
    for (let i = 0; i < headerLine.length; i++) {
        const ch = headerLine[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (inQ) continue;
        if (ch === ',') commas++;
        else if (ch === ';') semis++;
    }
    return semis > commas ? ';' : ',';
}

/**
 * Parse CSV content into rows.
 * Handles all common Excel export quirks:
 *   - UTF-8 BOM
 *   - CRLF, LF, and CR-only line endings
 *   - Smart/curly quotes from Word or rich-text editors
 *   - sep= directive (Excel delimiter hint on first line)
 *   - Semicolon delimiters (European Excel regional settings)
 *   - Accidentally outer-quoted rows (copy-paste into Excel cell)
 *   - "#" legend rows (skipped — treated as comments)
 */
function parseCsvContent(content: string): string[][] {
    // Strip UTF-8 BOM (0xFEFF) added by Excel "CSV UTF-8 (with BOM)" format
    let clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;

    // Normalize smart/curly quotes to straight double-quotes.
    // Word and some rich-text editors replace " with \u201C/\u201D.
    clean = clean.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

    // Split on CRLF, CR-only, or LF — all three line-ending conventions
    const lines = clean.split(/\r\n|\r|\n/).filter(line => line.trim() !== '');

    if (lines.length === 0) return [];

    // Strip sep= directive: Excel writes "sep=," or "sep=;" as the very first
    // line to hint at the delimiter. Treat it as metadata, not a header row.
    let dataStart = 0;
    if (/^sep=/i.test(lines[0].trim())) {
        dataStart = 1;
    }

    if (lines.length <= dataStart) return [];

    // Auto-detect delimiter from the header line (comma vs semicolon)
    const delimiter = detectDelimiter(lines[dataStart]);

    const rows: string[][] = [];

    for (let lineIdx = dataStart; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];

        // Skip comment rows (any row except the header whose first
        // non-whitespace character is "#").
        if (lineIdx > dataStart && line.trim().startsWith('#')) continue;

        const row: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped double-quote inside a quoted field
                    current += '"';
                    i++;
                } else {
                    // Toggle quoted-field mode
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        row.push(current.trim());
        rows.push(row);
    }

    // Fix rows that Excel accidentally wrapped in a single outer quote.
    // This happens when a user copies a CSV row and pastes it into an Excel cell:
    // Excel stores the whole row as one quoted field with inner quotes doubled.
    // Example input line:  "uuid,""Role Name"",""Desc"",Yes,..."
    // Parsed naively:      one cell containing: uuid,"Role Name","Desc",Yes,...
    // Fix: re-parse the single-cell value; if it yields exactly headerLength
    // columns, use those columns instead. Checks both ',' and ';' so the fix
    // works regardless of which delimiter the outer file uses.
    if (rows.length >= 2) {
        const headerLength = rows[0].length;
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].length === 1 && (rows[i][0].includes(',') || rows[i][0].includes(';'))) {
                const innerRows = parseCsvContent(rows[i][0]);
                if (innerRows.length === 1 && innerRows[0].length === headerLength) {
                    rows[i] = innerRows[0];
                }
            }
        }
    }

    return rows;
}

/**
 * Detect CSV type based on headers.
 * Removal types are checked first since they share columns with assignment types.
 */
function detectCsvType(headers: string[]): ParseResult<never>["csvType"] {
    const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

    // Check for removal types: "action" present but no "duration days"
    // (assignment CSVs also have "action" but include "duration days" to distinguish)
    if (normalizedHeaders.includes("action") && !normalizedHeaders.includes("duration days")) {
        // Group removals have "access type" column; role removals do not
        if (normalizedHeaders.includes("access type")) {
            return "groupAssignmentRemovals";
        }
        return "roleAssignmentRemovals";
    }

    // Check for Group Assignments (has access type + assignment type, but not member max duration)
    if (normalizedHeaders.includes("access type") && normalizedHeaders.includes("assignment type")
        && !normalizedHeaders.includes("member max duration")) {
        return "groupAssignments";
    }

    // Check for Role Assignments (has assignment type + principal upn, but not max activation duration)
    if (normalizedHeaders.includes("assignment type") && normalizedHeaders.includes("principal upn")
        && !normalizedHeaders.includes("max activation duration")) {
        return "roleAssignments";
    }

    // Check for Role Policies
    if (normalizedHeaders.includes("role name") && normalizedHeaders.includes("max activation duration")) {
        return "rolePolicies";
    }

    // Check for Group Policies
    if (normalizedHeaders.includes("group name") && normalizedHeaders.includes("member max duration")) {
        return "groupPolicies";
    }

    return "unknown";
}

/**
 * Parse boolean value from CSV
 */
function parseBoolean(value: string): boolean {
    const normalized = value.toLowerCase().trim();
    return normalized === "yes" || normalized === "true" || normalized === "1";
}

/**
 * Parse integer value from CSV
 */
function parseInteger(value: string): number {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
}

/**
 * Validate ISO 8601 duration format
 */
function isValidDuration(value: string): boolean {
    if (!value || value.trim() === '') return true; // Empty is valid (will use default)
    // Match patterns like PT8H, PT4H30M, P1D, etc.
    return /^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/.test(value) ||
        // Also accept human-readable format from export
        /^\d+\s*(hours?|h|days?|d|months?|m|years?|y)/i.test(value);
}

/**
 * Parse Role Policies CSV
 */
function parseRolePolicies(rows: string[][], headers: string[]): ParseResult<ParsedRolePolicyRow> {
    const result: ParseResult<ParsedRolePolicyRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "rolePolicies"
    };

    // Create header index map
    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => {
        headerIndex[h.toLowerCase().trim()] = i;
    });

    // Parse data rows (skip header)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;

        // Skip empty rows
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const parsedRow: ParsedRolePolicyRow = {
            roleId: getValue("role id"),
            roleName: getValue("role name"),
            description: getValue("description"),
            isBuiltIn: parseBoolean(getValue("built-in")),
            isPrivileged: parseBoolean(getValue("privileged")),
            isPimConfigured: parseBoolean(getValue("pim configured")),
            maxActivationDuration: getValue("max activation duration"),
            mfaRequired: parseBoolean(getValue("mfa required")),
            justificationRequired: parseBoolean(getValue("justification required")),
            approvalRequired: parseBoolean(getValue("approval required")),
            approvers: getValue("approvers"),
            authContext: getValue("auth context"),
            permanentCount: parseInteger(getValue("permanent count")),
            eligibleCount: parseInteger(getValue("eligible count")),
            activeCount: parseInteger(getValue("active count")),
            totalAssignments: parseInteger(getValue("total assignments")),
            rowNumber,
            originalRow: row
        };

        // Validate required fields — Role ID is the preferred stable identifier
        if (!parsedRow.roleId && !parsedRow.roleName) {
            result.errors.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID is required. Role Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.roleId) {
            result.warnings.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID not provided — matching by name is less reliable (names can change). Export from Report page to get stable IDs.",
                severity: "warning"
            });
        }

        // Validate duration format
        if (parsedRow.maxActivationDuration && !isValidDuration(parsedRow.maxActivationDuration)) {
            result.warnings.push({
                rowNumber,
                field: "Max Activation Duration",
                message: `Invalid duration format: ${parsedRow.maxActivationDuration}`,
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}

/**
 * Parse Group Policies CSV
 */
function parseGroupPolicies(rows: string[][], headers: string[]): ParseResult<ParsedGroupPolicyRow> {
    const result: ParseResult<ParsedGroupPolicyRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "groupPolicies"
    };

    // Create header index map
    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => {
        headerIndex[h.toLowerCase().trim()] = i;
    });

    // Parse data rows (skip header)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;

        // Skip empty rows
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const parsedRow: ParsedGroupPolicyRow = {
            groupId: getValue("group id"),
            groupName: getValue("group name"),
            groupType: getValue("group type"),
            roleAssignable: parseBoolean(getValue("role-assignable")),
            eligibleMembers: parseInteger(getValue("eligible members")),
            eligibleOwners: parseInteger(getValue("eligible owners")),
            activeMembers: parseInteger(getValue("active members")),
            activeOwners: parseInteger(getValue("active owners")),
            memberMaxDuration: getValue("member max duration"),
            memberMfa: parseBoolean(getValue("member mfa")),
            memberApproval: parseBoolean(getValue("member approval")),
            ownerMaxDuration: getValue("owner max duration"),
            ownerMfa: parseBoolean(getValue("owner mfa")),
            ownerApproval: parseBoolean(getValue("owner approval")),
            rowNumber,
            originalRow: row
        };

        // Validate required fields — Group ID is the preferred stable identifier
        if (!parsedRow.groupId && !parsedRow.groupName) {
            result.errors.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID is required. Group Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.groupId) {
            result.warnings.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID not provided — matching by name is less reliable (names can change). Export from Report page to get stable IDs.",
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}

/**
 * Parse Role Assignments CSV
 */
function parseRoleAssignments(rows: string[][], headers: string[]): ParseResult<ParsedRoleAssignmentRow> {
    const result: ParseResult<ParsedRoleAssignmentRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "roleAssignments"
    };

    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => { headerIndex[h.toLowerCase().trim()] = i; });

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const rawType = getValue("assignment type").toLowerCase().trim();
        const assignmentType: "eligible" | "active" =
            rawType === "active" ? "active" : "eligible";

        const rawAction = getValue("action").toLowerCase().trim();
        const action: "add" | "remove" = rawAction === "remove" ? "remove" : "add";

        const parsedRow: ParsedRoleAssignmentRow = {
            roleId: getValue("role id"),
            roleName: getValue("role name"),
            principalId: getValue("principal id"),
            principalUPN: getValue("principal upn"),
            assignmentType,
            durationDays: getValue("duration days"),
            justification: getValue("justification"),
            action,
            rowNumber,
            originalRow: row
        };

        if (!parsedRow.roleId && !parsedRow.roleName) {
            result.errors.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID is required. Role Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.roleId) {
            result.warnings.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID not provided — matching by name is less reliable (names can change).",
                severity: "warning"
            });
        }
        if (!parsedRow.principalId && !parsedRow.principalUPN) {
            result.errors.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID (Object ID) is required. UPN is accepted as a fallback for users only — groups and service principals require a Principal ID.",
                severity: "error"
            });
        } else if (!parsedRow.principalId) {
            result.warnings.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID not provided — UPN fallback will be attempted, but this only works for users. Groups and service principals must use Principal ID.",
                severity: "warning"
            });
        }
        if (parsedRow.durationDays && parsedRow.durationDays !== "permanent" && isNaN(parseInt(parsedRow.durationDays, 10))) {
            result.warnings.push({
                rowNumber,
                field: "Duration Days",
                message: `Invalid duration: "${parsedRow.durationDays}". Use an integer number of days, "permanent", or leave blank for policy default.`,
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}

/**
 * Parse Group Assignments CSV
 */
function parseGroupAssignments(rows: string[][], headers: string[]): ParseResult<ParsedGroupAssignmentRow> {
    const result: ParseResult<ParsedGroupAssignmentRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "groupAssignments"
    };

    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => { headerIndex[h.toLowerCase().trim()] = i; });

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const rawType = getValue("assignment type").toLowerCase().trim();
        const assignmentType: "eligible" | "active" =
            rawType === "active" ? "active" : "eligible";

        const rawAccessType = getValue("access type").toLowerCase().trim();
        const accessType: "member" | "owner" =
            rawAccessType === "owner" ? "owner" : "member";

        const rawAction = getValue("action").toLowerCase().trim();
        const action: "add" | "remove" = rawAction === "remove" ? "remove" : "add";

        const parsedRow: ParsedGroupAssignmentRow = {
            groupId: getValue("group id"),
            groupName: getValue("group name"),
            principalId: getValue("principal id"),
            principalUPN: getValue("principal upn"),
            accessType,
            assignmentType,
            durationDays: getValue("duration days"),
            justification: getValue("justification"),
            action,
            rowNumber,
            originalRow: row
        };

        if (!parsedRow.groupId && !parsedRow.groupName) {
            result.errors.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID is required. Group Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.groupId) {
            result.warnings.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID not provided — matching by name is less reliable (names can change).",
                severity: "warning"
            });
        }
        if (!parsedRow.principalId && !parsedRow.principalUPN) {
            result.errors.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID (Object ID) is required. UPN is accepted as a fallback for users only — groups and service principals require a Principal ID.",
                severity: "error"
            });
        } else if (!parsedRow.principalId) {
            result.warnings.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID not provided — UPN fallback will be attempted, but this only works for users. Groups and service principals must use Principal ID.",
                severity: "warning"
            });
        }
        if (parsedRow.durationDays && parsedRow.durationDays !== "permanent" && isNaN(parseInt(parsedRow.durationDays, 10))) {
            result.warnings.push({
                rowNumber,
                field: "Duration Days",
                message: `Invalid duration: "${parsedRow.durationDays}". Use an integer number of days, "permanent", or leave blank for policy default.`,
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}

/**
 * Parse Role Assignment Removals CSV
 */
function parseRoleAssignmentRemovals(rows: string[][], headers: string[]): ParseResult<ParsedRoleAssignmentRemovalRow> {
    const result: ParseResult<ParsedRoleAssignmentRemovalRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "roleAssignmentRemovals"
    };

    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => { headerIndex[h.toLowerCase().trim()] = i; });

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const rawType = getValue("assignment type").toLowerCase().trim();
        const assignmentType: "eligible" | "active" =
            rawType === "active" ? "active" : "eligible";

        const parsedRow: ParsedRoleAssignmentRemovalRow = {
            roleId: getValue("role id"),
            roleName: getValue("role name"),
            principalId: getValue("principal id"),
            principalUPN: getValue("principal upn"),
            assignmentType,
            scopeId: getValue("scope id") || "/",
            rowNumber,
            originalRow: row
        };

        if (!parsedRow.roleId && !parsedRow.roleName) {
            result.errors.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID is required. Role Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.roleId) {
            result.warnings.push({
                rowNumber,
                field: "Role ID",
                message: "Role ID not provided — matching by name is less reliable (names can change).",
                severity: "warning"
            });
        }
        if (!parsedRow.principalId && !parsedRow.principalUPN) {
            result.errors.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID (Object ID) is required. UPN is accepted as a fallback for users only — groups and service principals require a Principal ID.",
                severity: "error"
            });
        } else if (!parsedRow.principalId) {
            result.warnings.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID not provided — UPN fallback will be attempted, but this only works for users. Groups and service principals must use Principal ID.",
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}

/**
 * Parse Group Assignment Removals CSV
 */
function parseGroupAssignmentRemovals(rows: string[][], headers: string[]): ParseResult<ParsedGroupAssignmentRemovalRow> {
    const result: ParseResult<ParsedGroupAssignmentRemovalRow> = {
        success: true,
        rows: [],
        errors: [],
        warnings: [],
        csvType: "groupAssignmentRemovals"
    };

    const headerIndex: Record<string, number> = {};
    headers.forEach((h, i) => { headerIndex[h.toLowerCase().trim()] = i; });

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 1;
        if (row.every(cell => cell.trim() === '')) continue;

        const getValue = (headerName: string): string => {
            const idx = headerIndex[headerName.toLowerCase()];
            return idx !== undefined ? (row[idx] || '') : '';
        };

        const rawType = getValue("assignment type").toLowerCase().trim();
        const assignmentType: "eligible" | "active" =
            rawType === "active" ? "active" : "eligible";

        const rawAccessType = getValue("access type").toLowerCase().trim();
        const accessType: "member" | "owner" =
            rawAccessType === "owner" ? "owner" : "member";

        const parsedRow: ParsedGroupAssignmentRemovalRow = {
            groupId: getValue("group id"),
            groupName: getValue("group name"),
            principalId: getValue("principal id"),
            principalUPN: getValue("principal upn"),
            accessType,
            assignmentType,
            rowNumber,
            originalRow: row
        };

        if (!parsedRow.groupId && !parsedRow.groupName) {
            result.errors.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID is required. Group Name may be used as a fallback but is less stable.",
                severity: "error"
            });
        } else if (!parsedRow.groupId) {
            result.warnings.push({
                rowNumber,
                field: "Group ID",
                message: "Group ID not provided — matching by name is less reliable (names can change).",
                severity: "warning"
            });
        }
        if (!parsedRow.principalId && !parsedRow.principalUPN) {
            result.errors.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID (Object ID) is required. UPN is accepted as a fallback for users only — groups and service principals require a Principal ID.",
                severity: "error"
            });
        } else if (!parsedRow.principalId) {
            result.warnings.push({
                rowNumber,
                field: "Principal ID",
                message: "Principal ID not provided — UPN fallback will be attempted, but this only works for users. Groups and service principals must use Principal ID.",
                severity: "warning"
            });
        }

        result.rows.push(parsedRow);
    }

    result.success = result.errors.length === 0;
    return result;
}


/**
 * Main CSV Parser Service
 */
export const CsvParserService = {
    /**
     * Parse CSV content and return typed rows with validation
     */
    parse(content: string): ParseResult<AnyParsedRow> {
        const rows = parseCsvContent(content);

        if (rows.length === 0) {
            return {
                success: false,
                rows: [],
                errors: [{ rowNumber: 0, field: "File", message: "CSV file is empty", severity: "error" }],
                warnings: [],
                csvType: "unknown"
            };
        }

        const headers = rows[0];
        const csvType = detectCsvType(headers);

        if (csvType === "unknown") {
            return {
                success: false,
                rows: [],
                errors: [{
                    rowNumber: 1,
                    field: "Headers",
                    message: "Unrecognized CSV format. Please use a file exported from the Report page or download a template.",
                    severity: "error"
                }],
                warnings: [],
                csvType: "unknown"
            };
        }

        if (csvType === "rolePolicies") return parseRolePolicies(rows, headers) as ParseResult<AnyParsedRow>;
        if (csvType === "groupPolicies") return parseGroupPolicies(rows, headers) as ParseResult<AnyParsedRow>;
        if (csvType === "roleAssignments") return parseRoleAssignments(rows, headers) as ParseResult<AnyParsedRow>;
        if (csvType === "groupAssignments") return parseGroupAssignments(rows, headers) as ParseResult<AnyParsedRow>;
        if (csvType === "roleAssignmentRemovals") return parseRoleAssignmentRemovals(rows, headers) as ParseResult<AnyParsedRow>;
        return parseGroupAssignmentRemovals(rows, headers) as ParseResult<AnyParsedRow>;
    },

    /**
     * Parse specifically as Role Policies CSV
     */
    parseRolePolicies(content: string): ParseResult<ParsedRolePolicyRow> {
        const rows = parseCsvContent(content);
        if (rows.length === 0) {
            return {
                success: false,
                rows: [],
                errors: [{ rowNumber: 0, field: "File", message: "CSV file is empty", severity: "error" }],
                warnings: [],
                csvType: "rolePolicies"
            };
        }
        return parseRolePolicies(rows, rows[0]);
    },

    /**
     * Parse specifically as Group Policies CSV
     */
    parseGroupPolicies(content: string): ParseResult<ParsedGroupPolicyRow> {
        const rows = parseCsvContent(content);
        if (rows.length === 0) {
            return {
                success: false,
                rows: [],
                errors: [{ rowNumber: 0, field: "File", message: "CSV file is empty", severity: "error" }],
                warnings: [],
                csvType: "groupPolicies"
            };
        }
        return parseGroupPolicies(rows, rows[0]);
    },

    /**
     * Generate Role Policies template CSV
     */
    generateRolePoliciesTemplate(): string {
        const headers = ROLE_POLICY_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"Global Administrator"', '""', 'Yes', 'Yes', 'Yes',
            DEFAULT_DURATIONS.activationDuration, 'Yes', 'Yes', 'No', '""', '""',
            '0', '2', '0', '2'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Generate Group Policies template CSV
     */
    generateGroupPoliciesTemplate(): string {
        const headers = GROUP_POLICY_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"IT Administrators"', 'Security', 'Yes',
            '5', '2', '3', '1',
            DEFAULT_DURATIONS.activationDuration, 'Yes', 'No',
            DEFAULT_DURATIONS.activationDuration, 'Yes', 'Yes'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Generate Role Assignments template CSV
     */
    generateRoleAssignmentsTemplate(): string {
        const headers = ROLE_ASSIGNMENT_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"Global Reader"', '""', '"john.smith@contoso.com"',
            'eligible', '365', '"Bulk onboarding"', 'add'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Generate Group Assignments template CSV
     */
    generateGroupAssignmentsTemplate(): string {
        const headers = GROUP_ASSIGNMENT_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"IT Administrators"', '""', '"john.smith@contoso.com"',
            'member', 'eligible', '180', '""', 'add'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Generate Role Assignment Removals template CSV
     */
    generateRoleAssignmentRemovalsTemplate(): string {
        const headers = ROLE_REMOVAL_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"Global Reader"', '""', '"john.smith@contoso.com"',
            'eligible', '/', 'remove'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Generate Group Assignment Removals template CSV
     */
    generateGroupAssignmentRemovalsTemplate(): string {
        const headers = GROUP_REMOVAL_HEADERS.join(",");
        const exampleRow = [
            '""',
            '"IT Administrators"', '""', '"john.smith@contoso.com"',
            'member', 'eligible', 'remove'
        ].join(",");
        return `${headers}\n${exampleRow}`;
    },

    /**
     * Get row count from CSV content (excluding header and legend rows)
     */
    getRowCount(content: string): number {
        const rows = parseCsvContent(content);
        // Subtract 1 for header, filter empty rows
        return rows.slice(1).filter(row => row.some(cell => cell.trim() !== '')).length;
    }
};
