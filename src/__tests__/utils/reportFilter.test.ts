import { describe, expect, it } from "vitest";
import {
    applyDashboardFilterToGroups,
    applyDashboardFilterToRoles,
    applyReportFilterToGroups,
    applyReportFilterToRoles,
    buildKindById,
    countKeysOfView,
    getActiveFilterKeys,
    getMatchingAssignmentIds,
    getReportFilterLabels,
    keysOfView,
    parseDashboardFilter,
    serializeDashboardFilter,
} from "@/utils/dashboardFilter";
import { DASHBOARD_FILTER_KEYS, DASHBOARD_FILTER_VALUES, FILTER_KEY_VIEW, type DashboardFilter } from "@/types/dashboardFilter.types";
import type { GroupPimPolicy } from "@/types/pimGroup.types";
import { endsLater, group, groupPrincipal, noEnd, policy, role, user } from "../fixtures/dashboardFilterFixtures";

describe("round trip of the Report keys", () => {
    const filters: DashboardFilter[] = [
        { hasAssignments: true },
        { givesPrivileged: true },
        { groupPim: "under" },
        { groupPim: "outside" },
        { entraRoles: "holds" },
        { entraRoles: "assignableNone" },
        { entraRoles: "notAssignable" },
        { accessType: "member" },
        { accessType: "owner" },
        { appliesTo: "owner" },
        { assignment: "activated" },
        { assignment: "assigned" },
    ];

    it("serialises and parses every new key and value", () => {
        for (const f of filters) expect(parseDashboardFilter(serializeDashboardFilter(f))).toEqual(f);
    });

    it("ignores values a key does not know and the forms that do not exist", () => {
        expect(parseDashboardFilter("groupPim:sideways,entraRoles:all,accessType:both,appliesTo:member,hasAssignments:false,givesPrivileged:false")).toEqual({});
    });

    it("keeps the old key order and appends the new keys after excludeEmergency", () => {
        expect(DASHBOARD_FILTER_KEYS.slice(-7)).toEqual(["excludeEmergency", "hasAssignments", "groupPim", "entraRoles", "givesPrivileged", "accessType", "appliesTo"]);
        expect(serializeDashboardFilter({ appliesTo: "owner", privileged: true, hasAssignments: true })).toBe("privileged:true,hasAssignments:true,appliesTo:owner");
    });

    it("has a view for every key and a value list for every enumerated new key", () => {
        for (const key of DASHBOARD_FILTER_KEYS) expect(FILTER_KEY_VIEW[key]).toBeDefined();
        expect(DASHBOARD_FILTER_VALUES.groupPim).toEqual(["under", "outside"]);
    });
});

describe("views, labels and counts", () => {
    const filter: DashboardFilter = { privileged: true, groupPim: "outside", mfa: "neither" };

    it("keeps the keys of the other view in the URL but out of this view", () => {
        expect(keysOfView(filter, "roles")).toEqual({ privileged: true, mfa: "neither" });
        expect(keysOfView(filter, "groups")).toEqual({ groupPim: "outside", mfa: "neither" });
        expect(countKeysOfView(filter, "roles")).toBe(2);
        expect(getActiveFilterKeys(filter)).toHaveLength(3);
    });

    it("suffixes a key of the other view instead of hiding it", () => {
        const labels = getReportFilterLabels(filter, "roles");
        expect(labels.map((l) => [l.key, l.label, l.suffix])).toEqual([
            ["privileged", "Privileged only", undefined],
            ["mfa", "MFA on activation: neither", undefined],
            ["groupPim", "Outside PIM", "(groups only)"],
        ]);
        expect(getReportFilterLabels(filter, "groups").find((l) => l.key === "privileged")?.suffix).toBe("(roles only)");
    });

    it("labels every new key readably", () => {
        const labels = (f: DashboardFilter) => getReportFilterLabels(f, "groups")[0].label;
        expect(labels({ hasAssignments: true })).toContain("Has assignments");
        expect(labels({ entraRoles: "holds" })).toBe("Holds roles");
        expect(labels({ entraRoles: "assignableNone" })).toBe("Role-assignable, no roles");
        expect(labels({ entraRoles: "notAssignable" })).toBe("Not role-assignable");
        expect(labels({ givesPrivileged: true })).toBe("Gives a privileged role");
        expect(labels({ groupPim: "under" })).toBe("Under PIM");
        expect(labels({ accessType: "owner" })).toBe("Owner assignments");
        expect(labels({ assignment: "assigned" })).toContain("assigned");
    });
});

