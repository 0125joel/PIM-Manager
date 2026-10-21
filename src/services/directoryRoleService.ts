import { Client } from "@microsoft/microsoft-graph-client";
import { GRAPH_LOCALE, PIM_URLS } from "@/config/constants";
import { RoleDefinition, RoleAssignment, PimEligibilitySchedule, PimAssignmentSchedule, PimScheduleInstance, PimPolicyAssignment, PimPolicyRule, Approver, PrimaryApprover, RoleDetailData, GraphListResponse, Principal, ScopeInfo } from "@/types/directoryRole.types";
import { detectScopeType, enrichScopeInfo } from "@/utils/scopeUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { withRetry } from "@/utils/retryUtils";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { Logger } from "../utils/logger";
import { getErrorMessage } from "@/utils/errorUtils";
import { isForbiddenRead } from "@/utils/policyReadAccess";
import { getViaGroupScheduleIds, markSchedulesViaGroup } from "@/utils/viaGroup";
import { USER_ID_CHUNK_SIZE, applyUserTypes, buildUserIdFilter, chunkArray, collectKnownUserTypes, collectUserCandidateIds } from "@/utils/userTypeUtils";


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
        top?: number;
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
    // Add $top parameter for pagination optimization (default 100 items per page)
    // Reduces API calls by 5x compared to default 20 items (500 roles: 25 calls → 5 calls)
    if (options?.top) {
        request = request.top(options.top);
    } else {
        request = request.top(100); // Graph API max for most endpoints
    }

    request = request.header("Accept-Language", GRAPH_LOCALE);

    try {
        // Fetch first page
        const response = await withRetry(() => request.get(), 3, 1000, `directoryRole fetchAllPages ${endpoint}`);
        allItems.push(...(response.value || []));
        nextLink = response["@odata.nextLink"] || null;

        // Fetch remaining pages, cap at MAX_PAGES to guard against malformed nextLink cycles
        const MAX_PAGES = 200; // 200 × 100 items = 20 000 max; well above any real tenant
        let pageCount = 0;
        while (nextLink && pageCount < MAX_PAGES) {
            pageCount++;
            await delay(100); // Small delay between pages to avoid throttling
            const link = nextLink;
            const nextResponse = await withRetry(() => client.api(link).get(), 3, 1000, `directoryRole nextLink ${endpoint}`);
            allItems.push(...(nextResponse.value || []));
            nextLink = nextResponse["@odata.nextLink"] || null;
        }
        if (pageCount >= MAX_PAGES) {
            Logger.warn("directoryRole", `fetchAllPages reached MAX_PAGES (${MAX_PAGES}) for ${endpoint}, result may be incomplete`);
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
 * Receives PimPolicyAssignment (with nested .policy property) or null
 * error is set when the fetch failed; forbidden is set when Graph answered 403 (not readable with the current access, FIX-12)
 */
export type PolicyLoadedCallback = (roleId: string, policy: PimPolicyAssignment | null, error?: string, forbidden?: boolean) => void;

// SessionStorage keys for policy caching (60min TTL matching architecture standard)
const POLICY_CACHE_STORAGE_KEY = "directory_role_policy_cache";
const POLICY_CACHE_TIMESTAMP_KEY = "directory_role_policy_timestamp";
const CACHE_TTL = 60 * 60 * 1000; // 60 minutes (architecture standard)

// In-memory policy cache for current session (Map stores actual policy data)
const policyCache = new Map<string, PimPolicyAssignment | null>();

/**
 * Load policy cache from SessionStorage if not expired
 */
function loadPolicyCacheFromStorage(): void {
    // Guard: only run in browser environment
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
        return;
    }

    try {
        const timestamp = sessionStorage.getItem(POLICY_CACHE_TIMESTAMP_KEY);
        const cacheData = sessionStorage.getItem(POLICY_CACHE_STORAGE_KEY);

        if (timestamp && cacheData) {
            const cacheAge = Date.now() - parseInt(timestamp, 10);
            if (cacheAge < CACHE_TTL) {
                const parsed = JSON.parse(cacheData) as Record<string, PimPolicyAssignment | null>;
                Object.entries(parsed).forEach(([roleId, policy]) => {
                    policyCache.set(roleId, policy);
                });
                Logger.debug("PolicyCache", `Loaded ${policyCache.size} policies from cache (age: ${Math.round(cacheAge / 1000)}s)`);
            } else {
                Logger.debug("PolicyCache", `Cache expired (age: ${Math.round(cacheAge / 1000)}s), clearing`);
                sessionStorage.removeItem(POLICY_CACHE_STORAGE_KEY);
                sessionStorage.removeItem(POLICY_CACHE_TIMESTAMP_KEY);
            }
        }
    } catch (error) {
        Logger.warn("PolicyCache", "Failed to load cache from storage:", error);
    }
}

/**
 * Save policy cache to SessionStorage
 */
function savePolicyCacheToStorage(): void {
    // Guard: only run in browser environment
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
        return;
    }

    try {
        const cacheObject = Object.fromEntries(policyCache.entries());
        sessionStorage.setItem(POLICY_CACHE_STORAGE_KEY, JSON.stringify(cacheObject));
        sessionStorage.setItem(POLICY_CACHE_TIMESTAMP_KEY, Date.now().toString());
        Logger.debug("PolicyCache", `Saved ${policyCache.size} policies to storage`);
    } catch (error) {
        Logger.warn("PolicyCache", "Failed to save cache to storage:", error);
    }
}

