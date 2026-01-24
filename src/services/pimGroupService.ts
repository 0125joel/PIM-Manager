import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE } from "@/config/constants";
import { Principal } from "@/types/directoryRole.types";
import {
    PimGroup,
    GroupPimAssignment,
    PimGroupData,
    GroupType,
    computeGroupStats,
    GroupEligibilityScheduleInstance,
    GroupAssignmentScheduleInstance,
    GroupPimPolicy,
    GroupPimSettings,
    GROUP_POLICY_ROLE_IDS,
    extractGroupPolicySettings
} from "@/types/pimGroup.types";
import { runWorkerPool } from "@/utils/workerPool";
import { Logger } from "@/utils/logger";

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
        const response = await request.get();
        allItems.push(...(response.value || []));
        nextLink = response["@odata.nextLink"] || null;

        while (nextLink) {
            await delay(100);
            const nextResponse = await client.api(nextLink).get();
            allItems.push(...(nextResponse.value || []));
            nextLink = nextResponse["@odata.nextLink"] || null;
        }

        return allItems;
    } catch (error) {
        Logger.error("pimGroup", `Failed to fetch all pages for ${endpoint}:`, error);
        return allItems;
    }
}

/**
 * Detect group type from Graph API response
 */
function detectGroupType(group: any): GroupType {
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
        // If this endpoint fails, fall back to the old method as backup
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.warn("PimGroupDataService", "Beta resources endpoint failed, falling back to role-assignable filter:", errorMessage);
        return fetchRoleAssignableGroupsFallback(client);
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
        return [];
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
        // Log but don't throw - some groups might not have PIM enabled
        Logger.warn("pimGroup", `Failed to fetch eligibility instances for group ${groupId}:`, error);
        return [];
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
        // Log but don't throw - some groups might not have PIM enabled
        Logger.warn("pimGroup", `Failed to fetch assignment instances for group ${groupId}:`, error);
        return [];
    }
}

/**
 * Fetch group details by ID
 */
async function fetchGroupDetails(client: Client, groupId: string): Promise<PimGroup | null> {
    try {
        const group = await client.api(`/groups/${groupId}`)
            .version("v1.0")
            .select("id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,membershipRule,membershipRuleProcessingState,isAssignableToRole")
            .header("Accept-Language", GRAPH_LOCALE)
            .get();

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
            isAssignableToRole: group.isAssignableToRole
        };
    } catch (error) {
        Logger.error("pimGroup", `Failed to fetch group details for ${groupId}:`, error);
        return null;
    }
}

/**
 * Progress callback type
 */
