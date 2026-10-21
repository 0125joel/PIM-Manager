import { describe, expect, it } from "vitest";
import { describeAccess, describeLastApplies, ENTRA_MY_GROUPS_URL, ENTRA_MY_ROLES_URL } from "@/utils/configureStart";
import { ROLE_TEMPLATES, deriveWriteAccess, type WriteAccessInput } from "@/utils/writeAccess";
import type { HistoryEntry } from "@/utils/configureHistory";

const NOW = new Date(2026, 9, 4, 12, 0);
const T = ROLE_TEMPLATES;
const defs = [
    { id: T.privilegedRoleAdministrator, templateId: T.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true },
    { id: T.groupsAdministrator, templateId: T.groupsAdministrator, displayName: "Groups Administrator", isBuiltIn: true },
];
const groups = [{ id: "g1", displayName: "Tier 0 Admins", isAssignableToRole: true, isUnderPim: true }, { id: "g2", displayName: "Sales", isAssignableToRole: null, isUnderPim: true }];
const access = (over: Partial<WriteAccessInput>) => deriveWriteAccess({
    activeRoles: [], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
    appPermission: { directoryRoles: "granted", pimGroups: "granted" }, roleDefinitions: defs, groups, ...over,
});
const pra = (end: string | null = null) => ({ roleDefinitionId: T.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct", endDateTime: end });

describe("describeAccess (spec 3.4, 15)", () => {
    it("checking while the hook waits or reads; failed offers Try again", () => {
        expect(describeAccess("waiting", null, null, NOW)).toMatchObject({ row: { kind: "checking", title: "Checking what you can change…" }, entries: { kind: "checking" } });
        expect(describeAccess("checking", null, null, NOW).row.kind).toBe("checking");
        expect(describeAccess("failed", null, null, NOW)).toMatchObject({ row: { kind: "failed", title: "Could not check your roles. Try again." }, entries: { kind: "closed" } });
    });

    it("open: green chips for the open areas and the active role with its end", () => {
        const view = describeAccess("ready", access({ activeRoles: [pra(new Date(2026, 9, 4, 14, 20).toISOString())] }), NOW, NOW);
        expect(view.row).toEqual({ kind: "open", title: "You can change", chips: ["Entra roles", "Groups under PIM"], via: "Privileged Role Administrator, active until 14:20" });
        expect(view.entries).toEqual({ kind: "none" });
        expect(view.details.map((d) => d.status)).toEqual(["Open", "Open", "Open"]);
        expect(view.detailsLine).toContain("at 12:00, and checked again before apply");
    });

    it("a recheck keeps the last decision, so the open mode stays mounted (U-01)", () => {
        const decided = access({ activeRoles: [pra(new Date(2026, 9, 4, 14, 20).toISOString())] });
        expect(describeAccess("checking", decided, NOW, NOW).row.kind).toBe("open");
        expect(describeAccess("checking", decided, NOW, NOW).entries).toEqual({ kind: "none" });
    });

    it("an owner of one group: '1 group'; a Groups Administrator: other groups only", () => {
        expect(describeAccess("ready", access({ ownedGroups: [{ id: "g1", displayName: "Tier 0 Admins" }] }), NOW, NOW).row).toMatchObject({ kind: "open", chips: ["1 group"], via: "Owner of the group" });
        const ga = describeAccess("ready", access({ activeRoles: [{ roleDefinitionId: T.groupsAdministrator, directoryScopeId: "/" }] }), NOW, NOW);
        expect(ga.row).toMatchObject({ kind: "open", chips: ["Groups under PIM"] });
        expect(ga.details.map((d) => d.status)).toEqual(["Closed", "Closed", "Open"]);
    });

    it("activate first: the role, or the group ownership with the groups link", () => {
        expect(describeAccess("ready", access({ eligibleRoles: [pra()] }), NOW, NOW).row).toEqual({ kind: "activate", title: "Activate Privileged Role Administrator first", text: "Activate Privileged Role Administrator to use Configure.", link: { label: "My roles in Entra", href: ENTRA_MY_ROLES_URL } });
        expect(describeAccess("ready", access({ groupEligible: [{ groupId: "g2", accessId: "owner" }] }), NOW, NOW).row).toMatchObject({ kind: "activate", title: "Activate your ownership of Sales first", link: { href: ENTRA_MY_GROUPS_URL } });
    });

    it("closed and permission missing", () => {
        expect(describeAccess("ready", access({}), NOW, NOW)).toMatchObject({ row: { kind: "closed", title: "Configure is closed for you." }, entries: { kind: "closed", text: "Closed until you can change something" } });
        const consent = describeAccess("ready", access({ activeRoles: [pra()], appPermission: { directoryRoles: "notGranted", pimGroups: "notGranted" } }), NOW, NOW);
        expect(consent).toMatchObject({ row: { kind: "consent", title: "Give PIM Manager permission to write first.", workloads: ["directoryRoles", "pimGroups"] }, entries: { kind: "consent", text: "Opens once PIM Manager may write" } });
        // One workload it may write is enough to open Configure; the details say which one cannot
        const partly = describeAccess("ready", access({ activeRoles: [pra()], appPermission: { directoryRoles: "notGranted", pimGroups: "granted" } }), NOW, NOW);
        expect(partly.row.kind).toBe("open");
        expect(partly.details[0].permission).toBe("Not granted");
    });
});

describe("describeLastApplies (spec 14.3)", () => {
    const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
        runId: "r1", at: new Date(2026, 9, 3, 16, 5).toISOString(), by: "Alex Wilber", targetCount: 3, results: { a: { status: "done" } },
        changes: Array.from({ length: 7 }, (_, i) => ({ kind: "setting", target: { kind: "role", id: `r${i % 3}` }, field: "requireApproval", from: false, to: true, source: { from: "edit" } })),
        snapshot: { schemaVersion: 1, app: { name: "PIM Manager", version: "x" }, tenant: { id: "t" }, readAt: {}, exportedAt: "", workloads: [], lists: { authenticationContexts: [], customExtensions: [] } },
        ...over,
    });

    it("'7 changes on 3 roles', 'Yesterday 16:05 by you', a status per entry", () => {
        expect(describeLastApplies([entry({})], ["Alex Wilber", "alexw@contoso.com"], NOW)).toEqual([{ runId: "r1", title: "7 changes on 3 roles", subline: "Yesterday 16:05 by you · snapshot saved", status: "done" }]);
        expect(describeLastApplies([entry({ by: "Joni Sherman" })], ["Alex Wilber"], NOW)[0].subline).toBe("Yesterday 16:05 by Joni Sherman · snapshot saved");
        expect(describeLastApplies([entry({ results: { a: { status: "failed", message: "x" } } })], [], NOW)[0].status).toBe("problems");
        expect(describeLastApplies([entry({ results: {} })], [], NOW)[0]).toMatchObject({ status: "unfinished", subline: expect.stringContaining("not finished") });
        expect(describeLastApplies([entry({ at: new Date(2026, 9, 4, 9, 30).toISOString(), targetCount: 1, changes: [{ kind: "remove", target: { kind: "group", id: "g", access: "owner" }, schedule: { principal: { id: "p", kind: "user", displayName: "P" }, type: "eligible", scope: "/", end: null }, source: { from: "edit" } }] })], [], NOW)[0])
            .toMatchObject({ title: "1 change on 1 group", subline: expect.stringMatching(/^Today 09:30/) });
    });
});
