import { describe, it, expect } from "vitest";
import { NAV_ITEMS, getInitials, isNavActive, parseOrganizationResponse, shortTenantId, tenantNameCacheKey } from "@/utils/shellNavigation";

describe("isNavActive", () => {
    it("matches the page, a trailing slash and sub-paths", () => {
        expect(isNavActive("/dashboard", "/dashboard")).toBe(true);
        expect(isNavActive("/dashboard/", "/dashboard")).toBe(true);
        expect(isNavActive("/report/anything", "/report")).toBe(true);
    });
    it("never matches a longer sibling or another page", () => {
        expect(isNavActive("/reportx", "/report")).toBe(false);
        expect(isNavActive("/configure", "/report")).toBe(false);
        expect(isNavActive("/", "/dashboard")).toBe(false);
    });
    it("is false without a pathname", () => {
        expect(isNavActive(null, "/dashboard")).toBe(false);
        expect(isNavActive(undefined, "/dashboard")).toBe(false);
    });
    it("has three items with unique tour ids", () => {
        expect(NAV_ITEMS.map((i) => i.path)).toEqual(["/dashboard", "/report", "/configure"]);
        expect(new Set(NAV_ITEMS.map((i) => i.tourId)).size).toBe(3);
    });
});

describe("getInitials", () => {
    it("takes the first letters of the first and last word", () => {
        expect(getInitials("Alex Wilber")).toBe("AW");
        expect(getInitials("  alex   van  wilber ")).toBe("AW");
    });
    it("takes up to two letters of a single word", () => {
        expect(getInitials("Alex")).toBe("AL");
        expect(getInitials("X")).toBe("X");
    });
    it("handles accents and non-Latin letters by code point", () => {
        expect(getInitials("Émile Zola")).toBe("ÉZ");
        expect(getInitials("山田 太郎")).toBe("山太");
    });
    it("falls back to the user principal name", () => {
        expect(getInitials("", "alexw@contoso.com")).toBe("AL");
        expect(getInitials(null, "j.doe@contoso.com")).toBe("JD");
        expect(getInitials(undefined, undefined)).toBe("");
    });
});

describe("tenant helpers", () => {
    it("shortens the id to 8 characters", () => {
        expect(shortTenantId("3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63")).toBe("3f2a91c4");
        expect(shortTenantId("abc")).toBe("abc");
        expect(shortTenantId(undefined)).toBe("");
    });
    it("keys the cache per tenant", () => {
        expect(tenantNameCacheKey("t1")).toBe("pim_tenant_name_t1");
        expect(tenantNameCacheKey("t1")).not.toBe(tenantNameCacheKey("t2"));
    });
});

describe("parseOrganizationResponse", () => {
    it("reads the display name of the signed-in tenant", () => {
        expect(parseOrganizationResponse({ value: [{ id: "t1", displayName: " Contoso " }] }, "t1")).toBe("Contoso");
    });
    it("is null for an empty collection, another tenant, an empty name or garbage", () => {
        expect(parseOrganizationResponse({ value: [] }, "t1")).toBeNull();
        expect(parseOrganizationResponse({ value: [{ id: "t2", displayName: "Other" }] }, "t1")).toBeNull();
        expect(parseOrganizationResponse({ value: [{ id: "t1", displayName: "  " }] }, "t1")).toBeNull();
        expect(parseOrganizationResponse(null, "t1")).toBeNull();
        expect(parseOrganizationResponse({}, "t1")).toBeNull();
    });
});