describe("applyReportFilterToRoles", () => {
    const active = (extra: Record<string, unknown>) => ({ principalId: "u1", principal: user("u1"), ...extra });
    const activated = role({ id: "activated", active: [active({ assignmentType: "Activated", ...endsLater })] });
    const assignedEnding = role({ id: "assigned-end", active: [active({ assignmentType: "Assigned", ...endsLater })] });
    const permanent = role({ id: "permanent", active: [active({ assignmentType: "Assigned", ...noEnd })] });
    const empty = role({ id: "empty" });
    const eligibleOnly = role({ id: "eligible", eligible: [{ principalId: "u2", principal: user("u2"), ...endsLater }] });
    const all = [activated, assignedEnding, permanent, empty, eligibleOnly];
    const ids = (roles: ReturnType<typeof role>[]) => roles.map((r) => r.definition.id);

    it("hasAssignments needs an eligible or active assignment", () => {
        expect(ids(applyReportFilterToRoles(all, { hasAssignments: true }))).toEqual(["activated", "assigned-end", "permanent", "eligible"]);
    });

    it("assignment:activated and assignment:assigned are exact", () => {
        expect(ids(applyReportFilterToRoles(all, { assignment: "activated" }))).toEqual(["activated"]);
        expect(ids(applyReportFilterToRoles(all, { assignment: "assigned" }))).toEqual(["assigned-end", "permanent"]);
        expect(ids(applyReportFilterToRoles(all, { assignment: "permanent" }))).toEqual(["permanent"]);
    });

    it("applies the shared keys exactly like the dashboard does", () => {
        const filter: DashboardFilter = { assignment: "eligible", principalType: "user" };
        expect(ids(applyReportFilterToRoles(all, filter))).toEqual(ids(applyDashboardFilterToRoles(all, filter)));
    });

    it("does not apply the keys of the groups view", () => {
        expect(applyReportFilterToRoles(all, { groupPim: "outside", accessType: "owner", appliesTo: "owner" })).toBe(all);
    });

    it("the dashboard ignores hasAssignments and the other new keys", () => {
        expect(applyDashboardFilterToRoles(all, { hasAssignments: true })).toEqual(all);
        expect(applyDashboardFilterToRoles(all, { groupPim: "under" })).toEqual(all);
    });

    it("mfa:neither lists the roles the dashboard counts", () => {
        const roles = [role({ id: "a", isPrivileged: true, policy: policy({ mfa: false }) }), role({ id: "b", isPrivileged: true, policy: policy({ mfa: true }) })];
        expect(ids(applyReportFilterToRoles(roles, { mfa: "neither" }))).toEqual(ids(applyDashboardFilterToRoles(roles, { mfa: "neither" })));
    });
});

describe("applyReportFilterToGroups", () => {
    const withPolicy = (g: ReturnType<typeof group>, relation: "member" | "owner", o: Parameters<typeof policy>[0]) => {
        const rules = policy(o)!.details.rules as unknown as GroupPimPolicy["rules"];
        g.policies = { ...g.policies, [relation]: { id: `${g.group.id}-${relation}`, groupId: g.group.id, policyType: relation, rules } };
        return g;
    };
    const member = (principalId: string, extra: Record<string, unknown> = {}) => ({ principalId, principal: user(principalId) as never, accessType: "member" as const, assignmentType: "eligible" as const, ...extra });

    const roles = [
        role({ id: "r1", name: "Helpdesk", isPrivileged: false, eligible: [{ id: "e1", principalId: "G-HOLDS", principal: groupPrincipal("G-HOLDS") }] }),
        role({ id: "r2", name: "Global Administrator", isPrivileged: true, active: [{ id: "a1", principalId: "g-priv", principal: groupPrincipal("g-priv") }] }),
    ];
    const holds = group("g-holds", [member("u1")]);
    const priv = group("g-priv", [member("u2", { principalUserType: "Guest" }), { principalId: "u3", principal: user("u3") as never, accessType: "owner" as const, assignmentType: "permanent" as const, assignmentOrigin: "assigned" as const }]);
    const none = group("g-none", [member("u4", { memberType: "Group" })]);
    const outside = group("g-out", [], false);
    outside.group.isAssignableToRole = true;
    const notAssignable = group("g-na", [member("u5")]);
    notAssignable.group.isAssignableToRole = false;
    const unknownAssignable = group("g-unknown", [member("u6")]);
    unknownAssignable.group.isAssignableToRole = undefined;
    const all = [holds, priv, none, outside, notAssignable, unknownAssignable];
    const ids = (groups: typeof all) => groups.map((g) => g.group.id);

    it("groupPim reads isManaged", () => {
        expect(ids(applyReportFilterToGroups(all, roles, { groupPim: "outside" }))).toEqual(["g-out"]);
        expect(ids(applyReportFilterToGroups(all, roles, { groupPim: "under" }))).toEqual(["g-holds", "g-priv", "g-none", "g-na", "g-unknown"]);
    });

    it("entraRoles: holds, assignable without roles, not assignable, and unknown matches none", () => {
        expect(ids(applyReportFilterToGroups(all, roles, { entraRoles: "holds" }))).toEqual(["g-holds", "g-priv"]);
        expect(ids(applyReportFilterToGroups(all, roles, { entraRoles: "assignableNone" }))).toEqual(["g-none", "g-out"]);
        expect(ids(applyReportFilterToGroups(all, roles, { entraRoles: "notAssignable" }))).toEqual(["g-na"]);
    });

    it("givesPrivileged needs a held role with isPrivileged", () => {
        expect(ids(applyReportFilterToGroups(all, roles, { givesPrivileged: true }))).toEqual(["g-priv"]);
    });

    it("accessType and the other assignment keys must hold on one assignment", () => {
        expect(ids(applyReportFilterToGroups(all, roles, { accessType: "owner" }))).toEqual(["g-priv"]);
        expect(ids(applyReportFilterToGroups(all, roles, { accessType: "owner", assignment: "eligible" }))).toEqual([]);
        expect(ids(applyReportFilterToGroups(all, roles, { accessType: "member", assignment: "eligible" }))).toEqual(["g-holds", "g-priv", "g-none", "g-na", "g-unknown"]);
        expect(ids(applyReportFilterToGroups(all, roles, { assignment: "assigned" }))).toEqual(["g-priv"]);
    });

    it("principalType:guest reads principalUserType, via:group reads memberType", () => {
        expect(ids(applyReportFilterToGroups(all, roles, { principalType: "guest" }))).toEqual(["g-priv"]);
        expect(ids(applyReportFilterToGroups(all, roles, { via: "group" }))).toEqual(["g-none"]);
        expect(ids(applyReportFilterToGroups(all, roles, { via: "direct" }))).toEqual(["g-holds", "g-priv", "g-na", "g-unknown"]);
    });

    it("policy keys read the Member policy, or the Owner policy with appliesTo:owner, and need it loaded", () => {
        const a = withPolicy(group("a", []), "member", { approval: true });
        withPolicy(a, "owner", { approval: false });
        const b = withPolicy(group("b", []), "member", { approval: false });
        withPolicy(b, "owner", { approval: true });
        const c = group("c", []);
        const groups = [a, b, c];
        expect(ids(applyReportFilterToGroups(groups, [], { approval: "required" }) as typeof all)).toEqual(["a"]);
        expect(ids(applyReportFilterToGroups(groups, [], { approval: "required", appliesTo: "owner" }) as typeof all)).toEqual(["b"]);
        expect(ids(applyReportFilterToGroups(groups, [], { approval: "notRequired" }) as typeof all)).toEqual(["b"]);
    });

    it("customExtension matches either slot of the policy that applies", () => {
        const rules = [
            ...(policy({})!.details.rules as unknown as object[]),
            { id: "CustomExtension_PostApproval_EndUser_Assignment", "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule", isEnabled: true, customExtensionId: "ext-1", displayName: "X", target: { caller: "EndUser", operations: ["All"], level: "Assignment" } },
        ] as unknown as GroupPimPolicy["rules"];
        const g = group("g", []);
        g.policies = { owner: { id: "p", groupId: "g", policyType: "owner", rules } };
        expect(applyReportFilterToGroups([g], [], { customExtension: "ext-1" })).toEqual([]);
        expect(applyReportFilterToGroups([g], [], { customExtension: "ext-1", appliesTo: "owner" })).toEqual([g]);
    });

    it("does not apply the keys of the roles view, and the dashboard function still shows no group for a role key", () => {
        expect(applyReportFilterToGroups(all, roles, { privileged: true, hasAssignments: true })).toBe(all);
        expect(applyDashboardFilterToGroups(all, { privileged: true })).toEqual([]);
    });
});

