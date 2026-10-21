import { describe, expect, it, vi } from "vitest";
import { createMembershipStore, describeMembershipFailure } from "@/utils/membershipStore";
import type { GroupMembership } from "@/services/groupMembershipService";

const membership = (id: string): GroupMembership => ({ members: [{ id, displayName: id, kind: "user" }], owners: [] });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("membershipStore", () => {
    it("reads a group once and caches it", async () => {
        const store = createMembershipStore();
        const fetcher = vi.fn().mockResolvedValue(membership("m1"));
        store.load("g1", fetcher);
        store.load("g1", fetcher);
        expect(store.get("g1")).toEqual({ status: "loading" });
        await flush();
        expect(store.get("g1")).toEqual({ status: "ready", data: membership("m1") });
        store.load("g1", fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("keeps an error until retried, and reads the group again on load", async () => {
        const store = createMembershipStore();
        const fetcher = vi.fn().mockRejectedValueOnce(Object.assign(new Error("denied"), { statusCode: 403 })).mockResolvedValueOnce(membership("m1"));
        store.load("g1", fetcher);
        await flush();
        expect(store.get("g1")).toMatchObject({ status: "error", statusCode: 403 });
        store.load("g1", fetcher);
        await flush();
        expect(store.get("g1")?.status).toBe("ready");
    });

    it("drops the cache when the stamp changes and ignores an answer that arrives afterwards", async () => {
        const store = createMembershipStore();
        store.syncStamp("t1");
        let resolveSlow: (m: GroupMembership) => void = () => undefined;
        store.load("g1", () => new Promise<GroupMembership>((resolve) => { resolveSlow = resolve; }));
        store.syncStamp("t2");
        expect(store.get("g1")).toBeUndefined();
        resolveSlow(membership("old"));
        await flush();
        expect(store.get("g1")).toBeUndefined();
        store.syncStamp("t2");
        store.load("g1", async () => membership("new"));
        await flush();
        expect(store.get("g1")).toMatchObject({ status: "ready" });
    });

    it("notifies subscribers and bumps the version", async () => {
        const store = createMembershipStore();
        const listener = vi.fn();
        store.subscribe(listener);
        const before = store.getVersion();
        store.load("g1", async () => membership("m1"));
        await flush();
        expect(listener).toHaveBeenCalledTimes(2);
        expect(store.getVersion()).toBe(before + 2);
    });
});

describe("describeMembershipFailure", () => {
    it("says what is missing for a 403 and uses the status for other errors", () => {
        expect(describeMembershipFailure(Object.assign(new Error("x"), { statusCode: 403 }))).toContain("(403)");
        expect(describeMembershipFailure(Object.assign(new Error("x"), { statusCode: 503 }))).toBe("Microsoft Graph answered 503 after 3 tries.");
    });
});
