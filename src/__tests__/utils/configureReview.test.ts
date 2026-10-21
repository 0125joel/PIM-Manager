import { describe, expect, it } from "vitest";
import { buildReportGroups, buildReportRoles, PEOPLE, REPORT_AUTH_CONTEXTS } from "@/__tests__/fixtures/reportFixture";
import type { BasketAdd, BasketRemove, BasketSetting } from "@/types/configure.types";
import { planApply } from "@/utils/applyPlan";
import { addChange, EMPTY_BASKET, touchedTargets, type Basket } from "@/utils/configureBasket";
import { buildPreflight, type PreflightCheck } from "@/utils/configurePreflight";
import { approverRoleHolders, buildTargetStates, describeReview, dryRunItems, fieldLabel, targetName } from "@/utils/configureReview";

const roles = buildReportRoles();
const groups = buildReportGroups();
const role = { kind: "role" as const, id: "role-ga" };
const pra = { kind: "role" as const, id: "role-pra" };
const helpdesk = { kind: "group" as const, id: "g-helpdesk1", access: "member" as const };
const words = { contexts: REPORT_AUTH_CONTEXTS, extensions: null };
const setting = (target: BasketSetting["target"], field: BasketSetting["field"], from: BasketSetting["from"], to: BasketSetting["to"]): BasketSetting => ({ kind: "setting", target, field, from, to, source: { from: "edit" } });
const add: BasketAdd = { kind: "add", target: pra, principal: { id: PEOPLE.mo.id, kind: "user", displayName: PEOPLE.mo.displayName }, type: "eligible", scope: "/", start: null, end: "2027-04-01T00:00:00Z", justification: "", source: { from: "edit" } };
const remove: BasketRemove = { kind: "remove", target: role, schedule: { principal: { id: PEOPLE.anna.id, kind: "user", displayName: PEOPLE.anna.displayName }, type: "eligible", scope: "/", end: "2027-03-14T00:00:00Z" }, source: { from: "edit" } };
const basketOf = (...changes: Parameters<typeof addChange>[1][]): Basket => changes.reduce(addChange, EMPTY_BASKET);

describe("targets as read (spec 12.4, 13.1)", () => {
    it("maps Agent ID principals to Configure's service principal or user kinds", () => {
        const base = roles.find((item) => item.definition.id === "role-ga")!;
        const eligible = base.assignments.eligible[0];
        const withAgents = {
            ...base,
            assignments: {
                ...base.assignments,
                eligible: [
                    ...base.assignments.eligible,
                    { ...eligible, id: "agent-identity", principalId: "agent-identity", principal: { id: "agent-identity", displayName: "Agent", "@odata.type": "#microsoft.graph.agentIdentity" } },
                    { ...eligible, id: "agent-user", principalId: "agent-user", principal: { id: "agent-user", displayName: "Agent account", "@odata.type": "#microsoft.graph.agentUser" } },
                ],
            },
        };
        const state = buildTargetStates([withAgents], groups, [role]).preflight["role:role-ga"];
        expect(state.assignments.find((item) => item.principal.id === "agent-identity")?.principal.kind).toBe("servicePrincipal");
        expect(state.assignments.find((item) => item.principal.id === "agent-user")?.principal.kind).toBe("user");
    });

    it("a role with its settings, assignments and policy", () => {
        const { preflight, apply } = buildTargetStates(roles, groups, [role]);
        const ga = preflight["role:role-ga"];
        expect(ga).toMatchObject({ name: "Global Administrator", isPrivileged: true, isBuiltIn: true, activationEndRequired: true });
        expect(ga.settings?.maxActivationDuration).toBe("PT4H");
        expect(ga.assignments.filter((a) => a.type === "eligible")).toHaveLength(3);
        expect(ga.assignments.find((a) => a.principal.id === "g-tier0")?.principal.kind).toBe("group");
        expect(apply["role:role-ga"]).toMatchObject({ name: "Global Administrator", policyId: "pol-role-ga" });
        expect(apply["role:role-ga"].rules?.length).toBeGreaterThan(5);
    });

    it("a group side with its own policy and assignments; a target not loaded is left out", () => {
        const { preflight, apply } = buildTargetStates(roles, groups, [helpdesk, { kind: "role", id: "role-unknown" }]);
        expect(preflight["group:g-helpdesk1:member"]).toMatchObject({ name: "Helpdesk Tier 1", isUnderPim: true, isAssignableToRole: true });
        expect(preflight["group:g-helpdesk1:member"].assignments.every((a) => a.scope === "/")).toBe(true);
        expect(preflight["group:g-helpdesk1:member"].assignments).toHaveLength(3);
        expect(apply["group:g-helpdesk1:member"].policyId).toBe("g-helpdesk1-member");
        expect(Object.keys(preflight)).toEqual(["group:g-helpdesk1:member"]);
    });

    it("holders of the approver roles and the emergency accounts among them", () => {
        const emergency = new Map([[PEOPLE.bg1.id, "Break Glass 1"]]);
        expect(approverRoleHolders(roles, emergency)).toEqual({ activeHolders: 2, emergencyNames: ["Break Glass 1"] });
    });
});

