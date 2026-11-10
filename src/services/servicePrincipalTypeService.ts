import type { Client } from "@microsoft/microsoft-graph-client";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { escapeODataString } from "@/utils/odataUtils";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { chunkArray, USER_ID_CHUNK_SIZE } from "@/utils/userTypeUtils";
import { runWorkerPool } from "@/utils/workerPool";

/**
 * The Graph reads behind the principals of Azure role assignments. ARM only says `ServicePrincipal`, and it keeps the
 * type and name of a deleted user for a while, so Graph tells the kind of each service principal (`Application`,
 * `ManagedIdentity`, ...) and which users and groups still exist. Read only. Permissions: `Application.Read.All`,
 * `User.Read.All` (covers `User.ReadBasic.All`, which `/users` with `$select=id` needs) and `Group.Read.All`, all
 * already in `loginRequest` (`src/config/authConfig.ts`).
 */

/** Object ids are GUIDs. Anything else is not asked: it cannot change the filter, and it counts as not found */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DirectoryItem {
    id: string;
    servicePrincipalType?: string;
}

/**
 * The items Graph returns for these ids, read with `id in (...)`. Ids go in chunks of 15 (measured 2026-10-24: 16
 * values answer 400 on `/servicePrincipals`). One failed chunk makes the whole call throw: a partial answer would show
 * wrong kinds, or existing accounts as deleted.
 */
async function readByIds(client: Client, path: "/servicePrincipals" | "/users" | "/groups", select: string, ids: readonly string[], signal?: AbortSignal): Promise<DirectoryItem[]> {
    const items: DirectoryItem[] = [];
    const distinct = [...new Set(ids.map((id) => id.toLowerCase()))].filter((id) => GUID.test(id));
    let failure: unknown = null;
    await runWorkerPool<string[], DirectoryItem[]>({
        items: chunkArray(distinct, USER_ID_CHUNK_SIZE),
        workerCount: 4,
        delayMs: 300,
        signal,
        rateLimiter: graphRateLimiter,
        costPerItem: 1,
        // The processor logs status and code itself; the pool logs no message either
        errorLog: "statusAndCode",
        processor: async (chunk) => {
            // The SDK does not encode $filter, so each value is encoded (a GUID comes through unchanged)
            const filter = `id in (${chunk.map((id) => `'${encodeURIComponent(escapeODataString(id))}'`).join(",")})`;
            try {
                const response = await withRetry(() => client.api(path).version("v1.0").filter(filter).select(select).get(), 3, 1000, "azurePrincipal read");
                return (response.value ?? []) as DirectoryItem[];
            } catch (error: unknown) {
                // Status and code only: a Graph message can repeat the filter, and that holds the ids
                Logger.warn("azurePrincipal", `A read of ${path} failed: status ${getErrorStatusCode(error) ?? "unknown"}, code ${getErrorCode(error) ?? "unknown"}`);
                failure ??= error;
                throw error;
            }
        },
        onItemComplete: (_chunk, found) => {
            items.push(...found);
        },
    });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (failure) throw failure;
    return items;
}

/** The `servicePrincipalType` per object id (lowercase); an id Graph does not return is missing from the map */
export async function readServicePrincipalTypes(client: Client, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
    const types = new Map<string, string>();
    for (const item of await readByIds(client, "/servicePrincipals", "id,servicePrincipalType", ids, signal)) {
        if (item.id && item.servicePrincipalType) types.set(item.id.toLowerCase(), item.servicePrincipalType);
    }
    return types;
}

/** The ids (lowercase) of these users or groups that Graph finds in the user's directory; the rest is deleted */
export async function readExistingDirectoryIds(client: Client, path: "/users" | "/groups", ids: readonly string[], signal?: AbortSignal): Promise<Set<string>> {
    const found = new Set<string>();
    for (const item of await readByIds(client, path, "id", ids, signal)) {
        if (item.id) found.add(item.id.toLowerCase());
    }
    return found;
}
