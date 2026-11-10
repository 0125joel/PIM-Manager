import { describe, it, expect } from "vitest";
import { AZURE_NAV_ITEMS, NAV_ITEMS, environmentFromPath, getInitials, homePathFor, isNavActive, isNavItemActive, navItemsFor, parseOrganizationResponse, shortTenantId, switchEnvironmentPath, tenantNameCacheKey } from "@/utils/shellNavigation";

describe("environmentFromPath", () => {
    it("is azure for /azure and below", () => {
        expect(environmentFromPath("/azure")).toBe("azure");
        expect(environmentFromPath("/azure/")).toBe("azure");
        expect(environmentFromPath("/azure/report")).toBe("azure");
        expect(environmentFromPath("/azure/configure/")).toBe("azure");
    });
    it("is entra for every other route, a longer sibling and no pathname", () => {
        expect(environmentFromPath("/dashboard")).toBe("entra");
        expect(environmentFromPath("/settings")).toBe("entra");
        expect(environmentFromPath("/azurex")).toBe("entra");
        expect(environmentFromPath("/")).toBe("entra");
        expect(environmentFromPath(null)).toBe("entra");
    });
});

describe("switchEnvironmentPath", () => {
    it("takes an Entra page to the same Azure page, anything else to the Azure dashboard", () => {
        expect(switchEnvironmentPath("/dashboard", "azure")).toBe("/azure");
        expect(switchEnvironmentPath("/report", "azure")).toBe("/azure/report");
        expect(switchEnvironmentPath("/report/", "azure")).toBe("/azure/report");
        expect(switchEnvironmentPath("/configure", "azure")).toBe("/azure/configure");
        expect(switchEnvironmentPath("/settings", "azure")).toBe("/azure");
        expect(switchEnvironmentPath("/help", "azure")).toBe("/azure");
    });
    it("takes an Azure page to the same Entra page, anything else to the dashboard", () => {
        expect(switchEnvironmentPath("/azure", "entra")).toBe("/dashboard");
        expect(switchEnvironmentPath("/azure/", "entra")).toBe("/dashboard");
        expect(switchEnvironmentPath("/azure/report", "entra")).toBe("/report");
        expect(switchEnvironmentPath("/azure/configure", "entra")).toBe("/configure");
        expect(switchEnvironmentPath("/azure/unknown", "entra")).toBe("/dashboard");
    });
    it("returns a path without the query string", () => {
        expect(switchEnvironmentPath("/report", "azure")).not.toContain("?");
    });
});

describe("homePathFor", () => {
    it("takes the wordmark to the dashboard of the current environment", () => {
        expect(homePathFor("entra")).toBe("/dashboard");
        expect(homePathFor("azure")).toBe("/azure");
        expect(homePathFor(environmentFromPath("/azure/report"))).toBe("/azure");
        expect(homePathFor(environmentFromPath("/settings"))).toBe("/dashboard");
    });
});

describe("navigation lists", () => {
    it("has the same three pages under /azure with the same tour ids", () => {
        expect(AZURE_NAV_ITEMS.map((i) => i.path)).toEqual(["/azure", "/azure/report", "/azure/configure"]);
        expect(AZURE_NAV_ITEMS.map((i) => i.name)).toEqual(NAV_ITEMS.map((i) => i.name));
        expect(AZURE_NAV_ITEMS.map((i) => i.tourId)).toEqual(NAV_ITEMS.map((i) => i.tourId));
        expect(navItemsFor("azure")).toBe(AZURE_NAV_ITEMS);
        expect(navItemsFor("entra")).toBe(NAV_ITEMS);
    });
    it("marks the Azure dashboard active on /azure only, not on the pages below it", () => {
        const [dashboard, report] = AZURE_NAV_ITEMS;
        expect(isNavItemActive("/azure", dashboard)).toBe(true);
        expect(isNavItemActive("/azure/", dashboard)).toBe(true);
        expect(isNavItemActive("/azure/report", dashboard)).toBe(false);
        expect(isNavItemActive("/azure/report", report)).toBe(true);
        expect(isNavItemActive(null, dashboard)).toBe(false);
    });
    it("keeps the Entra matching of isNavActive for the Entra items", () => {
        for (const item of NAV_ITEMS) {
            expect(isNavItemActive(item.path, item)).toBe(true);
            expect(isNavItemActive(`${item.path}/x`, item)).toBe(isNavActive(`${item.path}/x`, item.path));
        }
    });
});

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
