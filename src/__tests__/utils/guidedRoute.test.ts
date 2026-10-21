import { describe, expect, it } from "vitest";
import { buildReportRules } from "@/__tests__/fixtures/reportFixture";
import type { Target } from "@/types/configure.types";
import type { AccessModelCatalog } from "@/utils/accessModelCatalog";
import { addChange, addChanges, changeId, EMPTY_BASKET } from "@/utils/configureBasket";
import { readTargetSettings } from "@/utils/configureSettingRows";
import {
    heldBackReviewNotes,
    INITIAL_GUIDED_STATE,
    activationDurationFromCatalog,
    describeSteps,
    draftOf,
    droppedByChoice,
    guidedAddIds,
    guidedEntries,
    guidedReducer,
    isSkipped,
    nextStep,
    overridesFrom,
    planGuided,
    previousStep,
    reachableStep,
    settingsBlocks,
    sourceOf,
    startProblem,
    targetsProblem,
    unmatchedReviewNotes,
    type BlockContext,
    type GuidedState,
} from "@/utils/guidedRoute";
import type { SeveralEntry } from "@/utils/settingValues";

const role = (id: string): Target => ({ kind: "role", id });
const roleEntry = (id: string, name: string, rules: ReturnType<typeof buildReportRules>): SeveralEntry => ({ target: role(id), name, settings: readTargetSettings(rules), rules });
const groupEntry = (id: string, name: string, access: "member" | "owner", rules: ReturnType<typeof buildReportRules>): SeveralEntry => ({
    target: { kind: "group", id, access }, name, settings: readTargetSettings(rules), rules,
});
const ga = roleEntry("ga", "Global Administrator", buildReportRules({ duration: "PT2H", authContext: "c1" }));
const hd = roleEntry("hd", "Helpdesk Administrator", buildReportRules({ duration: "PT8H", mfa: false }));
const ua = roleEntry("ua", "User Administrator", buildReportRules({ duration: "PT8H" }));
const custom = roleEntry("cu", "Contoso Reader", buildReportRules({ duration: "PT8H" }));

const state = (patch: Partial<GuidedState>): GuidedState => ({ ...INITIAL_GUIDED_STATE, ...patch });
const work = { set: { maxActivationDuration: "PT2H" }, kept: [] };

const CATALOG: AccessModelCatalog = {
    schemaVersion: "1.0.0",
    catalogVersion: "test",
    roles: [
        { templateId: "t-ga", displayName: "Global Administrator", plane: "Control", securityLevel: "Privileged", isPrivileged: true, expectedConfig: { maxActivationDuration: "PT1H", authContext: "phish-resistant-sif", requireJustification: true, requireApproval: true, allowPermanentActive: false } },
        { templateId: "t-hd", displayName: "Helpdesk Administrator", plane: "Management", securityLevel: "Specialized", isPrivileged: false, expectedConfig: { maxActivationDuration: "PT4H", requireMFA: true, requireApproval: false } },
        { templateId: "t-ua", displayName: "User Administrator", plane: "Management", securityLevel: "Specialized", isPrivileged: true, expectedConfig: { maxActivationDuration: "PT4H", requireMFA: true, requireApproval: false } },
    ],
    levels: [],
    groups: [{ plane: "Control", securityLevel: "Privileged", member: { maxActivationDuration: "PT2H", requireMFA: true }, owner: { maxActivationDuration: "PT1H", requireApproval: true } }],
    authContexts: [],
} as unknown as AccessModelCatalog;

const ctx = (patch: Partial<BlockContext> = {}): BlockContext => ({
    catalog: CATALOG,
    templateOf: (id) => ({ ga: "t-ga", hd: "t-hd", ua: "t-ua" } as Record<string, string>)[id],
    placementOf: () => null,
    resolveContext: (slug) => (slug === "phish-resistant-sif" ? "c-sif" : null),
    labelName: (slug) => (slug === "phish-resistant-sif" ? "Phish-resistant SIF" : slug),
    tenantName: "Contoso",
    copySource: null,
    basket: EMPTY_BASKET,
    ...patch,
});

