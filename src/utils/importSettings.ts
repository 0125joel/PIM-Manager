/**
 * Import a file, compare settings (spec 7.4, 7.5, NG-72): a settings file (the Report's "For Configure Import" role and
 * group settings) or an access model file is read cell by cell, each filled cell is compared with the policy of its
 * target as read, and every cell that differs becomes one setting change (`source: import`, file, line). An empty cell
 * or a missing column keeps the current value. The changes are built by `planSeveral`, the one planner of Edit
 * (several targets), so the one mapper of NG-54 writes them. Pure.
 */
import { READ_ONLY_POLICY_HEADERS } from "@/utils/importDetect";
import type { BasketSetting, GroupAccess, SettingField } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuthenticationContext, CustomExtensionLink } from "@/types/shared.types";
import { configToSetToValues, type ExpectedConfig, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";
import { findSetting, type Basket } from "@/utils/configureBasket";
import { fieldLabel } from "@/utils/configureReview";
import { describeSettingValue, nowValue, type ValueWords } from "@/utils/configureSettingRows";
import { groupLock, roleLock } from "@/utils/configureTargets";
import { isCustomExtensionLinked, resolveCustomExtensionReference } from "@/utils/customExtensionUtils";
import { parseTotalHours } from "@/utils/durationUtils";
import { NOTIFICATION_KEYS, type CsvReadError, type ExportRow } from "@/utils/exportSchema";
import { activationDurationFromCatalog } from "@/utils/guidedRoute";
import { recipientList, settingValuesEqualFor, type ApproverRef } from "@/utils/policyRules";
import { groupEntry, planSeveral, roleEntry, type EntryLoading, type SeveralDraft, type SeveralEntry } from "@/utils/settingValues";
import type { WriteAccess } from "@/utils/writeAccess";

// ---------------------------------------------------------------------------------------------------------------------
// Results

/** One cell that differs: one row of the table, with the line of the file it came from */
export interface DiffRow {
    key: string;
    /** The line of the CSV, or the number of the entry of an access model file */
    line: number;
    /** "Exchange Administrator", "Helpdesk Tier 1 · Member" */
    target: string;
    setting: string;
    from: string;
    to: string;
    change: BasketSetting;
    /** "Weaker than now" and other things to look at before the review */
    warning?: string;
}

export interface ProblemRow {
    line: number;
    target: string;
    message: string;
    /** fix: the file must change; skipped: this value is left alone; note: said, nothing left alone (a duration brought into range) */
    kind: "fix" | "skipped" | "note";
}

export interface SettingsCompareResult {
    /** "Line" for a CSV, "Entry" for an access model file */
    unit: "Line" | "Entry";
    diffs: DiffRow[];
    problems: ProblemRow[];
    /** Filled cells that differ, and filled cells that already equal the tenant (an empty cell is neither) */
    differs: number;
    matches: number;
    /** Rows (or entries) read */
    rowCount: number;
    /** The head of the target column: "Role", "Group" or "Role or group" */
    targetLabel: "Role" | "Group" | "Role or group";
}

export interface CompareContext {
    fileName: string;
    roles: readonly RoleDetailData[];
    groups: readonly PimGroupData[];
    access: WriteAccess | null;
    tenantName: string;
    loading: EntryLoading;
    words: ValueWords;
    /** The tenant's contexts (ids and names) */
    contexts: readonly AuthenticationContext[];
    /** What Edit and Guided put in the basket: a field already changed there is left alone */
    otherBasket: Basket;
    /** Approver names by lower-case id, for the table (an id without a name shows as the id) */
    names: ReadonlyMap<string, string>;
}

export interface CsvCompareInput extends CompareContext {
    kind: "role" | "group";
    rows: readonly ExportRow[];
    rowNumbers: readonly number[];
    errors: readonly CsvReadError[];
    /** The headers of the file as written: a column that is there with an empty cell is not the same as no column */
    headers: readonly string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Cells to values

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The columns that map one to one onto a field */
const BOOLEAN_CELLS: ReadonlyArray<[key: string, field: SettingField]> = [
    ["justificationRequired", "requireJustificationOnActivation"],
    ["ticketRequired", "requireTicketInfo"],
    ["approvalRequired", "requireApproval"],
    ["allowPermanentEligible", "allowPermanentEligible"],
    ["allowPermanentActive", "allowPermanentActive"],
    ["activeRequiresMfa", "requireMfaOnActiveAssignment"],
    ["activeRequiresJustification", "requireJustificationOnActiveAssignment"],
];
const DURATION_CELLS: ReadonlyArray<[key: string, field: SettingField]> = [["eligibleExpiration", "eligibleExpiration"], ["activeExpiration", "activeExpiration"]];

/** `PT{h}H{m}M` for any ISO duration of days, hours and minutes (`P1D` is `PT24H`, `PT90M` is `PT1H30M`); null for anything else */
export function normaliseActivationDuration(iso: string): string | null {
    const hours = parseTotalHours(iso);
    if (hours === null) return null;
    const minutes = Math.round(hours * 60);
    if (minutes <= 0) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `PT${h > 0 ? `${h}H` : ""}${m > 0 ? `${m}M` : ""}`;
}

export const ACTIVATION_RANGE = "The maximum activation duration must be from 1 to 24 hours.";

interface RowDraft {
    draft: SeveralDraft;
    /** A reason the whole row is withheld */
    problems: string[];
    /** Said in the row, nothing withheld */
    notes: string[];
}

export interface CellSource {
    /** The value of a cell by the key of the schema (`maxActivationDuration`), with the side prefix of a group file taken care of */
    get: (key: string) => unknown;
    has: (key: string) => boolean;
    /** Whether the file has the column (an empty cell has the column but no value) */
    hasColumn: (key: string) => boolean;
}

const NOTIFICATION_KEY = /^n\.(eligibleAssignment|activeAssignment|activation)\.(admin|assignee|requestor|approver)\.(isEnabled|additionalRecipients|criticalOnly)$/;

/** The columns of the file that read as notification cells: `n.{section}.{recipient}.{property}` */
export function notificationFieldOf(key: string): SettingField | null {
    const m = NOTIFICATION_KEY.exec(key);
    return m ? (`notifications.${m[1]}.${m[2]}.${m[3]}` as SettingField) : null;
}

/** The notification keys of the schema that this row fills */
const notificationKeys = (cells: CellSource): string[] => NOTIFICATION_KEYS.filter((k) => cells.has(k));

/**
 * One target's draft from the filled cells of a row. `current` is the policy as read (for the one-choice rule and for
 * what an extension link keeps).
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function draftFromCells(cells: CellSource, entry: SeveralEntry, ctx: CompareContext): RowDraft {
    const draft: SeveralDraft = {};
    const problems: string[] = [];
    const notes: string[] = [];
    const now = (field: SettingField) => nowValue(entry.settings, entry.rules, field);

    // Maximum activation duration: whole and half hours from 1 to 24 once it differs from the tenant's value
    const duration = text(cells.get("maxActivationDuration"));
    if (duration) {
        const normal = normaliseActivationDuration(duration);
        if (!normal) problems.push(`Max Activation Duration ${duration} is not a duration.`);
        else {
            const read = now("maxActivationDuration");
            const hours = parseTotalHours(normal) ?? 0;
            if (read !== undefined && settingValuesEqualFor("maxActivationDuration", read, normal)) draft.maxActivationDuration = normal;
            else if (hours < 1 || hours > 24) problems.push(ACTIVATION_RANGE);
            else draft.maxActivationDuration = normal;
        }
    }

    // One choice for the requirement: Require On Activation wins over the older MFA Required (spec 7.4)
    const on = text(cells.get("requireOnActivation")).toLowerCase();
    const contextCell = text(cells.get("authContextId"));
    const legacyMfa = cells.get("mfaRequired");
    if (on === "none") draft.activationRequirement = { kind: "none" };
    else if (on === "mfa") draft.activationRequirement = { kind: "mfa" };
    else if (on === "authenticationcontext") {
        const found = contextCell ? ctx.contexts.find((c) => c.id.toLowerCase() === contextCell.toLowerCase()) : undefined;
        if (!contextCell) problems.push("Require On Activation is authenticationContext, so Auth Context ID is needed.");
        else if (!found) problems.push(`Authentication context ${contextCell} does not exist in ${ctx.tenantName}.`);
        else draft.activationRequirement = { kind: "authenticationContext", contextId: found.id };
    } else if (typeof legacyMfa === "boolean" && !contextCell) {
        const read = now("activationRequirement") as { kind: string } | undefined;
        // The older column cannot say "no context": No only turns MFA off, it never downgrades a context
        if (legacyMfa) draft.activationRequirement = { kind: "mfa" };
        else if (read?.kind === "mfa") draft.activationRequirement = { kind: "none" };
        else if (read !== undefined) notes.push("MFA Required No keeps the current requirement. Use Require On Activation to change it.");
    }

    for (const [key, field] of BOOLEAN_CELLS) if (typeof cells.get(key) === "boolean") draft[field] = cells.get(key) as boolean;
    for (const [key, field] of DURATION_CELLS) {
        const value = text(cells.get(key));
        if (value) draft[field] = value;
    }

    // Approvers: only the ids count, and only while approval is on after the file
    const approverCell = cells.get("approvers") as Array<{ type: "user" | "group" | "manager"; id: string }> | undefined;
    if (approverCell && approverCell.length > 0) {
        const approval = (draft.requireApproval ?? now("requireApproval")) as boolean | undefined;
        const held = new Set(((now("approvers") as ApproverRef[] | undefined) ?? []).map((a) => a.id.toLowerCase()));
        const known = (id: string) => GUID.test(id.trim()) || held.has(id.toLowerCase()) || ctx.names.has(id.toLowerCase());
        const notGuid = approverCell.filter((a) => a.type !== "manager" && !known(a.id)).map((a) => a.id);
        if (approval === false) notes.push("Approver IDs are ignored while approval is off.");
        // An approver id that is not a GUID can never be written (I-06)
        else if (notGuid.length > 0) problems.push(`Approver IDs: ${notGuid.join(", ")} ${notGuid.length === 1 ? "is not an id" : "are not ids"}. Use the object id of the user or group.`);
        else draft.approvers = approverCell.map((a): ApproverRef => ({ type: a.type, id: a.type === "manager" ? "" : a.id, displayName: a.type === "manager" ? undefined : ctx.names.get(a.id.toLowerCase()) }));
    }

    // Custom extensions: an empty id keeps the link (unlinking is not expressible in a file); Enabled alone changes the flag
    for (const [slot, field] of [["pre", "customExtensions.preApproval"], ["post", "customExtensions.postApproval"]] as const) {
        const read = now(field) as CustomExtensionLink | undefined;
        let idCell = text(cells.get(`${slot}ExtensionId`));
        const nameCell = text(cells.get(`${slot}ExtensionName`));
        // Older files carry only the name of the extension
        if (!idCell && !cells.hasColumn(`${slot}ExtensionId`) && nameCell) {
            const match = resolveCustomExtensionReference(nameCell, ctx.words.extensions);
            if (match) idCell = match.id;
            else problems.push(`Custom extension ${nameCell} was not found in ${ctx.tenantName}.`);
        }
        const enabled = cells.get(`${slot}ExtensionEnabled`);
        if (read === undefined) {
            if (idCell || typeof enabled === "boolean") notes.push(`Not in this policy: custom extension ${slot === "pre" ? "before" : "after"} approval.`);
            continue;
        }
        if (idCell) {
            const match = resolveCustomExtensionReference(idCell, ctx.words.extensions);
            if (ctx.words.extensions && !ctx.words.extensions.some((e) => e.id.toLowerCase() === idCell.toLowerCase())) {
                problems.push(`Custom extension ${idCell} is not in ${ctx.tenantName}.`);
                continue;
            }
            const same = isCustomExtensionLinked(read) && read.customExtensionId.toLowerCase() === idCell.toLowerCase();
            draft[field] = {
                isEnabled: typeof enabled === "boolean" ? enabled : same ? read.isEnabled : true,
                customExtensionId: match?.id ?? idCell,
                customAttributes: same ? [...read.customAttributes] : [],
            } satisfies CustomExtensionLink;
        } else if (typeof enabled === "boolean") {
            if (isCustomExtensionLinked(read)) draft[field] = { ...read, isEnabled: enabled, displayName: undefined };
            else if (enabled) notes.push("An extension switched on without an extension ID is not written.");
        }
    }

    // Notifications: the 27 cells, read from the keys of the schema
    for (const key of notificationKeys(cells)) {
        const field = notificationFieldOf(key) as SettingField;
        const value = cells.get(key);
        if (field.endsWith(".additionalRecipients")) draft[field] = recipientList(typeof value === "string" ? value : "");
        else if (typeof value === "boolean") draft[field] = value;
    }
    return { draft, problems, notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// One target

interface TargetTask {
    entry: SeveralEntry;
    /** The row of the file (or the entry of an access model file) */
    line: number;
    label: string;
    draft: SeveralDraft;
    problems: string[];
    notes: string[];
    lock: string | null;
    /** A requirement of Nothing from the access model on a target that has more now */
    weakerNote?: boolean;
}

function planTask(task: TargetTask, ctx: CompareContext, out: SettingsCompareResult): void {
    const { entry, line, label } = task;
    const problem = (message: string, kind: ProblemRow["kind"] = "fix") => void out.problems.push({ line, target: label, message, kind });
    if (task.problems.length > 0) return problem(task.problems[0]);
    const fields = Object.keys(task.draft) as SettingField[];
    for (const note of task.notes) problem(note, "note");
    if (fields.length === 0) return;
    if (entry.missing === "notUnderPim") return problem(`${entry.name} has no PIM settings yet. They can be changed once it comes under PIM.`, "skipped");
    if (entry.missing === "loading") return problem("The settings of this target are still arriving. Choose the file again in a moment.", "skipped");
    if (entry.missing === "notReadable") return problem(`The settings of ${entry.name} are not readable with your current access, so they are not changed.`, "skipped");
    if (entry.missing === "failed" || !entry.settings) return problem("The settings of this target could not be read.", "fix");

    // A field Edit or Guided already changed is theirs
    const draft: SeveralDraft = {};
    for (const field of fields) {
        if (findSetting(ctx.otherBasket, entry.target, field)) problem(`${fieldLabel(field)}: already in your changes, left alone.`, "skipped");
        else draft[field] = task.draft[field];
    }
    // Approval Off makes the approvers meaningless (the mapper does not write them), and the cells that do not apply are not counted
    const counted = Object.keys(draft).filter((f) => !(draft.requireApproval === false && f === "approvers")) as SettingField[];
    const missingFields = counted.filter((f) => nowValue(entry.settings, entry.rules, f) === undefined);
    if (missingFields.length > 0) problem(`Not in this policy: ${missingFields.map(fieldLabel).join(", ")}.`, "skipped");

    // The basket of Edit counts: a group whose approvers wait there is not "without approvers"
    const plan = planSeveral(draft, [entry], ctx.otherBasket, { from: "import", file: ctx.fileName, line });
    if (plan.problem) return problem(plan.problem, "fix");
    // A target the admin may not change: a row that would write is a fix, a row that equals the tenant is not
    if (task.lock && plan.add.length > 0) return problem(`You cannot change ${entry.name} now. ${task.lock}`);
    const readable = counted.filter((f) => !missingFields.includes(f));
    out.matches += readable.length - plan.add.length;
    out.differs += plan.add.length;
    for (const change of plan.add) {
        out.diffs.push({
            key: `${line}|${JSON.stringify(entry.target)}|${change.field}`,
            line,
            target: label,
            setting: fieldLabel(change.field),
            from: describeSettingValue(change.field, change.from, ctx.words),
            to: describeSettingValue(change.field, change.to, ctx.words),
            change,
            ...(task.weakerNote && change.field === "activationRequirement" && (change.to as { kind: string }).kind === "none" ? { warning: "Weaker than now" } : {}),
        });
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// A settings file

const sideName = (side: GroupAccess) => (side === "owner" ? "Owner" : "Member");

function findRole(roles: readonly RoleDetailData[], id: string, name: string, tenant: string): { role: RoleDetailData } | { error: string } {
    if (id) {
        const found = roles.find((r) => r.definition.id.toLowerCase() === id.toLowerCase()) ?? roles.find((r) => r.definition.templateId?.toLowerCase() === id.toLowerCase());
        return found ? { role: found } : { error: `No role with this ID in ${tenant}.` };
    }
    if (!name) return { error: "Role ID is empty. Give a Role ID, or a Role Name." };
    const matches = roles.filter((r) => r.definition.displayName.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return { role: matches[0] };
    return { error: matches.length === 0 ? `No role named ${name} in ${tenant}.` : `${matches.length} roles are named ${name}. Use the Role ID.` };
}

function findGroup(groups: readonly PimGroupData[], id: string, name: string, tenant: string): { group: PimGroupData } | { error: string } {
    if (id) {
        const found = groups.find((g) => g.group.id.toLowerCase() === id.toLowerCase());
        return found ? { group: found } : { error: `No group with this ID in ${tenant}.` };
    }
    if (!name) return { error: "Group ID is empty. Give a Group ID, or a Group Name." };
    const matches = groups.filter((g) => g.group.displayName.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return { group: matches[0] };
    return { error: matches.length === 0 ? `No group named ${name} in ${tenant}.` : `${matches.length} groups are named ${name}. Use the Group ID.` };
}

const emptyResult = (unit: SettingsCompareResult["unit"], rowCount: number, targetLabel: SettingsCompareResult["targetLabel"]): SettingsCompareResult => ({ unit, diffs: [], problems: [], differs: 0, matches: 0, rowCount, targetLabel });

/** Compares a role or group settings file with the tenant (spec 7.4); one result for the whole file, in the order of the file */
export function compareSettingsRows(input: CsvCompareInput): SettingsCompareResult {
    const out = emptyResult("Line", input.rows.length, input.kind === "role" ? "Role" : "Group");
    const errorsByLine = new Map<number, CsvReadError[]>();
    for (const e of input.errors) errorsByLine.set(e.rowNumber, [...(errorsByLine.get(e.rowNumber) ?? []), e]);
    const headerSet = new Set(input.headers.map((h) => h.trim().toLowerCase()));
    const seen = new Map<string, number>();

    input.rows.forEach((row, i) => {
        const line = input.rowNumbers[i];
        const label = text(input.kind === "role" ? row.roleName : row.groupName) || text(input.kind === "role" ? row.roleId : row.groupId) || (input.kind === "role" ? "No role" : "No group");
        const fail = (message: string) => void out.problems.push({ line, target: label, message, kind: "fix" });
        try {
            // A column the import never reads (Privileged, the counts) cannot fail the row (I-08)
            const cellError = errorsByLine.get(line)?.find((e) => !READ_ONLY_POLICY_HEADERS.has(e.header.trim().toLowerCase()));
            if (cellError) return fail(`${cellError.header}: ${cellError.message}.`);
            if (input.kind === "role") {
                const found = findRole(input.roles, text(row.roleId), text(row.roleName), input.tenantName);
                if ("error" in found) return fail(found.error);
                const { role } = found;
                const key = role.definition.id.toLowerCase();
                if (seen.has(key)) return fail(`${role.definition.displayName} is also on line ${seen.get(key)}. Keep one row per role.`);
                seen.set(key, line);
                const entry = roleEntry(role, input.loading);
                const cells = cellSource(row, "", headerSet);
                const rowDraft = draftFromCells(cells, entry, input);
                planTask({ entry, line, label: role.definition.displayName, ...rowDraft, lock: roleLock(input.access) }, input, out);
                if (rowDraft.draft && Object.keys(rowDraft.draft).length === 0 && rowDraft.problems.length === 0 && row.pimConfigured === false) {
                    out.problems.push({ line, target: role.definition.displayName, message: "This role has no PIM settings in the file (PIM Configured is No).", kind: "skipped" });
                }
                return;
            }
            const found = findGroup(input.groups, text(row.groupId), text(row.groupName), input.tenantName);
            if ("error" in found) return fail(found.error);
            const { group } = found;
            const key = group.group.id.toLowerCase();
            if (seen.has(key)) return fail(`${group.group.displayName} is also on line ${seen.get(key)}. Keep one row per group.`);
            seen.set(key, line);
            for (const side of ["member", "owner"] as const) {
                const entry = groupEntry(group, side, input.loading);
                const rowDraft = draftFromCells(cellSource(row, `${side}.`, headerSet), entry, input);
                planTask({ entry, line, label: `${group.group.displayName} · ${sideName(side)}`, ...rowDraft, lock: groupLock(input.access, group) }, input, out);
            }
        } catch {
            fail("This row could not be read. Check its cells.");
        }
    });
    return out;
}

function cellSource(row: ExportRow, prefix: string, headers: ReadonlySet<string>): CellSource {
    return {
        get: (key) => row[`${prefix}${key}`],
        has: (key) => row[`${prefix}${key}`] !== undefined,
        hasColumn: (key) => [...headers].some((h) => h === headerOfKey(prefix, key)),
    };
}

/** Whether a key of the schema is a column of the file is decided by the header; the two names the reader asks for here are the ID columns */
function headerOfKey(prefix: string, key: string): string {
    const map: Record<string, string> = {
        preExtensionId: "pre-approval extension id",
        postExtensionId: "post-approval extension id",
    };
    const base = map[key] ?? key.toLowerCase();
    return `${prefix === "member." ? "member " : prefix === "owner." ? "owner " : ""}${base}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// An access model file (spec 7.5)

export interface AccessModelContext extends CompareContext {
    /** The label to context matching of 9.3 for the tenant, the admin's choice included; null when not matched */
    resolveContext: (slug: string) => string | null;
    /** The template id of a role (the catalog is keyed by it) */
    templateOf: (roleId: string) => string | undefined;
    /** The place of a group: the admin's, else the proposal; null when not placed */
    placementOf: (groupId: string) => { plane: Plane; securityLevel: SecurityLevel } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readConfig(raw: unknown): ExpectedConfig | null {
    if (!isRecord(raw)) return null;
    const config: ExpectedConfig = {};
    if (typeof raw.maxActivationDuration === "string") config.maxActivationDuration = raw.maxActivationDuration;
    if (typeof raw.requireMFA === "boolean") config.requireMFA = raw.requireMFA;
    if (typeof raw.authContext === "string") config.authContext = raw.authContext;
    if (typeof raw.requireJustification === "boolean") config.requireJustification = raw.requireJustification;
    if (typeof raw.requireApproval === "boolean") config.requireApproval = raw.requireApproval;
    if (typeof raw.allowPermanentEligible === "boolean") config.allowPermanentEligible = raw.allowPermanentEligible;
    if (typeof raw.allowPermanentActive === "boolean") config.allowPermanentActive = raw.allowPermanentActive;
    return Object.keys(config).length > 0 ? config : null;
}

/** `expectedConfig` as a draft: the six fields it can carry, the duration brought into 1 to 24 hours, a label with no context left alone */
function draftFromConfig(config: ExpectedConfig, ctx: AccessModelContext): { draft: SeveralDraft; notes: string[]; unmatched?: string } {
    const result = configToSetToValues(config, ctx.resolveContext);
    const draft: SeveralDraft = {};
    const notes: string[] = [];
    for (const { field, to } of result.values) {
        if (field === "maxActivationDuration" && typeof to === "string") {
            const duration = activationDurationFromCatalog(to);
            if (!duration) continue;
            if (duration.isChanged) notes.push(`${to} is brought to ${duration.value}, the nearest value from 1 to 24 hours.`);
            draft[field] = duration.value;
        } else draft[field] = to;
    }
    return { draft, notes, unmatched: result.unmatchedContext };
}

function configTask(config: ExpectedConfig, entry: SeveralEntry, line: number, label: string, ctx: AccessModelContext, lock: string | null, out: SettingsCompareResult): void {
    const { draft, notes, unmatched } = draftFromConfig(config, ctx);
    if (unmatched) out.problems.push({ line, target: label, message: `The label ${unmatched} has no authentication context in ${ctx.tenantName} yet: the activation requirement stays as it is. Choose a context on the access model page.`, kind: "skipped" });
    for (const note of notes) out.problems.push({ line, target: label, message: note, kind: "note" });
    const read = nowValue(entry.settings, entry.rules, "activationRequirement") as { kind: string } | undefined;
    const weaker = (draft.activationRequirement as { kind: string } | undefined)?.kind === "none" && read !== undefined && read.kind !== "none";
    planTask({ entry, line, label, draft, problems: [], notes: [], lock, weakerNote: weaker }, ctx, out);
}

/**
 * Compares an access model file with the tenant: `roles[]` by template id (else a unique display name), `groups[]` as
 * catalog cells (`plane`, `securityLevel`, `member`, `owner`) for the groups the admin placed there, or entries with a
 * group id or a unique display name. Entries are numbered from 1 in the order of their array.
 */
export function compareAccessModel(json: unknown, ctx: AccessModelContext): SettingsCompareResult {
    const roles = isRecord(json) && Array.isArray(json.roles) ? json.roles : [];
    const groups = isRecord(json) && Array.isArray(json.groups) ? json.groups : [];
    const out = emptyResult("Entry", roles.length + groups.length, roles.length > 0 && groups.length > 0 ? "Role or group" : groups.length > 0 ? "Group" : "Role");
    const seenRoles = new Set<string>();
    const seenGroupSides = new Map<string, number>();

    roles.forEach((raw, i) => {
        const line = i + 1;
        if (!isRecord(raw)) return void out.problems.push({ line, target: `Role ${line}`, message: "This entry is not an object.", kind: "fix" });
        const templateId = text(raw.templateId);
        const displayName = text(raw.displayName);
        const label = displayName || templateId || `Role ${line}`;
        const config = readConfig(raw.expectedConfig);
        let role = templateId ? ctx.roles.find((r) => (ctx.templateOf(r.definition.id) ?? r.definition.id).toLowerCase() === templateId.toLowerCase()) : undefined;
        if (!role && displayName) {
            const named = ctx.roles.filter((r) => r.definition.displayName.toLowerCase() === displayName.toLowerCase());
            if (named.length === 1) role = named[0];
            else if (named.length > 1) return void out.problems.push({ line, target: label, message: `${named.length} roles are named ${displayName}. Give the templateId.`, kind: "fix" });
        }
        if (!role) return void out.problems.push({ line, target: label, message: `No role ${templateId ? `with the template ${templateId}` : `named ${displayName}`} in ${ctx.tenantName}.`, kind: "skipped" });
        if (seenRoles.has(role.definition.id)) return void out.problems.push({ line, target: role.definition.displayName, message: "This role is in the file twice. Keep one entry.", kind: "fix" });
        seenRoles.add(role.definition.id);
        if (!config) return;
        configTask(config, roleEntry(role, ctx.loading), line, role.definition.displayName, ctx, roleLock(ctx.access), out);
    });

    groups.forEach((raw, i) => {
        const line = roles.length + i + 1;
        if (!isRecord(raw)) return void out.problems.push({ line, target: `Group ${i + 1}`, message: "This entry is not an object.", kind: "fix" });
        const plane = text(raw.plane);
        const level = text(raw.securityLevel);
        const bySide: Record<GroupAccess, ExpectedConfig | null> = {
            member: readConfig(raw.member) ?? readConfig(raw.expectedConfig),
            owner: readConfig(raw.owner) ?? readConfig(raw.expectedConfig),
        };
        let targets: PimGroupData[] = [];
        const groupId = text(raw.groupId);
        const displayName = text(raw.displayName);
        if (plane && level) targets = ctx.groups.filter((g) => g.isManaged !== false && ctx.placementOf(g.group.id)?.plane === plane && ctx.placementOf(g.group.id)?.securityLevel === level);
        else if (groupId) targets = ctx.groups.filter((g) => g.group.id.toLowerCase() === groupId.toLowerCase());
        else if (displayName) {
            targets = ctx.groups.filter((g) => g.group.displayName.toLowerCase() === displayName.toLowerCase());
            if (targets.length > 1) return void out.problems.push({ line, target: displayName, message: `${targets.length} groups are named ${displayName}. Give the groupId.`, kind: "fix" });
        }
        if (targets.length === 0) {
            return void out.problems.push({ line, target: displayName || groupId || (plane && level ? `${plane} · ${level}` : "") || `Group ${i + 1}`, message: plane && level ? `No group is placed at ${plane} · ${level} in ${ctx.tenantName}. Place groups on the access model page.` : `No group like this in ${ctx.tenantName}.`, kind: "skipped" });
        }
        for (const group of targets) {
            for (const side of ["member", "owner"] as const) {
                const config = bySide[side];
                if (!config) continue;
                const key = `${group.group.id}|${side}`;
                if (seenGroupSides.has(key)) {
                    out.problems.push({ line, target: `${group.group.displayName} · ${sideName(side)}`, message: `Already set by entry ${seenGroupSides.get(key)}, left alone.`, kind: "skipped" });
                    continue;
                }
                seenGroupSides.set(key, line);
                configTask(config, groupEntry(group, side, ctx.loading), line, `${group.group.displayName} · ${sideName(side)}`, ctx, groupLock(ctx.access, group), out);
            }
        }
    });
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Names of approvers

/** The ids of the approvers a settings file names (users and groups) that `known` has no name for: what the view asks Graph for */
export function approverIdsToLookUp(rows: readonly ExportRow[], known: ReadonlyMap<string, string>): string[] {
    const ids = new Set<string>();
    for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
            if (key !== "approvers" && !key.endsWith(".approvers")) continue;
            for (const a of (value as Array<{ type: string; id: string }>) ?? []) {
                if (a.type !== "manager" && a.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id) && !known.has(a.id.toLowerCase())) ids.add(a.id);
            }
        }
    }
    return [...ids];
}

/** Approver names by lower-case id: the approvers the policies were read with, then the people the app has seen */
export function approverNameIndex(roles: readonly RoleDetailData[], groups: readonly PimGroupData[], people: ReadonlyMap<string, { displayName: string }>): Map<string, string> {
    const names = new Map<string, string>();
    for (const [id, p] of people) names.set(id, p.displayName);
    for (const role of roles) for (const a of role.policy?.approvers ?? []) if (a.id && a.displayName) names.set(a.id.toLowerCase(), a.displayName);
    for (const group of groups) for (const side of ["member", "owner"] as const) for (const a of group.policies?.[side]?.approvers ?? []) if (a.id && a.displayName) names.set(a.id.toLowerCase(), a.displayName);
    return names;
}
