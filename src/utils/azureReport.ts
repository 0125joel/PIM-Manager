/**
 * Azure Report logic: the scope tree order, which rows a selected scope shows, the filters and the card line.
 *
 * ARM ids are case-insensitive, so every id comparison lowercases. The name of a scope always comes from the stored
 * scope in the tree, never from the id of an assignment.
 */
import type { MaxDurationBucket } from "@/types/dashboardFilter.types";
import type { PimPolicyRule } from "@/types/directoryRole.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { getMaxDurationBucket } from "@/utils/assignmentKinds";
import { isPrivilegedRole, principalKindOf } from "@/utils/azureDashboard";
import type { AzureSettingsOutcome } from "@/utils/azureDashboardStats";
import { azurePolicyKey } from "@/utils/azureScopes";
import { formatDate } from "@/utils/dateFormat";
import { parseTotalHours } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";

// Moved to azureDashboard.ts to break an import cycle; re-exported so every existing import keeps working
export { AZURE_PRIVILEGED_ROLE_IDS } from "@/utils/azureDashboard";

export type AzureStatusFilter = "all" | "eligible" | "active" | "activated" | "assigned";
export type AzureOriginFilter = "all" | "here" | "inherited";
export type AzurePrincipalFilter = "all" | "user" | "group" | "app" | "foreignGroup" | "guest" | "agent" | "managedIdentity" | "deleted";
export type AzureEndsFilter = "all" | "permanent" | "within30" | "timeBound";
/** `managementGroup` is management groups and the root; `subscriptionOrAbove` is the root, management groups and subscriptions */
export type AzureLevelFilter = "all" | "managementGroup" | "subscriptionOrAbove" | "subscription" | "resourceGroup" | "resource";
export type AzureRequiredFilter = "all" | "required" | "notRequired";
export type AzureMfaFilter = "all" | "entraMfa" | "authContext" | "neither";
export type AzureMaxDurationFilter = "all" | MaxDurationBucket | "over8h";
export type AzureViaFilter = "all" | "direct" | "group";

export interface AzureReportFilters {
    query: string;
    status: AzureStatusFilter;
    origin: AzureOriginFilter;
    privileged: boolean;
    principalType: AzurePrincipalFilter;
    ends: AzureEndsFilter;
    level: AzureLevelFilter;
    /** "all" or a lowercased ARM type such as "microsoft.keyvault/vaults" */
    resourceType: string;
    customRole: boolean;
    approval: AzureRequiredFilter;
    justification: AzureRequiredFilter;
    mfa: AzureMfaFilter;
    maxDuration: AzureMaxDurationFilter;
    notified: "all" | "none";
    via: AzureViaFilter;
    /** The role x scope has no eligible assignment */
    noEligible: boolean;
    excludeEmergency: boolean;
    /** "all" or a lowercase role definition GUID */
    role: string;
}

export type AzureFilterKey =
    | "status" | "origin" | "privileged" | "principalType" | "ends" | "level" | "resourceType"
    | "customRole" | "approval" | "justification" | "mfa" | "maxDuration" | "notified" | "via" | "noEligible" | "excludeEmergency" | "role";

/** The order of the URL and of the chips */
export const AZURE_FILTER_KEYS: readonly AzureFilterKey[] = [
    "status", "origin", "privileged", "principalType", "ends", "level", "resourceType",
    "customRole", "approval", "justification", "mfa", "maxDuration", "notified", "via", "noEligible", "excludeEmergency", "role",
];

/** Every field neutral; Origin All filters nothing (export of all scopes, tests) */
export const EMPTY_AZURE_FILTERS: AzureReportFilters = { query: "", status: "all", origin: "all", privileged: false, principalType: "all", ends: "all", level: "all", resourceType: "all", customRole: false, approval: "all", justification: "all", mfa: "all", maxDuration: "all", notified: "all", via: "all", noEligible: false, excludeEmergency: false, role: "all" };

