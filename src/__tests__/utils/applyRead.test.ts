import { describe, expect, it } from "vitest";
import { buildReportGroups, buildReportRoles } from "@/__tests__/fixtures/reportFixture";
import type { BasketSetting, Target } from "@/types/configure.types";
import { currentState } from "@/hooks/useConfigureApply";
import { compareWithIntent } from "@/utils/applyPlan";
import type { SettingValue } from "@/utils/policyRules";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId } from "@/utils/configureBasket";
import { sortAgainstRead } from "@/utils/configureResult";

const target: Target = { kind: "role", id: "role-pra" };
/** The fixture's Privileged Role Administrator carries the unlinked pre-approval slot every preview tenant has */
const rolesWithUnlinkedSlot = () => buildReportRoles();

describe("the read before the first write uses the edit screens' Now (W-02)", () => {
    const link = { customExtensionId: "ext-1", isEnabled: true, customAttributes: [] };
    const change: BasketSetting = { kind: "setting", target, field: "customExtensions.preApproval", from: { customExtensionId: "", isEnabled: false, customAttributes: [] }, to: link, source: { from: "edit" } };

    it("an unlinked slot reads as the empty link, so linking it is written, not stopped", () => {
        const now = currentState(rolesWithUnlinkedSlot(), buildReportGroups(), [target]);
        expect(now.settings(target)).not.toBeNull();
        expect(now.value(target, "customExtensions.preApproval")).toEqual({ customExtensionId: "", isEnabled: false, customAttributes: [] });
        const sorted = sortAgainstRead([change], (t, field) => now.value(t, field));
        expect(sorted.moved).toEqual([]);
        expect(sorted.toWrite).toEqual([change]);
    });

    it("after the write, an unlink that landed compares as matching", () => {
        const unlink: BasketSetting = { ...change, from: link, to: { customExtensionId: "", isEnabled: false, customAttributes: [] } };
        const now = currentState(rolesWithUnlinkedSlot(), buildReportGroups(), [target]);
        expect(compareWithIntent({ changes: [unlink] }, { [changeId(unlink)]: { status: "done" } }, now)[changeId(unlink)]).toEqual({ matches: true });
    });
});

describe("compareWithIntent for assignments (N-011)", () => {
    const anna = { id: "anna", kind: "user" as const, displayName: "Anna" };
    const fresh = (found: { end: string | null } | null) => ({ settings: () => null, assignment: () => found });
    const done = (c: Parameters<typeof changeId>[0]) => ({ [changeId(c)]: { status: "done" as const } });
    const remove = { kind: "remove" as const, target, schedule: { principal: anna, type: "eligible" as const, scope: "/", end: null }, source: { from: "edit" as const } };
    const update = { kind: "update" as const, target, schedule: { principal: anna, type: "eligible" as const, scope: "/", end: "2026-11-01T00:00:00Z" }, end: "2027-01-01T00:00:00Z", action: "adminUpdate" as const, source: { from: "edit" as const } };

    it("a removal matches when the assignment is gone, differs when it is still there", () => {
        expect(compareWithIntent({ changes: [remove] }, done(remove), fresh(null))[changeId(remove)]).toEqual({ matches: true });
        expect(compareWithIntent({ changes: [remove] }, done(remove), fresh({ end: null }))[changeId(remove)]).toEqual({ matches: false, now: "still there" });
    });

    it("a change of end matches within a minute, and names the end it found otherwise", () => {
        expect(compareWithIntent({ changes: [update] }, done(update), fresh({ end: "2027-01-01T00:00:30Z" }))[changeId(update)]).toEqual({ matches: true });
        expect(compareWithIntent({ changes: [update] }, done(update), fresh({ end: "2026-11-01T00:00:00Z" }))[changeId(update)]).toEqual({ matches: false, now: "ends 2026-11-01T00:00:00Z" });
        expect(compareWithIntent({ changes: [update] }, done(update), fresh(null))[changeId(update)]).toEqual({ matches: false, now: "not there" });
    });
});

describe("compareWithIntent names the setting value it found (spec 13.3)", () => {
    const settings = {} as PolicySettings;
    const done = (c: BasketSetting) => ({ [changeId(c)]: { status: "done" as const } });
    const setting = (field: BasketSetting["field"], to: SettingValue): BasketSetting => ({ kind: "setting", target, field, from: to, to, source: { from: "edit" } });
    const differs = (change: BasketSetting, now: SettingValue | undefined) =>
        compareWithIntent({ changes: [change] }, done(change), { settings: () => settings, assignment: () => null, value: () => now })[changeId(change)];

    it("on, off, empty and not set", () => {
        expect(differs(setting("requireApproval", true), false)).toEqual({ matches: false, now: "off" });
        expect(differs(setting("requireApproval", false), true)).toEqual({ matches: false, now: "on" });
        expect(differs(setting("maxActivationDuration", "PT8H"), "")).toEqual({ matches: false, now: "empty" });
        expect(differs(setting("maxActivationDuration", "PT8H"), "PT4H")).toEqual({ matches: false, now: "PT4H" });
        expect(differs(setting("maxActivationDuration", "PT8H"), undefined)).toEqual({ matches: false, now: "not set" });
    });

    it("approvers by name or id, none when the list is empty", () => {
        const change = setting("approvers", [{ id: "u1", type: "user", displayName: "Anna" }]);
        expect(differs(change, [])).toEqual({ matches: false, now: "none" });
        expect(differs(change, [{ id: "u2", type: "user", displayName: "Ben" }, { id: "g1", type: "group" }])).toEqual({ matches: false, now: "Ben, g1" });
    });

    it("the activation requirement", () => {
        const change = setting("activationRequirement", { kind: "none" });
        expect(differs(change, { kind: "mfa" })).toEqual({ matches: false, now: "MFA" });
        expect(differs(change, { kind: "authenticationContext", contextId: "c1" })).toEqual({ matches: false, now: "authentication context c1" });
        expect(differs(setting("activationRequirement", { kind: "mfa" }), { kind: "none" })).toEqual({ matches: false, now: "nothing" });
    });

    it("a custom extension slot by its name, never the raw object", () => {
        const change = setting("customExtensions.preApproval", { customExtensionId: "ext-1", isEnabled: true, customAttributes: [] });
        expect(differs(change, { customExtensionId: " ", isEnabled: false, customAttributes: [] })).toEqual({ matches: false, now: "none" });
        expect(differs(change, { customExtensionId: "ext-2", isEnabled: true, displayName: "Ticket check", customAttributes: [] } as SettingValue)).toEqual({ matches: false, now: "Ticket check" });
        expect(differs(change, { customExtensionId: "ext-2", isEnabled: false, customAttributes: [] })).toEqual({ matches: false, now: "ext-2 (off)" });
    });

    it("skips a setting whose policy was not read again", () => {
        const change = setting("requireApproval", true);
        expect(compareWithIntent({ changes: [change] }, done(change), { settings: () => null, assignment: () => null })).toEqual({});
    });
});
