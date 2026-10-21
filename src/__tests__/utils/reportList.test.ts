import { describe, expect, it } from "vitest";
import { buildGroupListRow, buildRoleListRow, countGroupAssignments, countRoleAssignments, isReportSort, sortGroups, sortRoles } from "@/utils/reportList";
import { endsLater, group, noEnd, policy, role, user } from "../fixtures/dashboardFilterFixtures";

const eligible = (n: number) => Array.from({ length: n }, (_, i) => ({ principalId: `u${i}`, principal: user(`u${i}`), ...endsLater }));
const permanent = (n: number) => Array.from({ length: n }, (_, i) => ({ principalId: `p${i}`, principal: user(`p${i}`), assignmentType: "Assigned", ...noEnd }));

describe("sortRoles", () => {
    const roles = [
        role({ id: "b", name: "B role", eligible: eligible(1), active: permanent(2) }),
        role({ id: "a", name: "A role", eligible: eligible(3) }),
        role({ id: "c", name: "C role", eligible: eligible(3) }),
        role({ id: "d", name: "D role" }),
    ];

    it("most assignments first, ties by name", () => {
        expect(sortRoles(roles, "assignments").map((r) => r.definition.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("name A to Z", () => {
        expect(sortRoles(roles, "name").map((r) => r.definition.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("most permanent first, ties by name", () => {
        expect(sortRoles(roles, "permanent").map((r) => r.definition.id)).toEqual(["b", "a", "c", "d"]);
    });

    it("does not change the input", () => {
        const copy = [...roles];
        sortRoles(roles, "name");
        expect(roles).toEqual(copy);
    });

    it("counts eligible, active and permanent active", () => {
        expect(countRoleAssignments(roles[0])).toEqual({ eligible: 1, active: 2, permanent: 2 });
    });
});

describe("sortGroups and countGroupAssignments", () => {
    const g1 = group("g1", [{ assignmentType: "eligible" }, { assignmentType: "active" }, { assignmentType: "permanent" }]);
    const g2 = group("g2", [{ assignmentType: "eligible" }]);
    const g3 = group("g0", []);

    it("counts permanent members as active and permanent", () => {
        expect(countGroupAssignments(g1)).toEqual({ eligible: 1, active: 2, permanent: 1 });
    });

    it("sorts like roles", () => {
        expect(sortGroups([g3, g2, g1], "assignments").map((g) => g.group.id)).toEqual(["g1", "g2", "g0"]);
        expect(sortGroups([g1, g2, g3], "name").map((g) => g.group.id)).toEqual(["g0", "g1", "g2"]);
        expect(sortGroups([g3, g2, g1], "permanent").map((g) => g.group.id)).toEqual(["g1", "g0", "g2"]);
    });
});

describe("isReportSort", () => {
    it("accepts the three sorts only", () => {
        expect(isReportSort("name")).toBe(true);
        expect(isReportSort("recent")).toBe(false);
        expect(isReportSort(null)).toBe(false);
    });
});

describe("buildRoleListRow", () => {
    it("flags a privileged role without MFA, never while the policy is unknown", () => {
        const noMfa = role({ id: "a", isPrivileged: true, policy: policy({ mfa: false }) });
        const withMfa = role({ id: "b", isPrivileged: true, policy: policy({ mfa: true }) });
        const withContext = role({ id: "c", isPrivileged: true, policy: policy({ mfa: false, authContext: "c1" }) });
        const notPrivileged = role({ id: "d", policy: policy({ mfa: false }) });
        const unknown = role({ id: "e", isPrivileged: true });
        expect([noMfa, withMfa, withContext, notPrivileged, unknown].map((r) => buildRoleListRow(r).hasNoMfaSignal)).toEqual([true, false, false, false, null]);
    });

    it("counts, tags and permanent active", () => {
        const r = role({ id: "x", name: "Custom one", isBuiltIn: false, isPrivileged: true, eligible: eligible(2), active: permanent(1) });
        expect(buildRoleListRow(r)).toMatchObject({ id: "x", name: "Custom one", isCustom: true, isPrivileged: true, eligible: 2, active: 1, hasPermanentActive: true });
    });
});

describe("buildGroupListRow", () => {
    it("tells outside from under PIM and carries the counts", () => {
        const outside = group("g", [], false);
        outside.memberCount = 7;
        expect(buildGroupListRow(outside, 2)).toMatchObject({ isOutsidePim: true, roleCount: 2, memberCount: 7 });
        expect(buildGroupListRow(group("h", [{ assignmentType: "eligible" }, { assignmentType: "active" }]), 0)).toMatchObject({ isOutsidePim: false, eligible: 1, active: 1 });
    });
});
