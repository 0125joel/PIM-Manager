import type { Client } from "@microsoft/microsoft-graph-client";
import { getPrincipalKind } from "@/utils/principalUtils";
import type { GroupMembership, GroupMembershipPrincipal } from "@/types/groupMembership.types";
import { withRetry } from "@/utils/retryUtils";
import { graphRateLimiter } from "@/utils/rateLimiter";
import { Logger } from "@/utils/logger";

/**
 * Members and owners of one group, read on demand when a group is selected in the Report (spec 5.3). Beta, because v1.0
 * leaves service principals out of `members`; `Group.Read.All` covers both calls, and in delegated use the signed-in
 * user also needs a role that may read group members and owners (a 403 reaches the caller with its status code).
 * Sources: https://learn.microsoft.com/en-us/graph/api/group-list-members?view=graph-rest-beta and
 * https://learn.microsoft.com/en-us/graph/api/group-list-owners?view=graph-rest-1.0
 */

// Types live in @/types/groupMembership.types, re-exported here for the hook and the page
export type { GroupMembership, GroupMembershipPrincipal } from "@/types/groupMembership.types";

interface GraphDirectoryObject {
    id?: string;
    "@odata.type"?: string;
    displayName?: string | null;
    userPrincipalName?: string | null;
    userType?: string | null;
}

interface GraphPage {
    value?: GraphDirectoryObject[];
    "@odata.nextLink"?: string;
}

const SELECT = "id,displayName,userPrincipalName,userType";
const PAGE_SIZE = 999;
/** Guards against a nextLink cycle (same guard as the other services) */
const MAX_PAGES = 200;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function mapDirectoryObject(raw: GraphDirectoryObject): GroupMembershipPrincipal | null {
    if (!raw.id) return null;
    const principal: GroupMembershipPrincipal = {
        id: raw.id,
        displayName: raw.displayName || raw.userPrincipalName || `Unknown (${raw.id.slice(0, 8)})`,
        kind: getPrincipalKind(raw),
    };
    if (raw.userPrincipalName) principal.userPrincipalName = raw.userPrincipalName;
    if (raw.userType) principal.userType = raw.userType;
    return principal;
}

/** Resource units per page (learn.microsoft.com/graph/throttling-limits): `members` costs 3, `owners` is a plain read; kept high, $select not subtracted */
const RU_COST = { members: 3, owners: 1 } as const;

async function readAll(client: Client, path: "members" | "owners", groupId: string, signal?: AbortSignal): Promise<GroupMembershipPrincipal[]> {
    const result: GroupMembershipPrincipal[] = [];
    const endpoint = `/groups/${groupId}/${path}`;
    // Every attempt pays the shared budget, as in runWorkerPool, so a membership read during the policy phase cannot overrun it
    const paid = <T>(call: () => Promise<T>) => async (): Promise<T> => {
        await graphRateLimiter.acquire(RU_COST[path], signal);
        return call();
    };
    let page: GraphPage = await withRetry(
        paid(() => client.api(endpoint).version("beta").select(SELECT).top(PAGE_SIZE).get()),
        3, 1000, `groupMembership ${path}`
    );
    let pages = 1;
    for (;;) {
        for (const raw of page.value ?? []) {
            const mapped = mapDirectoryObject(raw);
            if (mapped) result.push(mapped);
        }
        const next = page["@odata.nextLink"];
        if (!next) break;
        if (signal?.aborted) throw new Error("Aborted");
        if (pages >= MAX_PAGES) {
            Logger.warn("groupMembership", `Reached MAX_PAGES for ${endpoint}, the list may be incomplete`);
            break;
        }
        pages++;
        await delay(100); // Small pause between pages, as directoryRoleService does
        page = await withRetry(paid(() => client.api(next).get()), 3, 1000, `groupMembership ${path} next`);
    }
    return result;
}

/** Both lists, read one after the other (3 resource units for members, the owners call is cheaper); a failure of either fails the read. */
export async function fetchGroupMembersAndOwners(client: Client, groupId: string, signal?: AbortSignal): Promise<GroupMembership> {
    const members = await readAll(client, "members", groupId, signal);
    if (signal?.aborted) throw new Error("Aborted");
    const owners = await readAll(client, "owners", groupId, signal);
    return { members, owners };
}