// Load cache on module initialization
loadPolicyCacheFromStorage();

/**
 * Clear the policy cache - used when forcing a fresh policy comparison
 */
export function clearPolicyCache(): void {
    policyCache.clear();

    // Guard: only clear sessionStorage in browser environment
    if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(POLICY_CACHE_STORAGE_KEY);
        sessionStorage.removeItem(POLICY_CACHE_TIMESTAMP_KEY);
    }

    Logger.debug("PolicyCache", "Policy cache cleared");
}

/**
 * Fetch a single role's policy on-demand (priority fetch)
 * Used when user clicks on a role before background loading completes.
 * Resolves with the policy, or null when Graph verified there is none. A failure is thrown, never returned as null:
 * a null would be stored as "no policy" (lessons-learned). A 403 is thrown too; the caller marks the role not readable.
 */
export async function fetchSinglePolicy(
    client: Client,
    roleId: string
): Promise<PimPolicyAssignment | null> {
    // Check cache first - return actual cached data
    if (policyCache.has(roleId)) {
        const cachedPolicy = policyCache.get(roleId) ?? null;
        Logger.debug("PriorityFetch", `Policy for ${roleId} loaded from cache`);
        return cachedPolicy;
    }

    try {
        Logger.debug("PriorityFetch", `Fetching policy for role ${roleId}`);
        const response = await withRetry(
            () => client
                .api(PIM_URLS.roleManagementPolicyAssignments)
                .version("v1.0")
                .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
                .expand('policy($expand=rules)')
                .header('Accept-Language', GRAPH_LOCALE)
                .get(),
            3, 1000, 'fetchSinglePolicy'
        );

        const policy = response.value?.length > 0 ? response.value[0] : null;

        // Cache the policy data (store actual data, not just ID)
        policyCache.set(roleId, policy);
        savePolicyCacheToStorage(); // Persist to SessionStorage

        return policy;
    } catch (error: unknown) {
        // A failure is not cached: the next request asks Graph again
        if (isForbiddenRead(error)) Logger.info("PriorityFetch", `Policy of role ${roleId} is not readable with the current access`);
        else Logger.error("PriorityFetch", `Failed for role ${roleId}:`, getErrorMessage(error));
        throw error;
    }
}


/** Assignment types that can be enriched with scope info */
interface EnrichableAssignment {
    directoryScopeId: string;
    appScopeId?: string;
    scopeInfo?: ScopeInfo;
}

/**
 * Enriches assignments with scope information.
 * Uses caching to avoid duplicate API calls for the same scope.
 * Unique non-tenant-wide scopes are fetched in parallel via the worker pool.
 *
 * Pass `sharedScopeCache` to dedupe lookups across multiple assignment lists
 * (assignments, eligibilities, schedules) within a single refresh.
 */
