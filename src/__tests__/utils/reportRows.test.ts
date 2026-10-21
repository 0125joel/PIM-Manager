import { describe, expect, it } from "vitest";
import { buildGroupAssignmentRows, buildRolesHeldRows, buildMembershipRows, buildRoleAssignmentRows, describeScopeTag, type RowContext } from "@/utils/reportRows";
import { buildReportGroups, buildReportRoles, PEOPLE, REPORT_EMERGENCY_IDS } from "../fixtures/reportFixture";
import { getRolesHeldByGroup } from "@/utils/groupsOutsidePim";
import { agent, agentBase, agentUser, blueprint, endsLater, group, groupPrincipal, noEnd, role, user } from "../fixtures/dashboardFilterFixtures";

const ctx = (overrides: Partial<RowContext> = {}): RowContext => ({ groups: [], emergencyAccountIds: new Set(), marking: null, ...overrides });

describe("buildRoleAssignmentRows: the Global Administrator of the fixture", () => {
    const roles = buildReportRoles();
    const ga = roles[0];
    const rows = buildRoleAssignmentRows(ga, ctx({ groups: buildReportGroups(), emergencyAccountIds: new Set(REPORT_EMERGENCY_IDS) }));

    it("lists three eligible and two active rows", () => {
        expect(rows.eligible.map((r) => [r.name, r.kind])).toEqual([["Anna de Vries", "user"], ["Bram Janssen", "user"], ["Tier 0 Admins", "group"]]);
        expect(rows.active.map((r) => r.name)).toEqual(["Break glass 01", "Break glass 02"]);
        expect(rows.total).toBe(5);
    });

    it("tells the end: expires, permanent for an assigned active without end", () => {
        expect(rows.eligible[0].end).toEqual({ type: "expires", date: "2027-03-14T00:00:00Z" });
        expect(rows.active[0].end).toEqual({ type: "permanent" });
        expect(rows.active[0].origin).toBe("assigned");
    });

    it("marks emergency accounts and gives the UPN or the member count as the second line", () => {
        expect(rows.active.every((r) => r.isEmergency)).toBe(true);
        expect(rows.eligible[0].secondary).toBe("anna@contoso.com");
        expect(rows.eligible[2]).toMatchObject({ secondary: "3 members", isOutsidePim: true, groupId: "g-tier0", memberCount: 3 });
        expect(rows.eligible[2].children).toEqual([]);
    });
});

describe("group members under their group row", () => {
    it("nests the members of a group under PIM, each Via group, de-duplicated", () => {
        const g = group("g1", [
            { principalId: "u1", principal: { ...user("u1"), displayName: "Anna" } as never, accessType: "member", assignmentType: "eligible" },
            { principalId: "u1", principal: { ...user("u1"), displayName: "Anna" } as never, accessType: "member", assignmentType: "active", assignmentOrigin: "activated", endDateTime: "2026-10-03T00:00:00Z" },
            { principalId: "u2", principal: user("u2") as never, accessType: "owner", assignmentType: "eligible" },
        ]);
        g.group.displayName = "Helpdesk";
        const r = role({ id: "r", eligible: [{ id: "e1", principalId: "g1", principal: groupPrincipal("g1"), ...noEnd }] });
        const rows = buildRoleAssignmentRows(r, ctx({ groups: [g] }));
        expect(rows.eligible).toHaveLength(1);
        expect(rows.eligible[0].children.map((c) => [c.name, c.how])).toEqual([["Anna", { type: "viaGroup", groupId: "g1", groupName: "Helpdesk" }]]);
        expect(rows.total).toBe(2);
    });

    it("nests an activation through a group when exactly one eligible group has the user as a member, else keeps it on top with an unnamed group", () => {
        const g1 = group("g1", [{ principalId: "u1", principal: user("u1") as never, accessType: "member", assignmentType: "eligible" }]);
        const g2 = group("g2", [{ principalId: "u1", principal: user("u1") as never, accessType: "member", assignmentType: "eligible" }]);
        const eligibleGroup = (id: string) => ({ id: `e-${id}`, principalId: id, principal: groupPrincipal(id), ...noEnd });
        const activation = { id: "a1", principalId: "u1", principal: { ...user("u1"), displayName: "Anna" }, assignmentType: "Activated", viaGroup: true, ...endsLater };

        const one = buildRoleAssignmentRows(role({ id: "r", eligible: [eligibleGroup("g1")], active: [activation] }), ctx({ groups: [g1] }));
        expect(one.active).toEqual([]);
        // the member is already listed by the group's own data: one row, with the activation's origin and end
        expect(one.eligible[0].children).toHaveLength(1);
        expect(one.eligible[0].children[0]).toMatchObject({ name: expect.any(String), origin: "activated" });

        const g3 = group("g3", []);
        const outsideOnly = buildRoleAssignmentRows(role({ id: "r", eligible: [eligibleGroup("g3")], active: [activation] }), ctx({ groups: [g3], knownMembers: new Map([["g3", new Set(["u1"])]]) }));
        expect(outsideOnly.active).toEqual([]);
        expect(outsideOnly.eligible[0].children).toHaveLength(1);
        expect(outsideOnly.eligible[0].children[0].how).toMatchObject({ type: "viaGroup", groupId: "g3" });

        const several = buildRoleAssignmentRows(role({ id: "r", eligible: [eligibleGroup("g1"), eligibleGroup("g2")], active: [activation] }), ctx({ groups: [g1, g2] }));
        expect(several.active).toHaveLength(1);
        expect(several.active[0]).toMatchObject({ isViaGroupUnnamed: true, how: { type: "viaGroup" } });
    });
});

