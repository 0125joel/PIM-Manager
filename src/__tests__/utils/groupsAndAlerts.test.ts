import { describe, expect, it } from "vitest";
import { getEntraGroupUrl, getGroupsOutsidePim } from "@/utils/groupsOutsidePim";
import { summarizeAlerts } from "@/utils/alertSummary";
import type { SecurityAlert } from "@/types/securityAlerts.types";
import { buildFixtureGroups, buildFixtureRoles } from "../fixtures/dashboardBasicFixture";
import { group, groupPrincipal, role } from "../fixtures/dashboardFilterFixtures";

describe("getGroupsOutsidePim", () => {
    it("lists the three role-assignable groups outside PIM of the fixture", () => {
        const rows = getGroupsOutsidePim(buildFixtureGroups(), buildFixtureRoles());
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => [r.name, r.holds, r.memberCount])).toEqual([
            ["GRP-Exchange-Operators", ["Exchange Administrator"], 4],
            ["GRP-Helpdesk-Admins", ["Helpdesk Administrator"], 9],
            ["GRP-Legacy-Admins", [], 12],
        ]);
    });

    it("names the roles a group holds, groups with a role first, ignores managed and non-assignable groups", () => {
        const held = group("g-held", [], false);
        held.group.isAssignableToRole = true;
        const none = group("a-none", [], false);
        none.group.isAssignableToRole = true;
        const notAssignable = group("n", [], false);
        notAssignable.group.isAssignableToRole = false;
        const managed = group("m", []);
        managed.group.isAssignableToRole = true;
        const roles = [
            role({ id: "r1", name: "Helpdesk Administrator", eligible: [{ principalId: "G-HELD", principal: groupPrincipal("g-held") }] }),
            role({ id: "r2", name: "Exchange Administrator", active: [{ principalId: "g-held", principal: groupPrincipal("g-held") }] }),
        ];
        const rows = getGroupsOutsidePim([none, held, notAssignable, managed], roles);
        expect(rows.map((r) => r.id)).toEqual(["g-held", "a-none"]);
        expect(rows[0].holds).toEqual(["Exchange Administrator", "Helpdesk Administrator"]);
        expect(rows[1].holds).toEqual([]);
        expect(rows[1].memberCount).toBeUndefined();
    });

    it("builds an Entra admin center link", () => {
        expect(getEntraGroupUrl("abc")).toContain("groupId/abc");
    });
});

function alert(id: string, severity: string, count: number, active = true): SecurityAlert {
    return { id, alertDefinitionId: id, isActive: active, incidentCount: count, alertDefinition: { displayName: `Alert ${id} {0}`, description: "d", severityLevel: severity } } as unknown as SecurityAlert;
}

describe("summarizeAlerts", () => {
    const alerts = [alert("a", "low", 7), alert("b", "medium", 2), alert("c", "high", 1), alert("d", "medium", 0), alert("e", "low", 3, false), alert("f", "informational", 6)];

    it("sorts by severity, counts passed checks and fills the dot for medium and high", () => {
        const s = summarizeAlerts(alerts, new Set());
        expect(s.rows.map((r) => r.id)).toEqual(["c", "b", "a", "f"]);
        expect(s.rows.map((r) => r.isFilled)).toEqual([true, true, false, false]);
        expect(s.passedCount).toBe(2);
        expect(s.rows[0].title).toBe("Alert c 1");
    });

    it("hides dismissed alerts unless asked", () => {
        const dismissed = new Set(["c"]);
        expect(summarizeAlerts(alerts, dismissed).rows.map((r) => r.id)).not.toContain("c");
        expect(summarizeAlerts(alerts, dismissed).dismissedCount).toBe(1);
        expect(summarizeAlerts(alerts, dismissed, true).rows.map((r) => r.id)).toContain("c");
    });
});

describe("summarizeAlerts counts", () => {
    it("keeps the title count at the undismissed alerts when dismissed ones are shown", () => {
        const alerts = [alert("c", "high", 1), alert("b", "medium", 2)];
        const s = summarizeAlerts(alerts, new Set(["c"]), true);
        expect(s.rows).toHaveLength(2);
        expect(s.openCount).toBe(1);
        expect(s.rows.find((r) => r.id === "c")?.isDismissed).toBe(true);
    });
});

describe("describeLoadFailure", () => {
    it("names the status and only claims retries for 429 and 5xx", async () => {
        const { describeLoadFailure } = await import("@/utils/errorUtils");
        expect(describeLoadFailure({ statusCode: 503 })).toBe("Microsoft Graph answered 503 after 3 tries.");
        expect(describeLoadFailure({ statusCode: 404 })).toBe("Microsoft Graph answered 404.");
        expect(describeLoadFailure(new Error("Network down"))).toBe("Network down.");
        expect(describeLoadFailure(new Error("See https://aka.ms/msal for details"))).toBe("Microsoft Graph did not answer.");
    });
});
