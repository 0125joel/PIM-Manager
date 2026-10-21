import type { Client } from "@microsoft/microsoft-graph-client";
import type { Approver, PimPolicyAssignment, RoleDetailData } from "@/types/directoryRole.types";
import type { AuthenticationContext } from "@/types/shared.types";
import {
    clearPolicyCache,
    concurrentFetchPolicies,
    getAllRolesOptimizedWithDeferredPolicies,
    loadApproversForRole,
    refreshRoleAssignments,
    type PolicyLoadedCallback,
} from "@/services/directoryRoleService";
import { getAuthenticationContexts } from "@/utils/authContextApi";
import { Logger } from "@/utils/logger";
import { canKeepApprovers } from "@/utils/policyApprovers";
import { createSessionCache } from "./cache";
import type { WorkloadAdapter, WorkloadContent } from "./types";

/** What Directory Roles keeps next to the roles */
export interface DirectoryRolesExtras {
    authenticationContexts: AuthenticationContext[];
    /** Roles whose policy could not be read, even after the second pass */
    failedRoleIds: string[];
}

export type RolesContent = WorkloadContent<RoleDetailData, DirectoryRolesExtras>;

export const INITIAL_ROLES_EXTRAS: DirectoryRolesExtras = { authenticationContexts: [], failedRoleIds: [] };

/** The roles' policies are read at 12 workers and 200 ms (a policy is counted as 2 resource units, derived and not measured, see rateLimiter.ts) */
const POLICY_WORKERS = 12;
const POLICY_DELAY_MS = 200;

// v4: active schedules carry viaGroup (Report NG-42), a v3 cache would count activations through a group as direct
const DATA_KEY = "pim_data_cache_v4";
const TIMESTAMP_KEY = "pim_data_timestamp";
const AUTH_CONTEXTS_KEY = "pim_auth_contexts_cache";

// ============================================================================
// Pure updates of what is loaded (tested)
// ============================================================================

/** One role's policy arrived, failed or is not readable with the current access (403): store it on the role and keep the failed list true. */
export function applyPolicyResult(
    content: RolesContent,
    roleId: string,
    policy: PimPolicyAssignment | null,
    error?: string,
    forbidden?: boolean
): RolesContent {
    const index = content.data.findIndex((r) => r.definition.id === roleId);
    if (index === -1) return content;

    const roles = [...content.data];
    const failed = content.extras.failedRoleIds;

    // A 403 is not a failure (not in the failed list, no retry) and not "no policy": the role carries the marker and no policy
    if (forbidden) {
        roles[index] = { ...roles[index], policy: null, configError: undefined, policiesForbidden: true };
        return { data: roles, extras: { ...content.extras, failedRoleIds: failed.filter((id) => id !== roleId) } };
    }

    if (error) {
        roles[index] = { ...roles[index], policy: null, configError: error };
        return {
            data: roles,
            extras: { ...content.extras, failedRoleIds: failed.includes(roleId) ? failed : [...failed, roleId] },
        };
    }

    // null means "verified not configured". A policy read again with the same approvers keeps their resolved names.
    const previous = roles[index].policy;
    const approvers = previous && policy?.policy && keepsApprovers(previous, policy) ? previous.approvers : ([] as Approver[]);
    const policyData = policy && policy.policy
        ? { assignment: policy, details: policy.policy, approvers }
        : null;
    roles[index] = { ...roles[index], policy: policyData, configError: undefined, policiesForbidden: undefined };
    // A role that failed earlier and loaded now is no longer a failure
    return { data: roles, extras: { ...content.extras, failedRoleIds: failed.filter((id) => id !== roleId) } };
}

/** True when the names resolved for the loaded policy still belong to the policy that was just read. */
function keepsApprovers(previous: NonNullable<RoleDetailData["policy"]>, next: PimPolicyAssignment): boolean {
    return canKeepApprovers({ rules: previous.details.rules, approvers: previous.approvers }, next.policy?.rules);
}

/** The approvers of a role's policy were resolved. */
export function applyApprovers(content: RolesContent, roleId: string, approvers: Approver[]): RolesContent {
    const index = content.data.findIndex((r) => r.definition.id === roleId);
    const role = index === -1 ? undefined : content.data[index];
    if (!role || !role.policy) return content;
    const roles = [...content.data];
    roles[index] = { ...role, policy: { ...role.policy, approvers } };
    return { data: roles, extras: content.extras };
}

/**
 * The callback the policy reads report to: it patches the role and starts the approver lookup, which patches
 * again when it is done. `patch` is the engine's batched patch; `current` is what is loaded, so a policy read
 * again by a refresh with the same approvers skips the lookup.
 */
