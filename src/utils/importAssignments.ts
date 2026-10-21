/**
 * Import a file, check the rows of an assignment file (spec 7.3, NG-71): every row is resolved against the tenant as the
 * app has read it (role or group, person, scope, end, the policy of the target) and gets one result. The rows that
 * survive become basket changes with source `import`, the file and the line. Pure: the people the app has not seen are
 * looked up by the caller (`neededLookups`, `services/principalLookupService`) and passed in `principals`.
 */
import type { BasketAdd, BasketRemove, BasketUpdate, Change, GroupAccess, PrincipalRef, Target } from "@/types/configure.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { assignmentKey, changeId, EMPTY_BASKET } from "@/utils/configureBasket";
import { describeExpiration, readTargetSettings } from "@/utils/configureSettingRows";
import { groupLock, roleLock } from "@/utils/configureTargets";
import {
    SCHEDULED_NOTE, allowsOnlyNoEnd, buildGroupWhoRows, buildRoleWhoRows, latestEnd, maxEndFrom, policyLimits, supportsAdministrativeUnit, supportsApplication,
    type PolicyLimits, type WhoRow,
} from "@/utils/assignmentForm";
import type { CsvReadError, ExportRow } from "@/utils/exportSchema";
import { getPrincipalKind, toBasicKind } from "@/utils/principalUtils";
import type { WriteAccess } from "@/utils/writeAccess";

// ---------------------------------------------------------------------------------------------------------------------
// The end of a row (moved here from the old parser, which re-exports it)

/**
 * The schedule end of an assignment row to add: End Date wins over Duration Days (the export writes both, End Date is
 * exact); neither means the policy default (undefined endDateTime, not permanent).
 */
/** The longest Duration Days a file may ask for (100 years): beyond it the date is no date */
export const MAX_DURATION_DAYS = 36500;

