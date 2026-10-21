"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { fetchGroupMembersAndOwners, type GroupMembershipPrincipal } from "@/services/groupMembershipService";
import { createMembershipStore, type MembershipEntry } from "@/utils/membershipStore";
import { useUnifiedActions, useUnifiedData } from "@/contexts/UnifiedPimContext";

/** One cache for the page: a group is read when it is selected, once, until PIM for Groups is read again. */
const store = createMembershipStore();

export interface GroupMembershipState {
    status: "idle" | MembershipEntry["status"];
    members: GroupMembershipPrincipal[];
    owners: GroupMembershipPrincipal[];
    error?: string;
    retry: () => void;
}

/**
 * Members and owners of the selected group (Report spec 5.3). Pass undefined to read nothing. Reads on demand and
 * caches per group; `retry` reads a failed group again; the cache is cleared when the groups are refreshed.
 */
export function useGroupMembership(groupId: string | undefined): GroupMembershipState {
    const { getGraphClient } = useUnifiedActions();
    const lastFetched = useUnifiedData().workloads.pimGroups.lastFetched;
    useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);

    const fetcher = useCallback(async (id: string, signal: AbortSignal) => fetchGroupMembersAndOwners(await getGraphClient(), id, signal), [getGraphClient]);

    useEffect(() => {
        store.syncStamp(lastFetched);
    }, [lastFetched]);

    useEffect(() => {
        if (groupId) store.load(groupId, fetcher);
    }, [groupId, fetcher, lastFetched]);

    const retry = useCallback(() => {
        if (groupId) store.load(groupId, fetcher);
    }, [groupId, fetcher]);

    const entry = groupId ? store.get(groupId) : undefined;
    return {
        // A selected group with no entry yet is about to load: never report "idle" for it, so a consumer shows its skeleton
        status: entry?.status ?? (groupId ? "loading" : "idle"),
        members: entry?.status === "ready" ? entry.data.members : [],
        owners: entry?.status === "ready" ? entry.data.owners : [],
        error: entry?.status === "error" ? entry.message : undefined,
        retry,
    };
}
