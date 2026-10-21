import { isIsoDuration } from "@/utils/durationUtils";

/** Spreadsheets run a cell that starts with these as a formula (CSV injection); a leading apostrophe makes it text. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula defused, quoted when it holds a comma, quote or line break (RFC 4180). */
export function escapeCsvCell(value: string): string {
    const safe = FORMULA_START.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * One column definition per export file (Report spec 10.2). A column is `{ header, key, codec }`: export writes
 * through `codec.write`, the round-trip test (and Configure Import) reads through `codec.read`, so a column is
 * added in one place. Rows are plain objects keyed by `key`; an undefined value is an empty cell.
 */

export type ReadResult<V> = { ok: true; value: V } | { ok: false; error: string };

export interface Codec<V> {
    /** The values a cell may hold, for the reference of Import (enums only) */
    values?: readonly string[];
    write(value: V | undefined): string;
    /** An empty cell reads as `undefined`, never as an error */
    read(cell: string): ReadResult<V | undefined>;
}

export interface Column {
    header: string;
    key: string;
    codec: Codec<unknown>;
}

export type ExportRow = Record<string, unknown>;

export type ExportFileType =
    | "overviewAssignments"
    | "overviewRoleSettings"
    | "overviewGroupSettings"
    | "bulkRolePolicies"
    | "bulkGroupPolicies"
    | "bulkRoleAssignments"
    | "bulkGroupAssignments";

export interface FileSchema {
    type: ExportFileType;
    /** `date` is the export date, yyyy-MM-dd */
    fileName(date: string): string;
    columns: Column[];
}

/** The BOM Excel needs to open UTF-8; the download adds it, `writeCsv` returns plain text */
export const CSV_BOM = "﻿";

const ok = <V,>(value: V | undefined): ReadResult<V | undefined> => ({ ok: true, value });
const fail = (error: string): ReadResult<never> => ({ ok: false, error });

// --- Cell codecs ---

export const textCodec: Codec<string> = {
    write: (value) => value ?? "",
    read: (cell) => ok(cell.trim() === "" ? undefined : cell.trim()),
};

/** "Yes" / "No"; reads yes, true, 1, no, false and 0 in any case */
export const yesNoCodec: Codec<boolean> = {
    write: (value) => (value === undefined ? "" : value ? "Yes" : "No"),
    read: (cell) => {
        const text = cell.trim().toLowerCase();
        if (text === "") return ok(undefined);
        if (text === "yes" || text === "true" || text === "1") return ok(true);
        if (text === "no" || text === "false" || text === "0") return ok(false);
        return fail(`"${cell.trim()}" is not Yes or No`);
    },
};

/** An ISO 8601 duration as Graph accepts it (PT8H, P30D, P1Y) */
export const durationCodec: Codec<string> = {
    write: (value) => value ?? "",
    read: (cell) => {
        const text = cell.trim();
        if (text === "") return ok(undefined);
        return isIsoDuration(text) ? ok(text) : fail(`"${text}" is not an ISO 8601 duration`);
    },
};

export const intCodec: Codec<number> = {
    write: (value) => (value === undefined ? "" : String(value)),
    read: (cell) => {
        const text = cell.trim();
        if (text === "") return ok(undefined);
        return /^\d+$/.test(text) ? ok(Number(text)) : fail(`"${text}" is not a whole number`);
    },
};

/** Whole days left, or "permanent" */
export const daysCodec: Codec<string> = {
    write: (value) => value ?? "",
    read: (cell) => {
        const text = cell.trim();
        if (text === "") return ok(undefined);
        if (text.toLowerCase() === "permanent") return ok("permanent");
        return /^\d+$/.test(text) ? ok(text) : fail(`"${text}" is not a number of days or "permanent"`);
    },
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;

/** Only an ISO 8601 date or date-time is a date: "01-04-2027" (1 April or 4 January?) and "2027-02-31" are not */
export function isIsoDateText(text: string): boolean {
    const m = ISO_DATE.exec(text);
    if (!m) return false;
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return false;
    if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] !== undefined && Number(m[6]) > 59))) return false;
    return !Number.isNaN(Date.parse(text.replace(" ", "T")));
}

