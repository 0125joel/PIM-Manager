/**
 * The numbers of the Azure dashboard, as the shapes the Entra dashboard blocks render. The counting follows the Entra
 * functions in `dashboardStats.ts` and `dashboardAdvanced.ts`, over Azure assignments. Pure logic, no React, no service.
 */
import type { PimPolicyRule } from "@/types/directoryRole.types";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { MaxDurationBucket } from "@/types/dashboardFilter.types";
import type { PrincipalKind } from "@/types/shared.types";
import { getMaxDurationBucket } from "@/utils/assignmentKinds";
import { dashboardLevelOf, isAboveChosenScope, isDelegatedAssignment, isPrivilegedRole, principalKindOf, type AzurePrincipalKind } from "@/utils/azureDashboard";
import { azurePolicyKey, isRootScope } from "@/utils/azureScopes";
import type { AccountRow, ActivationCharts, AccessRow, ApproverRow, ApproversSummary, DashboardScope, HasAccess, RightNow, RightNowRow } from "@/utils/dashboardAdvanced";
import type { CardStat, TermsStats, WhoStats } from "@/utils/dashboardStats";
import { parseTotalHours } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";

/** One role × scope's settings as the dashboard reads them; `rules` are already in the Graph shape (`graphRulesOf`) */
export type AzureSettingsOutcome = { status: "loaded"; rules: Record<string, unknown>[] } | { status: "missing" | "unavailable" | "noAccess" | "failed" };

export interface AzureDashboardInput {
    /** The assignments in view: the scope bar is already applied (chosen scope, Include inherited, delegated) */
    assignments: AzureAssignment[];
    scopes: AzureScope[];
    homeTenantId?: string;
    /** Role definitions by lowercase GUID; null while they load */
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null;
    /** Settings outcome per `azurePolicyKey(scopeId, roleDefinitionId)`; a missing key is not loaded yet */
    settings: ReadonlyMap<string, AzureSettingsOutcome>;
    /** Graph servicePrincipalType by lowercase object id, or `DELETED_PRINCIPAL`; null when not loaded or failed */
    spTypes: ReadonlyMap<string, string> | null;
    emergencyIds: ReadonlySet<string>;
    now: Date;
    /** True when nothing is chosen in the scope bar ("All you can read") */
    isTopScope: boolean;
    /** The service principal types could not be read (not just still loading): Apps and Managed identities are unknown */
    spTypesFailed?: boolean;
    /** The users and groups could not be checked in Graph: deleted accounts are unknown */
    isDeletedUnknown?: boolean;
    /** The role definitions could not be read (not just still loading): Privileged rests on the built-in privileged roles only */
    definitionsFailed?: boolean;
    /** The scope chosen in the scope bar; null = "All you can read" */
    chosenScopeId: string | null;
    /** Advanced only: which roles the sections count */
    scope: DashboardScope;
}

export type AzureCardId = "roleScope" | "activeNow" | "permanent" | "eligible" | "privileged" | "requireApproval" | "customRoles" | "inherited";

export type AzureEasyToMissId = "permanentOwners" | "eligibleWithoutEnd" | "apps" | "managedIdentities" | "agents" | "guests" | "deleted" | "nobodyNotified" | "onlyPermanent";

export interface AzureEasyToMissRow {
    id: AzureEasyToMissId;
    category: "Access without an end" | "Accounts you may not expect" | "Roles set up halfway";
    label: string;
    /** null while the settings this row needs are still arriving, or when it cannot be told */
    count: number | null;
    /** "None" for a row with 0 */
    detail: string;
    /** The row cannot be told (Q7): shown as a dash, not as a loading skeleton */
    isUnknown?: true;
}

const OWNER_ROLE_ID = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const DAY_MS = 24 * 60 * 60 * 1000;
const APPROVAL_RULE = "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule";

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** A role at a scope, with the assignments in view that were made directly on it */
interface Pair {
    key: string;
    scopeId: string;
    roleId: string;
    roleName: string;
    assignments: AzureAssignment[];
}