describe("member count of a group under PIM", () => {
    it("counts people, not instances: an activated membership is one member", () => {
        const g = group("g1", [
            { principalId: "u1", principal: user("u1") as never, accessType: "member", assignmentType: "eligible" },
            { principalId: "U1", principal: user("u1") as never, accessType: "member", assignmentType: "active", assignmentOrigin: "activated", endDateTime: "2026-10-03T00:00:00Z" },
            { principalId: "u2", principal: user("u2") as never, accessType: "member", assignmentType: "eligible" },
            { principalId: "u3", principal: user("u3") as never, accessType: "owner", assignmentType: "eligible" },
        ]);
        const r = role({ id: "r", eligible: [{ id: "e1", principalId: "g1", principal: groupPrincipal("g1"), ...noEnd }] });
        const rows = buildRoleAssignmentRows(r, ctx({ groups: [g] }));
        expect(rows.eligible[0]).toMatchObject({ memberCount: 2, secondary: "2 members" });
        expect(rows.eligible[0].children).toHaveLength(2);
    });
});

describe("a group that is eligible and active for the role", () => {
    it("hosts the on-demand member disclosure once", () => {
        const g = group("g1", [], false);
        g.memberCount = 4;
        const r = role({ id: "r", eligible: [{ id: "e1", principalId: "g1", principal: groupPrincipal("g1"), ...noEnd }], active: [{ id: "a1", principalId: "g1", principal: groupPrincipal("g1"), assignmentType: "Assigned", ...noEnd }] });
        const rows = buildRoleAssignmentRows(r, ctx({ groups: [g] }));
        expect([...rows.eligible, ...rows.active].map((x) => x.isOutsidePim)).toEqual([true, undefined]);
    });
});

