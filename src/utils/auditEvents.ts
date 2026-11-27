/**
 * Turns raw directoryAudits rows into audit events for the Entra Audit page (implementation spec section 2).
 * Pure: no Graph, no state. Only the fields named here reach the model; everything else in a row is dropped.
 */
import { isGuestUpn } from "@/utils/holderKinds";
import type { AuditActor, AuditEnvironment, AuditEvent, AuditKind, RawDirectoryAudit } from "@/types/audit.types";

const MINUTE_MS = 60_000;
/** A direct add and its outside-PIM alert within this window are one action (rule 5) */
const DIRECT_ADD_WINDOW_MS = 5 * MINUTE_MS;

const CORE_DIRECTORY = "Core Directory";
const MS_PIM = "MS-PIM";
const RESOURCE_CATEGORY = "ResourceManagement";
const GROUP_CATEGORY = "GroupManagement";
const POLICY_TYPE = "UpdatePolicy";
const ALERT_TYPE = "RoleElevatedOutsidePimAlert";
const DEACTIVATION_TYPE = "DeactivateRole";
const REMOVAL_REQUEST_TYPE = "CreateRoleRemovalRequest";
const EXPIRY_TYPE = "RemoveActivatedRole";
const EXPIRY_TYPES: ReadonlySet<string> = new Set([EXPIRY_TYPE, "RemoveActivatedRoleExpiredOver30Days"]);
const ROLE_DISPLAY_NAME = "Role.DisplayName";
const ROLE_TEMPLATE_ID = "Role.TemplateId";
const SCOPE_ORIGIN_ID = "ScopedResourceOriginId";

const APPROVAL_REQUEST_TYPE = "RequestApprovalRoleActivation";
const APPROVE_TYPE = "ApproveRoleActivation";
const REJECT_TYPE = "RejectRoleActivation";
/** One activation with approval has two correlation ids: the request, and the decision with the completion (measured) */
const APPROVAL_FLOW_TYPES: ReadonlySet<string> = new Set([APPROVAL_REQUEST_TYPE, APPROVE_TYPE, REJECT_TYPE]);
const USAGE_TYPES: ReadonlySet<string> = new Set(["CreateRequestRoleActivation", "ActivateRole", ...APPROVAL_FLOW_TYPES]);
const ASSIGNMENT_PATTERNS: readonly RegExp[] = [
    /^CreateRequest.*EligibleRole/,
    /^CreateRequest.*GrantedRole/,
    /^AssignEligibleRole$/,
    /^AssignGrantedRole$/,
    /^AdminRemove/,
    /^RemoveEligibleRole$/,
    /^CreateRoleUpdateRequest$/,
    /^CreateRoleRemovalRequest$/,
];