function ownPairs(input: AzureDashboardInput): Pair[] {
    const pairs = new Map<string, Pair>();
    const byId = scopesById(input.scopes);
    for (const a of input.assignments) {
        // Own: not made above the chosen scope. `memberType` says how the listing subscription saw it, so it is not used
        if (isAboveChosenScope(a, input.chosenScopeId, byId)) continue;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        const pair = pairs.get(key) ?? { key, scopeId: a.scopeId, roleId: a.roleDefinitionId.toLowerCase(), roleName: a.roleName, assignments: [] };
        pair.assignments.push(a);
        pairs.set(key, pair);
    }
    return [...pairs.values()];
}

function privilegedPairs(input: AzureDashboardInput): Pair[] {
    return ownPairs(input).filter((p) => isPrivilegedRole(p.roleId, input.definitions));
}

function pairsInScope(input: AzureDashboardInput): Pair[] {
    return input.scope === "all" ? ownPairs(input) : privilegedPairs(input);
}

function rulesOf(outcome: AzureSettingsOutcome | undefined): PimPolicyRule[] | null {
    return outcome?.status === "loaded" ? (outcome.rules as unknown as PimPolicyRule[]) : null;
}

function hasNoEntry(input: AzureDashboardInput, pair: Pair): boolean {
    // The root scope has no settings to wait for: they are never read
    return !isRootScope(pair.scopeId) && !input.settings.has(pair.key);
}

function isNoAccess(input: AzureDashboardInput, pair: Pair): boolean {
    // Root pairs are settled and not readable, like a noAccess outcome
    return isRootScope(pair.scopeId) || input.settings.get(pair.key)?.status === "noAccess";
}

/**
 * No settings to count: not readable (root, noAccess) or the read failed (5xx, network, 429 after retries). A failed
 * pair is not "no approval" or "no MFA": it leaves every number about settings, and the page says it could not be read.
 */
function isUncounted(input: AzureDashboardInput, pair: Pair): boolean {
    return isNoAccess(input, pair) || input.settings.get(pair.key)?.status === "failed";
}

const isPermanent = (a: AzureAssignment): boolean => a.state === "active" && a.endDateTime === null;
const isActiveTimeBound = (a: AzureAssignment): boolean => a.state === "active" && a.endDateTime !== null;
const isEmergency = (input: AzureDashboardInput, a: AzureAssignment): boolean => input.emergencyIds.has(a.principalId.toLowerCase());

function scopesById(scopes: AzureScope[]): Map<string, AzureScope> {
    return new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
}

function scopeNameOf(scopeId: string, byId: ReadonlyMap<string, AzureScope>): string {
    return byId.get(scopeId.toLowerCase())?.name ?? scopeId.split("/").filter((s) => s !== "").pop() ?? scopeId;
}

function detailOrNone(count: number | null, detail: string): string {
    return count === 0 ? "None" : detail;
}

function assignmentsInScope(input: AzureDashboardInput): AzureAssignment[] {
    return input.scope === "all" ? input.assignments : input.assignments.filter((a) => isPrivilegedRole(a.roleDefinitionId, input.definitions));
}

// ---------------------------------------------------------------------------------------------
// Basic
// ---------------------------------------------------------------------------------------------