/** An ISO date-time or "permanent" */
export const endDateCodec: Codec<string> = {
    write: (value) => value ?? "",
    read: (cell) => {
        const text = cell.trim();
        if (text === "") return ok(undefined);
        if (text.toLowerCase() === "permanent") return ok("permanent");
        return isIsoDateText(text) ? ok(text) : fail(`"${text}" is not an ISO 8601 date-time or "permanent"`);
    },
};

export function enumCodec<V extends string>(values: readonly V[]): Codec<V> {
    return {
        values,
        write: (value) => value ?? "",
        read: (cell) => {
            const text = cell.trim();
            if (text === "") return ok(undefined);
            const match = values.find((v) => v.toLowerCase() === text.toLowerCase());
            return match ? ok(match) : fail(`"${text}" is not one of ${values.join(", ")}`);
        },
    };
}

export interface ApproverRef {
    type: "user" | "group" | "manager";
    id: string;
}

/** `user:{id}`, `group:{id}` or `manager`, joined by `;` */
export const approversCodec: Codec<ApproverRef[]> = {
    write: (value) => (value ?? []).map((a) => (a.type === "manager" ? "manager" : `${a.type}:${a.id}`)).join(";"),
    read: (cell) => {
        const text = cell.trim();
        if (text === "") return ok(undefined);
        const refs: ApproverRef[] = [];
        for (const part of text.split(";").map((p) => p.trim()).filter(Boolean)) {
            if (part.toLowerCase() === "manager") {
                refs.push({ type: "manager", id: "" });
                continue;
            }
            const [type, ...rest] = part.split(":");
            const id = rest.join(":").trim();
            if ((type !== "user" && type !== "group") || id === "") return fail(`"${part}" is not user:{id}, group:{id} or manager`);
            refs.push({ type, id });
        }
        return ok(refs);
    },
};

const column = <V,>(header: string, key: string, codec: Codec<V>): Column => ({ header, key, codec: codec as unknown as Codec<unknown> });

// --- Policy columns ---

const NOTIFICATION_CATEGORIES = [
    { key: "eligibleAssignment", label: "Eligible Assignment", recipients: [["admin", "Admin"], ["assignee", "Assignee"], ["approver", "Approver"]] },
    { key: "activeAssignment", label: "Active Assignment", recipients: [["admin", "Admin"], ["assignee", "Assignee"], ["approver", "Approver"]] },
    { key: "activation", label: "Activation", recipients: [["admin", "Admin"], ["requestor", "Requestor"], ["approver", "Approver"]] },
] as const;

const NOTIFICATION_FIELDS = [
    { key: "isEnabled", label: "Enabled", codec: yesNoCodec as Codec<unknown> },
    { key: "additionalRecipients", label: "Recipients", codec: textCodec as Codec<unknown> },
    { key: "criticalOnly", label: "Critical Only", codec: yesNoCodec as Codec<unknown> },
] as const;

export const NOTIFICATION_KEYS: string[] = NOTIFICATION_CATEGORIES.flatMap((c) =>
    c.recipients.flatMap(([recipient]) => NOTIFICATION_FIELDS.map((f) => `n.${c.key}.${recipient}.${f.key}`)));

interface PolicyFieldDef {
    key: string;
    /** Header in the role file, and the suffix after "Member " or "Owner " in the group file */
    role: string;
    group: string;
    codec: Codec<unknown>;
}

const field = <V,>(key: string, role: string, group: string, codec: Codec<V>): PolicyFieldDef => ({ key, role, group, codec: codec as unknown as Codec<unknown> });
const same = <V,>(key: string, header: string, codec: Codec<V>): PolicyFieldDef => field(key, header, header, codec);