export type PimGroupProgressCallback = (current: number, total: number, status: string) => void;

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

        const [pimResources, allRoleAssignable] = await Promise.all([
            fetchPimOnboardedResources(client),
            fetchRoleAssignableGroupsFallback(client) // Ideally rename this function later
        ]);

        if (signal?.aborted) throw new Error("Aborted");

        const onboardedIds = new Set(pimResources.map(r => r.id));
        const onboardedGroups = pimResources; // These are the ones we will fetch PIM data for

        // Identify Unmanaged Groups: Role-Assignable BUT NOT in PIM Resources
        const unmanagedGroups = allRoleAssignable.filter(g => !onboardedIds.has(g.id));

        Logger.debug("PimGroupDataService", `Inventory: ${allRoleAssignable.length} total role-assignable, ${onboardedGroups.length} managed, ${unmanagedGroups.length} UNMANAGED.`);

        const totalToProcess = onboardedGroups.length;

        // Phase 2: Process Managed Groups (parallel fetch of assignments/policies)
        // If no managed groups, we still might have unmanaged ones to return
        let managedResults: PimGroupData[] = [];

        if (totalToProcess > 0) {
            const { results } = await runWorkerPool<string, PimGroupData>({
                items: onboardedGroups.map(g => g.id),
                workerCount: 3,
                delayMs: 500,
                signal,
                processor: async (groupId, workerId) => {
                    // Fetch group details
                    const group = await fetchGroupDetails(client, groupId);
                    if (!group) return null;

                    // Initialize group data
                    const groupData: PimGroupData = {
                        group,
                        assignments: [],
                        linkedWorkloads: [],
                        isManaged: true // Explicitly true
                    };

                    // Fetch eligibility, assignment instances, and policies
                    const [eligibilityInstances, assignmentInstances, policyResult] = await Promise.all([
                        fetchEligibilityInstancesForGroup(client, groupId),
                        fetchAssignmentInstancesForGroup(client, groupId),
                        fetchGroupPolicies(client, groupId)
                    ]);

                    // Process eligibility
                    for (const instance of eligibilityInstances) {
                        groupData.assignments.push({
                            id: instance.id,
                            groupId: instance.groupId,
                            principalId: instance.principalId,
                            principal: (instance as any).principal,
                            accessType: instance.accessId,
                            assignmentType: "eligible",
                            memberType: instance.memberType,
                            status: instance.status,
                            startDateTime: instance.startDateTime,
                            endDateTime: instance.endDateTime,
                            scheduleInfo: instance.scheduleInfo
                        });
                    }

                    // Process assignments
                    for (const instance of assignmentInstances) {
                        const isPermanent = !instance.endDateTime && instance.assignmentType === "Activated";
                        groupData.assignments.push({
                            id: instance.id,
                            groupId: instance.groupId,
                            principalId: instance.principalId,
                            principal: (instance as any).principal,
                            accessType: instance.accessId,
                            assignmentType: isPermanent ? "permanent" : "active",
                            memberType: instance.memberType,
                            status: instance.status,
                            startDateTime: instance.startDateTime,
                            endDateTime: instance.endDateTime
                        });
                    }

                    // Compute stats
                    groupData.stats = computeGroupStats(groupData.assignments);
                    groupData.settings = policyResult.settings;

                    if (policyResult.policies.length > 0) {
                        groupData.policies = {};
                        for (const policy of policyResult.policies) {
                            if (policy.policyType === "member") groupData.policies.member = policy;
                            else groupData.policies.owner = policy;
                        }
                    }

                    return groupData;
                },
                onProgress: (current, totalItems) => {
                    const progressPercent = Math.round((current / totalItems) * 80); // 80% for managed
                    onProgress?.(progressPercent, 100, `Processing managed groups (${current}/${totalItems})...`);
                }
            });
            managedResults = Array.from(results.values());
        }

        if (signal?.aborted) throw new Error("Aborted");

        // Phase 3: Process Unmanaged Groups (Lightweight)
        // We already have ID and DisplayName. We need minimal details (description, type) but NO PIM data.
        // We can fetch details in bulk or parallel if needed, or just use what we have + type detection.
        // For accurate "Group Type" classification, we ideally need to fetch details.

        onProgress?.(85, 100, `Processing ${unmanagedGroups.length} unmanaged groups...`);

        // We'll use a simplified fetch for these to get Type/Mail info
        const unmanagedResults: PimGroupData[] = [];
        const { results: unmanagedDetails } = await runWorkerPool<string, PimGroupData>({
            items: unmanagedGroups.map(g => g.id),
            workerCount: 5, // Higher concurrency as it's just one lightweight call per group
            delayMs: 200,
            signal,
            processor: async (groupId) => {
                const group = await fetchGroupDetails(client, groupId);
                if (!group) return null;

                return {
                    group,
                    assignments: [], // No PIM assignments
                    linkedWorkloads: [],
                    isManaged: false, // FLAGGED AS UNMANAGED
                    stats: { // Zero stats
                        totalAssignments: 0,
                        activeMembers: 0,
                        eligibleMembers: 0,
                        permanentMembers: 0,
                        activeOwners: 0,
                        eligibleOwners: 0,
                        permanentOwners: 0
                    }
                };
            }
        });
        unmanagedResults.push(...Array.from(unmanagedDetails.values()));

        Logger.debug("PimGroupDataService", `Complete. Managed: ${managedResults.length}, Unmanaged: ${unmanagedResults.length}`);

        onProgress?.(100, 100, "Complete");
        return [...managedResults, ...unmanagedResults];

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
 * Get aggregated stats across all PIM groups
 */
