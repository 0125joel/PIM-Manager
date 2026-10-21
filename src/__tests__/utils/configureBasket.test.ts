import { describe, expect, it } from "vitest";
import {
    EMPTY_BASKET,
    addAssignment,
    addChange,
    addChanges,
    changeId,
    clearStoredBaskets,
    rebase,
    tabOfField,
    clearTargets,
    countsByTab,
    discard,
    effectiveSetting,
    hasChangesFor,
    leaveOut,
    readStoredBasket,
    removeAssignment,
    setSetting,
    settingValuesEqual,
    touchedTargets,
    updateAssignment,
    writeStoredBasket,
    type Basket,
} from "@/utils/configureBasket";
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, PrincipalRef, Target } from "@/types/configure.types";

const role: Target = { kind: "role", id: "r1" };
const otherRole: Target = { kind: "role", id: "r2" };
const member: Target = { kind: "group", id: "g1", access: "member" };
const owner: Target = { kind: "group", id: "g1", access: "owner" };
const adele: PrincipalRef = { id: "u1", kind: "user", displayName: "Adele Vance" };
const source = { from: "edit" as const };

const setting = (target: Target, field: BasketSetting["field"], from: BasketSetting["from"], to: BasketSetting["to"]): BasketSetting =>
    ({ kind: "setting", target, field, from, to, source });
const add = (target: Target, type: "eligible" | "active" = "eligible", scope = "/"): BasketAdd =>
    ({ kind: "add", target, principal: adele, type, scope, start: null, end: "2027-01-01T00:00:00Z", justification: "", source });
const schedule = (type: "eligible" | "active" = "eligible", scope = "/") => ({ principal: adele, type, scope, end: "2026-12-01T00:00:00.000Z" });
const remove = (target: Target, type: "eligible" | "active" = "eligible", scope = "/"): BasketRemove => ({ kind: "remove", target, schedule: schedule(type, scope), source });
const update = (target: Target, end: string | null): BasketUpdate => ({ kind: "update", target, schedule: schedule(), end, action: "adminUpdate", source });

describe("setting changes", () => {
    it("adds one change per target and field; a later one replaces it and carries the latest read", () => {
        let b = setSetting(EMPTY_BASKET, setting(role, "maxActivationDuration", "PT8H", "PT4H"));
        b = setSetting(b, setting(role, "maxActivationDuration", "PT8H", "PT2H"));
        expect(b.changes).toHaveLength(1);
        expect(b.changes[0]).toMatchObject({ from: "PT8H", to: "PT2H" });
    });

    it("compares by meaning: durations, approver order, unlinked slots", () => {
        expect(setSetting(EMPTY_BASKET, setting(role, "maxActivationDuration", "PT1H30M", "PT90M")).changes).toEqual([]);
        expect(setSetting(EMPTY_BASKET, setting(role, "eligibleExpiration", "P365D", "P1Y")).changes).toEqual([]);
        const a = [{ id: "u1", type: "user" as const }, { id: "g1", type: "group" as const }];
        expect(setSetting(EMPTY_BASKET, setting(role, "approvers", a, [...a].reverse())).changes).toEqual([]);
        expect(setSetting(EMPTY_BASKET, setting(role, "customExtensions.preApproval", { isEnabled: false, customExtensionId: "", customAttributes: [] }, { isEnabled: true, customExtensionId: " ", customAttributes: [] })).changes).toEqual([]);
    });

    it("never takes a custom extension switched on without a pick", () => {
        expect(setSetting(EMPTY_BASKET, setting(role, "customExtensions.postApproval", { isEnabled: false, customExtensionId: "", customAttributes: [] }, { isEnabled: true, customExtensionId: "", customAttributes: [] })).changes).toEqual([]);
    });

    it("rebase: from becomes the value read now, a change that now matches goes", () => {
        let b = setSetting(EMPTY_BASKET, setting(role, "maxActivationDuration", "PT8H", "PT4H"));
        b = setSetting(b, setting(role, "requireApproval", false, true));
        const rebased = rebase(b, (_t, field) => (field === "maxActivationDuration" ? "PT6H" : field === "requireApproval" ? true : undefined));
        expect(rebased.changes).toEqual([expect.objectContaining({ field: "maxActivationDuration", from: "PT6H", to: "PT4H" })]);
        expect(rebase(rebased, () => undefined)).toBe(rebased);
    });

    it("setting it back to the value read removes it", () => {
        let b = setSetting(EMPTY_BASKET, setting(role, "requireApproval", false, true));
        b = setSetting(b, setting(role, "requireApproval", false, false));
        expect(b.changes).toEqual([]);
    });

    it("a change to the value already there adds nothing", () => {
        expect(setSetting(EMPTY_BASKET, setting(role, "requireTicketInfo", false, false)).changes).toEqual([]);
    });

    it("compares structured values without key order", () => {
        expect(settingValuesEqual({ kind: "authenticationContext", contextId: "c1" }, { contextId: "c1", kind: "authenticationContext" })).toBe(true);
        expect(settingValuesEqual(["b@x", "a@x"], ["a@x", "b@x"])).toBe(true);
        expect(settingValuesEqual({ kind: "mfa" }, { kind: "none" })).toBe(false);
    });

    it("keeps Member and Owner of one group apart", () => {
        let b = setSetting(EMPTY_BASKET, setting(member, "requireApproval", false, true));
        b = setSetting(b, setting(owner, "requireApproval", false, true));
        expect(b.changes).toHaveLength(2);
    });
});