/** Every field of `PolicySettings`, once. Role and group headers differ only where today's files already did. */
const POLICY_FIELDS: PolicyFieldDef[] = [
    field("maxActivationDuration", "Max Activation Duration", "Max Duration", durationCodec),
    field("mfaRequired", "MFA Required", "MFA", yesNoCodec),
    same("justificationRequired", "Justification Required", yesNoCodec),
    field("approvalRequired", "Approval Required", "Approval", yesNoCodec),
    same("approverNames", "Approvers", textCodec),
    same("authContextName", "Auth Context", textCodec),
    same("preExtensionName", "Pre-approval Extension", textCodec),
    same("postExtensionName", "Post-approval Extension", textCodec),
    same("requireOnActivation", "Require On Activation", enumCodec(["none", "mfa", "authenticationContext"] as const)),
    same("authContextId", "Auth Context ID", textCodec),
    same("ticketRequired", "Ticket Required", yesNoCodec),
    same("approvers", "Approver IDs", approversCodec),
    same("preExtensionId", "Pre-approval Extension ID", textCodec),
    same("preExtensionEnabled", "Pre-approval Extension Enabled", yesNoCodec),
    same("postExtensionId", "Post-approval Extension ID", textCodec),
    same("postExtensionEnabled", "Post-approval Extension Enabled", yesNoCodec),
    same("allowPermanentEligible", "Eligible Allow Permanent", yesNoCodec),
    same("eligibleExpiration", "Eligible Expiration", durationCodec),
    same("allowPermanentActive", "Active Allow Permanent", yesNoCodec),
    same("activeExpiration", "Active Expiration", durationCodec),
    same("activeRequiresMfa", "Active Requires MFA", yesNoCodec),
    same("activeRequiresJustification", "Active Requires Justification", yesNoCodec),
    ...NOTIFICATION_CATEGORIES.flatMap((c) =>
        c.recipients.flatMap(([recipient, recipientLabel]) =>
            NOTIFICATION_FIELDS.map((f) => same(`n.${c.key}.${recipient}.${f.key}`, `${c.label} ${recipientLabel} ${f.label}`, f.codec)))),
];

/** The keys of the policy part of a row, in column order */
export const POLICY_FIELD_KEYS: string[] = POLICY_FIELDS.map((f) => f.key);

const ROLE_LEGACY = ["maxActivationDuration", "mfaRequired", "justificationRequired", "approvalRequired", "approverNames", "authContextName", "preExtensionName", "postExtensionName"];
const GROUP_LEGACY_VALUES = ["maxActivationDuration", "mfaRequired", "approvalRequired"];
const GROUP_LEGACY_EXTENSIONS = ["preExtensionName", "postExtensionName"];

const fieldDef = (key: string): PolicyFieldDef => {
    const def = POLICY_FIELDS.find((f) => f.key === key);
    if (!def) throw new Error(`Unknown policy field ${key}`);
    return def;
};

const roleColumn = (key: string): Column => {
    const def = fieldDef(key);
    return column(def.role, key, def.codec);
};

/** `side` is "member" or "owner": the row key is `member.maxActivationDuration`, the header "Member Max Duration" */
const groupColumn = (side: "member" | "owner", key: string): Column => {
    const def = fieldDef(key);
    const prefix = side === "member" ? "Member " : "Owner ";
    return column(prefix + def.group, `${side}.${key}`, def.codec);
};

// --- File schemas ---

const ROLE_POLICY_COLUMNS: Column[] = [
    column("Role ID", "roleId", textCodec),
    column("Role Name", "roleName", textCodec),
    column("Description", "description", textCodec),
    column("Built-in", "builtIn", yesNoCodec),
    column("Privileged", "privileged", yesNoCodec),
    column("PIM Configured", "pimConfigured", yesNoCodec),
    ...ROLE_LEGACY.map(roleColumn),
    column("Permanent Count", "permanentCount", intCodec),
    column("Eligible Count", "eligibleCount", intCodec),
    column("Active Count", "activeCount", intCodec),
    column("Total Assignments", "totalAssignments", intCodec),
    ...POLICY_FIELDS.filter((f) => !ROLE_LEGACY.includes(f.key)).map((f) => roleColumn(f.key)),
];

const SIDES = ["member", "owner"] as const;

const GROUP_POLICY_COLUMNS: Column[] = [
    column("Group ID", "groupId", textCodec),
    column("Group Name", "groupName", textCodec),
    column("Group Type", "groupType", textCodec),
    column("Role-Assignable", "roleAssignable", yesNoCodec),
    column("Eligible Members", "eligibleMembers", intCodec),
    column("Eligible Owners", "eligibleOwners", intCodec),
    column("Active Members", "activeMembers", intCodec),
    column("Active Owners", "activeOwners", intCodec),
    ...SIDES.flatMap((side) => GROUP_LEGACY_VALUES.map((key) => groupColumn(side, key))),
    ...SIDES.flatMap((side) => GROUP_LEGACY_EXTENSIONS.map((key) => groupColumn(side, key))),
    ...SIDES.flatMap((side) =>
        POLICY_FIELDS.filter((f) => !GROUP_LEGACY_VALUES.includes(f.key) && !GROUP_LEGACY_EXTENSIONS.includes(f.key)).map((f) => groupColumn(side, f.key))),
];

