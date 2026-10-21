import type { PimEligibilitySchedule, PimAssignmentSchedule, RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import {
    DASHBOARD_FILTER_KEYS,
    DASHBOARD_FILTER_VALUES,
    FILTER_KEY_VIEW,
    type DashboardFilter,
    type DashboardFilterKey,
    type FilterView,
} from "@/types/dashboardFilter.types";
import { getMaxDurationBucket, hasNoEnd, isActivated, isActivatedGroupAssignment, isAssignedActive, isPermanentActive, isTimeBoundActive } from "@/utils/assignmentKinds";
import { getRolesHeldByGroups, type RoleHeldByGroup } from "@/utils/groupsOutsidePim";
import { completeRules } from "@/utils/policyView";
import { parseTotalHours } from "@/utils/durationUtils";
import { getPrincipalKind, isAgentKind, type PrincipalKind } from "@/utils/principalUtils";
import { summarizePolicyRules, type PolicySummary } from "@/utils/policySummary";
import { isGuestUserType } from "@/utils/userTypeUtils";
import { getLinkedCustomExtensions, parseCustomExtensionRules } from "@/utils/customExtensionUtils";

/**
 * The filter model shared by the dashboard and the report (spec 4.6): URL form `f=key:value,key:value`,
 * parsing, serialising, labels, and one apply function per kind of data so that a dashboard number and the
 * report list behind it always come from the same code. Decisions per key are in docs/Assets/next-gen/dashboard/plans/ng-30-plan.md.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Custom extension ids are GUIDs in Graph; letters, digits, dot, dash and underscore keep the URL form safe */
const EXTENSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
    return (allowed as readonly string[]).includes(value);
}

/** Reads one `key:value` pair into the filter; returns false when the pair is not valid. */
function applyPair(filter: DashboardFilter, key: string, value: string): boolean {
    switch (key) {
        case "assignment":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.assignment, value)) return false;
            filter.assignment = value;
            return true;
        case "approval":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.approval, value)) return false;
            filter.approval = value;
            return true;
        case "mfa":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.mfa, value)) return false;
            filter.mfa = value;
            return true;
        case "justification":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.justification, value)) return false;
            filter.justification = value;
            return true;
        case "maxDuration":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.maxDuration, value)) return false;
            filter.maxDuration = value;
            return true;
        case "principalType":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.principalType, value)) return false;
            filter.principalType = value;
            return true;
        case "via":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.via, value)) return false;
            filter.via = value;
            return true;
        case "activationNotification":
            if (!isOneOf(DASHBOARD_FILTER_VALUES.activationNotification, value)) return false;
            filter.activationNotification = value;
            return true;
        case "privileged":
        case "customRole":
        case "excludeEmergency":
            if (value !== "true" && value !== "false") return false;
            filter[key] = value === "true";
            return true;
        case "noEndDate":
            // Only the positive form exists: "eligible without an end date"
            if (value !== "true") return false;
            filter.noEndDate = true;
            return true;
        case "hasEligible":
            if (value !== "false") return false;
            filter.hasEligible = false;
            return true;
        case "groupPim":
        case "entraRoles":
        case "accessType":
        case "appliesTo":
            if (!isOneOf(DASHBOARD_FILTER_VALUES[key], value)) return false;
            (filter as Record<string, string>)[key] = value;
            return true;
        case "hasAssignments":
        case "givesPrivileged":
            if (value !== "true") return false;
            filter[key] = true;
            return true;
        case "roleTemplateId":
            if (!GUID.test(value)) return false;
            filter.roleTemplateId = value.toLowerCase();
            return true;
        case "customExtension":
            if (!EXTENSION_ID.test(value)) return false;
            filter.customExtension = value;
            return true;
        default:
            return false;
    }
}

/**
 * Parses the `f` parameter. Unknown keys, unknown values and malformed pairs are ignored; when a key
 * repeats the last valid pair wins. Accepts the raw form (`mfa:neither`) and the percent-encoded form.
 */
