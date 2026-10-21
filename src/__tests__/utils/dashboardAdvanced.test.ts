import { describe, expect, it } from "vitest";
import { getFilterOwnerSection, computeActivationCharts, computeApprovers, computeCustomExtensionRows, computeGroupsSection, computeHasAccess, computeRightNow, computeTopAccounts, daysUntil, formatEndsIn, getRuleApproverKeys } from "@/utils/dashboardAdvanced";
import { computeCards } from "@/utils/dashboardStats";
import { EMERGENCY_ACCOUNT_IDS, KNOWN_EXTENSION_ID, buildFixtureGroups, buildFixtureRoles } from "../fixtures/dashboardBasicFixture";
import { policy, role } from "../fixtures/dashboardFilterFixtures";
import type { PimPolicyRule, RoleDetailData } from "@/types/directoryRole.types";

const roles = buildFixtureRoles();
const groups = buildFixtureGroups();
const managed = groups.filter((g) => g.isManaged !== false);

describe("Has access, and how (advanced-light.png)", () => {
    const access = computeHasAccess(roles, managed);

    it("reproduces the three workload rows", () => {
        expect(access.rows.map((r) => [r.label, r.total])).toEqual([["Directory roles", 110], ["Group members", 48], ["Group owners", 14]]);
        expect(access.rows[0]).toMatchObject({ permanent: 13, eligible: 86, activeTimeBound: 11 });
    });

    it("splits directory role assignments into direct and through 6 groups, adding up to the row total", () => {
        expect(access.viaGroup).toBe(39);
        expect(access.direct).toBe(71);
        expect(access.groupsHoldingRoles).toBe(6);
        expect(access.direct + access.viaGroup).toBe(access.rows[0].total);
    });
});

describe("On activation", () => {
    it("reproduces the four charts for privileged roles", () => {
        const c = computeActivationCharts(roles, "privileged");
        expect(c).toMatchObject({ roleCount: 33, entraMfa: 19, authContext: 7, neither: 7, approvalRequired: 5, approvalNotRequired: 28, justificationRequired: 31, justificationNotRequired: 2, unloaded: 0 });
        expect(c.durations).toEqual({ upTo1h: 4, upTo4h: 9, upTo8h: 17, upTo12h: 2, over12h: 1 });
    });

    it("counts every role with All roles and leaves unloaded policies out of the numbers", () => {
        const all = computeActivationCharts(roles, "all");
        expect(all.roleCount).toBe(130);
        const unloaded = computeActivationCharts(roles.map((r, i) => (i === 0 ? { ...r, policy: null } : r)), "privileged");
        expect(unloaded.unloaded).toBe(1);
        expect(unloaded.entraMfa + unloaded.authContext + unloaded.neither).toBe(32);
    });

    it("counts a role whose policy is not readable apart from one that failed (FIX-12)", () => {
        const c = computeActivationCharts(roles.map((r, i) => (i === 0 ? { ...r, policy: null, policiesForbidden: true } : r)), "privileged");
        expect(c).toMatchObject({ roleCount: 33, notReadable: 1, unloaded: 0 });
        expect(c.entraMfa + c.authContext + c.neither).toBe(32);
    });

    it("leaves the cards 1 to 4, 7 and 8 unchanged by the scope", () => {
        const input = { roles, groups: managed, allRoles: roles, allGroups: groups, isDirectoryRolesCounted: true, isGroupsCounted: true, isUnmanagedCounted: true, isFiltered: false, filterAppliesToGroups: true, policiesLoading: false };
        const a = computeCards({ ...input, scope: "privileged" });
        const b = computeCards({ ...input, scope: "all" });
        for (const id of ["rolesAndGroups", "activeNow", "permanent", "eligible", "customRoles", "groupsUnderPim"] as const) expect(b[id]).toEqual(a[id]);
        expect(b.privileged.value).toBe("130");
    });
});

function extensionRole(name: string, id: string, isEnabled: boolean): RoleDetailData {
    const rule = { id: "CustomExtension_PreApproval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule", isEnabled, customExtensionId: id, displayName: "ServiceNow change check", target: { caller: "EndUser", operations: ["All"], level: "Assignment" } };
    const base = policy({});
    base!.details.rules = [...(base!.details.rules ?? []), rule as unknown as PimPolicyRule];
    return role({ id: name, name, isPrivileged: true, policy: base });
}

