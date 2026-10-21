/**
 * Import a file, step one (spec 7.2, NG-71): what a file is, from its columns. The four bulk files of the Report export
 * are told apart over `FILE_SCHEMAS` (so a new column is added in one place), plus the two older removal files of
 * today's Bulk and the access model JSON. Pure; `readImportFile` is what the Import view calls.
 */
import { isAccessModelFile } from "@/utils/accessModelFile";
import { FILE_SCHEMAS, parseCsvText, prepareCsvText, readCsv, type CsvDelimiter, type CsvReadResult, type FileSchema } from "@/utils/exportSchema";

export type ImportKind = "roleAssignments" | "groupAssignments" | "rolePolicies" | "groupPolicies" | "accessModel" | "accessModelChoices";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** One required entry: present when any of its headers is. "Role ID" is also met by "Role Name" */
export interface RequiredColumn {
    label: string;
    headers: string[];
}

export interface KindInfo {
    kind: ImportKind;
    /** "Role assignments" */
    label: string;
    description: string;
    schema: FileSchema | null;
    required: RequiredColumn[];
}

const one = (label: string, ...alternatives: string[]): RequiredColumn => ({ label, headers: [label, ...alternatives] });

export const KIND_INFO: Record<ImportKind, KindInfo> = {
    roleAssignments: {
        kind: "roleAssignments",
        label: "Role assignments",
        description: "Add or remove eligible and active role assignments.",
        schema: FILE_SCHEMAS.bulkRoleAssignments,
        required: [one("Role ID", "Role Name"), one("Principal ID", "Principal UPN"), one("Assignment Type")],
    },
    groupAssignments: {
        kind: "groupAssignments",
        label: "Group assignments",
        description: "Add or remove eligible and active members and owners of groups.",
        schema: FILE_SCHEMAS.bulkGroupAssignments,
        required: [one("Group ID", "Group Name"), one("Principal ID", "Principal UPN"), one("Access Type"), one("Assignment Type")],
    },
    rolePolicies: {
        kind: "rolePolicies",
        label: "Role settings",
        description: "Activation, assignment and notification settings per role. An empty cell keeps the current value.",
        schema: FILE_SCHEMAS.bulkRolePolicies,
        required: [one("Role ID", "Role Name")],
    },
    groupPolicies: {
        kind: "groupPolicies",
        label: "Group settings",
        description: "The same settings per group, once for Member and once for Owner.",
        schema: FILE_SCHEMAS.bulkGroupPolicies,
        required: [one("Group ID", "Group Name")],
    },
    accessModel: {
        kind: "accessModel",
        label: "Access model file",
        description: "An AccessModel JSON from PIM Monitor: its expectedConfig becomes changes for the roles it lists.",
        schema: null,
        required: [{ label: "schemaVersion", headers: ["schemaVersion"] }, { label: "roles or groups", headers: ["roles", "groups"] }],
    },
    accessModelChoices: {
        kind: "accessModelChoices",
        label: "Access model choices",
        description: "The label and group choices of a PIM Manager access model file. They are kept in this browser; nothing is written to the tenant.",
        schema: null,
        required: [{ label: "format", headers: ["format"] }],
    },
};

export const IMPORT_KINDS: readonly ImportKind[] = ["roleAssignments", "groupAssignments", "rolePolicies", "groupPolicies", "accessModel", "accessModelChoices"];

/** The kinds the "Not right? Read it as" select offers for a CSV */
export const CSV_KINDS: readonly ImportKind[] = ["roleAssignments", "groupAssignments", "rolePolicies", "groupPolicies"];

/** Read-only columns of the settings files: the export writes them for people, an import never writes them */
export const READ_ONLY_POLICY_HEADERS = new Set(["description", "built-in", "privileged", "pim configured", "permanent count", "eligible count", "active count", "total assignments",
    "group type", "role-assignable", "eligible members", "eligible owners", "active members", "active owners",
    "approvers", "auth context", "member approvers", "member auth context", "owner approvers", "owner auth context"]);

