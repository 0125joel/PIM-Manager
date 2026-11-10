/**
 * What the Azure dashboard counts: the assignments after the scope bar (chosen scope, Include inherited, delegated) and
 * after the filter, the path and counts of the scope bar, and the summary of the PIM alerts. Pure logic, no React, no service.
 */
import type { ArmRoleManagementAlert, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { isAboveChosenScope, isDelegatedAssignment } from "@/utils/azureDashboard";
import { eligiblePairsOf, matchesAzureFilters, type AzureFilterContext, type AzureReportFilters } from "@/utils/azureReport";
import { isDelegatedScope } from "@/utils/azureScopes";

export interface AzureDashboardView {
    /** Assignments after the scope bar (chosen scope, Include inherited, delegated) */
    inView: AzureAssignment[];
    /** And after the filter: what every number counts */
    counted: AzureAssignment[];
}

function scopesByLowerId(scopes: readonly AzureScope[]): Map<string, AzureScope> {
    return new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
}

/** True when the scope is the chosen scope or below it (the chosen scope is on its `parentId` chain) */
function isAtOrBelow(scopeId: string, chosenKey: string, byId: ReadonlyMap<string, AzureScope>): boolean {
    let key = scopeId.toLowerCase();
    const seen = new Set<string>();
    while (!seen.has(key)) {
        if (key === chosenKey) return true;
        seen.add(key);
        const parentId = byId.get(key)?.parentId ?? null;
        if (parentId === null) return false;
        key = parentId.toLowerCase();
    }
    return false;
}

/**
 * The assignments the dashboard counts. `origin` in the filters is ignored: the scope bar decides it (Include inherited).
 * An assignment on a scope that is not in the tree is in view but not counted, as the Report leaves it out.
 */
export function buildAzureDashboardView(input: {
    assignments: AzureAssignment[];
    scopes: AzureScope[];
    chosenScopeId: string | null;
    includeInherited: boolean;
    includeDelegated: boolean;
    homeTenantId?: string;
    filters: AzureReportFilters;
    context: AzureFilterContext;
    now: Date;
}): AzureDashboardView {
    const { assignments, scopes, chosenScopeId, includeInherited, includeDelegated, homeTenantId, filters, context, now } = input;
    const byId = scopesByLowerId(scopes);
    const chosenKey = chosenScopeId === null ? null : chosenScopeId.toLowerCase();

    const inView = assignments.filter((a) => {
        if (!includeDelegated && isDelegatedAssignment(a, byId, homeTenantId)) return false;
        if (chosenKey === null) return true;
        if (isAtOrBelow(a.scopeId, chosenKey, byId)) return true;
        return includeInherited && isAboveChosenScope(a, chosenScopeId, byId);
    });

    const effectiveFilters: AzureReportFilters = { ...filters, origin: "all" };
    const effectiveContext: AzureFilterContext = context.eligiblePairs || !filters.noEligible ? context : { ...context, eligiblePairs: eligiblePairsOf(assignments) };
    const nowMs = now.getTime();
    const counted = inView.filter((a) => {
        const scope = byId.get(a.scopeId.toLowerCase());
        if (!scope) return false;
        const isAbove = isAboveChosenScope(a, chosenScopeId, byId);
        // Origin here and all are the scope bar's; Inherited keeps what is above the chosen scope
        if (filters.origin === "inherited" && !isAbove) return false;
        return matchesAzureFilters(a, scope, isAbove, effectiveFilters, effectiveContext, nowMs);
    });
    return { inView, counted };
}

/** The names from the top of the tree to the chosen scope; empty when nothing is chosen or the scope is not in the tree */
export function azureScopePath(scopes: readonly AzureScope[], chosenScopeId: string | null): string[] {
    if (chosenScopeId === null) return [];
    const byId = scopesByLowerId(scopes);
    const names: string[] = [];
    const seen = new Set<string>();
    let key: string | null = chosenScopeId.toLowerCase();
    while (key !== null && !seen.has(key)) {
        seen.add(key);
        const scope = byId.get(key);
        if (!scope) break;
        names.unshift(scope.name);
        key = scope.parentId === null ? null : scope.parentId.toLowerCase();
    }
    return names;
}

/**
 * True when a subscription in view is read only in part (`access` "partial"): the chosen scope is that subscription, lies
 * below it or holds it, and a delegated subscription counts only while delegated subscriptions are on.
 */
export function hasPartialInView(scopes: readonly AzureScope[], chosenScopeId: string | null, includeDelegated: boolean, homeTenantId: string | undefined): boolean {
    const byId = scopesByLowerId(scopes);
    const chosenKey = chosenScopeId === null ? null : chosenScopeId.toLowerCase();
    return scopes.some((s) => {
        if (s.level !== "subscription" || s.access !== "partial") return false;
        if (!includeDelegated && isDelegatedScope(s, homeTenantId)) return false;
        if (chosenKey === null) return true;
        return isAtOrBelow(s.id, chosenKey, byId) || isAtOrBelow(chosenKey, s.id.toLowerCase(), byId);
    });
}

export interface AzureScopeCounts {
    managementGroups: number;
    subscriptions: number;
    /** Subscriptions of the home tenant */
    homeSubscriptions: number;
    /** Home subscriptions read as a whole (no `access` set) */
    readableSubscriptions: number;
    /** All subscriptions, home and delegated, read as a whole: the visibility line counts these against `subscriptions` (as the load banner does) */
    readableAllSubscriptions: number;
    delegatedSubscriptions: number;
    /** A home subscription is not read as a whole: "Why not all?" */
    hasUnreadable: boolean;
}

export function countAzureScopes(scopes: readonly AzureScope[], homeTenantId: string | undefined): AzureScopeCounts {
    const subscriptions = scopes.filter((s) => s.level === "subscription");
    const delegated = subscriptions.filter((s) => isDelegatedScope(s, homeTenantId));
    const home = subscriptions.filter((s) => !isDelegatedScope(s, homeTenantId));
    const readable = home.filter((s) => s.access === undefined);
    return {
        managementGroups: scopes.filter((s) => s.level === "managementGroup").length,
        subscriptions: subscriptions.length,
        homeSubscriptions: home.length,
        readableSubscriptions: readable.length,
        readableAllSubscriptions: subscriptions.filter((s) => s.access === undefined).length,
        delegatedSubscriptions: delegated.length,
        hasUnreadable: readable.length < home.length,
    };
}

// ---------------------------------------------------------------------------------------------
// PIM alerts of the subscriptions (From Microsoft)
// ---------------------------------------------------------------------------------------------

export type AzureAlertsOutcome = { status: "loaded"; alerts: ArmRoleManagementAlert[] } | { status: "noAccess" } | { status: "failed" };

export interface AzureAlertRow {
    key: string;
    name: string;
    severity: string;
    incidentCount: number;
    subscriptionId: string;
    subscriptionName: string;
    description: string | undefined;
    mitigationSteps: string | undefined;
}

export interface AzureAlertsSummary {
    /** Active alerts, High before Medium */
    rows: AzureAlertRow[];
    /** Subscriptions read (a loaded answer) */
    read: number;
    /** Of those read, the delegated ones */
    delegatedRead: number;
    withAlert: number;
    clear: number;
    /** Read, but Microsoft has not run the alerts there */
    notScanned: number;
    /** Not readable: ARM refused the alerts, or the read failed */
    notReadable: number;
}

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** ARM answers `0001-01-01T00:00:00...` for an alert that was never scanned (measured 2026-10-24) */
function isNeverScanned(alert: ArmRoleManagementAlert): boolean {
    const scanned = alert.properties.lastScannedDateTime;
    return !scanned || scanned.startsWith("0001-01-01");
}

/**
 * `alerts` by lowercase subscription id; `nameOf` and `isDelegated` are asked per lowercase subscription id.
 * A subscription is not scanned when every alert's `lastScannedDateTime` is empty or `0001-01-01`; one with an active
 * alert counts as "with an alert", never as not scanned.
 */
export function summarizeAzureAlerts(
    alerts: ReadonlyMap<string, AzureAlertsOutcome>,
    nameOf: (subscriptionId: string) => string,
    isDelegated: (subscriptionId: string) => boolean,
): AzureAlertsSummary {
    const rows: AzureAlertRow[] = [];
    let read = 0;
    let delegatedRead = 0;
    let withAlert = 0;
    let notScanned = 0;
    let notReadable = 0;
    for (const [subscriptionId, outcome] of alerts) {
        if (outcome.status !== "loaded") {
            notReadable += 1;
            continue;
        }
        read += 1;
        if (isDelegated(subscriptionId)) delegatedRead += 1;
        const active = outcome.alerts.filter((a) => a.properties.isActive === true);
        if (active.length > 0) {
            withAlert += 1;
            for (const alert of active) {
                const definition = alert.properties.alertDefinition?.properties;
                const name = definition?.displayName ?? alert.name;
                rows.push({
                    key: `${subscriptionId}|${alert.name}`,
                    name,
                    severity: definition?.severityLevel ?? "",
                    incidentCount: alert.properties.incidentCount ?? 0,
                    subscriptionId,
                    subscriptionName: nameOf(subscriptionId),
                    description: definition?.description,
                    mitigationSteps: definition?.mitigationSteps,
                });
            }
        } else if (outcome.alerts.every(isNeverScanned)) {
            notScanned += 1;
        }
    }
    rows.sort((a, b) => {
        const bySeverity = (SEVERITY_RANK[a.severity.toLowerCase()] ?? 3) - (SEVERITY_RANK[b.severity.toLowerCase()] ?? 3);
        if (bySeverity !== 0) return bySeverity;
        const byName = a.name.localeCompare(b.name, "en");
        if (byName !== 0) return byName;
        return a.subscriptionName.localeCompare(b.subscriptionName, "en");
    });
    return { rows, read, delegatedRead, withAlert, clear: read - withAlert - notScanned, notScanned, notReadable };
}
