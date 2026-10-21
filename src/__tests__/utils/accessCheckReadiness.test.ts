import { describe, expect, it } from "vitest";
import { isAccessCheckReady } from "@/utils/accessCheckReadiness";

describe("isAccessCheckReady (FIX-13)", () => {
    it("waits while the roles are read for the first time, with nothing loaded yet", () => {
        expect(isAccessCheckReady({ phase: "fetching", loadedRoles: 0 })).toBe(false);
        expect(isAccessCheckReady({ phase: "idle", loadedRoles: 0 })).toBe(false);
    });

    it("starts once the fast phase has the roles, while the policies are still arriving", () => {
        expect(isAccessCheckReady({ phase: "processing", loadedRoles: 146 })).toBe(true);
    });

    it("starts from a cache hit (idle with roles) and once the roles are complete or failed", () => {
        expect(isAccessCheckReady({ phase: "idle", loadedRoles: 146 })).toBe(true);
        expect(isAccessCheckReady({ phase: "complete", loadedRoles: 146 })).toBe(true);
        expect(isAccessCheckReady({ phase: "error", loadedRoles: 0 })).toBe(true);
    });

    it("does not start while a read of the roles replaces what is shown, or while consent is pending", () => {
        expect(isAccessCheckReady({ phase: "fetching", loadedRoles: 146 })).toBe(false);
        expect(isAccessCheckReady({ phase: "consent", loadedRoles: 146 })).toBe(false);
    });
});
