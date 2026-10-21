import { describe, expect, it } from "vitest";
import { buildReportRules } from "@/__tests__/fixtures/reportFixture";
import type { Target } from "@/types/configure.types";
import { addChange, addChanges, changeId, EMPTY_BASKET, type Basket } from "@/utils/configureBasket";
import { readTargetSettings } from "@/utils/configureSettingRows";
import {
    copyDraft,
    countPlan,
    countTouched,
    describePlan,
    fieldsOf,
    groupByValue,
    planCopy,
    planSeveral,
    splitNames,
    startValue,
    type SeveralEntry,
} from "@/utils/settingValues";

const role = (id: string): Target => ({ kind: "role", id });
const entry = (id: string, name: string, rules: ReturnType<typeof buildReportRules> | null, missing?: SeveralEntry["missing"]): SeveralEntry => ({
    target: role(id), name, settings: rules ? readTargetSettings(rules) : null, rules, missing,
});
const ga = entry("ga", "Global Administrator", buildReportRules({ duration: "PT2H", authContext: "c1", ticket: true }));
const hd = entry("hd", "Helpdesk Administrator", buildReportRules({ duration: "PT8H", mfa: false }));
const ua = entry("ua", "User Administrator", buildReportRules({ duration: "PT8H" }));
const exo = entry("exo", "Exchange Administrator", buildReportRules({ duration: "PT8H" }));
const four = [ga, hd, ua, exo];

describe("the Now column of several targets (spec 5.6)", () => {
    it("groups the targets by value, equal by meaning, in the order of the selection", () => {
        const column = groupByValue("maxActivationDuration", four, EMPTY_BASKET);
        expect(column.isSame).toBe(false);
        expect(column.groups.map((g) => [g.value, g.names])).toEqual([
            ["PT2H", ["Global Administrator"]],
            ["PT8H", ["Helpdesk Administrator", "User Administrator", "Exchange Administrator"]],
        ]);
        expect(groupByValue("requireJustificationOnActivation", four, EMPTY_BASKET)).toMatchObject({ isSame: true, waiting: 0 });
        expect(groupByValue("activationRequirement", four, EMPTY_BASKET).groups.map((g) => g.names.length)).toEqual([1, 1, 2]);
    });

    it("targets without a value form their own group by reason; a waiting change is counted", () => {
        const loading = entry("pra", "Privileged Role Administrator", null);
        const outside = { ...entry("g", "Tier 0 Admins", null, "notUnderPim"), target: { kind: "group", id: "g", access: "member" } as Target };
        const basket = addChange(EMPTY_BASKET, { kind: "setting", target: role("ga"), field: "maxActivationDuration", from: "PT2H", to: "PT4H", source: { from: "edit" } });
        const column = groupByValue("maxActivationDuration", [ga, loading, outside], basket);
        expect(column.groups.map((g) => g.missing ?? g.value)).toEqual(["PT2H", "loading", "notUnderPim"]);
        expect(column.waiting).toBe(1);
    });

    it("two names and the rest behind +n; Set to starts at the value most targets have", () => {
        expect(splitNames(["a", "b", "c", "d"])).toEqual({ names: ["a", "b"], more: 2 });
        expect(splitNames(["a", "b", "c"])).toEqual({ names: ["a", "b"], more: 1 });
        expect(splitNames(["a", "b"])).toEqual({ names: ["a", "b"], more: 0 });
        expect(startValue(groupByValue("maxActivationDuration", four, EMPTY_BASKET))).toBe("PT8H");
        expect(startValue(groupByValue("maxActivationDuration", [entry("x", "X", null)], EMPTY_BASKET))).toBeUndefined();
    });
});