describe("what a choice in Start clears (plan NG-70)", () => {
    it("roles or groups clears the ticks, the values and the copy source, with a notice", () => {
        const next = guidedReducer(state({ ticks: ["ga"], overrides: { all: work }, from: "copy", copySourceId: "hd" }), { type: "workload", workload: "groups", copySourceId: "g1" });
        expect(next).toMatchObject({ workload: "groups", ticks: [], overrides: {}, copySourceId: "g1", side: "member", notice: "Targets and values were cleared because you changed roles or groups." });
    });

    it("says nothing when nothing was cleared, and does nothing for the same choice", () => {
        const start = state({});
        expect(guidedReducer(start, { type: "workload", workload: "groups", copySourceId: null }).notice).toBeNull();
        expect(guidedReducer(start, { type: "workload", workload: "roles", copySourceId: null })).toBe(start);
    });

    it("Member, Owner or Both clears the values and keeps the ticks", () => {
        const next = guidedReducer(state({ workload: "groups", ticks: ["g1"], overrides: { all: work } }), { type: "side", side: "both" });
        expect(next).toMatchObject({ side: "both", ticks: ["g1"], overrides: {}, notice: "Values were cleared because you changed Member or Owner." });
    });

    it("the start clears the values; a copy source leaves the ticks; the access model keeps only its parts", () => {
        const copy = guidedReducer(state({ ticks: ["ga", "hd"], overrides: { all: work } }), { type: "from", from: "copy", copySourceId: "hd" });
        expect(copy).toMatchObject({ from: "copy", copySourceId: "hd", ticks: ["ga"], overrides: {}, notice: "Targets and values were cleared because you changed where to start from." });
        const model = guidedReducer(state({ parts: ["notification", "people"], from: "copy", copySourceId: "hd" }), { type: "from", from: "model", copySourceId: null });
        expect(model).toMatchObject({ from: "model", copySourceId: null, parts: ["activation"], notice: null });
        expect(guidedReducer(state({ parts: ["activation", "assignment", "people"] }), { type: "from", from: "model", copySourceId: null }).parts).toEqual(["activation", "assignment"]);
    });

    it("another copy source clears the values and leaves the ticks", () => {
        const next = guidedReducer(state({ from: "copy", copySourceId: "hd", ticks: ["ga", "ua"], overrides: { all: work } }), { type: "copySource", id: "ua" });
        expect(next).toMatchObject({ copySourceId: "ua", ticks: ["ga"], overrides: {}, notice: "Targets and values were cleared because you changed the copy source." });
    });

    it("a part removed clears only its own values; a part added clears nothing; the access model has no notifications or people", () => {
        const s = state({ parts: ["activation", "assignment"], overrides: { all: { set: { maxActivationDuration: "PT2H", allowPermanentActive: false }, kept: ["allowPermanentEligible"] } } });
        const next = guidedReducer(s, { type: "part", part: "assignment" });
        expect(next.parts).toEqual(["activation"]);
        expect(next.overrides.all).toEqual({ set: { maxActivationDuration: "PT2H" }, kept: [] });
        expect(next.notice).toBe("Values were cleared because you changed what to set.");
        const added = guidedReducer(next, { type: "part", part: "people" });
        expect(added).toMatchObject({ parts: ["activation", "people"], overrides: next.overrides, notice: null });
        const model = state({ from: "model" });
        expect(guidedReducer(model, { type: "part", part: "notification" })).toBe(model);
    });

    it("the copy source cannot be ticked; Select all adds the rest in order", () => {
        const s = state({ from: "copy", copySourceId: "hd", ticks: ["ua"] });
        expect(guidedReducer(s, { type: "tick", id: "hd" })).toBe(s);
        expect(guidedReducer(s, { type: "tickAll", ids: ["ga", "hd", "ua", "cu"] }).ticks).toEqual(["ua", "ga", "cu"]);
        expect(guidedReducer(s, { type: "tick", id: "ua" }).ticks).toEqual([]);
    });

    it("reset starts fresh, or with the template's choices", () => {
        expect(guidedReducer(state({ ticks: ["ga"] }), { type: "reset" })).toEqual(INITIAL_GUIDED_STATE);
        expect(guidedReducer(state({}), { type: "reset", state: { from: "model", parts: ["activation", "assignment"] } })).toMatchObject({ from: "model", parts: ["activation", "assignment"], ticks: [] });
    });
});