export interface ChipState {
    label: string;
    present: boolean;
}

export interface SkippedColumn {
    header: string;
    reason: "readOnly" | "unknown";
}

export interface DetectedFile {
    kind: ImportKind | null;
    /** An older removal file of today's Bulk: every row without an Action of its own is a removal */
    isOlderRemoval: boolean;
    /** The columns that decided it, as written in the file */
    decidedBy: string[];
    required: ChipState[];
    alsoRead: string[];
    skipped: SkippedColumn[];
    /** Why nothing was recognised, or what to know about it */
    problem?: string;
}

const lower = (headers: readonly string[]) => new Set(headers.map((h) => h.trim().toLowerCase()));

/** The non-key policy headers of a settings schema: the file is a settings file when it has one of them */
const policyHeaders = (schema: FileSchema, keys: readonly string[]): Set<string> =>
    new Set(schema.columns.map((c) => c.header.toLowerCase()).filter((h) => !keys.includes(h) && !READ_ONLY_POLICY_HEADERS.has(h)));

const ROLE_POLICY_HEADERS = policyHeaders(FILE_SCHEMAS.bulkRolePolicies, ["role id", "role name"]);
const GROUP_POLICY_HEADERS = policyHeaders(FILE_SCHEMAS.bulkGroupPolicies, ["group id", "group name"]);

const OVERVIEW_PROBLEM = "This is an overview file, made for reading. Export \"For Configure Import\" from the Report to get a file that can be imported.";

/** What kind of CSV the headers say it is, or null with a problem (spec 7.2) */
export function detectCsvKind(headers: readonly string[]): { kind: ImportKind | null; problem?: string } {
    const set = lower(headers);
    const has = (h: string) => set.has(h);
    const hasRole = has("role id") || has("role name");
    const hasGroup = has("group id") || has("group name");
    const hasPrincipal = has("principal id") || has("principal upn");
    if (has("workload") && has("role or group")) return { kind: null, problem: OVERVIEW_PROBLEM };
    if (has("settings") && (has("role") || has("group")) && !hasRole && !hasGroup) return { kind: null, problem: OVERVIEW_PROBLEM };
    if (has("assignment type") && hasPrincipal) {
        if (hasGroup && (has("access type") || !hasRole)) return { kind: "groupAssignments" };
        if (hasRole) return { kind: "roleAssignments" };
    }
    if (hasRole && [...ROLE_POLICY_HEADERS].some(has)) return { kind: "rolePolicies" };
    if (hasGroup && [...GROUP_POLICY_HEADERS].some(has)) return { kind: "groupPolicies" };
    return { kind: null, problem: "PIM Manager does not recognise these columns. Use a file the Report exports as \"For Configure Import\", or choose Other file to see what an import file looks like and to download a template." };
}

/** An older removal file: Action is there, Duration Days, End Date and Justification are not (today's removal templates) */
export function isOlderRemovalFile(headers: readonly string[]): boolean {
    const set = lower(headers);
    return set.has("action") && !set.has("duration days") && !set.has("end date") && !set.has("justification");
}

