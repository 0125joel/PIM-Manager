import { describe, expect, it } from "vitest";
import { buildFilterSentence, buildWhoAnnotation, computeCards, computeEasyToMiss, formatNameList, unavailableCards, computeTerms, computeWho, getAskForMfaCount, getEffectiveDashboardFilter, type DashboardStatsInput } from "@/utils/dashboardStats";
import { applyDashboardFilterToGroups, applyDashboardFilterToRoles, buildNameById, filterAppliesToGroups, narrowAssignmentsToFilter, parseDashboardFilter } from "@/utils/dashboardFilter";
import { EMERGENCY_ACCOUNT_IDS, buildFixtureGroups, buildFixtureRoles } from "../fixtures/dashboardBasicFixture";
import { agent, agentUser, app, noEnd, policy, role } from "../fixtures/dashboardFilterFixtures";

const roles = buildFixtureRoles();
const allGroups = buildFixtureGroups();
const managed = allGroups.filter((g) => g.isManaged !== false);
const emergencyAccountIds = new Set<string>(EMERGENCY_ACCOUNT_IDS);

function input(overrides: Partial<DashboardStatsInput> = {}): DashboardStatsInput {
    return {
        roles,
        groups: managed,
        allRoles: roles,
        allGroups,
        isDirectoryRolesCounted: true,
        isGroupsCounted: true,
        isUnmanagedCounted: true,
        isFiltered: false,
        filterAppliesToGroups: true,
        policiesLoading: false,
        emergencyAccountIds,
        ...overrides,
    };
}

describe("computeCards on the basic fixture (basic-light.png)", () => {
    const cards = computeCards(input());

    it("reproduces the eight card numbers", () => {
        expect(cards.rolesAndGroups).toMatchObject({ value: "154", breakdown: "130 roles · 24 groups" });
        expect(cards.activeNow).toMatchObject({ value: "17", breakdown: "11 roles · 6 groups" });
        expect(cards.permanent).toMatchObject({ value: "17", breakdown: "13 roles · 4 groups", isWarning: true });
        expect(cards.eligible).toMatchObject({ value: "138", breakdown: "86 roles · 52 groups" });
        expect(cards.privileged).toMatchObject({ value: "33", breakdown: "of 130 directory roles" });
        expect(cards.requireApproval).toMatchObject({ value: "5", breakdown: "of 33 privileged" });
        expect(cards.customRoles).toMatchObject({ value: "4", breakdown: "2 with assignments" });
        expect(cards.groupsUnderPim).toMatchObject({ value: "89%", breakdown: "24 of 27 role-assignable groups" });
    });
});

describe("computeWho and computeTerms on the basic fixture", () => {
    it("reproduces the Who donut", () => {
        const who = computeWho(input());
        expect(who).toEqual({ permanent: 17, eligible: 138, activeTimeBound: 17, total: 172, emergencyPermanent: 2 });
        expect(buildWhoAnnotation(who, false)).toBe("17 permanent, 2 of them emergency access. The number you want to see go down.");
    });

    it("leaves out the emergency clause when none is marked", () => {
        const who = computeWho(input({ emergencyAccountIds: new Set() }));
        expect(buildWhoAnnotation(who, false)).toBe("17 permanent. The number you want to see go down.");
    });

    it("reproduces the Terms donut", () => {
        const terms = computeTerms(input());
        expect(terms).toMatchObject({ roleCount: 33, entraMfa: 19, authContext: 7, neither: 7, approval: 5, justification: 31, overEightHours: 3, isPending: false });
        expect(getAskForMfaCount(terms)).toBe(26);
    });
});

