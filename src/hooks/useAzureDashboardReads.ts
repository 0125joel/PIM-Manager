"use client";

import type { Client } from "@microsoft/microsoft-graph-client";
import { useEffect, useState } from "react";
import { useAzureActions, useAzureData, useAzureLoading } from "@/contexts/AzureContext";
import { readAzureRolePolicyPairs, resetAzureRolePolicies, type AzureRolePolicyOutcome, type AzureRolePolicyPair } from "@/hooks/useAzureRolePolicy";
import { useGraphClient } from "@/hooks/usePimSelectors";
import { listRoleManagementAlerts } from "@/services/azureAlertService";
import { readExistingDirectoryIds, readServicePrincipalTypes } from "@/services/servicePrincipalTypeService";
import { listRoleDefinitions } from "@/services/azureRoleDefinitionService";
import type { ArmRoleDefinition, ArmRoleManagementAlert, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { ArmError, type ArmClient } from "@/utils/armClient";
import { DELETED_PRINCIPAL, directoryLookupIds, isPrivilegedRole, type DirectoryLookupIds } from "@/utils/azureDashboard";
import { azurePolicyKey, isRootScope } from "@/utils/azureScopes";
import type { DashboardScope } from "@/utils/dashboardAdvanced";
import { Logger } from "@/utils/logger";
import { armRateLimiter } from "@/utils/rateLimiter";
import { runWorkerPool } from "@/utils/workerPool";

/**
 * The reads the Azure dashboard needs after the assignments are in (dashboard spec section 3.2): role definitions with
 * their actions, the role settings of the right role and scope pairs, the type of each service principal (and which
 * principals are deleted) and the PIM
 * alerts per subscription, in a fixed order, on the worker pool and the limiters. Read only.
 */

export type AzureDefinitionsState =
    | { status: "loading" }
    | { status: "loaded"; byId: ReadonlyMap<string, ArmRoleDefinition>; source: "tenant" | "subscriptions" }
    /** Read per subscription, and the custom roles of `failedSubscriptions` of `subscriptionCount` could not be read: never cached */
    | { status: "partial"; byId: ReadonlyMap<string, ArmRoleDefinition>; source: "subscriptions"; failedSubscriptions: number; subscriptionCount: number }
    | { status: "failed" };

/** The definitions to count with: the loaded or partial list, else null (loading or failed, the built-in privileged roles only) */
export function definitionsOf(state: AzureDefinitionsState): ReadonlyMap<string, ArmRoleDefinition> | null {
    return state.status === "loaded" || state.status === "partial" ? state.byId : null;
}
/**
 * `byId`: the servicePrincipalType per lowercase id, and `DELETED_PRINCIPAL` for a principal Graph does not find.
 * `isDeletedChecked` is false when the users and groups could not be read: then a deleted one cannot be told.
 */
export type AzureSpTypesState = { status: "none" } | { status: "loading" } | { status: "loaded"; byId: ReadonlyMap<string, string>; isDeletedChecked: boolean } | { status: "failed" };
export type AzureAlertOutcome = { status: "loaded"; alerts: ArmRoleManagementAlert[] } | { status: "noAccess" } | { status: "failed" };

export interface AzureDashboardReads {
    definitions: AzureDefinitionsState;
    spTypes: AzureSpTypesState;
    /** By `azurePolicyKey`; a missing key is not read yet */
    settings: ReadonlyMap<string, AzureRolePolicyOutcome>;
    settingsProgress: { done: number; total: number };
    /** By lowercase subscription id */
    alerts: ReadonlyMap<string, AzureAlertOutcome>;
    alertsProgress: { done: number; total: number };
}

interface DefinitionsCache {
    byId: ReadonlyMap<string, ArmRoleDefinition>;
    source: "tenant" | "subscriptions";
}

/** The role definitions of this page session. Memory only, never storage; only a complete result is kept, never a partial one or a failure */
let definitionsCache: DefinitionsCache | null = null;

/** Forget the role definitions: on Refresh (`resetAzureDashboardForRefresh`), and in tests */
export function resetAzureRoleDefinitions(): void {
    definitionsCache = null;
}

/** What the Refresh of the dashboard forgets, so it reads again: the role settings and the role definitions */
export function resetAzureDashboardForRefresh(): void {
    resetAzureRolePolicies();
    resetAzureRoleDefinitions();
}

/**
 * What one load of the Azure data has read that does not depend on the dashboard scope: the service principal types and
 * the alerts. Kept per load (`loadKey` of `useAzureData`: the `lastFetched` and the number of assignments) so a switch between Privileged and All roles does
 * not read them again. Memory only; a Refresh gives a new key.
 */
let loadCache: { key: string; spTypes?: AzureSpTypesState; alerts?: Map<string, AzureAlertOutcome> } | null = null;

/** Tests and nothing else */
export function resetAzureDashboardLoadCache(): void {
    loadCache = null;
}

const INITIAL_READS: AzureDashboardReads = {
    definitions: { status: "loading" },
    spTypes: { status: "loading" },
    settings: new Map(),
    settingsProgress: { done: 0, total: 0 },
    alerts: new Map(),
    alertsProgress: { done: 0, total: 0 },
};

/** The subscription id of a `/subscriptions/{id}` scope id */
function subscriptionIdOf(scopeId: string): string {
    return scopeId.split("/").filter((s) => s !== "")[1] ?? "";
}

/**
 * What the reads ask for, pure. `definitions` null (loading or failed) leaves the five known privileged roles.
 * Settings: the distinct own pairs of all assignments (an assignment on a management group arrives as inherited from
 * every subscription, but its settings live at its own scope), never the root, only privileged roles for `privileged`.
 * Alerts: the subscriptions read as a whole; a subscription with `access` set is not asked (ARM refuses alerts there).
 */
export function planAzureDashboardReads(input: {
    assignments: AzureAssignment[];
    scopes: AzureScope[];
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null;
    scope: DashboardScope;
}): { settingsPairs: AzureRolePolicyPair[]; alertSubscriptionIds: string[]; servicePrincipalIds: string[] } {
    const pairs = new Map<string, AzureRolePolicyPair>();
    for (const a of input.assignments) {
        if (isRootScope(a.scopeId)) continue;
        if (input.scope === "privileged" && !isPrivilegedRole(a.roleDefinitionId, input.definitions)) continue;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        if (!pairs.has(key)) pairs.set(key, { scopeId: a.scopeId, roleDefinitionId: a.roleDefinitionId });
    }
    const settingsPairs = [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, pair]) => pair);

    const alertSubscriptionIds = input.scopes
        .filter((s) => s.level === "subscription" && s.access === undefined)
        .map((s) => subscriptionIdOf(s.id))
        .filter((id) => id !== "");

    const servicePrincipalIds = [...new Set(input.assignments.filter((a) => a.principalType === "ServicePrincipal").map((a) => a.principalId.toLowerCase()))];

    return { settingsPairs, alertSubscriptionIds, servicePrincipalIds };
}