export function computeAzureCards(input: AzureDashboardInput): Record<AzureCardId, CardStat> {
    const all = input.assignments;
    const own = ownPairs(input);
    const byLevel = { managementGroup: 0, subscription: 0, resourceGroup: 0, resource: 0 };
    for (const pair of own) {
        const level = dashboardLevelOf(pair.scopeId);
        if (level) byLevel[level] += 1;
    }

    const active = all.filter((a) => a.state === "active");
    const activated = active.filter((a) => a.isActivated === true).length;
    const permanent = all.filter(isPermanent);
    const emergencyPermanent = permanent.filter((a) => isEmergency(input, a)).length;
    const eligible = all.filter((a) => a.state === "eligible");
    const eligibleNoEnd = eligible.filter((a) => a.endDateTime === null).length;

    // Privileged and approval
    const privileged = privilegedPairs(input);
    // Definitions that failed leave the built-in privileged roles: that count is shown, the page says what it rests on
    const privilegedCard: CardStat = input.definitions === null && input.definitionsFailed !== true
        ? { value: null, breakdown: `role × scope · 0 roles`, isWarning: false }
        : { value: String(privileged.length), breakdown: `role × scope · ${new Set(privileged.map((p) => p.roleId)).size} roles`, isWarning: false };

    // The ratio leaves out the pairs without settings to count (root, noAccess and failed), as computeAzureTerms does, so the card and the block share one denominator
    const readable = privileged.filter((p) => !isUncounted(input, p));
    const approvalBreakdown = `of ${readable.length} privileged role × scope`;
    let approvalCard: CardStat;
    if (privileged.some((p) => hasNoEntry(input, p))) {
        approvalCard = { value: null, breakdown: approvalBreakdown, isWarning: false };
    } else if (privileged.length > 0 && readable.length === 0) {
        approvalCard = { value: "-", breakdown: approvalBreakdown, isWarning: false };
    } else {
        const required = readable.filter((p) => summarizePolicyRules(rulesOf(input.settings.get(p.key))).isApprovalRequired === true).length;
        approvalCard = { value: String(required), breakdown: approvalBreakdown, isWarning: false };
    }

    const custom = own.filter((p) => p.assignments.some((a) => a.isCustomRole === true));
    const customRoleIds = new Set(custom.map((p) => p.roleId)).size;

    const scopeMap = scopesById(input.scopes);
    const inheritedCard: CardStat = input.isTopScope
        ? {
              value: String(all.filter((a) => dashboardLevelOf(a.scopeId) === "managementGroup").length),
              breakdown: "assignments · made on a management group",
              isWarning: false,
          }
        : { value: String(all.filter((a) => isAboveChosenScope(a, input.chosenScopeId, scopeMap)).length), breakdown: "assignments · from above", isWarning: false };

    return {
        roleScope: {
            value: String(own.length),
            breakdown: `role × scope with an assignment · ${byLevel.managementGroup} MG, ${byLevel.subscription} sub, ${byLevel.resourceGroup} RG, ${byLevel.resource} resource`,
            isWarning: false,
        },
        activeNow: { value: String(active.length), breakdown: `assignments · ${activated} activated, ${active.length - activated} assigned`, isWarning: false },
        permanent: { value: String(permanent.length), breakdown: `assignments · ${emergencyPermanent} emergency access`, isWarning: permanent.length - emergencyPermanent > 0 },
        eligible: { value: String(eligible.length), breakdown: `assignments · ${eligibleNoEnd} without an end date`, isWarning: false },
        privileged: privilegedCard,
        requireApproval: approvalCard,
        customRoles: { value: String(custom.length), breakdown: `role × scope · ${customRoleIds} custom roles`, isWarning: false },
        inherited: inheritedCard,
    };
}

export function computeAzureWho(input: AzureDashboardInput): WhoStats {
    const permanent = input.assignments.filter(isPermanent);
    const eligible = input.assignments.filter((a) => a.state === "eligible").length;
    const activeTimeBound = input.assignments.filter(isActiveTimeBound).length;
    return {
        permanent: permanent.length,
        eligible,
        activeTimeBound,
        total: permanent.length + eligible + activeTimeBound,
        emergencyPermanent: permanent.filter((a) => isEmergency(input, a)).length,
    };
}

