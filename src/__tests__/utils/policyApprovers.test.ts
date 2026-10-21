import { describe, expect, it } from "vitest";
import { canKeepApprovers, getApproverKey } from "@/utils/policyApprovers";

const USER = "#microsoft.graph.singleUser";
const GROUP = "#microsoft.graph.groupMembers";

function approvalRule(approvers: Array<{ type: string; id: string }>) {
    return {
        "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule",
        id: "Approval_EndUser_Assignment",
        setting: {
            isApprovalRequired: approvers.length > 0,
            approvalStages: [{
                primaryApprovers: approvers.map((a) => (a.type === USER ? { "@odata.type": a.type, userId: a.id } : { "@odata.type": a.type, groupId: a.id })),
            }],
        },
    };
}

const otherRule = { "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", id: "Expiration_EndUser_Assignment" };

describe("getApproverKey", () => {
    it("is empty without an approval rule or approvers", () => {
        expect(getApproverKey(undefined)).toBe("");
        expect(getApproverKey([otherRule])).toBe("");
        expect(getApproverKey([approvalRule([])])).toBe("");
    });

    it("does not depend on the order Graph returns the approvers in, or on id casing", () => {
        const a = getApproverKey([approvalRule([{ type: USER, id: "U1" }, { type: GROUP, id: "g1" }])]);
        const b = getApproverKey([otherRule, approvalRule([{ type: GROUP, id: "G1" }, { type: USER, id: "u1" }])]);
        expect(a).toBe(b);
    });

    it("changes when an approver is added, removed or replaced", () => {
        const one = getApproverKey([approvalRule([{ type: USER, id: "u1" }])]);
        expect(getApproverKey([approvalRule([{ type: USER, id: "u1" }, { type: USER, id: "u2" }])])).not.toBe(one);
        expect(getApproverKey([approvalRule([{ type: USER, id: "u2" }])])).not.toBe(one);
        expect(getApproverKey([approvalRule([{ type: GROUP, id: "u1" }])])).not.toBe(one);
    });
});

describe("canKeepApprovers", () => {
    const rules = [approvalRule([{ type: USER, id: "u1" }])];

    it("keeps resolved names when the approvers are the same", () => {
        expect(canKeepApprovers({ rules, approvers: [{ id: "u1" }] }, [approvalRule([{ type: USER, id: "u1" }])])).toBe(true);
    });

    it("looks them up again when the approvers changed", () => {
        expect(canKeepApprovers({ rules, approvers: [{ id: "u1" }] }, [approvalRule([{ type: USER, id: "u2" }])])).toBe(false);
    });

    it("looks them up again when the names were never resolved", () => {
        expect(canKeepApprovers({ rules, approvers: undefined }, rules)).toBe(false);
        expect(canKeepApprovers({ rules, approvers: [] }, rules)).toBe(false);
        expect(canKeepApprovers(undefined, rules)).toBe(false);
    });

    it("keeps an empty list when there are no approvers before and after", () => {
        expect(canKeepApprovers({ rules: [otherRule], approvers: [] }, [otherRule])).toBe(true);
    });
});
