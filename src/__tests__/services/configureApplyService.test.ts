import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, Target } from "@/types/configure.types";
import { compareWithIntent, planApply, type ApplyTargetState, type AssignmentItem } from "@/utils/applyPlan";
import { changeId, targetKey } from "@/utils/configureBasket";
import { createFindPendingRequest, createFindSchedule, runApply } from "@/services/configureApplyService";
import { createRecordingClient, graphError, type RecordedRequest } from "@/__tests__/support/recordingGraphClient";
import { GROUP_ID, GROUP_POLICY_ID, ROLE_ID, ROLE_POLICY_ID, groupRules, roleRules } from "@/__tests__/fixtures/policyRules";
import type { PolicySettings } from "@/types/wizard.types";
import { parseGraphPolicy } from "@/utils/policyParser";

const ROLE: Target = { kind: "role", id: ROLE_ID };
const GROUP: Target = { kind: "group", id: GROUP_ID, access: "member" };
const OTHER_ROLE: Target = { kind: "role", id: "other-role" };
const anna = { id: "anna", kind: "user" as const, displayName: "Anna" };
const bram = { id: "bram", kind: "user" as const, displayName: "Bram" };

const targets: Record<string, ApplyTargetState> = {
    [targetKey(ROLE)]: { target: ROLE, name: "Helpdesk Administrator", policyId: ROLE_POLICY_ID, rules: roleRules() },
    [targetKey(GROUP)]: { target: GROUP, name: "Tier 0 Admins", policyId: GROUP_POLICY_ID, rules: groupRules() },
    [targetKey(OTHER_ROLE)]: { target: OTHER_ROLE, name: "Other", policyId: null, rules: null },
};

const setting = (target: Target, field: BasketSetting["field"], to: BasketSetting["to"], from: BasketSetting["from"] = false): BasketSetting => ({ kind: "setting", target, field, from, to, source: { from: "edit" } });
const add = (target: Target, principal = anna, extra: Partial<BasketAdd> = {}): BasketAdd => ({ kind: "add", target, principal, type: "eligible", scope: "/", start: null, end: "2026-12-01T00:00:00Z", justification: "x", source: { from: "edit" }, ...extra });
const remove = (target: Target, principal = bram): BasketRemove => ({ kind: "remove", target, schedule: { principal, type: "eligible", scope: "/", end: null, start: "2026-01-01T00:00:00Z" }, source: { from: "edit" } });
const update = (target: Target, principal = anna): BasketUpdate => ({ kind: "update", target, schedule: { principal, type: "active", scope: "/", end: "2026-11-01T00:00:00Z", start: "2026-01-01T00:00:00Z" }, end: "2026-12-31T00:00:00Z", action: "adminUpdate", source: { from: "edit" } });

let runCounter = 0;
const nextRun = () => `run-${++runCounter}`;
const noSnapshot = async () => undefined;
const nothingThere = async () => null;

/** Drives the fake timers until the promise settles (withRetry and the pool wait with setTimeout) */
async function settle<T>(promise: Promise<T>): Promise<T> {
    let done = false;
    const result = promise.finally(() => { done = true; });
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return result;
}

const route = (r: RecordedRequest) => `${r.method} ${r.path.replace(/^\/(v1\.0|beta)/, "")}`;

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("planApply (spec 13.1)", () => {
    it("orders settings, adds, updates, removals; one settings item per policy; a policy not read is a problem", () => {
        const basket = { changes: [remove(ROLE), add(GROUP), setting(ROLE, "requireApproval", true), update(ROLE), setting(GROUP, "requireJustificationOnActivation", false, true), setting(OTHER_ROLE, "requireApproval", true)] as Change[] };
        const plan = planApply(basket, targets);
        expect(plan.steps.map((s) => s.kind)).toEqual(["settings", "adds", "updates", "removals"]);
        expect(plan.steps[0].items.map((i) => (i.kind === "settings" ? i.policyId : ""))).toEqual([ROLE_POLICY_ID, GROUP_POLICY_ID]);
        expect(plan.problems).toEqual([{ changeId: changeId(basket.changes[5]), target: OTHER_ROLE, reason: expect.stringContaining("were not read") }]);
        expect(plan.changeIds).toHaveLength(6);
        expect(planApply({ changes: [] }, targets)).toEqual({ steps: [], problems: [], changeIds: [] });
    });

    it("marks an add that relies on a changed expiration rule of its type", () => {
        const plan = planApply({ changes: [setting(ROLE, "allowPermanentEligible", false, true), add(ROLE), add(ROLE, bram, { type: "active" }), add(GROUP)] }, targets);
        const adds = plan.steps.find((s) => s.kind === "adds")!.items as AssignmentItem[];
        expect(adds.map((a) => a.dependsOnSettings)).toEqual([true, false, false]);
    });
});