describe("custom extensions", () => {
    const linked = [extensionRole("Exchange Administrator", "ext-1", true), extensionRole("User Administrator", "ext-1", true), extensionRole("Helpdesk", "ext-1", false)];

    it("lists one row per extension and stage and names the roles an unknown extension blocks", () => {
        const known = computeCustomExtensionRows(linked, new Set(["ext-1"]));
        expect(known).toHaveLength(1);
        expect(known[0]).toMatchObject({ roleCount: 3, stage: "pre-approval", isNotFound: false, blockedRoles: [] });
        const missing = computeCustomExtensionRows(linked, new Set());
        expect(missing[0]).toMatchObject({ isNotFound: true, blockedRoles: ["Exchange Administrator", "User Administrator"] });
        // The tenant list could not be read: nothing is called missing
        expect(computeCustomExtensionRows(linked, null)[0].isNotFound).toBe(false);
        expect(computeCustomExtensionRows([role({ id: "x", policy: policy({}) })], new Set())).toEqual([]);
    });
});

describe("PIM for Groups section", () => {
    const section = computeGroupsSection(groups);
    it("lists the groups outside PIM and the busiest managed groups", () => {
        expect(section.outside).toHaveLength(3);
        expect(section.outside[0].type).toBe("security");
        expect(section.managedCount).toBe(24);
        expect(section.topManaged).toHaveLength(5);
        expect(section.topManaged[0].total).toBeGreaterThanOrEqual(section.topManaged[4].total);
        expect(section.topManaged[0]).toMatchObject({ membersEligible: expect.any(Number), ownersEligible: expect.any(Number) });
    });
});

describe("Most privileged, and who approves", () => {
    it("ranks accounts by distinct roles, tags emergency accounts and leaves groups out", () => {
        const rows = computeTopAccounts(roles, "privileged", new Set<string>(EMERGENCY_ACCOUNT_IDS));
        expect(rows).toHaveLength(6);
        expect(rows.every((r) => r.kind !== "group")).toBe(true);
        expect(rows.every((r, i) => i === 0 || rows[i - 1].privilegedRoles >= r.privilegedRoles)).toBe(true);
        const emergency = computeTopAccounts(roles, "privileged", new Set<string>(EMERGENCY_ACCOUNT_IDS), 100).filter((r) => r.isEmergency);
        expect(emergency).toHaveLength(2);
    });

    function approvalRole(name: string, approvers: Record<string, string>[]): RoleDetailData {
        const base = role({ id: name, name, isPrivileged: true, policy: policy({ approval: true }) });
        const rule = base.policy!.details.rules!.find((r) => r.id === "Approval_EndUser_Assignment")!;
        (rule.setting as unknown as { approvalStages: unknown[] }).approvalStages = [{ primaryApprovers: approvers }];
        base.policy!.approvers = approvers.filter((a) => a.userId).map((a) => ({ id: a.userId, displayName: a.name, "@odata.type": "#microsoft.graph.singleUser" })) as never;
        return base;
    }

    it("reads approvers from the rule, counts roles per approver and warns about a single approver", () => {
        const a = approvalRole("Global Administrator", [{ "@odata.type": "#microsoft.graph.singleUser", userId: "U1", name: "Nestor Wilke" }]);
        const b = approvalRole("Exchange Administrator", [{ "@odata.type": "#microsoft.graph.singleUser", userId: "U1", name: "Nestor Wilke" }, { "@odata.type": "#microsoft.graph.groupMembers", groupId: "G1" }]);
        expect(getRuleApproverKeys(b)).toEqual(["user:u1", "group:g1"]);
        const summary = computeApprovers([a, b, role({ id: "n", isPrivileged: true, policy: policy({}) })], "privileged");
        expect(summary.requiringApproval).toBe(2);
        expect(summary.approvers[0]).toMatchObject({ name: "Nestor Wilke", roleCount: 2 });
        expect(summary.singleApproverRoles).toEqual([{ role: "Global Administrator", approver: "Nestor Wilke" }]);
        expect(computeApprovers([a], "privileged").requiringApproval).toBe(1);
        expect(computeApprovers([], "privileged")).toMatchObject({ approvers: [], singleApproverRoles: [], requiringApproval: 0 });
    });
});

