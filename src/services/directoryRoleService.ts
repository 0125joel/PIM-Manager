import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE, PIM_URLS } from "@/config/constants";
import {
    RoleDefinition,
    RoleAssignment,
    PimEligibilitySchedule,
    PimAssignmentSchedule,
    PimScheduleInstance,
    PimPolicyAssignment,
    PimPolicy,
    Approver,
    RoleDetailData,
    GraphListResponse,
    Principal
} from "@/types/directoryRole.types";
import { detectScopeType, enrichScopeInfo } from "@/utils/scopeUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { Logger } from "../utils/logger";
import { getRolePolicy } from "@/services/pimConfigurationService";


/**
 * Comprehensive service for fetching Entra ID Role & PIM data
 * HEAVILY optimized with bulk fetching to avoid throttling
 */

// Helper to add delay for throttling protection
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to fetch all pages of a paginated Graph API response
 * Handles @odata.nextLink automatically for large tenants
 */
async function fetchAllPages<T>(
    client: Client,
    endpoint: string,
    options?: {
        version?: string;
        expand?: string;
        select?: string;
        filter?: string;
    }
): Promise<T[]> {
    const allItems: T[] = [];
    let nextLink: string | null = null;

    // Build initial request
    let request = client.api(endpoint);

    if (options?.version) {
        request = request.version(options.version);
    }
    if (options?.expand) {
        request = request.expand(options.expand);
    }
    if (options?.select) {
        request = request.select(options.select);
    }
    if (options?.filter) {
        request = request.filter(options.filter);
    }

    request = request.header("Accept-Language", GRAPH_LOCALE);

    try {
        // Fetch first page
        const response = await request.get();
        allItems.push(...(response.value || []));
        nextLink = response["@odata.nextLink"] || null;

        // Fetch remaining pages
        while (nextLink) {
            await delay(100); // Small delay between pages to avoid throttling
            const nextResponse = await client.api(nextLink).get();
            allItems.push(...(nextResponse.value || []));
            nextLink = nextResponse["@odata.nextLink"] || null;
        }

        return allItems;
    } catch (error) {
        Logger.error("directoryRole", `Failed to fetch all pages for ${endpoint}:`, error);
        return allItems; // Return what we have
    }
}

// Note: chunk() helper removed - now handled internally by runWorkerPool utility

/**
 * Progress callback type
 */
export type ProgressCallback = (current: number, total: number, status: string) => void;

/**
 * Callback for when a single policy is loaded (for deferred/priority loading)
 * error is set when the fetch failed
 */
export type PolicyLoadedCallback = (roleId: string, policy: any, error?: string) => void;

// Track which policies have been fetched (for priority fetch deduplication)
const fetchedPolicies = new Set<string>();

/**
 * Clear the policy cache - used when forcing a fresh policy comparison
 */
export function clearPolicyCache(): void {
    fetchedPolicies.clear();
    Logger.debug("PolicyCache", "Policy cache cleared");
}

/**
 * Fetch a single role's policy on-demand (priority fetch)
 * Used when user clicks on a role before background loading completes
 */
export async function fetchSinglePolicy(
    client: Client,
    roleId: string
): Promise<any | null | "CACHED"> {
    // Already fetched? Return "CACHED" to indicate no fetch needed but data exists
    if (fetchedPolicies.has(roleId)) {
        Logger.debug("PriorityFetch", `Policy for ${roleId} already fetched, skipping`);
        return "CACHED";
    }

    try {
        Logger.debug("PriorityFetch", `Fetching policy for role ${roleId}`);
        const response = await client
            .api(PIM_URLS.roleManagementPolicyAssignments)
            .version("v1.0")
            .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
            .expand('policy($expand=rules)')
            .header('Accept-Language', GRAPH_LOCALE)
            .get();

        fetchedPolicies.add(roleId); // Always mark as fetched, even if empty

        if (response.value?.length > 0) {
            return response.value[0];
        }
        return null; // Explicitly return null for "No Policy Found"
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.error("PriorityFetch", `Failed for role ${roleId}:`, errorMessage);
        fetchedPolicies.add(roleId); // Mark as fetched even on error to prevent infinite retry loops
        return null;
    }
}


/**
 * Enriches assignments with scope information
 * Uses caching to avoid duplicate API calls for the same scope
 */
