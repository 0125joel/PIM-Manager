import { describe, it, expect } from "vitest";
import { buildGroupAssignments, readIsAssignableToRole, toGroupPolicies } from "@/services/pimGroupService";
import type { GroupAssignmentScheduleInstance, GroupPimPolicy } from "@/types/pimGroup.types";

function instance(overrides: Partial<GroupAssignmentScheduleInstance>): GroupAssignmentScheduleInstance {
    return {
        id: "i1",
        groupId: "g1",
        principalId: "p1",
        accessId: "member",
        ...overrides,
    } as GroupAssignmentScheduleInstance;
}

describe("buildGroupAssignments permanent", () => {
    it("treats an assigned instance without an end date as permanent", () => {
        const [a] = buildGroupAssignments([], [instance({ assignmentType: "assigned" })]);
        expect(a.assignmentType).toBe("permanent");
    });

    it("compares the assignment type case-insensitively", () => {
        const [a] = buildGroupAssignments([], [instance({ assignmentType: "Assigned" })]);
        expect(a.assignmentType).toBe("permanent");
    });

    it("keeps an assigned instance with an end date as active", () => {
        const [a] = buildGroupAssignments([], [instance({ assignmentType: "assigned", endDateTime: "2026-12-31T00:00:00Z" })]);
        expect(a.assignmentType).toBe("active");
    });

    it("never calls an activated instance permanent, even without an end date", () => {
        const [a, b] = buildGroupAssignments([], [
            instance({ id: "a", assignmentType: "activated" }),
            instance({ id: "b", assignmentType: "Activated", endDateTime: "2026-10-02T00:00:00Z" }),
        ]);
        expect(a.assignmentType).toBe("active");
        expect(b.assignmentType).toBe("active");
    });

    it("keeps eligibility instances eligible", () => {
        const [a] = buildGroupAssignments(
            [{ id: "e", groupId: "g1", principalId: "p1", accessId: "member" } as never],
            [],
        );
        expect(a.assignmentType).toBe("eligible");
    });
});

describe("buildGroupAssignments origin", () => {
    it("keeps Graph's assignmentType of an active instance, so activated and assigned with an end are told apart", () => {
        const [assigned, activated, permanent] = buildGroupAssignments([], [
            instance({ id: "a", assignmentType: "assigned", endDateTime: "2026-12-31T00:00:00Z" }),
            instance({ id: "b", assignmentType: "Activated", endDateTime: "2026-10-02T00:00:00Z" }),
            instance({ id: "c", assignmentType: "assigned" }),
        ]);
        expect(assigned).toMatchObject({ assignmentType: "active", assignmentOrigin: "assigned" });
        expect(activated).toMatchObject({ assignmentType: "active", assignmentOrigin: "activated" });
        expect(permanent).toMatchObject({ assignmentType: "permanent", assignmentOrigin: "assigned" });
    });

    it("leaves the origin unknown when Graph sends no or another value", () => {
        const [a] = buildGroupAssignments([], [instance({ endDateTime: "2026-12-31T00:00:00Z" })]);
        expect(a.assignmentOrigin).toBeUndefined();
    });
});

describe("toGroupPolicies", () => {
    const approval = (userId: string) => ({
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
        id: "Approval_EndUser_Assignment",
        setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: [{ "@odata.type": "#microsoft.graph.singleUser", userId }] }] },
    });
    const policy = (policyType: "member" | "owner", userId: string): GroupPimPolicy => ({
        id: `${policyType}-policy`, groupId: "g1", policyType, displayName: "", rules: [approval(userId)],
    });
    const names = [{ id: "u1", displayName: "Anna" }] as GroupPimPolicy["approvers"];

    it("is undefined when Graph returned no policies", () => {
        expect(toGroupPolicies([])).toBeUndefined();
    });

    it("sorts the policies into member and owner", () => {
        const result = toGroupPolicies([policy("owner", "u1"), policy("member", "u2")]);
        expect(result?.member?.id).toBe("member-policy");
        expect(result?.owner?.id).toBe("owner-policy");
    });

    it("keeps the resolved approver names of a policy read again with the same approvers", () => {
        const previous = { member: { ...policy("member", "u1"), approvers: names } };
        expect(toGroupPolicies([policy("member", "u1")], previous)?.member?.approvers).toBe(names);
    });

    it("drops the names when the approvers changed, so they are looked up again", () => {
        const previous = { member: { ...policy("member", "u1"), approvers: names } };
        const next = toGroupPolicies([policy("member", "u2")], previous);
        expect(next?.member?.approvers).toBeUndefined();
        expect(next?.member?.rules).toEqual([approval("u2")]);
    });
});

describe("readIsAssignableToRole", () => {
    it("reads Graph's null for a group that is not role-assignable as false, so the Not role-assignable filter finds it", () => {
        expect(readIsAssignableToRole(null)).toBe(false);
        expect(readIsAssignableToRole(undefined)).toBe(false);
        expect(readIsAssignableToRole(false)).toBe(false);
    });

    it("keeps true", () => {
        expect(readIsAssignableToRole(true)).toBe(true);
    });
});