/** The chips of a CSV read as `kind`: Required (present or not), Also read, Skipped */
export function describeColumns(kind: ImportKind, headers: readonly string[]): Pick<DetectedFile, "required" | "alsoRead" | "skipped" | "decidedBy"> {
    const info = KIND_INFO[kind];
    const present = lower(headers);
    const asWritten = new Map(headers.map((h) => [h.trim().toLowerCase(), h.trim()] as const));
    const required = info.required.map((r) => ({ label: r.label, present: r.headers.some((h) => present.has(h.toLowerCase())) }));
    const requiredHeaders = new Set(info.required.flatMap((r) => r.headers.map((h) => h.toLowerCase())));
    const primary = new Set(info.required.map((r) => r.label.toLowerCase()));
    const known = new Set((info.schema?.columns ?? []).map((c) => c.header.toLowerCase()));
    const isPolicy = kind === "rolePolicies" || kind === "groupPolicies";
    const alsoRead: string[] = [];
    const skipped: SkippedColumn[] = [];
    const seen = new Set<string>();
    for (const header of headers.map((h) => h.trim()).filter(Boolean)) {
        const key = header.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (requiredHeaders.has(key)) {
            // The required column itself is in the Required chips; a fallback (Role Name next to Role ID) is also read
            if (!primary.has(key)) alsoRead.push(header);
            continue;
        }
        if (!known.has(key)) skipped.push({ header, reason: "unknown" });
        else if (isPolicy && READ_ONLY_POLICY_HEADERS.has(key)) skipped.push({ header, reason: "readOnly" });
        else alsoRead.push(header);
    }
    const decidedBy = info.required.map((r) => r.headers.map((h) => asWritten.get(h.toLowerCase())).find((h): h is string => !!h)).filter((h): h is string => !!h);
    return { required, alsoRead, skipped, decidedBy };
}

/** The rows of a CSV file of one kind, with the numbers of the file (a `sep=` line counts) */
export interface ReadCsvFile extends CsvReadResult {
    delimiter: CsvDelimiter;
    headers: string[];
}