/** What the rows of a scope hold per Origin, after the scope name in the head, the export dialog and the export file */
const ORIGIN_TEXT: Record<AzureOriginFilter, string> = { all: "including inherited assignments", here: "without inherited assignments", inherited: "inherited assignments only" };

export function scopeLineFor(scopeName: string, origin: AzureOriginFilter): string {
    return `${scopeName}, ${ORIGIN_TEXT[origin]}`;
}

/** The filters the Report starts with and Clear filters returns to: Origin on This scope (Joël 2026-10-19) */
export const DEFAULT_AZURE_FILTERS: AzureReportFilters = { ...EMPTY_AZURE_FILTERS, origin: "here" };

export interface ScopeTreeRow {
    scope: AzureScope;
    depth: number;
}

export interface AzureAssignmentRow {
    assignment: AzureAssignment;
    /** The stored scope of `assignment.scopeId` */
    scope: AzureScope;
    /** The assignment sits above the selected scope */
    isInherited: boolean;
    originText: string;
    endText: string;
    principalTypeLabel: string;
}

/** The scopes depth first: roots first in input order, each followed by its children */
export function flattenScopeTree(scopes: AzureScope[]): ScopeTreeRow[] {
    const known = new Set(scopes.map((s) => s.id.toLowerCase()));
    const children = new Map<string, AzureScope[]>();
    const roots: AzureScope[] = [];
    for (const scope of scopes) {
        const parent = scope.parentId === null ? null : scope.parentId.toLowerCase();
        if (parent === null || !known.has(parent)) {
            roots.push(scope);
        } else {
            const list = children.get(parent);
            if (list) list.push(scope);
            else children.set(parent, [scope]);
        }
    }

    const rows: ScopeTreeRow[] = [];
    const emitted = new Set<string>();
    const visit = (scope: AzureScope, depth: number) => {
        const key = scope.id.toLowerCase();
        if (emitted.has(key)) return;
        emitted.add(key);
        rows.push({ scope, depth });
        for (const child of children.get(key) ?? []) visit(child, depth + 1);
    };
    for (const root of roots) visit(root, 0);
    return rows;
}

/** The tree rows to show: everything except resources, which show only next to the selected scope */
export function visibleScopeRows(rows: ScopeTreeRow[], selectedId: string | null): ScopeTreeRow[] {
    const selected = selectedId === null ? null : selectedId.toLowerCase();
    const selectedScope = selected === null ? undefined : rows.find((r) => r.scope.id.toLowerCase() === selected)?.scope;
    return rows.filter(({ scope }) => {
        if (scope.level !== "resource") return true;
        if (selected === null) return false;
        const parent = scope.parentId === null ? null : scope.parentId.toLowerCase();
        if (parent === selected) return true;
        return selectedScope?.level === "resource" && selectedScope.parentId !== null && selectedScope.parentId.toLowerCase() === parent;
    });
}

/** The scope selected when the user has not chosen one: the first subscription, else the first scope */
export function defaultScopeId(scopes: AzureScope[]): string | null {
    const rows = flattenScopeTree(scopes);
    const first = rows.find((r) => r.scope.level === "subscription") ?? rows[0];
    return first ? first.scope.id : null;
}

/** The stored scope with this id, compared case-insensitively */
export function findScope(scopes: AzureScope[], id: string | null): AzureScope | null {
    if (id === null) return null;
    const key = id.toLowerCase();
    return scopes.find((s) => s.id.toLowerCase() === key) ?? null;
}

export function principalTypeLabelFor(principalType: string): string {
    if (principalType === "User") return "User";
    if (principalType === "Group") return "Group";
    if (principalType === "ForeignGroup") return "Foreign group";
    if (principalType === "ServicePrincipal") return "App";
    if (principalType === "AgentIdentity") return "Agent";
    if (principalType === "Device") return "Device";
    return "Unknown";
}