describe("assignment changes", () => {
    it("an add and a remove of the same assignment cancel, in either order", () => {
        expect(removeAssignment(addAssignment(EMPTY_BASKET, add(role)), remove(role)).changes).toEqual([]);
        expect(addAssignment(removeAssignment(EMPTY_BASKET, remove(role)), { ...add(role), end: "2026-12-01T00:00:00Z" }).changes).toEqual([]);
    });

    it("type and scope make a different assignment", () => {
        let b = addAssignment(EMPTY_BASKET, add(role, "eligible", "/"));
        b = removeAssignment(b, remove(role, "active", "/"));
        b = removeAssignment(b, remove(role, "eligible", "/administrativeUnits/au1"));
        expect(b.changes).toHaveLength(3);
    });

    it("a second add of the same assignment replaces the first", () => {
        let b = addAssignment(EMPTY_BASKET, add(role));
        b = addAssignment(b, { ...add(role), end: null });
        expect(b.changes).toHaveLength(1);
        expect((b.changes[0] as BasketAdd).end).toBeNull();
    });

    it("a remove followed by an add with another end becomes a change of end", () => {
        const b = addAssignment(removeAssignment(EMPTY_BASKET, remove(role)), { ...add(role), end: "2027-06-01T00:00:00Z" });
        expect(b.changes).toEqual([expect.objectContaining({ kind: "update", action: "adminUpdate", end: "2027-06-01T00:00:00Z" })]);
    });

    it("a change of end on a pending add changes the add", () => {
        const b = updateAssignment(addAssignment(EMPTY_BASKET, add(role)), update(role, "2027-09-01T00:00:00Z"));
        expect(b.changes).toEqual([expect.objectContaining({ kind: "add", end: "2027-09-01T00:00:00Z" })]);
    });

    it("a renewal keeps the same end", () => {
        const renew: BasketUpdate = { ...update(role, "2026-12-01T00:00:00Z"), action: "adminRenew" };
        expect(updateAssignment(EMPTY_BASKET, renew).changes).toHaveLength(1);
    });

    it("an update replaces an earlier one, an end back to the one read removes it, a remove drops it", () => {
        let b = updateAssignment(EMPTY_BASKET, update(role, "2027-02-01T00:00:00Z"));
        b = updateAssignment(b, update(role, "2027-03-01T00:00:00Z"));
        expect(b.changes).toHaveLength(1);
        expect(updateAssignment(b, update(role, "2026-12-01T00:00:00Z")).changes).toEqual([]);
        const removed = removeAssignment(b, remove(role));
        expect(removed.changes.map((c) => c.kind)).toEqual(["remove"]);
        expect(updateAssignment(removed, update(role, "2027-05-01T00:00:00Z"))).toBe(removed);
    });
});

describe("leave out, clear, discard", () => {
    const basket: Basket = addChanges(EMPTY_BASKET, [
        setting(role, "requireApproval", false, true),
        add(role),
        setting(otherRole, "requireTicketInfo", false, true),
    ]);

    it("leaves out by change id", () => {
        const b = leaveOut(basket, [changeId(basket.changes[0])]);
        expect(b.changes.map((c) => c.kind)).toEqual(["add", "setting"]);
    });

    it("clears targets and discards all", () => {
        expect(clearTargets(basket, [role]).changes).toHaveLength(1);
        expect(discard().changes).toEqual([]);
    });

    it("returns the same basket when nothing changes", () => {
        expect(leaveOut(basket, ["nope"])).toBe(basket);
        expect(clearTargets(basket, [owner])).toBe(basket);
        expect(setSetting(basket, setting(owner, "requireTicketInfo", false, false))).toBe(basket);
    });

    it("never mutates the basket it gets", () => {
        const before = JSON.stringify(basket);
        addChange(basket, remove(role));
        setSetting(basket, setting(role, "requireApproval", false, false));
        expect(JSON.stringify(basket)).toBe(before);
    });
});

