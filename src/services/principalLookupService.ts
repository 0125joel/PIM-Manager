import type { Client } from "@microsoft/microsoft-graph-client";
import type { PrincipalRef } from "@/types/configure.types";
import type { PrincipalIndex } from "@/utils/importAssignments";
import { Logger } from "@/utils/logger";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { escapeODataString } from "@/utils/odataUtils";
import { runWorkerPool } from "@/utils/workerPool";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { withRetry } from "@/utils/retryUtils";
import { chunkArray, USER_ID_CHUNK_SIZE } from "@/utils/userTypeUtils";

/**
 * The people of an imported file that the loaded assignments do not name (Import, NG-71): users by exact UPN
 * (`userPrincipalName in (...)`, 15 per request; a refused chunk is asked again per UPN) and by id (users, then groups
 * and service principals for what is no user). Reads only (`User.Read.All`, `Group.Read.All` and `Application.Read.All`
 * are in the login scopes). Whoever is not found is simply not in the answer: the row then says nobody has this id or UPN.
 */
/** Status and code only: a Graph message can repeat the filter, and that holds the UPNs asked for */
function describeError(error: unknown): string {
    return `status ${getErrorStatusCode(error) ?? "unknown"}, code ${getErrorCode(error) ?? "unknown"}`;
}

interface DirectoryObject {
    id: string;
    displayName?: string;
    userPrincipalName?: string;
}

const SELECT = "id,displayName,userPrincipalName";

async function readChunk(client: Client, path: string, filter: string, select: string): Promise<DirectoryObject[]> {
    const response = await withRetry(() => client.api(path).version("v1.0").filter(filter).select(select).get(), 3, 1000, `lookup ${path}`);
    return (response.value ?? []) as DirectoryObject[];
}

const asRef = (kind: PrincipalRef["kind"], o: DirectoryObject): PrincipalRef | null =>
    o.id && o.displayName ? { id: o.id, kind, displayName: o.displayName, ...(o.userPrincipalName ? { userPrincipalName: o.userPrincipalName } : {}) } : null;

export async function lookupPrincipals(client: Client, { ids, upns }: { ids: readonly string[]; upns: readonly string[] }, signal?: AbortSignal): Promise<PrincipalIndex> {
    // A look-up that failed (429 after the retries, network) is not "nobody with this id": it throws, the caller says so and can try again
    let failure: unknown = null;
    const byId = new Map<string, PrincipalRef>();
    const byUpn = new Map<string, PrincipalRef>();
    const keep = (ref: PrincipalRef | null) => {
        if (!ref) return;
        byId.set(ref.id.toLowerCase(), ref);
        if (ref.userPrincipalName) byUpn.set(ref.userPrincipalName.toLowerCase(), ref);
    };

    // Users by UPN
    await runWorkerPool<string[], DirectoryObject[]>({
        items: chunkArray([...upns], USER_ID_CHUNK_SIZE),
        workerCount: 4,
        delayMs: 300,
        signal,
        rateLimiter: graphRateLimiter,
        processor: async (chunk) => {
            // The SDK does not encode $filter: a guest UPN's # (or a & or %) would cut the URL short, so each value is encoded (I-09)
            const filter = `userPrincipalName in (${chunk.map((u) => `'${encodeURIComponent(escapeODataString(u))}'`).join(",")})`;
            try {
                return await readChunk(client, "/users", filter, SELECT);
            } catch (error) {
                Logger.warn("principalLookup", `The UPN filter was refused, asking per UPN: ${describeError(error)}`);
                const found: DirectoryObject[] = [];
                for (const upn of chunk) {
                    try {
                        await graphRateLimiter.acquire(1, signal);
                        found.push((await withRetry(() => client.api(`/users/${encodeURIComponent(upn)}`).version("v1.0").select(SELECT).get(), 3, 1000, "lookup one UPN")) as DirectoryObject);
                    } catch (inner) {
                        // Only "not found" means nobody; anything else is a failed look-up
                        if (getErrorStatusCode(inner) !== 404) throw inner;
                    }
                }
                return found;
            }
        },
        onItemComplete: (_chunk, users) => users.forEach((u) => keep(asRef("user", u))),
        onItemError: (chunk, error) => {
            failure = error;
            Logger.warn("principalLookup", `Could not look up ${chunk.length} UPN(s): ${describeError(error)}`);
        },
    });

    // By id: users first, then groups, then service principals for what is left
    let left = [...ids];
    for (const [path, kind] of [["/users", "user"], ["/groups", "group"], ["/servicePrincipals", "servicePrincipal"]] as const) {
        if (left.length === 0) break;
        await runWorkerPool<string[], DirectoryObject[]>({
            items: chunkArray(left, USER_ID_CHUNK_SIZE),
            workerCount: 4,
            delayMs: 300,
            signal,
            rateLimiter: graphRateLimiter,
            processor: (chunk) => readChunk(client, path, `id in (${chunk.map((id) => `'${escapeODataString(id)}'`).join(",")})`, path === "/users" ? SELECT : "id,displayName"),
            onItemComplete: (_chunk, found) => found.forEach((o) => keep(asRef(kind, o))),
            // A group or application read can be refused without the permission (403): those people stay unknown; anything else failed
            onItemError: (chunk, error) => {
                if (path === "/users" || getErrorStatusCode(error) !== 403) failure = error;
                Logger.warn("principalLookup", `Could not look up ${chunk.length} id(s) in ${path}: ${describeError(error)}`);
            },
        });
        left = left.filter((id) => !byId.has(id.toLowerCase()));
    }
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
    return { byId, byUpn };
}