export function getAggregatedGroupStats(groupData: PimGroupData[]): {
    totalGroups: number;
    totalEligibleMembers: number;
    totalActiveMembers: number;
    totalPermanentMembers: number;
    totalEligibleOwners: number;
    totalActiveOwners: number;
    totalPermanentOwners: number;
    totalAssignments: number;
} {
    let totalEligibleMembers = 0;
    let totalActiveMembers = 0;
    let totalPermanentMembers = 0;
    let totalEligibleOwners = 0;
    let totalActiveOwners = 0;
    let totalPermanentOwners = 0;
    let totalAssignments = 0;

    for (const data of groupData) {
        if (data.stats) {
            totalEligibleMembers += data.stats.eligibleMembers;
            totalActiveMembers += data.stats.activeMembers;
            totalPermanentMembers += data.stats.permanentMembers;
            totalEligibleOwners += data.stats.eligibleOwners;
            totalActiveOwners += data.stats.activeOwners;
            totalPermanentOwners += data.stats.permanentOwners;
            totalAssignments += data.stats.totalAssignments;
        }
    }

    return {
        totalGroups: groupData.length,
        totalEligibleMembers,
        totalActiveMembers,
        totalPermanentMembers,
        totalEligibleOwners,
        totalActiveOwners,
        totalPermanentOwners,
        totalAssignments
    };
}

// ============================================================================
// POLICY FETCHING (Progressive Loading - like Directory Roles)
// ============================================================================

/**
 * Callback type for when a group's policies are loaded
 */
export type GroupPolicyLoadedCallback = (
    groupId: string,
    policies: GroupPimPolicy[],
    settings: GroupPimSettings,
    error?: string
) => void;

// Track which group policies have been fetched (for deduplication)
const fetchedGroupPolicies = new Set<string>();

/**
 * Clear the fetched policies cache (call on new data fetch)
 */
export function clearGroupPolicyCache(): void {
    fetchedGroupPolicies.clear();
    Logger.debug("PimGroupPolicies", "Cache cleared");
}

/**
 * Fetch PIM policies for a single group
 * Returns Member and Owner policies with all rules
 *
 * Uses same endpoint as Directory Roles but with scopeType='Group':
 * GET /policies/unifiedRoleManagementPolicyAssignments
 *     ?$filter=scopeId eq '{groupId}' and scopeType eq 'Group'
 *     &$expand=policy($expand=rules)
 */
async function fetchGroupPolicies(
    client: Client,
    groupId: string
): Promise<{ policies: GroupPimPolicy[]; settings: GroupPimSettings }> {
    try {
        // Use same endpoint structure as Directory Roles (pimApi.ts)
        // Note: Using beta version for Groups (v1.0 not supported for scopeType='Group')
        const response = await client
            .api("/policies/roleManagementPolicyAssignments")
            .version("beta")
            .header("Accept-Language", GRAPH_LOCALE)
            .filter(`scopeId eq '${groupId}' and scopeType eq 'Group'`)
            .expand("policy($expand=rules)")
            .get();

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

        return { policies, settings: combinedSettings };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.warn('PimGroupPolicies', `Failed to fetch policies for group ${groupId}:`, errorMessage);
        return { policies: [], settings: {} };
    }
}

/**
 * Fetch a single group's policies on-demand (priority fetch)
 * Used when user clicks on a group before background loading completes
 */
export async function fetchSingleGroupPolicy(
    client: Client,
    groupId: string
): Promise<{ policies: GroupPimPolicy[]; settings: GroupPimSettings } | "CACHED"> {
    // Check if already fetched
    if (fetchedGroupPolicies.has(groupId)) {
        Logger.debug("PimGroupPolicies", `Policy for ${groupId} already fetched, skipping`);
        return "CACHED";
    }

    const result = await fetchGroupPolicies(client, groupId);
    fetchedGroupPolicies.add(groupId);
    return result;
}

