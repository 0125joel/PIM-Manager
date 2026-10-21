import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE } from "@/config/constants";
import { PimGroup, PimGroupData, GroupPimAssignment, GroupType, computeGroupStats, GroupEligibilityScheduleInstance, GroupAssignmentScheduleInstance, GroupPimPolicy, GroupPimSettings, GROUP_POLICY_ROLE_IDS, extractGroupPolicySettings } from "@/types/pimGroup.types";
import { runWorkerPool } from "@/utils/workerPool";
import { withRetry } from "@/utils/retryUtils";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { fetchUserTypes } from "@/services/directoryRoleService";
import { applyUserTypes, collectUserCandidateIds } from "@/utils/userTypeUtils";
import { canKeepApprovers } from "@/utils/policyApprovers";

/**
 * Resource units per processor (Microsoft Graph throttling limits: a request costs 1, `$expand` adds 1, `$select` takes 1 off,
 * `groups/{id}/members` costs 3). The full per-group fetch is details (1), eligibility (1), assignments (1) and the policy
 * assignment with `$expand` (2); the smart refresh re-reads the two schedule lists and the policies, not the details.
 */
const COST_FULL_GROUP = 5;
const COST_GROUP_REFRESH = 4;
const COST_GROUP_MEMBER_COUNT = 3;
import { Logger } from "@/utils/logger";
import { getErrorStatusCode } from "@/utils/errorUtils";
import { isForbiddenRead } from "@/utils/policyReadAccess";

/**
 * Service for fetching PIM for Groups data from Microsoft Graph API
 * Uses universal workerPool utility for consistent parallel fetching
 */

// Helper to add delay for throttling protection (still needed for fetchAllPages)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to fetch all pages of a paginated Graph API response
 */
async function fetchAllPages<T>(
    client: Client,
    endpoint: string,
    options?: {
        version?: string;
        select?: string;
        filter?: string;
        expand?: string;
    }
): Promise<T[]> {
    const allItems: T[] = [];
    let nextLink: string | null = null;

    let request = client.api(endpoint);

    if (options?.version) {
        request = request.version(options.version);
    }
    if (options?.select) {
        request = request.select(options.select);
    }
    if (options?.filter) {
        request = request.filter(options.filter);
    }
    if (options?.expand) {
        request = request.expand(options.expand);
    }

    request = request.header("Accept-Language", GRAPH_LOCALE);

    try {
        const response = await withRetry(() => request.get(), 3, 1000, `pimGroup fetchAllPages ${endpoint}`);
        allItems.push(...(response.value || []));
        nextLink = response["@odata.nextLink"] || null;

        // Cap the page walk to guard against malformed nextLink cycles (same guard as directoryRoleService)
        const MAX_PAGES = 200;
        let pageCount = 0;
        while (nextLink && pageCount < MAX_PAGES) {
            pageCount++;
            await delay(100);
            const link = nextLink;
            const nextResponse = await withRetry(() => client.api(link).get(), 3, 1000, `pimGroup nextLink ${endpoint}`);
            allItems.push(...(nextResponse.value || []));
            nextLink = nextResponse["@odata.nextLink"] || null;
        }
        if (pageCount >= MAX_PAGES) {
            Logger.warn("pimGroup", `fetchAllPages reached MAX_PAGES (${MAX_PAGES}) for ${endpoint}, result may be incomplete`);
        }

        return allItems;
    } catch (error) {
        // Never hand back the pages read so far as if they were everything: the caller decides what a failure means
        Logger.error("pimGroup", `Failed to fetch all pages for ${endpoint}:`, error);
        throw error;
    }
}

/**
 * Detect group type from Graph API response
 */
function detectGroupType(group: { groupTypes?: string[]; mailEnabled?: boolean; securityEnabled?: boolean }): GroupType {
    if (group.groupTypes?.includes("Unified")) {
        return "m365";
    }
    if (group.mailEnabled && group.securityEnabled) {
        return "mailEnabled";
    }
    if (group.securityEnabled) {
        return "security";
    }
    return "unknown";
}

