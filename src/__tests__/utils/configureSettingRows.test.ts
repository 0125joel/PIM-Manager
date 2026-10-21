import { describe, expect, it } from "vitest";
import { buildReportRules, REPORT_AUTH_CONTEXTS } from "@/__tests__/fixtures/reportFixture";
import { EMPTY_BASKET, addChange, type Basket } from "@/utils/configureBasket";
import {
    ACTIVATION_CATEGORIES,
    ASSIGNMENT_CATEGORIES,
    MISSING_EXTENSION,
    contextWarning,
    nowValue,
    planApprovalEdit,
    buildSettingRows,
    describeExpiration,
    describeSettingValue,
    expirationChoiceOf,
    isChanged,
    readTargetSettings,
    settingChange,
} from "@/utils/configureSettingRows";

const words = { contexts: REPORT_AUTH_CONTEXTS, extensions: [{ id: "ext-servicenow", displayName: "ServiceNow ticket check" }] };
const role = { kind: "role" as const, id: "role-ga" };
const group = { kind: "group" as const, id: "g-dev", access: "member" as const };

describe("rows of the tabs (spec 5.5)", () => {
    it("the activation and assignment rows in the order of the spec", () => {
        expect(ACTIVATION_CATEGORIES.flatMap((c) => c.rows.map((r) => r.field))).toEqual([
            "maxActivationDuration", "activationRequirement", "requireJustificationOnActivation", "requireTicketInfo", "requireApproval", "approvers", "customExtensions.preApproval", "customExtensions.postApproval",
        ]);
        expect(ASSIGNMENT_CATEGORIES.flatMap((c) => c.rows.map((r) => r.field))).toEqual([
            "allowPermanentEligible", "eligibleExpiration", "allowPermanentActive", "activeExpiration", "requireMfaOnActiveAssignment", "requireJustificationOnActiveAssignment",
        ]);
    });

    it("Now from the rules as read; the basket's value on top; nothing while not read", () => {
        const settings = readTargetSettings(buildReportRules({ duration: "PT2H", authContext: "c1" }));
        const basket: Basket = addChange(EMPTY_BASKET, { kind: "setting", target: role, field: "requireTicketInfo", from: false, to: true, source: { from: "edit" } });
        const rows = buildSettingRows(ACTIVATION_CATEGORIES, settings, basket, role).flatMap((c) => c.rows);
        const by = (field: string) => rows.find((r) => r.def.field === field);
        expect(by("maxActivationDuration")?.now).toBe("PT2H");
        expect(by("activationRequirement")?.now).toEqual({ kind: "authenticationContext", contextId: "c1" });
        expect(by("requireTicketInfo")).toMatchObject({ now: false, value: true, change: { to: true } });
        expect(buildSettingRows(ACTIVATION_CATEGORIES, null, EMPTY_BASKET, role)[0].rows[0].now).toBeUndefined();
    });

    it("group rules without a target read the same", () => {
        const rules = buildReportRules({ duration: "PT4H", mfa: false }).map((r) => ({ ...r, target: undefined }));
        expect(readTargetSettings(rules)).toMatchObject({ maxActivationDuration: "PT4H", activationRequirement: "none" });
        expect(readTargetSettings([])).toBeNull();
    });
});

describe("words of the values", () => {
    it("durations, requirements, switches, approvers and extensions", () => {
        expect(describeSettingValue("maxActivationDuration", "PT2H", words)).toBe("2 hours");
        expect(describeSettingValue("maxActivationDuration", "PT30M", words)).toBe("30 minutes");
        expect(describeSettingValue("activationRequirement", { kind: "authenticationContext", contextId: "c1" }, words)).toBe("Auth context: Phishing-resistant");
        expect(describeSettingValue("activationRequirement", { kind: "mfa" }, words)).toBe("Multifactor authentication");
        expect(describeSettingValue("requireApproval", true, words)).toBe("On");
        expect(describeSettingValue("approvers", [], words)).toBe("Nobody chosen");
        expect(describeSettingValue("approvers", [{ id: "g1", type: "group", displayName: "Security Leads" }, { id: "", type: "manager" }], words)).toBe("Security Leads, Manager");
        expect(describeSettingValue("customExtensions.preApproval", { isEnabled: true, customExtensionId: "ext-servicenow", customAttributes: [] }, words)).toBe("ServiceNow ticket check");
        expect(describeSettingValue("customExtensions.preApproval", { isEnabled: true, customExtensionId: "ext-gone", displayName: "Old", customAttributes: [] }, words)).toBe(MISSING_EXTENSION);
        expect(describeSettingValue("customExtensions.preApproval", { isEnabled: true, customExtensionId: "ext-gone", displayName: "Old", customAttributes: [] }, { ...words, extensions: null })).toBe("Old");
        expect(describeSettingValue("customExtensions.postApproval", { isEnabled: false, customExtensionId: "", customAttributes: [] }, words)).toBe("None");
    });

    it("end-after values as the choices, others in days", () => {
        expect(describeExpiration("P365D")).toBe("1 year");
        expect(describeExpiration("P180D")).toBe("6 months");
        expect(describeExpiration("P1M")).toBe("1 month");
        expect(describeExpiration("P45D")).toBe("45 days");
        expect(expirationChoiceOf("P365D")).toBe("P1Y");
        expect(expirationChoiceOf("P45D")).toBeNull();
    });
});