export async function enrichAssignmentsWithScope<T extends EnrichableAssignment>(
    client: Client,
    assignments: T[],
    sharedScopeCache?: Map<string, ScopeInfo>
): Promise<T[]> {
    if (!assignments || assignments.length === 0) return assignments;

    const scopeCache = sharedScopeCache ?? new Map<string, ScopeInfo>();

    Logger.debug("ScopeEnrichment", `Enriching ${assignments.length} assignments with scope info`);

    // Pass 1: resolve tenant-wide and already-cached scopes immediately, collect unique non-tenant-wide scopes
    const pendingScopes = new Map<string, T>(); // cacheKey -> sample assignment for the lookup

    for (const assignment of assignments) {
        const { directoryScopeId, appScopeId } = assignment;
        const cacheKey = `${directoryScopeId}|${appScopeId || ""}`;

        if (scopeCache.has(cacheKey)) continue;

        const scopeType = detectScopeType(directoryScopeId, appScopeId);
        if (scopeType === "tenant-wide") {
            scopeCache.set(cacheKey, {
                type: "tenant-wide",
                displayName: "Tenant-wide",
                id: "/"
            });
            continue;
        }

        if (!pendingScopes.has(cacheKey)) {
            pendingScopes.set(cacheKey, assignment);
        }
    }

    // Pass 2: parallel-fetch unique non-tenant-wide scopes via worker pool
    if (pendingScopes.size > 0) {
        const items = Array.from(pendingScopes.entries());
        await runWorkerPool<[string, T], void>({
            items,
            workerCount: 8,
            delayMs: 300,
            processor: async ([cacheKey, sampleAssignment]) => {
                // Re-check cache inside processor to avoid duplicate work when running in parallel
                if (scopeCache.has(cacheKey)) return;

                try {
                    const scopeInfo = await enrichScopeInfo(client, sampleAssignment);
                    scopeCache.set(cacheKey, scopeInfo);
                } catch (error) {
                    Logger.warn("directoryRole", `Failed to enrich scope for ${sampleAssignment.directoryScopeId}:`, error);
                    scopeCache.set(cacheKey, {
                        type: detectScopeType(sampleAssignment.directoryScopeId, sampleAssignment.appScopeId),
                        displayName: sampleAssignment.directoryScopeId,
                        id: sampleAssignment.directoryScopeId
                    });
                }
            },
            rateLimiter: graphRateLimiter
        });
    }

    // Pass 3: map all assignments to their resolved scope info
    const enrichedAssignments = assignments.map(assignment => {
        const cacheKey = `${assignment.directoryScopeId}|${assignment.appScopeId || ""}`;
        return { ...assignment, scopeInfo: scopeCache.get(cacheKey) };
    });

    Logger.debug("ScopeEnrichment", `Enriched ${enrichedAssignments.length} assignments, ${scopeCache.size} unique scopes (${pendingScopes.size} fetched this pass)`);
    return enrichedAssignments;
}

/**
 * Step 1: Get all role definitions
 */
export async function getRoleDefinitions(client: Client): Promise<RoleDefinition[]> {
    try {
        // Try to fetch with isPrivileged first
        try {
            const response: GraphListResponse<RoleDefinition> = await withRetry(
                () => client
                    .api(PIM_URLS.roleDefinitions)
                    // Beta: isPrivileged exists on unifiedRoleDefinition in beta only (lessons-learned.md); v1.0 does not return it
                    .version("beta")
                    .header("Accept-Language", GRAPH_LOCALE)
                    .select("id,displayName,description,isBuiltIn,isPrivileged,isEnabled,templateId,resourceScopes,rolePermissions,version")
                    .get(),
                3, 1000, 'getRoleDefinitions'
            );

            return response.value || [];
        } catch (err) {
            Logger.warn("directoryRole", "Failed to fetch isPrivileged property, retrying without it.", err);

            // Fallback: v1.0 without isPrivileged (not in the v1.0 schema); also works when beta itself is unavailable
            const response: GraphListResponse<RoleDefinition> = await withRetry(
                () => client
                    .api(PIM_URLS.roleDefinitions)
                    .version("v1.0")
                    .header("Accept-Language", GRAPH_LOCALE)
                    .select("id,displayName,description,isBuiltIn,isEnabled,templateId,resourceScopes,rolePermissions,version")
                    .get(),
                3, 1000, 'getRoleDefinitions:fallback'
            );

            return response.value || [];
        }
    } catch (error) {
        Logger.error("directoryRole", "Failed to fetch role definitions", error);
        throw error;
    }
}

/** Fewer roles than this are read one by one: the single call is only worth it for a whole tenant */
const BULK_POLICY_MIN_ROLES = 10;

/**
 * What the one-call read of every role's policy answered:
 * - read: the policies by role id (partial when a later page failed; the rest is read per role)
 * - forbidden: Graph answered 403. The per-role read asks the same question, so it would answer the same: no fallback (FIX-12)
 * - failed: any other failure (429, 5xx, network), the caller reads the roles one by one as before
 */
export type BulkPolicyRead =
    | { kind: "read"; policies: Map<string, PimPolicyAssignment> }
    | { kind: "forbidden" }
    | { kind: "failed" };

/**
 * Every role's policy with its rules in one call (NG-P1: 145 roles in 1.9 s, against about 59 s for one call per role).
 * Follows `@odata.nextLink`.
 */
