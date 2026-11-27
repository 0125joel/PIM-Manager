/**
 * Turns raw ARM request rows and Activity Log rows into audit events for the Azure Audit page (AU-10).
 * Pure: no ARM, no state. Only the fields named in the raw types are read; everything else in a row is dropped.
 */
import type { AuditActor, AuditEvent, AuditKind, AuditResult, RawActivityEvent, RawArmRequest, RawDirectoryAudit } from "@/types/audit.types";
import { wholeMinutes } from "@/utils/auditEvents";
import { accessOfEvent, groupNameOfEvent } from "@/utils/auditNoActivation";
import { parseTotalHours } from "@/utils/durationUtils";
import { levelFromScopeId } from "@/utils/azureScopes";
import { isGuestUpn } from "@/utils/holderKinds";
import type { PrincipalKind } from "@/utils/principalUtils";

export const MS_PIM_APP_ID = "01fc33a7-78ba-4d2f-a4b7-768e336e890e";

export interface AzureAuditContext {
    /** A display name, or undefined when not known */
    scopeName(scopeId: string): string | undefined;
    roleName(roleGuid: string): string | undefined;
    principalName(id: string): string | undefined;
    /** The type and sign-in name the assignments know for a principal id, when they know it */
    principal?(id: string): { type?: string; upn?: string } | undefined;
    /** The object id of a principal by its sign-in name, without case: the Activity Log names a caller by it */
    principalIdOfUpn?(upn: string): string | undefined;
    /** The display name the requests of this read give for a sign-in name; filled by the mapper */
    callerNameOfUpn?(upn: string): string | undefined;
    /** The eligibility schedules a request can link to: id (full path), the principal, its type and name */
    eligibilities: readonly { id: string; principalId: string; principalType: string; principalName: string }[];
}

export interface AzureAuditInput {
    assignmentRequests: readonly RawArmRequest[];
    eligibilityRequests: readonly RawArmRequest[];
    activity: readonly RawActivityEvent[];
    context: AzureAuditContext;
}

export interface GroupHolding { groupId: string; roleId: string; roleName: string; scopeId: string }

const MINUTE_MS = 60_000;
/** A request and the write or delete it caused are one action within this window (rule 7) */
const LINK_WINDOW_MS = 10 * MINUTE_MS;

const AUTHORIZATION = "/providers/microsoft.authorization/";
const OP_ASSIGNMENT_WRITE = "microsoft.authorization/roleassignments/write";
const OP_ASSIGNMENT_DELETE = "microsoft.authorization/roleassignments/delete";
const OP_POLICY_WRITE = "microsoft.authorization/rolemanagementpolicies/write";
const OP_DEFINITION_WRITE = "microsoft.authorization/roledefinitions/write";
const OP_DEFINITION_DELETE = "microsoft.authorization/roledefinitions/delete";
/** The write of one stage of an approval: its caller is the approver (measured) */
const OP_APPROVAL_STAGE_WRITE = "microsoft.authorization/roleassignmentapprovals/stages/write";
const APPROVAL_STAGE_PATH = /\/roleassignmentapprovals\/([^/]+)\/stages\//i;
const OP_REQUEST_WRITES: ReadonlySet<string> = new Set([
    "microsoft.authorization/roleassignmentschedulerequests/write",
    "microsoft.authorization/roleeligibilityschedulerequests/write",
    // A validation of a request is never an event, with any status
    "microsoft.authorization/roleassignmentschedulerequests/validate/action",
    "microsoft.authorization/roleeligibilityschedulerequests/validate/action",
]);