/**
 * Fetch all PIM-onboarded groups using the privilegedAccess resources endpoint
 *
 * This is the CORRECT way to get PIM-enabled groups:
 * - Uses /beta/identityGovernance/privilegedAccess/group/resources
 * - Returns ONLY groups that are actually configured in PIM (matches Entra portal)
 * - Matches exactly what the Entra admin center shows
 *
 * NOTE: A group is onboarded when:
 * - An eligibilityScheduleRequest is created, OR
 * - A roleManagementPolicy is updated for that group
 *
 * This endpoint requires: PrivilegedAccess.Read.AzureADGroup permission
 */
async function fetchPimOnboardedResources(client: Client): Promise<{ id: string; displayName: string }[]> {
    try {
        Logger.debug("PimGroupDataService", "Fetching PIM-onboarded groups via resources endpoint...");

        // Use the beta endpoint that returns only PIM-onboarded groups
        // NOTE: Don't use $select - groupResource type has limited properties
        const resources = await fetchAllPages<{
            id: string;           // Resource ID (same as group ID)
            displayName?: string; // May or may not be present
            status?: string;
        }>(
            client,
            "/identityGovernance/privilegedAccess/group/resources",
            {
                version: "beta"
                // No select - let API return all available properties
            }
        );

        Logger.debug("PimGroupDataService", `Found ${resources.length} PIM-onboarded groups`);

        // Map to consistent format - the id in resources IS the group ID
        return resources.map(r => ({
            id: r.id,
            displayName: r.displayName || `Group ${r.id.substring(0, 8)}...`
        }));

    } catch (error: unknown) {
        // Only an endpoint that does not exist falls back to the old method; a throttled or failed read must not
        // quietly change what "onboarded" means, so it fails the load (the pools above retry before it gets here)
        if (getErrorStatusCode(error) === 404) {
            Logger.warn("PimGroupDataService", "Beta resources endpoint not found, falling back to role-assignable filter");
            return fetchRoleAssignableGroupsFallback(client);
        }
        throw error;
    }
}

/**
 * Fallback: Fetch role-assignable groups (older method)
 * Used only if the beta resources endpoint is not available
 */
async function fetchRoleAssignableGroupsFallback(client: Client): Promise<{ id: string; displayName: string }[]> {
    try {
        Logger.debug("PimGroupDataService", "Fallback: Fetching role-assignable groups...");
        const groups = await fetchAllPages<{ id: string; displayName: string }>(
            client,
            "/groups",
            {
                version: "v1.0",
                filter: "isAssignableToRole eq true",
                select: "id,displayName"
            }
        );
        Logger.debug("PimGroupDataService", `Fallback found ${groups.length} role-assignable groups`);
        return groups;
    } catch (error) {
        Logger.error("pimGroup", "Fallback also failed:", error);
        throw error;
    }
}


/**
 * Fetch eligibility instances for a specific group
 */
async function fetchEligibilityInstancesForGroup(
    client: Client,
    groupId: string
): Promise<GroupEligibilityScheduleInstance[]> {
    try {
        const instances = await fetchAllPages<GroupEligibilityScheduleInstance>(
            client,
            "/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances",
            {
                version: "v1.0",
                filter: `groupId eq '${groupId}'`,
                expand: "principal"
            }
        );
        return instances;
    } catch (error) {
        // A group without PIM data answers with an empty list or 404; any other failure is a failure, not "no assignments"
        if (getErrorStatusCode(error) === 404) return [];
        Logger.warn("pimGroup", `Failed to fetch eligibility instances for group ${groupId}:`, error);
        throw error;
    }
}

/**
 * Fetch assignment instances for a specific group
 */
async function fetchAssignmentInstancesForGroup(
    client: Client,
    groupId: string
): Promise<GroupAssignmentScheduleInstance[]> {
    try {
        const instances = await fetchAllPages<GroupAssignmentScheduleInstance>(
            client,
            "/identityGovernance/privilegedAccess/group/assignmentScheduleInstances",
            {
                version: "v1.0",
                filter: `groupId eq '${groupId}'`,
                expand: "principal"
            }
        );
        return instances;
    } catch (error) {
        // A group without PIM data answers with an empty list or 404; any other failure is a failure, not "no assignments"
        if (getErrorStatusCode(error) === 404) return [];
        Logger.warn("pimGroup", `Failed to fetch assignment instances for group ${groupId}:`, error);
        throw error;
    }
}