export interface ImportFile {
    fileName: string;
    detected: DetectedFile;
    /** What the select says now: the detection, or the admin's own choice */
    kind: ImportKind | null;
    wasChosen: boolean;
    csv: ReadCsvFile | null;
    /** The parsed JSON of an access model file */
    json: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A PIM Manager backup also has schemaVersion and roles; its app name and export time tell it apart */
function isBackup(json: Record<string, unknown>): boolean {
    return isRecord(json.app) && json.app.name === "PIM Manager" && typeof json.exportedAt === "string";
}

function detectJson(json: unknown): DetectedFile {
    const empty: DetectedFile = { kind: null, isOlderRemoval: false, decidedBy: [], required: [], alsoRead: [], skipped: [] };
    if (!isRecord(json)) return { ...empty, problem: "PIM Manager does not recognise this JSON. An access model file has a schemaVersion and roles or groups." };
    if (isAccessModelFile(json)) {
        return { kind: "accessModelChoices", isOlderRemoval: false, decidedBy: ["format"], required: [{ label: "format", present: true }], alsoRead: [], skipped: [] };
    }
    if (isBackup(json)) return { ...empty, problem: "This is a PIM Manager backup. Undo restores from Last applies; a backup cannot be imported yet." };
    const hasVersion = json.schemaVersion !== undefined;
    const hasTargets = Array.isArray(json.roles) || Array.isArray(json.groups) || isRecord(json.roles) || isRecord(json.groups);
    if (!hasVersion || !hasTargets) return { ...empty, problem: "PIM Manager does not recognise this JSON. An access model file has a schemaVersion and roles or groups." };
    return {
        kind: "accessModel",
        isOlderRemoval: false,
        decidedBy: ["schemaVersion", Array.isArray(json.roles) || isRecord(json.roles) ? "roles" : "groups"],
        required: [{ label: "schemaVersion", present: true }, { label: "roles or groups", present: true }],
        alsoRead: Object.keys(json).filter((k) => !["schemaVersion", "roles", "groups"].includes(k)),
        skipped: [],
    };
}

/** The first row of the file that is not a comment, with its cells */
function headerOf(text: string, delimiter: CsvDelimiter): string[] {
    const row = parseCsvText(text, delimiter).find((cells) => !(cells[0] ?? "").trim().startsWith("#") && cells.some((c) => c.trim() !== ""));
    return (row ?? []).map((h) => h.trim());
}

/**
 * Reads a file the admin chose. `chosenKind` is the "Read it as" select: it replaces the detection (and the chips follow
 * it). A JSON file is parsed; a CSV is read through `readCsv` of the kind's schema, so every column the export writes
 * is read.
 */
export function readImportFile(text: string, fileName: string, chosenKind?: ImportKind | null): ImportFile {
    const trimmed = text.replace(/^﻿/, "").trimStart();
    const isJson = /\.json$/i.test(fileName) || trimmed.startsWith("{") || trimmed.startsWith("[");
    if (isJson) {
        let json: unknown = null;
        let parseError = false;
        try {
            json = JSON.parse(text.replace(/^﻿/, ""));
        } catch {
            parseError = true;
        }
        const detected: DetectedFile = parseError
            ? { kind: null, isOlderRemoval: false, decidedBy: [], required: [], alsoRead: [], skipped: [], problem: "This file is not valid JSON." }
            : detectJson(json);
        return { fileName, detected, kind: detected.kind, wasChosen: false, csv: null, json };
    }
    const prepared = prepareCsvText(text);
    const headers = headerOf(prepared.text, prepared.delimiter);
    if (headers.length === 0) {
        return { fileName, detected: { kind: null, isOlderRemoval: false, decidedBy: [], required: [], alsoRead: [], skipped: [], problem: "The file is empty." }, kind: null, wasChosen: false, csv: null, json: null };
    }
    const auto = detectCsvKind(headers);
    const kind = chosenKind && CSV_KINDS.includes(chosenKind) ? chosenKind : auto.kind;
    if (!kind) {
        return { fileName, detected: { kind: null, isOlderRemoval: false, decidedBy: [], required: [], alsoRead: [], skipped: [], problem: auto.problem }, kind: null, wasChosen: false, csv: null, json: null };
    }
    const info = KIND_INFO[kind];
    const result = readCsv(info.schema as FileSchema, prepared.text, { delimiter: prepared.delimiter });
    const csv: ReadCsvFile = {
        ...result,
        rowNumbers: result.rowNumbers.map((n) => n + prepared.skippedLines),
        errors: result.errors.map((e) => ({ ...e, rowNumber: e.rowNumber + prepared.skippedLines })),
        delimiter: prepared.delimiter,
        headers,
    };
    const isAssignments = kind === "roleAssignments" || kind === "groupAssignments";
    const columns = describeColumns(kind, headers);
    const detected: DetectedFile = {
        kind: auto.kind,
        // Only when no row asks for an add (I-04): a hand-made file with "add" on some rows and empty Action cells on
        // others is read as the reference says, empty means add; a file without any add stays an older removal file
        isOlderRemoval: isAssignments && isOlderRemovalFile(headers)
            && !result.rows.some((r) => String(r.action ?? "").trim().toLowerCase() === "add"),
        ...columns,
    };
    return { fileName, detected, kind, wasChosen: !!chosenKind && chosenKind !== auto.kind, csv, json: null };
}

/** "Role assignments" or "Role assignments (older removal file)" */
export function describeKind(file: Pick<ImportFile, "kind" | "detected">): string {
    if (!file.kind) return "Not recognised";
    const label = KIND_INFO[file.kind].label;
    return file.detected.isOlderRemoval && (file.kind === "roleAssignments" || file.kind === "groupAssignments") ? `${label} (older removal file)` : label;
}

/** "Recognised from Role ID, Principal UPN and Assignment Type." */
export function describeDecidedBy(decidedBy: readonly string[]): string {
    if (decidedBy.length === 0) return "";
    if (decidedBy.length === 1) return `Recognised from ${decidedBy[0]}.`;
    return `Recognised from ${decidedBy.slice(0, -1).join(", ")} and ${decidedBy[decidedBy.length - 1]}.`;
}

export const tooBigMessage = (bytes: number) => `This file is ${(bytes / (1024 * 1024)).toFixed(1)} MB. The limit is 5 MB.`;