export function resolveBulkAssignmentEnd(
    row: { durationDays: string; endDate?: string },
    now: Date = new Date(),
): { permanent: boolean; endDateTime?: string } {
    if (row.endDate) {
        return row.endDate === "permanent" ? { permanent: true } : { permanent: false, endDateTime: row.endDate };
    }
    const days = row.durationDays.trim().toLowerCase();
    if (days === "permanent") return { permanent: true };
    const n = parseInt(days, 10);
    return !isNaN(n) && n > 0 && n <= MAX_DURATION_DAYS
        ? { permanent: false, endDateTime: new Date(now.getTime() + n * 86400000).toISOString() }
        : { permanent: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// People

/** Principals by lower-case id and lower-case UPN */
export interface PrincipalIndex {
    byId: ReadonlyMap<string, PrincipalRef>;
    byUpn: ReadonlyMap<string, PrincipalRef>;
}

export const EMPTY_PRINCIPALS: PrincipalIndex = { byId: new Map(), byUpn: new Map() };

type Principalish = { id?: string; "@odata.type"?: string; displayName?: string; userPrincipalName?: string } | null | undefined;

function addPrincipal(index: { byId: Map<string, PrincipalRef>; byUpn: Map<string, PrincipalRef> }, id: string, principal: Principalish): void {
    if (!id || index.byId.has(id.toLowerCase()) || !principal?.displayName) return;
    const kind = toBasicKind(getPrincipalKind(principal));
    const ref: PrincipalRef = {
        id,
        kind: kind === "group" ? "group" : kind === "servicePrincipal" ? "servicePrincipal" : "user",
        displayName: principal.displayName,
        ...(principal.userPrincipalName ? { userPrincipalName: principal.userPrincipalName } : {}),
    };
    index.byId.set(id.toLowerCase(), ref);
    if (ref.userPrincipalName) index.byUpn.set(ref.userPrincipalName.toLowerCase(), ref);
}

/** The people the loaded assignments already name: no Graph call for them */
export function knownPrincipals(roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): PrincipalIndex {
    const index = { byId: new Map<string, PrincipalRef>(), byUpn: new Map<string, PrincipalRef>() };
    for (const role of roles) {
        for (const a of [...role.assignments.eligible, ...role.assignments.active]) addPrincipal(index, a.principalId, a.principal as Principalish);
        for (const a of role.assignments.permanent) addPrincipal(index, a.principalId, (a as { principal?: unknown }).principal as Principalish);
    }
    for (const g of groups) for (const a of g.assignments) addPrincipal(index, a.principalId, a.principal as Principalish);
    return index;
}

/** Merges two indexes; the second wins nothing, the first is kept */
export function mergePrincipals(a: PrincipalIndex, b: PrincipalIndex): PrincipalIndex {
    return { byId: new Map([...b.byId, ...a.byId]), byUpn: new Map([...b.byUpn, ...a.byUpn]) };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids and UPNs of the rows that no loaded assignment names: what the caller asks Graph for */
export function neededLookups(rows: readonly ExportRow[], known: PrincipalIndex): { ids: string[]; upns: string[] } {
    const ids = new Set<string>();
    const upns = new Set<string>();
    for (const row of rows) {
        const id = typeof row.principalId === "string" ? row.principalId.trim() : "";
        const upn = typeof row.principalUpn === "string" ? row.principalUpn.trim() : "";
        if (id) {
            // Graph refuses a whole chunk for one value that is no id: only GUIDs are asked for, the rest stays unknown
            if (GUID.test(id) && !known.byId.has(id.toLowerCase())) ids.add(id);
        } else if (upn && !known.byUpn.has(upn.toLowerCase())) upns.add(upn);
    }
    return { ids: [...ids], upns: [...upns] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The result of a row

export type RowResultKind = "new" | "changesEnd" | "remove" | "alreadyThere" | "notThere" | "duplicate" | "error";

export const RESULT_TEXT: Record<Exclude<RowResultKind, "error" | "duplicate">, string> = {
    new: "New assignment",
    changesEnd: "Changes the end date",
    remove: "Will be removed",
    alreadyThere: "Already there, skipped",
    notThere: "Not there any more, skipped",
};

export type RowFilter = "all" | "new" | "removals" | "skipped" | "fix";

export interface CheckedRow {
    /** The row of the file */
    line: number;
    /** The person: the name when known, else what the file says */
    who: string;
    /** "Add eligible", "Remove active" */
    action: string;
    /** The role or group as the tenant names it, else as the file does */
    target: string;
    /** "Tenant-wide", "Administrative unit: Contoso Benelux", "Member" */
    scope: string;
    /** "Ends 2027-04-01", "No end date" */
    end: string;
    result: RowResultKind;
    /** The sentence of the result column */
    message: string;
    /** A second line under the message (the end date change) */
    detail?: string;
    /** The change this row becomes; null for a skipped row or a row that needs a fix */
    change: Change | null;
}

export const filterOf = (row: CheckedRow): Exclude<RowFilter, "all"> =>
    row.result === "error" ? "fix" : row.result === "remove" ? "removals" : row.result === "new" || row.result === "changesEnd" ? "new" : "skipped";

export function countRows(rows: readonly CheckedRow[]): Record<RowFilter, number> {
    const counts: Record<RowFilter, number> = { all: rows.length, new: 0, removals: 0, skipped: 0, fix: 0 };
    for (const row of rows) counts[filterOf(row)] += 1;
    return counts;
}

export function filterRows(rows: readonly CheckedRow[], filter: RowFilter): CheckedRow[] {
    return filter === "all" ? [...rows] : rows.filter((r) => filterOf(r) === filter);
}

/** Only rows that become a change have a checkbox */
export const isSelectable = (row: CheckedRow): boolean => row.change !== null;

// ---------------------------------------------------------------------------------------------------------------------
// Messages

const FRIENDLY: Record<string, (value: string) => string> = {
    "End Date": (v) => `End Date ${v} is not a date.`,
    "Duration Days": (v) => `Duration Days ${v} is not a number of days or "permanent".`,
    "Assignment Type": (v) => `Assignment Type ${v} is not eligible or active.`,
    "Access Type": (v) => `Access Type ${v} is not member or owner.`,
    Action: (v) => `Action ${v} is not add or remove.`,
};

export function describeCellError(error: Pick<CsvReadError, "header" | "message" | "value">): string {
    return FRIENDLY[error.header]?.(error.value) ?? `${error.header}: ${error.message}.`;
}

const isoDay = (iso: string) => iso.slice(0, 10);
const endText = (end: string | null) => (end ? `Ends ${isoDay(end)}` : "No end date");

// "/", "/administrativeUnits/{id}" or "/{id}"; one id segment, no spaces
const SCOPE_PATTERN = /^\/(?:administrativeUnits\/[^/\s]+|[^/\s]+)?$/;

function normaliseScope(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed === "") return "/";
    const normalised = trimmed.replace(/^\/administrativeunits\//i, "/administrativeUnits/");
    return SCOPE_PATTERN.test(normalised) ? normalised : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The check

export interface AssignmentCheckInput {
    kind: "role" | "group";
    rows: readonly ExportRow[];
    /** The row of the file of each entry of `rows` */
    rowNumbers: readonly number[];
    errors: readonly CsvReadError[];
    /** An older removal file: a row without an Action of its own is a removal */
    isOlderRemoval: boolean;
    fileName: string;
    roles: readonly RoleDetailData[];
    groups: readonly PimGroupData[];
    access: WriteAccess | null;
    principals: PrincipalIndex;
    /** Administrative unit id to name; null when the units are not read (a unit is then not looked up) */
    administrativeUnits: ReadonlyMap<string, string> | null;
    tenantName: string;
    now: Date;
    /** Ids of changes already in the basket that this import did not put there (Edit, Guided): a row for the same assignment is skipped, never replaces them */
    otherChangeIds?: ReadonlySet<string>;
}

interface Resolved {
    target: Target;
    name: string;
    side: GroupAccess | null;
    role?: RoleDetailData;
    group?: PimGroupData;
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function resolveRole(input: AssignmentCheckInput, id: string, name: string): { found: RoleDetailData } | { error: string } {
    if (id) {
        const found = input.roles.find((r) => r.definition.id.toLowerCase() === id.toLowerCase() || r.definition.templateId?.toLowerCase() === id.toLowerCase());
        return found ? { found } : { error: `No role with this ID in ${input.tenantName}.` };
    }
    if (!name) return { error: "Role ID is empty. Give a Role ID, or a Role Name." };
    const matches = input.roles.filter((r) => r.definition.displayName.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return { found: matches[0] };
    return { error: matches.length === 0 ? `No role named ${name} in ${input.tenantName}.` : `${matches.length} roles are named ${name}. Use the Role ID.` };
}

function resolveGroup(input: AssignmentCheckInput, id: string, name: string): { found: PimGroupData } | { error: string } {
    if (id) {
        const found = input.groups.find((g) => g.group.id.toLowerCase() === id.toLowerCase());
        return found ? { found } : { error: `No group with this ID in ${input.tenantName}.` };
    }
    if (!name) return { error: "Group ID is empty. Give a Group ID, or a Group Name." };
    const matches = input.groups.filter((g) => g.group.displayName.toLowerCase() === name.toLowerCase());
    if (matches.length === 1) return { found: matches[0] };
    return { error: matches.length === 0 ? `No group named ${name} in ${input.tenantName}.` : `${matches.length} groups are named ${name}. Use the Group ID.` };
}

/** The row of an existing assignment that counts as "there": not an activation, not through a group, not ended */
const isThere = (r: WhoRow) => !r.isActivated && r.viaGroup === null && r.status !== "expired";

const sameInstant = (a: string | null, b: string | null) => (a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime());

/** One result per row of the file (spec 7.3); rows come back in the order of the file */
export function checkAssignmentRows(input: AssignmentCheckInput): CheckedRow[] {
    const { kind, now } = input;
    // The assignments other changes already touch, whatever their kind (I-02): an import remove never replaces
    // Edit's change of end, and an import end never lands on top of Edit's removal
    const assignmentOf = (id: string) => id.slice(id.indexOf("|") + 1).toLowerCase();
    const otherAssignments = new Set([...(input.otherChangeIds ?? [])].filter((id) => !id.startsWith("setting|")).map(assignmentOf));
    const errorsByLine = new Map<number, CsvReadError[]>();
    for (const e of input.errors) errorsByLine.set(e.rowNumber, [...(errorsByLine.get(e.rowNumber) ?? []), e]);
    const whoRows = new Map<string, WhoRow[]>();
    const whoOf = (resolved: Resolved): WhoRow[] => {
        const key = JSON.stringify(resolved.target);
        let rows = whoRows.get(key);
        if (!rows) {
            const ctx = { basket: EMPTY_BASKET, emergencyAccountIds: new Set<string>(), now };
            rows = resolved.role ? buildRoleWhoRows(resolved.role, input.groups, ctx) : buildGroupWhoRows(resolved.group!, ctx);
            whoRows.set(key, rows);
        }
        return rows;
    };
    const seen = new Map<string, { line: number; action: "add" | "remove" }>();
    const out: CheckedRow[] = [];
    // The assignments of a target by person, scope, type and side: one pass per target, not one search per row
    const indexes = new Map<string, Map<string, WhoRow[]>>();
    const whoIndexOf = (resolved: Resolved): Map<string, WhoRow[]> => {
        const targetKey = JSON.stringify(resolved.target);
        let index = indexes.get(targetKey);
        if (!index) {
            index = new Map();
            for (const r of whoOf(resolved)) {
                if (r.isActivated || r.viaGroup !== null) continue;
                const k = `${r.principal.id.toLowerCase()}|${(r.schedule.scope || "/").toLowerCase()}|${r.type}|${r.access ?? ""}`;
                index.set(k, [...(index.get(k) ?? []), r]);
            }
            indexes.set(targetKey, index);
        }
        return index;
    };

    input.rows.forEach((row, i) => {
        const line = input.rowNumbers[i];
        try {
            checkRow(row, i, line);
        } catch {
            // One odd cell never takes the page down: the row says so
            out.push({ line, who: text(row.principalUpn) || text(row.principalId) || "No person", action: "", target: text(kind === "role" ? row.roleName : row.groupName) || text(kind === "role" ? row.roleId : row.groupId) || "", scope: "", end: "", result: "error", message: "This row could not be read. Check its cells.", change: null });
        }
    });
    return out;

    function checkRow(row: ExportRow, _i: number, line: number): void {
        void _i;
        const cellErrors = errorsByLine.get(line) ?? [];
        const idText = text(kind === "role" ? row.roleId : row.groupId);
        const nameText = text(kind === "role" ? row.roleName : row.groupName);
        const principalId = text(row.principalId);
        const upn = text(row.principalUpn);
        const typeCell = text(row.assignmentType);
        const type = typeCell === "eligible" || typeCell === "active" ? typeCell : null;
        const rawAction = text(row.action);
        const action: "add" | "remove" = rawAction === "remove" || rawAction === "add" ? rawAction : input.isOlderRemoval ? "remove" : "add";
        const side: GroupAccess | null = kind === "group" ? (text(row.accessType) === "owner" ? "owner" : text(row.accessType) === "member" ? "member" : null) : null;
        const principalKnown = principalId ? input.principals.byId.get(principalId.toLowerCase()) : upn ? input.principals.byUpn.get(upn.toLowerCase()) : undefined;
        const base: CheckedRow = {
            line,
            who: principalKnown?.displayName ?? (upn || principalId || "No person"),
            action: `${action === "add" ? "Add" : "Remove"} ${type ?? ""}`.trim(),
            target: nameText || idText || (kind === "role" ? "No role" : "No group"),
            scope: kind === "group" ? (side === "owner" ? "Owner" : side === "member" ? "Member" : "") : "Tenant-wide",
            end: "",
            result: "error",
            message: "",
            change: null,
        };
        const fail = (message: string, patch: Partial<CheckedRow> = {}): void => void out.push({ ...base, ...patch, result: "error", message, change: null });

        // Cells the codecs refused (an End Date of a removal does not matter)
        const relevant = cellErrors.filter((e) => !(action === "remove" && (e.header === "End Date" || e.header === "Duration Days")));
        if (relevant.length > 0) return fail(describeCellError(relevant[0]));

        let resolved: Resolved;
        if (kind === "role") {
            const r = resolveRole(input, idText, nameText);
            if ("error" in r) return fail(r.error);
            resolved = { target: { kind: "role", id: r.found.definition.id }, name: r.found.definition.displayName, side: null, role: r.found };
        } else {
            const g = resolveGroup(input, idText, nameText);
            if ("error" in g) return fail(g.error);
            resolved = { target: { kind: "group", id: g.found.group.id, access: side ?? "member" }, name: g.found.group.displayName, side, group: g.found };
        }
        base.target = resolved.name;

        if (!type) return fail(typeCell === "" ? "Assignment Type is empty. Use eligible or active." : "Assignment Type is not eligible or active.");
        if (kind === "group" && !side) return fail("Access Type is empty. Use member or owner.");

        const lock = resolved.role ? roleLock(input.access) : groupLock(input.access, resolved.group!);
        if (lock) return fail(`You cannot change ${resolved.name} now. ${lock}`);

        if (!principalId && !upn) return fail("Principal ID and Principal UPN are both empty. Give one of them.");
        if (!principalKnown) return fail(principalId ? `Nobody with this ID in ${input.tenantName}.` : `Nobody with this UPN in ${input.tenantName}.`);
        const principal = principalKnown;
        base.who = principal.displayName;

        // Scope (roles): the shape here, whether the role supports it only for a row that adds (what is there proves it)
        let scope = "/";
        let scopeProblem: string | null = null;
        if (resolved.role) {
            const normal = normaliseScope(text(row.scopeId));
            if (normal === null) return fail(`Scope ID ${text(row.scopeId)} is not "/", "/administrativeUnits/{id}" or "/{id}".`);
            scope = normal;
            const unitId = scope.startsWith("/administrativeUnits/") ? scope.slice("/administrativeUnits/".length) : null;
            if (unitId) {
                const known = input.administrativeUnits;
                if (!supportsAdministrativeUnit(resolved.role.definition)) scopeProblem = `${resolved.name} cannot be limited to an administrative unit.`;
                else if (known && !known.has(unitId.toLowerCase())) scopeProblem = `No administrative unit with this ID in ${input.tenantName}.`;
                base.scope = `Administrative unit: ${known?.get(unitId.toLowerCase()) ?? unitId}`;
            } else if (scope !== "/") {
                if (!supportsApplication(resolved.role.definition)) scopeProblem = `${resolved.name} cannot be limited to one application.`;
                base.scope = `One object: ${scope.slice(1)}`;
            }
        }

        // The same assignment twice in the file, or asked for and against
        const key = assignmentKey(resolved.target, principal.id, scope.toLowerCase(), type);
        const first = seen.get(key);
        if (first !== undefined) {
            if (first.action === action) return void out.push({ ...base, end: "", result: "duplicate", message: `Same as line ${first.line}, skipped`, change: null });
            return fail(`Line ${first.line} asks the opposite for the same assignment. Keep one of the two rows.`);
        }
        seen.set(key, { line, action });

        const source = { from: "import" as const, file: input.fileName, line };
        const held = whoIndexOf(resolved).get(`${principal.id.toLowerCase()}|${scope.toLowerCase()}|${type}|${resolved.side ?? ""}`) ?? [];
        const existing = held.find(isThere);
        const ended = held.find((r) => r.status === "expired");
        // A change that is already in the basket from Edit or Guided is never replaced from here
        const inBasket = (change: Change): boolean => otherAssignments.has(assignmentOf(changeId(change)));
        const skipForBasket = (): void => void out.push({ ...base, result: "duplicate", message: "Already in your changes, skipped", change: null });

        if (action === "remove") {
            base.end = existing ? endText(existing.schedule.end) : "";
            if (!existing) return void out.push({ ...base, result: "notThere", message: RESULT_TEXT.notThere, change: null });
            if (existing.isScheduled) return fail(SCHEDULED_NOTE);
            const change: BasketRemove = { kind: "remove", target: resolved.target, schedule: existing.schedule, source };
            if (inBasket(change)) return skipForBasket();
            return void out.push({ ...base, result: "remove", message: RESULT_TEXT.remove, change });
        }

        // Add: the end, from End Date, Duration Days or the policy
        const settings = resolved.role
            ? readTargetSettings(resolved.role.policy?.details?.rules)
            : readTargetSettings(resolved.group!.policies?.[resolved.side ?? "member"]?.rules);
        const limits: PolicyLimits = policyLimits(settings, type);
        const endCell = text(row.endDate);
        const daysCell = text(row.durationDays);
        const isBlank = endCell === "" && daysCell === "";
        // An empty End Date and Duration Days keep what is there (spec 7.1); a new assignment gets the policy maximum, shown
        if (isBlank && existing) {
            base.end = endText(existing.schedule.end);
            return void out.push({ ...base, result: "alreadyThere", message: RESULT_TEXT.alreadyThere, change: null });
        }
        let end: string | null;
        let isDefault = false;
        if (isBlank) {
            isDefault = true;
            if (limits.maxDuration === null && limits.permanentAllowed === null) return fail(`The ${resolved.name} policy is not known yet, so no end can be chosen. Give an End Date.`);
            end = maxEndFrom(limits, now)?.toISOString() ?? null;
        } else if (endCell === "permanent" || daysCell.toLowerCase() === "permanent" && endCell === "") {
            end = null;
        } else if (endCell !== "") {
            end = new Date(Date.parse(endCell)).toISOString();
        } else {
            const days = Number(daysCell);
            if (!Number.isInteger(days) || days < 1 || days > MAX_DURATION_DAYS) return fail(`Duration Days ${daysCell} is not a number from 1 to ${MAX_DURATION_DAYS}, or "permanent".`);
            end = resolveBulkAssignmentEnd({ durationDays: daysCell }, now).endDateTime ?? null;
        }
        base.end = endText(end) + (isDefault && end ? " (policy maximum)" : "");
        // What is there already is never held against the policy of today: only a row that writes is checked
        if (existing && sameInstant(end, existing.schedule.end)) return void out.push({ ...base, result: "alreadyThere", message: RESULT_TEXT.alreadyThere, change: null });
        // An assignment that has ended and is written with its own end date (the export does) is a record of the past
        if (!existing && ended && sameInstant(end, ended.schedule.end)) return void out.push({ ...base, result: "alreadyThere", message: RESULT_TEXT.alreadyThere, detail: "It has ended", change: null });
        if (!existing && scopeProblem) return fail(scopeProblem);
        if (end && new Date(end).getTime() <= now.getTime()) return fail(`End Date ${isoDay(end)} is in the past.`);
        if (end === null && limits.permanentAllowed === false) return fail(`Permanent ${type} is not allowed by the ${resolved.name} policy. Give an End Date.`);
        if (end !== null && allowsOnlyNoEnd(limits)) return fail(`The ${resolved.name} policy allows only ${type} assignments without an end date. Leave End Date and Duration Days empty or write "permanent".`);
        const cap = latestEnd(limits, now);
        if (end && cap && new Date(end).getTime() > cap.getTime() + 86_400_000) {
            return fail(`The ${resolved.name} policy allows ${type} assignments for at most ${describeExpiration(limits.maxDuration ?? undefined).toLowerCase()}. Give an earlier End Date.`);
        }
        const justification = text(row.justification);
        if (limits.justificationRequired && !justification) return fail(`The ${resolved.name} policy requires a justification for active assignments.`);

        if (existing) {
            if (existing.isScheduled) return fail(SCHEDULED_NOTE);
            const change: BasketUpdate = { kind: "update", target: resolved.target, schedule: existing.schedule, end, action: "adminUpdate", ...(justification ? { justification } : {}), source };
            if (inBasket(change)) return skipForBasket();
            return void out.push({ ...base, result: "changesEnd", message: RESULT_TEXT.changesEnd, detail: `${endText(existing.schedule.end)}, then ${endText(end).toLowerCase()}`, change });
        }
        const change: BasketAdd = { kind: "add", target: resolved.target, principal, type, scope, start: null, end, justification, source };
        if (inBasket(change)) return skipForBasket();
        out.push({ ...base, result: "new", message: RESULT_TEXT.new, change });
    }
}

/** The changes of the checked rows, in the order of the file */
export function changesOfRows(rows: readonly CheckedRow[], unchecked: ReadonlySet<number>): Change[] {
    return rows.filter((r) => r.change && !unchecked.has(r.line)).map((r) => r.change as Change);
}