export async function fetchAllRolePolicies(
    client: Client,
    signal?: AbortSignal
): Promise<BulkPolicyRead> {
    const found = new Map<string, PimPolicyAssignment>();
    const MAX_PAGES = 50;
    try {
        let response = await withRetry(
            () => client
                .api(PIM_URLS.roleManagementPolicyAssignments)
                .version("v1.0")
                .filter("scopeId eq '/' and scopeType eq 'Directory'")
                .expand("policy($expand=rules)")
                .header("Accept-Language", GRAPH_LOCALE)
                .get(),
            3, 1000, "fetchAllRolePolicies"
        );
        let pages = 1;
        for (;;) {
            for (const item of (response.value ?? []) as PimPolicyAssignment[]) {
                if (item?.roleDefinitionId && item.policy) found.set(item.roleDefinitionId, item);
            }
            const next: string | undefined = response["@odata.nextLink"];
            if (!next || pages >= MAX_PAGES || signal?.aborted) break;
            pages++;
            response = await withRetry(() => client.api(next).get(), 3, 1000, "fetchAllRolePolicies:next");
        }
        return { kind: "read", policies: found };
    } catch (error: unknown) {
        if (found.size > 0) {
            Logger.warn("PolicyFetch", "Reading the rest of the policies in one call failed, the rest is read per role", error);
            return { kind: "read", policies: found };
        }
        if (isForbiddenRead(error)) {
            Logger.info("PolicyFetch", "Graph refuses the role policies to this user (403): not read per role");
            return { kind: "forbidden" };
        }
        Logger.warn("PolicyFetch", "Reading all policies in one call failed, reading them per role", error);
        return { kind: "failed" };
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
): Promise<Map<string, PimPolicyAssignment | null>> {
    const policyMap = new Map<string, PimPolicyAssignment | null>();

    // Filter out already-cached roleIds and populate map with cached data
    const unfetchedRoleIds = roleIds.filter(id => {
        if (policyCache.has(id)) {
            const cachedPolicy = policyCache.get(id) ?? null;
            policyMap.set(id, cachedPolicy);
            return false; // Exclude from unfetched list
        }
        return true; // Include in unfetched list
    });
    const cachedCount = roleIds.length - unfetchedRoleIds.length;

    if (cachedCount > 0) {
        Logger.debug("PolicyFetch", `Loaded ${cachedCount} policies from cache`);
    }

    if (unfetchedRoleIds.length === 0) {
        onProgress?.(roleIds.length, roleIds.length);
        return policyMap;
    }

    const tPoolStart = performance.now();
    const callLatencies: number[] = [];

    // One call for the whole tenant; only roles missing from the answer (or all of them when it failed) are read per role
    if (unfetchedRoleIds.length >= BULK_POLICY_MIN_ROLES && !signal?.aborted) {
        const tBulk = performance.now();
        const bulk = await fetchAllRolePolicies(client, signal);
        if (bulk.kind === "forbidden") {
            // The user may not read any role's policy: every unfetched role is marked, none is cached, none is read again here
            for (const roleId of unfetchedRoleIds) {
                policyMap.set(roleId, null);
                onPolicyLoaded?.(roleId, null, undefined, true);
            }
            onProgress?.(roleIds.length, roleIds.length);
            Logger.info("PerfTiming", `[5] policies: not readable with the current access (403), ${unfetchedRoleIds.length} roles marked, ${Math.round(performance.now() - tBulk)}ms`);
            return policyMap;
        }
        if (bulk.kind === "read") {
            const missing: string[] = [];
            for (const roleId of unfetchedRoleIds) {
                const policy = bulk.policies.get(roleId);
                if (policy) {
                    policyCache.set(roleId, policy);
                    policyMap.set(roleId, policy);
                    onPolicyLoaded?.(roleId, policy);
                } else {
                    missing.push(roleId);
                }
            }
            Logger.info("PerfTiming", `[5] policies in one call: ${Math.round(performance.now() - tBulk)}ms | ${bulk.policies.size} returned, ${unfetchedRoleIds.length - missing.length}/${unfetchedRoleIds.length} roles matched, ${missing.length} read per role`);
            unfetchedRoleIds.splice(0, unfetchedRoleIds.length, ...missing);
            onProgress?.(roleIds.length - missing.length, roleIds.length);
        }
    }
    if (unfetchedRoleIds.length === 0) {
        savePolicyCacheToStorage();
        onProgress?.(roleIds.length, roleIds.length);
        return policyMap;
    }

    // One role: a successful answer (a policy, or a verified "none") is cached, a failure never is, so the next load asks again.
    // A 403 is an answer about the access: the role is marked and returns without an error, so the pool never retries it.
    const fetchPolicyOnce = async (roleId: string): Promise<PimPolicyAssignment | null> => {
        const tCall = performance.now();
        try {
            // v1.0 is available for roleManagementPolicyAssignments
            const response = await withRetry(
                () => client
                    .api(PIM_URLS.roleManagementPolicyAssignments)
                    .version("v1.0")
                    .filter(`scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq '${roleId}'`)
                    .expand('policy($expand=rules)')
                    .header('Accept-Language', GRAPH_LOCALE)
                    .get(),
                3, 1000, 'concurrentFetchPolicies'
            );
            callLatencies.push(performance.now() - tCall);

            if (response.value?.length > 0) {
                const policy = response.value[0];
                policyCache.set(roleId, policy);
                policyMap.set(roleId, policy);
                // Notify caller that policy is loaded (for progressive UI updates)
                onPolicyLoaded?.(roleId, policy);
                return policy;
            }

            policyCache.set(roleId, null); // Graph answered: this role has no policy assignment
            return null;
        } catch (error: unknown) {
            callLatencies.push(performance.now() - tCall);
            if (!isForbiddenRead(error)) throw error;
            onPolicyLoaded?.(roleId, null, undefined, true);
            return null;
        }
    };

    const failedRoleIds: string[] = [];
    const runPass = (items: string[], workers: number, pause: number) => runWorkerPool<string, PimPolicyAssignment | null>({
        items,
        workerCount: workers,
        delayMs: pause,
        signal,
        // Derived from Learn (a request costs 1, `$expand` adds 1); Graph publishes no cost for roleManagementPolicyAssignments, so 2 is not measured
        costPerItem: 2,
        processor: fetchPolicyOnce,
        onItemError: (roleId, message) => {
            failedRoleIds.push(roleId);
            onPolicyLoaded?.(roleId, null, message); // Report the failure; a later pass can still fix it
        },
        onProgress: (current) => {
            // Adjust progress to include cached items
            if (items === unfetchedRoleIds) onProgress?.(roleIds.length - unfetchedRoleIds.length + current, roleIds.length);
        },
        rateLimiter: graphRateLimiter
    });

    await runPass(unfetchedRoleIds, concurrency, delayMs);

    // Second chance: what failed after every retry is asked again, slowly, once the tenant has had a pause
    if (failedRoleIds.length > 0 && !signal?.aborted) {
        const retryIds = failedRoleIds.splice(0);
        Logger.warn("PolicyFetch", `${retryIds.length} policies failed, trying them again at a slower pace`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!signal?.aborted) await runPass(retryIds, 3, 500);
        if (failedRoleIds.length > 0) Logger.error("PolicyFetch", `${failedRoleIds.length} policies could not be loaded`);
    }

    // Persist cache to SessionStorage after batch completion
    savePolicyCacheToStorage();

    const totalMs = Math.round(performance.now() - tPoolStart);
    if (callLatencies.length > 0) {
        const sorted = [...callLatencies].sort((a, b) => a - b);
        const avg = Math.round(sorted.reduce((s, n) => s + n, 0) / sorted.length);
        const p50 = Math.round(sorted[Math.floor(sorted.length * 0.5)]);
        const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)]);
        const max = Math.round(sorted[sorted.length - 1]);
        Logger.info("PerfTiming",
            `[5] policy worker pool: ${totalMs}ms wall-clock | ${callLatencies.length} calls, ${concurrency} workers, ${delayMs}ms delay | latency avg=${avg}ms p50=${p50}ms p95=${p95}ms max=${max}ms`);
    } else {
        Logger.info("PerfTiming", `[5] policy worker pool: ${totalMs}ms (no calls made)`);
    }

    Logger.debug('DirectoryRoleService', `Completed fetching policies: ${policyMap.size}/${roleIds.length} resolved`);
    return policyMap;
}

