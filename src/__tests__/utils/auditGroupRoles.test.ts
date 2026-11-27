import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import { linkGroupRoles } from "@/utils/auditGroupRoles";
import { filterNoActivationRows, roleNamesByGroup, type NoActivationRow } from "@/utils/auditNoActivation";
import { matchesAuditWho } from "@/utils/auditView";

// Invented data only
const GROUP = "g-admins";

function event(over: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id: "e1",
        time: "2026-11-01T10:00:00.000Z",
        kind: "usage",
        environment: "group",
        sentence: "Megan Bowen activated member of Contoso Admins",
        actor: { name: "Megan Bowen", id: "u1", kind: "person" },
        target: { name: "Megan Bowen", id: "u1" },
        role: { name: "member of Contoso Admins", id: GROUP.toUpperCase() },
        scope: "",
        result: "success",
        source: "graph",
        correlationId: "c1",
        ...over,
    };
}

function role(displayName: string, list: "active" | "permanent" | "eligible", principalId = GROUP, type = "group"): RoleDetailData {
    const holder = { principalId, principal: { "@odata.type": `#microsoft.graph.${type}` } };
    return {
        definition: { id: displayName, displayName },
        assignments: { active: [], permanent: [], eligible: [], [list]: [holder] },
    } as unknown as RoleDetailData;
}

describe("linkGroupRoles", () => {
    it("names the group and the roles it holds, active or permanent, sorted", () => {
        const [linked] = linkGroupRoles([event()], [role("Reports Reader", "active"), role("Global Reader", "permanent")]);
        expect(linked.viaGroup).toBe("Contoso Admins");
        expect(linked.groupRoles).toEqual(["Global Reader", "Reports Reader"]);
        expect(linked.role.id).toBe(GROUP.toUpperCase());
        expect(linked.environment).toBe("group");
    });

    it("links every outcome of an activation", () => {
        const [failed] = linkGroupRoles([event({ result: "failure" })], [role("Global Reader", "active")]);
        expect(failed.viaGroup).toBe("Contoso Admins");
    });

    it("links an assignment to the group as well", () => {
        const [assigned] = linkGroupRoles([event({ kind: "assignment" })], [role("Global Reader", "active")]);
        expect(assigned.viaGroup).toBe("Contoso Admins");
        expect(assigned.groupRoles).toEqual(["Global Reader"]);
    });

    it("leaves what does not come through a role of the group as it is", () => {
        const roles = [role("Global Reader", "active")];
        const plain = [
            event({ role: { name: "owner of Contoso Admins", id: GROUP } }),
            event({ kind: "setting" }),
            event({ environment: "role" }),
            event({ role: { name: "member of Other", id: "g-other" } }),
        ];
        expect(linkGroupRoles(plain, roles)).toEqual(plain);
        expect(linkGroupRoles([event()], [role("Global Reader", "eligible")])[0].viaGroup).toBeUndefined();
        expect(linkGroupRoles([event()], [role("Global Reader", "active", GROUP, "user")])[0].viaGroup).toBeUndefined();
        expect(linkGroupRoles([event()], [])[0].viaGroup).toBeUndefined();
    });
});

describe("Who: Groups means the same in both views", () => {
    it("keeps in Events the group itself and a person through a group, not a setting or a direct person", () => {
        expect(matchesAuditWho(event({ target: { name: "Contoso Admins", id: GROUP }, targetIsGroup: true, environment: "role" }), "group")).toBe(true);
        expect(matchesAuditWho(event(), "group")).toBe(true);
        expect(matchesAuditWho(event(), "user")).toBe(true);
        expect(matchesAuditWho(event({ environment: "role", viaGroup: "Contoso Admins" }), "group")).toBe(true);
        expect(matchesAuditWho(event({ environment: "role" }), "group")).toBe(false);
        expect(matchesAuditWho(event({ kind: "setting", target: undefined, actor: { name: "Alex", id: "u2", kind: "person" } }), "group")).toBe(false);
    });

    it("keeps in No activation the group itself and a person through a group, not a direct person", () => {
        const row = (over: Partial<NoActivationRow>): NoActivationRow => ({ id: "r", who: "Megan", whoId: "u1", holderKind: "user", isPerson: true, environment: "role", resourceName: "Role", resourceId: "x", scopeName: "Directory", scopeId: "/", type: "Eligible", typeText: "Eligible", state: "none", activationText: "", isWarning: true, isEmergency: false, isPrivileged: null, ...over }) as NoActivationRow;
        const kept = (rows: NoActivationRow[]) => filterNoActivationRows(rows, "both", "", { who: "group" }).length;
        expect(kept([row({ holderKind: "group" })])).toBe(1);
        expect(kept([row({ viaGroup: "Contoso Admins" })])).toBe(1);
        expect(kept([row({ environment: "group" })])).toBe(1);
        expect(kept([row({})])).toBe(0);
    });
});

describe("the roles a group holds in No activation", () => {
    it("lists them by lower case group id, active or permanent, sorted, and leaves out an eligible role", () => {
        const byGroup = roleNamesByGroup([role("Reports Reader", "active"), role("Global Reader", "permanent"), role("Helpdesk Administrator", "eligible")]);
        expect(byGroup.get(GROUP)).toEqual(["Global Reader", "Reports Reader"]);
    });

    it("finds the row of a member by a role the group holds", () => {
        const row = { id: "r", who: "Megan", whoId: "u1", holderKind: "user", isPerson: true, environment: "group", resourceName: "Member of Contoso Admins", resourceId: GROUP, scopeName: "Directory", scopeId: "/", type: "Eligible", typeText: "Eligible", state: "none", activationText: "", isWarning: true, isEmergency: false, isPrivileged: null, groupRoles: ["Global Reader"] } as NoActivationRow;
        expect(filterNoActivationRows([row], "both", "global reader")).toHaveLength(1);
        expect(filterNoActivationRows([row], "both", "exchange")).toHaveLength(0);
    });
});