/** No read access: 403, `AuthorizationFailed` or `InsufficientPermissions` */
function isNoAccess(error: unknown): boolean {
    return error instanceof ArmError && (error.statusCode === 403 || error.code === "AuthorizationFailed" || error.code === "InsufficientPermissions");
}

function toMap(definitions: ArmRoleDefinition[], into: Map<string, ArmRoleDefinition>): void {
    for (const definition of definitions) into.set(definition.name.toLowerCase(), definition);
}

type ReadDefinitions = DefinitionsCache & { failedSubscriptions: number; subscriptionCount: number };

/** Step 1. Returns null when aborted */
async function readDefinitions(arm: ArmClient, subscriptionIds: string[], signal?: AbortSignal): Promise<ReadDefinitions | "failed" | null> {
    const byId = new Map<string, ArmRoleDefinition>();
    try {
        toMap(await listRoleDefinitions(arm, "/", "BuiltInRole", signal), byId);
        toMap(await listRoleDefinitions(arm, "/", "CustomRole", signal), byId);
        return { byId, source: "tenant", failedSubscriptions: 0, subscriptionCount: 0 };
    } catch (error: unknown) {
        if (signal?.aborted) return null;
        if (!isNoAccess(error)) {
            Logger.warn("Azure", "The role definitions could not be read");
            return "failed";
        }
    }

    // No access at tenant level: the first subscription for the built-in roles, every subscription for the custom ones
    byId.clear();
    if (subscriptionIds.length === 0) return "failed";
    try {
        toMap(await listRoleDefinitions(arm, `/subscriptions/${subscriptionIds[0]}`, "BuiltInRole", signal), byId);
    } catch {
        if (signal?.aborted) return null;
        Logger.warn("Azure", "The role definitions could not be read");
        return "failed";
    }
    let failedSubscriptions = 0;
    await runWorkerPool<string, ArmRoleDefinition[]>({
        items: subscriptionIds,
        workerCount: 4,
        delayMs: 250,
        signal,
        rateLimiter: armRateLimiter,
        costPerItem: 1,
        // An ARM message can hold the UPN, object id and scope: log status and code only
        errorLog: "statusAndCode",
        processor: (id) => listRoleDefinitions(arm, `/subscriptions/${id}`, "CustomRole", signal),
        onItemComplete: (_id, found) => toMap(found, byId),
        // A subscription that fails is counted, so the result is partial and the page says so
        onItemError: () => {
            failedSubscriptions++;
            Logger.warn("Azure", "The custom roles of a subscription could not be read");
        },
    });
    if (signal?.aborted) return null;
    return { byId, source: "subscriptions", failedSubscriptions, subscriptionCount: subscriptionIds.length };
}