/**
 * Graph answers `null`, not `false`, for a group that is not role-assignable (tenant test of 2026-10-03, on
 * `/me/ownedObjects` and on `/groups/{id}`). After a successful read of the group the property is therefore
 * known: true or not. Only a group that was never read keeps `undefined` ("unknown").
 */
export function readIsAssignableToRole(value: boolean | null | undefined): boolean {
    return value === true;
}

/**
 * Fetch group details by ID
 */
async function fetchGroupDetails(client: Client, groupId: string): Promise<PimGroup | null> {
    try {
        const group = await withRetry(
            () => client.api(`/groups/${groupId}`)
                .version("v1.0")
                .select("id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,membershipRule,membershipRuleProcessingState,isAssignableToRole,onPremisesSyncEnabled,isManagementRestricted")
                .header("Accept-Language", GRAPH_LOCALE)
                .get(),
            3, 1000, 'fetchGroupDetails'
        );

        return {
            id: group.id,
            displayName: group.displayName,
            description: group.description,
            groupType: detectGroupType(group),
            mail: group.mail,
            mailEnabled: group.mailEnabled,
            securityEnabled: group.securityEnabled,
            membershipRule: group.membershipRule,
            membershipRuleProcessingState: group.membershipRuleProcessingState,
            isAssignableToRole: readIsAssignableToRole(group.isAssignableToRole),
            onPremisesSyncEnabled: group.onPremisesSyncEnabled === true,
            isManagementRestricted: group.isManagementRestricted === true,
        };
    } catch (error) {
        if (getErrorStatusCode(error) === 404) return null; // the group is gone
        Logger.error("pimGroup", `Failed to fetch group details for ${groupId}:`, error);
        throw error;
    }
}

/**
 * Progress callback type
 */
export type PimGroupProgressCallback = (current: number, total: number, status: string) => void;

/**
 * Map eligibility and assignment schedule instances to the app's assignment shape
 */
export function buildGroupAssignments(
    eligibilityInstances: GroupEligibilityScheduleInstance[],
    assignmentInstances: GroupAssignmentScheduleInstance[]
): GroupPimAssignment[] {
    const assignments: GroupPimAssignment[] = [];

    for (const instance of eligibilityInstances) {
        assignments.push({
            id: instance.id,
            groupId: instance.groupId,
            principalId: instance.principalId,
            principal: instance.principal,
            accessType: instance.accessId,
            assignmentType: "eligible",
            memberType: instance.memberType,
            status: instance.status,
            startDateTime: instance.startDateTime,
            endDateTime: instance.endDateTime,
            scheduleInfo: instance.scheduleInfo
        });
    }

    for (const instance of assignmentInstances) {
        // Graph documents assignmentType as "assigned" (direct assignment) or "activated" (through activation
        // of an eligibility). Permanent is an assigned instance without an end; an activated one always has an end.
        const origin = instance.assignmentType?.toLowerCase();
        const isPermanent = !instance.endDateTime && origin === "assigned";
        assignments.push({
            id: instance.id,
            groupId: instance.groupId,
            principalId: instance.principalId,
            principal: instance.principal,
            accessType: instance.accessId,
            assignmentType: isPermanent ? "permanent" : "active",
            assignmentOrigin: origin === "assigned" || origin === "activated" ? origin : undefined,
            memberType: instance.memberType,
            status: instance.status,
            startDateTime: instance.startDateTime,
            endDateTime: instance.endDateTime
        });
    }

    return assignments;
}

/**
 * Complete data for one PIM-onboarded group: details, assignments and policies (4 Graph calls)
 */
async function fetchManagedGroupData(client: Client, groupId: string): Promise<PimGroupData | null> {
    const group = await fetchGroupDetails(client, groupId);
    if (!group) return null;

    const [eligibilityInstances, assignmentInstances, policyRead] = await Promise.all([
        fetchEligibilityInstancesForGroup(client, groupId),
        fetchAssignmentInstancesForGroup(client, groupId),
        fetchGroupPolicies(client, groupId)
    ]);

    const assignments = buildGroupAssignments(eligibilityInstances, assignmentInstances);
    return {
        group,
        assignments,
        linkedWorkloads: [],
        isManaged: true,
        stats: computeGroupStats(assignments),
        ...groupPolicyFields(policyRead)
    };
}

