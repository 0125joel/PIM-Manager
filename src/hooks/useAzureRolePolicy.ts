"use client";

import { useEffect, useState } from "react";
import { useAzureActions } from "@/contexts/AzureContext";
import { getRolePolicy } from "@/services/azurePolicyService";
import type { PolicySettings } from "@/types/wizard.types";
import { ArmError, type ArmClient } from "@/utils/armClient";
import { mapArmError } from "@/utils/armErrorMapping";
import { graphRulesOf, parseArmPolicy } from "@/utils/armPolicyRules";
import { azurePolicyKey, isRootScope } from "@/utils/azureScopes";
import { Logger } from "@/utils/logger";
import { armRateLimiter } from "@/utils/rateLimiter";
import { runWorkerPool } from "@/utils/workerPool";

export type AzureRolePolicyState =
    | { status: "idle" }
    | { status: "loading" }
    /** `lastModified` is ARM `lastModifiedDateTime`: set once the policy was ever written, null for the default (spike S8) */
    | { status: "loaded"; settings: PolicySettings; rules: Record<string, unknown>[]; lastModified: string | null }
    | { status: "missing" }
    /** The root scope: PIM settings are not read there, so this is not an error and not a missing policy */
    | { status: "unavailable" }
    /** The user's Azure role does not allow reading role settings at this scope (403, or 400 `InsufficientPermissions`): a fact, not a failure, so no Try again */
    | { status: "noAccess" }
    | { status: "failed"; title: string; detail: string };

export interface AzureRolePolicyTarget {
    scopeId: string;
    /** The role GUID */
    roleDefinitionId: string;
}

export type SettledAzureRolePolicy = Extract<AzureRolePolicyState, { status: "loaded" | "missing" | "unavailable" | "noAccess" }>;
type Settled = SettledAzureRolePolicy;

/**
 * The policies read in this page load, per `scope|role` (lowercase), shared by the settings dialog, the configuration
 * tab and the role list signal (Azure spec 15.6), so one role at one scope is read once. Only a result is kept; a
 * failure is not, so "Try again" reads again. Memory only, never storage.
 */
const settledPolicies = new Map<string, Settled>();

export const policyKey = azurePolicyKey;

/** Goes up on every reset, so a mounted reader reads again after a Refresh instead of waiting on an emptied cache */
let generation = 0;

/** Forget what was read: after a Refresh of the Azure data, and in tests */
export function resetAzureRolePolicies(): void {
    settledPolicies.clear();
    generation++;
}

/** No read access at the scope: 403 `AuthorizationFailed`, or 400 `InsufficientPermissions` (a Reader on a resource group only, asking at its subscription, measured 2026-10-22) */
function isNoAccess(error: unknown): boolean {
    return error instanceof ArmError && (error.statusCode === 403 || error.code === "AuthorizationFailed" || error.code === "InsufficientPermissions");
}

/**
 * One role's policy at one scope, from the cache or read. A role without a policy at the scope answers 400
 * `ResourceNotFound` (measured) and is kept as missing; no read access at the scope is kept as noAccess, so it is not
 * asked again and not logged; any other failure throws and is not kept. The root scope is
 * never read from ARM (400 `InvalidResource`, measured) and is kept as unavailable.
 */
export async function readAzureRolePolicy(client: ArmClient, scopeId: string, roleDefinitionId: string, signal?: AbortSignal): Promise<Settled> {
    const key = policyKey(scopeId, roleDefinitionId);
    const cached = settledPolicies.get(key);
    if (cached) return cached;
    let settled: Settled;
    if (isRootScope(scopeId)) {
        settled = { status: "unavailable" };
        settledPolicies.set(key, settled);
        return settled;
    }
    try {
        const policy = await getRolePolicy(client, scopeId, roleDefinitionId, signal);
        settled = policy
            ? { status: "loaded", settings: parseArmPolicy(policy), rules: graphRulesOf(policy), lastModified: policy.properties.lastModifiedDateTime ?? null }
            : { status: "missing" };
    } catch (error: unknown) {
        if (error instanceof ArmError && error.code === "ResourceNotFound") settled = { status: "missing" };
        else if (isNoAccess(error)) settled = { status: "noAccess" };
        else throw error;
    }
    settledPolicies.set(key, settled);
    return settled;
}

/**
 * The policies of a few roles at one scope (Azure spec 15.6), on the worker pool with `armRateLimiter`: 4 workers,
 * 250 ms apart, one request each. Roles read before are skipped. A failure leaves that role out (logged); the others
 * are kept.
 */
export async function readAzureRolePolicies(client: ArmClient, scopeId: string, roleDefinitionIds: readonly string[], signal?: AbortSignal): Promise<void> {
    const missing = roleDefinitionIds.filter((id) => !settledPolicies.has(policyKey(scopeId, id)));
    if (missing.length === 0) return;
    // Root sends no request (400 at root, measured), so no worker pool and no rate-limiter wait
    if (isRootScope(scopeId)) {
        await Promise.all(missing.map((id) => readAzureRolePolicy(client, scopeId, id, signal)));
        return;
    }
    await runWorkerPool<string, Settled>({
        items: missing,
        workerCount: 4,
        delayMs: 250,
        signal,
        rateLimiter: armRateLimiter,
        costPerItem: 1,
        // An ARM message can hold the UPN, object id and scope: log status and code only
        errorLog: "statusAndCode",
        processor: (id) => readAzureRolePolicy(client, scopeId, id, signal),
        onItemError: () => Logger.warn("Azure", "The role settings could not be read for the role list"),
    });
}

