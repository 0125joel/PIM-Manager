import { describe, expect, it } from "vitest";
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import type { ChangeResult } from "@/utils/applyPlan";
import { changeId } from "@/utils/configureBasket";
import { HISTORY_LIMIT, HISTORY_STORAGE_PREFIX, basketFromSnapshot, clearConfigureHistory, getHistoryEntry, listHistory, saveHistoryEntry, updateHistoryResults, type HistoryEntry } from "@/utils/configureHistory";
import { parseGraphPolicy } from "@/utils/policyParser";
import { roleRules } from "@/__tests__/fixtures/policyRules";

const ROLE: Target = { kind: "role", id: "role-1" };
const OWNERS: Target = { kind: "group", id: "g1", access: "owner" };
const anna = { id: "anna", kind: "user" as const, displayName: "Anna" };
const bram = { id: "bram", kind: "user" as const, displayName: "Bram" };
const NOW = new Date("2026-10-04T12:00:00Z");
const BASE: PolicySettings = parseGraphPolicy({ rules: roleRules() });

function memoryStorage(limit = Infinity) {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
            if (v.length > limit) throw new DOMException("quota", "QuotaExceededError");
            data.set(k, v);
        },
    };
}

const snapshot = { schemaVersion: 1, app: { name: "PIM Manager", version: "3.2.0" }, tenant: { id: "t1" }, readAt: {}, exportedAt: "2026-10-04T11:59:00Z", workloads: ["directoryRoles" as const], lists: { authenticationContexts: [], customExtensions: [] } };
const entry = (runId: string, changes: Change[] = [], results: Record<string, ChangeResult> = {}): HistoryEntry =>
    ({ runId, at: "2026-10-04T11:59:00Z", by: "Alex Wilber", changes, results, targetCount: 1, snapshot });

describe("history store (spec 14.2)", () => {
    it("keeps the last ten, newest first, per tenant", () => {
        const storage = memoryStorage();
        for (let i = 1; i <= 12; i++) expect(saveHistoryEntry(storage, "t1", entry(`r${i}`))).toBe(true);
        const list = listHistory(storage, "t1");
        expect(list).toHaveLength(HISTORY_LIMIT);
        expect(list[0].runId).toBe("r12");
        expect(list.at(-1)!.runId).toBe("r3");
        expect(listHistory(storage, "t2")).toEqual([]);
        expect(getHistoryEntry(storage, "t1", "r5")?.runId).toBe("r5");
    });

    it("adds the results when the apply ends", () => {
        const storage = memoryStorage();
        saveHistoryEntry(storage, "t1", entry("r1"));
        expect(updateHistoryResults(storage, "t1", "r1", { x: { status: "done" } })).toBe(true);
        expect(getHistoryEntry(storage, "t1", "r1")?.results).toEqual({ x: { status: "done" } });
        expect(updateHistoryResults(storage, "t1", "missing", {})).toBe(false);
    });

    it("drops the oldest on a quota error; an entry that does not fit alone is not saved", () => {
        const one = JSON.stringify({ version: 1, entries: [entry("r1")] }).length;
        const storage = memoryStorage(one * 2 + 10);
        saveHistoryEntry(storage, "t1", entry("r1"));
        saveHistoryEntry(storage, "t1", entry("r2"));
        expect(saveHistoryEntry(storage, "t1", entry("r3"))).toBe(true);
        expect(listHistory(storage, "t1").map((e) => e.runId)).toEqual(["r3", "r2"]);
        const tiny = memoryStorage(10);
        expect(saveHistoryEntry(tiny, "t1", entry("r1"))).toBe(false);
    });

    it("a corrupt entry or file is dropped, never thrown", () => {
        const storage = memoryStorage();
        storage.setItem(HISTORY_STORAGE_PREFIX + "t1", JSON.stringify({ version: 1, entries: [entry("good"), { runId: 3 }, { ...entry("bad"), snapshot: { schemaVersion: 2 } }] }));
        expect(listHistory(storage, "t1").map((e) => e.runId)).toEqual(["good"]);
        storage.setItem(HISTORY_STORAGE_PREFIX + "t1", "{broken");
        expect(listHistory(storage, "t1")).toEqual([]);
        expect(listHistory(null, "t1")).toEqual([]);
        const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
        expect(listHistory(throwing, "t1")).toEqual([]);
        expect(saveHistoryEntry(throwing, "t1", entry("r1"))).toBe(false);
    });
});

describe("sign-out clears the history (decision N-030, 2026-10-08)", () => {
    const keyed = (entries: [string, string][]) => {
        const data = new Map(entries);
        return { data, get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, removeItem: (k: string) => { data.delete(k); } };
    };

    it("removes Last applies of every tenant and the run and undo state, and nothing else", () => {
        const local = keyed([[`${HISTORY_STORAGE_PREFIX}t1`, "x"], [`${HISTORY_STORAGE_PREFIX}t2`, "y"], ["pim-emergency-accounts:t1", "z"], ["theme", "dark"]]);
        const session = keyed([["pim-configure-run:t1", "r"], ["pim-configure-undo:t1", "u"], ["pim-configure-basket:t1", "b"]]);
        clearConfigureHistory(local, session);
        expect([...local.data.keys()]).toEqual(["pim-emergency-accounts:t1", "theme"]);
        // The basket has its own clear (clearStoredBaskets)
        expect([...session.data.keys()]).toEqual(["pim-configure-basket:t1"]);
    });

    it("unusable or missing storage is no error", () => {
        const broken = { get length(): number { throw new Error("blocked"); }, key: () => null, removeItem: () => undefined };
        expect(() => clearConfigureHistory(broken, null)).not.toThrow();
    });
});

