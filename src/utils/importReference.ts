/**
 * The reference of Import (spec 7.1, NG-71): "What can I import?" as data, generated from `FILE_SCHEMAS` so the
 * columns the export writes and the columns the import reads are one list. A column appears in exactly one row; the
 * notes live here, keyed by file type and header, and a test fails when a note names a header that does not exist.
 */
import { durationCodec, endDateCodec, daysCodec, intCodec, approversCodec, textCodec, writeCsv, yesNoCodec, type Column, type ExportRow, type FileSchema } from "@/utils/exportSchema";
import { ACTIVATION_DURATION_OPTIONS, DEFAULT_DURATIONS, EXPIRATION_OPTIONS } from "@/utils/durationUtils";
import { KIND_INFO, type ImportKind } from "@/utils/importDetect";

export interface ReferenceRow {
    /** The header shown in monospace */
    header: string;
    /** Every header of the schema this row stands for (one, or a group such as the nine Enabled columns) */
    headers: string[];
    values: string[];
    note?: string;
}

export type BoxId = "required" | "activation" | "assignment" | "notifications" | "other";

export interface ReferenceBox {
    id: BoxId;
    /** "Required" or "Optional" */
    badge: "Required" | "Optional";
    title: string;
    rows: ReferenceRow[];
    /** "11 columns" */
    countLabel?: string;
}

export interface KindReference {
    kind: ImportKind;
    label: string;
    description: string;
    requiredCount: number;
    boxes: ReferenceBox[];
}

const ACTIVATION_KEYS = new Set([
    "maxActivationDuration", "requireOnActivation", "authContextId", "justificationRequired", "ticketRequired", "approvalRequired", "approvers",
    "preExtensionId", "preExtensionEnabled", "postExtensionId", "postExtensionEnabled",
]);
const ASSIGNMENT_KEYS = new Set(["allowPermanentEligible", "eligibleExpiration", "allowPermanentActive", "activeExpiration", "activeRequiresMfa", "activeRequiresJustification"]);
/** Written for people to read; an import skips them */
const READ_ONLY_KEYS = new Set([
    "description", "builtIn", "privileged", "pimConfigured", "permanentCount", "eligibleCount", "activeCount", "totalAssignments",
    "groupType", "roleAssignable", "eligibleMembers", "eligibleOwners", "activeMembers", "activeOwners",
    "approverNames", "authContextName", "preExtensionName", "postExtensionName",
]);

/** The key of a column without the side of a group file: `member.maxActivationDuration` is `maxActivationDuration` */
const policyKeyOf = (key: string): string => key.replace(/^(member|owner)\./, "");