/**
 * CONCURRENT fetch PIM policies for multiple groups using worker pool
 * Uses same pattern as Directory Roles for progressive loading
 *
 * Expected speedup: ~3x faster than sequential (3 workers)
 */
export async function concurrentFetchGroupPolicies(
    client: Client,
    groupIds: string[],
    concurrency: number = 8,
    delayMs: number = 300,
    onProgress?: (current: number, total: number) => void,
    onPolicyLoaded?: GroupPolicyLoadedCallback,
    signal?: AbortSignal
): Promise<Map<string, { policies: GroupPimPolicy[]; settings: GroupPimSettings }>> {
    const policyMap = new Map<string, { policies: GroupPimPolicy[]; settings: GroupPimSettings }>();

    // Filter out already-fetched groupIds
    const unfetchedGroupIds = groupIds.filter(id => !fetchedGroupPolicies.has(id));
    const skippedCount = groupIds.length - unfetchedGroupIds.length;

    if (skippedCount > 0) {
        Logger.debug("PimGroupPolicies", `Skipping ${skippedCount} already-fetched policies`);
    }

    if (unfetchedGroupIds.length === 0) {
        onProgress?.(groupIds.length, groupIds.length);
        return policyMap;
    }

    // Use universal worker pool
    const { results, succeeded, failed } = await runWorkerPool<string, { policies: GroupPimPolicy[]; settings: GroupPimSettings }>({
        items: unfetchedGroupIds,
        workerCount: concurrency,
        delayMs: delayMs,
        signal,
        processor: async (groupId, workerId) => {
            try {
                const result = await fetchGroupPolicies(client, groupId);

                fetchedGroupPolicies.add(groupId);
                policyMap.set(groupId, result);

                // Notify caller that policy is loaded (for progressive UI updates)
                onPolicyLoaded?.(groupId, result.policies, result.settings);
                return result;

            } catch (error: unknown) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                fetchedGroupPolicies.add(groupId); // Mark as fetched even on error
                onPolicyLoaded?.(groupId, [], {}, errorMsg);
                throw error;
            }
        },
        onProgress: (current, total) => {
            // Adjust progress to include skipped items
            onProgress?.(skippedCount + current, groupIds.length);
        }
    });

    Logger.debug("PimGroupPolicies", `Completed: ${succeeded}/${groupIds.length} policies (${failed} failed)`);
    return policyMap;
}

/**
 * Fetch and compare group policies to detect changes.
 *
 * Similar to fetchAndComparePolicies() for Directory Roles, but for PIM Groups.
 * Fetches fresh policies for all groups and compares with existing policies
 * to detect which groups had policy changes.
 *
 * @param client - Microsoft Graph client
 * @param existingGroups - Current group data with policies
 * @param onProgress - Optional progress callback
 * @param signal - Optional abort signal
 * @returns Object with changedGroupIds array and updatedGroups array
 */

/**
 * Smart Sync: Sync groups using Delta changes
 * Merges changes into existing data to avoid full re-fetch
 */
