"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchGroupMembersAndOwners, type GroupMembershipPrincipal } from "@/services/groupMembershipService";
import { createMembershipStore, type MembershipEntry } from "@/utils/membershipStore";
import { useUnifiedActions, useUnifiedData } from "@/contexts/UnifiedPimContext";
import type { GroupMembersLookup } from "@/utils/auditNoActivation";

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

/**
 * The members of several groups, for the No activation view of the Audit page: the groups a role is eligible for. They
 * share the cache above, so a group read for the Report is not read again. The groups are read one after the other (the
 * next starts when the last has answered), through the same rate limiter as every other read, never in a fan-out. A group
 * that failed is not read again by itself; Refresh of the groups clears the cache. Pass an empty list to read nothing.
 */
export function useGroupsMembership(groupIds: readonly string[]): ReadonlyMap<string, GroupMembersLookup> {
    const { getGraphClient } = useUnifiedActions();
    const lastFetched = useUnifiedData().workloads.pimGroups.lastFetched;
    const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
    const fetcher = useCallback(async (id: string, signal: AbortSignal) => fetchGroupMembersAndOwners(await getGraphClient(), id, signal), [getGraphClient]);
    const key = [...new Set(groupIds.map((id) => id.toLowerCase()))].sort().join("|");

    useEffect(() => {
        store.syncStamp(lastFetched);
    }, [lastFetched]);

    useEffect(() => {
        const ids = key === "" ? [] : key.split("|");
        if (ids.some((id) => store.get(id)?.status === "loading")) return;
        const next = ids.find((id) => store.get(id) === undefined);
        if (next) store.load(next, fetcher);
    }, [key, version, fetcher, lastFetched]);

    return useMemo(() => {
        const result = new Map<string, GroupMembersLookup>();
        for (const id of key === "" ? [] : key.split("|")) {
            const entry = store.get(id);
            if (entry?.status === "ready") result.set(id, { status: "ready", members: entry.data.members });
            else if (entry?.status === "error") result.set(id, { status: "error" });
            else result.set(id, { status: "loading" });
        }
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` changes with every update of the store
    }, [key, version]);
}