/**
 * The policy part of a group's data: the policies and settings as read, or the marker when Graph answered 403. A marked
 * group carries no policies and no settings, so no reader can take a missing policy for "not set" (FIX-11).
 */
export function groupPolicyFields(read: GroupPolicyRead, previous?: PimGroupData["policies"]): Pick<PimGroupData, "policies" | "settings" | "policiesForbidden"> {
    if (read.forbidden) return { policies: undefined, settings: undefined, policiesForbidden: true };
    return { policies: toGroupPolicies(read.policies, previous), settings: read.settings, policiesForbidden: undefined };
}

/** The Member and Owner policy of a group by type; undefined when Graph returned none. */
export function toGroupPolicies(list: GroupPimPolicy[], previous?: PimGroupData["policies"]): PimGroupData["policies"] | undefined {
    if (list.length === 0) return undefined;
    const policies: NonNullable<PimGroupData["policies"]> = {};
    for (const policy of list) {
        const type = policy.policyType === "member" ? "member" : "owner";
        const before = previous?.[type];
        // Same approvers as the policy read before: keep the names, so a refresh does not look them up again
        const keep = before && canKeepApprovers({ rules: before.rules, approvers: before.approvers }, policy.rules);
        policies[type] = keep ? { ...policy, approvers: before.approvers } : policy;
    }
    return policies;
}

/**
 * Role-assignable group that is not onboarded to PIM: details only, no PIM data
 */
function toUnmanagedGroupData(group: PimGroup): PimGroupData {
    return {
        group,
        assignments: [],
        linkedWorkloads: [],
        isManaged: false,
        stats: computeGroupStats([])
    };
}

interface ReliablePoolOptions<T> {
    ids: string[];
    workerCount: number;
    delayMs: number;
    cost: number | ((id: string) => number);
    signal?: AbortSignal;
    processor: (id: string) => Promise<T | null>;
    onProgress?: (current: number, total: number) => void;
    /** What the ids are, for the error sentence */
    noun: string;
}

/**
 * Runs the per-group reads and never hands back a silently incomplete set: what failed after every retry gets a second,
 * slower pass after a pause, and what still fails makes the whole load fail with a sentence that says how many and why.
 * An answer of "not found" (null) is an answer, only a thrown error is a failure.
 */
export async function runReliablePool<T>({ ids, workerCount, delayMs, cost, signal, processor, onProgress, noun }: ReliablePoolOptions<T>): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    let failed: { id: string; message: string }[] = [];

    const pass = async (items: string[], workers: number, pause: number, report?: (current: number, total: number) => void) => {
        failed = [];
        const { results: got } = await runWorkerPool<string, T>({
            items,
            workerCount: workers,
            delayMs: pause,
            signal,
            rateLimiter: graphRateLimiter,
            costPerItem: cost,
            processor,
            onItemError: (id, message) => failed.push({ id, message }),
            onProgress: report,
        });
        for (const [id, value] of got) results.set(id, value);
    };

    await pass(ids, workerCount, delayMs, onProgress);

    if (failed.length > 0 && !signal?.aborted) {
        const retryIds = failed.map((f) => f.id);
        Logger.warn("pimGroup", `${retryIds.length} of ${ids.length} ${noun} failed, trying them again at a slower pace`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!signal?.aborted) await pass(retryIds, 3, 500);
    }

    if (signal?.aborted) throw new Error("Aborted");
    if (failed.length > 0) {
        Logger.error("pimGroup", `${failed.length} ${noun} failed twice, first reason: ${failed[0].message}`);
        // Short on purpose: `describeLoadFailure` shows messages of up to 140 characters as they are
        throw new Error(`${failed.length} of ${ids.length} ${noun} could not be loaded after retrying.`);
    }
    return results;
}

/**
 * Direct member count of one group: GET /beta/groups/{id}/members/$count with `ConsistencyLevel: eventual`
 * (required for $count). Beta because v1.0 does not list service principals as members (documented known
 * issue). Group.Read.All covers it. Undefined when the call fails.
 */
