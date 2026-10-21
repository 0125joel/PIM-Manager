import { describe, expect, it } from "vitest";
import { getViaGroupScheduleIds, markSchedulesViaGroup, resolveActivationGroup } from "@/utils/viaGroup";
import { applyDashboardFilterToRoles } from "@/utils/dashboardFilter";
import { computeHasAccess } from "@/utils/dashboardAdvanced";
import { endsLater, group, groupPrincipal, role, user } from "../fixtures/dashboardFilterFixtures";

describe("getViaGroupScheduleIds and markSchedulesViaGroup", () => {
    it("collects the schedules that an instance with memberType Group points at, case-insensitively", () => {
        const ids = getViaGroupScheduleIds([
            { memberType: "Group", roleAssignmentScheduleId: "s1" },
            { memberType: "group", roleAssignmentScheduleId: "s2" },
            { memberType: "Direct", roleAssignmentScheduleId: "s3" },
            { memberType: "Group" },
        ]);
        expect([...ids].sort()).toEqual(["s1", "s2"]);
    });

    it("marks only those schedules and returns the list itself when nothing is marked", () => {
        const schedules = [{ id: "s1" }, { id: "s3" }];
        expect(markSchedulesViaGroup(schedules, new Set())).toBe(schedules);
        expect(markSchedulesViaGroup(schedules, new Set(["s1"]))).toEqual([{ id: "s1", viaGroup: true }, { id: "s3" }]);
    });
});

describe("resolveActivationGroup", () => {
    const helpdesk = role({ id: "r1", name: "Helpdesk", eligible: [{ id: "e1", principalId: "G1", principal: groupPrincipal("G1") }, { id: "e2", principalId: "G2", principal: groupPrincipal("G2") }] });
    const memberOf = (id: string, who: string[]) => group(id, who.map((principalId) => ({ principalId, accessType: "member" as const, assignmentType: "eligible" as const })));

    it("names the group when exactly one eligible group has the user as a member", () => {
        const result = resolveActivationGroup(helpdesk, "u1", [memberOf("g1", ["U1"]), memberOf("g2", ["u9"])]);
        expect(result).toMatchObject({ status: "one", group: { id: "g1" } });
    });

    it("leaves the group unnamed with none or several candidates", () => {
        expect(resolveActivationGroup(helpdesk, "u1", [memberOf("g1", ["u9"]), memberOf("g2", [])]).status).toBe("none");
        const several = resolveActivationGroup(helpdesk, "u1", [memberOf("g1", ["u1"]), memberOf("g2", ["u1"])]);
        expect(several.status).toBe("several");
        expect(several.status === "several" && several.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
    });

    it("ignores a group that does not hold the role eligibly, and an owner", () => {
        const other = role({ id: "r2", eligible: [] });
        expect(resolveActivationGroup(other, "u1", [memberOf("g1", ["u1"])]).status).toBe("none");
        const owner = group("g1", [{ principalId: "u1", accessType: "owner", assignmentType: "eligible" }]);
        expect(resolveActivationGroup(helpdesk, "u1", [owner]).status).toBe("none");
    });

    it("uses members read on demand for groups the PIM data does not cover", () => {
        const outside = group("g1", [], false);
        const known = new Map([["g1", new Set(["u1"])]]);
        expect(resolveActivationGroup(helpdesk, "U1", [outside], known)).toMatchObject({ status: "one", group: { id: "g1" } });
        expect(resolveActivationGroup(helpdesk, "u1", [outside]).status).toBe("none");
    });
});

describe("the dashboard counts an activation through a group as through a group (spec 5.6)", () => {
    const activated = role({ id: "act", active: [{ id: "s1", principalId: "u1", principal: user("u1"), assignmentType: "Activated", viaGroup: true, ...endsLater }] });
    const direct = role({ id: "dir", active: [{ id: "s2", principalId: "u2", principal: user("u2"), assignmentType: "Activated", ...endsLater }] });

    it("via:group and via:direct read viaGroup", () => {
        expect(applyDashboardFilterToRoles([activated, direct], { via: "group" }).map((r) => r.definition.id)).toEqual(["act"]);
        expect(applyDashboardFilterToRoles([activated, direct], { via: "direct" }).map((r) => r.definition.id)).toEqual(["dir"]);
    });

    it("Direct or through a group moves the activation to through a group and counts no extra group", () => {
        const access = computeHasAccess([activated, direct], []);
        expect(access.viaGroup).toBe(1);
        expect(access.direct).toBe(1);
        expect(access.groupsHoldingRoles).toBe(0);
    });
});