/** Today's headers, in today's order, then the new ones (spec 10.3) */
const ROLE_ASSIGNMENT_COLUMNS: Column[] = [
    column("Role ID", "roleId", textCodec),
    column("Role Name", "roleName", textCodec),
    column("Principal ID", "principalId", textCodec),
    column("Principal UPN", "principalUpn", textCodec),
    column("Assignment Type", "assignmentType", enumCodec(["eligible", "active"] as const)),
    column("Duration Days", "durationDays", daysCodec),
    column("Justification", "justification", textCodec),
    column("Action", "action", enumCodec(["add", "remove"] as const)),
    column("Scope ID", "scopeId", textCodec),
    column("End Date", "endDate", endDateCodec),
];

const GROUP_ASSIGNMENT_COLUMNS: Column[] = [
    column("Group ID", "groupId", textCodec),
    column("Group Name", "groupName", textCodec),
    column("Principal ID", "principalId", textCodec),
    column("Principal UPN", "principalUpn", textCodec),
    column("Access Type", "accessType", enumCodec(["member", "owner"] as const)),
    column("Assignment Type", "assignmentType", enumCodec(["eligible", "active"] as const)),
    column("Duration Days", "durationDays", daysCodec),
    column("Justification", "justification", textCodec),
    column("Action", "action", enumCodec(["add", "remove"] as const)),
    column("End Date", "endDate", endDateCodec),
];

const OVERVIEW_ASSIGNMENT_COLUMNS: Column[] = [
    column("Workload", "workload", textCodec),
    column("Role or group", "resource", textCodec),
    column("Access", "access", textCodec),
    column("Assignment", "type", textCodec),
    column("Name", "name", textCodec),
    column("UPN or mail", "upn", textCodec),
    column("Object id", "objectId", textCodec),
    column("Principal type", "kind", textCodec),
    column("Member type", "memberType", textCodec),
    column("Start", "start", textCodec),
    column("End", "end", textCodec),
    column("Scope", "scope", textCodec),
    column("Role or group id", "resourceId", textCodec),
    column("Privileged", "privileged", yesNoCodec),
    column("Emergency access", "emergency", yesNoCodec),
    column("Origin", "origin", textCodec),
];

/** The tiles of `buildPolicyView` as readable columns, in a fixed order so the header never depends on the policy */
export const SETTINGS_TILES: ReadonlyArray<readonly [id: string, label: string]> = [
    ["maxDuration", "Maximum activation duration"],
    ["require", "On activation, require"],
    ["justification", "Justification and ticket"],
    ["approval", "Approval"],
    ["approvers", "Approvers"],
    ["extensionBefore", "Custom extension, before approval"],
    ["extensionAfter", "Custom extension, after approval"],
    ["eligible", "Eligible assignments"],
    ["active", "Active assignments"],
    ["activeRequire", "On active assignment, require"],
    ["eligibleAssignment", "Notify on eligible assignment"],
    ["activeAssignment", "Notify on active assignment"],
    ["activation", "Notify on activation"],
];

const tileColumns = (): Column[] => SETTINGS_TILES.map(([id, label]) => column(label, `tile.${id}`, textCodec));

const OVERVIEW_ROLE_SETTINGS_COLUMNS: Column[] = [
    column("Role", "roleName", textCodec),
    column("Role ID", "roleId", textCodec),
    column("Privileged", "privileged", yesNoCodec),
    column("Built-in", "builtIn", yesNoCodec),
    column("Settings", "settings", textCodec),
    ...tileColumns(),
];

const OVERVIEW_GROUP_SETTINGS_COLUMNS: Column[] = [
    column("Group", "groupName", textCodec),
    column("Group ID", "groupId", textCodec),
    column("Group type", "groupType", textCodec),
    column("Role-assignable", "roleAssignable", yesNoCodec),
    column("Access", "access", textCodec),
    column("Settings", "settings", textCodec),
    ...tileColumns(),
];

const named = (prefix: string, extension: string) => (date: string) => `${prefix}-${date}.${extension}`;