describe("basketFromSnapshot (spec 14.3)", () => {
    const setting: BasketSetting = { kind: "setting", target: ROLE, field: "requireApproval", from: false, to: true, source: { from: "edit" } };
    const duration: BasketSetting = { kind: "setting", target: ROLE, field: "maxActivationDuration", from: "PT8H", to: "PT2H", source: { from: "edit" } };
    const added: BasketAdd = { kind: "add", target: ROLE, principal: anna, type: "eligible", scope: "/", start: null, end: "2026-12-01T00:00:00Z", justification: "x", source: { from: "edit" } };
    const removed: BasketRemove = { kind: "remove", target: ROLE, schedule: { principal: bram, type: "active", scope: "/", start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" }, source: { from: "edit" } };
    const updated: BasketUpdate = { kind: "update", target: ROLE, schedule: { principal: bram, type: "eligible", scope: "/", start: "2026-01-01T00:00:00Z", end: "2026-11-01T00:00:00Z" }, end: "2027-06-01T00:00:00Z", action: "adminUpdate", source: { from: "edit" } };
    const done = (changes: Change[]) => Object.fromEntries(changes.map((c) => [changeId(c), { status: "done" as const }]));

    it("returns each written value and assignment, with source undo", () => {
        const changes = [setting, added, removed, updated];
        const { changes: undo, warnings } = basketFromSnapshot(entry("r1", changes, done(changes)), {
            settings: () => ({ ...BASE, requireApproval: true }),
            assignments: () => [
                { principalId: "anna", type: "eligible", scope: "/", start: "2026-10-04T11:00:00Z", end: "2026-12-01T00:00:00Z" },
                { principalId: "bram", type: "eligible", scope: "/", start: "2026-01-01T00:00:00Z", end: "2027-06-01T00:00:00Z" },
            ],
        }, NOW);
        expect(warnings).toEqual([]);
        expect(undo).toEqual([
            { kind: "setting", target: ROLE, field: "requireApproval", from: true, to: false, source: { from: "undo" } },
            expect.objectContaining({ kind: "remove", schedule: expect.objectContaining({ principal: anna, type: "eligible" }), source: { from: "undo" } }),
            expect.objectContaining({ kind: "add", principal: bram, type: "active", start: null, end: "2027-01-01T00:00:00Z", source: { from: "undo" } }),
            expect.objectContaining({ kind: "update", action: "adminUpdate", end: "2026-11-01T00:00:00Z", source: { from: "undo" } }),
        ]);
    });

    it("a change of end whose old end has passed is undone by a removal, never an end in the past (W-10)", () => {
        const renewed: BasketUpdate = { ...updated, schedule: { ...updated.schedule, end: "2026-01-01T00:00:00Z" } };
        const { changes: undo } = basketFromSnapshot(entry("r1", [renewed], done([renewed])), {
            settings: () => BASE,
            assignments: () => [{ principalId: "bram", type: "eligible", scope: "/", start: "2026-01-01T00:00:00Z", end: "2027-06-01T00:00:00Z" }],
        }, NOW);
        expect(undo).toEqual([expect.objectContaining({ kind: "remove", source: { from: "undo" } })]);
    });

    it("undoes only what was written, and nothing that is back already", () => {
        const changes = [setting, added];
        const results = { [changeId(setting)]: { status: "done" as const }, [changeId(added)]: { status: "failed" as const, message: "x" } };
        const { changes: undo } = basketFromSnapshot(entry("r1", changes, results), { settings: () => ({ ...BASE, requireApproval: false }), assignments: () => [] }, NOW);
        expect(undo).toEqual([]);
    });

    it("warns: changed by someone else, younger than five minutes, the last owner", () => {
        const owner: BasketAdd = { ...added, target: OWNERS, type: "active" };
        const changes = [duration, owner];
        const { changes: undo, warnings } = basketFromSnapshot(entry("r1", changes, done(changes)), {
            settings: () => ({ ...BASE, maxActivationDuration: "PT4H" }),
            assignments: (t) => (t.kind === "group" ? [{ principalId: "anna", type: "active", scope: "/", start: "2026-10-04T11:58:00Z", end: null }] : []),
        }, NOW);
        expect(undo).toHaveLength(2);
        expect(warnings.map((w) => w.text)).toEqual([
            "Maximum activation duration was changed by someone else after this apply; undo would overwrite it.",
            "Anna can be removed from 2026-10-04T12:03:00.000Z.",
            "Undo would remove the last owner of this group; Microsoft refuses that. Add another owner first.",
        ]);
    });
});
