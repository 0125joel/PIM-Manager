import { describe, expect, it } from "vitest";
import { applySelect, parseExpand, parseFilter, parseSearch } from "@/demo/graph/odata";

describe("demo OData", () => {
    const item = { id: "1", displayName: "Adele Vance", userPrincipalName: "AdeleV@contoso.com", isAssignableToRole: true, n: 3, scheduleInfo: { expiration: { type: "noExpiration" } } };

    it("filters with eq, ne, in, and, or, not and functions, ignoring case", () => {
        expect(parseFilter("displayName eq 'adele vance'")(item)).toBe(true);
        expect(parseFilter("isAssignableToRole eq true and n ge 3")(item)).toBe(true);
        expect(parseFilter("id in ('2','1')")(item)).toBe(true);
        expect(parseFilter("not (displayName ne 'Adele Vance')")(item)).toBe(true);
        expect(parseFilter("startswith(displayName,'ad') or startswith(userPrincipalName,'x')")(item)).toBe(true);
        expect(parseFilter("scheduleInfo/expiration/type eq 'noExpiration'")(item)).toBe(true);
        expect(parseFilter("displayName eq 'O''Brien'")({ displayName: "O'Brien" })).toBe(true);
    });

    it("rejects what it does not understand, as Graph answers 400", () => {
        expect(() => parseFilter("displayName has 'x'")).toThrow();
        expect(() => parseFilter("displayName eq 'open")).toThrow();
    });

    it("reads nested expands and keeps expanded properties next to a select", () => {
        expect(parseExpand("policy($expand=rules),principal")).toEqual({ policy: "$expand=rules", principal: "" });
        expect(applySelect({ id: "1", a: 1, b: 2, principal: { id: "p" } }, "a", ["principal"])).toEqual({ id: "1", a: 1, principal: { id: "p" } });
    });

    it("searches word prefixes", () => {
        expect(parseSearch('"displayName:van" OR "userPrincipalName:van"')(item)).toBe(true);
        expect(parseSearch('"displayName:ance"')(item)).toBe(false);
    });
});
