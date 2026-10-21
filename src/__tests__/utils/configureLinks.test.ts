import { describe, expect, it } from "vitest";
import { canChangeInConfigure, changeInConfigureHref, configureHref } from "@/utils/configureLinks";
import { ROLE_TEMPLATES, deriveWriteAccess, type WriteAccessInput } from "@/utils/writeAccess";

const T = ROLE_TEMPLATES;
const defs = [
    { id: T.privilegedRoleAdministrator, templateId: T.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true },
    { id: T.groupsAdministrator, templateId: T.groupsAdministrator, displayName: "Groups Administrator", isBuiltIn: true },
];
const groups = [{ id: "g1", displayName: "Tier 0 Admins", isAssignableToRole: true, isUnderPim: true }, { id: "g2", displayName: "Sales", isAssignableToRole: null, isUnderPim: true }];
const access = (over: Partial<WriteAccessInput> = {}) => deriveWriteAccess({
    activeRoles: [], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
    appPermission: { directoryRoles: "granted", pimGroups: "granted" }, roleDefinitions: defs, groups, ...over,
});
const pra = { roleDefinitionId: T.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct" };

describe("Change in Configure (spec 16)", () => {
    it("links into Edit with the target, the side and the tab", () => {
        expect(configureHref({ kind: "role", id: "role-ga" }, "assignment")).toBe("/configure?mode=edit&role=role-ga&tab=assignment");
        expect(configureHref({ kind: "group", id: "g1" })).toBe("/configure?mode=edit&view=groups&group=g1");
        // The Report passes its open tab with the target (C3-02)
        expect(configureHref({ kind: "role", id: "role-ga", tab: "notification" })).toBe("/configure?mode=edit&role=role-ga&tab=notification");
        expect(configureHref({ kind: "group", id: "g1", access: "owner" }, "who")).toBe("/configure?mode=edit&view=groups&group=g1&access=owner&tab=who");
    });

    it("shows only with write permission and an open target", () => {
        expect(canChangeInConfigure(null, { kind: "role", id: "r" })).toBe(false);
        expect(canChangeInConfigure(access({ activeRoles: [pra] }), { kind: "role", id: "r" })).toBe(true);
        expect(canChangeInConfigure(access({ activeRoles: [pra], appPermission: { directoryRoles: "notGranted", pimGroups: "granted" } }), { kind: "role", id: "r" })).toBe(false);
        expect(canChangeInConfigure(access(), { kind: "role", id: "r" })).toBe(false);
        const owner = access({ ownedGroups: [{ id: "g2", displayName: "Sales" }] });
        expect(canChangeInConfigure(owner, { kind: "group", id: "g2" })).toBe(true);
        expect(canChangeInConfigure(owner, { kind: "group", id: "g1" })).toBe(false);
        expect(canChangeInConfigure(access({ ownedGroups: [{ id: "g2", displayName: "Sales" }], appPermission: { directoryRoles: "granted", pimGroups: "notGranted" } }), { kind: "group", id: "g2" })).toBe(false);
    });

    it("the href or null", () => {
        expect(changeInConfigureHref(access({ activeRoles: [pra] }), { kind: "role", id: "role-ga" })).toBe("/configure?mode=edit&role=role-ga");
        expect(changeInConfigureHref(access(), { kind: "role", id: "role-ga" })).toBeNull();
    });
});
