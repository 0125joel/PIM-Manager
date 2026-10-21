import { describe, expect, it } from "vitest";
import { buildReportGroups, buildReportRoles, buildReportRules, REPORT_AUTH_CONTEXTS } from "@/__tests__/fixtures/reportFixture";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AccessModelCatalog } from "@/utils/accessModelCatalog";
import { EMPTY_BASKET, type Basket } from "@/utils/configureBasket";
import {
    NO_GROUP_WRITE,
    NO_ROLE_WRITE,
    NOT_CHECKED,
    NO_PIM_SETTINGS,
    buildGroupRow,
    buildRoleRow,
    buildTargetList,
    defaultTargetId,
    describeActivationDuration,
    describeGroupHead,
    describePolicySummary,
    describeRoleHead,
    roleLock,
    toggleChip,
    type TargetChip,
    type TargetListContext,
} from "@/utils/configureTargets";
import { DYNAMIC_OR_SYNCED_REASON, ROLE_TEMPLATES, deriveWriteAccess, type WriteAccessInput } from "@/utils/writeAccess";

const roles = buildReportRoles();
const groups = buildReportGroups();
const T = ROLE_TEMPLATES;
const defs = [
    { id: T.privilegedRoleAdministrator, templateId: T.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true },
    { id: T.groupsAdministrator, templateId: T.groupsAdministrator, displayName: "Groups Administrator", isBuiltIn: true },
];
const groupLikes = groups.map((g) => ({ id: g.group.id, displayName: g.group.displayName, isAssignableToRole: g.group.isAssignableToRole ?? null, isUnderPim: g.isManaged !== false }));
const access = (over: Partial<WriteAccessInput> = {}) => deriveWriteAccess({
    activeRoles: [], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
    appPermission: { directoryRoles: "granted", pimGroups: "granted" }, roleDefinitions: defs, groups: groupLikes, ...over,
});
const pra = { roleDefinitionId: T.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct" };
const ctx = (over: Partial<TargetListContext> = {}): TargetListContext => ({ access: access({ activeRoles: [pra] }), basket: EMPTY_BASKET, authenticationContexts: REPORT_AUTH_CONTEXTS, isPoliciesLoading: false, ...over });
const role = (id: string) => roles.find((r) => r.definition.id === id) as RoleDetailData;
const group = (id: string) => groups.find((g) => g.group.id === id) as PimGroupData;

describe("summary of a policy (spec 5.2)", () => {
    it("requirement, duration and approval", () => {
        expect(describePolicySummary(buildReportRules({ duration: "PT4H" }), [])).toBe("Multifactor authentication · 4 hours");
        expect(describePolicySummary(buildReportRules({ mfa: false }), [])).toBe("Nothing · 8 hours");
        expect(describePolicySummary(buildReportRules({ duration: "PT2H", authContext: "c1", approvers: [{ kind: "user", id: "u1" }] }), REPORT_AUTH_CONTEXTS)).toBe("Phishing-resistant · 2 hours · Approval");
        expect(describePolicySummary(buildReportRules({ authContext: "c9" }), [])).toBe("Authentication context · 8 hours");
        expect(describePolicySummary(null, [])).toBeNull();
    });

    it("durations below an hour and with half hours", () => {
        expect(describeActivationDuration("PT30M")).toBe("30 minutes");
        expect(describeActivationDuration("PT1H30M")).toBe("1.5 hours");
        expect(describeActivationDuration("PT1H")).toBe("1 hour");
        expect(describeActivationDuration(undefined)).toBeNull();
    });

    it("group rules without a target read the same", () => {
        const rules = buildReportRules({ duration: "PT2H" }).map((r) => ({ ...r, target: undefined }));
        expect(describePolicySummary(rules, [])).toBe("Multifactor authentication · 2 hours");
    });

    it("a role still loading never shows a default", () => {
        const noPolicy = { ...role("role-pra"), policy: null } as RoleDetailData;
        expect(buildRoleRow(noPolicy, ctx({ isPoliciesLoading: true })).summary).toBe("Loading settings");
        expect(buildRoleRow(role("role-failed"), ctx({ isPoliciesLoading: true })).summary).toBe("Settings not loaded");
    });
});

describe("rows (spec 5.2)", () => {
    it("tags, people and the violet dot", () => {
        const basket: Basket = { changes: [{ kind: "setting", target: { kind: "role", id: "role-ga" }, field: "requireApproval", from: false, to: true, source: { from: "edit" } }] };
        const ga = buildRoleRow(role("role-ga"), ctx({ basket }));
        expect(ga).toMatchObject({ name: "Global Administrator", tags: ["privileged"], people: 5, hasChanges: true, lock: null });
        expect(buildRoleRow(role("role-chr"), ctx()).tags).toEqual(["custom"]);
        expect(buildRoleRow(role("role-pra"), ctx()).hasChanges).toBe(false);
    });

    it("roles are locked with the reason when the admin cannot change them", () => {
        expect(buildRoleRow(role("role-ga"), ctx({ access: access() })).lock).toBe("Needs Privileged Role Administrator or Global Administrator.");
        expect(buildRoleRow(role("role-ga"), ctx({ access: access({ eligibleRoles: [pra] }) })).lock).toBe("Activate Privileged Role Administrator first.");
        expect(buildRoleRow(role("role-ga"), ctx({ access: access({ activeRoles: [pra], appPermission: { directoryRoles: "notGranted", pimGroups: "granted" } }) })).lock).toBe(NO_ROLE_WRITE);
    });

    it("groups: owned, role-assignable, the decision of the access check", () => {
        const owner = access({ ownedGroups: [{ id: "g-dev", displayName: "Dev Leads" }] });
        const dev = buildGroupRow(group("g-dev"), ctx({ access: owner }));
        expect(dev).toMatchObject({ tags: ["roleAssignable", "owned"], lock: null, section: "main", summary: "Multifactor authentication · 4 hours" });
        expect(buildGroupRow(group("g-finance"), ctx({ access: owner })).lock).toMatch(/^Needs Privileged Role Administrator, Global Administrator or ownership of this group\.$/);
        expect(buildGroupRow(group("g-dev"), ctx({ access: access({ activeRoles: [pra], appPermission: { directoryRoles: "granted", pimGroups: "notGranted" } }) })).lock).toBe(NO_GROUP_WRITE);
        const unknown = { ...group("g-dev"), group: { ...group("g-dev").group, id: "g-new" } };
        expect(buildGroupRow(unknown, ctx()).lock).toBe(NOT_CHECKED);
    });

    it("groups not under PIM sit in their own section; dynamic and synced ones are locked", () => {
        const tier0 = buildGroupRow(group("g-tier0"), ctx());
        expect(tier0).toMatchObject({ section: "notUnderPim", tags: ["roleAssignable", "notUnderPim"], summary: NO_PIM_SETTINGS, people: 3, lock: null });
        const dynamic = { ...group("g-tier0"), group: { ...group("g-tier0").group, membershipRule: "user.department -eq \"Sales\"" } };
        expect(buildGroupRow(dynamic, ctx()).lock).toBe(DYNAMIC_OR_SYNCED_REASON);
        const synced = { ...group("g-tier0"), group: { ...group("g-tier0").group, onPremisesSyncEnabled: true } };
        expect(buildGroupRow(synced, ctx()).lock).toBe(DYNAMIC_OR_SYNCED_REASON);
    });
});

describe("filters and search (spec 5.2)", () => {
    const list = (view: "roles" | "groups", chips: TargetChip[], q = "") => buildTargetList(view, roles, groups, ctx(), new Set(chips), q);

    it("privileged first, then people, then the name", () => {
        const rows = list("roles", []).rows;
        expect(rows[0].name).toBe("Global Administrator");
        const firstPlain = rows.findIndex((r) => !r.isPrivileged);
        expect(rows.slice(0, firstPlain).every((r) => r.isPrivileged)).toBe(true);
        expect(rows.slice(firstPlain).every((r) => !r.isPrivileged)).toBe(true);
    });

    it("chips combine with AND, the search narrows further", () => {
        const custom = list("roles", ["custom"]).rows;
        expect(custom.every((r) => !r.isBuiltIn)).toBe(true);
        expect(list("roles", ["custom", "withoutAssignments"]).rows.map((r) => r.name)).toEqual(["Contoso Audit Reader"]);
        expect(list("roles", ["withAssignments", "withoutAssignments"]).rows).toEqual([]);
        expect(list("roles", ["privileged"], "admin").rows.every((r) => r.isPrivileged && /admin/i.test(r.name))).toBe(true);
        expect(list("roles", []).total).toBe(roles.length);
    });

    it("groups not under PIM only when asked; their count is not in the total", () => {
        expect(list("groups", []).notUnderPim).toEqual([]);
        expect(list("groups", []).total).toBe(groups.filter((g) => g.isManaged !== false).length);
        expect(list("groups", ["notUnderPim"]).notUnderPim.map((r) => r.id).sort()).toEqual(["g-exo", "g-legacy", "g-soc", "g-teams", "g-tier0"]);
        expect(list("groups", ["roleAssignable"]).rows.every((r) => r.isRoleAssignable)).toBe(true);
    });

    it("a chip of the other view is dropped when toggling", () => {
        expect([...toggleChip(new Set<TargetChip>(["privileged"]), "owned", "groups")]).toEqual(["owned"]);
        expect([...toggleChip(new Set<TargetChip>(["privileged", "custom"]), "custom", "roles")]).toEqual(["privileged"]);
    });
});

describe("detail head (spec 5.3)", () => {
    const catalog = { roles: [{ templateId: "62e90394-69f5-4237-9190-012177145e10", displayName: "Global Administrator", plane: "Control", securityLevel: "Privileged" }] } as unknown as AccessModelCatalog;

    it("the catalog place when the catalog knows the role", () => {
        expect(describeRoleHead(role("role-ga"), catalog, ctx())).toMatchObject({ target: { kind: "role", id: "role-ga" }, place: "Control plane · Privileged", withAccess: "5 with access" });
        expect(describeRoleHead(role("role-pra"), catalog, ctx()).place).toBeNull();
        expect(describeRoleHead(role("role-ga"), null, ctx()).place).toBeNull();
    });

    it("groups count the side in the URL", () => {
        expect(describeGroupHead(group("g-helpdesk1"), "member", ctx())).toMatchObject({ target: { kind: "group", id: "g-helpdesk1", access: "member" }, withAccess: "3 members · 1 owner" });
        expect(describeGroupHead(group("g-helpdesk1"), "owner", ctx()).withAccess).toBe("3 members · 1 owner");
    });
});

describe("after review", () => {
    const list = (view: "roles" | "groups", chips: TargetChip[], q = "", c = ctx()) => buildTargetList(view, roles, groups, c, new Set(chips), q);

    it("search ignores case; durations over a day keep their words", () => {
        expect(list("roles", [], "GLOBAL ADMIN").rows.map((r) => r.name)).toContain("Global Administrator");
        expect(describeActivationDuration("P2D")).toBe("2 days");
    });

    it("chips combine with AND across both sections", () => {
        const both = list("groups", ["notUnderPim", "roleAssignable"]);
        expect(both.rows.every((r) => r.isRoleAssignable)).toBe(true);
        expect(both.notUnderPim.every((r) => r.isRoleAssignable)).toBe(true);
        expect(list("groups", []).outsideTotal).toBe(5);
    });

    it("a role to activate through a group membership; an activate-first reason gets its full stop", () => {
        const through = access({ eligibleRoles: [pra] });
        through.roles.activate = { kind: "role", role: { roleDefinitionId: pra.roleDefinitionId, name: "Privileged Role Administrator", end: null, viaGroup: false, scope: "/", throughGroup: { groupId: "g-x", groupName: "PRA Admins" } } };
        expect(roleLock(through)).toBe("Activate your membership of PRA Admins first.");
        const owner = access({ groupEligible: [{ groupId: "g-dev", accessId: "owner" }] });
        const reason = buildGroupRow(group("g-dev"), ctx({ access: owner })).lock;
        expect(reason).toBe("Activate your ownership of Dev Leads first.");
    });

    it("the head of a group not under PIM counts its members", () => {
        expect(describeGroupHead(group("g-tier0"), "member", ctx()).withAccess).toBe("3 with access");
    });

    it("the head carries the lock of the row before search and filters", () => {
        const head = describeRoleHead(role("role-ga"), null, ctx({ access: access() }));
        expect(head.lock).toBe("Needs Privileged Role Administrator or Global Administrator.");
        expect(list("roles", [], "nothing matches this", ctx({ access: access() })).rows).toEqual([]);
    });

    it("the default target skips locked rows", () => {
        const owner = access({ ownedGroups: [{ id: "g-finance", displayName: "Finance Approvers" }] });
        expect(defaultTargetId(list("groups", [], "", ctx({ access: owner })))).toBe("g-finance");
        expect(defaultTargetId(list("roles", [], "", ctx({ access: owner })))).toBeUndefined();
    });
});
