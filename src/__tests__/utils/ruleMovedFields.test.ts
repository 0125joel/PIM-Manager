import { describe, expect, it } from "vitest";
import { ruleMovedFields } from "@/utils/applyPlan";

const read = {
    "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule",
    id: "Enablement_EndUser_Assignment",
    enabledRules: ["Justification"],
    target: { caller: "EndUser", level: "Assignment" },
};

describe("ruleMovedFields", () => {
    it("is empty for a rule that is as it was read", () => {
        expect(ruleMovedFields(read, { ...read }, { enabledRules: ["Justification", "Ticketing"] })).toEqual([]);
    });

    it("names only the field whose value differs", () => {
        expect(ruleMovedFields(read, { ...read, enabledRules: ["Justification", "MultiFactorAuthentication"] }, { enabledRules: ["Justification", "Ticketing"] })).toEqual(["enabledRules"]);
    });

    it("does not count another key order inside a field as a change", () => {
        const approval = { setting: { isApprovalRequired: true, approvalStages: [{ approvalStageTimeOutInDays: 1, primaryApprovers: [] }] } };
        const reordered = { setting: { approvalStages: [{ primaryApprovers: [], approvalStageTimeOutInDays: 1 }], isApprovalRequired: true } };
        expect(ruleMovedFields(approval, reordered, { setting: {} })).toEqual([]);
        expect(ruleMovedFields(approval, { setting: { ...reordered.setting, isApprovalRequired: false } }, { setting: {} })).toEqual(["setting"]);
    });

    it("ignores @odata.type, id and target", () => {
        const body = { "@odata.type": "#microsoft.graph.other", id: "Other", target: { level: "Eligibility" }, enabledRules: ["Justification"] };
        const now = { ...read, "@odata.type": "#microsoft.graph.changed", id: "Changed", target: { caller: "Admin", level: "Eligibility" } };
        expect(ruleMovedFields(read, now, body)).toEqual([]);
    });
});