export const FILE_SCHEMAS: Record<ExportFileType, FileSchema> = {
    overviewAssignments: { type: "overviewAssignments", fileName: named("pim-overview-assignments", "csv"), columns: OVERVIEW_ASSIGNMENT_COLUMNS },
    overviewRoleSettings: { type: "overviewRoleSettings", fileName: named("pim-overview-role-settings", "csv"), columns: OVERVIEW_ROLE_SETTINGS_COLUMNS },
    overviewGroupSettings: { type: "overviewGroupSettings", fileName: named("pim-overview-group-settings", "csv"), columns: OVERVIEW_GROUP_SETTINGS_COLUMNS },
    bulkRolePolicies: { type: "bulkRolePolicies", fileName: named("pim-bulk-role-policies", "csv"), columns: ROLE_POLICY_COLUMNS },
    bulkGroupPolicies: { type: "bulkGroupPolicies", fileName: named("pim-bulk-group-policies", "csv"), columns: GROUP_POLICY_COLUMNS },
    bulkRoleAssignments: { type: "bulkRoleAssignments", fileName: named("pim-bulk-role-assignments", "csv"), columns: ROLE_ASSIGNMENT_COLUMNS },
    bulkGroupAssignments: { type: "bulkGroupAssignments", fileName: named("pim-bulk-group-assignments", "csv"), columns: GROUP_ASSIGNMENT_COLUMNS },
};

export const BACKUP_FILE_NAME = named("pim-backup", "json");

// --- Write and read ---

/** RFC 4180, CRLF line ends, optional "#" comment rows first, every cell through `escapeCsvCell` (quotes, line breaks and formula defusing) */
export function writeCsv(schema: Pick<FileSchema, "columns">, rows: readonly ExportRow[], { preamble = [] }: { preamble?: readonly string[] } = {}): string {
    // Comment rows above the header (the overview files state the tenant, the filter and who exported); `readCsv` skips them
    const lines = [...preamble.map((line) => escapeCsvCell(line.startsWith("#") ? line : `# ${line}`)), schema.columns.map((c) => escapeCsvCell(c.header)).join(",")];
    for (const row of rows) {
        lines.push(schema.columns.map((c) => escapeCsvCell(c.codec.write(row[c.key]))).join(","));
    }
    return lines.join("\r\n") + "\r\n";
}

export type CsvDelimiter = "," | ";";

/**
 * Brings a file as Excel writes it to the text `readCsv` reads: no BOM, curly quotes straight, the `sep=` hint line
 * taken off (counted in `skippedLines`, so rows keep the numbers of the file) and the delimiter detected from the
 * first row (semicolons win when there are more of them than commas, as European Excel writes).
 */
export function prepareCsvText(text: string): { text: string; delimiter: CsvDelimiter; skippedLines: number } {
    let clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    // Curly double quotes that wrap a cell (Word) are quotes; inside text they stay as typed (I-01: straightening a
    // curly quote in the middle of a cell would open or close a quoted cell there)
    clean = clean.replace(/(^|[\r\n,;])[\u201C\u201D]/g, '$1"').replace(/[\u201C\u201D](?=[,;\r\n]|$)/g, '"');
    let skippedLines = 0;
    const sep = /^sep=[^\r\n]*(\r\n|\n|\r|$)/i.exec(clean);
    if (sep) {
        skippedLines = 1;
        clean = clean.slice(sep[0].length);
    }
    // The first row that is not a comment decides; quoted cells do not count
    const first = clean.split(/\r\n|\n|\r/).find((line) => line.trim() !== "" && !line.trim().startsWith("#")) ?? "";
    let commas = 0;
    let semicolons = 0;
    let quoted = false;
    for (const ch of first) {
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === ",") commas++;
        else if (!quoted && ch === ";") semicolons++;
    }
    return { text: clean, delimiter: semicolons > commas ? ";" : ",", skippedLines };
}

/** One record of the text with the line of the file it starts on (1 is the first line; a line break inside a quoted cell counts) */
export interface CsvRecord {
    cells: string[];
    line: number;
    /** The record ends in a quoted cell that was never closed: the rest of the file was read into that cell */
    unclosedQuote?: boolean;
}

