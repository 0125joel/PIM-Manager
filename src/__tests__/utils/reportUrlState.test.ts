import { describe, expect, it } from "vitest";
import { buildReportSearch, parseReportUrlState } from "@/utils/reportUrlState";

describe("parseReportUrlState", () => {
    it("defaults to the roles view with nothing selected", () => {
        expect(parseReportUrlState("")).toEqual({ view: "roles", q: "", filter: {} });
        expect(parseReportUrlState("?")).toEqual({ view: "roles", q: "", filter: {} });
    });

    it("reads view, q, f and the selection of the view", () => {
        const roles = parseReportUrlState("?q=anna&role=abc&f=privileged:true,mfa:neither");
        expect(roles).toEqual({ view: "roles", q: "anna", filter: { privileged: true, mfa: "neither" }, roleId: "abc" });
        const groups = parseReportUrlState("?view=groups&group=g1&role=ignored");
        expect(groups).toEqual({ view: "groups", q: "", filter: {}, groupId: "g1" });
    });

    it("treats an unknown view as roles", () => {
        expect(parseReportUrlState("?view=azure").view).toBe("roles");
    });
});

describe("buildReportSearch", () => {
    it("writes nothing for the default state", () => {
        expect(buildReportSearch({ view: "roles", q: "", filter: {} })).toBe("");
    });

    it("writes the groups view, the search, the selection of its view and f raw", () => {
        expect(buildReportSearch({ view: "groups", q: "tier 0", filter: { principalType: "guest" }, groupId: "g1", roleId: "r1" })).toBe("view=groups&q=tier+0&group=g1&f=principalType:guest");
        expect(buildReportSearch({ view: "roles", q: "", filter: {}, roleId: "r1", groupId: "g1" })).toBe("role=r1");
    });

    it("keeps parameters that are not its own", () => {
        expect(buildReportSearch({ view: "roles", q: "x", filter: {} }, "?utm=1&view=groups&role=old&f=mfa:neither")).toBe("utm=1&q=x");
    });

    it("round-trips every part", () => {
        const state = { view: "groups" as const, q: "a b", filter: { via: "group" as const, noEndDate: true as const }, groupId: "abc-1" };
        expect(parseReportUrlState(buildReportSearch(state))).toEqual(state);
        const roles = { view: "roles" as const, q: "", filter: { privileged: true }, roleId: "r-1" };
        expect(parseReportUrlState(buildReportSearch(roles))).toEqual(roles);
    });
});