/** The label of the principal kind: guest, agent and managed identity apart, as the dashboard counts them */
export function principalKindLabel(assignment: AzureAssignment, spTypes?: ReadonlyMap<string, string> | null): string {
    switch (principalKindOf(assignment, spTypes ?? null)) {
        case "user": return "User";
        case "guest": return "Guest";
        case "group": return assignment.principalType === "ForeignGroup" ? "Foreign group" : "Group";
        case "app":
        case "servicePrincipal": return "App";
        case "managedIdentity": return "Managed identity";
        case "agent": return "Agent";
        case "deleted": return "Deleted";
        default: return assignment.principalType === "Device" ? "Device" : "Unknown";
    }
}

export function endTextFor(endDateTime: string | null): string {
    if (endDateTime === null) return "Permanent";
    const text = formatDate(endDateTime);
    return text === "" ? endDateTime : text;
}

/** What a filter needs beyond the assignment: everything optional, so the Report works before these are read */
export interface AzureFilterContext {
    /** Role definitions by lowercase GUID: privileged by actions (V11); without it, the five roles only */
    definitions?: ReadonlyMap<string, ArmRoleDefinition> | null;
    /** Graph servicePrincipalType by lowercase object id: apps apart from managed identities */
    spTypes?: ReadonlyMap<string, string> | null;
    /** Settings per `azurePolicyKey`: the policy keys */
    settings?: ReadonlyMap<string, AzureSettingsOutcome>;
    emergencyIds?: ReadonlySet<string>;
    /** Pairs `azurePolicyKey(scopeId, roleId)` that have an eligible assignment, for `noEligible` */
    eligiblePairs?: ReadonlySet<string>;
}

/** The pairs `azurePolicyKey(scopeId, roleId)` that have an eligible assignment */
export function eligiblePairsOf(assignments: readonly AzureAssignment[]): Set<string> {
    const pairs = new Set<string>();
    for (const a of assignments) if (a.state === "eligible") pairs.add(azurePolicyKey(a.scopeId, a.roleDefinitionId));
    return pairs;
}

/** Whether the policy of this assignment's role x scope passes the policy keys of the filters; false when they are set and the policy is not loaded */
function matchesPolicyKeys(assignment: AzureAssignment, filters: AzureReportFilters, context: AzureFilterContext): boolean {
    const usesPolicy = filters.approval !== "all" || filters.justification !== "all" || filters.mfa !== "all" || filters.maxDuration !== "all" || filters.notified !== "all";
    if (!usesPolicy) return true;
    const outcome = context.settings?.get(azurePolicyKey(assignment.scopeId, assignment.roleDefinitionId));
    if (outcome?.status !== "loaded") return false;
    const summary = summarizePolicyRules(outcome.rules as unknown as PimPolicyRule[]);
    if (!summary.isLoaded) return false;

    // Copies the Entra rule of matchesPolicyKeys in dashboardFilter.ts: approval and justification compare the flag with the wanted value
    if (filters.approval !== "all" && (summary.isApprovalRequired === true) !== (filters.approval === "required")) return false;
    if (filters.justification !== "all" && (summary.isJustificationRequired === true) !== (filters.justification === "required")) return false;
    if (filters.mfa !== "all") {
        // Copies the Entra mfa rule: an authentication context counts only when there is no Entra MFA
        const entraMfa = summary.hasPimMfa === true;
        const authContext = !entraMfa && summary.hasAuthContext === true;
        if (filters.mfa === "entraMfa" && !entraMfa) return false;
        if (filters.mfa === "authContext" && !authContext) return false;
        if (filters.mfa === "neither" && (entraMfa || authContext)) return false;
    }
    if (filters.maxDuration !== "all") {
        // Copies the Entra maxDuration rule: a bucket of getMaxDurationBucket, or over8h for more than 8 hours
        if (!summary.maxDuration) return false;
        const hours = parseTotalHours(summary.maxDuration);
        if (filters.maxDuration === "over8h") {
            if (hours === null || hours <= 8) return false;
        } else if (getMaxDurationBucket(hours) !== filters.maxDuration) return false;
    }
    if (filters.notified === "none") {
        // Copies the Entra activationNotification rule: the rule exists, default recipients are off and there are no recipients
        const rule = summary.activationNotification;
        if (!rule || rule.isDefaultRecipientsEnabled || rule.notificationRecipients.length > 0) return false;
    }
    return true;
}