describe("chips and states", () => {
    it("counts only the workloads that are on", () => {
        const onlyRoles = computeCards(input({ isGroupsCounted: false }));
        expect(onlyRoles.rolesAndGroups).toMatchObject({ value: "130", breakdown: "130 roles" });
        expect(onlyRoles.groupsUnderPim.value).toBe("-");

        const onlyGroups = computeCards(input({ isDirectoryRolesCounted: false }));
        expect(onlyGroups.rolesAndGroups).toMatchObject({ value: "24", breakdown: "24 groups" });
        expect(onlyGroups.privileged.value).toBe("-");
        expect(computeWho(input({ isDirectoryRolesCounted: false })).eligible).toBe(52);
    });

    it("needs the unmanaged groups for the groups under PIM card", () => {
        expect(computeCards(input({ isUnmanagedCounted: false })).groupsUnderPim).toMatchObject({ value: "-", breakdown: "unmanaged groups not counted" });
    });

    it("shows a placeholder, never 0, while policies are arriving", () => {
        const unloaded = roles.map((r) => (r.definition.isPrivileged ? { ...r, policy: null } : r));
        const cards = computeCards(input({ roles: unloaded, allRoles: unloaded, policiesLoading: true }));
        expect(cards.requireApproval.value).toBeNull();
        expect(computeTerms(input({ roles: unloaded, allRoles: unloaded, policiesLoading: true })).isPending).toBe(true);
        // The numbers that need no policy stay final
        expect(cards.privileged.value).toBe("33");
    });

    it("counts only the loaded policies once loading is over", () => {
        const some = roles.map((r, i) => (i === 0 ? { ...r, policy: null } : r));
        const terms = computeTerms(input({ roles: some, allRoles: some }));
        expect(terms.isPending).toBe(false);
        expect(terms.entraMfa + terms.authContext + terms.neither).toBe(32);
        expect(terms.roleCount).toBe(33);
    });

    it("shows a dash when Graph does not report isPrivileged", () => {
        const unreported = [role({ id: "a", policy: policy({}) }), role({ id: "b", policy: policy({}) })];
        const cards = computeCards(input({ roles: unreported, allRoles: unreported, groups: [], allGroups: [] }));
        expect(cards.privileged).toMatchObject({ value: "-", breakdown: "not reported by Graph" });
        expect(cards.requireApproval.value).toBe("-");
    });

    it("counts every role as privileged with the All roles scope", () => {
        const cards = computeCards(input({ scope: "all" }));
        expect(cards.privileged.value).toBe("130");
        expect(cards.requireApproval.breakdown).toBe("of 130 roles");
    });
});

describe("effective filter and sentence", () => {
    it("adds the privileged scope to an activation term only", () => {
        expect(getEffectiveDashboardFilter(parseDashboardFilter("mfa:neither"))).toEqual({ mfa: "neither", privileged: true });
        expect(getEffectiveDashboardFilter(parseDashboardFilter("mfa:neither,privileged:false"))).toEqual({ mfa: "neither", privileged: false });
        expect(getEffectiveDashboardFilter(parseDashboardFilter("assignment:permanent"))).toEqual({ assignment: "permanent" });
    });

    it("words the count", () => {
        expect(buildFilterSentence(7, 33, "privileged roles", false)).toBe("7 of 33 privileged roles. Blocks about groups and alerts are not affected.");
        expect(buildFilterSentence(40, 154, "roles and groups", true)).toBe("40 of 154 roles and groups.");
    });
});

describe("a filtered dashboard (basic-filtered.png)", () => {
    const filter = getEffectiveDashboardFilter(parseDashboardFilter("mfa:neither"));
    const filteredRoles = applyDashboardFilterToRoles(roles, filter);
    const filtered = input({ roles: filteredRoles, groups: applyDashboardFilterToGroups(managed, filter), isFiltered: true, filterAppliesToGroups: filterAppliesToGroups(filter) });

    it("counts the roles that stay and says groups are not affected", () => {
        const cards = computeCards(filtered);
        expect(filteredRoles).toHaveLength(7);
        expect(cards.rolesAndGroups).toMatchObject({ value: "7", breakdown: "roles, groups not affected" });
        expect(cards.privileged).toMatchObject({ value: "7", breakdown: "of 33 privileged" });
        expect(cards.requireApproval.breakdown).toBe("of 7 roles");
        expect(cards.groupsUnderPim.value).toBe("89%");
        expect(cards.activeNow.breakdown).toMatch(/^\d+ roles?$/);
        expect(buildWhoAnnotation(computeWho(filtered), true)).toBe("Directory roles only, groups are not affected by this filter.");
    });

    it("keeps groups in a filter that groups can answer", () => {
        const f = parseDashboardFilter("assignment:eligible");
        const cards = computeCards(input({ roles: applyDashboardFilterToRoles(roles, f), groups: applyDashboardFilterToGroups(managed, f), isFiltered: true, filterAppliesToGroups: filterAppliesToGroups(f) }));
        expect(cards.eligible.breakdown).toContain("groups");
    });
});

describe("donut arcs", () => {
    it("separates segments with a gap and leaves an empty ring empty", async () => {
        const { getDonutArcs } = await import("@/components/charts/Donut");
        const arcs = getDonutArcs([1, 1]);
        expect(arcs[0].start).toBe(0);
        expect(arcs[1].start).toBeCloseTo(Math.PI * 52);
        expect(arcs[0].length).toBeCloseTo(Math.PI * 52 - 3);
        expect(getDonutArcs([5, 0])[0].length).toBeCloseTo(2 * Math.PI * 52);
        expect(getDonutArcs([0, 0]).every((a) => a.length === 0)).toBe(true);
    });
});