/** Role definitions for the session: from the cache, or read (tenant lists, else per subscription). Only a complete list is cached */
export async function loadAzureRoleDefinitions(arm: ArmClient, scopes: AzureScope[], signal?: AbortSignal): Promise<AzureDefinitionsState> {
    if (definitionsCache) return { status: "loaded", ...definitionsCache };
    const subscriptionIds = planAzureDashboardReads({ assignments: [], scopes, definitions: null, scope: "all" }).alertSubscriptionIds;
    const result = await readDefinitions(arm, subscriptionIds, signal);
    if (result === null) return { status: "loading" };
    if (result === "failed") return { status: "failed" };
    const { failedSubscriptions, subscriptionCount, ...list } = result;
    if (failedSubscriptions > 0) return { status: "partial", byId: list.byId, source: "subscriptions", failedSubscriptions, subscriptionCount };
    definitionsCache = list;
    return { status: "loaded", ...list };
}

/**
 * Graph servicePrincipalType for the service principals of these assignments, and with `lookup` which principals no
 * longer exist, once per load (`loadKey` of `useAzureData`). A failed type read fails the whole state; a failed
 * user or group read keeps the types and leaves `isDeletedChecked` false.
 */
export async function loadAzureServicePrincipalTypes(getGraph: () => Promise<Client>, assignments: AzureAssignment[], loadKey: string, signal?: AbortSignal, knownIds?: string[], lookup?: DirectoryLookupIds): Promise<AzureSpTypesState> {
    if (loadCache?.key !== loadKey) loadCache = { key: loadKey };
    const kept = loadCache;
    if (kept.spTypes) return kept.spTypes;
    const ids = knownIds ?? [...new Set(assignments.filter((a) => a.principalType === "ServicePrincipal").map((a) => a.principalId.toLowerCase()))];
    const users = lookup?.users ?? [];
    const groups = lookup?.groups ?? [];
    let spTypes: AzureSpTypesState;
    if (ids.length === 0 && users.length === 0 && groups.length === 0) spTypes = { status: "none" };
    else {
        try {
            const graph = await getGraph();
            const byId = ids.length > 0 ? await readServicePrincipalTypes(graph, ids, signal) : new Map<string, string>();
            if (signal?.aborted) return { status: "loading" };
            let isDeletedChecked = lookup !== undefined;
            if (lookup) {
                // Every chunk answered, so a service principal that did not come back is gone
                for (const id of lookup.servicePrincipals) if (!byId.has(id)) byId.set(id, DELETED_PRINCIPAL);
                try {
                    const existing = new Set([
                        ...(users.length > 0 ? await readExistingDirectoryIds(graph, "/users", users, signal) : []),
                        ...(groups.length > 0 ? await readExistingDirectoryIds(graph, "/groups", groups, signal) : []),
                    ]);
                    for (const id of [...users, ...groups]) if (!existing.has(id)) byId.set(id, DELETED_PRINCIPAL);
                } catch {
                    if (signal?.aborted) return { status: "loading" };
                    Logger.warn("Azure", "The users and groups could not be checked for deleted ones");
                    isDeletedChecked = false;
                }
            }
            spTypes = { status: "loaded", byId, isDeletedChecked };
        } catch {
            if (signal?.aborted) return { status: "loading" };
            spTypes = { status: "failed" };
        }
    }
    if (loadCache?.key === loadKey) loadCache.spTypes = spTypes;
    return spTypes;
}

