import { describe, it, expect } from "vitest";
import { clearPimSessionCaches, isCachedKey } from "@/utils/cacheUtils";

function storage(initial: Record<string, string>) {
    const data = { ...initial };
    return {
        data,
        get length() {
            return Object.keys(data).length;
        },
        key: (i: number) => Object.keys(data)[i] ?? null,
        removeItem: (k: string) => void delete data[k],
    };
}

describe("isCachedKey", () => {
    it("recognises the app's cache keys", () => {
        for (const key of ["pim_data_cache_v2", "pim_groups_timestamp", "etag_cache_abc", "directory_role_policy_cache", "directory_role_policy_timestamp", "pim-custom-extensions", "pim-dismissed-alerts"]) {
            expect(isCachedKey(key), key).toBe(true);
        }
    });
    it("leaves everything else alone", () => {
        for (const key of ["theme", "dashboard-view-mode", "pim-emergency-accounts:t1", "pim-whats-new-seen", "msal.token.keys"]) {
            expect(isCachedKey(key), key).toBe(false);
        }
    });
});

describe("clearPimSessionCaches", () => {
    it("removes only cache keys and counts them", () => {
        const s = storage({ pim_data_cache_v2: "1", etag_cache_x: "2", "pim-dismissed-alerts": "3", "msal.token.keys": "keep", "pim-emergency-accounts:t": "keep" });
        expect(clearPimSessionCaches(s)).toBe(3);
        expect(Object.keys(s.data).sort()).toEqual(["msal.token.keys", "pim-emergency-accounts:t"]);
    });
    it("does nothing without storage and survives a storage that throws", () => {
        expect(clearPimSessionCaches(null)).toBe(0);
        const broken = {
            length: 1,
            key: () => {
                throw new Error("blocked");
            },
            removeItem: () => undefined,
        };
        expect(clearPimSessionCaches(broken)).toBe(0);
    });
});