describe("the steps", () => {
    it("skips Settings without a settings part and People without People", () => {
        const onlyActivation = { parts: ["activation" as const] };
        expect(isSkipped(4, onlyActivation)).toBe(true);
        expect(nextStep(3, onlyActivation)).toBe(5);
        expect(previousStep(5, onlyActivation)).toBe(3);
        const onlyPeople = { parts: ["people" as const] };
        expect(nextStep(2, onlyPeople)).toBe(4);
        expect(previousStep(4, onlyPeople)).toBe(2);
        expect(describeSteps(onlyActivation, 3).map((s) => [s.step, s.status, s.line])).toEqual([
            [1, "done", "Roles or groups, what, from where"],
            [2, "done", "Which ones"],
            [3, "current", "Keep or set"],
            [4, "skipped", "Skipped"],
            [5, "upcoming", "Then apply"],
        ]);
    });

    it("Next waits with a reason", () => {
        const open = { workloadLock: { roles: null, groups: null } };
        expect(startProblem(state({ parts: [] }), open)).toBe("Choose at least one thing to set.");
        expect(startProblem(state({ from: "copy" }), open)).toBe("Choose the role to copy from.");
        expect(startProblem(state({ workload: "groups" }), { workloadLock: { roles: null, groups: "Turn on PIM for Groups in Settings." } })).toBe("Turn on PIM for Groups in Settings.");
        expect(startProblem(state({}), open)).toBeNull();
        expect(targetsProblem(state({ workload: "groups" }), [], [])).toBe("Select at least one group.");
        expect(targetsProblem(state({ workload: "groups", from: "model" }), ["g1"], ["Tier 0 Admins"])).toBe("Place Tier 0 Admins in the access model first.");
        expect(targetsProblem(state({ workload: "groups", from: "current" }), ["g1"], ["Tier 0 Admins"])).toBeNull();
    });

    it("never shows a step whose earlier steps are not complete, a skipped step or Review", () => {
        const parts = { parts: ["activation" as const] };
        expect(reachableStep(3, parts, { start: null, targets: "Select at least one role." })).toBe(2);
        expect(reachableStep(4, parts, { start: "Choose at least one thing to set.", targets: null })).toBe(1);
        expect(reachableStep(4, parts, { start: null, targets: null })).toBe(3);
        expect(reachableStep(5, parts, { start: null, targets: null })).toBe(3);
        expect(reachableStep(undefined, parts, { start: null, targets: null })).toBe(1);
        expect(reachableStep(9, parts, { start: null, targets: null })).toBe(1);
    });
});