export function computeAzureTerms(input: AzureDashboardInput): TermsStats {
    // A pair whose settings cannot be read, or whose read failed, is left out: "0 of 35 ask for MFA" would claim what was never read
    const pairs = privilegedPairs(input).filter((p) => !isUncounted(input, p));
    const stats: TermsStats = {
        roleCount: pairs.length,
        entraMfa: 0,
        authContext: 0,
        neither: 0,
        approval: 0,
        justification: 0,
        withoutJustification: 0,
        overEightHours: 0,
        isPending: pairs.some((p) => hasNoEntry(input, p)),
    };
    for (const pair of pairs) {
        const summary = summarizePolicyRules(rulesOf(input.settings.get(pair.key)));
        if (!summary.isLoaded) continue;
        if (summary.hasPimMfa) stats.entraMfa += 1;
        else if (summary.hasAuthContext) stats.authContext += 1;
        else stats.neither += 1;
        if (summary.isApprovalRequired) stats.approval += 1;
        if (summary.isJustificationRequired) stats.justification += 1;
        else stats.withoutJustification += 1;
        const hours = parseTotalHours(summary.maxDuration);
        if (hours !== null && hours > 8) stats.overEightHours += 1;
    }
    return stats;
}

/**
 * The role × scope pairs of the dashboard's roles (`scope`: privileged or all) whose settings read failed, of all those
 * pairs. Over every assignment, as the not readable note. Null when none failed.
 */
export function countAzureSettingsFailed(
    assignments: readonly AzureAssignment[],
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null,
    settings: ReadonlyMap<string, { status: string }>,
    scope: DashboardScope,
): { n: number; m: number } | null {
    const pairs = new Map<string, boolean>();
    for (const a of assignments) {
        if (scope === "privileged" && !isPrivilegedRole(a.roleDefinitionId, definitions)) continue;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        if (!pairs.has(key)) pairs.set(key, settings.get(key)?.status === "failed");
    }
    const n = [...pairs.values()].filter(Boolean).length;
    return n > 0 ? { n, m: pairs.size } : null;
}

/** The pairs the Advanced sections count (`input.scope`) whose settings read failed: in `unloaded` of the activation charts, but settled */
export function countAzureFailedPairs(input: AzureDashboardInput): number {
    return pairsInScope(input).filter((p) => input.settings.get(p.key)?.status === "failed").length;
}