describe("runApply (spec 13, 14.2)", () => {
    it("writes in the order of the plan, v1.0 everywhere, the MfaAndAcrs order inside a policy", async () => {
        const rec = createRecordingClient();
        const basket = { changes: [remove(ROLE), add(ROLE), setting(ROLE, "activationRequirement", { kind: "authenticationContext", contextId: "c1" }, { kind: "mfa" })] as Change[] };
        const rules = roleRules({ requirement: "mfa" });
        const plan = planApply(basket, { ...targets, [targetKey(ROLE)]: { ...targets[targetKey(ROLE)], rules } });
        const result = await settle(runApply(rec.client, plan, { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(rec.writes().map(route)).toEqual([
            `PATCH /policies/roleManagementPolicies/${ROLE_POLICY_ID}/rules/Enablement_EndUser_Assignment`,
            `PATCH /policies/roleManagementPolicies/${ROLE_POLICY_ID}/rules/AuthenticationContext_EndUser_Assignment`,
            "POST /roleManagement/directory/roleEligibilityScheduleRequests",
            "POST /roleManagement/directory/roleEligibilityScheduleRequests",
        ]);
        expect(rec.writes().every((w) => w.version === "v1.0")).toBe(true);
        expect((rec.writes()[2].body as { action: string }).action).toBe("adminAssign");
        expect((rec.writes()[3].body as { action: string }).action).toBe("adminRemove");
        expect(Object.values(result.results).every((r) => r.status === "done")).toBe(true);
    });

    it("a failed snapshot writes nothing", async () => {
        const rec = createRecordingClient();
        const plan = planApply({ changes: [setting(ROLE, "requireApproval", true), add(ROLE)] }, targets);
        const result = await settle(runApply(rec.client, plan, { runId: nextRun(), saveSnapshot: async () => { throw new Error("quota"); }, findSchedule: nothingThere }));
        expect(rec.writes()).toEqual([]);
        expect(Object.values(result.results)).toEqual([
            { status: "failed", message: "Could not save a snapshot. Nothing was written." },
            { status: "failed", message: "Could not save a snapshot. Nothing was written." },
        ]);
    });

    it("never runs twice for one click: a second run with the same id throws", async () => {
        const rec = createRecordingClient();
        const plan = planApply({ changes: [add(ROLE)] }, targets);
        const runId = nextRun();
        await settle(runApply(rec.client, plan, { runId, saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        await expect(runApply(rec.client, plan, { runId, saveSnapshot: noSnapshot, findSchedule: nothingThere })).rejects.toThrow(/has run already/);
        expect(rec.writes()).toHaveLength(1);
    });

    it("retries a PATCH after 429 and 5xx", async () => {
        const rec = createRecordingClient();
        let calls = 0;
        rec.on({ method: "PATCH", match: /rules\//, respond: () => { calls++; if (calls === 1) throw graphError(429, "TooManyRequests"); if (calls === 2) throw graphError(503, "ServiceUnavailable"); return {}; } });
        const plan = planApply({ changes: [setting(ROLE, "requireApproval", true)] }, targets);
        const result = await settle(runApply(rec.client, plan, { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(calls).toBe(3);
        expect(Object.values(result.results)).toEqual([{ status: "done" }]);
    });

    it("a POST after a 500 reads first: there now is done without a second POST, not there is sent once more", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "POST", match: () => true, respond: () => { throw graphError(500, "InternalServerError"); } });
        const plan = planApply({ changes: [add(ROLE)] }, targets);
        const there = vi.fn(async () => ({ end: null }));
        const result = await settle(runApply(rec.client, plan, { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: there }));
        expect(there).toHaveBeenCalledTimes(1);
        expect(rec.writes()).toHaveLength(1);
        expect(Object.values(result.results)).toEqual([{ status: "done" }]);

        const rec2 = createRecordingClient();
        let posts = 0;
        rec2.on({ method: "POST", match: () => true, respond: () => { posts++; if (posts === 1) throw graphError(500, "InternalServerError"); return {}; } });
        const result2 = await settle(runApply(rec2.client, planApply({ changes: [add(ROLE)] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(posts).toBe(2);
        expect(Object.values(result2.results)).toEqual([{ status: "done" }]);
    });

    it("a policy that fails half way: the changes whose rules landed are done, the rest failed (W-04)", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "PATCH", match: (r) => r.path.endsWith("/rules/Expiration_EndUser_Assignment"), respond: () => { throw graphError(400, "InvalidPolicy", "Duration refused"); } });
        const duration = setting(ROLE, "maxActivationDuration", "PT2H", "PT8H");
        const approval = setting(ROLE, "requireApproval", true, false);
        const approvers = setting(ROLE, "approvers", [{ type: "user", id: "anna", displayName: "Anna" }], []);
        const result = await settle(runApply(rec.client, planApply({ changes: [duration, approval, approvers] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        // The fixture's rules are read with approval before the expiration rule, so approval lands first
        expect(result.results[changeId(approval)]).toEqual({ status: "done" });
        expect(result.results[changeId(approvers)]).toEqual({ status: "done" });
        expect(result.results[changeId(duration)]).toMatchObject({ status: "failed", message: expect.stringContaining("written before it: Approval_EndUser_Assignment") });
    });

    it("approvers set where approval stays off write nothing and are skipped, never done (W-08)", async () => {
        const rec = createRecordingClient();
        const approvers = setting(ROLE, "approvers", [{ type: "user", id: "anna", displayName: "Anna" }], []);
        const result = await settle(runApply(rec.client, planApply({ changes: [approvers] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(rec.writes()).toHaveLength(0);
        expect(result.results[changeId(approvers)]).toMatchObject({ status: "skipped" });
    });

    it("a POST after a 500 that Microsoft accepted is not sent again while it is processed (W-07)", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "POST", match: () => true, respond: () => { throw graphError(500, "InternalServerError"); } });
        const pending = vi.fn(async () => true);
        const result = await settle(runApply(rec.client, planApply({ changes: [add(ROLE)] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere, findPendingRequest: pending }));
        expect(pending).toHaveBeenCalledTimes(1);
        expect(rec.writes()).toHaveLength(1);
        expect(Object.values(result.results)).toEqual([{ status: "skipped", reason: expect.stringContaining("still processing") }]);
    });

    it("a 4xx is not retried; already there and not there any more are skipped", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "POST", match: (r) => (r.body as { principalId?: string; action?: string }).action === "adminAssign" && (r.body as { principalId: string }).principalId === "anna", respond: () => { throw graphError(400, "RoleAssignmentRequestPolicyValidationFailed", "JustificationRule failed"); } });
        rec.on({ method: "POST", match: (r) => (r.body as { principalId: string }).principalId === "bram" && (r.body as { action: string }).action === "adminAssign", respond: () => { throw graphError(400, "RoleAssignmentExists", "The Role assignment already exists."); } });
        rec.on({ method: "POST", match: (r) => (r.body as { action: string }).action === "adminRemove", respond: () => { throw graphError(404, "RoleAssignmentDoesNotExist", "The role assignment does not exist."); } });
        const basket = { changes: [add(ROLE), add(ROLE, bram, { type: "active" }), remove(GROUP, person("carl"))] as Change[] };
        const find = vi.fn(nothingThere);
        const result = await settle(runApply(rec.client, planApply(basket, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: find }));
        expect(rec.writes()).toHaveLength(3);
        expect(find).not.toHaveBeenCalled();
        expect(result.results[changeId(basket.changes[0])]).toMatchObject({ status: "failed", code: "RoleAssignmentRequestPolicyValidationFailed", message: expect.stringContaining("JustificationRule failed") });
        expect(result.results[changeId(basket.changes[1])]).toEqual({ status: "skipped", reason: "Already there." });
        expect(result.results[changeId(basket.changes[2])]).toEqual({ status: "skipped", reason: "Not there any more." });
    });

    it("a failed rule stops the rest of its policy, fails its changes and skips the adds that depend on it", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "PATCH", match: /Expiration_Admin_Eligibility/, respond: () => { throw graphError(400, "InvalidPolicy", "invalid"); } });
        const basket = { changes: [setting(ROLE, "allowPermanentEligible", false, true), setting(ROLE, "requireApproval", true), add(ROLE), add(ROLE, bram, { type: "active" })] as Change[] };
        const result = await settle(runApply(rec.client, planApply(basket, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(result.results[changeId(basket.changes[0])]).toMatchObject({ status: "failed", code: "InvalidPolicy" });
        expect(result.results[changeId(basket.changes[1])]).toMatchObject({ status: "failed" });
        expect(result.results[changeId(basket.changes[2])]).toMatchObject({ status: "skipped", reason: expect.stringContaining("were not written") });
        expect(result.results[changeId(basket.changes[3])]).toEqual({ status: "done" });
    });

    it("stops after the write in flight: the rest is 'stopped'", async () => {
        const rec = createRecordingClient();
        const controller = new AbortController();
        rec.on({ method: "PATCH", match: () => true, respond: () => { controller.abort(); return {}; } });
        const basket = { changes: [setting(ROLE, "requireApproval", true), add(ROLE), remove(ROLE)] as Change[] };
        const result = await settle(runApply(rec.client, planApply(basket, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere, signal: controller.signal }));
        expect(rec.writes().map((w) => w.method)).toEqual(["PATCH"]);
        expect(result.results[changeId(basket.changes[0])]).toEqual({ status: "done" });
        expect(result.results[changeId(basket.changes[1])]).toEqual({ status: "stopped" });
        expect(result.results[changeId(basket.changes[2])]).toEqual({ status: "stopped" });
    });
});

describe("compareWithIntent (spec 13.3)", () => {
    it("marks each written change matches or differs with the value read again", () => {
        const basket = { changes: [setting(ROLE, "requireApproval", true), setting(ROLE, "maxActivationDuration", "PT2H", "PT8H"), add(ROLE), remove(ROLE), add(GROUP)] as Change[] };
        const results = Object.fromEntries(basket.changes.map((c, i) => [changeId(c), i === 4 ? { status: "failed" as const, message: "x" } : { status: "done" as const }]));
        const fresh: PolicySettings = { ...parseGraphPolicy({ rules: roleRules() }), requireApproval: true, maxActivationDuration: "PT4H" };
        const check = compareWithIntent(basket, results, {
            settings: () => fresh,
            assignment: (_t, principalId) => (principalId === "anna" ? { end: "2026-12-01T00:00:20Z" } : principalId === "bram" ? { end: null } : null),
        });
        expect(check[changeId(basket.changes[0])]).toEqual({ matches: true });
        expect(check[changeId(basket.changes[1])]).toEqual({ matches: false, now: "PT4H" });
        expect(check[changeId(basket.changes[2])]).toEqual({ matches: true });
        expect(check[changeId(basket.changes[3])]).toEqual({ matches: false, now: "still there" });
        expect(check[changeId(basket.changes[4])]).toBeUndefined();
    });
});

function person(id: string) {
    return { id, kind: "user" as const, displayName: id };
}

describe("runApply: retries and dependencies after review", () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });

    it("waits for Retry-After before it reads and sends once more", async () => {
        const rec = createRecordingClient();
        const times: number[] = [];
        let posts = 0;
        rec.on({ method: "POST", match: () => true, respond: () => { posts++; times.push(Date.now()); if (posts === 1) throw graphError(429, "TooManyRequests", "slow down", { "Retry-After": "10" }); return {}; } });
        const find = vi.fn(async () => { times.push(Date.now()); return null; });
        const result = await settle(runApply(rec.client, planApply({ changes: [add(ROLE)] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: find, delayMs: 0 }));
        expect(Object.values(result.results)).toEqual([{ status: "done" }]);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(10_000);
    });

    it("an update after a 5xx reads first: the same end now is done without a second POST", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "POST", match: () => true, respond: () => { throw graphError(503, "ServiceUnavailable"); } });
        const change = update(ROLE);
        const result = await settle(runApply(rec.client, planApply({ changes: [change] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: async () => ({ end: change.end }) }));
        expect(rec.writes()).toHaveLength(1);
        expect(Object.values(result.results)).toEqual([{ status: "done" }]);
    });

    it("skips an add that relies on settings whose policy was never read", async () => {
        const rec = createRecordingClient();
        const basket = { changes: [setting(OTHER_ROLE, "eligibleExpiration", "P30D", "P365D"), add(OTHER_ROLE)] as Change[] };
        const result = await settle(runApply(rec.client, planApply(basket, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(rec.writes()).toEqual([]);
        expect(result.results[changeId(basket.changes[1])]).toMatchObject({ status: "skipped" });
    });

    it("a listener that throws does not cost the result", async () => {
        const rec = createRecordingClient();
        const result = await settle(runApply(rec.client, planApply({ changes: [add(ROLE)] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere, onChange: () => { throw new Error("ui"); } }));
        expect(Object.values(result.results)).toEqual([{ status: "done" }]);
    });

    it("createFindSchedule counts only a direct assignment an admin made, not an activation", async () => {
        const { createFindSchedule } = await import("@/services/configureApplyService");
        const rec = createRecordingClient([{ method: "GET", match: /roleAssignmentSchedules$/, respond: () => ({ value: [{ directoryScopeId: "/", assignmentType: "Activated", memberType: "Direct" }, { directoryScopeId: "/", assignmentType: "Assigned", memberType: "Group" }] }) }]);
        const plan = planApply({ changes: [add(ROLE, anna, { type: "active" })] }, targets);
        const item = plan.steps[0].items[0] as AssignmentItem;
        expect(await settle(createFindSchedule(rec.client)(item))).toBeNull();
        expect(rec.requests[0]).toMatchObject({ version: "v1.0", path: expect.stringContaining("/roleManagement/directory/roleAssignmentSchedules"), query: { filter: `principalId eq 'anna' and roleDefinitionId eq '${ROLE_ID}'` } });
    });

    it("a stop during the throttle wait reads once more but never sends again", async () => {
        const rec = createRecordingClient();
        const controller = new AbortController();
        rec.on({ method: "POST", match: () => true, respond: () => { setTimeout(() => controller.abort(), 1000); throw graphError(429, "TooManyRequests", "slow down", { "Retry-After": "10" }); } });
        const find = vi.fn(async () => null);
        const result = await settle(runApply(rec.client, planApply({ changes: [add(ROLE)] }, targets), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: find, signal: controller.signal, delayMs: 0 }));
        expect(rec.writes()).toHaveLength(1);
        expect(find).toHaveBeenCalledTimes(1);
        expect(Object.values(result.results)).toEqual([{ status: "failed", message: expect.stringContaining("Stopped before it could be sent again") }]);
    });
});

describe("the reads behind a second POST (N-010, W-07)", () => {
    const schedule = (over: Record<string, unknown>) => ({ principalId: "anna", directoryScopeId: "/", assignmentType: "Assigned", memberType: "Direct", scheduleInfo: { expiration: { endDateTime: "2026-12-01T00:00:00Z" } }, ...over });
    const itemOf = (change: Change) => planApply({ changes: [change] }, targets).steps.flatMap((s) => s.items)[0] as AssignmentItem;

    it("findSchedule: matches scope, side, Assigned and Direct only", async () => {
        const rec = createRecordingClient();
        rec.on({ method: "GET", match: /roleEligibilitySchedules/, respond: () => ({ value: [schedule({ directoryScopeId: "/administrativeUnits/au1" }), schedule({ memberType: "Group" })] }) });
        expect(await createFindSchedule(rec.client)(itemOf(add(ROLE)))).toBeNull();
        const rec2 = createRecordingClient();
        rec2.on({ method: "GET", match: /roleEligibilitySchedules/, respond: () => ({ value: [schedule({})] }) });
        expect(await createFindSchedule(rec2.client)(itemOf(add(ROLE)))).toEqual({ end: "2026-12-01T00:00:00Z" });
        const rec3 = createRecordingClient();
        rec3.on({ method: "GET", match: /eligibilitySchedules/, respond: () => ({ value: [{ accessId: "owner" }, { accessId: "member" }] }) });
        expect(await createFindSchedule(rec3.client)(itemOf(add(GROUP)))).toEqual({ end: null });
        // An activation is not an admin's active assignment
        const rec4 = createRecordingClient();
        rec4.on({ method: "GET", match: /roleAssignmentSchedules/, respond: () => ({ value: [schedule({ assignmentType: "Activated" })] }) });
        expect(await createFindSchedule(rec4.client)(itemOf(add(ROLE, anna, { type: "active" })))).toBeNull();
    });

    it("findPendingRequest: a recent request of the same action that has not ended", async () => {
        const now = () => new Date("2026-10-08T12:00:00Z");
        const request = (over: Record<string, unknown>) => ({ action: "adminAssign", status: "PendingProvisioning", directoryScopeId: "/", createdDateTime: "2026-10-08T11:58:00Z", ...over });
        const read = async (value: unknown[]) => {
            const rec = createRecordingClient();
            rec.on({ method: "GET", match: /roleEligibilityScheduleRequests/, respond: () => ({ value }) });
            return createFindPendingRequest(rec.client, now)(itemOf(add(ROLE)));
        };
        expect(await read([request({})])).toBe(true);
        expect(await read([request({ status: "Failed" })])).toBe(false);
        expect(await read([request({ action: "adminRemove" })])).toBe(false);
        expect(await read([request({ createdDateTime: "2026-10-08T10:00:00Z" })])).toBe(false);
        expect(await read([request({ directoryScopeId: "/administrativeUnits/au1" })])).toBe(false);
    });
});

describe("a group's Member and Owner policies stay apart (bug 10, C3-07)", () => {
    it("a Member setting writes only the Member policy; with an Owner setting too, each side writes its own", async () => {
        const OWNER: Target = { kind: "group", id: GROUP_ID, access: "owner" };
        const both = { ...targets, [targetKey(OWNER)]: { target: OWNER, name: "Tier 0 Admins", policyId: "owner-policy", rules: groupRules() } };
        const rec = createRecordingClient();
        await settle(runApply(rec.client, planApply({ changes: [setting(GROUP, "maxActivationDuration", "PT3H", "PT8H")] }, both), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        expect(rec.writes().map((w) => w.path)).toEqual([expect.stringContaining(`/policies/roleManagementPolicies/${GROUP_POLICY_ID}/rules/`)]);

        const rec2 = createRecordingClient();
        await settle(runApply(rec2.client, planApply({ changes: [setting(GROUP, "maxActivationDuration", "PT3H", "PT8H"), setting(OWNER, "maxActivationDuration", "PT2H", "PT8H")] }, both), { runId: nextRun(), saveSnapshot: noSnapshot, findSchedule: nothingThere }));
        const policies = rec2.writes().map((w) => w.path.split("/rules/")[0].split("/").pop());
        expect(new Set(policies)).toEqual(new Set([GROUP_POLICY_ID, "owner-policy"]));
    });
});
