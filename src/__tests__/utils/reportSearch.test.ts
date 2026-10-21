import { describe, expect, it } from "vitest";
import { combineMarking, getSearchMarking, parseSearchTerm, searchGroups, searchRoles } from "@/utils/reportSearch";
import { endsLater, group, role, user } from "../fixtures/dashboardFilterFixtures";

const named = (id: string, name: string, upn: string) => ({ id: `s-${id}`, principalId: id, principal: { ...user(id), displayName: name, userPrincipalName: upn }, ...endsLater });

describe("searchRoles", () => {
    const roles = [
        role({ id: "r1", name: "Global Administrator", eligible: [named("u1", "Anna de Vries", "anna@contoso.com")], active: [named("u2", "Bram Janssen", "bram@contoso.com")] }),
        role({ id: "r2", name: "Helpdesk Administrator", eligible: [named("u3", "Anna Smit", "asmit@contoso.com")] }),
        role({ id: "r3", name: "Reader" }),
    ];

    it("returns every role for an empty term", () => {
        expect(searchRoles(roles, "  ").map((h) => h.role.definition.id)).toEqual(["r1", "r2", "r3"]);
        expect(searchRoles(roles, null)).toHaveLength(3);
    });

    it("matches the role name, case-insensitively", () => {
        const hits = searchRoles(roles, "ADMINISTRATOR");
        expect(hits.map((h) => h.role.definition.id)).toEqual(["r1", "r2"]);
        expect(hits.every((h) => h.isNameMatch)).toBe(true);
    });

    it("keeps a role for a person and names the matching schedules", () => {
        const hits = searchRoles(roles, "anna");
        expect(hits.map((h) => [h.role.definition.id, [...h.assignmentIds]])).toEqual([["r1", ["s-u1"]], ["r2", ["s-u3"]]]);
        expect(hits.every((h) => !h.isNameMatch)).toBe(true);
    });

    it("matches the UPN and needs every word in the same text", () => {
        expect(searchRoles(roles, "bram@contoso").map((h) => h.role.definition.id)).toEqual(["r1"]);
        expect(searchRoles(roles, "anna vries").map((h) => h.role.definition.id)).toEqual(["r1"]);
        expect(searchRoles(roles, "anna janssen")).toEqual([]);
    });
});

describe("searchGroups", () => {
    const under = group("Helpdesk Tier 1", [{ principalId: "u1", principal: { ...user("u1"), displayName: "Anna de Vries" } as never }]);
    const outside = group("Tier 0 Admins", [], false);

    it("matches a group name and a person in its assignments", () => {
        expect(searchGroups([under, outside], "tier").map((h) => h.data.group.id)).toEqual(["Helpdesk Tier 1", "Tier 0 Admins"]);
        const hits = searchGroups([under, outside], "anna");
        expect(hits.map((h) => h.data.group.id)).toEqual(["Helpdesk Tier 1"]);
        expect(hits[0].assignmentIds.size).toBe(1);
    });

    it("finds a person among the members read on demand", () => {
        const members = new Map([["Tier 0 Admins", [{ id: "U9", displayName: "Bram Janssen", userPrincipalName: "bram@contoso.com", kind: "user" as const }]]]);
        const hits = searchGroups([under, outside], "bram", members);
        expect(hits.map((h) => h.data.group.id)).toEqual(["Tier 0 Admins"]);
        expect([...hits[0].memberIds]).toEqual(["u9"]);
        expect(searchGroups([under, outside], "bram")).toEqual([]);
    });
});

describe("parseSearchTerm", () => {
    it("lower-cases and splits on white space", () => {
        expect(parseSearchTerm("  Anna   DE vries ")).toEqual(["anna", "de", "vries"]);
        expect(parseSearchTerm(undefined)).toEqual([]);
    });
});

describe("search marking (spec 6.3 and 7.6)", () => {
    const roles = [
        role({ id: "r1", name: "Global Administrator", eligible: [named("u1", "Anna de Vries", "anna@contoso.com"), named("u2", "Bram Janssen", "bram@contoso.com")] }),
    ];

    it("marks the rows of the person a search found", () => {
        expect([...(getSearchMarking(searchRoles(roles, "anna")[0]) ?? [])]).toEqual(["s-u1"]);
    });

    it("marks nothing without a search, or when the role's own name matched", () => {
        expect(getSearchMarking(searchRoles(roles, "")[0])).toBeNull();
        expect(getSearchMarking(searchRoles(roles, "global")[0])).toBeNull();
        expect(getSearchMarking(undefined)).toBeNull();
    });

    it("combines filter and search marks: a row needs both, one side alone is that side", () => {
        expect(combineMarking(null, null)).toBeNull();
        expect([...(combineMarking(new Set(["a"]), null) ?? [])]).toEqual(["a"]);
        expect([...(combineMarking(null, new Set(["b"])) ?? [])]).toEqual(["b"]);
        expect([...(combineMarking(new Set(["a", "b"]), new Set(["b", "c"])) ?? [])]).toEqual(["b"]);
    });
});