describe("targets and blocks", () => {
    it("Both makes a Member and an Owner entry per group", () => {
        const rules = buildReportRules({});
        const entries = guidedEntries(state({ workload: "groups", side: "both" }), ["g1"], (id, access) => groupEntry(id, "Tier 0 Admins", access, rules));
        expect(entries.map((e) => [e.name, e.target])).toEqual([
            ["Tier 0 Admins · Member", { kind: "group", id: "g1", access: "member" }],
            ["Tier 0 Admins · Owner", { kind: "group", id: "g1", access: "owner" }],
        ]);
        expect(guidedEntries(state({}), ["ga", "gone"], (id) => (id === "ga" ? ga : null))).toEqual([ga]);
    });

    it("the current settings are one block without values; a copy fills the source's values of the parts chosen", () => {
        expect(settingsBlocks(state({}), [ga, hd], ctx())).toEqual([{ key: "all", title: null, entries: [ga, hd], prefill: {}, notes: [], unmatchedLabels: [] }]);
        const [block] = settingsBlocks(state({ from: "copy", copySourceId: "ga", parts: ["activation"] }), [hd, ua], ctx({ copySource: ga }));
        expect(block.prefill.maxActivationDuration).toBe("PT2H");
        expect(block.prefill).not.toHaveProperty("allowPermanentActive");
        // A change waiting on the source is what it shows now
        const basket = addChange(EMPTY_BASKET, { kind: "setting", target: role("ga"), field: "maxActivationDuration", from: "PT2H", to: "PT3H", source: { from: "edit" } });
        expect(settingsBlocks(state({ from: "copy", copySourceId: "ga" }), [hd], ctx({ copySource: ga, basket }))[0].prefill.maxActivationDuration).toBe("PT3H");
    });

    it("the access model makes one block per level with its own values; roles not in the catalog get none", () => {
        const blocks = settingsBlocks(state({ from: "model", parts: ["activation", "assignment"] }), [hd, custom, ga, ua], ctx());
        expect(blocks.map((b) => [b.title, b.entries.map((e) => e.name)])).toEqual([
            ["Control · Privileged", ["Global Administrator"]],
            ["Management · Specialized", ["Helpdesk Administrator", "User Administrator"]],
            ["Not classified", ["Contoso Reader"]],
        ]);
        expect(blocks[0].prefill).toEqual({
            maxActivationDuration: "PT1H",
            activationRequirement: { kind: "authenticationContext", contextId: "c-sif" },
            requireJustificationOnActivation: true,
            requireApproval: true,
            allowPermanentActive: false,
        });
        expect(blocks[1].prefill).toEqual({ maxActivationDuration: "PT4H", activationRequirement: { kind: "mfa" }, requireApproval: false });
        expect(blocks[2]).toMatchObject({ prefill: {}, notes: ["Not in the catalog: these roles get no values from the access model."] });
        // Only the parts chosen
        expect(settingsBlocks(state({ from: "model", parts: ["assignment"] }), [ga], ctx())[0].prefill).toEqual({ allowPermanentActive: false });
    });

    it("a label without a context stays Keep and says so", () => {
        const [block] = settingsBlocks(state({ from: "model" }), [ga], ctx({ resolveContext: () => null }));
        expect(block.prefill).not.toHaveProperty("activationRequirement");
        expect(block.unmatchedLabels).toEqual(["phish-resistant-sif"]);
        expect(unmatchedReviewNotes([block], ctx())).toEqual(['"Phish-resistant SIF" is not matched to an authentication context in Contoso, so "On activation, require" stays as it is for Global Administrator.']);
    });

    it("groups take the template of their place and side; a place without a template stays Keep", () => {
        const rules = buildReportRules({});
        const entries = ["g1", "g2"].flatMap((id) => [groupEntry(id, id, "member", rules), groupEntry(id, id, "owner", rules)]);
        const placementOf = (id: string) => (id === "g1" ? { plane: "Control" as const, securityLevel: "Privileged" as const } : { plane: "Data" as const, securityLevel: "Enterprise" as const });
        const blocks = settingsBlocks(state({ workload: "groups", side: "both", from: "model" }), entries, ctx({ placementOf }));
        expect(blocks.map((b) => [b.title, b.prefill, b.notes])).toEqual([
            ["Control · Privileged · Member", { maxActivationDuration: "PT2H", activationRequirement: { kind: "mfa" } }, []],
            ["Control · Privileged · Owner", { maxActivationDuration: "PT1H", requireApproval: true }, []],
            ["Data · Enterprise · Member", {}, ["The catalog has no settings for Data · Enterprise groups yet: every row stays Keep."]],
            ["Data · Enterprise · Owner", {}, ["The catalog has no settings for Data · Enterprise groups yet: every row stays Keep."]],
        ]);
    });
});

describe("the admin's choices on top of the prefill", () => {
    const block = settingsBlocks(state({ from: "model" }), [hd, ua], ctx())[0];

    it("keeps what the admin set or switched back to Keep apart from the prefill", () => {
        const next = { ...block.prefill, maxActivationDuration: "PT2H" } as typeof block.prefill;
        delete next.requireApproval;
        const overrides = overridesFrom(block.prefill, next);
        expect(overrides).toEqual({ set: { maxActivationDuration: "PT2H" }, kept: ["requireApproval"] });
        expect(draftOf(block, overrides, ["activation"])).toEqual({ maxActivationDuration: "PT2H", activationRequirement: { kind: "mfa" } });
        expect(draftOf(block, undefined, ["activation"])).toEqual(block.prefill);
    });

    it("plans one change per target whose value differs, with the source of the start", () => {
        const s = state({ from: "model" });
        const plan = planGuided(s, [block], EMPTY_BASKET);
        // Helpdesk has MFA off and 8 hours; User Administrator has 8 hours and MFA already
        expect(plan.add.map((c) => [c.target.id, c.field, c.source.from])).toEqual([
            ["hd", "maxActivationDuration", "model"],
            ["hd", "activationRequirement", "model"],
            ["ua", "maxActivationDuration", "model"],
        ]);
        expect(plan.problem).toBeNull();
        expect(sourceOf("copy")).toBe("copy");
        expect(sourceOf("current")).toBe("guided");
    });

    it("a group with approval and no approvers is a problem", () => {
        const g = groupEntry("g1", "Tier 0 Admins", "owner", buildReportRules({}));
        const blocks = [{ key: "all", title: null, entries: [g], prefill: {}, notes: [], unmatchedLabels: [] }];
        const plan = planGuided(state({ workload: "groups", overrides: { all: { set: { requireApproval: true, approvers: [] }, kept: [] } } }), blocks, EMPTY_BASKET);
        expect(plan.problem).toContain("Tier 0 Admins");
    });
});