export function computeAzureEasyToMiss(input: AzureDashboardInput): AzureEasyToMissRow[] {
    const all = input.assignments;
    const privilegedAssignments = all.filter((a) => isPrivilegedRole(a.roleDefinitionId, input.definitions));
    const distinct = (list: AzureAssignment[]): number => new Set(list.map((a) => a.principalId.toLowerCase())).size;
    const ofKind = (list: AzureAssignment[], kind: AzurePrincipalKind): AzureAssignment[] => list.filter((a) => principalKindOf(a, input.spTypes) === kind);

    const permanentOwners = all.filter((a) => {
        if (a.roleDefinitionId.toLowerCase() !== OWNER_ROLE_ID || !isPermanent(a) || isEmergency(input, a)) return false;
        const level = dashboardLevelOf(a.scopeId);
        return level === "managementGroup" || level === "subscription";
    }).length;
    const eligibleWithoutEnd = all.filter((a) => a.state === "eligible" && a.endDateTime === null).length;

    let apps: number | null;
    let managedIdentities: number | null;
    let appsDetail: string;
    let managedDetail: string;
    if (input.spTypes === null) {
        const together = distinct(ofKind(privilegedAssignments, "servicePrincipal"));
        apps = null;
        managedIdentities = null;
        appsDetail = `Could not tell apps from managed identities. ${together} together, always active.`;
        managedDetail = appsDetail;
    } else {
        apps = distinct(ofKind(privilegedAssignments, "app"));
        managedIdentities = distinct(ofKind(privilegedAssignments, "managedIdentity"));
        appsDetail = detailOrNone(apps, "Always active: Azure does not let them be eligible.");
        managedDetail = detailOrNone(managedIdentities, "Always active: Azure does not let them be eligible.");
    }
    const agents = distinct(ofKind(all, "agent"));
    const guests = distinct(ofKind(all, "guest"));
    // null while the reads run, unknown when they failed; spTypes holds the deleted ones (DELETED_PRINCIPAL)
    const isDeletedUnknown = input.isDeletedUnknown === true || (input.spTypes === null && input.spTypesFailed === true);
    const deleted = input.spTypes === null || isDeletedUnknown ? null : distinct(ofKind(all, "deleted"));

    const privileged = privilegedPairs(input);
    const nobodyNotified = privileged.some((p) => hasNoEntry(input, p))
        ? null
        : privileged.filter((p) => {
              const rule = summarizePolicyRules(rulesOf(input.settings.get(p.key))).activationNotification;
              return rule !== undefined && !rule.isDefaultRecipientsEnabled && rule.notificationRecipients.length === 0;
          }).length;
    const onlyPermanent = privileged.filter((p) => p.assignments.some((a) => a.state === "active") && !p.assignments.some((a) => a.state === "eligible")).length;

    const unknown: { isUnknown?: true } = input.spTypes === null && input.spTypesFailed === true ? { isUnknown: true } : {};
    return [
        { id: "permanentOwners", category: "Access without an end", label: "Permanent Owners at subscription or above", count: permanentOwners, detail: detailOrNone(permanentOwners, "Emergency access left out.") },
        { id: "eligibleWithoutEnd", category: "Access without an end", label: "Eligible without an end date", count: eligibleWithoutEnd, detail: detailOrNone(eligibleWithoutEnd, "Never comes up for review by itself.") },
        { id: "apps", category: "Accounts you may not expect", label: "Apps with a privileged role", count: apps, detail: appsDetail, ...unknown },
        { id: "managedIdentities", category: "Accounts you may not expect", label: "Managed identities with a privileged role", count: managedIdentities, detail: managedDetail, ...unknown },
        { id: "agents", category: "Accounts you may not expect", label: "Agents with a role", count: agents, detail: detailOrNone(agents, "AI agents (Microsoft Entra Agent ID) that hold a role. Active only.") },
        { id: "guests", category: "Accounts you may not expect", label: "Guests with a role", count: guests, detail: detailOrNone(guests, "Accounts from another tenant.") },
        {
            id: "deleted", category: "Accounts you may not expect", label: "Deleted accounts with a role", count: deleted,
            detail: isDeletedUnknown ? "Could not check which accounts still exist." : detailOrNone(deleted, "Not found in Microsoft Entra ID. The role stays until it is removed."),
            ...(isDeletedUnknown ? { isUnknown: true as const } : {}),
        },
        { id: "nobodyNotified", category: "Roles set up halfway", label: "Nobody is notified on activation", count: nobodyNotified, detail: detailOrNone(nobodyNotified, "Privileged role × scope where activation goes unnoticed.") },
        { id: "onlyPermanent", category: "Roles set up halfway", label: "Only permanent assignments", count: onlyPermanent, detail: detailOrNone(onlyPermanent, "Privileged role × scope that nobody activates, PIM is not used.") },
    ];
}

// ---------------------------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------------------------

const ACCESS_LEVELS = [
    { level: "managementGroup", label: "Management group" },
    { level: "subscription", label: "Subscription" },
    { level: "resourceGroup", label: "Resource group" },
    { level: "resource", label: "Resource" },
] as const;

export function computeAzureHasAccess(input: AzureDashboardInput): HasAccess {
    const inScope = assignmentsInScope(input);
    const rows: AccessRow[] = ACCESS_LEVELS.map(({ level, label }) => {
        const list = inScope.filter((a) => dashboardLevelOf(a.scopeId) === level);
        const permanent = list.filter(isPermanent).length;
        const eligible = list.filter((a) => a.state === "eligible").length;
        const activeTimeBound = list.filter(isActiveTimeBound).length;
        return { label, permanent, eligible, activeTimeBound, total: permanent + eligible + activeTimeBound };
    });
    const viaGroup = inScope.filter((a) => a.isViaGroup === true).length;
    // By the ARM type: a deleted group still holds its roles
    const groups = new Set(inScope.filter((a) => a.principalType === "Group" || a.principalType === "ForeignGroup").map((a) => a.principalId.toLowerCase()));
    return { rows, direct: inScope.length - viaGroup, viaGroup, groupsHoldingRoles: groups.size };
}

