import type { Client } from "@microsoft/microsoft-graph-client";
import type { Approver, PimPolicyRule } from "@/types/directoryRole.types";
import type { GroupPimPolicy, PimGroupData } from "@/types/pimGroup.types";
import { fetchAllPimGroupData, refreshPimGroupAssignments } from "@/services/pimGroupService";
import { loadApproversForRole } from "@/services/directoryRoleService";
import { WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { Logger } from "@/utils/logger";
import { runWorkerPool } from "@/utils/workerPool";
import { createSessionCache } from "./cache";
import type { WorkloadAdapter, WorkloadContent } from "./types";

export type GroupsContent = WorkloadContent<PimGroupData, undefined>;

/** The approvers of the policies are read at 3 workers and 300 ms: a lookup is one or two small directory calls per policy */
const APPROVER_WORKERS = 3;
const APPROVER_DELAY_MS = 300;

export interface PolicyNeedingApprovers {
    groupId: string;
    policyType: "member" | "owner";
    rules: GroupPimPolicy["rules"];
}

function countNamedApprovers(rules: GroupPimPolicy["rules"]): number {
    let count = 0;
    for (const rule of rules) {
        if (!rule["@odata.type"]?.includes("ApprovalRule")) continue;
        for (const stage of rule.setting?.approvalStages ?? []) count += (stage.primaryApprovers ?? []).length;
    }
    return count;
}

/** True when the policy has an approval rule that names primary approvers (an approval rule that names nobody has nothing to resolve). */
function hasNamedApprovers(policy: GroupPimPolicy): boolean {
    return policy.rules.some((rule) => rule["@odata.type"]?.includes("ApprovalRule")
        && (rule.setting?.approvalStages ?? []).some((stage) => (stage.primaryApprovers ?? []).length > 0));
}

/**
 * The Member and Owner policies whose approvers are not resolved yet: a loaded policy with named approvers and no
 * `approvers` list. A policy read again by a smart refresh with the same approvers carries its list over and is left alone.
 */
export function findPoliciesNeedingApprovers(data: PimGroupData[]): PolicyNeedingApprovers[] {
    const found: PolicyNeedingApprovers[] = [];
    for (const group of data) {
        for (const policyType of ["member", "owner"] as const) {
            const policy = group.policies?.[policyType];
            if (policy && policy.approvers === undefined && hasNamedApprovers(policy)) {
                found.push({ groupId: group.group.id, policyType, rules: policy.rules });
            }
        }
    }
    return found;
}

/** The approvers of one group policy were resolved. An empty list is stored too, so the lookup is not repeated. */
export function applyGroupPolicyApprovers(content: GroupsContent, groupId: string, policyType: "member" | "owner", approvers: Approver[]): GroupsContent {
    const index = content.data.findIndex((g) => g.group.id === groupId);
    const group = index === -1 ? undefined : content.data[index];
    const policy = group?.policies?.[policyType];
    if (!group || !policy) return content;
    const data = [...content.data];
    data[index] = { ...group, policies: { ...group.policies, [policyType]: { ...policy, approvers } } };
    return { data, extras: content.extras };
}

/** Resolves the approvers of the given policies and patches each onto its policy; a failed lookup is logged and leaves the ids. */
export async function resolveGroupPolicyApprovers(
    client: Client,
    pending: PolicyNeedingApprovers[],
    patch: (updater: (content: GroupsContent) => GroupsContent) => void,
    signal: AbortSignal
): Promise<void> {
    await runWorkerPool<PolicyNeedingApprovers, Approver[]>({
        items: pending,
        workerCount: APPROVER_WORKERS,
        delayMs: APPROVER_DELAY_MS,
        signal,
        rateLimiter: graphRateLimiter,
        // One resource unit per approver to look up (a batch of lookups costs its sub-requests), at least a policy read's 2
        costPerItem: (item) => Math.max(2, countNamedApprovers(item.rules)),
        processor: (item) => loadApproversForRole(client, item.rules as unknown as PimPolicyRule[]),
        onItemComplete: (item, approvers) => patch((content) => applyGroupPolicyApprovers(content, item.groupId, item.policyType, approvers)),
        onItemError: (item, error) => Logger.warn("PimGroups", `Could not resolve the approvers of the ${item.policyType} policy of ${item.groupId}: ${error}`),
    });
}

// v4: group assignments carry principalUserType and group policies their approvers (Report NG-42); v3 held neither
const DATA_KEY = "pim_groups_data_cache_v4";
const TIMESTAMP_KEY = "pim_groups_timestamp";

const cache = createSessionCache<PimGroupData, undefined>(
    { dataKey: DATA_KEY, timestampKey: TIMESTAMP_KEY, label: "PIM for Groups" },
    undefined
);

/**
 * PIM for Groups. Graph has no delta for PIM eligibility or policies, so a smart refresh re-reads the inventory and
 * every onboarded group's schedule instances and policies and keeps the group details; a forced refresh (after a write, the
 * wizard backup step, Full refresh) and the very first load read everything. A group that cannot be read fails the
 * load (pimGroupService), the data that was loaded stays.
 */
export const pimGroupsAdapter: WorkloadAdapter<PimGroupData, undefined> = {
    id: "pimGroups",
    // The group reads also need the directory role scopes (role-assignable groups, their holders)
    scopes: [...WORKLOAD_SCOPES.directoryRoles, ...WORKLOAD_SCOPES.pimGroups],
    initialExtras: undefined,
    cache,

    begin(current, force) {
        const smart = !force && current.data.length > 0;
        return { blocking: true, message: smart ? "Refreshing PIM for Groups..." : "Loading PIM for Groups data..." };
    },

    async run(ctx) {
        const loaded = ctx.current().data;
        const smart = !ctx.force && loaded.length > 0;
        const onProgress = (current: number, total: number, status: string) => ctx.progress(current, total, status);
        const data = smart
            ? await refreshPimGroupAssignments(ctx.client, loaded, onProgress, ctx.signal)
            : await fetchAllPimGroupData(ctx.client, onProgress, ctx.signal);
        // Approver names follow quietly, like the role approvers: not an engine phase, so nothing shows as loading and no
        // button is disabled. The first lookup starts after the engine has applied this outcome, so its patch finds the groups.
        const pending = findPoliciesNeedingApprovers(data);
        if (pending.length > 0) {
            const { client, signal, patch } = ctx;
            setTimeout(() => {
                resolveGroupPolicyApprovers(client, pending, patch, signal).catch((error: unknown) => {
                    Logger.warn("PimGroups", "Resolving group policy approvers failed:", error);
                });
            }, 0);
        }
        return {
            data,
            extras: undefined,
            message: `${smart ? "Refreshed" : "Loaded"} ${data.length} groups (PIM for Groups)`,
        };
    },

    // A reload while the approver names were being read leaves cached policies without them; the data is fresh, so no
    // run follows: read the missing names now, quietly, as the run would have
    async afterHydrate(content, ctx) {
        const pending = findPoliciesNeedingApprovers(content.data);
        if (pending.length === 0) return;
        const client = await ctx.getClient();
        await resolveGroupPolicyApprovers(client, pending, ctx.patch, ctx.signal);
    },
};