describe("the review page as data (spec 12.1 to 12.3)", () => {
    const basket = basketOf(
        setting(role, "requireApproval", true, false),
        setting(pra, "requireApproval", false, true),
        setting(pra, "maxActivationDuration", "PT8H", "PT2H"),
        add,
        remove,
    );
    const nameOf = (t: Parameters<typeof targetName>[0]) => targetName(t, roles, groups);

    it("runs through the real pre-flight and apply plan", () => {
        const { preflight, apply } = buildTargetStates(roles, groups, touchedTargets(basket));
        const checks = buildPreflight({
            basket, targets: preflight, me: { userId: null, access: null }, emergencyAccounts: new Map(), approverRoles: approverRoleHolders(roles, new Map()),
            conditionalAccess: { status: "notChecked", reason: "x" }, contextNames: {}, customExtensionIds: null, dryRun: null, now: new Date(2026, 9, 4),
        });
        expect(checks.length).toBeGreaterThan(10);
        const plan = planApply(basket, apply);
        expect(plan.problems).toEqual([]);
        expect(plan.steps.map((s) => s.kind)).toEqual(["settings", "adds", "removals"]);
        const view = describeReview({ basket, checks, nameOf, words });
        expect(view.allChecks).toHaveLength(checks.length);
        expect(view.targetNames).toEqual(["Global Administrator", "Privileged Role Administrator"]);
    });

    it("verdict, attention, steps and removals", () => {
        const checks: PreflightCheck[] = [
            { id: "access", outcome: "pass", title: "Your access", text: "Open", targets: [], items: [] },
            { id: "dryRun", outcome: "block", title: "Microsoft would reject", text: "One add is refused", targets: [pra], items: [{ target: pra, text: "Mo: refused" }] },
            { id: "contextPolicies", outcome: "warn", title: "Conditional Access", text: "Report-only", targets: [], items: [] },
            { id: "comesUnderPim", outcome: "pass", info: true, title: "Comes under PIM", text: "x", targets: [], items: [] },
        ];
        const view = describeReview({ basket, checks, nameOf, words });
        expect(view.verdict).toEqual({ tone: "danger", sentence: "1 thing to fix before you can apply" });
        expect(view.canApply).toBe(false);
        expect(view.attention.map((a) => [a.id, a.tone])).toEqual([["dryRun", "danger"], ["contextPolicies", "warn"], ["comesUnderPim", "info"]]);
        expect(view.attention[0].items).toEqual(["Mo: refused"]);
        expect(view.allChecks.map((c) => c.outcome)).toEqual(["Passed", "Fix first", "Check this", "Passed"]);
        expect(view.steps.settings.map((s) => [s.label, s.from, s.to, s.targets.map((t) => t.name)])).toEqual([
            ["Require approval to activate", "On", "Off", ["Global Administrator"]],
            ["Require approval to activate", "Off", "On", ["Privileged Role Administrator"]],
            ["Maximum activation duration", "8 hours", "2 hours", ["Privileged Role Administrator"]],
        ]);
        expect(view.steps.adds[0]).toMatchObject({ principal: PEOPLE.mo.displayName, target: "Privileged Role Administrator", type: "Eligible", scope: "Tenant-wide", start: "Starts when applied", end: "Ends 1 Apr 2027" });
        expect(view.steps.removals[0]).toMatchObject({ principal: PEOPLE.anna.displayName, tag: "Remove eligible" });
        expect(view.removalNames).toEqual([`${PEOPLE.anna.displayName} (Global Administrator)`]);
        expect(view.countPerSetting).toBeNull();
        expect(view.checkedLine).toMatch(/^PIM Manager checked 4 things: .* A snapshot of these 2 targets is saved/);
    });

    it("ready and look-at verdicts; an empty basket", () => {
        expect(describeReview({ basket, checks: [], nameOf, words }).verdict).toEqual({ tone: "success", sentence: "Ready to apply" });
        expect(describeReview({ basket, checks: [{ id: "access", outcome: "notChecked", title: "t", text: "x", targets: [], items: [] }], nameOf, words }).verdict.sentence).toBe("Ready to apply, 1 thing to look at");
        const empty = describeReview({ basket: EMPTY_BASKET, checks: [], nameOf, words });
        expect(empty).toMatchObject({ isEmpty: true, canApply: false, changeCount: 0 });
    });

    it("labels of notification fields, group names with their side, the dry run items", () => {
        expect(fieldLabel("notifications.activation.approver.isEnabled")).toBe("When someone activates: approver, default recipients");
        expect(targetName(helpdesk, roles, groups)).toBe("Helpdesk Tier 1 · Member");
        expect(dryRunItems(basket).map((i) => i.change.principal.displayName)).toEqual([PEOPLE.mo.displayName]);
    });
});

describe("changes that came from an imported file (spec 7.3)", () => {
    it("carry their line into the review rows", () => {
        const nameOf = (t: Parameters<typeof targetName>[0]) => targetName(t, roles, groups);
        const source = { from: "import" as const, file: "x.csv", line: 4 };
        const basket = basketOf({ ...add, source }, { ...remove, source: { ...source, line: 6 } });
        const view = describeReview({ basket, checks: [], nameOf, words });
        expect(view.steps.adds[0].line).toBe("line 4");
        expect(view.steps.removals[0].line).toBe("line 6");
        const edit = describeReview({ basket: basketOf(add), checks: [], nameOf, words });
        expect(edit.steps.adds[0].line).toBeUndefined();
    });
});
