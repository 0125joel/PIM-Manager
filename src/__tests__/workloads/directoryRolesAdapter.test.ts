import { describe, expect, it } from "vitest";
import type { Approver, PimPolicyAssignment, RoleDetailData } from "@/types/directoryRole.types";
import { applyApprovers, applyPolicyResult, INITIAL_ROLES_EXTRAS, type RolesContent } from "@/workloads/directoryRolesAdapter";

function role(id: string): RoleDetailData {
    return {
        definition: { id, displayName: `Role ${id}`, description: "", isBuiltIn: true, isEnabled: true } as RoleDetailData["definition"],
        assignments: { permanent: [], eligible: [], active: [] },
    };
}

function content(ids: string[], failed: string[] = []): RolesContent {
    return { data: ids.map(role), extras: { ...INITIAL_ROLES_EXTRAS, failedRoleIds: failed } };
}

const policy = { id: "p", policy: { id: "pol", rules: [] } } as unknown as PimPolicyAssignment;

describe("applyPolicyResult", () => {
    it("stores the policy on the role and leaves the others alone", () => {
        const before = content(["a", "b"]);
        const after = applyPolicyResult(before, "a", policy);
        expect(after.data[0].policy?.details).toBe(policy.policy);
        expect(after.data[0].policy?.approvers).toEqual([]);
        expect(after.data[1]).toBe(before.data[1]);
        expect(before.data[0].policy).toBeUndefined();
    });

    it("records verified not configured as null, not as missing", () => {
        const after = applyPolicyResult(content(["a"]), "a", null);
        expect(after.data[0].policy).toBeNull();
        expect(after.extras.failedRoleIds).toEqual([]);
    });

    it("marks a failed role and lists it once", () => {
        const once = applyPolicyResult(content(["a"]), "a", null, "429");
        const twice = applyPolicyResult(once, "a", null, "429");
        expect(once.data[0].configError).toBe("429");
        expect(once.data[0].policy).toBeNull();
        expect(twice.extras.failedRoleIds).toEqual(["a"]);
    });

    it("a role that failed and loaded now is no longer a failure", () => {
        const after = applyPolicyResult(content(["a", "b"], ["a", "b"]), "a", policy);
        expect(after.data[0].configError).toBeUndefined();
        expect(after.extras.failedRoleIds).toEqual(["b"]);
    });

    it("ignores a role that is not loaded", () => {
        const before = content(["a"]);
        expect(applyPolicyResult(before, "zzz", policy)).toBe(before);
    });
});

describe("applyApprovers", () => {
    const approvers = [{ id: "u1", displayName: "U", type: "user" }] as unknown as Approver[];

    it("sets the approvers of a role that has a policy", () => {
        const withPolicy = applyPolicyResult(content(["a"]), "a", policy);
        const after = applyApprovers(withPolicy, "a", approvers);
        expect(after.data[0].policy?.approvers).toBe(approvers);
    });

    it("leaves a role without a policy and an unknown role alone", () => {
        const before = content(["a"]);
        expect(applyApprovers(before, "a", approvers)).toBe(before);
        expect(applyApprovers(before, "x", approvers)).toBe(before);
    });
});

describe("applyPolicyResult over a refresh", () => {
    const approvers = [{ id: "u1", displayName: "Anna", type: "user" }] as unknown as Approver[];
    const withApprover = (userId: string) => ({
        id: "p",
        policy: {
            id: "pol",
            rules: [{
                "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
                id: "Approval_EndUser_Assignment",
                setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: [{ "@odata.type": "#microsoft.graph.singleUser", userId }] }] },
            }],
        },
    }) as unknown as PimPolicyAssignment;
    const loaded = applyApprovers(applyPolicyResult(content(["a"]), "a", withApprover("u1")), "a", approvers);

    it("keeps the resolved approver names when the policy read again names the same approvers", () => {
        const after = applyPolicyResult(loaded, "a", withApprover("u1"));
        expect(after.data[0].policy?.approvers).toBe(approvers);
        expect(after.data[0].policy?.assignment).not.toBe(loaded.data[0].policy?.assignment);
    });

    it("clears the names when the approvers changed, so the lookup fills them again", () => {
        const after = applyPolicyResult(loaded, "a", withApprover("u2"));
        expect(after.data[0].policy?.approvers).toEqual([]);
    });
});
