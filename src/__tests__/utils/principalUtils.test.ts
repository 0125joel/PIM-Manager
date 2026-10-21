import { describe, it, expect } from "vitest";
import { AGENT_ORIGIN_NAMES, getAgentOrigin, getAssignmentMemberType, getPrincipalKind, getPrincipalKindLabel, isAgentKind, toBasicKind, type PrincipalKind } from "@/utils/principalUtils";

describe("getPrincipalKind", () => {
    it("reads the three Graph types", () => {
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.user" })).toBe("user");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.group" })).toBe("group");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.servicePrincipal" })).toBe("servicePrincipal");
    });
    it("is case insensitive for the type name and accepts a bare type name", () => {
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.Group" })).toBe("group");
        expect(getPrincipalKind({ "@odata.type": "serviceprincipal" })).toBe("servicePrincipal");
    });
    it("returns unknown for missing or other types", () => {
        expect(getPrincipalKind(undefined)).toBe("unknown");
        expect(getPrincipalKind(null)).toBe("unknown");
        expect(getPrincipalKind({})).toBe("unknown");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.device" })).toBe("unknown");
    });
    it("recognizes the three Agent ID principal types", () => {
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.agentIdentity" })).toBe("agentIdentity");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.agentUser" })).toBe("agentUser");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.agentIdentityBlueprintPrincipal" })).toBe("agentIdentityBlueprintPrincipal");
    });
    it("recognizes the F2 base-type agent identity without confusing other service principals", () => {
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "ServiceIdentity" })).toBe("agentIdentity");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "Application" })).toBe("servicePrincipal");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.servicePrincipal", servicePrincipalType: "ManagedIdentity" })).toBe("servicePrincipal");
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.servicePrincipal" })).toBe("servicePrincipal");
    });
    it("recognizes Agent ID type names without casing differences", () => {
        expect(getPrincipalKind({ "@odata.type": "#microsoft.graph.AgentIdentity" })).toBe("agentIdentity");
    });
});

describe("getPrincipalKindLabel", () => {
    it("names a service principal an app", () => {
        expect(getPrincipalKindLabel("servicePrincipal")).toBe("app");
        expect(getPrincipalKindLabel("user")).toBe("user");
        expect(getPrincipalKindLabel("unknown")).toBe("principal");
    });
    it("uses Microsoft's names for Agent ID kinds", () => {
        expect(getPrincipalKindLabel("agentIdentity")).toBe("agent identity");
        expect(getPrincipalKindLabel("agentUser")).toBe("agent's user account");
        expect(getPrincipalKindLabel("agentIdentityBlueprintPrincipal")).toBe("agent identity blueprint principal");
    });
});

describe("isAgentKind", () => {
    it("is true only for the three Agent ID kinds", () => {
        const kinds: PrincipalKind[] = ["user", "group", "servicePrincipal", "agentIdentity", "agentUser", "agentIdentityBlueprintPrincipal", "unknown"];
        expect(kinds.filter(isAgentKind)).toEqual(["agentIdentity", "agentUser", "agentIdentityBlueprintPrincipal"]);
    });
});

describe("toBasicKind", () => {
    it("maps Agent ID kinds to Configure's supported principal kinds", () => {
        const mappings: [PrincipalKind, ReturnType<typeof toBasicKind>][] = [
            ["user", "user"],
            ["group", "group"],
            ["servicePrincipal", "servicePrincipal"],
            ["agentIdentity", "servicePrincipal"],
            ["agentUser", "user"],
            ["agentIdentityBlueprintPrincipal", "servicePrincipal"],
            ["unknown", "unknown"],
        ];
        for (const [kind, expected] of mappings) expect(toBasicKind(kind)).toBe(expected);
    });
});

describe("getAgentOrigin", () => {
    it("recognizes the Microsoft Copilot Studio blueprint appId case-insensitively", () => {
        expect(getAgentOrigin({ agentIdentityBlueprintId: "25664C89-CEA5-4AB6-B924-A54FD8A19AE0" })).toBe("copilotStudio");
        expect(AGENT_ORIGIN_NAMES.copilotStudio).toBe("Microsoft Copilot Studio");
    });
    it("returns null when no known blueprint id is present", () => {
        expect(getAgentOrigin({ agentIdentityBlueprintId: "00000000-0000-0000-0000-000000000000" })).toBeNull();
        expect(getAgentOrigin(null)).toBeNull();
        expect(getAgentOrigin(undefined)).toBeNull();
        expect(getAgentOrigin({})).toBeNull();
    });
});

describe("getAssignmentMemberType", () => {
    it("prefers the memberType Graph reports", () => {
        expect(getAssignmentMemberType({ memberType: "Group" })).toBe("Group");
        expect(getAssignmentMemberType({ memberType: "group" })).toBe("Group");
        expect(getAssignmentMemberType({ memberType: "Direct", principal: { "@odata.type": "#microsoft.graph.group" } })).toBe("Direct");
    });
    it("derives it from the principal when memberType is missing", () => {
        expect(getAssignmentMemberType({ principal: { "@odata.type": "#microsoft.graph.group" } })).toBe("Group");
        expect(getAssignmentMemberType({ principal: { "@odata.type": "#microsoft.graph.user" } })).toBe("Direct");
    });
    it("counts a service principal as a direct member instead of dropping it", () => {
        expect(getAssignmentMemberType({ principal: { "@odata.type": "#microsoft.graph.servicePrincipal" } })).toBe("Direct");
    });
    it("counts an agent identity as a direct member", () => {
        expect(getAssignmentMemberType({ principal: { "@odata.type": "#microsoft.graph.agentIdentity" } })).toBe("Direct");
    });
    it("is null without memberType and principal type", () => {
        expect(getAssignmentMemberType({})).toBeNull();
        expect(getAssignmentMemberType({ principal: {} })).toBeNull();
    });
});
