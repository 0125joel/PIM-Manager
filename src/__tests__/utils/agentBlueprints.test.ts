import { describe, expect, it } from "vitest";
import { isCachedKey } from "@/utils/cacheUtils";
import { COPILOT_STUDIO_BLUEPRINT_APP_ID } from "@/config/constants";
import { buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";
import { blueprintCacheKey, collectBlueprintAppIds, readBlueprintCache, writeBlueprintCache } from "@/utils/agentBlueprints";

describe("agent blueprint helpers", () => {
    it("collects distinct non-Copilot blueprint appIds from roles and groups", () => {
        const roles = buildReportRoles();
        const role = roles.find((item) => item.definition.id === "role-app")!;
        const ops = role.assignments.active[1];
        const opsPrincipal = ops.principal!;
        ops.principal = { ...opsPrincipal, agentIdentityBlueprintId: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" };
        role.assignments.active.push({
            ...ops,
            id: "duplicate-blueprint",
            principal: { ...ops.principal, id: "agent-ops-copy" },
        });
        role.assignments.active.push({
            ...ops,
            id: "another-blueprint",
            principal: { ...ops.principal, id: "agent-other", agentIdentityBlueprintId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
        });

        const groups = buildReportGroups();
        const group = groups.find((item) => item.group.id === "g-finance")!;
        group.assignments.push({
            ...group.assignments[0],
            id: "group-agent-blueprint",
            principalId: "agent-group",
            principal: { "@odata.type": "#microsoft.graph.agentIdentity", id: "agent-group", agentIdentityBlueprintId: "cccccccc-cccc-cccc-cccc-cccccccccccc" },
        });

        expect(collectBlueprintAppIds(roles, groups)).toEqual([
            "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            "cccccccc-cccc-cccc-cccc-cccccccccccc",
        ]);
        expect(collectBlueprintAppIds(roles, groups)).not.toContain(COPILOT_STUDIO_BLUEPRINT_APP_ID);
    });

    it("returns no ids when there are no agents", () => {
        const roles = buildReportRoles();
        roles.forEach((role) => {
            role.assignments.permanent = [];
            role.assignments.eligible = [];
            role.assignments.active = [];
        });
        const groups = buildReportGroups();
        groups.forEach((group) => { group.assignments = []; });
        expect(collectBlueprintAppIds(roles, groups)).toEqual([]);
    });

    it("reads only string values from valid blueprint cache objects", () => {
        let raw: string | null = null;
        const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
        expect(readBlueprintCache("t1", storage)).toEqual(new Map());
        raw = "{broken";
        expect(readBlueprintCache("t1", storage)).toEqual(new Map());
        raw = '["name"]';
        expect(readBlueprintCache("t1", storage)).toEqual(new Map());
        raw = '{"app-a":"Agent A","app-b":4}';
        expect(readBlueprintCache("t1", storage)).toEqual(new Map([["app-a", "Agent A"]]));
    });

    it("writes and reads a blueprint cache using a session storage key", () => {
        let raw: string | null = null;
        const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
        const names = new Map([["app-a", "Agent A"], ["app-b", "Agent B"]]);
        writeBlueprintCache("t1", names, storage);
        expect(readBlueprintCache("t1", storage)).toEqual(names);
        expect(blueprintCacheKey("t1")).toBe("pim_agent_blueprints:t1");
        expect(isCachedKey(blueprintCacheKey("t1"))).toBe(true);
    });

    it("does not throw when storage cannot persist the blueprint cache", () => {
        const storage = { getItem: () => null, setItem: () => { throw new Error("Storage is full"); } };
        expect(() => writeBlueprintCache("t1", new Map([["app-a", "Agent A"]]), storage)).not.toThrow();
    });
});