describe("the catalog's levels (spec 6.3)", () => {
    const same = { maxActivationDuration: "PT4H", requireMFA: true, requireApproval: false };
    const withLevels = {
        ...CATALOG,
        levels: [
            { plane: "Control", securityLevel: "Privileged", expectedConfig: { maxActivationDuration: "PT1H", requireMFA: true } },
            { plane: "Management", securityLevel: "Privileged", expectedConfig: { maxActivationDuration: "PT2H", requireMFA: true } },
            { plane: "Data", securityLevel: "Privileged", expectedConfig: { maxActivationDuration: "PT2H", requireMFA: true } },
            { plane: "Control", securityLevel: "Specialized", expectedConfig: same },
            { plane: "Management", securityLevel: "Specialized", expectedConfig: same },
            { plane: "Data", securityLevel: "Specialized", expectedConfig: same },
        ],
    } as unknown as AccessModelCatalog;

    it("a role takes its level's values; one block per level whose planes agree, else per plane", () => {
        const blocks = settingsBlocks(state({ from: "model" }), [ga, hd, ua], ctx({ catalog: withLevels }));
        expect(blocks.map((b) => [b.title, b.entries.map((e) => e.name), b.prefill.maxActivationDuration])).toEqual([
            ["Control · Privileged", ["Global Administrator"], "PT1H"],
            ["Specialized", ["Helpdesk Administrator", "User Administrator"], "PT4H"],
        ]);
    });

    it("a catalog duration is brought into the slider's range, in half hours", () => {
        expect(activationDurationFromCatalog("PT1H")).toEqual({ value: "PT1H", isChanged: false });
        expect(activationDurationFromCatalog("PT90M")).toEqual({ value: "PT1H30M", isChanged: false });
        expect(activationDurationFromCatalog("PT30M")).toEqual({ value: "PT1H", isChanged: true });
        expect(activationDurationFromCatalog("P2D")).toEqual({ value: "PT24H", isChanged: true });
        expect(activationDurationFromCatalog("8 hours")).toBeNull();
        const odd = { ...CATALOG, roles: [{ ...CATALOG.roles[1], expectedConfig: { maxActivationDuration: "P2D" } }] } as unknown as AccessModelCatalog;
        const [block] = settingsBlocks(state({ from: "model" }), [hd], ctx({ catalog: odd }));
        expect(block.prefill.maxActivationDuration).toBe("PT24H");
        expect(block.notes).toEqual(["The catalog recommends P2D for the maximum activation duration; Set to uses the nearest value from 1 to 24 hours."]);
    });
});

describe("the basket changes of the route", () => {
    const [block] = settingsBlocks(state({ from: "model" }), [hd, ua], ctx());

    it("Next from Settings replaces the route's earlier changes and leaves Edit's alone", () => {
        const first = planGuided(state({ from: "model" }), [block], EMPTY_BASKET);
        const edit = { kind: "setting" as const, target: role("ga"), field: "requireTicketInfo" as const, from: false, to: true, source: { from: "edit" as const } };
        const basket = addChanges(addChange(EMPTY_BASKET, edit), first.add);
        const routeChanges = first.add.map(changeId);
        // The duration goes back to Keep: the plan drops the route's duration changes and keeps the rest
        const s = state({ from: "model", routeChanges, overrides: { [block.key]: { set: {}, kept: ["maxActivationDuration"] } } });
        const again = planGuided(s, [block], basket);
        expect(again.leaveOut).toEqual(routeChanges);
        expect(again.add.map((c) => c.field)).toEqual(["activationRequirement"]);
        expect(again.leaveOut).not.toContain(changeId(edit));
    });

    it("a choice in Start takes the route's changes along, and the people Guided added when People goes", () => {
        const routeChanges = ["setting|role:hd|maxActivationDuration", "setting|role:hd|allowPermanentActive"];
        const add = { kind: "add" as const, target: role("hd"), principal: { id: "u1", kind: "user" as const, displayName: "Megan" }, type: "eligible" as const, scope: "/", start: null, end: null, justification: "", source: { from: "guided" as const } };
        const fromEdit = { ...add, principal: { ...add.principal, id: "u2" }, source: { from: "edit" as const } };
        const basket = addChanges(EMPTY_BASKET, [add, fromEdit]);
        const before = state({ parts: ["activation", "assignment", "people"], routeChanges });
        const partGone = guidedReducer(before, { type: "part", part: "assignment" });
        expect(partGone.routeChanges).toEqual(["setting|role:hd|maxActivationDuration"]);
        expect(droppedByChoice(before, partGone, basket)).toEqual(["setting|role:hd|allowPermanentActive"]);
        const peopleGone = guidedReducer(before, { type: "part", part: "people" });
        expect(droppedByChoice(before, peopleGone, basket)).toEqual([changeId(add)]);
        const sideChanged = guidedReducer(before, { type: "from", from: "copy", copySourceId: "ga" });
        expect(sideChanged.notice).toBe("Values were cleared because you changed where to start from.");
        expect(droppedByChoice(before, sideChanged, basket)).toEqual(routeChanges);
    });
});