async function fetchGroupMemberCount(client: Client, groupId: string): Promise<number | undefined> {
    try {
        const response = await withRetry(
            () => client.api(`/groups/${groupId}/members/$count`).version("beta").header("ConsistencyLevel", "eventual").get(),
            3, 1000, "fetchGroupMemberCount"
        );
        const count = Number(response);
        return Number.isFinite(count) ? count : undefined;
    } catch (error) {
        Logger.warn("pimGroup", `Could not read the member count of group ${groupId}:`, error);
        return undefined;
    }
}

/**
 * Adds `memberCount` to the unmanaged groups: 6 workers, 500 ms delay. Measured 2026-10-16 (dev tenant, 60 groups): each
 * call costs 1 resource unit (`x-ms-resource-unit`), so 6 workers use about 3% of the 3,500 RU per 10 s a small tenant has.
 * Non-fatal: a group whose count cannot be read keeps `memberCount` undefined.
 */
async function addMemberCounts(
    client: Client,
    unmanaged: PimGroupData[],
    signal?: AbortSignal
): Promise<PimGroupData[]> {
    if (unmanaged.length === 0) return unmanaged;

    const counts = new Map<string, number>();
    await runWorkerPool<PimGroupData, number>({
        items: unmanaged,
        workerCount: 6,
        delayMs: 500,
        signal,
        rateLimiter: graphRateLimiter,
        costPerItem: COST_GROUP_MEMBER_COUNT,
        processor: async (data) => {
            const count = await fetchGroupMemberCount(client, data.group.id);
            if (count !== undefined) counts.set(data.group.id, count);
            return count ?? null;
        }
    });

    if (signal?.aborted) throw new Error("Aborted");

    return unmanaged.map(data => (counts.has(data.group.id) ? { ...data, memberCount: counts.get(data.group.id) } : data));
}

/**
 * `principalUserType` (Member or Guest) on the user principals of the group assignments (Report spec 5.3b), from the same
 * chunked `id in (...)` lookup the roles use. Ids already read on an earlier load (`previous`) are not asked again. A failed
 * lookup is logged and leaves the type unknown: guests are then not counted, nothing else changes.
 */
export async function addGroupUserTypes(
    client: Client,
    groups: PimGroupData[],
    previous: PimGroupData[] = [],
    signal?: AbortSignal
): Promise<PimGroupData[]> {
    const known = new Map<string, string>();
    for (const data of previous) {
        for (const a of data.assignments) if (a.principalUserType) known.set(a.principalId, a.principalUserType);
    }
    const candidates = collectUserCandidateIds(groups.map((g) => g.assignments));
    const unknownIds = candidates.filter((id) => !known.has(id));
    let fetched = new Map<string, string>();
    try {
        fetched = await fetchUserTypes(client, unknownIds, signal);
    } catch (error: unknown) {
        if (signal?.aborted) throw error;
        Logger.warn("pimGroup", "Reading user types of group members failed, guests stay unknown:", error);
    }
    const userTypes = new Map<string, string>(candidates.filter((id) => known.has(id)).map((id) => [id, known.get(id) as string]));
    fetched.forEach((type, id) => userTypes.set(id, type));
    if (userTypes.size === 0) return groups;
    return groups.map((g) => (g.assignments.length === 0 ? g : { ...g, assignments: applyUserTypes(g.assignments, userTypes) }));
}

/**
 * Inventory: PIM-onboarded group ids plus the role-assignable groups that are not onboarded (unmanaged)
 */
async function fetchGroupInventory(client: Client): Promise<{ onboardedIds: string[]; unmanagedIds: string[] }> {
    const [pimResources, allRoleAssignable] = await Promise.all([
        fetchPimOnboardedResources(client),
        fetchRoleAssignableGroupsFallback(client)
    ]);

    const onboarded = new Set(pimResources.map(r => r.id));
    const unmanagedIds = allRoleAssignable.map(g => g.id).filter(id => !onboarded.has(id));

    Logger.debug("PimGroupDataService", `Inventory: ${allRoleAssignable.length} total role-assignable, ${onboarded.size} managed, ${unmanagedIds.length} UNMANAGED.`);

    return { onboardedIds: Array.from(onboarded), unmanagedIds };
}