/** Whole minutes from one time to a later one; undefined when a time is missing or the end is before the start */
export function wholeMinutes(fromMs: number, toMs: number): number | undefined {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return undefined;
    return Math.floor((toMs - fromMs) / MINUTE_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function records(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Removes the quotes Graph puts around a modified value, for example "\"Exchange Administrator\"" */
function unquote(value: string): string {
    return value.length >= 2 && value.startsWith("\"") && value.endsWith("\"") ? value.slice(1, -1).trim() : value;
}

function isAssignmentType(type: string): boolean {
    return ASSIGNMENT_PATTERNS.some((pattern) => pattern.test(type));
}

function isDecisionType(type: string): boolean {
    return type === APPROVE_TYPE || type === REJECT_TYPE;
}

/** A row that says something was asked or decided, not that it happened: without a completion the action is not done */
function isRequestType(type: string): boolean {
    return type.startsWith("CreateRequest") || type === APPROVAL_REQUEST_TYPE || isDecisionType(type);
}

interface Target {
    isGuest: boolean;
    type: string;
    id: string;
    name: string;
    modified: { name: string; oldValue: string; newValue: string }[];
}

/** One raw row after the drop rules, with the values the rules read */
interface Parsed {
    id: string;
    correlationId: string;
    category: string;
    service: string;
    type: string;
    activity: string;
    failed: boolean;
    resultReason: string;
    timeMs: number;
    details: Map<string, string>;
    targets: Target[];
    person: AuditActor | null;
    /** The initiating user has a user principal name: a person. The PIM service initiates as a user without one (measured, AU-17). */
    isByPerson: boolean;
    appName: string;
}

/** The row for the drop rules: null when the row is not shown at all */
function parse(row: RawDirectoryAudit): Parsed | null {
    if (typeof row !== "object" || row === null) return null;
    const category = text(row.category);
    const service = text(row.loggedByService);
    const appName = text(row.initiatedBy?.app?.displayName);
    if (category === RESOURCE_CATEGORY) return null;
    if (service === CORE_DIRECTORY && appName === MS_PIM) return null;
    const timeMs = Date.parse(text(row.activityDateTime));
    if (!Number.isFinite(timeMs)) return null;

    const details = new Map<string, string>();
    for (const detail of records(row.additionalDetails)) {
        const key = text(detail.key);
        if (key && !details.has(key)) details.set(key, text(detail.value));
    }

    const targets: Target[] = records(row.targetResources).map((target) => ({
        type: text(target.type),
        id: text(target.id),
        // A Core Directory target has a UPN and no display name (measured)
        name: text(target.displayName) || text(target.userPrincipalName),
        isGuest: isGuestUpn(text(target.userPrincipalName)),
        modified: records(target.modifiedProperties).map((property) => ({
            name: text(property.displayName),
            oldValue: text(property.oldValue),
            newValue: text(property.newValue),
        })),
    }));

    const user = row.initiatedBy?.user;
    const person: AuditActor | null = typeof user === "object" && user !== null
        ? { name: text(user.displayName), id: text(user.id), kind: "person", ...(isGuestUpn(text(user.userPrincipalName)) ? { isGuest: true } : {}) }
        : null;

    return {
        id: text(row.id),
        correlationId: text(row.correlationId),
        category,
        service,
        type: details.get("AuditType") ?? "",
        activity: text(row.activityDisplayName),
        failed: text(row.result).toLowerCase() === "failure",
        resultReason: text(row.resultReason),
        timeMs,
        details,
        targets,
        person,
        isByPerson: person !== null && text(user?.userPrincipalName) !== "",
        appName,
    };
}

/**
 * The key that ties rows into one action (rule 4). Never the request id when there is a correlation id: one request id
 * was measured across a month of daily expiry attempts. The end of an activation can share the correlation id of its
 * start, so it is keyed apart and linked by rule 6 instead.
 */
function mergeKey(row: Parsed): string | null {
    const base = row.correlationId ? `c:${row.correlationId}` : row.details.get("RequestId") ? `r:${row.details.get("RequestId")}` : null;
    if (base === null) return null;
    return EXPIRY_TYPES.has(row.type) ? `${base}:end` : base;
}

/** Groups the rows that share a key, each group in time order; a row without a key is its own group */
function mergeRows(rows: Parsed[]): Parsed[][] {
    const groups = new Map<string, Parsed[]>();
    rows.forEach((row, index) => {
        const key = mergeKey(row) ?? `row:${index}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return joinApprovalFlows([...groups.values()]).map((group) => [...group].sort((a, b) => a.timeMs - b.timeMs));
}

/**
 * Joins the groups of one activation with approval on `RoleAssignmentRequestId`. Only groups of an approval flow: a
 * deactivation carries the id of the activation it ends as well, and stays its own group for rule 6.
 */
function joinApprovalFlows(groups: Parsed[][]): Parsed[][] {
    const joined: Parsed[][] = [];
    const byRequest = new Map<string, Parsed[]>();
    for (const group of groups) {
        const requestId = group.some((row) => APPROVAL_FLOW_TYPES.has(row.type))
            ? group.map((row) => row.details.get("RoleAssignmentRequestId") ?? "").find((id) => id !== "")
            : undefined;
        const existing = requestId ? byRequest.get(requestId) : undefined;
        if (existing) {
            existing.push(...group);
            continue;
        }
        const copy = [...group];
        joined.push(copy);
        if (requestId) byRequest.set(requestId, copy);
    }
    return joined;
}

function classify(events: Parsed[]): AuditKind {
    if (events.some((event) => event.type === POLICY_TYPE)) return "setting";
    if (events.some((event) => USAGE_TYPES.has(event.type))) return "usage";
    if (events.some((event) => event.type === ALERT_TYPE || (event.service === CORE_DIRECTORY && event.person !== null))) {
        return "outside";
    }
    if (events.some((event) => isAssignmentType(event.type))) return "assignment";
    return "system";
}

function actorOf(events: Parsed[]): AuditActor {
    const withPerson = events.find((event) => event.person !== null);
    if (withPerson?.person) return withPerson.person;
    const appName = events.find((event) => event.appName !== "")?.appName ?? "";
    return { name: appName, id: "", kind: "system" };
}

function findTarget(events: Parsed[], type: string): Target | undefined {
    for (const event of events) {
        const found = event.targets.find((target) => target.type === type);
        if (found) return found;
    }
    return undefined;
}

function firstDetail(events: Parsed[], key: string): string {
    return events.map((event) => event.details.get(key) ?? "").find((value) => value !== "") ?? "";
}

/** The role name of a PIM row (its Role target), or of a Core Directory row (its modified Role.DisplayName) */
function roleNameOf(events: Parsed[]): string {
    const named = findTarget(events, "Role")?.name;
    if (named) return named;
    for (const event of events) {
        for (const target of event.targets) {
            const property = target.modified.find((entry) => entry.name === ROLE_DISPLAY_NAME);
            if (property) return unquote(property.newValue || property.oldValue);
        }
    }
    return "";
}

/**
 * The role id of a PIM row is its template id. The Role target of a Core Directory row holds the object id of the role in the
 * directory instead, and the template id stands in its modified properties (measured), with quotes to strip.
 */
function roleIdOf(events: Parsed[]): string {
    const roleTargets = events.flatMap((event) => event.targets.filter((target) => target.type === "Role"));
    const named = roleTargets.find((target) => target.name !== "");
    if (named) return named.id;
    for (const event of events) {
        for (const target of event.targets) {
            const property = target.modified.find((entry) => entry.name === ROLE_TEMPLATE_ID);
            if (property) return unquote(property.newValue || property.oldValue);
        }
    }
    return roleTargets[0]?.id ?? "";
}

function assignmentVerb(types: string[]): string | null {
    if (types.some((type) => /RenewEligibleRole/.test(type))) return "renewed";
    if (types.includes("CreateRoleUpdateRequest")) return "updated";
    // Any row: the request of a removal comes first and is called CreateRequestEligibleRoleRemoval (measured)
    if (types.includes("CreateRoleRemovalRequest") || types.some((type) => /Remov/.test(type) && /(Eligible|Granted)Role/.test(type))) return "removed";
    const type = types.find(isAssignmentType) ?? "";
    if (/EligibleRole/.test(type)) return "eligible";
    if (/GrantedRole/.test(type)) return "active";
    return null;
}

/** "add" or "remove" from an activity name of a direct change or alert, otherwise null */
function directionOf(activity: string): "add" | "remove" | null {
    if (/^add member/i.test(activity)) return "add";
    if (/^remove member/i.test(activity)) return "remove";
    return null;
}

function sentenceOf(kind: AuditKind, events: Parsed[], primary: Parsed, subject: string, roleName: string, failed: boolean): string {
    const fallback = primary.activity;
    // No completion in the log: waiting for approval, or not yet logged. Never say it happened.
    const requestOnly = events.every((event) => isRequestType(event.type));
    if (kind === "setting") return roleName ? `Setting changed for ${roleName}` : fallback;
    if (!roleName || (kind !== "system" && !subject)) return fallback;
    if (kind === "usage") {
        if (events.some((event) => event.type === REJECT_TYPE)) return `Activation of ${roleName} by ${subject} denied`;
        if (failed) return `Activation of ${roleName} by ${subject} failed`;
        return requestOnly ? `${subject} requested activation of ${roleName}` : `${subject} activated ${roleName}`;
    }
    if (kind === "outside") {
        const direction = directionOf(primary.activity);
        if (direction === "add") return `${subject} added to ${roleName} outside PIM`;
        if (direction === "remove") return `${subject} removed from ${roleName} outside PIM`;
        return fallback;
    }
    if (kind === "assignment") {
        const verb = assignmentVerb(events.map((event) => event.type));
        if (!failed && requestOnly) return `Assignment of ${subject} for ${roleName} requested`;
        // Measured: a deactivation too soon after activating logs a failed removal request
        if (failed && verb === "removed") return `Removal of ${subject} from ${roleName} failed`;
        if (verb === "updated") return `Assignment of ${subject} for ${roleName} updated`;
        if (verb === "renewed") return `Eligible assignment of ${subject} for ${roleName} renewed`;
        if (verb === "removed") return `${subject} removed from ${roleName}`;
        if (verb === "eligible") return `${subject} made eligible for ${roleName}`;
        if (verb === "active") return `${subject} made active for ${roleName}`;
    }
    return fallback;
}

/** A merged row before the links between rows are made */
interface Row {
    event: AuditEvent;
    timeMs: number;
    isAlert: boolean;
    /** Set on an outside-PIM add (alert or direct change) so the pair can be found (rule 5) */
    pairKey: string | null;
    raIds: string[];
    /** How an activation ended: by the person, by the time running out, or by an admin removing what it came from */
    endKind: "deactivation" | "expiry" | "removal" | null;
    succeeded: boolean;
}

function buildRow(events: Parsed[]): Row {
    const decision = events.find((event) => isDecisionType(event.type));
    const denied = decision?.type === REJECT_TYPE;
    const primary = events.find((event) => !isRequestType(event.type)) ?? (denied ? decision : events[0]);
    // A decision row has the approver as initiator and the approver's text as Justification (measured); it speaks only for the decision
    const ownRows = events.filter((event) => !isDecisionType(event.type));
    const types = events.map((event) => event.type);
    // A removal request the person makes on their own role, refused, is a deactivation that came too soon (measured, AU-17)
    const selfDeactivation = types.includes(REMOVAL_REQUEST_TYPE) && events.some((event) => event.failed)
        && ownRows.some((event) => event.person !== null && event.person.id !== "" && event.person.id === findTarget(ownRows, "User")?.id);
    const kind: AuditKind = selfDeactivation ? "usage" : classify(events);
    const environment: AuditEnvironment = events.some((event) => event.category === GROUP_CATEGORY) ? "group" : "role";
    const failed = denied || events.some((event) => event.failed);

    // Only the decision in the log (the request fell outside the read, or is not logged yet): its User target is the
    // approver (measured on roles and groups), so it names the requester only when it is somebody else
    const decisionTarget = decision ? findTarget([decision], "User") : undefined;
    const requesterOfDecision = decisionTarget && decisionTarget.id !== decision?.person?.id ? decisionTarget : undefined;
    // An assignment or a direct change can be to a group, which then is its only subject (measured). On an activation through a group the User target comes first.
    const personTarget = ownRows.length === 0
        ? requesterOfDecision
        : findTarget(ownRows, "User") ?? findTarget(ownRows, "ServicePrincipal") ?? (kind === "assignment" || kind === "outside" ? findTarget(ownRows, "Group") : undefined);
    const actor: AuditActor = ownRows.length === 0
        ? { name: personTarget?.name ?? "", id: personTarget?.id ?? "", kind: "person" }
        : actorOf(ownRows);
    const targetName = personTarget?.name ?? "";
    // An outside-PIM row names the person it changed, never its initiator; other rows fall back to the actor (rule 4a)
    const subject = targetName || (kind === "outside" || actor.kind !== "person" ? "" : actor.name);

    let role: { name: string; id: string };
    if (environment === "group") {
        const group = findTarget(events, "Other");
        const memberKind = findTarget(events, "Role")?.name ?? "";
        const groupName = group?.name ?? "";
        const label = /^(member|owner)$/i.test(memberKind) ? `${memberKind.toLowerCase()} of ${groupName}` : groupName;
        role = { name: groupName ? label : "", id: group?.id ?? "" };
    } else {
        role = { name: roleNameOf(events), id: roleIdOf(events) };
    }
    const roleName = role.name;

    const event: AuditEvent = {
        id: primary.id,
        time: new Date(primary.timeMs).toISOString(),
        kind,
        environment,
        sentence: selfDeactivation && roleName && subject ? `Deactivation of ${roleName} by ${subject} refused` : sentenceOf(kind, events, primary, subject, roleName, failed),
        actor,
        role,
        scope: findTarget(events, "Directory")?.name ?? "",
        result: failed ? "failure" : "success",
        source: "graph",
        correlationId: primary.correlationId,
    };
    // Measured on assignments and activations: `/administrativeUnits/{id}` or `/{id}` on scoped events, absent on tenant-wide ones. Never filled in for an absent one.
    const scopeId = firstDetail(events, SCOPE_ORIGIN_ID);
    if (scopeId) event.directoryScopeId = scopeId;
    if (!failed && (kind === "usage" || kind === "assignment") && events.every((entry) => isRequestType(entry.type))) event.requestOnly = true;
    if (personTarget && (personTarget.name || personTarget.id)) {
        event.target = { name: personTarget.name, id: personTarget.id };
        if (personTarget.type === "Group") event.targetIsGroup = true;
        if (personTarget.type === "ServicePrincipal") event.targetIsApp = true;
        if (personTarget.isGuest) event.targetIsGuest = true;
    }
    // A role activation through an eligible group names the group as a Group target next to the person (measured, AU-17)
    if (kind === "usage" && environment === "role" && personTarget?.type === "User") {
        const group = findTarget(ownRows, "Group");
        if (group?.name) event.viaGroup = group.name;
    }
    if (failed) {
        const reason = events.find((entry) => entry.failed && entry.resultReason)?.resultReason;
        if (reason) event.failureReason = reason;
    }
    if (decision?.person?.name) event.approver = decision.person.name;
    if (denied) event.denied = true;
    const ticketNumber = firstDetail(events, "TicketNumber");
    const ticketSystem = firstDetail(events, "TicketSystem");
    if (ticketNumber) event.ticket = ticketSystem ? `${ticketNumber} (${ticketSystem})` : ticketNumber;
    const justification = firstDetail(ownRows, "Justification");
    if (justification) {
        if (kind === "setting") event.newValue = justification;
        else event.reason = justification;
    }
    const requested = wholeMinutes(Date.parse(firstDetail(events, "StartTime")), Date.parse(firstDetail(events, "ExpirationTime")));
    if (requested !== undefined) event.requestedDuration = requested;
    const endMs = Date.parse(firstDetail(events, "ExpirationTime"));
    if (kind === "assignment" && Number.isFinite(endMs)) event.endsAt = new Date(endMs).toISOString();
    const mfa = firstDetail(events, "IsAuthenticatedWithMfa").toLowerCase();
    if (mfa === "true" || mfa === "false") event.mfa = mfa === "true";

    const raIds = [...new Set(events.map((entry) => entry.details.get("RoleAssignmentRequestId") ?? "").filter((id) => id !== ""))];
    const isAlert = types.includes(ALERT_TYPE);
    const direction = directionOf(primary.activity);
    const coreAdd = events.some((entry) => entry.service === CORE_DIRECTORY && entry.person !== null);
    const pairKey = direction === "add" && (isAlert || coreAdd)
        ? [roleName.toLowerCase(), personTarget?.id || targetName, actor.id || actor.name].join("|")
        : null;

    let endKind: Row["endKind"] = null;
    if (types.includes(DEACTIVATION_TYPE)) endKind = "deactivation";
    // The same type is written when an admin removes the eligibility; only the initiator tells it from the time running out
    else if (types.includes(EXPIRY_TYPE)) endKind = events.some((entry) => entry.type === EXPIRY_TYPE && entry.isByPerson) ? "removal" : "expiry";

    return {
        event,
        timeMs: primary.timeMs,
        isAlert,
        pairKey,
        raIds,
        endKind,
        succeeded: !failed,
    };
}

/**
 * Maps directoryAudits rows to audit events, newest first.
 * Drops Core Directory rows initiated by MS-PIM and everything in ResourceManagement; merges rows of one action;
 * folds a deactivation into the activation it ends; merges an admin's assignment request with its completion; merges an
 * outside-PIM alert with the direct add it reports.
 */
export function mapAuditEvents(rows: RawDirectoryAudit[]): AuditEvent[] {
    const parsed = rows.map(parse).filter((row): row is Parsed => row !== null);
    const built = mergeRows(parsed).map(buildRow);

    // Rule 6: a successful end whose RoleAssignmentRequestId matches a successful activation
    const activationByRequest = new Map<string, Row>();
    for (const row of built) {
        if (row.event.kind !== "usage" || !row.succeeded) continue;
        for (const raId of row.raIds) if (!activationByRequest.has(raId)) activationByRequest.set(raId, row);
    }
    const dropped = new Set<Row>();
    for (const end of built) {
        if (end.endKind === null || !end.succeeded) continue;
        const activation = end.raIds.map((raId) => activationByRequest.get(raId)).find((row) => row !== undefined);
        if (!activation || activation.event.usedMinutes !== undefined) continue;
        const usedMinutes = wholeMinutes(activation.timeMs, end.timeMs);
        if (usedMinutes === undefined) continue;
        const endedBy = end.endKind === "expiry" ? undefined : end.event.actor;
        activation.event = {
            ...activation.event,
            usedMinutes,
            endedAt: end.event.time,
            ...(endedBy ? { endedBy } : {}),
        };
        // A deactivation or a removal linked to an activation is not a row of its own (the removal has its own assignment
        // rows); an expiry stays as a System row
        if (end.endKind !== "expiry") dropped.add(end);
    }

    // Rule 6b: an admin's request for an assignment and the PIM completion of it share a RoleAssignmentRequestId (measured, AU-17):
    // one row, with the completion's sentence and kind, the requester as actor and the time of the request. The completion
    // is "Starts" only when it came more than a minute after the request. A request without a completion stays as it is.
    const requestByRaId = new Map<string, Row>();
    for (const row of built) {
        if (row.event.kind !== "assignment" || row.event.requestOnly !== true) continue;
        for (const raId of row.raIds) if (!requestByRaId.has(raId)) requestByRaId.set(raId, row);
    }
    const paired = new Set<Row>();
    for (const done of built) {
        if (done.event.kind !== "assignment" || !done.succeeded || done.event.requestOnly === true) continue;
        const request = done.raIds.map((raId) => requestByRaId.get(raId)).find((row) => row !== undefined && !paired.has(row));
        if (!request) continue;
        paired.add(request);
        dropped.add(request);
        const laterBy = done.timeMs - request.timeMs;
        done.event = {
            ...done.event,
            actor: request.event.actor,
            time: request.event.time,
            ...(laterBy > MINUTE_MS ? { startsAt: done.event.time } : {}),
        };
        done.timeMs = request.timeMs;
    }

    // Rule 5: an outside-PIM alert and the direct add it reports, within the window, are one row (the first)
    const pairs = built.filter((row) => row.pairKey !== null).sort((a, b) => a.timeMs - b.timeMs);
    const taken = new Set<Row>();
    for (const alert of pairs.filter((row) => row.isAlert)) {
        const partner = pairs.find((row) => !row.isAlert && !taken.has(row) && row.pairKey === alert.pairKey
            && Math.abs(row.timeMs - alert.timeMs) <= DIRECT_ADD_WINDOW_MS);
        if (!partner) continue;
        taken.add(alert);
        taken.add(partner);
        const [first, later] = partner.timeMs > alert.timeMs ? [alert, partner] : [partner, alert];
        dropped.add(later);
        // The Core Directory row has only a UPN; the alert has the display name
        const shownName = first.event.target?.name ?? "";
        const betterName = later.event.target?.name ?? "";
        if (first.event.target && shownName.includes("@") && betterName && !betterName.includes("@")) {
            first.event = { ...first.event, sentence: first.event.sentence.replace(shownName, betterName), target: { ...first.event.target, name: betterName } };
        }
    }

    return built
        .filter((row) => !dropped.has(row))
        .sort((a, b) => b.timeMs - a.timeMs)
        .map((row) => row.event);
}