export function parseDashboardFilter(raw: string | null | undefined): DashboardFilter {
    const filter: DashboardFilter = {};
    if (!raw) return filter;

    let text = raw.trim();
    if (text.includes("%")) {
        try {
            text = decodeURIComponent(text);
        } catch {
            // keep the text as it came
        }
    }

    for (const pair of text.split(",")) {
        const separator = pair.indexOf(":");
        if (separator < 1) continue;
        applyPair(filter, pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
    return filter;
}

export function isEmptyDashboardFilter(filter: DashboardFilter): boolean {
    return DASHBOARD_FILTER_KEYS.every((key) => filter[key] === undefined);
}

export function getActiveFilterKeys(filter: DashboardFilter): DashboardFilterKey[] {
    return DASHBOARD_FILTER_KEYS.filter((key) => filter[key] !== undefined);
}

/** `key:value` pairs in the fixed key order, joined by commas. Empty string for an empty filter. */
export function serializeDashboardFilter(filter: DashboardFilter): string {
    return getActiveFilterKeys(filter)
        .map((key) => `${key}:${String(filter[key])}`)
        .join(",");
}

/**
 * Query string (without `?`) that keeps every other parameter and sets `f` raw, so links read
 * `?f=mfa:neither` instead of `?f=mfa%3Aneither`. An empty filter removes `f`.
 */
export function buildSearchWithFilter(currentSearch: string, filter: DashboardFilter): string {
    const params = new URLSearchParams(currentSearch);
    params.delete("f");
    const rest = params.toString();
    const f = serializeDashboardFilter(filter);
    if (!f) return rest;
    return rest ? `${rest}&f=${f}` : `f=${f}`;
}

export function removeFilterKey(filter: DashboardFilter, key: DashboardFilterKey): DashboardFilter {
    const next: DashboardFilter = { ...filter };
    delete next[key];
    return next;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

const ASSIGNMENT_LABELS = { permanent: "permanent", eligible: "eligible", active: "active now", activeTimeBound: "active, time-bound", activated: "active after activation", assigned: "active, assigned" } as const;
const MFA_LABELS = { entraMfa: "Entra MFA", authContext: "authentication context", neither: "neither" } as const;
const REQUIRED_LABELS = { required: "required", notRequired: "not required" } as const;
const DURATION_LABELS = { upTo1h: "up to 1 h", upTo4h: "up to 4 h", upTo8h: "up to 8 h", upTo12h: "up to 12 h", over12h: "over 12 h", over8h: "over 8 h" } as const;
const VIA_LABELS = { direct: "directly", group: "through a group" } as const;

/** Names of role templates a filter can name without the role data at hand */
const KNOWN_ROLE_TEMPLATES: Record<string, string> = { "62e90394-69f5-4237-9190-012177145e10": "Global Administrator" };
const PRINCIPAL_LABELS = { user: "user", guest: "guest", servicePrincipal: "app", group: "group", agent: "agent" } as const;

export interface FilterLabel {
    key: DashboardFilterKey;
    label: string;
    /** Report: the key belongs to the other view and is not applied here, "(roles only)" or "(groups only)" */
    suffix?: string;
}

/** Names a chip can show instead of an id: role templates (lowercase id) and custom extensions (id). */
export interface FilterNames {
    roles: ReadonlyMap<string, string>;
    extensions: ReadonlyMap<string, string>;
}

/**
 * One readable label per active key, for the filter chip (spec 4.6). `names` turns the id of a role or custom extension
 * filter into its name; without it only well-known roles get a name.
 */
export function getFilterLabels(filter: DashboardFilter, names?: FilterNames): FilterLabel[] {
    return getActiveFilterKeys(filter).map((key) => ({ key, label: labelFor(filter, key, names) }));
}

/** Role and custom extension names from the loaded roles, for the labels of `getFilterLabels`. */
export function buildFilterNames(roles: RoleDetailData[]): FilterNames {
    const roleNames = new Map<string, string>();
    const extensions = new Map<string, string>();
    for (const role of roles) {
        if (role.definition.templateId) roleNames.set(role.definition.templateId.toLowerCase(), role.definition.displayName);
        for (const { link } of getLinkedCustomExtensions(parseCustomExtensionRules(role.policy?.details?.rules))) {
            if (link.displayName) extensions.set(link.customExtensionId, link.displayName);
        }
    }
    return { roles: roleNames, extensions };
}

function labelFor(filter: DashboardFilter, key: DashboardFilterKey, names?: FilterNames): string {
    switch (key) {
        case "assignment":
            return `Assignment: ${ASSIGNMENT_LABELS[filter.assignment!]}`;
        case "privileged":
            return filter.privileged ? "Privileged roles" : "Roles that are not privileged";
        case "approval":
            return `Approval on activation: ${REQUIRED_LABELS[filter.approval!]}`;
        case "mfa":
            return `MFA on activation: ${MFA_LABELS[filter.mfa!]}`;
        case "justification":
            return `Justification on activation: ${REQUIRED_LABELS[filter.justification!]}`;
        case "maxDuration":
            return `Maximum activation: ${DURATION_LABELS[filter.maxDuration!]}`;
        case "principalType":
            return `Held by: ${PRINCIPAL_LABELS[filter.principalType!]}`;
        case "noEndDate":
            return "Eligible without an end date";
        case "activationNotification":
            return "Nobody notified on activation";
        case "hasEligible":
            return "No eligible assignments";
        case "roleTemplateId": {
            const name = names?.roles.get(filter.roleTemplateId!) ?? KNOWN_ROLE_TEMPLATES[filter.roleTemplateId!];
            return name ? `Role: ${name}` : `Role template ${filter.roleTemplateId}`;
        }
        case "via":
            return `Held ${VIA_LABELS[filter.via!]}`;
        case "customExtension":
            return `Custom extension: ${names?.extensions.get(filter.customExtension!) ?? filter.customExtension}`;
        case "customRole":
            return filter.customRole ? "Custom roles" : "Built-in roles";
        case "excludeEmergency":
            return filter.excludeEmergency ? "Emergency access accounts left out" : "Emergency access accounts included";
        case "hasAssignments":
            return "Has assignments";
        case "groupPim":
            return filter.groupPim === "outside" ? "Outside PIM" : "Under PIM";
        case "entraRoles":
            return REPORT_ENTRA_ROLES_LABELS[filter.entraRoles!];
        case "givesPrivileged":
            return "Gives a privileged role";
        case "accessType":
            return filter.accessType === "owner" ? "Owner assignments" : "Member assignments";
        case "appliesTo":
            return "Settings of the Owner policy";
    }
}

const REPORT_ENTRA_ROLES_LABELS = { holds: "Holds roles", assignableNone: "Role-assignable, no roles", notAssignable: "Not role-assignable" } as const;

/** What the Report chips say where it differs from the dashboard bar (render: "Privileged only") */
const REPORT_LABEL_OVERRIDES: Partial<Record<DashboardFilterKey, (filter: DashboardFilter) => string>> = {
    privileged: (filter) => (filter.privileged ? "Privileged only" : "Not privileged"),
    customRole: (filter) => (filter.customRole ? "Custom roles" : "Built-in roles"),
};

/**
 * The chip labels of the Report for one view: every active key, a key of the other view marked with a suffix instead of
 * hidden (Report spec 6.2). Names turn ids into names as in `getFilterLabels`.
 */
export function getReportFilterLabels(filter: DashboardFilter, view: FilterView, names?: FilterNames): FilterLabel[] {
    return getActiveFilterKeys(filter).map((key) => {
        const keyView = FILTER_KEY_VIEW[key];
        const label = REPORT_LABEL_OVERRIDES[key]?.(filter) ?? labelFor(filter, key, names);
        return keyView === "both" || keyView === view ? { key, label } : { key, label, suffix: `(${keyView} only)` };
    });
}

/** The filter reduced to the keys of one view; the other view's keys stay in the URL but do not narrow this view. */
export function keysOfView(filter: DashboardFilter, view: FilterView): DashboardFilter {
    const result: DashboardFilter = {};
    for (const key of getActiveFilterKeys(filter)) {
        const keyView = FILTER_KEY_VIEW[key];
        if (keyView === "both" || keyView === view) (result as Record<string, unknown>)[key] = filter[key];
    }
    return result;
}

/** How many keys count for a view (the badge of the Filters button and the count under the toolbar). */
export function countKeysOfView(filter: DashboardFilter, view: FilterView): number {
    return getActiveFilterKeys(keysOfView(filter, view)).length;
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

export interface ApplyFilterOptions {
    /** Principal ids marked as emergency access accounts (NG-18). Empty until that exists. */
    emergencyAccountIds?: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

/** Keys whose test is made on a single assignment (the same assignment must satisfy all set ones). */
const ASSIGNMENT_BOUND_KEYS: readonly DashboardFilterKey[] = ["assignment", "principalType", "via", "noEndDate"];
/** Keys a group row can answer; any other set key means the filter says nothing about groups. */
const GROUP_KEYS: readonly DashboardFilterKey[] = ["assignment", "principalType", "via", "noEndDate", "hasEligible", "excludeEmergency"];

/** True when every set key is one that groups can answer; otherwise the report and dashboard show no groups. */
export function filterAppliesToGroups(filter: DashboardFilter): boolean {
    // Group assignments carry no userType, so guests cannot be told apart: the key says nothing about groups
    if (filter.principalType === "guest") return false;
    return getActiveFilterKeys(filter).every((key) => GROUP_KEYS.includes(key));
}

export interface AssignmentFacts {
    /** The schedule or assignment id, for row marking (Report spec 6.3) */
    id: string;
    principalId: string;
    displayName?: string;
    kind: PrincipalKind;
    isGuest: boolean;
    /** Held through a group: the principal is a group, or the activation came through membership of one (Report spec 5.6) */
    isViaGroup: boolean;
    isPermanent: boolean;
    isActivated: boolean;
    /** An active assignment made directly by an administrator, with or without an end (Report `assignment:assigned`) */
    isAssigned: boolean;
    isTimeBound: boolean;
    isEligible: boolean;
    isEligibleWithoutEnd: boolean;
    /** Groups only: a membership or an ownership */
    accessType?: "member" | "owner";
}

function matchesAssignmentKeys(fact: AssignmentFacts, filter: DashboardFilter, emergency: ReadonlySet<string>): boolean {
    switch (filter.assignment) {
        case "permanent":
            if (!fact.isPermanent) return false;
            break;
        case "eligible":
            if (!fact.isEligible) return false;
            break;
        case "active":
            if (!fact.isActivated) return false;
            break;
        case "activeTimeBound":
            if (!fact.isTimeBound) return false;
            break;
        case "activated":
            if (!fact.isActivated) return false;
            break;
        case "assigned":
            if (!fact.isAssigned) return false;
            break;
    }
    if (filter.accessType !== undefined && fact.accessType !== undefined && fact.accessType !== filter.accessType) return false;
    if (filter.noEndDate && !fact.isEligibleWithoutEnd) return false;
    switch (filter.principalType) {
        case "user":
            if (fact.kind !== "user") return false;
            break;
        case "guest":
            if (!fact.isGuest) return false;
            break;
        case "servicePrincipal":
            if (fact.kind !== "servicePrincipal") return false;
            break;
        case "group":
            if (fact.kind !== "group") return false;
            break;
        case "agent":
            if (!isAgentKind(fact.kind)) return false;
            break;
    }
    // The same split as "Direct or through a group": a group principal holds it through the group, anything else directly
    if (filter.via === "group" && !fact.isViaGroup) return false;
    if (filter.via === "direct" && fact.isViaGroup) return false;
    // Emergency access accounts are only left out of a test on assignments; alone the key does nothing
    if (filter.excludeEmergency === true && emergency.has(fact.principalId.toLowerCase())) return false;
    return true;
}

function hasAssignmentBoundKey(filter: DashboardFilter): boolean {
    return ASSIGNMENT_BOUND_KEYS.some((key) => filter[key] !== undefined);
}

type RoleSchedule = PimEligibilitySchedule | PimAssignmentSchedule;

/** One fact per eligible and active schedule of a role; the dashboard rows and the filter read the same facts. */
export function buildRoleAssignmentFacts(role: RoleDetailData, kindById: Map<string, PrincipalKind>, nameById?: Map<string, string>): AssignmentFacts[] {
    const resolve = (item: RoleSchedule) => {
        let kind = getPrincipalKind(item.principal);
        if (kind === "unknown") kind = kindById.get(item.principalId) ?? (item.principalUserType ? "user" : "unknown");
        return { kind, isGuest: isGuestUserType(item.principalUserType) };
    };

    const facts: AssignmentFacts[] = [];
    for (const item of role.assignments.eligible) {
        const resolved = resolve(item);
        facts.push({
            id: item.id,
            principalId: item.principalId,
            displayName: item.principal?.displayName ?? nameById?.get(item.principalId.toLowerCase()),
            ...resolved,
            isViaGroup: resolved.kind === "group",
            isPermanent: false,
            isActivated: false,
            isAssigned: false,
            isTimeBound: false,
            isEligible: true,
            isEligibleWithoutEnd: hasNoEnd(item),
        });
    }
    for (const item of role.assignments.active) {
        const resolved = resolve(item);
        facts.push({
            id: item.id,
            principalId: item.principalId,
            displayName: item.principal?.displayName ?? nameById?.get(item.principalId.toLowerCase()),
            ...resolved,
            isViaGroup: resolved.kind === "group" || (item as PimAssignmentSchedule).viaGroup === true,
            isPermanent: isPermanentActive(item),
            isActivated: isActivated(item),
            isAssigned: isAssignedActive(item),
            isTimeBound: isTimeBoundActive(item),
            isEligible: false,
            isEligibleWithoutEnd: false,
        });
    }
    return facts;
}

/** principalId to kind, from the expanded principal of every list (permanent, eligible and active schedules). */
export function buildKindById(roles: RoleDetailData[]): Map<string, PrincipalKind> {
    const kindById = new Map<string, PrincipalKind>();
    for (const role of roles) {
        for (const item of [...role.assignments.permanent, ...role.assignments.eligible, ...role.assignments.active]) {
            const kind = getPrincipalKind(item.principal);
            if (kind !== "unknown") kindById.set(item.principalId, kind);
        }
    }
    return kindById;
}

function matchesPolicyKeys(summary: PolicySummary, filter: DashboardFilter, linkedExtensionIds: string[] = []): boolean {
    if (filter.approval !== undefined) {
        if (!summary.isLoaded) return false;
        if ((summary.isApprovalRequired === true) !== (filter.approval === "required")) return false;
    }
    if (filter.justification !== undefined) {
        if (!summary.isLoaded) return false;
        if ((summary.isJustificationRequired === true) !== (filter.justification === "required")) return false;
    }
    if (filter.mfa !== undefined) {
        if (!summary.isLoaded) return false;
        const entraMfa = summary.hasPimMfa === true;
        const authContext = !entraMfa && summary.hasAuthContext === true;
        if (filter.mfa === "entraMfa" && !entraMfa) return false;
        if (filter.mfa === "authContext" && !authContext) return false;
        if (filter.mfa === "neither" && (entraMfa || authContext)) return false;
    }
    if (filter.maxDuration !== undefined) {
        if (!summary.isLoaded || !summary.maxDuration) return false;
        const hours = parseTotalHours(summary.maxDuration);
        if (filter.maxDuration === "over8h") {
            if (hours === null || hours <= 8) return false;
        } else if (getMaxDurationBucket(hours) !== filter.maxDuration) return false;
    }
    if (filter.customExtension !== undefined) {
        if (!summary.isLoaded || !linkedExtensionIds.includes(filter.customExtension)) return false;
    }
    if (filter.activationNotification === "none") {
        const rule = summary.activationNotification;
        if (!summary.isLoaded || !rule) return false;
        if (rule.isDefaultRecipientsEnabled || rule.notificationRecipients.length > 0) return false;
    }
    return true;
}

/** Roles that match every set key. Roles whose policy is not loaded match none of the policy keys. */
export function applyDashboardFilterToRoles(roles: RoleDetailData[], filter: DashboardFilter, options: ApplyFilterOptions = {}): RoleDetailData[] {
    return filterRoles(roles, filter, options, false);
}

/**
 * The Report's roles: the keys of the roles view (the groups-only keys stay in the URL and narrow nothing), with `hasAssignments`
 * on top of what the dashboard applies. Same code path as the dashboard for every shared key.
 */
export function applyReportFilterToRoles(roles: RoleDetailData[], filter: DashboardFilter, options: ApplyFilterOptions = {}): RoleDetailData[] {
    return filterRoles(roles, keysOfView(filter, "roles"), options, true);
}

function filterRoles(roles: RoleDetailData[], filter: DashboardFilter, options: ApplyFilterOptions, isReport: boolean): RoleDetailData[] {
    if (isEmptyDashboardFilter(filter)) return roles;

    const emergency = options.emergencyAccountIds ?? NO_IDS;
    const needsAssignments = hasAssignmentBoundKey(filter);
    const kindById = needsAssignments ? buildKindById(roles) : new Map<string, PrincipalKind>();

    return roles.filter((role) => {
        const { definition } = role;

        if (filter.privileged !== undefined && definition.isPrivileged !== filter.privileged) return false;
        if (filter.customRole !== undefined && definition.isBuiltIn !== !filter.customRole) return false;
        if (filter.roleTemplateId !== undefined && definition.templateId?.toLowerCase() !== filter.roleTemplateId) return false;

        if (filter.hasEligible === false && role.assignments.eligible.length > 0) return false;
        if (isReport && filter.hasAssignments && role.assignments.eligible.length + role.assignments.active.length === 0) return false;

        if (needsAssignments) {
            const facts = buildRoleAssignmentFacts(role, kindById);
            if (!facts.some((fact) => matchesAssignmentKeys(fact, filter, emergency))) return false;
        }

        if (hasPolicyKey(filter)) {
            const rules = role.policy?.details?.rules;
            const linked = filter.customExtension !== undefined ? getLinkedCustomExtensions(parseCustomExtensionRules(rules)).map((l) => l.link.customExtensionId) : [];
            if (!matchesPolicyKeys(summarizePolicyRules(rules), filter, linked)) return false;
        }

        return true;
    });
}

/** A key that reads the policy (approval, MFA, justification, duration, notification, extension): it matches nothing before the policy is loaded */
export function hasPolicyKey(filter: DashboardFilter): boolean {
    return filter.approval !== undefined || filter.justification !== undefined || filter.mfa !== undefined || filter.maxDuration !== undefined || filter.activationNotification !== undefined || filter.customExtension !== undefined;
}

function groupAssignmentFact(a: PimGroupData["assignments"][number]): AssignmentFacts {
    const kind = getPrincipalKind(a.principal);
    return {
        id: a.id,
        principalId: a.principalId,
        displayName: a.principal?.displayName,
        kind,
        isGuest: false,
        isViaGroup: kind === "group",
        accessType: a.accessType,
        isPermanent: a.assignmentType === "permanent",
        isActivated: isActivatedGroupAssignment(a),
        isAssigned: a.assignmentType !== "eligible" && a.assignmentOrigin === "assigned",
        isTimeBound: a.assignmentType !== "eligible" && !!a.endDateTime,
        isEligible: a.assignmentType === "eligible",
        isEligibleWithoutEnd: a.assignmentType === "eligible" && !a.endDateTime,
    };
}

/**
 * The roles and groups of a filtered dashboard with only the assignments that satisfy the assignment keys (assignment,
 * principalType, noEndDate): a click on "Permanent" then shows permanent assignments in every number, not the other
 * assignments of the roles that happen to have one. Without such a key nothing is narrowed.
 */
export function narrowAssignmentsToFilter(roles: RoleDetailData[], groups: PimGroupData[], filter: DashboardFilter, options: ApplyFilterOptions = {}): { roles: RoleDetailData[]; groups: PimGroupData[] } {
    if (!hasAssignmentBoundKey(filter)) return { roles, groups };
    const emergency = options.emergencyAccountIds ?? NO_IDS;
    const kindById = buildKindById(roles);
    const narrowedRoles = roles.map((role) => {
        const facts = buildRoleAssignmentFacts(role, kindById);
        const eligibleCount = role.assignments.eligible.length;
        return {
            ...role,
            assignments: {
                ...role.assignments,
                eligible: role.assignments.eligible.filter((_, i) => matchesAssignmentKeys(facts[i], filter, emergency)),
                active: role.assignments.active.filter((_, i) => matchesAssignmentKeys(facts[eligibleCount + i], filter, emergency)),
            },
        };
    });
    const narrowedGroups = groups.map((data) => ({ ...data, assignments: data.assignments.filter((a) => matchesAssignmentKeys(groupAssignmentFact(a), filter, emergency)) }));
    return { roles: narrowedRoles, groups: narrowedGroups };
}

/** Display name per principal id from every list that carries an expanded principal. */
export function buildNameById(roles: RoleDetailData[]): Map<string, string> {
    const names = new Map<string, string>();
    for (const role of roles) {
        for (const item of [...role.assignments.permanent, ...role.assignments.eligible, ...role.assignments.active]) {
            const name = item.principal?.displayName;
            if (name) names.set(item.principalId.toLowerCase(), name);
        }
    }
    return names;
}

/**
 * Groups that match. A filter with keys groups cannot answer (privileged, MFA and so on) matches no group.
 * `assignment:active` means activated (Graph `assignmentType` `activated`), end dates come from `endDateTime`.
 */
export function applyDashboardFilterToGroups(groups: PimGroupData[], filter: DashboardFilter, options: ApplyFilterOptions = {}): PimGroupData[] {
    if (isEmptyDashboardFilter(filter)) return groups;
    if (!filterAppliesToGroups(filter)) return [];

    const emergency = options.emergencyAccountIds ?? NO_IDS;
    const needsAssignments = hasAssignmentBoundKey(filter);

    return groups.filter((data) => {
        if (filter.hasEligible === false) {
            if (data.isManaged === false) return false;
            if (data.assignments.some((a) => a.assignmentType === "eligible")) return false;
        }

        if (needsAssignments) {
            const matches = data.assignments.some((a) => matchesAssignmentKeys(groupAssignmentFact(a), filter, emergency));
            if (!matches) return false;
        }

        return true;
    });
}

// ---------------------------------------------------------------------------------------------
// Report: groups and row marking (Report spec 6.2 and 6.3)
// ---------------------------------------------------------------------------------------------

/**
 * One fact per group assignment for the Report. Unlike the dashboard's, `isGuest` reads `principalUserType` (read for
 * group assignments since NG-42) and `via` reads the membership's `memberType` as well as a group principal.
 */
export function buildReportGroupAssignmentFact(a: PimGroupData["assignments"][number]): AssignmentFacts {
    const fact = groupAssignmentFact(a);
    return { ...fact, isGuest: isGuestUserType(a.principalUserType), isViaGroup: fact.kind === "group" || a.memberType?.toLowerCase() === "group" };
}

/** Keys that must hold on one and the same assignment, for the Report (the dashboard set plus `accessType`). */
const REPORT_ASSIGNMENT_KEYS: readonly DashboardFilterKey[] = [...ASSIGNMENT_BOUND_KEYS, "accessType"];

export function hasReportAssignmentKey(filter: DashboardFilter): boolean {
    return REPORT_ASSIGNMENT_KEYS.some((key) => filter[key] !== undefined);
}

function policyOfGroup(data: PimGroupData, filter: DashboardFilter) {
    return data.policies?.[filter.appliesTo === "owner" ? "owner" : "member"];
}

/**
 * The Report's groups: the keys of the groups view. Group keys read the group (`groupPim`, `entraRoles`, `givesPrivileged`
 * through the roles it holds), assignment keys must hold on one assignment, policy keys read the Member policy or, with
 * `appliesTo:owner`, the Owner policy; a group without that policy loaded matches none of them. `roles` supplies the roles
 * a group holds.
 */
export function applyReportFilterToGroups(groups: PimGroupData[], roles: RoleDetailData[], filter: DashboardFilter, options: ApplyFilterOptions = {}): PimGroupData[] {
    const f = keysOfView(filter, "groups");
    if (isEmptyDashboardFilter(f)) return groups;

    const emergency = options.emergencyAccountIds ?? NO_IDS;
    const needsAssignments = hasReportAssignmentKey(f);
    const needsRoles = f.entraRoles !== undefined || f.givesPrivileged === true;
    const heldByGroup: Map<string, RoleHeldByGroup[]> = needsRoles ? getRolesHeldByGroups(roles, groups.map((g) => g.group.id)) : new Map();

    return groups.filter((data) => {
        if (f.groupPim === "under" && data.isManaged !== true) return false;
        if (f.groupPim === "outside" && data.isManaged !== false) return false;

        if (needsRoles) {
            const held = heldByGroup.get(data.group.id.toLowerCase()) ?? [];
            if (f.entraRoles === "holds" && held.length === 0) return false;
            // Undefined is unknown, never false: it matches none of the values below
            if (f.entraRoles === "assignableNone" && !(data.group.isAssignableToRole === true && held.length === 0)) return false;
            if (f.entraRoles === "notAssignable" && data.group.isAssignableToRole !== false) return false;
            if (f.givesPrivileged && !held.some((h) => h.isPrivileged)) return false;
        }

        if (needsAssignments && !data.assignments.some((a) => matchesAssignmentKeys(buildReportGroupAssignmentFact(a), f, emergency))) return false;

        if (hasPolicyKey(f)) {
            const policy = policyOfGroup(data, f);
            const rules = policy ? completeRules(policy.rules) : undefined;
            const linked = f.customExtension !== undefined ? getLinkedCustomExtensions(parseCustomExtensionRules(rules as never)).map((l) => l.link.customExtensionId) : [];
            if (!matchesPolicyKeys(summarizePolicyRules(rules as never), f, linked)) return false;
        }

        return true;
    });
}

/**
 * The assignments of a role or group that satisfy the assignment keys of the filter, for marking rows in the detail
 * (spec 6.3). Empty when no assignment key is set: nothing to mark. For a role pass `kindById: buildKindById(allRoles)`, the
 * map the list filter uses, so a principal without an expanded `principal` is told apart the same way in both places.
 */
export function getMatchingAssignmentIds(
    item: RoleDetailData | PimGroupData,
    filter: DashboardFilter,
    options: ApplyFilterOptions & { kindById?: Map<string, PrincipalKind> } = {}
): Set<string> {
    const ids = new Set<string>();
    const isRole = "definition" in item;
    const f = keysOfView(filter, isRole ? "roles" : "groups");
    if (!hasReportAssignmentKey(f)) return ids;
    const emergency = options.emergencyAccountIds ?? NO_IDS;
    const facts = isRole ? buildRoleAssignmentFacts(item, options.kindById ?? buildKindById([item])) : item.assignments.map(buildReportGroupAssignmentFact);
    for (const fact of facts) {
        if (matchesAssignmentKeys(fact, f, emergency)) ids.add(fact.id);
    }
    return ids;
}