/** Notes per file type and lower-case header; the only hand-written part of the reference */
export const REFERENCE_NOTES: Record<ImportKind, Record<string, string>> = {
    roleAssignments: {
        "role id": "Which role. Role Name may stand in for it.",
        "role name": "Used when Role ID is empty.",
        "principal id": "Who. Principal UPN may stand in for it, for users only.",
        "principal upn": "Used when Principal ID is empty. Users only.",
        "assignment type": "eligible or active.",
        action: "Empty means add.",
        "scope id": "/ is tenant-wide, /administrativeUnits/{id} one unit, /{id} one application. Empty is tenant-wide.",
        "end date": "ISO 8601 or permanent. Wins over Duration Days.",
        "duration days": "Whole days from now, or permanent. Used when End Date is empty.",
        justification: "Required by the role's policy for active assignments.",
    },
    groupAssignments: {
        "group id": "Which group. Group Name may stand in for it.",
        "group name": "Used when Group ID is empty.",
        "principal id": "Who. Principal UPN may stand in for it, for users only.",
        "principal upn": "Used when Principal ID is empty. Users only.",
        "access type": "member or owner.",
        "assignment type": "eligible or active.",
        action: "Empty means add.",
        "end date": "ISO 8601 or permanent. Wins over Duration Days.",
        "duration days": "Whole days from now, or permanent. Used when End Date is empty.",
        justification: "Required by the group's policy for active assignments.",
    },
    rolePolicies: {
        "role id": "Which role. Role Name may stand in for it.",
        "role name": "Used when Role ID is empty.",
        "max activation duration": "ISO 8601, 1 to 24 hours.",
        "require on activation": "none, mfa or authenticationContext.",
        "auth context id": "The context, with authenticationContext.",
        "justification required": "Asked when someone activates.",
        "approver ids": "Several separated by ;",
        "pre-approval extension id": "Empty keeps the link.",
        "post-approval extension id": "Empty keeps the link.",
        "eligible expiration": "Used when permanent is not allowed.",
        "mfa required": "Older files. Require On Activation wins when both are filled.",
    },
    groupPolicies: {
        "group id": "Which group. Group Name may stand in for it.",
        "group name": "Used when Group ID is empty.",
        "member max duration": "ISO 8601, 1 to 24 hours.",
        "member require on activation": "none, mfa or authenticationContext.",
        "member auth context id": "The context, with authenticationContext.",
        "member approver ids": "Several separated by ;",
        "member pre-approval extension id": "Empty keeps the link.",
        "member post-approval extension id": "Empty keeps the link.",
        "member eligible expiration": "Used when permanent is not allowed.",
        "member mfa": "Older files. Member Require On Activation wins when both are filled.",
        "owner max duration": "ISO 8601, 1 to 24 hours.",
        "owner require on activation": "none, mfa or authenticationContext.",
        "owner auth context id": "The context, with authenticationContext.",
        "owner approver ids": "Several separated by ;",
        "owner pre-approval extension id": "Empty keeps the link.",
        "owner post-approval extension id": "Empty keeps the link.",
        "owner eligible expiration": "Used when permanent is not allowed.",
        "owner mfa": "Older files. Owner Require On Activation wins when both are filled.",
    },
    accessModel: {},
    accessModelChoices: {},
};

const ID_VALUES = ["<UUID>"];
const ACTIVATION_VALUES: string[] = ACTIVATION_DURATION_OPTIONS.map((o) => o.value);
const EXPIRATION_VALUES: string[] = EXPIRATION_OPTIONS.map((o) => o.value);
const EXAMPLES: Record<string, string[]> = {
    "max activation duration": ACTIVATION_VALUES,
    "member max duration": ACTIVATION_VALUES,
    "owner max duration": ACTIVATION_VALUES,
    "eligible expiration": EXPIRATION_VALUES,
    "active expiration": EXPIRATION_VALUES,
    "auth context id": ["c1", "c99"],
    "approver ids": ["user:<UUID>", "group:<UUID>", "manager"],
    "end date": ["2027-04-01", "permanent"],
    "duration days": ["30", "permanent"],
    "principal upn": ["a@contoso.com"],
};

function valuesOf(column: Column): string[] {
    const header = column.header.toLowerCase();
    const side = header.replace(/^(member|owner) /, "");
    if (column.codec.values) return [...column.codec.values];
    if (column.codec === (yesNoCodec as unknown)) return ["Yes", "No"];
    if (EXAMPLES[header]) return EXAMPLES[header];
    if (EXAMPLES[side]) return EXAMPLES[side];
    if (column.codec === (approversCodec as unknown)) return EXAMPLES["approver ids"];
    if (column.codec === (durationCodec as unknown)) return EXAMPLES["max activation duration"];
    if (column.codec === (endDateCodec as unknown)) return EXAMPLES["end date"];
    if (column.codec === (daysCodec as unknown)) return EXAMPLES["duration days"];
    if (column.codec === (intCodec as unknown)) return ["<number>"];
    if (/ id$/.test(header)) return ID_VALUES;
    if (column.codec === (textCodec as unknown)) return ["<any text>"];
    return [];
}