describe("Guided never takes what is not its own", () => {
    const [block] = settingsBlocks(state({ from: "model" }), [hd, ua], ctx());
    const guidedAdd = (id: string, target: string) => ({ kind: "add" as const, target: role(target), principal: { id, kind: "user" as const, displayName: id }, type: "eligible" as const, scope: "/", start: null, end: null, justification: "", source: { from: "guided" as const } });

    it("a field with a change from Edit stays: the plan holds back its own value", () => {
        const edit = { kind: "setting" as const, target: role("hd"), field: "maxActivationDuration" as const, from: "PT8H", to: "PT2H", source: { from: "edit" as const } };
        const plan = planGuided(state({ from: "model" }), [block], addChange(EMPTY_BASKET, edit));
        expect(plan.heldBack).toEqual([changeId(edit)]);
        expect(plan.add.map((c) => [c.target.id, c.field])).toEqual([["hd", "activationRequirement"], ["ua", "maxActivationDuration"]]);
        expect(plan.leaveOut).not.toContain(changeId(edit));
        // Said in the review, never silent (tenant run 2026-10-09: Both left the Member side on the Edit value unnoticed)
        const basket = addChange(EMPTY_BASKET, edit);
        expect(heldBackReviewNotes(plan.heldBack, basket, (t) => (t.kind === "role" ? `Role ${t.id}` : t.id))).toEqual([
            "Role hd: \"Maximum activation duration\" keeps the change made in Edit, so Guided's value is not used there. Leave that change out and run Guided again to use Guided's value.",
        ]);
        expect(heldBackReviewNotes([], basket, () => "x")).toEqual([]);
    });

    it("the people of an earlier Guided visit are never taken, this visit's are, and an unticked target's", () => {
        const earlier = guidedAdd("u1", "hd");
        const now = guidedAdd("u2", "hd");
        const other = guidedAdd("u3", "ua");
        const basket = addChanges(EMPTY_BASKET, [earlier, now, other]);
        const before = state({ parts: ["activation", "people"], ticks: ["hd", "ua"], inheritedAdds: guidedAddIds(addChanges(EMPTY_BASKET, [earlier])) });
        const dropped = droppedByChoice(before, guidedReducer(before, { type: "part", part: "people" }), basket);
        expect(dropped).toEqual([changeId(now), changeId(other)]);
        expect(droppedByChoice(before, guidedReducer(before, { type: "tick", id: "hd" }), basket)).toEqual([changeId(now)]);
        expect(droppedByChoice(before, guidedReducer(before, { type: "tickAll", ids: ["cu"] }), basket)).toEqual([]);
    });

    it("roles or groups, the side and the copy source take the route's changes along", () => {
        const routeChanges = ["setting|role:hd|maxActivationDuration"];
        const before = state({ routeChanges, reviewNotes: ["x"], ticks: ["hd"], from: "copy", copySourceId: "ga" });
        const basket = EMPTY_BASKET;
        for (const action of [
            { type: "workload", workload: "groups", copySourceId: null } as const,
            { type: "side", side: "owner" } as const,
            { type: "copySource", id: "ua" } as const,
        ]) {
            const next = guidedReducer(before, action);
            expect([action.type, next.routeChanges, next.reviewNotes]).toEqual([action.type, [], []]);
            expect(droppedByChoice(before, next, basket)).toEqual(routeChanges);
        }
    });

    it("unticking keeps the drafts; a skipped People step is passed in reachableStep", () => {
        const s = state({ overrides: { all: work }, ticks: ["ga", "hd"] });
        expect(guidedReducer(s, { type: "tick", id: "hd" }).overrides).toEqual({ all: work });
        expect(reachableStep(4, { parts: ["activation"] }, { start: null, targets: null })).toBe(3);
        expect(reachableStep(4, { parts: ["activation", "people"] }, { start: null, targets: null })).toBe(4);
    });
});