describe("changes and the prevented rules", () => {
    it("a change carries the value read; nothing while not read", () => {
        expect(settingChange(role, "requireApproval", false, true)).toEqual({ kind: "setting", target: role, field: "requireApproval", from: false, to: true, source: { from: "edit" } });
        expect(settingChange(role, "requireApproval", undefined, true)).toBeNull();
    });

    it("back to the value read leaves the basket empty", () => {
        const on = addChange(EMPTY_BASKET, settingChange(role, "maxActivationDuration", "PT8H", "PT2H")!);
        expect(on.changes).toHaveLength(1);
        expect(addChange(on, settingChange(role, "maxActivationDuration", "PT8H", "PT8H")!).changes).toHaveLength(0);
    });

    it("changed compares by meaning", () => {
        expect(isChanged("eligibleExpiration", "P365D", "P1Y")).toBe(false);
        expect(isChanged("maxActivationDuration", "PT8H", "PT2H")).toBe(true);
        expect(isChanged("maxActivationDuration", undefined, "PT2H")).toBe(false);
    });

});

describe("after review", () => {
    const approver = { id: "u-erik", type: "user" as const, displayName: "Erik van Dam" };
    const state = (over: Partial<Parameters<typeof planApprovalEdit>[0]> = {}) => ({ target: group, nowApproval: false as boolean | undefined, nowApprovers: [] as typeof approver[] | undefined, basket: EMPTY_BASKET, pending: false, ...over });
    const apply = (basket: Basket, plan: ReturnType<typeof planApprovalEdit>) => {
        let next: Basket = { changes: basket.changes.filter((c) => !plan.leaveOut.includes(`setting|group:${group.id}:member|${(c as { field: string }).field}`)) };
        for (const change of plan.add) next = addChange(next, change);
        return next;
    };

    it("an unlinked extension slot reads as an empty link; a slot the policy lacks stays undefined", () => {
        const rules = buildReportRules();
        const settings = readTargetSettings(rules);
        expect(nowValue(settings, rules, "customExtensions.preApproval")).toEqual({ isEnabled: false, customExtensionId: "", customAttributes: [] });
        expect(nowValue(settings, rules, "customExtensions.postApproval")).toBeUndefined();
        expect(nowValue(null, rules, "customExtensions.preApproval")).toBeUndefined();
    });

    it("a group's approval waits for its first approver, then both go in", () => {
        const on = planApprovalEdit(state(), { kind: "toggle", on: true });
        expect(on).toEqual({ add: [], leaveOut: [], pending: true });
        const picked = planApprovalEdit(state({ pending: true }), { kind: "approvers", list: [approver] });
        expect(picked.pending).toBe(false);
        expect(picked.add.map((c) => [c.field, c.to])).toEqual([["requireApproval", true], ["approvers", [approver]]]);
    });

    it("the last approver of a group stays while approval is on", () => {
        const basket = apply(EMPTY_BASKET, planApprovalEdit(state({ pending: true }), { kind: "approvers", list: [approver] }));
        expect(planApprovalEdit(state({ basket }), { kind: "approvers", list: [] })).toEqual({ add: [], leaveOut: [], pending: false });
        expect(planApprovalEdit(state({ nowApproval: true, nowApprovers: [approver] }), { kind: "approvers", list: [] }).add).toEqual([]);
    });

    it("undoing the approvers of a group with nobody left also undoes the approval", () => {
        const basket = apply(EMPTY_BASKET, planApprovalEdit(state({ pending: true }), { kind: "approvers", list: [approver] }));
        expect(apply(basket, planApprovalEdit(state({ basket }), { kind: "undo", field: "approvers" })).changes).toEqual([]);
    });

    it("approval going off takes its approvers change with it", () => {
        const roleState = { target: role, nowApproval: true as boolean | undefined, nowApprovers: [approver] as typeof approver[] | undefined, basket: EMPTY_BASKET, pending: false };
        const basket = addChange(EMPTY_BASKET, settingChange(role, "approvers", [approver], [])!);
        const off = planApprovalEdit({ ...roleState, basket }, { kind: "toggle", on: false });
        expect(off.leaveOut).toEqual(["setting|role:role-ga|approvers"]);
        expect(off.add.map((c) => [c.field, c.to])).toEqual([["requireApproval", false]]);
        const undo = planApprovalEdit({ ...roleState, nowApproval: false, basket: addChange(basket, settingChange(role, "requireApproval", false, true)!) }, { kind: "undo", field: "requireApproval" });
        expect(undo.leaveOut.sort()).toEqual(["setting|role:role-ga|approvers", "setting|role:role-ga|requireApproval"]);
    });

    it("roles may have approval without approvers; nothing changes while not read", () => {
        expect(planApprovalEdit({ ...state(), target: role }, { kind: "toggle", on: true }).add.map((c) => c.to)).toEqual([true]);
        expect(planApprovalEdit(state({ nowApproval: undefined }), { kind: "toggle", on: true }).add).toEqual([]);
    });

    it("the context warning per Conditional Access state", () => {
        expect(contextWarning("enabled")).toBeNull();
        expect(contextWarning(undefined)).toBeNull();
        expect(contextWarning("reportOnly")).toMatch(/report-only/);
        expect(contextWarning("none")).toMatch(/No Conditional Access policy/);
    });
});