const NOTIFICATION_NOTES: Array<{ field: "isEnabled" | "additionalRecipients" | "criticalOnly"; label: string; values: string[]; note: string }> = [
    { field: "isEnabled", label: "Enabled", values: ["Yes", "No"], note: "One of 9 Enabled columns: Eligible Assignment, Active Assignment and Activation, each for Admin, Assignee or Requestor, and Approver." },
    { field: "additionalRecipients", label: "Recipients", values: ["a@contoso.com;b@contoso.com"], note: "One of 9 Recipients columns, the same pairs. Not for Activation Approver." },
    { field: "criticalOnly", label: "Critical Only", values: ["Yes", "No"], note: "One of 9 Critical Only columns, the same pairs." },
];

const requiredLabels = (kind: ImportKind): Set<string> => new Set(KIND_INFO[kind].required.map((r) => r.label.toLowerCase()));

/** The box a column of a settings or assignment file belongs to */
function boxOf(kind: ImportKind, column: Column): BoxId {
    if (requiredLabels(kind).has(column.header.toLowerCase())) return "required";
    const key = policyKeyOf(column.key);
    if (kind === "roleAssignments" || kind === "groupAssignments") {
        return ["action", "scopeId", "endDate", "durationDays", "justification"].includes(column.key) ? "assignment" : "other";
    }
    if (key.startsWith("n.")) return "notifications";
    if (ACTIVATION_KEYS.has(key)) return "activation";
    if (ASSIGNMENT_KEYS.has(key)) return "assignment";
    return "other";
}

const TITLES: Record<Exclude<BoxId, "required">, string> = { activation: "Activation", assignment: "Assignment", notifications: "Notifications", other: "Other columns" };

/** The reference of one CSV kind; the access model file has its own small table */
export function buildReference(kind: ImportKind): KindReference {
    const info = KIND_INFO[kind];
    const base = { kind, label: info.label, description: info.description, requiredCount: info.required.length };
    if (!info.schema) return { ...base, boxes: accessModelBoxes() };
    const notes = REFERENCE_NOTES[kind];
    const boxes = new Map<BoxId, ReferenceRow[]>();
    const push = (id: BoxId, row: ReferenceRow) => boxes.set(id, [...(boxes.get(id) ?? []), row]);
    const readOnly: string[] = [];
    const isPolicy = kind === "rolePolicies" || kind === "groupPolicies";
    const notificationRows = new Map<string, string[]>();
    for (const column of info.schema.columns) {
        const id = boxOf(kind, column);
        const isNotification = id === "notifications";
        if (isPolicy && READ_ONLY_KEYS.has(policyKeyOf(column.key))) { readOnly.push(column.header); continue; }
        if (isNotification) {
            const field = NOTIFICATION_NOTES.find((n) => column.key.endsWith(`.${n.field}`))!;
            // The first column of each field stands for the nine
            const group = `${column.key.startsWith("member.") ? "member" : column.key.startsWith("owner.") ? "owner" : ""}|${field.field}`;
            notificationRows.set(group, [...(notificationRows.get(group) ?? []), column.header]);
            continue;
        }
        push(id, { header: column.header, headers: [column.header], values: valuesOf(column), note: notes[column.header.toLowerCase()] });
    }
    for (const [group, headers] of notificationRows) {
        const field = NOTIFICATION_NOTES.find((n) => n.field === group.split("|")[1])!;
        const side = group.split("|")[0];
        const note = side ? `${field.note.replace(/^One of 9/, `One of ${headers.length}`)} For the ${side} policy.` : field.note.replace(/^One of 9/, `One of ${headers.length}`);
        push("notifications", { header: headers[0], headers, values: field.values, note });
    }
    if (readOnly.length > 0) push("other", { header: readOnly.join(", "), headers: readOnly, values: ["read only"], note: "Skipped. The export writes them for you to read." });
    const out: ReferenceBox[] = [];
    const required = boxes.get("required");
    if (required) out.push({ id: "required", badge: "Required", title: "Every row needs these", rows: required });
    for (const id of ["activation", "assignment", "notifications", "other"] as const) {
        const rows = boxes.get(id);
        if (!rows) continue;
        const count = rows.reduce((n, r) => n + r.headers.length, 0);
        out.push({ id, badge: "Optional", title: TITLES[id], rows, countLabel: id === "other" ? undefined : `${count} ${count === 1 ? "column" : "columns"}` });
    }
    return { ...base, boxes: out };
}

