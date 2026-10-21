import { describe, expect, it } from "vitest";
import { agent, agentBase, agentUser, group, role, user } from "./../fixtures/dashboardFilterFixtures";
import { withoutAgents } from "@/utils/agentCounting";

describe("withoutAgents", () => {
    it("removes derived and base-type agent role assignments while keeping users and the role", () => {
        const roles = [role({
            id: "role-with-agents",
            eligible: [{ principalId: "agent-eligible", principal: agent("agent-eligible") }],
            permanent: [{ principalId: "agent-permanent", principal: agentBase("agent-permanent") }],
            active: [{ principalId: "person", principal: user("person") }],
        })];

        const result = withoutAgents(roles, []);

        expect(result.roles).toHaveLength(1);
        expect(result.roles[0].assignments.permanent).toEqual([]);
        expect(result.roles[0].assignments.eligible).toEqual([]);
        expect(result.roles[0].assignments.active.map((item) => item.principalId)).toEqual(["person"]);
    });

    it("keeps a role with empty assignment lists when it was held only by agents", () => {
        const roles = [role({
            id: "agents-only",
            permanent: [{ principalId: "blueprint", principal: { id: "blueprint", "@odata.type": "#microsoft.graph.agentIdentityBlueprintPrincipal" } }],
            eligible: [{ principalId: "agent", principal: agent("agent") }],
            active: [{ principalId: "agent-user", principal: agentUser("agent-user") }],
        })];

        expect(withoutAgents(roles, []).roles[0].assignments).toEqual({ permanent: [], eligible: [], active: [] });
    });

    it("removes an agent user from group assignments and keeps the user assignment", () => {
        const groups = [group("finance", [
            { principalId: "agent-user", principal: agentUser("agent-user"), assignmentType: "active" },
            { principalId: "person", principal: user("person"), assignmentType: "eligible" },
        ])];

        const result = withoutAgents([], groups);

        expect(result.groups[0].assignments.map((assignment) => assignment.principalId)).toEqual(["person"]);
    });

    it("preserves content when there are no agents", () => {
        const roles = [role({ id: "ordinary", active: [{ principalId: "person", principal: user("person") }] })];
        const groups = [group("ordinary-group", [{ principalId: "person", principal: user("person"), assignmentType: "eligible" }])];
        expect(withoutAgents(roles, groups)).toEqual({ roles, groups });
    });

    it("does not mutate frozen input arrays or objects", () => {
        const sourceRole = role({
            id: "frozen",
            eligible: [{ principalId: "agent", principal: agent("agent") }],
            active: [{ principalId: "person", principal: user("person") }],
        });
        Object.freeze(sourceRole.assignments.eligible[0].principal);
        Object.freeze(sourceRole.assignments.eligible[0]);
        Object.freeze(sourceRole.assignments.eligible);
        Object.freeze(sourceRole.assignments.active[0].principal);
        Object.freeze(sourceRole.assignments.active[0]);
        Object.freeze(sourceRole.assignments.active);
        Object.freeze(sourceRole.assignments.permanent);
        Object.freeze(sourceRole.assignments);
        Object.freeze(sourceRole);
        const roles = Object.freeze([sourceRole]);
        const sourceGroup = group("frozen-group", [{ principalId: "agent", principal: agentUser("agent"), assignmentType: "active" }]);
        Object.freeze(sourceGroup.assignments[0].principal);
        Object.freeze(sourceGroup.assignments[0]);
        Object.freeze(sourceGroup.assignments);
        Object.freeze(sourceGroup);
        const groups = Object.freeze([sourceGroup]);

        expect(() => withoutAgents(roles, groups)).not.toThrow();
        expect(sourceRole.assignments.eligible).toHaveLength(1);
        expect(sourceGroup.assignments).toHaveLength(1);
    });
});