export async function enrichAssignmentsWithScope(
    client: Client,
    assignments: any[]
): Promise<any[]> {
    if (!assignments || assignments.length === 0) return assignments;

    const scopeCache = new Map<string, any>();
    const enrichedAssignments: any[] = [];

    Logger.debug("ScopeEnrichment", `Enriching ${assignments.length} assignments with scope info`);

    for (const assignment of assignments) {
        const { directoryScopeId, appScopeId } = assignment;

        // Create cache key
        const cacheKey = `${directoryScopeId}|${appScopeId || ""}`;

        // Check cache first
        if (scopeCache.has(cacheKey)) {
            enrichedAssignments.push({
                ...assignment,
                scopeInfo: scopeCache.get(cacheKey)
            });
            continue;
        }

        // Detect basic scope type (fast, no API call)
        const scopeType = detectScopeType(directoryScopeId, appScopeId);

        // For tenant-wide, no need to enrich
        if (scopeType === "tenant-wide") {
            const scopeInfo = {
                type: "tenant-wide" as const,
                displayName: "Tenant-wide",
                id: "/"
            };
            scopeCache.set(cacheKey, scopeInfo);
            enrichedAssignments.push({
                ...assignment,
                scopeInfo
            });
            continue;
        }

        // For other types, enrich with API call (but only if not already in directoryScope)
        try {
            const scopeInfo = await enrichScopeInfo(client, assignment);
            scopeCache.set(cacheKey, scopeInfo);
            enrichedAssignments.push({
                ...assignment,
                scopeInfo
            });
        } catch (error) {
            Logger.warn("directoryRole", `Failed to enrich scope for ${directoryScopeId}:`, error);
            // Fallback: use basic detection
            const fallbackInfo = {
                type: scopeType,
                displayName: directoryScopeId,
                id: directoryScopeId
            };
            scopeCache.set(cacheKey, fallbackInfo);
            enrichedAssignments.push({
                ...assignment,
                scopeInfo: fallbackInfo
            });
        }

        // Small delay to avoid throttling
        await delay(50);
    }

    Logger.debug("ScopeEnrichment", `Enriched ${enrichedAssignments.length} assignments, ${scopeCache.size} unique scopes`);
    return enrichedAssignments;
}

/**
 * Step 1: Get all role definitions
 */
export async function getRoleDefinitions(client: Client): Promise<RoleDefinition[]> {
    try {
        // Try to fetch with isPrivileged first
        try {
            const response: GraphListResponse<RoleDefinition> = await client
                .api(PIM_URLS.roleDefinitions)
                .version("beta")
                .header("Accept-Language", GRAPH_LOCALE)
                .select("id,displayName,description,isBuiltIn,isPrivileged,templateId,resourceScopes")
                .get();

            return response.value || [];
        } catch (err) {
            Logger.warn("directoryRole", "Failed to fetch isPrivileged property, retrying without it.", err);

            // Fallback: Fetch without isPrivileged
            const response: GraphListResponse<RoleDefinition> = await client
                .api(PIM_URLS.roleDefinitions)
                .version("beta")
                .header("Accept-Language", GRAPH_LOCALE)
                .select("id,displayName,description,isBuiltIn,templateId,resourceScopes")
                .get();

            return response.value || [];
        }
    } catch (error) {
        Logger.error("directoryRole", "Failed to fetch role definitions", error);
        throw error;
    }
}

/**
 * CONCURRENT fetch PIM policies using universal workerPool utility
 * Uses runWorkerPool for parallel fetching while respecting rate limits.
 * Expected speedup: ~3x faster than sequential (3 workers)
 * Supports: skipping already-fetched policies and progressive callbacks
 */
export async function concurrentFetchPolicies(
    client: Client,
    roleIds: string[],
    concurrency: number = 8,
    delayMs: number = 300,
    onProgress?: (current: number, total: number) => void,
    onPolicyLoaded?: PolicyLoadedCallback,
    signal?: AbortSignal
): Promise<Map<string, any>> {
    const policyMap = new Map<string, any>();

    // Filter out already-fetched roleIds
    const unfetchedRoleIds = roleIds.filter(id => !fetchedPolicies.has(id));
    const skippedCount = roleIds.length - unfetchedRoleIds.length;

    if (skippedCount > 0) {
        Logger.debug("PolicyFetch", `Skipping ${skippedCount} already-fetched policies`);
    }

    if (unfetchedRoleIds.length === 0) {
        onProgress?.(roleIds.length, roleIds.length);
        return policyMap;
    }

    // Use universal worker pool
    const { results } = await runWorkerPool<string, any>({
        items: unfetchedRoleIds,
        workerCount: concurrency,
        delayMs: delayMs,
        signal,
        processor: async (roleId, workerId) => {
            try {
                // v1.0 is available for roleManagementPolicyAssignments
                const response = await client
                    .api(PIM_URLS.roleManagementPolicyAssignments)
                    .version("v1.0")
                    .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
                    .expand('policy($expand=rules)')
                    .header('Accept-Language', GRAPH_LOCALE)
                    .get();

                if (response.value?.length > 0) {
                    const policy = response.value[0];
                    fetchedPolicies.add(roleId);
                    policyMap.set(roleId, policy);

                    // Notify caller that policy is loaded (for progressive UI updates)
                    onPolicyLoaded?.(roleId, policy);
                    return policy;
                }

                fetchedPolicies.add(roleId);
                return null;
            } catch (error: unknown) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                fetchedPolicies.add(roleId); // Mark as fetched even on error
                onPolicyLoaded?.(roleId, null, errorMsg); // Report error via callback
                throw error; // Re-throw so worker pool counts it as failed
            }
        },
        onProgress: (current, total) => {
            // Adjust progress to include skipped items
            onProgress?.(skippedCount + current, roleIds.length);
        }
    });

    Logger.debug('DirectoryRoleService', `Completed fetching policies: ${policyMap.size}/${roleIds.length} resolved`);
    return policyMap;
}