function accessModelBoxes(): ReferenceBox[] {
    return [
        {
            id: "required", badge: "Required", title: "Every file needs these",
            rows: [
                { header: "schemaVersion", headers: ["schemaVersion"], values: ["1.0.0"], note: "The format of the file." },
                { header: "roles or groups", headers: ["roles", "groups"], values: ["[ ]"], note: "The targets with an expectedConfig." },
            ],
        },
        {
            id: "other", badge: "Optional", title: "expectedConfig",
            rows: [
                { header: "maxActivationDuration", headers: ["maxActivationDuration"], values: ACTIVATION_VALUES, note: "ISO 8601." },
                { header: "requireMFA", headers: ["requireMFA"], values: ["true", "false"], note: "Without authContext: multifactor authentication, or Nothing." },
                { header: "authContext", headers: ["authContext"], values: ["<label>"], note: "A label, matched to a context of the tenant before anything is written." },
                { header: "requireJustification, requireApproval", headers: ["requireJustification", "requireApproval"], values: ["true", "false"] },
                { header: "allowPermanentEligible, allowPermanentActive", headers: ["allowPermanentEligible", "allowPermanentActive"], values: ["true", "false"], note: "A missing field keeps the current value." },
            ],
        },
    ];
}

/** Every column of a schema, exactly once across the rows (the test of the reference) */
export function referencedHeaders(reference: KindReference): string[] {
    return reference.boxes.flatMap((b) => b.rows.flatMap((r) => r.headers));
}

/** The header names a hand-written note may point at */
export function schemaHeaders(kind: ImportKind): string[] {
    return (KIND_INFO[kind].schema as FileSchema | null)?.columns.map((c) => c.header) ?? [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Templates: the headers and one example row

const EXAMPLE_ROWS: Partial<Record<ImportKind, ExportRow>> = {
    roleAssignments: { roleId: "f2ef992c-3afb-46b9-b7cf-a126ee74c451", roleName: "Global Reader", principalUpn: "megan@contoso.com", assignmentType: "eligible", durationDays: "180", justification: "", action: "add", scopeId: "/", endDate: "" },
    groupAssignments: { groupName: "IT Administrators", principalUpn: "megan@contoso.com", accessType: "member", assignmentType: "eligible", durationDays: "180", action: "add" },
    rolePolicies: { roleId: "f2ef992c-3afb-46b9-b7cf-a126ee74c451", roleName: "Global Reader", maxActivationDuration: DEFAULT_DURATIONS.activationDuration, justificationRequired: true, approvalRequired: false },
    groupPolicies: { groupName: "IT Administrators", "member.maxActivationDuration": DEFAULT_DURATIONS.activationDuration, "member.approvalRequired": false, "owner.maxActivationDuration": ACTIVATION_DURATION_OPTIONS[3].value },
};

/** The CSV of "Download the template": the headers the import reads and one example row; read-only columns are left out */
export function buildTemplate(kind: ImportKind): { fileName: string; csv: string } | null {
    const info = KIND_INFO[kind];
    if (!info.schema) return null;
    const isPolicy = kind === "rolePolicies" || kind === "groupPolicies";
    const columns = info.schema.columns.filter((c) => !(isPolicy && READ_ONLY_KEYS.has(policyKeyOf(c.key))));
    return { fileName: info.schema.fileName("template"), csv: writeCsv({ columns }, [EXAMPLE_ROWS[kind] ?? {}]) };
}