/** What the page has read for one role at one scope, without reading */
export function settledPolicyFor(scopeId: string, roleDefinitionId: string): Settled | undefined {
    return settledPolicies.get(policyKey(scopeId, roleDefinitionId));
}

/** A role at a scope, for the export of the role settings */
export interface AzureRolePolicyPair {
    scopeId: string;
    roleDefinitionId: string;
}

/** The outcome per pair: what was read, or `failed` when the read failed (not kept, so a next export asks again) */
export type AzureRolePolicyOutcome = Settled | { status: "failed" };

/**
 * The policies of the given role and scope pairs (the role settings file of the export), on the worker pool with
 * `armRateLimiter`: 4 workers, 250 ms apart, one request each, as `readAzureRolePolicies`. Pairs read before are not
 * asked again; the root scope sends no request. A failure is that pair's outcome, the others go on. Returns the
 * outcome per `policyKey`.
 */
export async function readAzureRolePolicyPairs(
    client: ArmClient,
    pairs: readonly AzureRolePolicyPair[],
    { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Map<string, AzureRolePolicyOutcome>> {
    const outcomes = new Map<string, AzureRolePolicyOutcome>();
    const toRead: AzureRolePolicyPair[] = [];
    for (const pair of pairs) {
        const key = policyKey(pair.scopeId, pair.roleDefinitionId);
        if (outcomes.has(key)) continue;
        const cached = settledPolicies.get(key);
        if (cached) outcomes.set(key, cached);
        else if (isRootScope(pair.scopeId)) outcomes.set(key, await readAzureRolePolicy(client, pair.scopeId, pair.roleDefinitionId, signal));
        else {
            outcomes.set(key, { status: "failed" });
            toRead.push(pair);
        }
    }
    if (toRead.length === 0) return outcomes;
    onProgress?.(0, toRead.length);
    await runWorkerPool<AzureRolePolicyPair, Settled>({
        items: toRead,
        workerCount: 4,
        delayMs: 250,
        signal,
        rateLimiter: armRateLimiter,
        costPerItem: 1,
        // An ARM message can hold the UPN, object id and scope: log status and code only
        errorLog: "statusAndCode",
        processor: async (pair) => {
            const settled = await readAzureRolePolicy(client, pair.scopeId, pair.roleDefinitionId, signal);
            outcomes.set(policyKey(pair.scopeId, pair.roleDefinitionId), settled);
            return settled;
        },
        onItemError: () => Logger.warn("Azure", "The role settings could not be read for the export"),
        onProgress,
    });
    return outcomes;
}

/**
 * One role's settings at one scope (Azure spec 6), read when a target is set. A result is shared through the page's
 * cache; a failure is not, so "Try again" reads again. State is only set from the request's callbacks, so the render
 * derives what to show.
 */
export function useAzureRolePolicy(target: AzureRolePolicyTarget | null): { state: AzureRolePolicyState; retry: () => void } {
    const { getArmClient } = useAzureActions();
    const [, setVersion] = useState(0);
    const [failure, setFailure] = useState<{ key: string; attempt: number; title: string; detail: string } | null>(null);
    const [attempt, setAttempt] = useState(0);

    const scopeId = target?.scopeId;
    const roleDefinitionId = target?.roleDefinitionId;
    const key = scopeId !== undefined && roleDefinitionId !== undefined ? policyKey(scopeId, roleDefinitionId) : null;
    const readGeneration = generation;

    useEffect(() => {
        if (key === null || scopeId === undefined || roleDefinitionId === undefined || settledPolicies.has(key)) return;
        const controller = new AbortController();
        readAzureRolePolicy(getArmClient(), scopeId, roleDefinitionId, controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setVersion((n) => n + 1);
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                Logger.warn("Azure", "The role settings could not be read");
                const text = mapArmError(error);
                setFailure({ key, attempt, title: text.title, detail: text.detail });
            });
        return () => controller.abort();
    }, [key, scopeId, roleDefinitionId, attempt, readGeneration, getArmClient]);

    let state: AzureRolePolicyState;
    const settled = key === null ? undefined : settledPolicies.get(key);
    if (key === null) state = { status: "idle" };
    else if (settled) state = settled;
    else if (failure && failure.key === key && failure.attempt === attempt) state = { status: "failed", title: failure.title, detail: failure.detail };
    else state = { status: "loading" };

    return { state, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The policies of the privileged roles in the role list at the selected scope (Azure spec 15.6), read while `isEnabled`
 * (the role view shows). Returns the policy per role GUID (lowercase) as far as read; the list derives the signal.
 */
export function useAzureRolePolicies(scopeId: string | null, roleDefinitionIds: readonly string[], isEnabled: boolean): ReadonlyMap<string, Settled> {
    const { getArmClient } = useAzureActions();
    const [, setVersion] = useState(0);
    const idsKey = roleDefinitionIds.map((id) => id.toLowerCase()).sort().join(",");
    const readGeneration = generation;

    useEffect(() => {
        if (!isEnabled || scopeId === null || idsKey === "") return;
        const controller = new AbortController();
        readAzureRolePolicies(getArmClient(), scopeId, idsKey.split(","), controller.signal)
            .then(() => {
                if (!controller.signal.aborted) setVersion((n) => n + 1);
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, [isEnabled, scopeId, idsKey, readGeneration, getArmClient]);

    const result = new Map<string, Settled>();
    if (scopeId === null) return result;
    for (const id of roleDefinitionIds) {
        const settled = settledPolicies.get(policyKey(scopeId, id));
        if (settled) result.set(id.toLowerCase(), settled);
    }
    return result;
}
