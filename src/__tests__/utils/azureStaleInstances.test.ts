import { describe, expect, it } from "vitest";
import type { ArmRoleAssignment, ArmRoleScheduleInstance } from "@/types/azureResource.types";
import { reconcileInstances } from "@/utils/azureStaleInstances";
import { toAssignment } from "@/utils/azureScopes";

/**
 * Tenant test AU-17: below a subscription the reader cannot read, the instance list of a resource group held an inherited
 * instance of a removed assignment and left out the reader's real direct one; the role assignment list there had it right.
 */

const AUTH = "/providers/Microsoft.Authorization";
const SUB = "/subscriptions/s-1";
const RG = `${SUB}/resourceGroups/rg-1`;
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";

function instance(name: string, scope: string, memberType: "Direct" | "Inherited", origin?: string, extra: Partial<ArmRoleScheduleInstance["properties"]> = {}): ArmRoleScheduleInstance {
    return {
        id: `${scope}${AUTH}/roleAssignmentScheduleInstances/${name}`,
        name,
        type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
        properties: {
            scope,
            roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/${OWNER}`,
            principalId: `p-${name}`,
            principalType: "User",
            memberType,
            status: "Provisioned",
            assignmentType: "Assigned",
            ...(origin ? { originRoleAssignmentId: origin } : {}),
            ...extra,
        },
    };
}

function assignment(name: string, scope: string, principalId: string, role = READER): ArmRoleAssignment {
    return {
        id: `${scope}${AUTH}/roleAssignments/${name}`,
        name,
        type: "Microsoft.Authorization/roleAssignments",
        properties: { scope, roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/${role}`, principalId, principalType: "User", createdOn: "2026-10-20T08:00:00Z" },
    };
}

const REAL = assignment("real-guid", RG, "p-reader");

describe("reconcileInstances", () => {
    it("the AU-17 shape: one stale inherited instance and the real direct assignment only in the list give one instance, the direct one", () => {
        const stale = instance("stale", SUB, "Inherited", `${SUB}${AUTH}/roleAssignments/GONE-GUID`);
        const result = reconcileInstances([stale], [REAL], RG);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            id: REAL.id,
            name: "real-guid",
            type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
            properties: {
                scope: RG,
                roleDefinitionId: REAL.properties.roleDefinitionId,
                principalId: "p-reader",
                principalType: "User",
                memberType: "Direct",
                status: "Provisioned",
                assignmentType: "Assigned",
                startDateTime: "2026-10-20T08:00:00Z",
                originRoleAssignmentId: REAL.id,
            },
        });
        // Permanently active downstream
        expect(toAssignment(result[0])).toMatchObject({ state: "active", memberType: "direct", endDateTime: null, roleDefinitionId: READER, scopeId: RG });
    });

    it("keeps an inherited instance whose origin the list holds, without case", () => {
        const kept = instance("kept", SUB, "Inherited", `${SUB}${AUTH}/roleAssignments/Known-Guid`);
        const result = reconcileInstances([kept], [assignment("known-guid", SUB, "p-kept", OWNER)], RG);
        expect(result).toEqual([kept]);
    });

    it("keeps an inherited instance without an origin, and a direct one whose origin is not in the list", () => {
        const noOrigin = instance("no-origin", SUB, "Inherited");
        const direct = instance("direct", RG, "Direct", `${RG}${AUTH}/roleAssignments/not-listed`);
        expect(reconcileInstances([noOrigin, direct], [], RG)).toEqual([noOrigin, direct]);
    });

    it("adds nothing for an assignment that an instance names as its origin, or that matches an instance by principal, role and scope", () => {
        const named = instance("named", RG, "Direct", `${RG}${AUTH}/roleAssignments/real-guid`);
        expect(reconcileInstances([named], [REAL], RG)).toEqual([named]);
        const same = instance("same", RG, "Direct", undefined, { principalId: "P-READER", roleDefinitionId: `${AUTH}/roleDefinitions/${READER.toUpperCase()}` });
        expect(reconcileInstances([same], [REAL], RG)).toEqual([same]);
    });

    it("adds only assignments at the scope read itself, compared without case", () => {
        const above = assignment("above-guid", SUB, "p-above");
        const below = assignment("below-guid", `${RG}/providers/Microsoft.KeyVault/vaults/kv-1`, "p-below");
        const upper = assignment("upper-guid", RG.toUpperCase(), "p-upper");
        expect(reconcileInstances([], [above, below, upper], RG).map((i) => i.name)).toEqual(["upper-guid"]);
    });

    it("leaves out startDateTime when the assignment has no createdOn", () => {
        const bare: ArmRoleAssignment = { ...REAL, properties: { ...REAL.properties, createdOn: undefined } };
        expect(reconcileInstances([], [bare], RG)[0].properties).not.toHaveProperty("startDateTime");
    });

    it("names an added instance from the instances of the same read, the dropped one too (AU-17)", () => {
        const stale = instance("stale", RG, "Inherited", `${SUB}${AUTH}/roleAssignments/gone`, {
            principalId: "p-reader",
            roleDefinitionId: `${SUB}${AUTH}/roleDefinitions/${READER}`,
            expandedProperties: { principal: { id: "p-reader", displayName: "Adele Vance", type: "User" }, roleDefinition: { id: READER, displayName: "Reader", type: "BuiltInRole" }, scope: { id: RG, displayName: "rg-1", type: "resourcegroup" } },
        });
        const [added] = reconcileInstances([stale], [REAL], RG);
        expect(added.name).toBe("real-guid");
        expect(added.properties.expandedProperties?.principal?.displayName).toBe("Adele Vance");
        expect(added.properties.expandedProperties?.roleDefinition?.displayName).toBe("Reader");
        expect(added.properties.expandedProperties?.scope?.displayName).toBe("rg-1");
    });

    it("changes nothing when the role assignment read failed", () => {
        const stale = instance("stale", SUB, "Inherited", `${SUB}${AUTH}/roleAssignments/gone-guid`);
        const input = [stale];
        const result = reconcileInstances(input, null, RG);
        expect(result).toEqual([stale]);
        expect(result).not.toBe(input);
    });
});
