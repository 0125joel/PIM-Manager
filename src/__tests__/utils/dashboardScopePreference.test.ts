import { describe, it, expect } from "vitest";
import { readDashboardScope, writeDashboardScope } from "@/utils/dashboardScopePreference";

function fakeStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => {
            map.set(k, v);
        },
    };
}

describe("dashboardScopePreference", () => {
    it("reads privileged from an empty storage", () => {
        expect(readDashboardScope(fakeStorage())).toBe("privileged");
    });

    it("writes all under the default key and reads it back", () => {
        const storage = fakeStorage();
        writeDashboardScope("all", storage);
        expect(readDashboardScope(storage)).toBe("all");
        expect(storage.map.has("dashboard-scope")).toBe(true);
    });

    it("keeps a second key apart from the default key", () => {
        const storage = fakeStorage();
        writeDashboardScope("all", storage, "azure-dashboard-scope");
        expect(readDashboardScope(storage)).toBe("privileged");
        expect(readDashboardScope(storage, "azure-dashboard-scope")).toBe("all");
    });

    it("handles a missing storage without throwing", () => {
        expect(readDashboardScope(null)).toBe("privileged");
        expect(writeDashboardScope("all", null)).toBe(false);
    });
});
