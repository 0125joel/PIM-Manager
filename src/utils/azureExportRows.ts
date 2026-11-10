/**
 * Azure Report export rows (like exportRows.ts for Entra): one row per assignment, one row per role per scope, and replacing the names of people. Pure logic. ARM ids are case-insensitive, so every id comparison lowercases.
 */
import type { AzureScope, AzureScopeLevel } from "@/types/azureResource.types";
import { AZURE_PRIVILEGED_ROLE_IDS, flattenScopeTree, type AzureAssignmentRow } from "@/utils/azureReport";
import { isDelegatedScope } from "@/utils/azureReportStates";
import { azurePolicyKey, isRootScope } from "@/utils/azureScopes";
import { scrubPolicyRules } from "@/utils/exportAnonymise";
import { policyTileTexts } from "@/utils/exportRows";
import { SETTINGS_TILES, textCodec, yesNoCodec, type Column, type ExportRow } from "@/utils/exportSchema";

export const AZURE_WORKLOAD = "Azure resource role";

export const SCOPE_LEVEL_LABELS: Record<AzureScopeLevel, string> = {
    root: "Root", managementGroup: "Management group", subscription: "Subscription", resourceGroup: "Resource group", resource: "Resource",
};

/** What a role's policy at a scope is for the export; `failed` is a read that did not succeed */
export type AzurePolicyOutcome =
    | { status: "loaded"; rules: Record<string, unknown>[]; lastModified: string | null }
    | { status: "missing" }
    | { status: "unavailable" }
    | { status: "noAccess" }
    | { status: "failed" };

/** One role at one scope of the selection: one row of the role settings file */
export interface AzureRolePair {
    scopeId: string;
    roleDefinitionId: string;
    roleName: string;
    isCustom: boolean;
    scope: AzureScope;
}

export interface AzureRowContext {
    scopes: AzureScope[];
    /** Lowercase object ids of the emergency access accounts */
    emergencyIds: ReadonlySet<string>;
    /** The tenant of the user: a subscription of another tenant is Delegated */
    homeTenantId?: string;
    /** Lowercase principal ids whose name was replaced: their object id is left out */
    anonymisedIds?: ReadonlySet<string>;
}

export const AZURE_ASSIGNMENT_COLUMNS: Column[] = [
    { header: "Workload", key: "workload", codec: textCodec },
    { header: "Role", key: "role", codec: textCodec },
    { header: "Assignment", key: "assignment", codec: textCodec },
    { header: "Name", key: "name", codec: textCodec },
    { header: "UPN or mail", key: "upn", codec: textCodec },
    { header: "Object id", key: "objectId", codec: textCodec },
    { header: "Principal type", key: "principalType", codec: textCodec },
    { header: "Member type", key: "memberType", codec: textCodec },
    { header: "Start", key: "start", codec: textCodec },
    { header: "End", key: "end", codec: textCodec },
    { header: "Scope", key: "scope", codec: textCodec },
    { header: "Scope level", key: "scopeLevel", codec: textCodec },
    { header: "Scope id", key: "scopeId", codec: textCodec },
    { header: "Resource type", key: "resourceType", codec: textCodec },
    { header: "Subscription", key: "subscription", codec: textCodec },
    { header: "Delegated", key: "delegated", codec: yesNoCodec },
    { header: "Role id", key: "roleId", codec: textCodec },
    { header: "Role type", key: "roleType", codec: textCodec },
    { header: "Privileged", key: "privileged", codec: yesNoCodec },
    { header: "Emergency access", key: "emergency", codec: yesNoCodec },
    { header: "Origin", key: "origin", codec: textCodec },
    { header: "Inherited", key: "inherited", codec: yesNoCodec },
];

export const AZURE_ROLE_SETTINGS_COLUMNS: Column[] = [
    { header: "Role", key: "role", codec: textCodec },
    { header: "Role id", key: "roleId", codec: textCodec },
    { header: "Role type", key: "roleType", codec: textCodec },
    { header: "Privileged", key: "privileged", codec: yesNoCodec },
    { header: "Scope", key: "scope", codec: textCodec },
    { header: "Scope level", key: "scopeLevel", codec: textCodec },
    { header: "Scope id", key: "scopeId", codec: textCodec },
    { header: "Settings", key: "settings", codec: textCodec },
    { header: "Changed from default", key: "changed", codec: yesNoCodec },
    { header: "Last changed", key: "lastChanged", codec: textCodec },
    ...SETTINGS_TILES.map(([id, label]): Column => ({ header: label, key: `tile.${id}`, codec: textCodec })),
];

/** The subscription a scope is in (itself when it is one); null for the root, a management group or a broken chain */
export function subscriptionOf(scope: AzureScope, scopes: AzureScope[]): AzureScope | null {
    const byId = new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
    let current: AzureScope | undefined = scope;
    for (let step = 0; step <= scopes.length && current; step++) {
        if (current.level === "subscription") return current;
        if (current.parentId === null) return null;
        current = byId.get(current.parentId.toLowerCase());
    }
    return null;
}

const day = (value: string | null | undefined): string => (value ? value.slice(0, 10) : "");