/**
 * Resolve approvers from primary approvers list using Graph API $batch
 * Optimized: Batches up to 20 requests per batch call (Graph API limit)
 * Performance: 150 individual calls → 8 batch calls (90% reduction)
 */
async function resolveApprovers(client: Client, primaryApprovers: PrimaryApprover[]): Promise<Approver[]> {
    if (!primaryApprovers || primaryApprovers.length === 0) return [];

    const approvers: Approver[] = [];
    const uncachedApprovers: Array<{ approver: PrimaryApprover; id: string; type: string }> = [];

    // Step 1: Check cache and separate cached vs uncached
    for (const approver of primaryApprovers) {
        const type = approver["@odata.type"];
        const id = approver.id || approver.groupId || approver.userId;

        // Handle manager type (no API call needed)
        if (type === "#microsoft.graph.requestorManager") {
            approvers.push({
                ...approver,
                id: "manager", // Use placeholder ID for manager type
                displayName: "Manager",
                type: "manager"
            });
            continue;
        }

        // Skip entries without valid ID
        if (!id) {
            continue;
        }

        // Check cache
        if (approverCache.has(id)) {
            approvers.push(approverCache.get(id)!);
            continue;
        }

        // Queue for batch resolution
        uncachedApprovers.push({ approver, id, type });
    }

    // Step 2: If all cached, return early
    if (uncachedApprovers.length === 0) {
        return approvers;
    }

    // Step 3: Batch resolve uncached approvers (max 20 per batch - Graph API limit)
    const BATCH_SIZE = 20;
    for (let i = 0; i < uncachedApprovers.length; i += BATCH_SIZE) {
        const batch = uncachedApprovers.slice(i, i + BATCH_SIZE);

        // Build batch request
        const batchRequests = batch.map((item, index) => {
            const endpoint = item.type === "#microsoft.graph.singleUser"
                ? `/users/${item.id}?$select=id,displayName,userPrincipalName,mail`
                : `/groups/${item.id}?$select=id,displayName,mail`;

            return {
                id: String(index),
                method: "GET",
                url: endpoint,
                headers: {
                    "Accept-Language": GRAPH_LOCALE
                }
            };
        });

        try {
            const batchResponse = await withRetry(
                () => client
                    .api("/$batch")
                    .post({ requests: batchRequests }),
                3, 1000, 'resolveApprovers:batch'
            );

            // Process batch responses
            for (const response of batchResponse.responses) {
                const index = parseInt(response.id);
                const item = batch[index];

                if (response.status === 200 && response.body) {
                    const isUser = item.type === "#microsoft.graph.singleUser";
                    const resolved: Approver = {
                        ...item.approver,
                        id: item.id, // Ensure id is always set
                        displayName: response.body.displayName,
                        userPrincipalName: isUser ? response.body.userPrincipalName : undefined,
                        mail: response.body.mail,
                        type: isUser ? "user" : "group"
                    };

                    approverCache.set(item.id, resolved);
                    approvers.push(resolved);
                } else {
                    // Handle failed individual request in batch
                    Logger.warn('DirectoryRoleService', `Batch request failed for ${item.id}: ${response.status}`);
                    approvers.push({
                        ...item.approver,
                        id: item.id, // Ensure id is always set
                        displayName: `Unknown (${item.id})`,
                        type: item.type === "#microsoft.graph.singleUser" ? "user" : "group"
                    });
                }
            }
        } catch (error) {
            // Fallback: If batch fails entirely, resolve individually
            Logger.warn('DirectoryRoleService', 'Batch request failed, falling back to individual resolution', error);
            for (const item of batch) {
                try {
                    const resolved = await resolveApprover(client, item.approver);
                    if (resolved) {
                        approvers.push(resolved);
                    }
                } catch {
                    approvers.push({
                        ...item.approver,
                        id: item.id, // Ensure id is always set
                        displayName: `Unknown (${item.id})`,
                        type: item.type === "#microsoft.graph.singleUser" ? "user" : "group"
                    });
                }
            }
        }

        // Add small delay between batches to avoid throttling
        if (i + BATCH_SIZE < uncachedApprovers.length) {
            await delay(100);
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
async function resolveApprover(client: Client, approver: PrimaryApprover): Promise<Approver | null> {
    const type = approver["@odata.type"];
    // Try to find the ID property (it might be 'id' or 'groupId' depending on API version/type)
    const id = approver.id || approver.groupId || approver.userId;

    // Handle manager type
    if (type === "#microsoft.graph.requestorManager") {
        return {
            ...approver,
            id: "manager",
            displayName: "Manager",
            type: "manager"
        };
    }

    if (!id) {
        return null; // Skip invalid entries silently
    }

    // Check cache
    if (approverCache.has(id)) {
        return approverCache.get(id)!;
    }

    let result: Approver | null = null;

    try {
        if (type === "#microsoft.graph.singleUser") {
            const user: Principal = await withRetry(
                () => client
                    .api(`/users/${id}`)
                    .header("Accept-Language", GRAPH_LOCALE)
                    .select("id,displayName,userPrincipalName,mail")
                    .get(),
                3, 1000, 'resolveApprovers:fallback:user'
            );

            result = {
                ...approver,
                id, // Ensure id is always set
                displayName: user.displayName,
                userPrincipalName: user.userPrincipalName,
                mail: user.mail,
                type: "user"
            };
        } else if (type === "#microsoft.graph.groupMembers") {
            const group = await withRetry(
                () => client
                    .api(`/groups/${id}`)
                    .header("Accept-Language", GRAPH_LOCALE)
                    .select("id,displayName,mail")
                    .get(),
                3, 1000, 'resolveApprovers:fallback:group'
            );

            result = {
                ...approver,
                id, // Ensure id is always set
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
    policyRules?: PimPolicyRule[]
): Promise<Approver[]> {
    if (!policyRules) return [];

    const approvalRules = policyRules.filter((rule) =>
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
    Logger.info("DirectoryRoleService", "Fetching all roles (Optimized/Deferred Policies)...");
    clearPolicyCache();
    return fetchRoleDefinitionsAndAssignments(client, onProgress, signal);
}

/**
 * Fast phase only: role definitions + all assignment schedules, scope-enriched,
 * with `policy: null` on every role. Does NOT touch the policy cache, so a smart
 * refresh can re-read assignments while keeping already-loaded policies.
 */
export async function fetchRoleDefinitionsAndAssignments(
    client: Client,
    onProgress?: (current: number, total: number, status: string) => void,
    signal?: AbortSignal,
    /** userType of principals read on an earlier load; only ids missing here are looked up again */
    knownUserTypes?: Map<string, string>
): Promise<RoleDetailData[]> {
    const tStart = performance.now();
    const phase = (label: string, since: number) =>
        Logger.info("PerfTiming", `${label}: ${Math.round(performance.now() - since)}ms (total ${Math.round(performance.now() - tStart)}ms)`);

    try {
        // Step 1: Fetch role definitions
        onProgress?.(10, 100, "Fetching role definitions...");

        if (signal?.aborted) throw new Error("Aborted");

        const tDef = performance.now();
        const definitions = await getRoleDefinitions(client);
        phase(`[1] roleDefinitions (${definitions.length} roles)`, tDef);

        onProgress?.(30, 100, `Found ${definitions.length} roles. Fetching assignments...`);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 2: Parallel fetch for Assignment Data
        // Promise.all over a fixed set of differently-typed calls, not a runWorkerPool candidate.
        // The rate limiter in rateLimiter.ts handles throttling at the Graph call level.
        const tBulk = performance.now();
        const [assignments, eligibilities, assignmentSchedules, scheduleInstances] = await Promise.all([
            fetchAllPages<RoleAssignment>(client, PIM_URLS.roleAssignments, {
                version: "v1.0",
                expand: "principal",
                select: "id,roleDefinitionId,principalId,directoryScopeId"
            }),
            fetchAllPages<PimEligibilitySchedule>(client, PIM_URLS.roleEligibilitySchedules, {
                version: "v1.0",
                expand: "principal",
                select: "id,roleDefinitionId,principalId,directoryScopeId,scheduleInfo,status"
            }),
            // principal is expanded like the eligibilities (documented on unifiedRoleAssignmentSchedule), so an app or a
            // group that only holds an active assignment is known by its @odata.type, and its name is there too
            fetchAllPages<PimAssignmentSchedule>(client, PIM_URLS.roleAssignmentSchedules, {
                version: "v1.0",
                expand: "principal",
                select: "id,roleDefinitionId,principalId,directoryScopeId,scheduleInfo,assignmentType"
            }),
            // memberType Group on an instance means the activation came through a group (Report spec 5.6); a failed read
            // leaves the page list short, which fetchAllPages logs, and no activation is marked
            fetchAllPages<PimScheduleInstance>(client, PIM_URLS.roleAssignmentScheduleInstances, {
                version: "v1.0",
                select: "id,principalId,roleDefinitionId,memberType,assignmentType,roleAssignmentScheduleId"
            })
        ]);
        phase(`[2] bulk schedules (assignments=${assignments.length}, eligibilities=${eligibilities.length}, schedules=${assignmentSchedules.length})`, tBulk);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 3: Enrich with Scope Info, shared cache across the three lists
        onProgress?.(50, 100, "Enriching scope information (Optimized)...");

        const tScope = performance.now();
        const sharedScopeCache = new Map<string, ScopeInfo>();
        const enrichedAssignments = await enrichAssignmentsWithScope(client, assignments, sharedScopeCache);
        const enrichedEligibilities = await enrichAssignmentsWithScope(client, eligibilities, sharedScopeCache);
        const enrichedSchedules = markSchedulesViaGroup(await enrichAssignmentsWithScope(client, assignmentSchedules, sharedScopeCache), getViaGroupScheduleIds(scheduleInstances));
        phase(`[3] scope enrichment (${sharedScopeCache.size} unique scopes)`, tScope);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 3b: userType (Member or Guest) of every user that holds a role, for the guest counts.
        // The type is stored on the assignments, so it is cached with the role data. Failures are non-fatal.
        onProgress?.(60, 100, "Reading user types...");
        const tUsers = performance.now();
        let userTypes = new Map<string, string>();
        try {
            const candidates = collectUserCandidateIds([enrichedAssignments, enrichedEligibilities, enrichedSchedules]);
            const known = knownUserTypes ?? new Map<string, string>();
            const unknownIds = candidates.filter(id => !known.has(id));
            const fetched = await fetchUserTypes(client, unknownIds, signal, (current, total) => {
                onProgress?.(60 + Math.round((current / Math.max(total, 1)) * 8), 100, `Reading user types (${current}/${total})...`);
            });
            userTypes = new Map(candidates.filter(id => known.has(id)).map(id => [id, known.get(id) as string]));
            fetched.forEach((type, id) => userTypes.set(id, type));
        } catch (error: unknown) {
            if (signal?.aborted) throw error;
            Logger.warn("directoryRole", "Reading user types failed, guest counts stay unknown:", error);
        }
        phase(`[3b] user types (${userTypes.size} users)`, tUsers);

        if (signal?.aborted) throw new Error("Aborted");

        // Step 4: Map to RoleDetailData
        onProgress?.(70, 100, "Processing roles...");

        const tMap = performance.now();
        const roles: RoleDetailData[] = definitions.map(def => {
            return {
                definition: def,
                assignments: {
                    permanent: applyUserTypes(enrichedAssignments.filter(a => a.roleDefinitionId === def.id), userTypes),
                    eligible: applyUserTypes(enrichedEligibilities.filter(e => e.roleDefinitionId === def.id), userTypes),
                    active: applyUserTypes(enrichedSchedules.filter(s => s.roleDefinitionId === def.id), userTypes)
                },
                policy: null
            };
        });
        phase(`[4] map to RoleDetailData`, tMap);

        Logger.info("DirectoryRoleService", `Processed ${roles.length} roles. Starting background policy fetch...`);
        Logger.info("PerfTiming", `[SUMMARY] bulk-fetch phase complete in ${Math.round(performance.now() - tStart)}ms`);

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
 * Reads `userType` (Member or Guest) for the given principal ids with
 * GET /v1.0/users?$filter=id in (...)&$select=id,userType, at most 15 ids per request (the default limit of `in`).
 * Runs through the worker pool with the default 8 workers and 300 ms delay. `User.Read.All` is in the login scopes.
 * A failed request is logged and leaves its users out; the caller treats a missing type as unknown.
 */
export async function fetchUserTypes(
    client: Client,
    userIds: string[],
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void
): Promise<Map<string, string>> {
    const userTypes = new Map<string, string>();
    if (userIds.length === 0) return userTypes;

    await runWorkerPool<string[], { id: string; userType?: string }[]>({
        items: chunkArray(userIds, USER_ID_CHUNK_SIZE),
        workerCount: 8,
        delayMs: 300,
        signal,
        rateLimiter: graphRateLimiter,
        onProgress,
        processor: async (ids) => {
            const response = await withRetry(
                () => client.api("/users").version("v1.0").filter(buildUserIdFilter(ids)).select("id,userType").get(),
                3, 1000, "fetchUserTypes"
            );
            return (response.value ?? []) as { id: string; userType?: string }[];
        },
        onItemComplete: (_ids, users) => {
            for (const user of users) {
                if (user.userType) userTypes.set(user.id, user.userType);
            }
        },
        onItemError: (ids, error) => {
            Logger.warn("directoryRole", `Could not read userType for ${ids.length} user(s): ${error}`);
        }
    });

    return userTypes;
}

/**
 * Smart refresh of Directory Roles: re-read the fast phase (definitions and every
 * assignment schedule, a handful of paged calls) and carry the loaded policies over
 * from `currentData`, so the Report keeps showing them while the caller reads every
 * policy again in the background. Graph has no delta for PIM assignments or policies
 * (`/directoryRoles/delta` reports activated role objects only), so a setting changed
 * in Entra only shows once it is read again.
 *
 * The policy cache is emptied, so the background read asks Graph and not the cache.
 */
export async function refreshRoleAssignments(
    client: Client,
    currentData: RoleDetailData[],
    onProgress?: ProgressCallback,
    signal?: AbortSignal
): Promise<RoleDetailData[]> {
    Logger.debug("SmartSync", `Refreshing assignments for ${currentData.length} roles`);

    const previousById = new Map(currentData.map(r => [r.definition.id, r]));
    const freshRoles = await fetchRoleDefinitionsAndAssignments(client, onProgress, signal, collectKnownUserTypes(currentData));

    clearPolicyCache();
    return freshRoles.map(role => {
        const previous = previousById.get(role.definition.id);
        return previous && previous.policy !== undefined
            ? { ...role, policy: previous.policy, configError: previous.configError }
            : role;
    });
}