describe("Add {n} to changes (spec 5.6)", () => {
    it("writes a change only for the targets whose value differs", () => {
        const plan = planSeveral({ maxActivationDuration: "PT8H", requireTicketInfo: true }, four, EMPTY_BASKET);
        expect(plan.add.map((c) => [c.target.id, c.field, c.from, c.to])).toEqual([
            ["ga", "maxActivationDuration", "PT2H", "PT8H"],
            ["hd", "requireTicketInfo", false, true],
            ["ua", "requireTicketInfo", false, true],
            ["exo", "requireTicketInfo", false, true],
        ]);
        expect(plan.problem).toBeNull();
        expect(countTouched(plan)).toBe(4);
    });

    it("makes no change when every target already has the value (equal by meaning)", () => {
        expect(planSeveral({ requireJustificationOnActivation: true, maxActivationDuration: "PT8H" }, [hd, ua, exo], EMPTY_BASKET).add).toEqual([]);
        expect(planSeveral({ eligibleExpiration: "P365D" }, [hd], EMPTY_BASKET).add).toEqual([]);
    });

    it("approvers alone go only to targets whose approval is on (W-08)", () => {
        const approvers = [{ type: "user" as const, id: "u-new", displayName: "New approver" }];
        // None of these fixture roles requires approval: nothing to write, never a change that writes nothing
        expect(planSeveral({ approvers }, [hd, ua], EMPTY_BASKET).add).toEqual([]);
        // With approval switched on in the same plan, every target gets them
        expect(planSeveral({ requireApproval: true, approvers }, [hd, ua], EMPTY_BASKET).add.filter((c) => c.field === "approvers")).toHaveLength(2);
    });

    it("compares with the change waiting: back to the value read is a change the basket drops", () => {
        let basket: Basket = addChange(EMPTY_BASKET, { kind: "setting", target: role("ga"), field: "maxActivationDuration", from: "PT2H", to: "PT8H", source: { from: "edit" } });
        expect(planSeveral({ maxActivationDuration: "PT8H" }, [ga], basket).add).toEqual([]);
        const plan = planSeveral({ maxActivationDuration: "PT2H" }, [ga], basket);
        expect(plan.add).toHaveLength(1);
        expect(countPlan(plan)).toEqual({ changes: 0, undone: 1, targets: 1 });
        expect(describePlan(plan, "roles")).toBe("undoes 1 waiting change for 1 role");
        expect(describePlan(plan, "roles", "past")).toBe("undid 1 waiting change for 1 role");
        basket = addChanges(basket, plan.add);
        expect(basket.changes).toEqual([]);
    });

    it("leaves alone a target whose policy is not read or lacks the rule", () => {
        const plan = planSeveral({ maxActivationDuration: "PT1H" }, [entry("x", "X", null), ga], EMPTY_BASKET);
        expect(plan.add.map((c) => c.target.id)).toEqual(["ga"]);
        expect(plan.skipped).toEqual(["X"]);
        expect(describePlan(plan, "roles")).toBe("adds 1 change for 1 role");
        expect(describePlan(planSeveral({}, [ga], EMPTY_BASKET), "roles")).toBeNull();
    });

    it("approval Off takes a waiting approvers change with it and writes no approvers", () => {
        const approvers = [{ id: "u1", type: "user" as const, displayName: "Megan Bowen" }];
        const basket = addChange(EMPTY_BASKET, { kind: "setting", target: role("ga"), field: "approvers", from: [], to: approvers, source: { from: "edit" } });
        const plan = planSeveral({ requireApproval: false, approvers }, [ga, hd], basket);
        expect(plan.add.every((c) => c.field !== "approvers")).toBe(true);
        expect(plan.leaveOut).toEqual([`setting|role:ga|approvers`]);
    });

    it("a group's approval cannot be on without approvers", () => {
        const group = { ...entry("g", "Dev Leads", buildReportRules()), target: { kind: "group", id: "g", access: "member" } as Target };
        expect(planSeveral({ requireApproval: true }, [ga, group], EMPTY_BASKET).problem).toBe("Choose at least one approver: groups have no default approvers. No approvers: Dev Leads.");
        const withApprover = planSeveral({ requireApproval: true, approvers: [{ id: "u1", type: "user", displayName: "Megan Bowen" }] }, [group], EMPTY_BASKET);
        expect(withApprover.problem).toBeNull();
        expect(withApprover.add.map((c) => c.field)).toEqual(["requireApproval", "approvers"]);
        // A role approves with its default approvers
        expect(planSeveral({ requireApproval: true }, [ga], EMPTY_BASKET).problem).toBeNull();
    });

    it("the changes carry their source", () => {
        expect(planSeveral({ requireTicketInfo: true }, [hd], EMPTY_BASKET, "guided").add[0].source).toEqual({ from: "guided" });
    });
});

describe("Copy settings to… (spec 5.8)", () => {
    it("the fields per category: 8 activation, 6 assignment, 26 notification (not the activation approvers' recipients)", () => {
        expect(fieldsOf("activation")).toHaveLength(8);
        expect(fieldsOf("assignment")).toHaveLength(6);
        expect(fieldsOf("notification")).toHaveLength(26);
        expect(fieldsOf("notification")).not.toContain("notifications.activation.approver.additionalRecipients");
        expect(fieldsOf("notification")[0]).toBe("notifications.eligibleAssignment.admin.isEnabled");
    });

    it("copies what the source shows now, its waiting changes included", () => {
        const basket = addChange(EMPTY_BASKET, { kind: "setting", target: role("ga"), field: "requireTicketInfo", from: true, to: false, source: { from: "edit" } });
        const draft = copyDraft(ga, ["activation"], basket);
        expect(draft.maxActivationDuration).toBe("PT2H");
        expect(draft.requireTicketInfo).toBe(false);
        expect(draft.eligibleExpiration).toBeUndefined();
    });

    it("one change per target and field where the value differs, with source copy", () => {
        const plan = planCopy(ga, ["activation"], [hd, ua], EMPTY_BASKET);
        expect(plan.add.every((c) => c.source.from === "copy")).toBe(true);
        expect(plan.add.filter((c) => c.target.id === "hd").map((c) => c.field)).toEqual(["maxActivationDuration", "activationRequirement", "requireTicketInfo"]);
        expect(countTouched(plan)).toBe(2);
        expect(plan.add.map(changeId)).toContain("setting|role:ua|activationRequirement");
        expect(planCopy(ua, ["assignment", "notification"], [exo], EMPTY_BASKET).add).toEqual([]);
    });
});