/** The test per assignment, shared by the Report and the dashboard links; `isInherited` is relative to the selected scope */
export function matchesAzureFilters(assignment: AzureAssignment, scope: AzureScope, isInherited: boolean, filters: AzureReportFilters, context: AzureFilterContext, nowMs: number): boolean {
    const query = filters.query.trim().toLowerCase();
    if (query !== "" && !assignment.principalName.toLowerCase().includes(query) && !assignment.roleName.toLowerCase().includes(query)) return false;
    if (filters.status === "eligible" && assignment.state !== "eligible") return false;
    if (filters.status === "active" && assignment.state !== "active") return false;
    if (filters.status === "activated" && !(assignment.state === "active" && assignment.isActivated === true)) return false;
    if (filters.status === "assigned" && !(assignment.state === "active" && assignment.isActivated !== true)) return false;
    if (filters.origin === "here" && isInherited) return false;
    if (filters.origin === "inherited" && !isInherited) return false;
    if (filters.privileged && !isPrivilegedRole(assignment.roleDefinitionId, context.definitions ?? null)) return false;
    if (filters.principalType !== "all") {
        const kind = principalKindOf(assignment, context.spTypes ?? null);
        switch (filters.principalType) {
            case "user": if (kind !== "user") return false; break;
            case "guest": if (kind !== "guest") return false; break;
            // A deleted principal counts only under Deleted, as a guest only under Guests
            case "group": if (assignment.principalType !== "Group" || kind === "deleted") return false; break;
            case "foreignGroup": if (assignment.principalType !== "ForeignGroup") return false; break;
            case "deleted": if (kind !== "deleted") return false; break;
            case "agent": if (kind !== "agent") return false; break;
            case "managedIdentity": if (kind !== "managedIdentity") return false; break;
            // servicePrincipal: the type is not known (no spTypes), so Apps keeps its old meaning
            case "app": if (kind !== "app" && kind !== "servicePrincipal") return false; break;
        }
    }
    if (filters.ends === "permanent" && assignment.endDateTime !== null) return false;
    if (filters.ends === "timeBound" && assignment.endDateTime === null) return false;
    if (filters.ends === "within30") {
        if (assignment.endDateTime === null) return false;
        const end = Date.parse(assignment.endDateTime);
        if (Number.isNaN(end) || end < nowMs || end > nowMs + 30 * 24 * 60 * 60 * 1000) return false;
    }
    if (filters.level !== "all") {
        if (filters.level === "managementGroup") {
            if (scope.level !== "managementGroup" && scope.level !== "root") return false;
        } else if (filters.level === "subscriptionOrAbove") {
            if (scope.level !== "root" && scope.level !== "managementGroup" && scope.level !== "subscription") return false;
        } else if (scope.level !== filters.level) return false;
    }
    if (filters.resourceType !== "all" && scope.resourceType?.toLowerCase() !== filters.resourceType) return false;
    if (filters.customRole && assignment.isCustomRole !== true) return false;
    if (filters.via === "direct" && assignment.isViaGroup === true) return false;
    if (filters.via === "group" && assignment.isViaGroup !== true) return false;
    if (filters.role !== "all" && assignment.roleDefinitionId.toLowerCase() !== filters.role) return false;
    if (filters.excludeEmergency && context.emergencyIds?.has(assignment.principalId.toLowerCase())) return false;
    if (filters.noEligible && context.eligiblePairs?.has(azurePolicyKey(assignment.scopeId, assignment.roleDefinitionId))) return false;
    return matchesPolicyKeys(assignment, filters, context);
}