/**
 * Runs the four reads in order and calls `onChange` with a fresh object after every step and on progress. An abort
 * stops between steps and returns what is there.
 */
export async function runAzureDashboardReads(
    deps: { arm: ArmClient; getGraph: () => Promise<Client>; signal?: AbortSignal; loadKey?: string },
    input: { assignments: AzureAssignment[]; scopes: AzureScope[]; scope: DashboardScope; homeTenantId?: string },
    onChange: (reads: AzureDashboardReads) => void,
): Promise<AzureDashboardReads> {
    const { arm, getGraph, signal, loadKey } = deps;
    if (loadKey !== undefined && loadCache?.key !== loadKey) loadCache = { key: loadKey };
    const kept = loadKey !== undefined ? loadCache : null;
    let reads: AzureDashboardReads = {
        ...INITIAL_READS,
        definitions: definitionsCache ? { status: "loaded", ...definitionsCache } : { status: "loading" },
        ...(kept?.spTypes ? { spTypes: kept.spTypes } : {}),
        ...(kept?.alerts ? { alerts: new Map(kept.alerts), alertsProgress: { done: kept.alerts.size, total: kept.alerts.size } } : {}),
    };
    const emit = (patch: Partial<AzureDashboardReads>) => {
        reads = { ...reads, ...patch };
        onChange(reads);
    };
    emit({});

    // 1. Role definitions
    let definitions: ReadonlyMap<string, ArmRoleDefinition> | null = definitionsCache?.byId ?? null;
    if (!definitionsCache) {
        const result = await loadAzureRoleDefinitions(arm, input.scopes, signal);
        if (result.status === "loading" || signal?.aborted) return reads;
        definitions = definitionsOf(result);
        emit({ definitions: result });
    }
    if (signal?.aborted) return reads;
    const plan = planAzureDashboardReads({ ...input, definitions });

    // 2. Service principal types
    if (kept?.spTypes) emit({ spTypes: kept.spTypes });
    else {
        const lookup = directoryLookupIds(input.assignments, input.scopes, input.homeTenantId);
        const spTypes = await loadAzureServicePrincipalTypes(getGraph, input.assignments, loadKey ?? "", signal, plan.servicePrincipalIds, lookup);
        if (signal?.aborted) return reads;
        if (kept) kept.spTypes = spTypes;
        emit({ spTypes });
    }
    if (signal?.aborted) return reads;

    // 3. Role settings (the shared policy cache means pairs the Report read are not asked again)
    try {
        const settings = await readAzureRolePolicyPairs(arm, plan.settingsPairs, {
            signal,
            onProgress: (done, total) => emit({ settingsProgress: { done, total } }),
        });
        if (signal?.aborted) return reads;
        emit({ settings });
    } catch {
        if (signal?.aborted) return reads;
        Logger.warn("Azure", "The role settings could not be read for the dashboard");
    }
    if (signal?.aborted) return reads;

    // 4. Alerts, per subscription (kept for the load when every subscription has an outcome)
    if (kept?.alerts && plan.alertSubscriptionIds.every((id) => kept.alerts?.has(id.toLowerCase()))) {
        emit({ alerts: new Map(kept.alerts), alertsProgress: { done: plan.alertSubscriptionIds.length, total: plan.alertSubscriptionIds.length } });
        return reads;
    }
    const alerts = new Map<string, AzureAlertOutcome>();
    let alertsDone = 0;
    const alertTotal = plan.alertSubscriptionIds.length;
    emit({ alertsProgress: { done: 0, total: alertTotal } });
    await runWorkerPool<string, AzureAlertOutcome>({
        items: plan.alertSubscriptionIds,
        workerCount: 4,
        delayMs: 250,
        signal,
        rateLimiter: armRateLimiter,
        costPerItem: 1,
        // An ARM message can hold the UPN, object id and scope: log status and code only
        errorLog: "statusAndCode",
        processor: async (subscriptionId) => {
            let outcome: AzureAlertOutcome;
            try {
                outcome = { status: "loaded", alerts: await listRoleManagementAlerts(arm, subscriptionId, signal) };
            } catch (error: unknown) {
                if (signal?.aborted) return null;
                if (error instanceof ArmError && (error.statusCode === 403 || (error.statusCode === 400 && error.code === "ResourceTypeNotSupportedForAlert"))) outcome = { status: "noAccess" };
                else {
                    Logger.warn("Azure", "The alerts of a subscription could not be read");
                    outcome = { status: "failed" };
                }
            }
            alerts.set(subscriptionId.toLowerCase(), outcome);
            alertsDone++;
            emit({ alerts: new Map(alerts), alertsProgress: { done: alertsDone, total: alertTotal } });
            return outcome;
        },
    });
    if (kept && !signal?.aborted && plan.alertSubscriptionIds.every((id) => alerts.has(id.toLowerCase()))) kept.alerts = alerts;
    return reads;
}