export function buildAzureAssignmentRows(rows: AzureAssignmentRow[], ctx: AzureRowContext): ExportRow[] {
    return rows.map((row) => {
        const a = row.assignment;
        const s = row.scope;
        const sub = subscriptionOf(s, ctx.scopes);
        return {
            workload: AZURE_WORKLOAD,
            role: a.roleName,
            assignment: a.state === "eligible" ? "Eligible" : a.endDateTime === null && !a.isActivated ? "Permanent" : "Active",
            name: a.principalName,
            upn: a.principalUpn ?? "",
            objectId: ctx.anonymisedIds?.has(a.principalId.toLowerCase()) ? "" : a.principalId,
            principalType: row.principalTypeLabel,
            memberType: a.isViaGroup ? "Group" : "Direct",
            start: day(a.startDateTime),
            end: day(a.endDateTime),
            scope: s.name,
            scopeLevel: SCOPE_LEVEL_LABELS[s.level],
            scopeId: s.id,
            resourceType: s.resourceType ?? "",
            subscription: sub?.name ?? "",
            delegated: sub ? isDelegatedScope(sub, ctx.homeTenantId) : false,
            roleId: a.roleDefinitionId,
            roleType: a.isCustomRole ? "Custom" : "Built-in",
            privileged: AZURE_PRIVILEGED_ROLE_IDS.has(a.roleDefinitionId.toLowerCase()),
            emergency: ctx.emergencyIds.has(a.principalId.toLowerCase()),
            origin: a.state === "eligible" ? "" : a.isActivated ? "Activated" : "Assigned",
            inherited: row.isInherited,
        };
    });
}

/** One pair per role and scope in the rows, in tree order of the scope, then by role name */
export function rolePairsOf(rows: AzureAssignmentRow[], scopes: AzureScope[]): AzureRolePair[] {
    const pairs = new Map<string, AzureRolePair>();
    for (const row of rows) {
        const a = row.assignment;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        if (pairs.has(key)) continue;
        pairs.set(key, { scopeId: a.scopeId, roleDefinitionId: a.roleDefinitionId, roleName: a.roleName, isCustom: a.isCustomRole === true, scope: row.scope });
    }
    const order = new Map<string, number>();
    flattenScopeTree(scopes).forEach((treeRow, index) => order.set(treeRow.scope.id.toLowerCase(), index));
    const position = (pair: AzureRolePair): number => order.get(pair.scopeId.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return [...pairs.values()].sort((x, y) => position(x) - position(y) || x.roleName.localeCompare(y.roleName, "en"));
}

/** The Settings cell: what the page knows about the policy of a pair */
export function settingsTextOf(outcome: AzurePolicyOutcome | undefined): string {
    switch (outcome?.status) {
        case "loaded": return "Loaded";
        case "missing": return "No role settings";
        case "noAccess": return "Not readable";
        case "unavailable": return "Not available at root";
        default: return "Not loaded";
    }
}

export function buildAzureRoleSettingsRows(pairs: AzureRolePair[], outcomeOf: (pair: AzureRolePair) => AzurePolicyOutcome | undefined): ExportRow[] {
    return pairs.map((pair) => {
        // Root is never read from ARM (400 InvalidResource): without a read outcome it is still not available there
        const outcome = outcomeOf(pair) ?? (isRootScope(pair.scopeId) ? { status: "unavailable" as const } : undefined);
        const isPrivileged = AZURE_PRIVILEGED_ROLE_IDS.has(pair.roleDefinitionId.toLowerCase());
        const loaded = outcome?.status === "loaded" ? outcome : null;
        return {
            role: pair.roleName,
            roleId: pair.roleDefinitionId,
            roleType: pair.isCustom ? "Custom" : "Built-in",
            privileged: isPrivileged,
            scope: pair.scope.name,
            scopeLevel: SCOPE_LEVEL_LABELS[pair.scope.level],
            scopeId: pair.scope.id,
            settings: settingsTextOf(outcome),
            changed: loaded ? loaded.lastModified !== null : undefined,
            lastChanged: loaded ? day(loaded.lastModified) : "",
            ...(loaded ? policyTileTexts(loaded.rules, { isPrivileged }) : {}),
        };
    });
}

export interface AzureAnonymised {
    rows: AzureAssignmentRow[];
    outcomeOf: (pair: AzureRolePair) => AzurePolicyOutcome | undefined;
    ids: Set<string>;
}

/**
 * Replaces the name and UPN of every user by "Person n", the same label for the same person everywhere, also in the
 * rules of a policy (approvers, extra recipients). Groups and apps keep their names. Returns copies, never edits the input.
 */
export function anonymiseAzure(rows: AzureAssignmentRow[], outcomeOf: (pair: AzureRolePair) => AzurePolicyOutcome | undefined): AzureAnonymised {
    const labels = new Map<string, string>();
    const ids = new Set<string>();

    const labelFor = (id: string): string => {
        let label = labels.get(id);
        if (!label) {
            label = `Person ${labels.size + 1}`;
            labels.set(id, label);
        }
        ids.add(id);
        return label;
    };

    const swapped = rows.map((row) => {
        if (row.assignment.principalType !== "User") return row;
        return { ...row, assignment: { ...row.assignment, principalName: labelFor(row.assignment.principalId.toLowerCase()), principalUpn: undefined } };
    });

    const scrubbed = new Map<string, AzurePolicyOutcome>();
    const scrubbedOutcomeOf = (pair: AzureRolePair): AzurePolicyOutcome | undefined => {
        const outcome = outcomeOf(pair);
        if (outcome?.status !== "loaded") return outcome;
        const key = azurePolicyKey(pair.scopeId, pair.roleDefinitionId);
        let copy = scrubbed.get(key);
        if (!copy) {
            copy = { ...outcome, rules: scrubPolicyRules(outcome.rules, labelFor) ?? outcome.rules };
            scrubbed.set(key, copy);
        }
        return copy;
    };
    return { rows: swapped, outcomeOf: scrubbedOutcomeOf, ids };
}
