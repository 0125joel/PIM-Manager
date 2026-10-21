import { describe, expect, it } from "vitest";
import { DYNAMIC_OR_SYNCED_REASON, RESTRICTED_UNIT_REASON, ROLE_TEMPLATES, deriveWriteAccess, groupRoleAssignments, groupsOutsideLoad, scopesToRead, type GroupLike, type WriteAccessInput } from "@/utils/writeAccess";

const T = ROLE_TEMPLATES;
const defs = [
    { id: T.privilegedRoleAdministrator, templateId: T.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true },
    { id: T.globalAdministrator, templateId: T.globalAdministrator, displayName: "Global Administrator", isBuiltIn: true },
    { id: T.groupsAdministrator, templateId: T.groupsAdministrator, displayName: "Groups Administrator", isBuiltIn: true },
    { id: T.userAdministrator, templateId: T.userAdministrator, displayName: "User Administrator", isBuiltIn: true },
    { id: "custom-groups", templateId: "custom-groups", displayName: "Group Helpers", isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/groups/members/update", "microsoft.directory/groups/owners/update"] }] },
    { id: "custom-read", templateId: "custom-read", displayName: "Readers", isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/groups/members/read"] }] },
];
const groups: GroupLike[] = [
    { id: "g-tier0", displayName: "Tier 0 Admins", isAssignableToRole: true, isUnderPim: true },
    { id: "g-news", displayName: "News", isAssignableToRole: null, isUnderPim: true },
    { id: "g-sales", displayName: "Sales", isAssignableToRole: null, isUnderPim: false },
    { id: "g-dyn", displayName: "All staff", isAssignableToRole: null, membershipRule: "user.accountEnabled -eq true", isUnderPim: false },
    { id: "g-synced", displayName: "On-prem", isAssignableToRole: null, onPremisesSyncEnabled: true, isUnderPim: false },
];

function input(over: Partial<WriteAccessInput> = {}): WriteAccessInput {
    return {
        activeRoles: [], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [],
        roleDefinitions: defs, groups, administrativeUnitGroups: {},
        appPermission: { directoryRoles: "granted", pimGroups: "granted" },
        ...over,
    };
}

const active = (roleDefinitionId: string, extra: Record<string, string | null> = {}) => ({ roleDefinitionId, directoryScopeId: "/", memberType: "Direct", assignmentType: "Assigned", endDateTime: null, ...extra });

describe("deriveWriteAccess: the five admins of the board", () => {
    it("Privileged Role Administrator active opens everything but dynamic and synced groups", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active(T.privilegedRoleAdministrator, { endDateTime: "2026-10-03T14:20:00Z", assignmentType: "Activated" })] }));
        expect(a.overall).toBe("open");
        expect(a.roles.state).toBe("open");
        expect(a.headline).toMatchObject({ kind: "open", via: { kind: "role", role: { name: "Privileged Role Administrator", end: "2026-10-03T14:20:00Z" } } });
        expect(a.groups["g-tier0"].state).toBe("open");
        expect(a.groups["g-sales"].state).toBe("open");
        expect(a.groups["g-dyn"]).toMatchObject({ state: "locked", reason: DYNAMIC_OR_SYNCED_REASON, owner: false, isUnderPim: false, displayName: "All staff" });
        expect(a.groups["g-synced"].state).toBe("locked");
    });

    it("a group in a restricted management administrative unit is locked for everyone (M-07)", () => {
        const restricted: GroupLike = { id: "g-rmau", displayName: "Restricted", isAssignableToRole: null, isManagementRestricted: true, isUnderPim: false };
        const a = deriveWriteAccess(input({ groups: [...groups, restricted], activeRoles: [active(T.privilegedRoleAdministrator)] }));
        expect(a.groups["g-rmau"]).toMatchObject({ state: "locked", reason: RESTRICTED_UNIT_REASON });
    });

    it("Groups Administrator active opens groups that are not role-assignable only", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active(T.groupsAdministrator)] }));
        expect(a.roles.state).toBe("closed");
        expect(a.groups["g-tier0"].state).toBe("closed");
        expect(a.groups["g-news"].state).toBe("open");
        expect(a.otherGroups).toMatchObject({ state: "open", reach: "all", openCount: 2, total: 2, via: { kind: "role", role: { name: "Groups Administrator" } } });
        expect(a.roleAssignableGroups.state).toBe("closed");
        expect(a.overall).toBe("open");
    });

    it("a group owner without roles opens only the groups it owns, role-assignable ones too", () => {
        const a = deriveWriteAccess(input({ ownedGroups: [{ id: "G-TIER0" }] }));
        expect(a.groups["g-tier0"]).toMatchObject({ state: "open", owner: true });
        expect(a.groups["g-news"].state).toBe("closed");
        expect(a.roles.state).toBe("closed");
        expect(a.roleAssignableGroups).toMatchObject({ state: "open", reach: "some", openCount: 1, total: 1, via: { kind: "ownership" } });
        expect(a.headline).toEqual({ kind: "open", via: { kind: "ownership" } });
        expect(a.overall).toBe("open");
    });

    it("Privileged Role Administrator eligible only: activate first", () => {
        const a = deriveWriteAccess(input({ eligibleRoles: [active(T.privilegedRoleAdministrator, { endDateTime: "2027-05-09T00:00:00Z" })] }));
        expect(a.overall).toBe("activate-first");
        expect(a.roles).toMatchObject({ state: "activate-first", activate: { kind: "role", role: { name: "Privileged Role Administrator" } } });
        expect(a.headline).toMatchObject({ kind: "activate", target: { kind: "role", role: { name: "Privileged Role Administrator" } } });
        expect(a.groups["g-news"]).toMatchObject({ state: "activate-first", reason: "Activate Privileged Role Administrator first" });
    });

    it("no fitting role: closed", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active("custom-read")] }));
        expect(a.overall).toBe("closed");
        expect(a.headline).toBeNull();
    });
});

