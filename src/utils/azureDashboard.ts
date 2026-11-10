/**
 * Derived fields of the Azure dashboard: what kind of principal an assignment has, whether a role is privileged, the
 * level of a scope and whether a subscription is delegated. Pure logic, no React, no service.
 */
import type { ArmRoleDefinition, ArmRolePermission, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { isDelegatedScope, levelFromScopeId } from "@/utils/azureScopes";

/** The five privileged administrator roles of Learn ("privileged administrator roles"), role definition GUIDs (facts.md section 3) */
export const AZURE_PRIVILEGED_ROLE_IDS: ReadonlySet<string> = new Set([
    "8e3af657-a8ff-443c-a75c-2fe8c4bcb635", // Owner
    "b24988ac-6180-42a0-ab88-20f7382dd24c", // Contributor
    "a8889054-8d42-49c9-bc1c-52486c10e7cd", // Reservations Administrator
    "f58310d9-a9f6-439a-9e8d-f62e7b41a168", // Role Based Access Control Administrator
    "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9", // User Access Administrator
]);

export type AzurePrincipalKind = "user" | "guest" | "group" | "app" | "managedIdentity" | "agent" | "servicePrincipal" | "deleted" | "unknown";

/**
 * The value in `spTypes` for a principal Graph does not find in the user's directory: deleted. ARM keeps the type and
 * the name of a deleted user for a while (measured 2026-10-29), so only Graph can tell.
 */
export const DELETED_PRINCIPAL = "Deleted";

export function isGuestAssignment(a: AzureAssignment): boolean {
    return a.principalType === "User" && (a.principalUpn ?? "").toLowerCase().includes("#ext#");
}

/** The principal ids to look up in Graph, lowercase and distinct, by the collection that holds them */
export interface DirectoryLookupIds {
    users: string[];
    groups: string[];
    servicePrincipals: string[];
}

/**
 * The principals whose presence in the user's directory can be checked: users (guests too), groups and service
 * principals on scopes of the home tenant. A delegated subscription and a foreign group hold principals of another
 * directory, and an agent identity is not checked (not measured), so those are never called deleted. Nothing without
 * the home tenant, since then a delegated subscription cannot be told apart.
 */
export function directoryLookupIds(assignments: readonly AzureAssignment[], scopes: readonly AzureScope[], homeTenantId: string | undefined): DirectoryLookupIds {
    const ids: Record<keyof DirectoryLookupIds, Set<string>> = { users: new Set(), groups: new Set(), servicePrincipals: new Set() };
    if (!homeTenantId) return { users: [], groups: [], servicePrincipals: [] };
    const byId = new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
    for (const a of assignments) {
        if (isDelegatedAssignment(a, byId, homeTenantId)) continue;
        const id = a.principalId.toLowerCase();
        if (a.principalType === "User") ids.users.add(id);
        else if (a.principalType === "Group") ids.groups.add(id);
        else if (a.principalType === "ServicePrincipal") ids.servicePrincipals.add(id);
    }
    return { users: [...ids.users], groups: [...ids.groups], servicePrincipals: [...ids.servicePrincipals] };
}

/** `spTypes`: Graph servicePrincipalType by lowercase object id, or `DELETED_PRINCIPAL`; null when not loaded or failed */
export function principalKindOf(a: AzureAssignment, spTypes: ReadonlyMap<string, string> | null): AzurePrincipalKind {
    if (spTypes?.get(a.principalId.toLowerCase()) === DELETED_PRINCIPAL) return "deleted";
    switch (a.principalType) {
        case "User":
            return isGuestAssignment(a) ? "guest" : "user";
        case "Group":
        case "ForeignGroup":
            return "group";
        case "AgentIdentity":
            return "agent";
        case "ServicePrincipal": {
            const type = spTypes?.get(a.principalId.toLowerCase());
            if (type === undefined) return "servicePrincipal";
            if (type === "ManagedIdentity") return "managedIdentity";
            if (type === "ServiceIdentity") return "agent";
            return "app";
        }
        default:
            return "unknown";
    }
}

/** Actions that make a role privileged (Learn, role definitions page) */
export const PRIVILEGED_ACTION_TARGETS: readonly string[] = [
    "*",
    "*/write",
    "*/delete",
    "microsoft.authorization/roleassignments/write",
    "microsoft.authorization/roleassignments/delete",
    "microsoft.authorization/roledefinitions/write",
    "microsoft.authorization/roledefinitions/delete",
    "microsoft.authorization/denyassignments/write",
    "microsoft.authorization/denyassignments/delete",
];

/** True when the glob `pattern` (`*` matches any run of characters, also `/`) matches the whole `target`, case-insensitive */
export function actionCovers(pattern: string, target: string): boolean {
    const source = pattern
        .toLowerCase()
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    return new RegExp(`^${source}$`).test(target.toLowerCase());
}

/** `notActions` are not used: Contributor stays privileged */
export function isPrivilegedByActions(permissions: ArmRolePermission[] | undefined): boolean {
    if (!permissions) return false;
    return permissions.some((block) => (block.actions ?? []).some((action) => PRIVILEGED_ACTION_TARGETS.some((target) => actionCovers(action, target))));
}

/** `definitions`: role definitions by lowercase GUID; null while they load */
export function isPrivilegedRole(roleDefinitionId: string, definitions: ReadonlyMap<string, ArmRoleDefinition> | null): boolean {
    const id = roleDefinitionId.toLowerCase();
    if (AZURE_PRIVILEGED_ROLE_IDS.has(id)) return true;
    const definition = definitions?.get(id);
    return definition !== undefined && isPrivilegedByActions(definition.properties.permissions);
}

/** The level of a scope for the dashboard blocks; `root` counts as management group */
export function dashboardLevelOf(scopeId: string): "managementGroup" | "subscription" | "resourceGroup" | "resource" | null {
    const level = levelFromScopeId(scopeId);
    if (level === null) return null;
    return level === "root" ? "managementGroup" : level;
}

/** `scopesById` is keyed by lowercase scope id. The `/subscriptions/{id}` scope of a scope id; null above a subscription */
export function subscriptionScopeOf(scopeId: string, scopesById: ReadonlyMap<string, AzureScope>): AzureScope | null {
    const segs = scopeId.split("/").filter((s) => s !== "");
    if (segs.length < 2 || segs[0].toLowerCase() !== "subscriptions") return null;
    return scopesById.get(`/${segs[0]}/${segs[1]}`.toLowerCase()) ?? null;
}

export function isDelegatedAssignment(a: AzureAssignment, scopesById: ReadonlyMap<string, AzureScope>, homeTenantId: string | undefined): boolean {
    const subscription = subscriptionScopeOf(a.scopeId, scopesById);
    return subscription !== null && isDelegatedScope(subscription, homeTenantId);
}

/**
 * True when the assignment sits on a scope above the chosen one (the Report's origin "inherited", `buildAssignmentRows`):
 * its scope is a strict ancestor found by walking `parentId` from the chosen scope. False without a chosen scope.
 * `scopesById` is keyed by lowercase scope id. `memberType` is not used: ARM reports it from the listing subscription.
 */
export function isAboveChosenScope(a: AzureAssignment, chosenScopeId: string | null, scopesById: ReadonlyMap<string, AzureScope>): boolean {
    if (chosenScopeId === null) return false;
    const chosenKey = chosenScopeId.toLowerCase();
    const target = a.scopeId.toLowerCase();
    const seen = new Set<string>([chosenKey]);
    let parentId = scopesById.get(chosenKey)?.parentId ?? null;
    while (parentId !== null) {
        const key = parentId.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        const parent = scopesById.get(key);
        if (!parent) return false;
        if (key === target) return true;
        parentId = parent.parentId;
    }
    return false;
}
