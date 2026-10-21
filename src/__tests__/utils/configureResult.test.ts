import { describe, expect, it } from "vitest";
import type { BasketRemove, BasketSetting, Change, Target } from "@/types/configure.types";
import { changeId } from "@/utils/configureBasket";
import { INTERRUPTED, sortAgainstRead, basketAfterRun, describeProgress, describeResult, failedChanges, mayChangeAll, restoreRun, resultsCsv, undoBlockedReason, type ApplyRun } from "@/utils/configureResult";
import { ROLE_TEMPLATES, deriveWriteAccess } from "@/utils/writeAccess";
import { readCsv, textCodec } from "@/utils/exportSchema";

const PRA: Target = { kind: "role", id: "role-pra" };
const HELP: Target = { kind: "role", id: "role-help" };
const names: Record<string, string> = { "role-pra": "Privileged Role Administrator", "role-help": "Helpdesk Administrator" };
const nameOf = (t: Target) => names[t.id];
const words = { contexts: [{ id: "c1", displayName: "Phish-resistant & SIF", isAvailable: true }], extensions: [] };
const source = { from: "edit" as const };

const requirement: BasketSetting = { kind: "setting", target: PRA, field: "activationRequirement", from: { kind: "mfa" }, to: { kind: "authenticationContext", contextId: "c1" }, source };
const duration: BasketSetting = { kind: "setting", target: PRA, field: "maxActivationDuration", from: "PT4H", to: "PT2H", source };
const removal: BasketRemove = { kind: "remove", target: HELP, schedule: { principal: { id: "u-grady", kind: "user", displayName: "Grady Archie" }, type: "eligible", scope: "/", end: null }, source };
const changes: Change[] = [requirement, duration, removal];

function run(progress: ApplyRun["progress"], extra: Partial<ApplyRun> = {}): ApplyRun {
    return { runId: "r1", changes, progress, startedAt: new Date(2026, 9, 4, 13, 41).toISOString(), finishedAt: new Date(2026, 9, 4, 13, 42).toISOString(), snapshotSaved: true, targetCount: 2, reread: "done", ...extra };
}

const throttled = { status: "failed" as const, code: "TooManyRequests", message: "Microsoft Graph answered 429 (too many requests) three times. Nothing was changed for this one." };

describe("describeResult (spec 14.1, render result-*)", () => {
    const progress = { [changeId(requirement)]: { status: "done" as const }, [changeId(duration)]: throttled, [changeId(removal)]: { status: "done" as const } };

    it("heads, counts, rows and footer as the render", () => {
        const view = describeResult({ run: run(progress), nameOf, words, tenantName: "Contoso", intent: { [changeId(requirement)]: { matches: true }, [changeId(removal)]: { matches: true } } });
        expect(view.title).toBe("Applied with 1 problem");
        expect(view.subline).toBe("2 of 3 written to Contoso at 13:42. Everything was read again afterwards and matches.");
        expect([view.failedCount, view.appliedCount]).toEqual([1, 2]);
        expect(view.rows.map((r) => [r.title, r.line, r.label])).toEqual([
            ["Privileged Role Administrator: On activation, require Auth context: Phish-resistant & SIF", "Was Multifactor authentication.", "Done"],
            ["Privileged Role Administrator: Maximum activation duration 2 hours", throttled.message, "Not written"],
            ["Remove eligible Grady Archie · Helpdesk Administrator", "Removed.", "Done"],
        ]);
        expect(view.footer).toBe("The result stays here until you leave. A snapshot of the 2 targets was saved at 13:41 for \"Undo this apply\".");
        expect(view.canUndo).toBe(true);
    });

    it("says which values differ after the read again", () => {
        const view = describeResult({ run: run(progress), nameOf, words, tenantName: "Contoso", intent: { [changeId(requirement)]: { matches: false, now: "MFA" } } });
        expect(view.subline).toContain("1 value differs from what you wanted");
        expect(view.differs).toEqual(["Privileged Role Administrator: On activation, require Auth context: Phish-resistant & SIF: now MFA"]);
        expect(view.rows[0].line).toBe("Was Multifactor authentication. Read again afterwards: MFA.");
    });

    it("Applied, Nothing was written, and the read again still running", () => {
        const all = Object.fromEntries(changes.map((c) => [changeId(c), { status: "done" as const }]));
        expect(describeResult({ run: run(all, { reread: "reading" }), nameOf, words, tenantName: "Contoso", intent: null }))
            .toMatchObject({ title: "Applied", subline: "3 of 3 written to Contoso at 13:42. Reading the targets again…" });
        const snapshotFailed = Object.fromEntries(changes.map((c) => [changeId(c), { status: "failed" as const, message: "Could not save a snapshot. Nothing was written." }]));
        const nothing = describeResult({ run: run(snapshotFailed, { snapshotSaved: false }), nameOf, words, tenantName: "Contoso", intent: null });
        expect(nothing).toMatchObject({ title: "Nothing was written", subline: "0 of 3 written to Contoso at 13:42.", canUndo: false });
        expect(nothing.footer).toContain("No snapshot was saved");
    });

    it("a stopped change is not written and goes back with Try again", () => {
        const stopped = { ...progress, [changeId(removal)]: { status: "stopped" as const } };
        const view = describeResult({ run: run(stopped), nameOf, words, tenantName: "Contoso", intent: null });
        expect(view.rows[2]).toMatchObject({ line: "Not written (stopped).", label: "Not written", tone: "failed" });
        expect(failedChanges(run(stopped))).toEqual([duration, removal]);
        // Counted apart from the failed one (tenant run 2026-10-09: a stop showed as "12 failed")
        expect([view.failedCount, view.stoppedCount, view.retryLabel]).toEqual([1, 1, "Try the failed ones again"]);
    });

    it("a run stopped before anything failed says Stopped and offers to write the stopped ones", () => {
        const onlyStopped = { [changeId(requirement)]: { status: "done" as const }, [changeId(duration)]: { status: "stopped" as const }, [changeId(removal)]: { status: "stopped" as const } };
        const view = describeResult({ run: run(onlyStopped), nameOf, words, tenantName: "Contoso", intent: null });
        expect([view.title, view.failedCount, view.stoppedCount, view.retryLabel]).toEqual(["Stopped", 0, 2, "Write the stopped ones"]);
        const nothing = Object.fromEntries(changes.map((c) => [changeId(c), { status: "stopped" as const }]));
        expect(describeResult({ run: run(nothing, { snapshotSaved: false }), nameOf, words, tenantName: "Contoso", intent: null })).toMatchObject({ title: "Nothing was written", failedCount: 0, stoppedCount: 3 });
    });

    it("skipped is applied, not a problem", () => {
        const skipped = { ...progress, [changeId(duration)]: { status: "skipped" as const, reason: "Already there." } };
        const view = describeResult({ run: run(skipped), nameOf, words, tenantName: "Contoso", intent: null });
        expect(view.title).toBe("Applied");
        expect(view.rows[1]).toMatchObject({ line: "Already there.", label: "Skipped" });
    });
});