export function createPolicyLoadedHandler(
    client: Client,
    patch: (updater: (content: RolesContent) => RolesContent) => void,
    current: () => RolesContent
): PolicyLoadedCallback {
    return (roleId, policy, error, forbidden) => {
        const previous = current().data.find((r) => r.definition.id === roleId)?.policy;
        const unchanged = !!previous && !!policy && keepsApprovers(previous, policy);
        // Outside the state update: the lookup must never run inside a render
        if (!unchanged && policy && policy.policy && policy.policy.rules) {
            const rules = policy.policy.rules;
            loadApproversForRole(client, rules)
                .then((approvers) => {
                    if (approvers.length > 0) patch((content) => applyApprovers(content, roleId, approvers));
                })
                .catch((e) => Logger.error("PimData", `Failed to resolve approvers for ${roleId}`, e));
        }
        patch((content) => applyPolicyResult(content, roleId, policy, error, forbidden));
    };
}

// ============================================================================
// Cache
// ============================================================================

const cache = createSessionCache<RoleDetailData, DirectoryRolesExtras>(
    {
        dataKey: DATA_KEY,
        timestampKey: TIMESTAMP_KEY,
        extras: {
            key: AUTH_CONTEXTS_KEY,
            encode: (extras) => (extras.authenticationContexts.length > 0 ? extras.authenticationContexts : null),
            decode: (raw) => ({ authenticationContexts: Array.isArray(raw) ? (raw as AuthenticationContext[]) : [], failedRoleIds: [] }),
        },
        // Quota: definitions only, no assignments and no policies
        minimal: (roles) => roles.map((role) => ({ definition: role.definition, assignments: { permanent: [], eligible: [], active: [] }, policy: null })),
        label: "Directory Roles",
    },
    INITIAL_ROLES_EXTRAS
);

// ============================================================================
// Adapter
// ============================================================================

async function readAuthenticationContexts(client: Client): Promise<AuthenticationContext[]> {
    try {
        const contexts = await getAuthenticationContexts(client);
        Logger.debug("PimData", `Fetched ${contexts.length} Authentication Contexts`);
        return contexts;
    } catch (error) {
        Logger.warn("PimData", "Failed to fetch Authentication Contexts:", error);
        return [];
    }
}

/**
 * Directory Roles: the fast phase (definitions and assignments) blocks, the policies of every role follow in the
 * background. A smart refresh re-reads the assignments without blocking, shows the loaded policies meanwhile and
 * reads every policy again in the background (Graph has no delta for policies, so a setting changed in Entra only
 * shows once it is read again); a forced refresh reloads everything and blocks.
 */
export const directoryRolesAdapter: WorkloadAdapter<RoleDetailData, DirectoryRolesExtras> = {
    id: "directoryRoles",
    initialExtras: INITIAL_ROLES_EXTRAS,
    cache,

    begin(current, force) {
        if (!force && current.data.length > 0) return { blocking: false, message: "Refreshing..." };
        return { blocking: true, message: current.data.length > 0 ? "Refreshing..." : "Initializing..." };
    },

    async run(ctx) {
        const { client, signal } = ctx;
        const onPolicyLoaded = createPolicyLoadedHandler(client, ctx.patch, ctx.current);
        const loaded = ctx.current();

        // Smart refresh: re-read the assignments, then every policy in the background
        if (!ctx.force && loaded.data.length > 0) {
            const roles = await refreshRoleAssignments(client, loaded.data, (_current, _total, status) => ctx.message(status), signal);
            if (signal.aborted) throw new Error("Aborted");
            const roleIds = roles.map((r) => r.definition.id);
            return {
                data: roles,
                extras: ctx.current().extras,
                message: "Synced",
                backgroundMessage: "Updating policies...",
                backgroundTotal: roleIds.length,
                background: concurrentFetchPolicies(client, roleIds, POLICY_WORKERS, POLICY_DELAY_MS, ctx.backgroundProgress, onPolicyLoaded, signal),
            };
        }

        // Full load: every policy is read again from Graph
        ctx.setBlocking(true);
        clearPolicyCache();
        cache.clear();
        Logger.debug("PimData", "Policy cache and storage cache cleared for a full load");

        const roles = await getAllRolesOptimizedWithDeferredPolicies(client, ctx.progress, signal);
        if (signal.aborted) throw new Error("Aborted");
        const authenticationContexts = await readAuthenticationContexts(client);

        const roleIds = roles.map((r) => r.definition.id);

        return {
            data: roles,
            extras: { authenticationContexts, failedRoleIds: [] },
            message: "Fetching policies...",
            backgroundMessage: "Fetching policies...",
            backgroundTotal: roleIds.length,
            background: concurrentFetchPolicies(client, roleIds, POLICY_WORKERS, POLICY_DELAY_MS, ctx.backgroundProgress, onPolicyLoaded, signal),
        };
    },
};