/**
 * Main function: Fetch all PIM for Groups data
 * Returns aggregated data per group with all assignments
 *
 * Strategy (Using Beta Resources Endpoint):
 * 1. Get all PIM-onboarded groups via /beta/identityGovernance/privilegedAccess/group/resources
 *    - This returns ONLY groups that are actually configured in PIM (matches Entra portal)
 * 2. Use runWorkerPool to fetch eligibility + assignments in parallel
 * 3. Aggregate into PimGroupData objects
 *
 * WITH ABORT SIGNAL SUPPORT
 */
export async function fetchAllPimGroupData(
    client: Client,
    onProgress?: PimGroupProgressCallback,
    signal?: AbortSignal
): Promise<PimGroupData[]> {
    try {
        // Check abort early
        if (signal?.aborted) throw new Error("Aborted");

        // Phase 1: Fetch BOTH PIM-onboarded groups AND all Role-Assignable groups
        onProgress?.(0, 100, "Scanning group inventory...");

        const { onboardedIds, unmanagedIds } = await fetchGroupInventory(client);

        if (signal?.aborted) throw new Error("Aborted");

        // Phase 2: Process Managed Groups (parallel fetch of assignments/policies)
        // If no managed groups, we still might have unmanaged ones to return
        let managedResults: PimGroupData[] = [];

        if (onboardedIds.length > 0) {
            const results = await runReliablePool<PimGroupData>({
                ids: onboardedIds,
                workerCount: 3,
                delayMs: 500,
                cost: COST_FULL_GROUP,
                signal,
                noun: "PIM groups",
                processor: (groupId) => fetchManagedGroupData(client, groupId),
                onProgress: (current, totalItems) => {
                    const progressPercent = Math.round((current / totalItems) * 80); // 80% for managed
                    onProgress?.(progressPercent, 100, `Processing managed groups (${current}/${totalItems})...`);
                }
            });
            managedResults = Array.from(results.values());
        }

        if (signal?.aborted) throw new Error("Aborted");

        // Phase 3: Process Unmanaged Groups (Lightweight)
        // One details call per group for Type/Mail info, no PIM data.
        onProgress?.(85, 100, `Processing ${unmanagedIds.length} unmanaged groups...`);

        const unmanagedDetails = await runReliablePool<PimGroupData>({
            ids: unmanagedIds,
            workerCount: 5, // Higher concurrency as it's just one lightweight call per group
            delayMs: 200,
            cost: 1,
            signal,
            noun: "unmanaged groups",
            processor: async (groupId) => {
                const group = await fetchGroupDetails(client, groupId);
                return group ? toUnmanagedGroupData(group) : null;
            }
        });
        onProgress?.(92, 100, `Counting members of ${unmanagedDetails.size} unmanaged groups...`);
        const unmanagedResults = await addMemberCounts(client, Array.from(unmanagedDetails.values()), signal);

        Logger.debug("PimGroupDataService", `Complete. Managed: ${managedResults.length}, Unmanaged: ${unmanagedResults.length}`);

        onProgress?.(95, 100, "Reading user types...");
        const typedManaged = await addGroupUserTypes(client, managedResults, [], signal);

        onProgress?.(100, 100, "Complete");
        return [...typedManaged, ...unmanagedResults];

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || errorMessage === "Aborted") {
            Logger.info("pimGroup", "Operation aborted");
            throw error;
        }
        Logger.error("pimGroup", "Failed to fetch PIM group data:", error);
        throw error;
    }
}

/**
 * Smart refresh: re-read the PIM inventory and every onboarded group's eligibility
 * and assignment schedule instances and its policies, keeping the group details that
 * are already loaded (and the approver names of a policy whose approvers did not change).
 * Groups that are new to PIM take the complete per-group fetch, groups that left PIM keep
 * their details as unmanaged, groups that are gone are dropped. Graph has no delta for PIM
 * eligibility or policies, so this is the cheapest correct refresh: one inventory read plus
 * three calls per onboarded group.
 */