export function computeAzureActivation(input: AzureDashboardInput): ActivationCharts {
    const pairs = pairsInScope(input);
    const durations: Record<MaxDurationBucket, number> = { upTo1h: 0, upTo4h: 0, upTo8h: 0, upTo12h: 0, over12h: 0 };
    let entraMfa = 0;
    let authContext = 0;
    let neither = 0;
    let approvalRequired = 0;
    let justificationRequired = 0;
    let loaded = 0;
    const notReadable = pairs.filter((p) => isNoAccess(input, p)).length;

    for (const pair of pairs) {
        const summary = summarizePolicyRules(rulesOf(input.settings.get(pair.key)));
        if (!summary.isLoaded) continue;
        loaded += 1;
        if (summary.hasPimMfa) entraMfa += 1;
        else if (summary.hasAuthContext) authContext += 1;
        else neither += 1;
        if (summary.isApprovalRequired) approvalRequired += 1;
        if (summary.isJustificationRequired) justificationRequired += 1;
        const bucket = getMaxDurationBucket(parseTotalHours(summary.maxDuration));
        if (bucket) durations[bucket] += 1;
    }
    return {
        roleCount: pairs.length,
        entraMfa,
        authContext,
        neither,
        approvalRequired,
        approvalNotRequired: loaded - approvalRequired,
        justificationRequired,
        justificationNotRequired: loaded - justificationRequired,
        durations,
        unloaded: pairs.length - loaded - notReadable,
        notReadable,
    };
}

const ENTRA_KIND: Record<AzurePrincipalKind, PrincipalKind> = {
    user: "user",
    guest: "user",
    group: "group",
    app: "servicePrincipal",
    managedIdentity: "servicePrincipal",
    servicePrincipal: "servicePrincipal",
    agent: "agentIdentity",
    deleted: "unknown",
    unknown: "unknown",
};

const KIND_TAG: Partial<Record<AzurePrincipalKind, string>> = { guest: "guest", app: "app", managedIdentity: "managed identity", agent: "agent", group: "group", deleted: "deleted" };

export function computeAzureAccounts(input: AzureDashboardInput, limit = 6): AccountRow[] {
    const byId = scopesById(input.scopes);
    const accounts = new Map<string, AccountRow & { kindOf: AzurePrincipalKind; roleIds: Set<string>; permanentRoleIds: Set<string>; eligibleRoleIds: Set<string>; isDelegated: boolean }>();
    for (const a of assignmentsInScope(input)) {
        const kind = principalKindOf(a, input.spTypes);
        // A deleted group is still a group, not an account
        if (kind === "group" || a.principalType === "Group" || a.principalType === "ForeignGroup") continue;
        const id = a.principalId.toLowerCase();
        const entry = accounts.get(id) ?? {
            id: a.principalId,
            name: a.principalName,
            kind: ENTRA_KIND[kind],
            kindOf: kind,
            isEmergency: input.emergencyIds.has(id),
            privilegedRoles: 0,
            permanent: 0,
            eligible: 0,
            roleIds: new Set<string>(),
            permanentRoleIds: new Set<string>(),
            eligibleRoleIds: new Set<string>(),
            isDelegated: false,
        };
        const roleId = a.roleDefinitionId.toLowerCase();
        entry.roleIds.add(roleId);
        if (isPermanent(a)) entry.permanentRoleIds.add(roleId);
        if (a.state === "eligible") entry.eligibleRoleIds.add(roleId);
        if (isDelegatedAssignment(a, byId, input.homeTenantId)) entry.isDelegated = true;
        accounts.set(id, entry);
    }
    return [...accounts.values()]
        .map(({ roleIds, permanentRoleIds, eligibleRoleIds, kindOf, isDelegated, ...row }) => {
            const tags = [KIND_TAG[kindOf], row.isEmergency ? "emergency" : undefined, isDelegated ? "delegated" : undefined].filter((t): t is string => t !== undefined);
            return { ...row, privilegedRoles: roleIds.size, permanent: permanentRoleIds.size, eligible: eligibleRoleIds.size, tags };
        })
        .sort((a, b) => b.privilegedRoles - a.privilegedRoles || b.permanent - a.permanent || a.name.localeCompare(b.name))
        .slice(0, limit);
}