/** The rows of the selected scope: its own assignments, those below it and those inherited from above, filtered and ordered */
export function buildAssignmentRows(assignments: AzureAssignment[], scopes: AzureScope[], selectedId: string | null, filters: AzureReportFilters, now: Date = new Date(), context: AzureFilterContext = {}): AzureAssignmentRow[] {
    const selected = findScope(scopes, selectedId);
    if (!selected) return [];
    const selectedKey = selected.id.toLowerCase();

    const byId = new Map<string, AzureScope>();
    for (const scope of scopes) byId.set(scope.id.toLowerCase(), scope);

    // The ids above the selected scope
    const ancestors = new Set<string>();
    const seen = new Set<string>([selectedKey]);
    let parentId = selected.parentId;
    while (parentId !== null) {
        const key = parentId.toLowerCase();
        if (seen.has(key)) break;
        seen.add(key);
        const parent = byId.get(key);
        if (!parent) break;
        ancestors.add(key);
        parentId = parent.parentId;
    }

    // The position of every scope in tree order
    const position = new Map<string, number>();
    flattenScopeTree(scopes).forEach((r, index) => position.set(r.scope.id.toLowerCase(), index));

    // A scope is below the selected scope when the selected scope is on its parent chain
    const isBelow = (scope: AzureScope): boolean => {
        const visited = new Set<string>([scope.id.toLowerCase()]);
        let next = scope.parentId;
        while (next !== null) {
            const key = next.toLowerCase();
            if (key === selectedKey) return true;
            if (visited.has(key)) return false;
            visited.add(key);
            next = byId.get(key)?.parentId ?? null;
        }
        return false;
    };

    const nowMs = now.getTime();
    const effective: AzureFilterContext = context.eligiblePairs || !filters.noEligible ? context : { ...context, eligiblePairs: eligiblePairsOf(assignments) };
    const rows: AzureAssignmentRow[] = [];
    for (const assignment of assignments) {
        const key = assignment.scopeId.toLowerCase();
        const scope = byId.get(key);
        if (!scope) continue;
        const isInherited = ancestors.has(key);
        if (!isInherited && key !== selectedKey && !isBelow(scope)) continue;

        if (!matchesAzureFilters(assignment, scope, isInherited, filters, effective, nowMs)) continue;

        rows.push({
            assignment,
            scope,
            isInherited,
            originText: isInherited ? `Inherited from ${scope.name}` : "This scope",
            endText: endTextFor(assignment.endDateTime),
            principalTypeLabel: principalKindLabel(assignment, effective.spTypes),
        });
    }

    return rows.sort((x, y) => {
        const byScope = (position.get(x.scope.id.toLowerCase()) ?? 0) - (position.get(y.scope.id.toLowerCase()) ?? 0);
        if (byScope !== 0) return byScope;
        const byRole = x.assignment.roleName.localeCompare(y.assignment.roleName, "en");
        if (byRole !== 0) return byRole;
        return x.assignment.principalName.localeCompare(y.assignment.principalName, "en");
    });
}

/** The third line of a card: scope, origin and end */
export function cardFactLine(row: AzureAssignmentRow): string {
    const origin = row.isInherited ? row.originText.charAt(0).toLowerCase() + row.originText.slice(1) : "this scope";
    return `${row.scope.name}, ${origin}, ${row.endText}`;
}

/**
 * How many inherited assignments the default Origin hides when the scope has none of its own and nothing else is
 * filtered, so the page can offer them; 0 in every other case.
 */
export function hiddenInheritedCount(assignments: AzureAssignment[], scopes: AzureScope[], selectedId: string | null, filters: AzureReportFilters, context: AzureFilterContext = {}): number {
    if (filters.query.trim() !== "") return 0;
    if (AZURE_FILTER_KEYS.some((key) => filters[key] !== DEFAULT_AZURE_FILTERS[key])) return 0;
    if (buildAssignmentRows(assignments, scopes, selectedId, filters, new Date(), context).length > 0) return 0;
    return buildAssignmentRows(assignments, scopes, selectedId, { ...filters, origin: "inherited" }, new Date(), context).length;
}