const USAGE_TYPES: ReadonlySet<string> = new Set(["selfactivate", "selfextend", "selfrenew"]);
const ADMIN_TYPES: ReadonlySet<string> = new Set(["adminassign", "adminremove", "adminupdate", "adminextend", "adminrenew"]);
const SUCCESS_STATUSES: ReadonlySet<string> = new Set(["provisioned", "granted", "revoked"]);
const DENIED_STATUSES: ReadonlySet<string> = new Set(["denied", "admindenied"]);
const FAILED_STATUSES: ReadonlySet<string> = new Set(["failed", "failedasresourceislocked", "timedout", "canceled"]);
const APP_TYPES: ReadonlySet<string> = new Set(["serviceprincipal", "agentidentity", "agentuser", "agentserviceprincipal"]);
const GROUP_TYPES: ReadonlySet<string> = new Set(["group", "groupsecuritynotenabled"]);
const GUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Small readers --------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string trimmed; anything else is empty */
function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** A string as typed, for the ticket */
function asTyped(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function parseJson(value: unknown): unknown {
    if (typeof value !== "string" || value.trim() === "") return undefined;
    try {
        return JSON.parse(value);
    } catch (error: unknown) {
        // Malformed JSON text stays empty, no throw
        void error;
        return undefined;
    }
}

/** A key of a record, whatever its casing (the log writes both `Properties` and `properties`) */
function pick(value: unknown, key: string): unknown {
    if (!isRecord(value)) return undefined;
    const wanted = key.toLowerCase();
    for (const [name, entry] of Object.entries(value)) if (name.toLowerCase() === wanted) return entry;
    return undefined;
}

function dig(value: unknown, ...keys: string[]): unknown {
    return keys.reduce<unknown>((current, key) => pick(current, key), value);
}

/** A string as it is, else undefined: a row from ARM is data, not a type */
function plain(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Only the named fields of an Activity Log row; everything else in it (the request, the claims, the addresses) never leaves the read */
export function toRawActivityEvent(row: unknown): RawActivityEvent {
    if (!isRecord(row)) return {};
    const operation = pick(row, "operationName");
    const status = pick(row, "status");
    const claims = pick(row, "claims");
    const properties = pick(row, "properties");
    return {
        eventDataId: plain(pick(row, "eventDataId")),
        correlationId: plain(pick(row, "correlationId")),
        eventTimestamp: plain(pick(row, "eventTimestamp")),
        caller: plain(pick(row, "caller")),
        resourceId: plain(pick(row, "resourceId")),
        subscriptionId: plain(pick(row, "subscriptionId")),
        operationName: isRecord(operation) ? { value: plain(pick(operation, "value")) } : undefined,
        status: isRecord(status) ? { value: plain(pick(status, "value")) } : undefined,
        claims: isRecord(claims) ? { appid: plain(pick(claims, "appid")) } : undefined,
        properties: isRecord(properties)
            ? { requestbody: plain(pick(properties, "requestbody")), responseBody: plain(pick(properties, "responseBody")), statusMessage: plain(pick(properties, "statusMessage")) }
            : undefined,
    };
}

/** Only the named fields of a request row of the ARM schedule request lists */
export function toRawArmRequest(row: unknown): RawArmRequest {
    if (!isRecord(row)) return { id: "", name: "", properties: {} };
    const props = pick(row, "properties");
    const read = (...keys: string[]) => plain(dig(props, ...keys));
    const ticketInfo = pick(props, "ticketInfo");
    const schedule = pick(props, "scheduleInfo");
    const expiration = pick(schedule, "expiration");
    const expanded = pick(props, "expandedProperties");
    const principal = pick(expanded, "principal");
    const definition = pick(expanded, "roleDefinition");
    return {
        id: plain(pick(row, "id")) ?? "",
        name: plain(pick(row, "name")) ?? "",
        properties: {
            scope: read("scope"),
            roleDefinitionId: read("roleDefinitionId"),
            principalId: read("principalId"),
            principalType: read("principalType"),
            requestorId: read("requestorId"),
            requestType: read("requestType"),
            status: read("status"),
            createdOn: read("createdOn"),
            justification: read("justification"),
            ticketInfo: isRecord(ticketInfo) ? { ticketNumber: plain(pick(ticketInfo, "ticketNumber")), ticketSystem: plain(pick(ticketInfo, "ticketSystem")) } : undefined,
            scheduleInfo: isRecord(schedule)
                ? {
                    startDateTime: plain(pick(schedule, "startDateTime")),
                    expiration: isRecord(expiration) ? { duration: plain(pick(expiration, "duration")), endDateTime: plain(pick(expiration, "endDateTime")) } : undefined,
                }
                : undefined,
            linkedRoleEligibilityScheduleId: read("linkedRoleEligibilityScheduleId"),
            approvalId: read("approvalId"),
            expandedProperties: isRecord(expanded)
                ? {
                    principal: isRecord(principal) ? { displayName: plain(pick(principal, "displayName")), userPrincipalName: plain(pick(principal, "userPrincipalName")) } : undefined,
                    roleDefinition: isRecord(definition) ? { displayName: plain(pick(definition, "displayName")) } : undefined,
                }
                : undefined,
        },
    };
}

function lastSegment(path: string): string {
    const parts = path.split("/").filter((part) => part !== "");
    return parts.length > 0 ? parts[parts.length - 1] : "";
}

/** Milliseconds of a time text; NaN when missing or invalid */
function ms(value: unknown): number {
    const raw = text(value);
    return raw === "" ? Number.NaN : Date.parse(raw);
}

function isoOf(timeMs: number): string {
    return Number.isFinite(timeMs) ? new Date(timeMs).toISOString() : "";
}

/** A row without a valid time sorts last in a newest-first list */
function sortKey(timeMs: number): number {
    return Number.isFinite(timeMs) ? timeMs : Number.NEGATIVE_INFINITY;
}

// Scope ----------------------------------------------------------------------------------------------------------------

type ScopeNamer = (scopeId: string) => string | undefined;

function scopeNameOf(scopeId: string, namer: ScopeNamer): string {
    if (scopeId === "") return "";
    const known = text(namer(scopeId));
    if (known) return known;
    return scopeId === "/" ? "Root" : lastSegment(scopeId);
}

/** The scope name, and the azure object when the level is one the tree shows */
function scopeOf(scopeId: string, namer: ScopeNamer): { scope: string; azure?: NonNullable<AuditEvent["azure"]> } {
    const scope = scopeNameOf(scopeId, namer);
    const level = scopeId === "" ? null : levelFromScopeId(scopeId);
    if (level === null) return { scope };
    const segments = scopeId.split("/").filter((part) => part !== "");
    const subscriptionId = segments[0]?.toLowerCase() === "subscriptions" ? segments[1] ?? "" : "";
    return { scope, azure: { scopeId, scopeName: scope, scopeLevel: level, subscriptionId } };
}

// Requests -------------------------------------------------------------------------------------------------------------

type Outcome = "done" | "requested" | "denied" | "failed";

interface Req {
    list: "assignment" | "eligibility";
    type: string;
    typeLc: string;
    timeMs: number;
    /** The later of `createdOn` and the start of the schedule; `createdOn` when the start is missing or invalid */
    anchorMs: number;
    /** The start of the schedule, NaN when missing or invalid */
    startMs: number;
    /** The end of the request: `endDateTime`, else the anchor plus the duration; NaN when it has neither */
    endMs: number;
    outcome: Outcome;
    key: string;
    approvalId: string;
    actor: AuditActor;
    event: AuditEvent;
    /** The time of the linked write, when there is one */
    writeMs: number;
    linkedWrite: boolean;
    /** A failed MS-PIM write was matched to this failed request */
    failedWrite: boolean;
    linkedDelete?: Act;
    ended: boolean;
    dropped: boolean;
}

const keyOf = (principalId: string, roleId: string, scopeId: string): string => `${principalId}|${roleId}|${scopeId}`.toLowerCase();

function outcomeOf(status: string): { outcome: Outcome; fields: Partial<AuditEvent>; result: AuditResult } {
    const lower = status.toLowerCase();
    if (SUCCESS_STATUSES.has(lower)) return { outcome: "done", fields: {}, result: "success" };
    if (DENIED_STATUSES.has(lower)) return { outcome: "denied", fields: { denied: true }, result: "failure" };
    if (FAILED_STATUSES.has(lower)) return { outcome: "failed", fields: { failureReason: status }, result: "failure" };
    return { outcome: "requested", fields: { requestOnly: true }, result: "success" };
}

function requestSentence(req: { typeLc: string; type: string; outcome: Outcome; list: Req["list"] }, person: string, isGroup: boolean, role: string, scope: string): string {
    const on = `${role} on ${scope}`;
    const usage: Record<string, { done: string; requested: string; noun: string }> = {
        selfactivate: { done: "activated", requested: "requested activation of", noun: "Activation" },
        selfextend: { done: "extended", requested: "requested extension of", noun: "Extension" },
        selfrenew: { done: "renewed", requested: "requested renewal of", noun: "Renewal" },
    };
    const words = usage[req.typeLc];
    if (words) {
        if (req.outcome === "done") return `${person} ${words.done} ${on}`;
        if (req.outcome === "requested") return `${person} ${words.requested} ${on}`;
        return `${words.noun} of ${on} by ${person} ${req.outcome}`;
    }
    const admin: Record<string, string> = { adminupdate: "updated", adminextend: "extended", adminrenew: "renewed" };
    if (ADMIN_TYPES.has(req.typeLc)) {
        if (req.outcome !== "done") return `Assignment of ${person} for ${on} ${req.outcome}`;
        const level = req.list === "eligibility" ? "eligible" : "active";
        if (req.typeLc === "adminassign") return isGroup ? `${person} added as ${level} to ${on}` : `${person} made ${level} for ${on}`;
        if (req.typeLc === "adminremove") return `${person} removed as ${level} from ${on}`;
        return `Assignment of ${person} for ${on} ${admin[req.typeLc]}`;
    }
    return `${req.type || "Unknown"} request for ${on}`;
}

/** What an activation needs of the eligibility request it links to */
interface EligibilityInfo { principalType: string; displayName: string; principalId: string }

function eligibilityInfos(rows: readonly RawArmRequest[]): Map<string, EligibilityInfo> {
    const infos = new Map<string, EligibilityInfo>();
    for (const raw of rows) {
        if (!isRecord(raw) || !isRecord(raw.properties)) continue;
        const name = text(raw.name).toLowerCase();
        if (name === "" || infos.has(name)) continue;
        infos.set(name, {
            principalType: text(raw.properties.principalType).toLowerCase(),
            displayName: text(dig(raw.properties, "expandedProperties", "principal", "displayName")),
            principalId: text(raw.properties.principalId),
        });
    }
    return infos;
}

function buildRequest(raw: RawArmRequest, list: Req["list"], context: AzureAuditContext, eligibilityByName: ReadonlyMap<string, EligibilityInfo>): Req | null {
    if (!isRecord(raw)) return null;
    const props = isRecord(raw.properties) ? raw.properties : {};
    const name = text(raw.name);
    const type = text(props.requestType);
    const typeLc = type.toLowerCase();
    const { outcome, fields, result } = outcomeOf(text(props.status));
    const timeMs = ms(props.createdOn);

    const principalId = text(props.principalId);
    const principalType = text(props.principalType).toLowerCase();
    const requestorId = text(props.requestorId);
    const rowPrincipalName = text(dig(props, "expandedProperties", "principal", "displayName"));
    const principalName = rowPrincipalName || text(context.principalName(principalId)) || principalId;
    const roleGuid = lastSegment(text(props.roleDefinitionId));
    const roleName = text(dig(props, "expandedProperties", "roleDefinition", "displayName")) || text(context.roleName(roleGuid)) || roleGuid;
    const scopeId = text(props.scope);
    const { scope, azure } = scopeOf(scopeId, (id) => context.scopeName(id));

    const sameAsPrincipal = requestorId !== "" && requestorId.toLowerCase() === principalId.toLowerCase();
    const principalUpn = text(dig(props, "expandedProperties", "principal", "userPrincipalName"));
    const isGuest = isGuestUpn(principalUpn);
    const actor: AuditActor = {
        name: sameAsPrincipal ? principalName : text(context.principalName(requestorId)) || requestorId,
        id: requestorId,
        kind: sameAsPrincipal && APP_TYPES.has(principalType) ? "system" : "person",
    };
    // The requestor is the guest itself
    if (sameAsPrincipal && isGuest) actor.isGuest = true;

    let kind: AuditKind = "system";
    if (USAGE_TYPES.has(typeLc)) kind = "usage";
    else if (ADMIN_TYPES.has(typeLc)) kind = "assignment";

    const isGroup = GROUP_TYPES.has(principalType);
    const event: AuditEvent = {
        id: name.toLowerCase(),
        time: isoOf(timeMs),
        kind,
        environment: "role",
        sentence: requestSentence({ typeLc, type, outcome, list }, principalName, isGroup, roleName, scope),
        ...(type ? { requestType: type } : {}),
        actor,
        role: { name: roleName, id: roleGuid },
        scope,
        result,
        source: "arm",
        correlationId: name.toLowerCase(),
        ...fields,
    };
    if (azure) event.azure = azure;
    if (principalId || principalName) {
        event.target = { name: principalName, id: principalId };
        if (isGroup) event.targetIsGroup = true;
        if (APP_TYPES.has(principalType)) event.targetIsApp = true;
        if (isGuest) event.targetIsGuest = true;
    }
    const reason = asTyped(props.justification);
    if (reason) event.reason = reason;
    if (text(props.approvalId) !== "") event.hadApproval = true;
    const ticketNumber = asTyped(dig(props, "ticketInfo", "ticketNumber"));
    const ticketSystem = asTyped(dig(props, "ticketInfo", "ticketSystem"));
    if (ticketNumber) event.ticket = ticketSystem ? `${ticketNumber} (${ticketSystem})` : ticketNumber;
    const endMs = ms(dig(props, "scheduleInfo", "expiration", "endDateTime"));
    if (Number.isFinite(endMs)) event.endsAt = new Date(endMs).toISOString();
    const hours = parseTotalHours(text(dig(props, "scheduleInfo", "expiration", "duration")) || undefined);
    if (hours !== null) event.requestedDuration = Math.round(hours * 60);
    const startMs = ms(dig(props, "scheduleInfo", "startDateTime"));
    // A scheduled activation: the event stays at the request time, the start shows apart (AU-17, P7)
    if (typeLc === "selfactivate" && Number.isFinite(startMs) && Number.isFinite(timeMs) && startMs - timeMs > MINUTE_MS) event.startsAt = new Date(startMs).toISOString();
    const anchorMs = Number.isFinite(startMs) && startMs > timeMs ? startMs : timeMs;
    const expectedEndMs = Number.isFinite(endMs) ? endMs : hours !== null ? anchorMs + hours * 3_600_000 : Number.NaN;

    // Through a group: the eligibility an activation links to belongs to a group (rule 5)
    if (typeLc === "selfactivate") {
        const linked = lastSegment(text(props.linkedRoleEligibilityScheduleId)).toLowerCase();
        if (linked !== "") {
            event.eligibilityId = linked;
            const match = context.eligibilities.find((entry) => lastSegment(text(entry.id)).toLowerCase() === linked
                && GROUP_TYPES.has(text(entry.principalType).toLowerCase()));
            if (match) event.viaGroup = text(match.principalName) || text(match.principalId);
            else {
                // The schedule is gone: the eligibility request it came from tells whether it was a group's
                const request = eligibilityByName.get(linked);
                if (request && GROUP_TYPES.has(request.principalType)) {
                    event.viaGroup = request.displayName || text(context.principalName(request.principalId)) || request.principalId;
                }
            }
        }
    }

    return {
        list, type, typeLc, timeMs, anchorMs, startMs, endMs: expectedEndMs, outcome,
        key: keyOf(principalId, roleGuid, scopeId),
        approvalId: text(props.approvalId),
        actor, event,
        writeMs: Number.NaN, linkedWrite: false, failedWrite: false, ended: false, dropped: false,
    };
}

// Activity Log ---------------------------------------------------------------------------------------------------------

interface Act {
    op: string;
    opLc: string;
    timeMs: number;
    id: string;
    correlationId: string;
    caller: string;
    resourceId: string;
    msPim: boolean;
    completed: boolean;
    failed: boolean;
    failureReason?: string;
    /** The error code of the `statusMessage` of a failed row, when it holds one */
    errorCode?: string;
    principalId: string;
    principalType: string;
    roleGuid: string;
    scopeId: string;
    key: string;
    /** The parsed request or response bodies that carry the names, the most relevant first */
    bodies: unknown[];
    linked: boolean;
    /** A failed write matched to a failed request: that request tells it, so it has no row of its own */
    absorbed: boolean;
}

interface LogRow {
    raw: RawActivityEvent;
    opLc: string;
    status: string;
    timeMs: number;
}

function errorText(source: unknown): string {
    const error = dig(parseJson(source), "error");
    const code = text(pick(error, "code"));
    const message = text(pick(error, "message"));
    return code && message ? `${code}: ${message}` : code || message;
}

function scopeOfOperation(opLc: string, resourceId: string, responseBody: unknown): string {
    if (opLc.endsWith("/delete")) {
        const fromBody = text(dig(responseBody, "properties", "scope"));
        if (fromBody) return fromBody;
    }
    if (resourceId === "") return "";
    const at = resourceId.toLowerCase().lastIndexOf(AUTHORIZATION);
    if (at < 0) return resourceId;
    return at === 0 ? "/" : resourceId.slice(0, at);
}

function fromBodies(bodies: readonly unknown[], ...keys: string[]): string {
    for (const body of bodies) {
        const found = text(dig(body, ...keys));
        if (found) return found;
    }
    return "";
}

function buildAct(rows: LogRow[]): Act {
    const ordered = [...rows].sort((a, b) => sortKey(a.timeMs) - sortKey(b.timeMs));
    const completedRow = ordered.find((row) => row.status === "succeeded" || row.status === "failed");
    const startedRow = ordered.find((row) => row.status === "started");
    const shown = completedRow ?? startedRow ?? ordered[0];
    const opLc = shown.opLc;
    const isAssignmentOp = opLc === OP_ASSIGNMENT_WRITE || opLc === OP_ASSIGNMENT_DELETE;
    const resourceId = text(shown.raw.resourceId);

    // Names: a write has them in the request body of the start, a delete in the response body of the completion
    const bodies = opLc.endsWith("/delete")
        ? [completedRow, ...ordered].map((row) => parseJson(row?.raw.properties?.responseBody))
        : [startedRow, ...ordered].map((row) => parseJson(row?.raw.properties?.requestbody));
    const principalId = fromBodies(bodies, "properties", "principalId");
    const roleGuid = lastSegment(fromBodies(bodies, "properties", "roleDefinitionId"));
    const scopeId = scopeOfOperation(opLc, resourceId, parseJson(completedRow?.raw.properties?.responseBody));

    const act: Act = {
        op: text(shown.raw.operationName?.value),
        opLc,
        timeMs: shown.timeMs,
        id: text((completedRow ?? ordered[0]).raw.eventDataId).toLowerCase(),
        correlationId: text(shown.raw.correlationId),
        caller: text(shown.raw.caller) || ordered.map((row) => text(row.raw.caller)).find((value) => value !== "") || "",
        resourceId,
        // The app id is measured on the start only, so any row of the merged group can carry it
        msPim: isAssignmentOp && ordered.some((row) => text(row.raw.claims?.appid).toLowerCase() === MS_PIM_APP_ID),
        completed: completedRow?.status === "succeeded",
        failed: completedRow?.status === "failed",
        principalId,
        principalType: fromBodies(bodies, "properties", "principalType"),
        roleGuid,
        scopeId,
        key: keyOf(principalId, roleGuid, scopeId),
        bodies,
        linked: false,
        absorbed: false,
    };
    if (act.failed && completedRow) {
        const reason = errorText(completedRow.raw.properties?.statusMessage) || errorText(completedRow.raw.properties?.responseBody);
        if (reason) act.failureReason = reason;
        const code = text(pick(dig(parseJson(completedRow.raw.properties?.statusMessage), "error"), "code"));
        if (code) act.errorCode = code;
    }
    return act;
}

/** Rows with one correlation id, operation and resource are one event; a row without a correlation id merges with nothing */
function groupActivity(rows: readonly RawActivityEvent[], accepts: (opLc: string) => boolean = (opLc) => !OP_REQUEST_WRITES.has(opLc)): Act[] {
    const groups = new Map<string, LogRow[]>();
    const all: LogRow[][] = [];
    for (const raw of rows) {
        if (typeof raw !== "object" || raw === null) continue;
        const opLc = text(raw.operationName?.value).toLowerCase();
        if (!accepts(opLc)) continue;
        const row: LogRow = { raw, opLc, status: text(raw.status?.value).toLowerCase(), timeMs: ms(raw.eventTimestamp) };
        const correlationId = text(raw.correlationId).toLowerCase();
        if (correlationId === "") {
            all.push([row]);
            continue;
        }
        const key = `${correlationId}|${opLc}|${text(raw.resourceId).toLowerCase()}`;
        const existing = groups.get(key);
        if (existing) existing.push(row);
        else {
            const created = [row];
            groups.set(key, created);
            all.push(created);
        }
    }
    return all.map(buildAct);
}

/** An Activity Log event is never told as done when it is not */
function prefixed(sentence: string, result: AuditResult, requestOnly: boolean): string {
    if (result === "failure") return `Failed: ${sentence}`;
    return requestOnly ? `Not completed: ${sentence}` : sentence;
}

/** The name of a caller of the log: the display name when its sign-in name is known in this read, else the caller as logged. Never looks anything up. */
function callerNameOf(caller: string, context: AzureAuditContext): string {
    const callerId = caller.includes("@") ? context.principalIdOfUpn?.(caller) : undefined;
    return (callerId !== undefined ? context.callerNameOfUpn?.(caller) || text(context.principalName(callerId)) : "") || text(context.principalName(caller)) || caller;
}

function actEvent(act: Act, context: AzureAuditContext, kind: AuditKind, sentence: string, extra: Partial<AuditEvent> = {}): AuditEvent {
    const result: AuditResult = act.failed ? "failure" : "success";
    const requestOnly = !act.failed && !act.completed;
    const { caller } = act;
    const { scope, azure } = scopeOf(act.scopeId, (id) => context.scopeName(id));
    // The log names a caller by sign-in name; with the object id, the emergency access list finds the account
    const callerId = caller.includes("@") ? context.principalIdOfUpn?.(caller) : undefined;
    const callerName = callerNameOf(caller, context);
    const event: AuditEvent = {
        id: act.id,
        time: isoOf(act.timeMs),
        kind,
        environment: "role",
        sentence: prefixed(sentence, result, requestOnly),
        actor: { name: callerName, id: callerId ?? caller, kind: caller.includes("@") ? "person" : "system", ...(isGuestUpn(caller) ? { isGuest: true } : {}) },
        role: { name: "", id: "" },
        scope,
        result,
        source: "activity-log",
        correlationId: act.correlationId,
        ...extra,
    };
    if (azure) event.azure = azure;
    if (requestOnly) event.requestOnly = true;
    if (act.failureReason) event.failureReason = act.failureReason;
    return event;
}

interface Names { principal: string; role: string; scope: string }

function namesOf(act: Act, context: AzureAuditContext): Names {
    return {
        principal: text(context.principalName(act.principalId)) || act.principalId,
        role: text(context.roleName(act.roleGuid)) || act.roleGuid,
        scope: scopeNameOf(act.scopeId, (id) => context.scopeName(id)),
    };
}

/** What the requests and the assignments know of a principal: its type and its sign-in name */
type PrincipalLookup = (id: string) => { type: string; upn: string };

/** The type and sign-in name per principal id (lower case) that the request rows carry; the first non-empty value wins */
function requestPrincipals(rows: readonly RawArmRequest[]): Map<string, { type: string; upn: string }> {
    const known = new Map<string, { type: string; upn: string }>();
    for (const raw of rows) {
        if (!isRecord(raw) || !isRecord(raw.properties)) continue;
        const id = text(raw.properties.principalId).toLowerCase();
        if (id === "") continue;
        const entry = known.get(id) ?? { type: "", upn: "" };
        entry.type = entry.type || text(raw.properties.principalType);
        entry.upn = entry.upn || text(dig(raw.properties, "expandedProperties", "principal", "userPrincipalName"));
        known.set(id, entry);
    }
    return known;
}

/** A log row's body tells the principal type; when it does not, a request with that principal does, then the assignments */
function principalLookup(rows: readonly RawArmRequest[], context: AzureAuditContext): PrincipalLookup {
    const fromRequests = requestPrincipals(rows);
    return (id) => {
        const request = fromRequests.get(id.toLowerCase());
        const assigned = context.principal?.(id);
        return { type: request?.type || text(assigned?.type), upn: request?.upn || text(assigned?.upn) };
    };
}

function principalFields(act: Act, names: Names, lookup: PrincipalLookup): Partial<AuditEvent> {
    const fields: Partial<AuditEvent> = { role: { name: names.role, id: act.roleGuid } };
    if (act.principalId || names.principal) {
        fields.target = { name: names.principal, id: act.principalId };
        const known = act.principalId ? lookup(act.principalId) : { type: "", upn: "" };
        const type = (act.principalType || known.type).toLowerCase();
        if (GROUP_TYPES.has(type)) fields.targetIsGroup = true;
        if (APP_TYPES.has(type)) fields.targetIsApp = true;
        // A person who cannot be told apart has no flag
        if (isGuestUpn(known.upn)) fields.targetIsGuest = true;
    }
    return fields;
}

function policyRuleIds(act: Act): string {
    for (const body of act.bodies) {
        const rules = dig(body, "properties", "rules");
        if (!Array.isArray(rules)) continue;
        const ids = rules.filter(isRecord).map((rule) => text(pick(rule, "id"))).filter((id) => id !== "");
        if (ids.length > 0) return ids.join(",");
    }
    return "";
}

function fallbackSentence(act: Act): string {
    return act.op === "" || GUID_PATTERN.test(act.op) ? "Other Azure authorization operation" : `Azure operation ${act.op}`;
}

/** The event of an operation that is not one of the cases linked to a request */
function plainActEvent(act: Act, context: AzureAuditContext, lookup: PrincipalLookup): AuditEvent {
    const { opLc } = act;
    const names = namesOf(act, context);
    const fallback = fallbackSentence(act);
    if (opLc === OP_ASSIGNMENT_WRITE || opLc === OP_ASSIGNMENT_DELETE) {
        const isWrite = opLc === OP_ASSIGNMENT_WRITE;
        if (!names.principal || !names.role) {
            // Rule 6: still outside PIM; the names are missing when the log gave no body (a start only, or a failure)
            return actEvent(act, context, "outside", `Role assignment ${isWrite ? "given" : "removed"} on ${names.scope} outside PIM`, principalFields(act, names, lookup));
        }
        const verb = isWrite ? "given" : "removed from";
        return actEvent(act, context, "outside", `${names.principal} ${verb} ${names.role} on ${names.scope} outside PIM`, principalFields(act, names, lookup));
    }
    if (opLc === OP_POLICY_WRITE) {
        const ids = policyRuleIds(act);
        return actEvent(act, context, "setting", `Setting changed on ${names.scope}`, ids ? { newValue: ids } : {});
    }
    if (opLc === OP_DEFINITION_WRITE || opLc === OP_DEFINITION_DELETE) {
        const id = lastSegment(act.resourceId);
        const name = fromBodies(act.bodies, "roleName") || fromBodies(act.bodies, "properties", "roleName");
        const verb = opLc === OP_DEFINITION_WRITE ? "changed" : "deleted";
        return actEvent(act, context, "setting", `Custom role ${name || id} ${verb}`, { role: { name, id } });
    }
    return actEvent(act, context, "system", fallback);
}

// Refused request writes (AU-17, P8) ------------------------------------------------------------------------------------

const OP_REQUEST_CREATES: ReadonlySet<string> = new Set([
    "microsoft.authorization/roleassignmentschedulerequests/write",
    "microsoft.authorization/roleeligibilityschedulerequests/write",
]);

const REQUEST_TYPE_NOUNS: Record<string, string> = {
    adminextend: "Extension",
    selfextend: "Extension",
    adminremove: "Removal",
    selfdeactivate: "Deactivation",
    adminassign: "Assignment",
    adminupdate: "Update",
    adminrenew: "Renewal",
    selfrenew: "Renewal",
    selfactivate: "Activation",
};

/** The event of a request write that ARM refused: the request was never created, so no list has it and the log is all there is */
function refusedRequestEvent(act: Act, context: AzureAuditContext, lookup: PrincipalLookup): AuditEvent {
    const names = namesOf(act, context);
    const requestType = fromBodies(act.bodies, "properties", "requestType").toLowerCase();
    const noun = REQUEST_TYPE_NOUNS[requestType] ?? "Assignment request";
    const scopeFromBody = fromBodies(act.bodies, "properties", "scope");
    const scopeId = scopeFromBody || act.scopeId;
    const scope = scopeNameOf(scopeId, (id) => context.scopeName(id));
    const parts = [noun];
    if (names.principal) parts.push(`of ${names.principal}`);
    if (names.role) parts.push(`for ${names.role}`);
    if (scope) parts.push(`on ${scope}`);
    const reason = act.errorCode ? act.failureReason ?? act.errorCode : "Failed";
    // The person's own request (to activate, extend or end their role) is about using it, as on Entra (AU-17, P4)
    const kind: AuditKind = requestType.startsWith("self") ? "usage" : "assignment";
    const event = actEvent({ ...act, scopeId, failureReason: reason }, context, kind, parts.join(" "), principalFields(act, names, lookup));
    return event;
}

// Mapping --------------------------------------------------------------------------------------------------------------

/** The item nearest in time within the link window, both directions */
function closest<T>(candidates: readonly T[], at: number, timeOf: (item: T) => number): T | undefined {
    let best: T | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const item of candidates) {
        const gap = Math.abs(timeOf(item) - at);
        if (gap <= LINK_WINDOW_MS && gap < bestGap) {
            best = item;
            bestGap = gap;
        }
    }
    return best;
}

interface End { timeMs: number; key: string; request?: Req; act?: Act }

/** When an activation starts: its linked write, else its anchor */
function startOf(req: Req): number {
    return req.linkedWrite && Number.isFinite(req.writeMs) ? req.writeMs : req.anchorMs;
}

const APPROVAL_WINDOW_MS = 24 * 3_600_000;

/** True when an expiry at `endMs` fits the expected end of the activation; no known end means no limit */
function isExpectedExpiry(activation: Req, endMs: number, reqs: readonly Req[]): boolean {
    const start = startOf(activation);
    const ends = [activation.endMs];
    for (const other of reqs) {
        if ((other.typeLc !== "selfextend" && other.typeLc !== "selfrenew") || other.outcome !== "done" || other.key !== activation.key) continue;
        if (Number.isFinite(other.timeMs) && other.timeMs >= start && other.timeMs <= endMs) ends.push(other.endMs);
    }
    const known = ends.filter((value) => Number.isFinite(value));
    return known.length === 0 || endMs <= Math.max(...known) + LINK_WINDOW_MS;
}

/** The names of custom roles the log itself gives (a role written or deleted), by lower-case role id; the newest named row wins */
function customRoleNamesOf(acts: readonly Act[]): Map<string, string> {
    const named: { id: string; name: string; timeMs: number }[] = [];
    for (const act of acts) {
        if (act.failed || (act.opLc !== OP_DEFINITION_WRITE && act.opLc !== OP_DEFINITION_DELETE)) continue;
        const id = lastSegment(act.resourceId).toLowerCase();
        const name = fromBodies(act.bodies, "roleName") || fromBodies(act.bodies, "properties", "roleName");
        if (id === "" || name === "") continue;
        named.push({ id, name, timeMs: Number.isFinite(act.timeMs) ? act.timeMs : Number.NEGATIVE_INFINITY });
    }
    const names = new Map<string, string>();
    for (const entry of named.sort((a, b) => a.timeMs - b.timeMs)) names.set(entry.id, entry.name);
    return names;
}

/** True when an event names its role by the role id: no name is known for it (the id is a GUID, compared without case) */
export function hasUnnamedRole(events: readonly AuditEvent[]): boolean {
    return events.some((event) => {
        const { name, id } = event.role;
        return id !== "" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && name.toLowerCase() === id.toLowerCase();
    });
}

/** Maps raw ARM requests and Activity Log rows to audit events, newest first */
export function mapAzureAuditEvents(input: AzureAuditInput): AuditEvent[] {
    // A role no assignment or definition names may still be named by the log: the write or delete of the custom role itself
    const logRoleNames = customRoleNamesOf(groupActivity(input.activity));
    // A caller of the log is looked up in the requests of this read first (sign-in name, principal id, display name), then in the context
    const callers = new Map<string, { id: string; name: string }>();
    for (const raw of [...input.assignmentRequests, ...input.eligibilityRequests]) {
        if (!isRecord(raw) || !isRecord(raw.properties)) continue;
        const upn = text(dig(raw.properties, "expandedProperties", "principal", "userPrincipalName")).toLowerCase();
        const id = text(raw.properties.principalId);
        if (upn === "" || id === "" || callers.has(upn)) continue;
        callers.set(upn, { id, name: text(dig(raw.properties, "expandedProperties", "principal", "displayName")) });
    }
    const context: AzureAuditContext = {
        ...input.context,
        roleName: (roleGuid) => input.context.roleName(roleGuid) || logRoleNames.get(roleGuid.toLowerCase()),
        principalIdOfUpn: (upn) => callers.get(upn.toLowerCase())?.id ?? input.context.principalIdOfUpn?.(upn),
        callerNameOfUpn: (upn) => callers.get(upn.toLowerCase())?.name || undefined,
    };
    const seen = new Set<string>();
    const reqs: Req[] = [];
    const eligibilityByName = eligibilityInfos(input.eligibilityRequests);
    const lists: [readonly RawArmRequest[], Req["list"]][] = [[input.assignmentRequests, "assignment"], [input.eligibilityRequests, "eligibility"]];
    for (const [rows, list] of lists) {
        for (const raw of rows) {
            const req = buildRequest(raw, list, context, eligibilityByName);
            if (req === null) continue;
            const name = req.event.id;
            if (name !== "" && seen.has(name)) continue;
            if (name !== "") seen.add(name);
            reqs.push(req);
        }
    }

    // The approver from the tenant log: a succeeded stage write of an approval that belongs to a request; it makes no row
    const reqByName = new Map<string, Req>();
    for (const req of reqs) if (req.event.id !== "") reqByName.set(req.event.id, req);
    const stageKeys = new Set<string>();
    const stageRows = new Set<RawActivityEvent>();
    for (const raw of input.activity) {
        if (typeof raw !== "object" || raw === null) continue;
        if (text(raw.operationName?.value).toLowerCase() !== OP_APPROVAL_STAGE_WRITE || text(raw.status?.value).toLowerCase() !== "succeeded") continue;
        const resourceId = text(raw.resourceId);
        const name = resourceId.match(APPROVAL_STAGE_PATH)?.[1]?.toLowerCase() ?? "";
        const req = name === "" ? undefined : reqByName.get(name);
        const caller = text(raw.caller);
        if (!req || caller === "") continue;
        if (!req.event.approver) {
            const decidedAfterMinutes = wholeMinutes(req.timeMs, ms(raw.eventTimestamp));
            req.event = { ...req.event, approver: callerNameOf(caller, context), ...(decidedAfterMinutes !== undefined ? { decidedAfterMinutes } : {}) };
        }
        const correlationId = text(raw.correlationId).toLowerCase();
        if (correlationId === "") stageRows.add(raw);
        else stageKeys.add(`${correlationId}|${OP_APPROVAL_STAGE_WRITE}|${resourceId.toLowerCase()}`);
    }
    const activity = input.activity.filter((raw) => {
        if (typeof raw !== "object" || raw === null) return true;
        if (stageRows.has(raw)) return false;
        return !stageKeys.has(`${text(raw.correlationId).toLowerCase()}|${text(raw.operationName?.value).toLowerCase()}|${text(raw.resourceId).toLowerCase()}`);
    });
    const acts = groupActivity(activity);
    const byTime = (a: Act, b: Act) => sortKey(a.timeMs) - sortKey(b.timeMs);
    // A failed write or delete links to nothing and stays a row of its own
    const pimWrites = acts.filter((act) => act.msPim && !act.failed && act.opLc === OP_ASSIGNMENT_WRITE).sort(byTime);
    const pimDeletes = acts.filter((act) => act.msPim && !act.failed && act.opLc === OP_ASSIGNMENT_DELETE).sort(byTime);

    // Links (rule 7): writes within 10 minutes first, then the approval flow without an upper limit
    const doneAssignments = reqs.filter((req) => req.list === "assignment" && req.outcome === "done");
    // A write never belongs to a removal or a deactivation
    const writeCandidates = doneAssignments.filter((req) => req.typeLc !== "adminremove" && req.typeLc !== "selfdeactivate");
    for (const write of pimWrites) {
        if (!Number.isFinite(write.timeMs) || write.principalId === "") continue;
        const free = writeCandidates.filter((req) => !req.linkedWrite && req.key === write.key && Number.isFinite(req.anchorMs));
        const found = closest(free, write.timeMs, (req) => req.anchorMs);
        if (!found) continue;
        found.linkedWrite = true;
        found.writeMs = write.timeMs;
        write.linked = true;
    }
    const approvals = writeCandidates
        .filter((req) => req.approvalId !== "" && !req.linkedWrite && Number.isFinite(req.timeMs))
        .sort((a, b) => a.timeMs - b.timeMs);
    for (const req of approvals) {
        const write = pimWrites.find((entry) => !entry.linked && entry.principalId !== "" && entry.key === req.key
            && Number.isFinite(entry.timeMs) && entry.timeMs >= req.timeMs
            && entry.timeMs <= Math.max(req.timeMs + APPROVAL_WINDOW_MS, Number.isFinite(req.startMs) ? req.startMs : Number.NEGATIVE_INFINITY) + LINK_WINDOW_MS);
        if (!write) continue;
        req.linkedWrite = true;
        req.writeMs = write.timeMs;
        write.linked = true;
    }
    // A failed write with a known principal, next to a failed request, is that request's failure (closest first)
    const failedWrites = acts.filter((act) => act.msPim && act.failed && act.opLc === OP_ASSIGNMENT_WRITE && act.principalId !== "" && Number.isFinite(act.timeMs)).sort(byTime);
    const failedRequests = reqs.filter((req) => req.list === "assignment" && req.outcome === "failed");
    for (const write of failedWrites) {
        const free = failedRequests.filter((req) => !req.failedWrite && req.key === write.key && Number.isFinite(req.anchorMs));
        const found = closest(free, write.timeMs, (req) => req.anchorMs);
        if (!found) continue;
        found.failedWrite = true;
        write.absorbed = true;
        if (write.failureReason) found.event = { ...found.event, failureReason: write.failureReason };
    }
    const deleteCandidates = doneAssignments.filter((req) => req.typeLc === "adminremove" || req.typeLc === "selfdeactivate");
    for (const del of pimDeletes) {
        if (!Number.isFinite(del.timeMs) || del.principalId === "") continue;
        const free = deleteCandidates.filter((req) => req.linkedDelete === undefined && req.key === del.key && Number.isFinite(req.timeMs));
        const found = closest(free, del.timeMs, (req) => req.timeMs);
        if (!found) continue;
        found.linkedDelete = del;
        del.linked = true;
    }

    // Ends in time order: a successful SelfDeactivate, or an expiry (a completed MS-PIM delete without a request)
    const ends: End[] = [];
    for (const req of reqs) {
        if (req.typeLc !== "selfdeactivate" || req.outcome !== "done") continue;
        const deleteMs = req.linkedDelete?.timeMs ?? Number.NaN;
        ends.push({ timeMs: Number.isFinite(deleteMs) ? deleteMs : req.timeMs, key: req.key, request: req });
    }
    for (const del of pimDeletes) if (!del.linked && del.completed) ends.push({ timeMs: del.timeMs, key: del.key, act: del });
    ends.sort((a, b) => sortKey(a.timeMs) - sortKey(b.timeMs));

    const consumed = new Set<Act>();
    const activations = reqs.filter((req) => req.typeLc === "selfactivate" && req.outcome === "done");
    for (const end of ends) {
        let activation: Req | undefined;
        for (const candidate of activations) {
            // An approved activation is not active before its write
            if (candidate.ended || candidate.key !== end.key || !Number.isFinite(candidate.timeMs) || startOf(candidate) > end.timeMs) continue;
            // An expiry comes at the expected end of the activation, with its extensions and renewals; later is another activation's
            if (end.act && !isExpectedExpiry(candidate, end.timeMs, reqs)) continue;
            if (!activation || startOf(candidate) > startOf(activation)) activation = candidate;
        }
        if (!activation) continue;
        activation.ended = true;
        // The wait for approval is not use: counting starts at the linked write
        const startMs = startOf(activation);
        const usedMinutes = wholeMinutes(startMs, end.timeMs);
        activation.event = {
            ...activation.event,
            ...(usedMinutes !== undefined ? { usedMinutes } : {}),
            ...(Number.isFinite(end.timeMs) ? { endedAt: new Date(end.timeMs).toISOString() } : {}),
            ...(end.request ? { endedBy: end.request.actor } : {}),
        };
        if (end.request) end.request.dropped = true;
        if (end.act) consumed.add(end.act);
    }

    const lookup = principalLookup([...input.assignmentRequests, ...input.eligibilityRequests], context);
    const rows: { timeMs: number; event: AuditEvent }[] = [];
    for (const req of reqs) if (!req.dropped) rows.push({ timeMs: req.timeMs, event: req.event });
    // A failed request write that no request of the lists tells: ARM refused it, so it was never created (AU-17, P8)
    for (const refused of groupActivity(input.activity, (opLc) => OP_REQUEST_CREATES.has(opLc))) {
        if (!refused.failed || reqByName.has(lastSegment(refused.resourceId).toLowerCase())) continue;
        rows.push({ timeMs: refused.timeMs, event: refusedRequestEvent(refused, context, lookup) });
    }
    for (const act of acts) {
        if (act.msPim && act.opLc === OP_ASSIGNMENT_WRITE) {
            if (act.linked || act.absorbed) continue;
            const names = namesOf(act, context);
            const sentence = names.principal && names.role ? `${names.principal} added to ${names.role} on ${names.scope} by PIM` : fallbackSentence(act);
            rows.push({ timeMs: act.timeMs, event: actEvent(act, context, "system", sentence, principalFields(act, names, lookup)) });
        } else if (act.msPim && act.opLc === OP_ASSIGNMENT_DELETE) {
            if (act.linked || consumed.has(act)) continue;
            const names = namesOf(act, context);
            const sentence = names.principal && names.role ? `Activation of ${names.role} on ${names.scope} ended` : fallbackSentence(act);
            rows.push({ timeMs: act.timeMs, event: actEvent(act, context, "system", sentence, principalFields(act, names, lookup)) });
        } else {
            rows.push({ timeMs: act.timeMs, event: plainActEvent(act, context, lookup) });
        }
    }
    return rows.sort((a, b) => sortKey(b.timeMs) - sortKey(a.timeMs)).map((row) => row.event);
}

// Approvers ------------------------------------------------------------------------------------------------------------

/** Sets `approver` on the ARM events whose request the directory log shows approved or rejected; never adds a row */
export function applyApprovers(events: readonly AuditEvent[], rows: readonly RawDirectoryAudit[]): AuditEvent[] {
    const approvers = new Map<string, { name: string; atMs: number }>();
    for (const row of rows) {
        if (!isRecord(row) || text(row.category) !== "ResourceManagement" || !Array.isArray(row.additionalDetails)) continue;
        const details = new Map<string, string>();
        for (const detail of row.additionalDetails) {
            if (!isRecord(detail)) continue;
            const key = text(detail.key);
            if (key && !details.has(key)) details.set(key, text(detail.value));
        }
        const type = details.get("AuditType");
        if (type !== "ApproveRoleActivation" && type !== "RejectRoleActivation") continue;
        const requestId = (details.get("RoleAssignmentRequestId") ?? "").toLowerCase();
        const name = text(row.initiatedBy?.user?.displayName);
        if (requestId !== "" && name !== "" && !approvers.has(requestId)) approvers.set(requestId, { name, atMs: ms(row.activityDateTime) });
    }
    return events.map((event) => {
        if (event.source !== "arm") return event;
        const approver = approvers.get(event.correlationId.toLowerCase());
        if (!approver) return event;
        const decidedAfterMinutes = wholeMinutes(ms(event.time), approver.atMs);
        return { ...event, approver: approver.name, ...(decidedAfterMinutes !== undefined ? { decidedAfterMinutes } : {}) };
    });
}

// Group rows -----------------------------------------------------------------------------------------------------------

/** The id `personOf` of auditNoActivation gives (it stays unexported): the target, else the actor when a person, in lower case */
function personIdOf(event: AuditEvent): string {
    const target = event.target?.id.trim() ?? "";
    if (target !== "") return target.toLowerCase();
    return event.actor.kind === "person" ? event.actor.id.trim().toLowerCase() : "";
}

/** The sentence of a group row: the same words as a request, with the group named, so the rows of one activation differ by role and scope */
function groupRowSentence(event: AuditEvent, person: string, group: string, on: string): string {
    // An assignment: the Entra sentence says what happened, with the role, scope and group in place of the group's access
    if (event.kind === "assignment") {
        const through = `${on} through ${group}`;
        const access = event.role.name.trim();
        return access !== "" && event.sentence.includes(access) ? event.sentence.replace(access, through) : `${event.sentence}: ${through}`;
    }
    if (event.result === "failure") return `Activation of ${on} by ${person} through ${group} ${event.denied ? "denied" : "failed"}`;
    if (event.requestOnly) return `${person} requested activation of ${on} through ${group}`;
    return `${person} activated ${on} through ${group}`;
}

/**
 * One row per Azure role a group holds, for each activation of or assignment to membership of that group, whatever its outcome
 * (Joël, 2026-11-07): failed, denied and waiting ones show as they do for a direct one. The row keeps all the event tells,
 * such as who the person is, the approver and how long it was used. No activation only counts the completed ones.
 */
export function expandGroupActivations(groupEvents: readonly AuditEvent[], holdings: readonly GroupHolding[], context: Pick<AzureAuditContext, "scopeName">): AuditEvent[] {
    const out: { timeMs: number; event: AuditEvent }[] = [];
    for (const event of groupEvents) {
        if (event.environment !== "group" || (event.kind !== "usage" && event.kind !== "assignment")) continue;
        if (accessOfEvent(event) === "owner") continue;
        const groupId = event.role.id.trim().toLowerCase();
        if (groupId === "") continue;
        const group = groupNameOfEvent(event);
        const person = event.target?.name.trim() || (event.actor.kind === "person" ? event.actor.name.trim() : "") || personIdOf(event);
        for (const holding of holdings) {
            if (holding.groupId.toLowerCase() !== groupId) continue;
            const { scope, azure } = scopeOf(holding.scopeId, (id) => context.scopeName(id));
            const row: AuditEvent = {
                ...event,
                id: `${event.id}|${holding.roleId}|${holding.scopeId}`.toLowerCase(),
                sentence: groupRowSentence(event, person, group, `${holding.roleName} on ${scope}`),
                role: { id: holding.roleId, name: holding.roleName },
                scope,
                viaGroup: group,
            };
            // What only an Entra role has: an Azure row never shows them
            delete row.directoryScopeId;
            delete row.mfa;
            if (azure) row.azure = azure;
            out.push({ timeMs: ms(event.time), event: row });
        }
    }
    return out.sort((a, b) => sortKey(b.timeMs) - sortKey(a.timeMs)).map((row) => row.event);
}

// Holder kinds ---------------------------------------------------------------------------------------------------------

const AGENT_KINDS: Record<string, PrincipalKind> = { agentidentity: "agentIdentity", agentserviceprincipal: "agentIdentity", agentuser: "agentUser" };

/**
 * The kind of each app or agent the events name, by lower case id. The PIM request and assignment lists tell an agent
 * from an app (measured); Graph's `servicePrincipalType` wins over them. Other principal types make no entry, and an id
 * nothing knows stays unknown.
 */
export function buildAzureHolderKinds(input: {
    requests: readonly RawArmRequest[];
    assignments: readonly { principalId: string; principalType: string }[];
    servicePrincipalTypes: ReadonlyMap<string, string>;
}): Map<string, PrincipalKind> {
    const kinds = new Map<string, PrincipalKind>();
    const note = (idRaw: unknown, typeRaw: unknown) => {
        const id = text(idRaw).toLowerCase();
        const type = text(typeRaw).toLowerCase();
        if (id === "") return;
        const agent = AGENT_KINDS[type];
        if (agent) kinds.set(id, agent);
        else if (type === "serviceprincipal" && !kinds.has(id)) kinds.set(id, "servicePrincipal");
    };
    for (const request of input.requests) {
        if (isRecord(request) && isRecord(request.properties)) note(request.properties.principalId, request.properties.principalType);
    }
    for (const assignment of input.assignments) note(assignment.principalId, assignment.principalType);
    for (const [id, type] of input.servicePrincipalTypes) {
        const key = text(id).toLowerCase();
        if (key !== "") kinds.set(key, type.toLowerCase() === "serviceidentity" ? "agentIdentity" : "servicePrincipal");
    }
    return kinds;
}