describe("computeEasyToMiss on the basic fixture (basic-light.png)", () => {
    const rows = computeEasyToMiss(input());
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    it("reproduces the seven numbers and detail lines", () => {
        expect(rows.map((r) => [r.id, r.count])).toEqual([
            ["permanentGlobalAdmins", 2],
            ["eligibleWithoutEnd", 23],
            ["apps", 3],
            ["agents", 0],
            ["guests", 2],
            ["nobodyNotified", 6],
            ["onlyPermanent", 2],
        ]);
        expect(byId.permanentGlobalAdmins.detail).toBe("Megan Bowen, Adele Vance. The 2 emergency access accounts are not counted.");
        expect(byId.agents.detail).toBe("None");
        expect(byId.guests.detail).toBe("Accounts from another tenant.");
    });

    it("the card numbers still hold with the same data", () => {
        const cards = computeCards(input());
        expect(cards.permanent.value).toBe("17");
        expect(cards.eligible.value).toBe("138");
        expect(cards.customRoles.breakdown).toBe("2 with assignments");
    });

    it("says None and sets filters that find the same roles", () => {
        const empty = computeEasyToMiss(input({ roles: [], groups: [], allRoles: [] }));
        expect(empty.every((r) => r.count === 0 && r.detail === "None")).toBe(true);
        // A row's filter lists the roles the row counts: only permanent members
        const onlyPermanent = applyDashboardFilterToRoles(roles, byId.onlyPermanent.filter, { emergencyAccountIds });
        expect(onlyPermanent).toHaveLength(2);
        const guests = applyDashboardFilterToRoles(roles, byId.guests.filter);
        expect(guests).toHaveLength(2);
        const ga = applyDashboardFilterToRoles(roles, byId.permanentGlobalAdmins.filter, { emergencyAccountIds });
        expect(ga).toHaveLength(1);
    });

    it("leaves the notification row pending while policies arrive and lists three names then a rest", () => {
        const unloaded = roles.map((r) => ({ ...r, policy: null }));
        expect(computeEasyToMiss(input({ roles: unloaded, allRoles: unloaded, policiesLoading: true })).find((r) => r.id === "nobodyNotified")?.count).toBeNull();
        expect(formatNameList(["a", "b", "c", "d", "e"])).toBe("a, b, c, +2");
    });
});

describe("Easy to miss wording and parity", () => {
    it("singularises the emergency sentence and counts distinct accounts", () => {
        const one = computeEasyToMiss(input({ emergencyAccountIds: new Set([EMERGENCY_ACCOUNT_IDS[0]]) }));
        expect(one[0].detail).toContain("The 1 emergency access account is not counted.");
        // The second emergency account is a plain person now, so the count rises by one
        expect(one[0].count).toBe(3);
    });

    it("says None with the emergency sentence when only emergency accounts hold the role", () => {
        const gaOnly = roles.filter((r) => r.definition.templateId).map((r) => ({ ...r, assignments: { ...r.assignments, active: r.assignments.active.filter((a) => (EMERGENCY_ACCOUNT_IDS as readonly string[]).includes(a.principalId)) } }));
        const row = computeEasyToMiss(input({ roles: gaOnly, allRoles: gaOnly })).find((r) => r.id === "permanentGlobalAdmins");
        expect(row).toMatchObject({ count: 0, detail: "None. The 2 emergency access accounts are not counted." });
    });

    it("filters for apps, eligible without end and nobody notified list the roles that carry them", () => {
        const rows = computeEasyToMiss(input());
        const filter = (id: string) => rows.find((r) => r.id === id)!.filter;
        expect(applyDashboardFilterToRoles(roles, filter("apps"))).toHaveLength(3);
        expect(applyDashboardFilterToRoles(roles, filter("eligibleWithoutEnd"))).toHaveLength(23);
        expect(applyDashboardFilterToRoles(roles, filter("nobodyNotified"))).toHaveLength(6);
    });
});

describe("a role whose policy is not readable is not counted as a setting (FIX-12)", () => {
    const forbid = (pick: (r: (typeof roles)[number]) => boolean) => roles.map((r) => (pick(r) ? { ...r, policy: null, policiesForbidden: true } : r));

    it("no readable privileged role: the approval card says so instead of 0", () => {
        const none = forbid((r) => r.definition.isPrivileged === true);
        expect(computeCards(input({ roles: none, allRoles: none })).requireApproval).toMatchObject({ value: "-", breakdown: "settings not readable" });
        expect(computeTerms(input({ roles: none, allRoles: none }))).toMatchObject({ roleCount: 0, entraMfa: 0, neither: 0 });
    });

    it("some not readable: the approval card and Terms count the readable ones", () => {
        const first = roles.find((r) => r.definition.isPrivileged === true && r.policy)!;
        const some = forbid((r) => r === first);
        expect(computeCards(input({ roles: some, allRoles: some })).requireApproval.breakdown).toBe("of 32 privileged");
        expect(computeTerms(input({ roles: some, allRoles: some })).roleCount).toBe(32);
    });
});

