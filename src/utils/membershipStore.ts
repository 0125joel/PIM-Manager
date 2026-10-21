import type { GroupMembership } from "@/types/groupMembership.types";
import { describeLoadFailure, getErrorStatusCode } from "@/utils/errorUtils";

/**
 * The page's cache of group members and owners (Report spec 5.3): read on demand for the selected group, kept per group
 * for the life of the page, dropped when the workload is read again (Refresh). A plain external store, read by
 * `useGroupMembership` with `useSyncExternalStore`, so a result that arrives after the page moved on lands in the cache
 * and never in a component that is gone.
 */

export type MembershipEntry =
    | { status: "loading" }
    | { status: "ready"; data: GroupMembership }
    | { status: "error"; message: string; statusCode?: number };

export type MembershipFetcher = (groupId: string, signal: AbortSignal) => Promise<GroupMembership>;

export interface MembershipStore {
    get: (groupId: string) => MembershipEntry | undefined;
    /** Reads the group unless it is loading or loaded; an error entry is read again */
    load: (groupId: string, fetcher: MembershipFetcher) => void;
    /** Drops everything when the stamp (the time the groups were read) differs from the last one; aborts reads in flight */
    syncStamp: (stamp: string | undefined) => void;
    clear: () => void;
    subscribe: (listener: () => void) => () => void;
    /** Changes with every update, for `useSyncExternalStore` */
    getVersion: () => number;
}

/** The sentence under a failed read; a 403 says what is missing instead of a bare status. */
export function describeMembershipFailure(error: unknown): string {
    if (getErrorStatusCode(error) === 403) {
        return "Microsoft Graph did not allow reading the members and owners of this group (403). The signed-in account needs permission to read group members.";
    }
    return describeLoadFailure(error);
}

export function createMembershipStore(): MembershipStore {
    let entries = new Map<string, MembershipEntry>();
    let controller = new AbortController();
    let version = 0;
    let stamp: string | undefined;
    const listeners = new Set<() => void>();

    const notify = () => {
        version++;
        listeners.forEach((listener) => listener());
    };

    return {
        get: (groupId) => entries.get(groupId),
        getVersion: () => version,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        load(groupId, fetcher) {
            const existing = entries.get(groupId);
            if (existing && existing.status !== "error") return;
            const generation = controller;
            const signal = generation.signal;
            entries.set(groupId, { status: "loading" });
            notify();
            fetcher(groupId, signal).then(
                (data) => {
                    // The stamp changed or the store was cleared while this read ran: its answer is old
                    if (signal.aborted || controller !== generation) return;
                    entries.set(groupId, { status: "ready", data });
                    notify();
                },
                (error: unknown) => {
                    if (signal.aborted || controller !== generation) return;
                    entries.set(groupId, { status: "error", message: describeMembershipFailure(error), statusCode: getErrorStatusCode(error) });
                    notify();
                }
            );
        },
        syncStamp(next) {
            if (next === stamp) return;
            const hadEntries = entries.size > 0;
            stamp = next;
            if (hadEntries) this.clear();
        },
        clear() {
            controller.abort();
            controller = new AbortController();
            entries = new Map();
            notify();
        },
    };
}