describe("Right now", () => {
    it("lists activations that end soon and eligibilities ending within 7 days, soonest first", () => {
        const now = new Date();
        const r = computeRightNow(roles, groups, now);
        expect(r.activatedCount).toBe(17);
        expect(r.activated).toHaveLength(4);
        expect(r.activated.map((x) => x.msLeft)).toEqual([...r.activated.map((x) => x.msLeft)].sort((a, b) => a - b));
        expect(r.endingCount).toBe(3);
        expect(daysUntil(r.ending[0].msLeft)).toBe(2);
    });

    it("formats the time left", () => {
        expect(formatEndsIn(30 * 60000)).toBe("30 min");
        expect(formatEndsIn(60 * 60000)).toBe("1 h");
        expect(formatEndsIn(5 * 3600000)).toBe("5 h");
        expect(formatEndsIn(50 * 3600000)).toBe("2 days");
        expect(formatEndsIn(1000)).toBe("1 min");
        expect(daysUntil(2 * 86400000 - 3600000)).toBe(2);
        expect(daysUntil(2 * 86400000 + 1)).toBe(3);
    });
});

describe("custom extensions on the fixture", () => {
    it("lists the linked extension and the one the tenant does not have", () => {
        const rows = computeCustomExtensionRows(roles.filter((r) => r.definition.isPrivileged), new Set([KNOWN_EXTENSION_ID]));
        expect(rows.map((r) => [r.name, r.roleCount, r.isNotFound])).toEqual([["ServiceNow change check", 4, false], ["Legacy approval flow", 1, true]]);
        expect(rows[1].blockedRoles).toEqual(["User Administrator"]);
    });
});

describe("PIM for Groups activations are facts, not an approximation", () => {
    it("Active now and Right now count only activated instances; an assigned one with an end is time-bound", () => {
        const now = new Date("2026-10-01T12:00:00Z");
        const end = "2026-10-01T15:00:00Z";
        const base = managed[0];
        const data = { ...base, assignments: [
            { id: "x1", groupId: base.group.id, principalId: "p-activated", accessType: "member" as const, assignmentType: "active" as const, assignmentOrigin: "activated" as const, endDateTime: end },
            { id: "x2", groupId: base.group.id, principalId: "p-assigned", accessType: "member" as const, assignmentType: "active" as const, assignmentOrigin: "assigned" as const, endDateTime: end },
        ] };
        const right = computeRightNow([], [data], now);
        expect(right.activated.map((r) => r.principalId)).toEqual(["p-activated"]);
        const cards = computeCards({ roles: [], groups: [data], allRoles: [], allGroups: [data], isDirectoryRolesCounted: false, isGroupsCounted: true, isUnmanagedCounted: true, isFiltered: false, filterAppliesToGroups: true, policiesLoading: false });
        expect(cards.activeNow.value).toBe("1");
        expect(computeHasAccess([], [data]).rows[1].activeTimeBound).toBe(2);
    });
});

describe("getFilterOwnerSection", () => {
    it("names the section whose own rows set the filter, so it stays undimmed", () => {
        expect(getFilterOwnerSection({ via: "group" })).toBe("access");
        expect(getFilterOwnerSection({ assignment: "eligible" })).toBe("access");
        expect(getFilterOwnerSection({ mfa: "neither" })).toBe("activation");
        expect(getFilterOwnerSection({ maxDuration: "upTo12h" })).toBe("activation");
        expect(getFilterOwnerSection({ customExtension: "ext-1" })).toBe("activation");
    });

    it("has no owner for filters no section sets, or for several keys", () => {
        expect(getFilterOwnerSection({ assignment: "active" })).toBeNull();
        expect(getFilterOwnerSection({ customRole: true })).toBeNull();
        expect(getFilterOwnerSection({ maxDuration: "over8h" })).toBeNull();
        expect(getFilterOwnerSection({ privileged: true, assignment: "permanent", hasEligible: false })).toBeNull();
        expect(getFilterOwnerSection({})).toBeNull();
    });
});
