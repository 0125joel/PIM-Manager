import { describe, expect, it } from "vitest";
import { getRolesHeldByGroup, getRolesHeldByGroups } from "@/utils/groupsOutsidePim";
import { endsLater, groupPrincipal, noEnd, role, user } from "../fixtures/dashboardFilterFixtures";

describe("getRolesHeldByGroup", () => {
    const roles = [
        role({
            id: "r1",
            name: "Helpdesk Administrator",
            isPrivileged: false,
            eligible: [{ id: "e1", principalId: "G1", principal: groupPrincipal("G1"), ...endsLater, scopeInfo: { type: "tenant" } }, { id: "e2", principalId: "u1", principal: user("u1"), ...noEnd }],
        }),
        role({
            id: "r2",
            name: "Exchange Administrator",
            isPrivileged: true,
            active: [{ id: "a1", principalId: "g1", principal: groupPrincipal("g1"), assignmentType: "Assigned", ...noEnd }],
            permanent: [{ id: "p1", principalId: "g1" }],
        }),
        role({ id: "r3", name: "Reader", eligible: [{ id: "e3", principalId: "other", ...noEnd }] }),
    ];

    it("lists every schedule whose principal is the group, compared case-insensitively, sorted by role name", () => {
        const held = getRolesHeldByGroup(roles, "g1");
        expect(held.map((h) => [h.roleName, h.kind, h.scheduleId])).toEqual([
            ["Exchange Administrator", "active", "a1"],
            ["Exchange Administrator", "permanent", "p1"],
            ["Helpdesk Administrator", "eligible", "e1"],
        ]);
    });

    it("carries privileged, end and scope", () => {
        const held = getRolesHeldByGroup(roles, "g1");
        expect(held[0]).toMatchObject({ roleId: "r2", isPrivileged: true, hasNoEnd: true });
        expect(held[2]).toMatchObject({ roleId: "r1", isPrivileged: false, hasNoEnd: false, endDateTime: "2027-01-01T00:00:00Z", scope: { type: "tenant" } });
    });

    it("is empty for a group that holds nothing", () => {
        expect(getRolesHeldByGroup(roles, "nobody")).toEqual([]);
    });
});

describe("getRolesHeldByGroups", () => {
    it("reads many groups in one pass and keys them by lower-case id", () => {
        const roles = [
            role({ id: "r1", name: "B role", eligible: [{ id: "e1", principalId: "G1" }, { id: "e2", principalId: "g2" }] }),
            role({ id: "r2", name: "A role", active: [{ id: "a1", principalId: "g1", assignmentType: "Assigned", ...noEnd }] }),
        ];
        const held = getRolesHeldByGroups(roles, ["G1", "g2", "g3"]);
        expect([...held.keys()].sort()).toEqual(["g1", "g2"]);
        expect(held.get("g1")?.map((h) => h.roleName)).toEqual(["A role", "B role"]);
        expect(getRolesHeldByGroups(roles, []).size).toBe(0);
    });
});