describe("marking and names", () => {
    const r = role({ id: "r", eligible: [{ id: "e1", principalId: "u1", principal: user("u1"), ...endsLater }, { id: "e2", principalId: "u2", ...noEnd }], active: [{ id: "a1", principalId: PEOPLE.bg1.id, principal: user(PEOPLE.bg1.id), assignmentType: "Assigned", ...noEnd }] });

    it("marks only the rows whose ids are in the set; nothing is marked without a set", () => {
        const none = buildRoleAssignmentRows(r, ctx());
        expect([...none.eligible, ...none.active].some((x) => x.isMarked)).toBe(false);
        const some = buildRoleAssignmentRows(r, ctx({ marking: new Set(["e1"]) }));
        expect(some.eligible.map((x) => x.isMarked)).toEqual([true, false]);
    });

    describe("Agent ID assignment rows", () => {
        const assignmentRow = (
            principal: { id: string; "@odata.type": string; servicePrincipalType?: string; agentIdentityBlueprintId?: string; userPrincipalName?: string },
            principalUserType?: string,
            blueprintNames?: ReadonlyMap<string, string>,
        ) => {
            const data = role({
                id: principal.id,
                eligible: [{ id: `e-${principal.id}`, principalId: principal.id, principal, principalUserType, ...noEnd }],
            });
            return buildRoleAssignmentRows(data, ctx({ blueprintNames })).eligible[0];
        };

        it("names a Copilot Studio agent identity and uses its Microsoft name", () => {
            const row = assignmentRow(agent("copilot-agent"));
            expect(row.kind).toBe("agentIdentity");
            expect(row.secondary).toBe("Agent identity · Microsoft Copilot Studio");
        });

        it("uses the blueprint name from a lower-case map key", () => {
            const principal = { ...agent("ops-agent"), agentIdentityBlueprintId: "00000000-0000-0000-0000-0000000000b1" };
            const row = assignmentRow(principal, undefined, new Map([["00000000-0000-0000-0000-0000000000b1", "Contoso Ops Agent Blueprint"]]));
            expect(row.secondary).toBe("Agent identity · Contoso Ops Agent Blueprint");
        });

        it("matches an upper-case blueprint id with a lower-case map key", () => {
            const principal = { ...agent("ops-agent"), agentIdentityBlueprintId: "00000000-0000-0000-0000-0000000000B1" };
            expect(assignmentRow(principal, undefined, new Map([["00000000-0000-0000-0000-0000000000b1", "Ops Blueprint"]])).secondary).toBe("Agent identity · Ops Blueprint");
        });

        it("uses the plain agent identity line when its blueprint is not named", () => {
            const principal = { ...agent("ops-agent"), agentIdentityBlueprintId: "00000000-0000-0000-0000-0000000000b1" };
            expect(assignmentRow(principal).secondary).toBe("Agent identity");
        });

        it("recognizes the roleAssignments base type of an agent identity", () => {
            expect(assignmentRow(agentBase("base-agent"))).toMatchObject({ kind: "agentIdentity", secondary: "Agent identity" });
        });

        it("keeps an agent user account as its own kind with a UPN or fallback line", () => {
            expect(assignmentRow({ ...agentUser("agent-user"), userPrincipalName: "agent@contoso.com" }, "Member")).toMatchObject({ kind: "agentUser", secondary: "agent@contoso.com" });
            expect(assignmentRow(agentUser("agent-user-no-upn"))).toMatchObject({ kind: "agentUser", secondary: "Agent's user account" });
        });

        it("does not turn an agent user account into a guest", () => {
            expect(assignmentRow(agentUser("agent-user-guest"), "Guest").kind).toBe("agentUser");
        });

        it("labels a blueprint principal with its Microsoft name", () => {
            expect(assignmentRow(blueprint("blueprint"))).toMatchObject({ kind: "agentBlueprint", secondary: "Agent identity blueprint principal" });
        });

        it("keeps agent kinds in group membership rows", () => {
            const rows = buildMembershipRows({
                members: [
                    { id: "agent-user", displayName: "Agent account", kind: "agentUser" },
                    { id: "agent-identity", displayName: "Agent", kind: "agentIdentity" },
                ],
                owners: [],
            }, { emergencyAccountIds: new Set(), groupId: "g", groupName: "Group", isViaGroup: false });
            expect(rows.map((row) => row.kind)).toEqual(["agentIdentity", "agentUser"]);
        });

        it("keeps an agent user as its kind in PIM group assignment rows", () => {
            const data = group("agents", [{ principalId: "agent-user", principal: { id: "agent-user", displayName: "Agent account", userPrincipalName: "agent@contoso.com", "@odata.type": "#microsoft.graph.agentUser" } as never, assignmentType: "eligible" }]);
            const rows = buildGroupAssignmentRows(data, { emergencyAccountIds: new Set(), marking: null });
            expect(rows.eligible[0]).toMatchObject({ kind: "agentUser", secondary: "agent@contoso.com" });
        });
    });

    it("resolves a name from another list and falls back to a short id", () => {
        const rows = buildRoleAssignmentRows(r, ctx({ nameById: new Map([["u2", "Resolved Name"]]) }));
        expect(rows.eligible[1].name).toBe("Resolved Name");
        expect(buildRoleAssignmentRows(r, ctx()).eligible[1].name).toBe("Unknown (u2)");
    });

    it("reads guests and apps from the principal", () => {
        const mixed = role({ id: "m", eligible: [
            { id: "x1", principalId: "g", principal: user("g"), principalUserType: "Guest", ...noEnd },
            { id: "x2", principalId: "s", principal: { id: "s", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "Pipeline" }, ...noEnd },
        ] });
        const rows = buildRoleAssignmentRows(mixed, ctx());
        expect(rows.eligible.map((x) => [x.kind, x.secondary])).toEqual([["guest", ""], ["app", "App"]]);
    });
});

