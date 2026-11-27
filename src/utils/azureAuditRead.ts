/**
 * The pure parts of the Azure Audit read: which scopes the reads go to, the groups that hold Azure roles, the context the
 * mapper names things with, and the removal of a log row that came in twice. No ARM, no state.
 */
import type { RawActivityEvent } from "@/types/audit.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { AzureAuditContext, GroupHolding } from "@/utils/azureAuditEvents";

export interface AzureAuditPlan {
    /** The subscription ids (the last segment of the scope id) of every subscription in the tree */
    subscriptionIds: string[];
    /** The subscriptions the user cannot list as a whole (they have `access`) */
    refusedSubscriptionIds: string[];
    /** The full scope id of every management group */
    managementGroupIds: string[];
}

export type AzureAuditNotReadReason = "refused" | "forbidden" | "gone" | "budget";

/** One read that gave nothing: the log or the requests at a scope, and why */
export interface AzureAuditNotRead {
    part: "log" | "requests";
    scopeId: string;
    reason: AzureAuditNotReadReason;
}

const GROUP_TYPES: ReadonlySet<string> = new Set(["group", "groupsecuritynotenabled"]);

function lastSegment(path: string): string {
    const parts = path.split("/").filter((part) => part !== "");
    return parts.length > 0 ? parts[parts.length - 1] : "";
}

export function planAzureAuditRead(scopes: readonly AzureScope[]): AzureAuditPlan {
    const subscriptions = scopes.filter((scope) => scope.level === "subscription");
    return {
        subscriptionIds: subscriptions.map((scope) => lastSegment(scope.id)),
        refusedSubscriptionIds: subscriptions.filter((scope) => scope.access !== undefined).map((scope) => lastSegment(scope.id)),
        managementGroupIds: scopes.filter((scope) => scope.level === "managementGroup").map((scope) => scope.id),
    };
}

/** The Azure roles that groups hold as active assignments: one per group, role and scope */
export function holdingsOf(assignments: readonly AzureAssignment[]): GroupHolding[] {
    const seen = new Set<string>();
    const holdings: GroupHolding[] = [];
    for (const assignment of assignments) {
        if (assignment.state !== "active" || !GROUP_TYPES.has(assignment.principalType.toLowerCase())) continue;
        const key = `${assignment.principalId}|${assignment.roleDefinitionId}|${assignment.scopeId}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        holdings.push({ groupId: assignment.principalId, roleId: assignment.roleDefinitionId, roleName: assignment.roleName, scopeId: assignment.scopeId });
    }
    return holdings;
}

/** The names the mapper needs, from the scope tree and the assignments, looked up without case */
export function buildAzureAuditContext(scopes: readonly AzureScope[], assignments: readonly AzureAssignment[], definitions?: ReadonlyMap<string, ArmRoleDefinition> | null): AzureAuditContext {
    const scopeNames = new Map<string, string>();
    for (const scope of scopes) scopeNames.set(scope.id.toLowerCase(), scope.name);
    const roleNames = new Map<string, string>();
    const principalNames = new Map<string, string>();
    const principals = new Map<string, { type: string; upn?: string }>();
    const idsByUpn = new Map<string, string>();
    for (const assignment of assignments) {
        const role = assignment.roleDefinitionId.toLowerCase();
        const principal = assignment.principalId.toLowerCase();
        if (!roleNames.has(role)) roleNames.set(role, assignment.roleName);
        if (!principalNames.has(principal)) principalNames.set(principal, assignment.principalName);
        if (!principals.has(principal)) principals.set(principal, { type: assignment.principalType, upn: assignment.principalUpn });
        const upn = assignment.principalUpn?.trim().toLowerCase();
        if (upn && !idsByUpn.has(upn)) idsByUpn.set(upn, assignment.principalId);
    }
    return {
        scopeName: (scopeId) => scopeNames.get(scopeId.toLowerCase()),
        // The names of the assignments win; a role nobody holds any more is named by its definition
        roleName: (roleGuid) => roleNames.get(roleGuid.toLowerCase()) || definitions?.get(roleGuid.toLowerCase())?.properties.roleName || undefined,
        principalName: (id) => principalNames.get(id.toLowerCase()),
        principal: (id) => principals.get(id.toLowerCase()),
        principalIdOfUpn: (upn) => idsByUpn.get(upn.trim().toLowerCase()),
        eligibilities: assignments
            .filter((assignment) => assignment.state === "eligible")
            .map((assignment) => ({ id: assignment.id, principalId: assignment.principalId, principalType: assignment.principalType, principalName: assignment.principalName })),
    };
}

/** One row per `eventDataId`, the first kept; a row without one is kept. The log routes can overlap. */
export function dedupeActivity(rows: readonly RawActivityEvent[]): RawActivityEvent[] {
    const seen = new Set<string>();
    const kept: RawActivityEvent[] = [];
    for (const row of rows) {
        const id = (row.eventDataId ?? "").trim().toLowerCase();
        if (id !== "") {
            if (seen.has(id)) continue;
            seen.add(id);
        }
        kept.push(row);
    }
    return kept;
}

const AUTHORIZATION_OPERATION_PREFIX = "microsoft.authorization/";
const MANAGEMENT_GROUP_SCOPE_PREFIX = "/providers/microsoft.management/managementgroups/";

function normaliseScope(scope: string): string {
    return scope.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Whether a request row belongs to the scope it was read at: the same scope, or one beneath it. A request list read at a
 * resource group also comes back with the requests of its subscription, and those are above what the reader was granted.
 * A row without a scope is not kept (fail closed). Used for subscription and resource group reads; a management group read
 * keeps rows with a scope because a subscription ID is not a textual child of a management group ID.
 */
export function isAtOrBelowScope(rowScope: string | null | undefined, readScope: string): boolean {
    if (!rowScope?.trim()) return false;
    const row = normaliseScope(rowScope);
    const read = normaliseScope(readScope);
    if (read === "") return true;
    return row === read || row.startsWith(`${read}/`);
}

/** Whether a read at this scope keeps only the rows at or beneath it (every read but a management group's) */
export function filtersRequestsToScope(readScope: string): boolean {
    return !normaliseScope(readScope).startsWith(MANAGEMENT_GROUP_SCOPE_PREFIX);
}

/** An operation of the authorization provider, without case: the management group and tenant answers of the Activity Log hold other providers too */
export function isAuthorizationOperation(operation: string | null | undefined): boolean {
    return (operation ?? "").toLowerCase().startsWith(AUTHORIZATION_OPERATION_PREFIX);
}