export async function syncGroupsWithDelta(
    client: Client,
    currentData: PimGroupData[],
    changes: import("@/services/deltaService").GroupDeltaChange[],
    onProgress?: PimGroupProgressCallback
): Promise<PimGroupData[]> {
    Logger.debug("SmartSync", `Syncing ${changes.length} group changes into ${currentData.length} existing groups`);

    // 1. Identify IDs
    const changedIds = new Set<string>();
    const deletedIds = new Set<string>();

    for (const change of changes) {
        if (change.isDeleted) {
            deletedIds.add(change.id);
        } else {
            changedIds.add(change.id);
        }
    }

    // 2. Remove deleted groups
    const remainingData = currentData.filter(g => !deletedIds.has(g.group.id));

    // 3. Process Additions/Updates
    if (changedIds.size === 0) {
        return remainingData;
    }

    onProgress?.(0, changedIds.size, `Refreshing ${changedIds.size} changed groups...`);

    // Re-implementing the worker pool fetch for specific IDs:
    const groupsToFetch = Array.from(changedIds);

    // Note: We don't pass signal here yet but for consistency we should traverse this path too if needed later.
    const { results } = await runWorkerPool<string, PimGroupData>({
        items: groupsToFetch,
        workerCount: 8,
        delayMs: 300,
        processor: async (groupId, workerId) => {
            // Fetch group details
            const group = await fetchGroupDetails(client, groupId);
            if (!group) return null;

            // Initialize group data
            const groupData: PimGroupData = {
                group,
                assignments: [],
                linkedWorkloads: [],
                isManaged: true // Assume managed if coming from PIM delta? Actually delta is from /groups/delta so it includes ALL groups
            };

            // Let's fetch everything.
            const [eligibilityInstances, assignmentInstances, policyResult] = await Promise.all([
                fetchEligibilityInstancesForGroup(client, groupId),
                fetchAssignmentInstancesForGroup(client, groupId),
                fetchGroupPolicies(client, groupId)
            ]);

            // If no PIM data found, mark as unmanaged/ignore
            const hasPimData = eligibilityInstances.length > 0 ||
                assignmentInstances.length > 0 ||
                !!policyResult.settings.memberMaxDuration ||
                !!policyResult.settings.ownerMaxDuration;

            // Process eligibility
            for (const instance of eligibilityInstances) {
                groupData.assignments.push({
                    id: instance.id,
                    groupId: instance.groupId,
                    principalId: instance.principalId,
                    principal: (instance as any).principal,
                    accessType: instance.accessId,
                    assignmentType: "eligible",
                    memberType: instance.memberType,
                    status: instance.status,
                    startDateTime: instance.startDateTime,
                    endDateTime: instance.endDateTime,
                    scheduleInfo: instance.scheduleInfo
                });
            }
            // Process assignments
            for (const instance of assignmentInstances) {
                const isPermanent = !instance.endDateTime && instance.assignmentType === "Activated";
                groupData.assignments.push({
                    id: instance.id,
                    groupId: instance.groupId,
                    principalId: instance.principalId,
                    principal: (instance as any).principal,
                    accessType: instance.accessId,
                    assignmentType: isPermanent ? "permanent" : "active",
                    memberType: instance.memberType,
                    status: instance.status,
                    startDateTime: instance.startDateTime,
                    endDateTime: instance.endDateTime
                });
            }
            // Policies
            groupData.settings = policyResult.settings;
            if (policyResult.policies.length > 0) {
                groupData.policies = {};
                for (const policy of policyResult.policies) {
                    if (policy.policyType === "member") groupData.policies.member = policy;
                    else groupData.policies.owner = policy;
                }
            }
            groupData.stats = computeGroupStats(groupData.assignments);

            // Decision: Is this a "Managed PIM Group" or "Unmanaged"?
            if (hasPimData) {
                groupData.isManaged = true;
                return groupData;
            } else if (group.isAssignableToRole) {
                groupData.isManaged = false;
                return groupData;
            }
            return null; // Not PIM and not role-assignable (shouldn't happen if filter was correct, but safe)
        },
        onProgress: (current, totalItems) => {
            // onProgress?.(current, totalItems, ...);
        }
    });

    const newOrUpdatedGroups = Array.from(results.values());

    // Merge logic
    // We have `remainingData` (old groups minus deleted)
    // We have `newOrUpdatedGroups` (freshly fetched)

    // Create a map of remaining data for easy update
    const dataMap = new Map(remainingData.map(g => [g.group.id, g]));

    // Update/Add new groups
    for (const group of newOrUpdatedGroups) {
        dataMap.set(group.group.id, group);
    }

    return Array.from(dataMap.values());
}