describe("selectors", () => {
    const basket = addChanges(EMPTY_BASKET, [
        setting(role, "maxActivationDuration", "PT8H", "PT4H"),
        setting(role, "allowPermanentActive", true, false),
        setting(role, "notifications.activation.admin.isEnabled", true, false),
        add(role),
        setting(member, "requireApproval", false, true),
    ]);

    it("every setting field has a tab", () => {
        expect(tabOfField("notifications.activation.approver.criticalOnly")).toBe("notification");
        expect(tabOfField("requireMfaOnActiveAssignment")).toBe("assignment");
        expect(() => tabOfField("nope" as never)).toThrow();
    });

    it("counts per tab and target", () => {
        expect(countsByTab(basket, role)).toEqual({ activation: 1, assignment: 1, notification: 1, who: 1 });
        expect(countsByTab(basket, owner)).toEqual({ activation: 0, assignment: 0, notification: 0, who: 0 });
        // Who has it of a group shows both sides: an owner added counts on the Member side's tab too (N-048)
        const withOwner = addChange(basket, add(owner));
        expect(countsByTab(withOwner, member).who).toBe(countsByTab(basket, member).who + 1);
    });

    it("lists touched targets once, in order", () => {
        expect(touchedTargets(basket)).toEqual([role, member]);
        expect(hasChangesFor(basket, "group", "g1")).toBe(true);
        expect(hasChangesFor(basket, "role", "r2")).toBe(false);
    });

    it("gives Now with the basket applied", () => {
        expect(effectiveSetting(basket, role, "maxActivationDuration", "PT8H")).toBe("PT4H");
        expect(effectiveSetting(basket, otherRole, "maxActivationDuration", "PT8H")).toBe("PT8H");
    });
});

describe("storage", () => {
    function memoryStorage(failOnSet = false) {
        const data = new Map<string, string>();
        return {
            data,
            getItem: (k: string) => data.get(k) ?? null,
            setItem: (k: string, v: string) => { if (failOnSet) throw new Error("QuotaExceededError"); data.set(k, v); },
            removeItem: (k: string) => { data.delete(k); },
        };
    }

    it("round trips per tenant and removes the key when empty", () => {
        const storage = memoryStorage();
        const basket = addChanges(EMPTY_BASKET, [add(role), setting(member, "requireApproval", false, true)]);
        expect(writeStoredBasket(storage, "t1", basket)).toBe(true);
        expect(readStoredBasket(storage, "t1")).toEqual(basket);
        expect(readStoredBasket(storage, "t2")).toEqual(EMPTY_BASKET);
        writeStoredBasket(storage, "t1", EMPTY_BASKET);
        expect(storage.data.size).toBe(0);
    });

    it("sign-out clears every stored basket", () => {
        const data = new Map<string, string>([["pim-configure-basket:t1", "x"], ["pim-configure-basket:t2", "y"], ["theme", "dark"]]);
        const storage = { get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, removeItem: (k: string) => { data.delete(k); } };
        clearStoredBaskets(storage);
        expect([...data.keys()]).toEqual(["theme"]);
    });

    it("a full storage keeps the page working and leaves no stale copy", () => {
        const storage = memoryStorage(true);
        storage.data.set("pim-configure-basket:t1", JSON.stringify({ version: 1, changes: [] }));
        expect(writeStoredBasket(storage, "t1", addChanges(EMPTY_BASKET, [add(role)]))).toBe(false);
        expect(storage.data.size).toBe(0);
    });

    it("corrupt or foreign data reads as empty", () => {
        const storage = memoryStorage();
        storage.data.set("pim-configure-basket:t1", "{not json");
        expect(readStoredBasket(storage, "t1")).toEqual(EMPTY_BASKET);
        storage.data.set("pim-configure-basket:t1", JSON.stringify({ version: 2, changes: [] }));
        expect(readStoredBasket(storage, "t1")).toEqual(EMPTY_BASKET);
        storage.data.set("pim-configure-basket:t1", JSON.stringify({ version: 1, changes: [
            { kind: "nope" },
            { kind: "add", target: { kind: "group", id: "g1" }, principal: adele, type: "eligible", scope: "/" },
            { kind: "remove", target: role, schedule: { type: "eligible", scope: "/" } },
            { kind: "setting", target: role, field: "renamedLater", from: 1, to: 2 },
            add(role),
        ] }));
        expect(readStoredBasket(storage, "t1").changes).toHaveLength(1);
        expect(readStoredBasket(null, "t1")).toEqual(EMPTY_BASKET);
    });
});