/** Splits RFC 4180 text into records; quoted cells may hold the delimiter, quotes and line breaks */
export function parseCsvRecords(text: string, delimiter: CsvDelimiter = ","): CsvRecord[] {
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const records: CsvRecord[] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    // A quote opens a quoted cell only as the first character of the cell; anywhere else it is text (I-01: 24" screen)
    let atStart = true;
    let line = 1;
    let startLine = 1;
    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        if (ch === "\n" || (ch === "\r" && source[i + 1] !== "\n")) line++;
        if (quoted) {
            if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
            continue;
        }
        const wasStart = atStart;
        atStart = false;
        if (ch === '"' && wasStart) quoted = true;
        else if (ch === delimiter) { row.push(cell); cell = ""; atStart = true; }
        else if (ch === "\r" || ch === "\n") {
            // A CRLF is one line break: the loop skips its LF, so it is counted here
            if (ch === "\r" && source[i + 1] === "\n") { i++; line++; }
            row.push(cell);
            cell = "";
            records.push({ cells: row, line: startLine });
            row = [];
            startLine = line;
            atStart = true;
        } else cell += ch;
    }
    if (cell !== "" || row.length > 0 || quoted) { row.push(cell); records.push({ cells: row, line: startLine, ...(quoted ? { unclosedQuote: true } : {}) }); }
    return records;
}

/** Splits RFC 4180 text into rows of cells */
export function parseCsvText(text: string, delimiter: CsvDelimiter = ","): string[][] {
    return parseCsvRecords(text, delimiter).map((r) => r.cells);
}

/** `escapeCsvCell` puts an apostrophe before = + - @ tab and CR; reading takes it off again */
const unescapeCell = (cell: string): string => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

export interface CsvReadError {
    /** 1 is the header row */
    rowNumber: number;
    header: string;
    message: string;
    /** The cell as it stands in the file */
    value: string;
}

export interface CsvReadResult {
    rows: ExportRow[];
    /** The row of the text each entry of `rows` came from (1 is the first row, comment rows counted) */
    rowNumbers: number[];
    errors: CsvReadError[];
    /** Columns of the schema the file does not have */
    missingColumns: string[];
    /** Columns of the file the schema does not know (ignored) */
    unknownColumns: string[];
}

/** Header names match without case; unknown columns are ignored, missing ones leave the key out */
export function readCsv(schema: FileSchema, text: string, { delimiter = "," }: { delimiter?: CsvDelimiter } = {}): CsvReadResult {
    const isComment = (cells: string[]) => (cells[0] ?? "").trim().startsWith("#");
    // Comment rows (a "#" first cell) and blank rows are not part of the table, above the header or between rows
    const records = parseCsvRecords(text, delimiter).filter((r) => !isComment(r.cells) && r.cells.some((c) => c.trim() !== ""));
    const table = records.map((r) => r.cells);
    const result: CsvReadResult = { rows: [], rowNumbers: [], errors: [], missingColumns: [], unknownColumns: [] };
    if (table.length === 0) return result;
    const index = new Map<string, number>();
    table[0].forEach((header, i) => index.set(header.trim().toLowerCase(), i));
    const known = new Set(schema.columns.map((c) => c.header.toLowerCase()));
    result.missingColumns = schema.columns.filter((c) => !index.has(c.header.toLowerCase())).map((c) => c.header);
    result.unknownColumns = table[0].map((h) => h.trim()).filter((h) => !known.has(h.toLowerCase()));

    for (let r = 1; r < table.length; r++) {
        const cells = table[r];
        if (cells.every((c) => c.trim() === "")) continue;
        const row: ExportRow = {};
        // The number is the line of the file the row starts on (comment and blank lines count)
        const rowNumber = records[r].line;
        if (records[r].unclosedQuote) {
            // Never silent (I-01): the rows after an unclosed quote were read into one cell of this row
            result.errors.push({ rowNumber, header: schema.columns[0]?.header ?? "", message: "A quote in this row is never closed, so the rest of the file was read into one cell. Close or remove the quote.", value: "" });
        }
        for (const col of schema.columns) {
            const at = index.get(col.header.toLowerCase());
            if (at === undefined) continue;
            const cell = unescapeCell(cells[at] ?? "");
            const parsed = col.codec.read(cell);
            if (!parsed.ok) result.errors.push({ rowNumber, header: col.header, message: parsed.error, value: cell.trim() });
            else if (parsed.value !== undefined) row[col.key] = parsed.value;
        }
        result.rows.push(row);
        result.rowNumbers.push(rowNumber);
    }
    return result;
}