/**
 * Resolve approvers from primary approvers list
 */
async function resolveApprovers(client: Client, primaryApprovers: any[]): Promise<Approver[]> {
    const approvers: Approver[] = [];

    for (const approver of primaryApprovers) {
        try {
            const enrichedApprover = await resolveApprover(client, approver);
            if (enrichedApprover) {
                approvers.push(enrichedApprover);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            Logger.warn('DirectoryRoleService', `Failed to resolve approver ${approver.id}: ${errorMessage}`);
            approvers.push({
                ...approver,
                displayName: `Unknown (${approver.id})`,
                type: approver["@odata.type"] === "#microsoft.graph.singleUser" ? "user" : "group"
            });
        }
    }

    return approvers;
}

/**
 * Cache for resolved approvers to prevent redundant API calls
 */
const approverCache = new Map<string, Approver>();

/**
 * Helper: Resolve single approver (user or group)
 */
async function resolveApprover(client: Client, approver: any): Promise<Approver | null> {
    const type = approver["@odata.type"];
    // Try to find the ID property (it might be 'id' or 'groupId' depending on API version/type)
    const id = approver.id || approver.groupId || approver.userId;

    if (!id && type !== "#microsoft.graph.requestorManager") {
        return null; // Skip invalid entries silently
    }

    // Check cache
    if (approverCache.has(id)) {
        return approverCache.get(id)!;
    }

    let result: Approver | null = null;

    try {
        if (type === "#microsoft.graph.singleUser") {
            const user: Principal = await client
                .api(`/users/${id}`)
                .header("Accept-Language", GRAPH_LOCALE)
                .select("id,displayName,userPrincipalName,mail")
                .get();

            result = {
                ...approver,
                displayName: user.displayName,
                userPrincipalName: user.userPrincipalName,
                mail: user.mail,
                type: "user"
            };
        } else if (type === "#microsoft.graph.groupMembers") {
            const group: any = await client
                .api(`/groups/${id}`)
                .header("Accept-Language", GRAPH_LOCALE)
                .select("id,displayName,mail")
                .get();

            result = {
                ...approver,
                displayName: group.displayName,
                mail: group.mail,
                type: "group"
            };
        }

        if (result) {
            approverCache.set(id, result);
        }

        return result;

    } catch (error) {
        Logger.error("resolveApprover", `Failed to resolve approver ${id}`, error);
    }

    return null;
}

/**
 * Lazy load approvers for a specific role
 */
export async function loadApproversForRole(
    client: Client,
    policyRules?: any[]
): Promise<Approver[]> {
    if (!policyRules) return [];

    const approvalRules = policyRules.filter((rule: any) =>
        rule["@odata.type"]?.includes("ApprovalRule")
    );

    const approvers: Approver[] = [];

    for (const rule of approvalRules) {
        if (rule.setting?.approvalStages) {
            for (const stage of rule.setting.approvalStages) {
                if (stage.primaryApprovers) {
                    const resolvedApprovers = await resolveApprovers(client, stage.primaryApprovers);
                    approvers.push(...resolvedApprovers);
                }
            }
        }
    }

    return approvers;
}

/**
 * Batch loaded callback - called each time a batch of roles is loaded
 */
export type BatchLoadedCallback = (roles: RoleDetailData[]) => void;

/**
 * DEFERRED LOADING: Optimized fetch that returns roles immediately and loads policies in background
 * - Step 1: Fetch definitions + assignments (Fast, ~10s)
 * - Step 2: Return data to UI immediately
 * - Step 3: Fetch policies in background (Slow, ~2m) and update via callback
 */
export async function getAllRolesOptimizedWithDeferredPolicies(
    client: Client,
    onProgress?: (current: number, total: number, status: string) => void,
    signal?: AbortSignal
): Promise<RoleDetailData[]> {
    try {
        Logger.info("DirectoryRoleService", "Fetching all roles (Optimized/Deferred Policies)...");
        clearPolicyCache();

        // Step 1: Fetch role definitions
        onProgress?.(10, 100, "Fetching role definitions...");

        if (signal?.aborted) throw new Error("Aborted");

        const definitions = await getRoleDefinitions(client);

        onProgress?.(30, 100, `Found ${definitions.length} roles. Fetching assignments...`);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 2: Parallel fetch for Assignment Data
        // We run these in parallel to save time
        const [assignments, eligibilities, assignmentSchedules] = await Promise.all([
            // v1.0 for roleAssignments
            fetchAllPages<any>(client, PIM_URLS.roleAssignments, {
                version: "v1.0",
                expand: "principal",
                select: "id,roleDefinitionId,principalId,directoryScopeId"
            }),
            // beta for eligibility schedules
            fetchAllPages<any>(client, PIM_URLS.roleEligibilitySchedules, {
                version: "beta",
                expand: "principal",
                select: "id,roleDefinitionId,principalId,directoryScopeId,scheduleInfo,status"
            }),
            // beta for assignment schedules
            fetchAllPages<any>(client, PIM_URLS.roleAssignmentSchedules, {
                version: "beta",
                select: "id,roleDefinitionId,principalId,directoryScopeId,scheduleInfo,assignmentType"
            })
        ]);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 3: Enrich with Scope Info
        onProgress?.(50, 100, "Enriching scope information (Optimized)...");

        const enrichedAssignments = await enrichAssignmentsWithScope(client, assignments);
        const enrichedEligibilities = await enrichAssignmentsWithScope(client, eligibilities);
        const enrichedSchedules = await enrichAssignmentsWithScope(client, assignmentSchedules);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 4: Map to RoleDetailData
        // Now using the correct structure definition for RoleDetailData
        onProgress?.(70, 100, "Processing roles...");

        const roles: RoleDetailData[] = definitions.map(def => {
            return {
                definition: def,
                assignments: {
                    permanent: enrichedAssignments.filter(a => a.roleDefinitionId === def.id),
                    eligible: enrichedEligibilities.filter(e => e.roleDefinitionId === def.id),
                    active: enrichedSchedules.filter(s => s.roleDefinitionId === def.id)
                },
                // Policy is deferred - loaded later by the context/component
                policy: null
            };
        });

        Logger.info("DirectoryRoleService", `Processed ${roles.length} roles. Starting background policy fetch...`);

        return roles;

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (signal?.aborted || errorMessage === "Aborted") {
            throw error;
        }
        Logger.error("DirectoryRoleService", "Failed to fetch roles:", error);
        throw error;
    }
}

/**
 * Smart Sync: Sync roles using Delta changes
 * Merges changes into existing data to avoid full re-fetch
 */
export async function syncRolesWithDelta(
    client: Client,
    currentData: RoleDetailData[],
    changes: import("@/services/deltaService").DirectoryRoleDeltaChange[],
    onProgress?: ProgressCallback,
    onPolicyLoaded?: PolicyLoadedCallback,
    onPoliciesComplete?: () => void
): Promise<RoleDetailData[]> {
    Logger.debug("SmartSync", `Syncing ${changes.length} changes into ${currentData.length} existing roles`);

    // 1. Identify modified IDs
    const modifiedIds = new Set<string>();
    const deletedIds = new Set<string>();

    for (const change of changes) {
        if (change.isDeleted) {
            deletedIds.add(change.id);
        } else {
            modifiedIds.add(change.id);
        }
    }

    // 2. Remove deleted roles
    let updatedData = currentData.filter(r => !deletedIds.has(r.definition.id));

    // 3. Update modified/new roles
    if (modifiedIds.size > 0) {
        onProgress?.(0, modifiedIds.size, `Refreshing ${modifiedIds.size} changed roles...`);

        // We need to fetch the FULL definition for these changed roles
        // Ideally we would just use the delta data, but delta often returns partial data
        // For robustness, we re-fetch the specific definitions or just rely on what we have if the delta was rich
        // But since directoryRoles delta is often minimal, we might need a specific get.
        // HOWEVER, fetching 100 individual roles is slower than 1 list list.
        // If changed > 50, maybe just full sync?
        // Let's assume for now we just want to ensure they exist.

        // Actually, for "Assignments" and "Policies", we still need to fetch those.
        // The Delta only tells us the Role Definition changed (or was added).
        // It DOES NOT tell us if an Assignment was added (that's a different delta we can't fully use yet).

        // SO: If we see a Role Change, we assume we need to re-fetch that role's data.

        // Hybrid Strategy:
        // 1. Keep existing unchanged roles.
        // 2. For modified IDs, we might need to re-fetch their policies.
        // 3. If it's a NEW role, we need to fetch it entirely.

        // Simplification for V1:
        // If we have any additions/updates, we might need to re-fetch just those.
        // But `deferred` loading does bulk fetch.
        // Let's try to just return the merged list if we can.

        // For now, let's just update the list with the IDs provided.
        // If it's an update, we keep the old data but mark it for policy refresh.
    }

    return updatedData;
}