/**
 * The dashboard reads for the loaded Azure data. Starts when the Azure load is complete, again after a Refresh
 * or Read the rest (`loadKey`) or when the scope changes, and aborts the previous run. State is only set from the run's callbacks.
 */
export function useAzureDashboardReads(scope: DashboardScope, homeTenantId: string | undefined): AzureDashboardReads {
    const { assignments, scopes, loadKey } = useAzureData();
    const { loading } = useAzureLoading();
    const { getArmClient } = useAzureActions();
    const getGraph = useGraphClient();
    const [reads, setReads] = useState<AzureDashboardReads>(INITIAL_READS);
    const complete = loading.phase === "complete";

    useEffect(() => {
        if (!complete) return;
        const controller = new AbortController();
        runAzureDashboardReads(
            { arm: getArmClient(), getGraph, signal: controller.signal, loadKey },
            { assignments, scopes, scope, homeTenantId },
            (next) => {
                if (!controller.signal.aborted) setReads(next);
            },
        ).catch(() => {
            if (!controller.signal.aborted) Logger.warn("Azure", "The dashboard reads stopped");
        });
        return () => controller.abort();
        // A new run for a Refresh or Read the rest (loadKey) or another scope; the data of that load is read once it is complete
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [complete, loadKey, scope, homeTenantId, getArmClient, getGraph]);

    return reads;
}