export async function refreshPimGroupAssignments(
    client: Client,
    currentData: PimGroupData[],
    onProgress?: PimGroupProgressCallback,
    signal?: AbortSignal
): Promise<PimGroupData[]> {
    try {
        if (signal?.aborted) throw new Error("Aborted");

        onProgress?.(0, 100, "Scanning group inventory...");

        const { onboardedIds, unmanagedIds } = await fetchGroupInventory(client);

        if (signal?.aborted) throw new Error("Aborted");

        const cached = new Map(currentData.map(g => [g.group.id, g]));

        let managedResults: PimGroupData[] = [];

        if (onboardedIds.length > 0) {
            const results = await runReliablePool<PimGroupData>({
                ids: onboardedIds,
                workerCount: 3,
                delayMs: 500,
                signal,
                noun: "PIM groups",
                cost: (groupId) => (cached.get(groupId)?.isManaged ? COST_GROUP_REFRESH : COST_FULL_GROUP),
                processor: async (groupId) => {
                    const existing = cached.get(groupId);
                    if (!existing?.isManaged) {
                        return fetchManagedGroupData(client, groupId);
                    }

                    // Graph has no delta for policies either: a setting changed in Entra only shows when it is read again
                    const [eligibilityInstances, assignmentInstances, policyRead] = await Promise.all([
                        fetchEligibilityInstancesForGroup(client, groupId),
                        fetchAssignmentInstancesForGroup(client, groupId),
                        fetchGroupPolicies(client, groupId)
                    ]);
                    const assignments = buildGroupAssignments(eligibilityInstances, assignmentInstances);

                    return {
                        ...existing,
                        assignments,
                        stats: computeGroupStats(assignments),
                        ...groupPolicyFields(policyRead, existing.policies),
                    };
                },
                onProgress: (current, totalItems) => {
                    const progressPercent = Math.round((current / totalItems) * 80);
                    onProgress?.(progressPercent, 100, `Refreshing managed groups (${current}/${totalItems})...`);
                }
            });
            managedResults = Array.from(results.values());
        }

        if (signal?.aborted) throw new Error("Aborted");

        const unmanagedResults: PimGroupData[] = [];
        const unmanagedToFetch: string[] = [];
        for (const groupId of unmanagedIds) {
            const existing = cached.get(groupId);
            if (existing) {
                // Keep the previous count as a fallback in case reading it again fails
                unmanagedResults.push({ ...toUnmanagedGroupData(existing.group), memberCount: existing.memberCount });
            } else {
                unmanagedToFetch.push(groupId);
            }
        }

        if (unmanagedToFetch.length > 0) {
            onProgress?.(85, 100, `Processing ${unmanagedToFetch.length} new unmanaged groups...`);

            const unmanagedDetails = await runReliablePool<PimGroupData>({
                ids: unmanagedToFetch,
                workerCount: 5,
                delayMs: 200,
                cost: 1,
                signal,
                noun: "unmanaged groups",
                processor: async (groupId) => {
                    const group = await fetchGroupDetails(client, groupId);
                    return group ? toUnmanagedGroupData(group) : null;
                }
            });
            unmanagedResults.push(...Array.from(unmanagedDetails.values()));
        }

        // Member counts change without any signal, so every unmanaged group is counted again on a refresh
        onProgress?.(92, 100, `Counting members of ${unmanagedResults.length} unmanaged groups...`);
        const countedUnmanaged = await addMemberCounts(client, unmanagedResults, signal);

        Logger.debug("PimGroupDataService", `Refresh complete. Managed: ${managedResults.length}, Unmanaged: ${countedUnmanaged.length}`);

        onProgress?.(95, 100, "Reading user types...");
        const typedManaged = await addGroupUserTypes(client, managedResults, currentData, signal);

        onProgress?.(100, 100, "Complete");
        return [...typedManaged, ...countedUnmanaged];

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || errorMessage === "Aborted") {
            Logger.info("pimGroup", "Refresh aborted");
            throw error;
        }
        Logger.error("pimGroup", "Failed to refresh PIM group data:", error);
        throw error;
    }
}

export { getAggregatedGroupStats } from "@/utils/groupStatsUtils";

// ============================================================================
// POLICY FETCHING (Progressive Loading - like Directory Roles)
// ============================================================================

// Track which group policies have been fetched (for deduplication)
const fetchedGroupPolicies = new Set<string>();

/**
 * Clear the fetched policies cache (call on new data fetch)
 */