describe("failed loads are unknown, not zero", () => {
    it("shows a dash on every card when the roles failed", () => {
        const cards = unavailableCards("not loaded");
        expect(Object.values(cards).every((c) => c.value === "-" && c.breakdown === "not loaded")).toBe(true);
    });

    it("says the groups are missing when PIM for Groups failed", () => {
        const cards = computeCards(input({ groups: [], allGroups: [], isGroupsUnavailable: true }));
        expect(cards.rolesAndGroups.breakdown).toBe("130 roles · groups not loaded");
        expect(cards.groupsUnderPim).toMatchObject({ value: "-", breakdown: "PIM for Groups not loaded" });
    });
});

describe("a filter on assignments narrows every number to those assignments", () => {
    it("counts only permanent assignments after a click on Permanent", () => {
        const filter = parseDashboardFilter("assignment:permanent");
        const filteredRoles = applyDashboardFilterToRoles(roles, filter, { emergencyAccountIds });
        const filteredGroups = applyDashboardFilterToGroups(managed, filter, { emergencyAccountIds });
        const narrowed = narrowAssignmentsToFilter(filteredRoles, filteredGroups, filter, { emergencyAccountIds });
        const who = computeWho(input({ roles: narrowed.roles, groups: narrowed.groups, isFiltered: true }));
        expect(who).toMatchObject({ permanent: 17, eligible: 0, activeTimeBound: 0 });
        const cards = computeCards(input({ roles: narrowed.roles, groups: narrowed.groups, isFiltered: true }));
        expect(cards.permanent.value).toBe("17");
        expect(cards.eligible.value).toBe("0");
    });

    it("leaves the data alone without an assignment key", () => {
        const filter = parseDashboardFilter("mfa:neither");
        expect(narrowAssignmentsToFilter(roles, managed, filter).roles).toBe(roles);
    });

    it("finds a name from another list when the active schedule has none", () => {
        const named = buildNameById(roles);
        expect(named.get("00000000-0000-4000-8000-000000003900".toLowerCase())).toBe("Megan Bowen");
    });
});

describe("an app that only holds an active role", () => {
    it("is known as an app from the expanded principal of the active schedule", () => {
        const only = role({ id: "r-app", isPrivileged: true, active: [{ principalId: "sp1", principal: { ...app("sp1"), displayName: "Deploy bot" }, assignmentType: "Assigned", ...noEnd }] });
        const rows = computeEasyToMiss(input({ roles: [only], allRoles: [only], groups: [] }));
        expect(rows.find((r) => r.id === "apps")?.count).toBe(1);
        expect(applyDashboardFilterToRoles([only], { principalType: "servicePrincipal" })).toHaveLength(1);
        expect(buildNameById([only]).get("sp1")).toBe("Deploy bot");
    });
});

describe("agents in Easy to miss", () => {
    const agentIdentityRole = role({ id: "agent-identity-role", isPrivileged: false, active: [{ principalId: "agent-identity", principal: agent("agent-identity"), assignmentType: "Assigned", ...noEnd }] });
    const agentUserRole = role({ id: "agent-user-role", isPrivileged: false, active: [{ principalId: "agent-user", principal: agentUser("agent-user"), assignmentType: "Assigned", ...noEnd }] });
    const agentRoles = [agentIdentityRole, agentUserRole];
    const agentInput = input({ roles: agentRoles, allRoles: agentRoles, groups: [] });

    it("counts unique agent identities and agent users after Apps", () => {
        const rows = computeEasyToMiss(agentInput);
        const row = rows.find((item) => item.id === "agents");
        expect(row).toMatchObject({
            count: 2,
            label: "Agents with a role",
            filter: { principalType: "agent" },
        });
        expect(rows.findIndex((item) => item.id === "agents")).toBe(rows.findIndex((item) => item.id === "apps") + 1);
    });

    it("does not show the Agents row when the chip is off", () => {
        expect(computeEasyToMiss({ ...agentInput, isAgentsCounted: false }).some((row) => row.id === "agents")).toBe(false);
    });

    it("counts a privileged agent as an agent, not an app", () => {
        const privilegedAgent = role({ id: "privileged-agent", isPrivileged: true, active: [{ principalId: "agent-identity", principal: agent("agent-identity"), assignmentType: "Assigned", ...noEnd }] });
        const rows = computeEasyToMiss(input({ roles: [privilegedAgent], allRoles: [privilegedAgent], groups: [] }));
        expect(rows.find((item) => item.id === "agents")?.count).toBe(1);
        expect(rows.find((item) => item.id === "apps")?.count).toBe(0);
    });
});