export function computeAzureApprovers(input: AzureDashboardInput, limit = 6): ApproversSummary {
    const byKey = new Map<string, ApproverRow>();
    const names = new Map<string, string>();
    const single: { role: string; key: string }[] = [];
    const byId = scopesById(input.scopes);
    let requiring = 0;
    for (const pair of pairsInScope(input)) {
        const rules = rulesOf(input.settings.get(pair.key));
        if (summarizePolicyRules(rules).isApprovalRequired !== true) continue;
        requiring += 1;
        const rule = rules?.find((r) => r["@odata.type"] === APPROVAL_RULE);
        const keys = new Set<string>();
        for (const stage of rule?.setting?.approvalStages ?? []) {
            for (const approver of stage.primaryApprovers ?? []) {
                const id = approver.groupId ?? approver.userId;
                if (!id) continue;
                const key = `${approver.groupId ? "group" : "user"}:${id.toLowerCase()}`;
                keys.add(key);
                if (!names.has(key)) names.set(key, approver.description || `Unknown (${id.slice(0, 8)})`);
            }
        }
        for (const key of keys) {
            const row = byKey.get(key) ?? { id: key, name: "", isGroup: key.startsWith("group:"), roleCount: 0 };
            row.roleCount += 1;
            byKey.set(key, row);
        }
        if (keys.size === 1) single.push({ role: `${pair.roleName} · ${scopeNameOf(pair.scopeId, byId)}`, key: [...keys][0] });
    }
    const approvers = [...byKey.values()]
        .map((row) => ({ ...row, name: names.get(row.id) ?? "Unknown approver" }))
        .sort((a, b) => b.roleCount - a.roleCount || a.name.localeCompare(b.name))
        .slice(0, limit);
    return {
        approvers,
        singleApproverRoles: single.map((s) => ({ role: s.role, approver: names.get(s.key) ?? "an approver" })).sort((a, b) => a.role.localeCompare(b.role)),
        requiringApproval: requiring,
    };
}

export function computeAzureRightNow(input: AzureDashboardInput, limit = 4): RightNow {
    const byId = scopesById(input.scopes);
    const nowMs = input.now.getTime();
    const activated: RightNowRow[] = [];
    const ending: RightNowRow[] = [];
    for (const a of input.assignments) {
        const endMs = a.endDateTime ? new Date(a.endDateTime).getTime() : NaN;
        if (Number.isNaN(endMs) || endMs <= nowMs) continue;
        const row: RightNowRow = { who: a.principalName, what: `${a.roleName} · ${scopeNameOf(a.scopeId, byId)}`, msLeft: endMs - nowMs, principalId: a.principalId };
        if (a.state === "active" && a.isActivated === true) activated.push(row);
        else if (a.state === "eligible" && endMs <= nowMs + 7 * DAY_MS) ending.push(row);
    }
    const bySoonest = (a: RightNowRow, b: RightNowRow) => a.msLeft - b.msLeft;
    activated.sort(bySoonest);
    ending.sort(bySoonest);
    return { activated: activated.slice(0, limit), activatedCount: activated.length, ending: ending.slice(0, limit), endingCount: ending.length };
}