describe("deriveWriteAccess: the facts of the tenant tests", () => {
    it("a role held through a group counts (T1, memberType Group, any case)", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active(T.globalAdministrator, { memberType: "group" })] }));
        expect(a.roles).toMatchObject({ state: "open", via: { kind: "role", role: { name: "Global Administrator", viaGroup: true } } });
    });

    it("a full role on an administrative unit does not open Entra roles", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active(T.privilegedRoleAdministrator, { directoryScopeId: "/administrativeUnits/au1" })] }));
        expect(a.roles.state).toBe("closed");
    });

    it("an AU-scoped Groups Administrator opens only groups in that unit", () => {
        const a = deriveWriteAccess(input({
            activeRoles: [active(T.groupsAdministrator, { directoryScopeId: "/administrativeUnits/au1" })],
            administrativeUnitGroups: { au1: [{ id: "g-sales" }] },
        }));
        expect(a.groups["g-sales"].state).toBe("open");
        expect(a.groups["g-news"].state).toBe("closed");
    });

    it("a group in the unit the app has not loaded is added and opened; a dynamic one in the unit is locked", () => {
        const a = deriveWriteAccess(input({
            activeRoles: [active(T.groupsAdministrator, { directoryScopeId: "/administrativeUnits/au1" })],
            administrativeUnitGroups: { au1: [
                { id: "g-plain", displayName: "Plain security group", isAssignableToRole: null },
                { id: "g-au-dyn", displayName: "Dynamic in unit", membershipRule: "user.department -eq \"Sales\"" },
            ] },
        }));
        expect(a.groups["g-plain"]).toMatchObject({ state: "open", isUnderPim: false, reason: "Groups Administrator" });
        expect(a.groups["g-au-dyn"].state).toBe("locked");
        expect(a.otherGroups).toMatchObject({ state: "open", reach: "some", openCount: 1 });
        expect(a.overall).toBe("open");
    });

    it("an eligible AU-scoped Groups Administrator with only unloaded groups in the unit activates first", () => {
        const a = deriveWriteAccess(input({
            eligibleRoles: [active(T.groupsAdministrator, { directoryScopeId: "/administrativeUnits/au1" })],
            administrativeUnitGroups: { au1: [{ id: "g-plain", displayName: "Plain security group" }] },
        }));
        expect(a.overall).toBe("activate-first");
        expect(a.headline).toMatchObject({ kind: "activate", target: { kind: "role", role: { name: "Groups Administrator" } } });
    });

    it("a custom role scoped to a group the app has not loaded opens that group", () => {
        const id = "0b5d7e1f-2a3c-4d5e-8f90-1a2b3c4d5e6f";
        const a = deriveWriteAccess(input({
            activeRoles: [active("custom-groups", { directoryScopeId: `/${id}` })],
            scopedGroups: [{ id, displayName: "Project X" }],
        }));
        expect(a.groups[id]).toMatchObject({ state: "open", displayName: "Project X", isUnderPim: false });
    });

    it("an eligible PIM membership of a group holding Privileged Role Administrator activates first through the group", () => {
        const rolesOfGroups = groupRoleAssignments([
            { definition: { id: T.privilegedRoleAdministrator }, assignments: { active: [{ principalId: "G-TIER0", directoryScopeId: "/" }] } },
            { definition: { id: T.userAdministrator }, assignments: { active: [{ principalId: "g-other", directoryScopeId: "/" }] } },
        ], ["g-tier0"]);
        expect(Object.keys(rolesOfGroups)).toEqual(["g-tier0"]);
        const a = deriveWriteAccess(input({
            groupEligible: [{ groupId: "g-tier0", accessId: "member", memberType: "direct" }],
            rolesOfGroups,
        }));
        expect(a.roles.state).toBe("activate-first");
        expect(a.overall).toBe("activate-first");
        expect(a.headline).toMatchObject({ kind: "activate", target: { kind: "role", role: { name: "Privileged Role Administrator", viaGroup: true, throughGroup: { groupId: "g-tier0", groupName: "Tier 0 Admins" } } } });
        // An eligible ownership is not a membership: no role through it
        expect(deriveWriteAccess(input({ groupEligible: [{ groupId: "g-tier0", accessId: "owner" }], rolesOfGroups })).roles.state).toBe("closed");
    });

    it("a custom role counts when it holds both group actions", () => {
        expect(deriveWriteAccess(input({ activeRoles: [active("custom-groups")] })).groups["g-news"]).toMatchObject({ state: "open", reason: "Group Helpers" });
        expect(deriveWriteAccess(input({ activeRoles: [active("custom-read")] })).groups["g-news"].state).toBe("closed");
    });

    it("an eligible-only group owner activates first (T2b); an active PIM owner, also ended (T2h), counts", () => {
        const eligible = deriveWriteAccess(input({ groupEligible: [{ groupId: "g-news", accessId: "owner", memberType: "direct" }] }));
        expect(eligible.groups["g-news"]).toMatchObject({ state: "activate-first", reason: "Activate your ownership of News first" });
        expect(eligible.overall).toBe("activate-first");
        expect(eligible.headline).toEqual({ kind: "activate", target: { kind: "ownership", groupId: "g-news", groupName: "News" } });
        const ended = deriveWriteAccess(input({ groupActive: [{ groupId: "g-news", accessId: "owner", assignmentType: "activated", endDateTime: "2026-10-03T18:59:10Z" }] }));
        expect(ended.groups["g-news"]).toMatchObject({ state: "open", owner: true });
        const member = deriveWriteAccess(input({ groupActive: [{ groupId: "g-news", accessId: "member", assignmentType: "assigned" }] }));
        expect(member.groups["g-news"].state).toBe("closed");
    });

    it("a role that allows changes without the app permission asks for consent", () => {
        const a = deriveWriteAccess(input({ activeRoles: [active(T.privilegedRoleAdministrator)], appPermission: { directoryRoles: "notGranted", pimGroups: "notGranted" } }));
        expect(a.overall).toBe("consent");
        const groupsOnly = deriveWriteAccess(input({ activeRoles: [active(T.privilegedRoleAdministrator)], appPermission: { directoryRoles: "notGranted", pimGroups: "granted" } }));
        expect(groupsOnly.overall).toBe("open");
    });

    it("an owned group the app has not loaded counts as open; an owned dynamic group is locked", () => {
        const a = deriveWriteAccess(input({ ownedGroups: [
            { id: "g-soc", displayName: "Security Operations Center", isAssignableToRole: null },
            { id: "g-dynowned", displayName: "Dynamic owned", membershipRule: "user.department -eq \"IT\"" },
        ] }));
        expect(a.groups["g-soc"]).toMatchObject({ state: "open", owner: true, isUnderPim: false });
        expect(a.groups["g-dynowned"].state).toBe("locked");
        expect(a.otherGroups.openCount).toBe(1);
    });

    it("a tenant-wide role opens its area before any group is loaded", () => {
        const pra = deriveWriteAccess(input({ groups: [], activeRoles: [active(T.privilegedRoleAdministrator)] }));
        expect(pra.roleAssignableGroups).toMatchObject({ state: "open", reach: "all", total: 0 });
        const ga = deriveWriteAccess(input({ groups: [], activeRoles: [active(T.groupsAdministrator)] }));
        expect(ga.otherGroups).toMatchObject({ state: "open", reach: "all" });
        expect(ga.overall).toBe("open");
    });

    it("a custom group role scoped to one group opens that group only", () => {
        const a = deriveWriteAccess(input({
            groups: [...groups, { id: "6f2c9a1e-4b7d-4e2a-9c1f-3a8d5e7b9c20", displayName: "Scoped", isAssignableToRole: null, isUnderPim: true }],
            activeRoles: [active("custom-groups", { directoryScopeId: "/6f2c9a1e-4b7d-4e2a-9c1f-3a8d5e7b9c20" })],
        }));
        expect(a.groups["6f2c9a1e-4b7d-4e2a-9c1f-3a8d5e7b9c20"].state).toBe("open");
        expect(a.groups["g-news"].state).toBe("closed");
        expect(a.otherGroups).toMatchObject({ state: "open", reach: "some", openCount: 1 });
    });

    it("only group roles on a unit or a group make their groups worth reading", () => {
        const id = "0b5d7e1f-2a3c-4d5e-8f90-1a2b3c4d5e6f";
        const roles = [
            active(T.groupsAdministrator, { directoryScopeId: "/administrativeUnits/au1" }),
            active(T.privilegedRoleAdministrator, { directoryScopeId: "/administrativeUnits/au2" }),
            active("custom-groups", { directoryScopeId: "/administrativeUnits/au3" }),
            active("custom-groups", { directoryScopeId: `/${id}` }),
            active("custom-read", { directoryScopeId: "/administrativeUnits/au4" }),
        ];
        expect(scopesToRead(roles, defs)).toEqual({ units: ["au1", "au3"], groups: [id] });
        // Without definitions (the roles load failed) a custom role cannot be told apart: every scope is read
        expect(scopesToRead(roles, [])).toEqual({ units: ["au1", "au2", "au3", "au4"], groups: [id] });
    });
});

describe("groupsOutsideLoad (FIX-14)", () => {
    it("lists owned groups the app did not load, so Edit shows what the start page counts", () => {
        const a = deriveWriteAccess(input({ ownedGroups: [{ id: "g-mine", displayName: "Mine", isAssignableToRole: null }, { id: "g-sales", displayName: "Sales" }] }));
        const extra = groupsOutsideLoad(a, [{ group: { id: "g-tier0" } }, { group: { id: "G-NEWS" } }, { group: { id: "g-sales" } }, { group: { id: "g-dyn" } }, { group: { id: "g-synced" } }]);
        expect(extra.map((g) => g.group.id)).toEqual(["g-mine"]);
        expect(extra[0]).toMatchObject({ isManaged: false, assignments: [], group: { displayName: "Mine" } });
        expect(groupsOutsideLoad(null, [])).toEqual([]);
    });
});