describe("getMatchingAssignmentIds", () => {
    const r = role({
        id: "r",
        eligible: [{ id: "e1", principalId: "u1", principal: user("u1"), ...endsLater }, { id: "e2", principalId: "g1", principal: groupPrincipal("g1"), ...endsLater }],
        active: [{ id: "a1", principalId: "u2", principal: user("u2"), assignmentType: "Activated", viaGroup: true, ...endsLater }, { id: "a2", principalId: "u3", principal: user("u3"), assignmentType: "Assigned", ...noEnd }],
    });

    it("is empty when no assignment key is set", () => {
        expect(getMatchingAssignmentIds(r, { privileged: true, mfa: "neither" }).size).toBe(0);
    });

    it("lists the schedules that match every assignment key", () => {
        expect([...getMatchingAssignmentIds(r, { via: "group" }, { kindById: buildKindById([r]) })].sort()).toEqual(["a1", "e2"]);
        expect([...getMatchingAssignmentIds(r, { assignment: "assigned" })]).toEqual(["a2"]);
        expect([...getMatchingAssignmentIds(r, { principalType: "user", assignment: "eligible" })]).toEqual(["e1"]);
    });

    it("leaves out emergency accounts only for a test on assignments", () => {
        expect([...getMatchingAssignmentIds(r, { assignment: "assigned", excludeEmergency: true }, { emergencyAccountIds: new Set(["u3"]) })]).toEqual([]);
        expect(getMatchingAssignmentIds(r, { excludeEmergency: true }, { emergencyAccountIds: new Set(["u3"]) }).size).toBe(0);
    });

    it("reads group assignments with their own facts and ignores keys of the roles view", () => {
        const g = group("g", [{ principalId: "u1", principal: user("u1") as never, accessType: "owner", assignmentType: "eligible" }, { principalId: "u2", principal: user("u2") as never, accessType: "member", assignmentType: "eligible" }]);
        const matches = getMatchingAssignmentIds(g, { accessType: "owner", privileged: true });
        expect(matches.size).toBe(1);
        expect(getMatchingAssignmentIds(g, { privileged: true }).size).toBe(0);
    });
});