describe("describeProgress (spec 13.2)", () => {
    it("Waiting, Writing, Done, Not written per change", () => {
        const rows = describeProgress({ run: run({ [changeId(requirement)]: { status: "done" }, [changeId(duration)]: "writing" }, { finishedAt: undefined }), nameOf, words, tenantName: "Contoso", intent: null });
        expect(rows.map((r) => r.label)).toEqual(["Done", "Writing", "Waiting"]);
    });
});

describe("resultsCsv (bug 16)", () => {
    it("protects formulas and reads back", () => {
        const r = run({ [changeId(requirement)]: { status: "done" }, [changeId(duration)]: { status: "skipped", reason: "=HYPERLINK(\"x\")" }, [changeId(removal)]: { status: "done" } });
        const view = describeResult({ run: r, nameOf, words, tenantName: "Contoso", intent: null });
        const csv = resultsCsv(view, "Contoso", r);
        expect(csv.split("\r\n")[0]).toMatch(/^"?# PIM Manager apply results, Contoso/);
        expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
        const back = readCsv({ type: "overviewAssignments", fileName: () => "", columns: [{ header: "Change", key: "title", codec: textCodec }, { header: "Detail", key: "line", codec: textCodec }] }, csv);
        expect(back.rows.map((row) => row.line)).toEqual(["Was Multifactor authentication.", "=HYPERLINK(\"x\")", "Removed."]);
    });
});

describe("undoBlockedReason (spec 14.3)", () => {
    const access = deriveWriteAccess({
        activeRoles: [{ roleDefinitionId: ROLE_TEMPLATES.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct" }],
        eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
        appPermission: { directoryRoles: "granted", pimGroups: "granted" },
        roleDefinitions: [{ id: ROLE_TEMPLATES.privilegedRoleAdministrator, templateId: ROLE_TEMPLATES.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true }],
        groups: [],
    });
    const entry = { changes, results: { [changeId(requirement)]: { status: "done" as const } } };
    const ctx = { access, basketCount: 0, isRunning: false };

    it("open for an admin who may change every target, with nothing waiting", () => {
        expect(undoBlockedReason(entry, ctx)).toBeNull();
    });
    it("says why it is closed", () => {
        expect(undoBlockedReason(null, ctx)).toBe("This apply is no longer in the history of this browser.");
        expect(undoBlockedReason(entry, { ...ctx, isRunning: true })).toBe("An apply is running.");
        expect(undoBlockedReason({ changes, results: {} }, ctx)).toBe("Nothing of this apply was written.");
        expect(undoBlockedReason(entry, { ...ctx, basketCount: 2 })).toBe("Apply or discard the 2 changes waiting first.");
        expect(undoBlockedReason(entry, { ...ctx, access: null })).toBe("Your access is still being checked.");
        const noWrite = { ...access, appPermission: { directoryRoles: "notGranted" as const, pimGroups: "granted" as const } };
        expect(undoBlockedReason(entry, { ...ctx, access: noWrite })).toBe("You cannot change every target of this apply now.");
    });
});

describe("a run kept for this tab (spec 13.1, bug 2)", () => {
    const entry = { runId: "r1", at: new Date(2026, 9, 4, 13, 41).toISOString(), by: "Alex", changes, results: { [changeId(requirement)]: { status: "done" as const } }, targetCount: 2, snapshot: {} as never };
    const now = new Date(2026, 9, 4, 14, 0);

    it("a remount shows the result from the history; nothing is planned or sent", () => {
        const run = restoreRun({ runId: "r1", basketCleared: true }, entry, now);
        expect(run).toMatchObject({ runId: "r1", finishedAt: entry.at, progress: entry.results, reread: "done" });
        expect(restoreRun({ runId: "other", basketCleared: true }, entry, now)).toBeNull();
        expect(restoreRun(null, entry, now)).toBeNull();
    });

    it("an apply the page left while it wrote shows every change as not known", () => {
        const run = restoreRun({ runId: "r1", basketCleared: false }, { ...entry, results: {} }, now)!;
        expect(Object.values(run.progress)).toEqual(changes.map(() => ({ status: "failed", message: INTERRUPTED })));
        expect(run.finishedAt).toBe(now.toISOString());
        expect(failedChanges(run)).toEqual(changes);
        // Never "Nothing was written": what landed is not known
        expect(describeResult({ run, nameOf, words, tenantName: "Contoso", intent: null })).toMatchObject({ title: "Apply interrupted", subline: "The page closed at 14:00 while the apply wrote to Contoso. Check the targets in the Report before you try again." });
    });

    it("the settled changes leave the basket; a change edited meanwhile stays", () => {
        const edited: BasketSetting = { ...duration, to: "PT3H" };
        const progress = { [changeId(requirement)]: { status: "done" as const }, [changeId(duration)]: throttled };
        expect(basketAfterRun([requirement, edited, removal], { changes, progress })).toEqual([edited, removal]);
    });

    it("an add skipped because its settings failed is a problem and goes back with Try again", () => {
        const skipped = { status: "skipped" as const, reason: "Settings for role role-pra were not written." };
        const r = run({ [changeId(requirement)]: throttled, [changeId(duration)]: skipped, [changeId(removal)]: { status: "skipped", reason: "Not there any more." } });
        const view = describeResult({ run: r, nameOf, words, tenantName: "Contoso", intent: null });
        expect([view.failedCount, view.appliedCount]).toEqual([2, 1]);
        expect(view.rows[1]).toMatchObject({ label: "Not written", tone: "failed" });
        expect(failedChanges(r)).toEqual([requirement, duration]);
    });

    it("a written change the read again could not compare is named, never 'matches'", () => {
        const all = Object.fromEntries(changes.map((c) => [changeId(c), { status: "done" as const }]));
        const view = describeResult({ run: run(all), nameOf, words, tenantName: "Contoso", intent: { [changeId(removal)]: { matches: true } } });
        expect(view.subline).toBe("3 of 3 written to Contoso at 13:42. Read again afterwards; 2 changes could not be compared, check them in the Report.");
    });
});

describe("mayChangeAll", () => {
    it("needs every target open with the app permission", () => {
        expect(mayChangeAll(changes, null)).toBe(false);
    });
});

describe("sortAgainstRead: the read right before the first write (spec 14.2, gate C round 3)", () => {
    const read = (values: Record<string, unknown>) => (t: Target, field: string) => values[`${t.id}|${field}`] as never;

    it("writes what still holds the value the review started from, skips what already holds the new one, stops on the rest", () => {
        const sorted = sortAgainstRead(changes, read({ "role-pra|activationRequirement": { kind: "mfa" }, "role-pra|maxActivationDuration": "PT2H" }));
        expect(sorted.toWrite).toEqual([requirement, removal]);
        expect(sorted.alreadyThere).toEqual([duration]);
        expect(sorted.moved).toEqual([]);
    });

    it("a retry after a policy that landed in part does not stop: the written rules are already there", () => {
        const sorted = sortAgainstRead([requirement, duration], read({ "role-pra|activationRequirement": { kind: "authenticationContext", contextId: "c1" }, "role-pra|maxActivationDuration": "PT4H" }));
        expect(sorted).toEqual({ toWrite: [duration], alreadyThere: [requirement], moved: [] });
    });

    it("a value someone else set, or a setting not read again, stops the apply", () => {
        expect(sortAgainstRead([duration], read({ "role-pra|maxActivationDuration": "PT3H" })).moved).toEqual([duration]);
        expect(sortAgainstRead([duration], read({})).moved).toEqual([duration]);
    });

    it("an interrupted apply stays interrupted after a second reload", () => {
        const entry = { runId: "r1", at: new Date(2026, 9, 4, 13, 41).toISOString(), by: "Alex", changes, results: Object.fromEntries(changes.map((c) => [changeId(c), { status: "failed" as const, message: INTERRUPTED }])), targetCount: 2, snapshot: {} as never };
        expect(restoreRun({ runId: "r1", basketCleared: true }, entry, new Date())?.interrupted).toBe(true);
    });
});