export function clearGroupPolicyCache(): void {
    fetchedGroupPolicies.clear();
    Logger.debug("PimGroupPolicies", "Cache cleared");
}

/** What the policy read of one group answered: its policies, or the 403 of a user who may not read them */
export interface GroupPolicyRead {
    policies: GroupPimPolicy[];
    settings: GroupPimSettings;
    /** Graph answered 403: not readable with the current access (not a failure, not "no policy") */
    forbidden: boolean;
}

/**
 * Fetch PIM policies for a single group
 * Returns Member and Owner policies with all rules
 *
 * Uses same endpoint as Directory Roles but with scopeType='Group':
 * GET /policies/unifiedRoleManagementPolicyAssignments
 *     ?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'
 *     &$expand=policy($expand=rules)
 *
 * A 403 is an answer about the signed-in user (a user without a role that may read PIM settings, or without the owner
 * right on this group): it is not retried and it does not fail the load; the group is marked `forbidden` (FIX-11).
 */
export async function fetchGroupPolicies(
    client: Client,
    groupId: string
): Promise<GroupPolicyRead> {
    try {
        // Use same endpoint structure as Directory Roles (pimApi.ts)
        // v1.0 answers the query for scopeType 'Group' too (Learn, list roleManagementPolicyAssignments; tenant test T6 and 2026-10-16: same assignments and rules as beta)
        const response = await withRetry(
            () => client
                .api("/policies/roleManagementPolicyAssignments")
                .version("v1.0")
                .header("Accept-Language", GRAPH_LOCALE)
                .filter(`scopeId eq '${groupId}' and scopeType eq 'Group'`)
                .expand("policy($expand=rules)")
                .get(),
            3, 1000, 'fetchGroupPolicies'
        );

        const assignments = response.value || [];
        const policies: GroupPimPolicy[] = [];
        let combinedSettings: GroupPimSettings = {};

        // Logger.debug('PimGroupPolicies', `Found ${assignments.length} policy assignments for group ${groupId}`);

        for (const assignment of assignments) {
            const policy = assignment.policy;
            if (!policy) {
                Logger.warn('PimGroupPolicies', `No policy in assignment for group ${groupId}`);
                continue;
            }

            const rules = policy.rules || [];

            // Determine if this is Member or Owner policy based on roleDefinitionId
            // API returns simple strings: "member" or "owner" (not GUIDs)
            const roleDefId = (assignment.roleDefinitionId || "").toLowerCase();

            // Check for "owner" string - API returns "owner" or "member"
            const policyType: "member" | "owner" = roleDefId === "owner" || roleDefId.includes(GROUP_POLICY_ROLE_IDS.OWNER)
                ? "owner"
                : "member";

            const groupPolicy: GroupPimPolicy = {
                id: policy.id,
                groupId: groupId,
                policyType,
                displayName: policy.displayName,
                rules: rules
            };

            policies.push(groupPolicy);

            // Extract settings from this policy
            const policySettings = extractGroupPolicySettings(groupPolicy);
            combinedSettings = { ...combinedSettings, ...policySettings };
        }

        return { policies, settings: combinedSettings, forbidden: false };

    } catch (error: unknown) {
        if (getErrorStatusCode(error) === 404) return { policies: [], settings: {}, forbidden: false };
        if (isForbiddenRead(error)) {
            Logger.info('PimGroupPolicies', `Policies of group ${groupId} are not readable with the current access`);
            return { policies: [], settings: {}, forbidden: true };
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.warn('PimGroupPolicies', `Failed to fetch policies for group ${groupId}:`, errorMessage);
        throw error;
    }
}

/**
 * Fetch a single group's policies on-demand (priority fetch)
 * Used when user clicks on a group before background loading completes
 */
export async function fetchSingleGroupPolicy(
    client: Client,
    groupId: string
): Promise<GroupPolicyRead | "CACHED"> {
    // Check if already fetched
    if (fetchedGroupPolicies.has(groupId)) {
        Logger.debug("PimGroupPolicies", `Policy for ${groupId} already fetched, skipping`);
        return "CACHED";
    }

    const result = await fetchGroupPolicies(client, groupId);
    // A 403 is not an answer that was read: the next call asks again
    if (!result.forbidden) fetchedGroupPolicies.add(groupId);
    return result;
}