describe("buildMembershipRows", () => {
    const membership = {
        members: [{ id: "u2", displayName: "Bram", kind: "user" as const }, { id: "u1", displayName: "Anna", userPrincipalName: "anna@contoso.com", userType: "Guest", kind: "user" as const }, { id: "s1", displayName: "App", kind: "servicePrincipal" as const }],
        owners: [{ id: "u1", displayName: "Anna", kind: "user" as const }],
    };

    it("members first by name, then owners; a person who is both gets two rows; all Always on", () => {
        const rows = buildMembershipRows(membership, { emergencyAccountIds: new Set(["u2"]), groupId: "g", groupName: "Tier 0", isViaGroup: true });
        expect(rows.map((r) => [r.name, r.relation, r.kind])).toEqual([["Anna", "member", "guest"], ["App", "member", "app"], ["Bram", "member", "user"], ["Anna", "owner", "user"]]);
        expect(rows.every((r) => r.isAlwaysOn)).toBe(true);
        expect(rows.find((r) => r.principalId === "u2")?.isEmergency).toBe(true);
        expect(rows[0].how).toEqual({ type: "viaGroup", groupId: "g", groupName: "Tier 0" });
    });

    it("keeps How direct when the rows are not shown under a role", () => {
        expect(buildMembershipRows(membership, { emergencyAccountIds: new Set(), groupId: "g", groupName: "x", isViaGroup: false })[0].how).toEqual({ type: "direct" });
    });
});

describe("describeScopeTag", () => {
    it("names tenant, administrative unit, app and object", () => {
        expect(describeScopeTag({ type: "tenant-wide" })).toMatchObject({ label: "Tenant-wide", term: "tenantWide" });
        expect(describeScopeTag({ type: "administrative-unit", displayName: "Sales" })).toMatchObject({ label: "Sales", term: "administrativeUnit", tip: "Administrative Unit: Sales" });
        expect(describeScopeTag({ type: "application", displayName: "Contoso App" })).toMatchObject({ label: "Contoso App", term: null });
        expect(describeScopeTag({ type: "specific-object", displayName: "Printer 4" })).toMatchObject({ label: "Printer 4" });
        expect(describeScopeTag({ type: "unknown" }).label).toBe("Unknown");
    });
});

describe("buildGroupAssignmentRows", () => {
    const g = buildReportGroups().find((x) => x.group.id === "g-helpdesk1")!;
    const rows = buildGroupAssignmentRows(g, { emergencyAccountIds: new Set(), marking: null });

    it("splits eligible and active, members before owners, by name", () => {
        expect(rows.eligible.map((r) => [r.name, r.relation, r.end.type])).toEqual([["Lotte Visser", "member", "expires"], ["Mo Haddad", "member", "noEnd"]]);
        expect(rows.active.map((r) => [r.name, r.relation, r.origin, r.end.type])).toEqual([["Ravi Nair", "member", "activated", "expires"], ["Erik van Dam", "owner", "assigned", "permanent"]]);
        expect(rows.total).toBe(4);
    });

    it("marks the rows whose ids are in the set", () => {
        const id = g.assignments[0].id;
        const marked = buildGroupAssignmentRows(g, { emergencyAccountIds: new Set(), marking: new Set([id]) });
        expect([...marked.eligible, ...marked.active].filter((r) => r.isMarked).map((r) => r.scheduleId)).toEqual([id]);
    });
});

describe("buildRolesHeldRows", () => {
    it("tells End: expires, no end date, permanent", () => {
        const roles = buildReportRoles();
        const held = (id: string) => buildRolesHeldRows(getRolesHeldByGroup(roles, id));
        expect(held("g-tier0")[0]).toMatchObject({ roleName: "Global Administrator", kind: "eligible", end: { type: "expires" } });
        expect(held("g-soc").map((r) => [r.roleName, r.kind, r.end.type])).toEqual([["Security Operator", "active", "permanent"], ["Security Reader", "eligible", "noEnd"]]);
        expect(held("g-legacy")).toEqual([]);
    });
});

describe("role assignments no schedule covers (the legacy list)", () => {
    const legacy = (id: string, principalId: string, scope = "/") => ({ id, principalId, directoryScopeId: scope, principal: { ...user(principalId), displayName: principalId.toUpperCase() } });
    const r = role({
        id: "r1",
        active: [{ id: "s1", principalId: "u1", directoryScopeId: "/", principal: user("u1"), assignmentType: "Assigned", ...noEnd }],
        permanent: [legacy("ra1", "u1"), legacy("ra2", "u2"), legacy("ra3", "u1", "/administrativeUnits/au1")],
    });

    it("adds only the entries without an active schedule at the same principal and scope, as Permanent, Assigned", () => {
        const rows = buildRoleAssignmentRows(r, ctx());
        expect(rows.active.map((row) => [row.key, row.principalId, row.end.type, row.origin])).toEqual([
            ["a:s1", "u1", "permanent", "assigned"],
            ["p:ra2", "u2", "permanent", "assigned"],
            ["p:ra3", "u1", "permanent", "assigned"],
        ]);
        expect(rows.total).toBe(3);
    });
});
