import { describe, expect, it } from "vitest";
import type { BasketAdd, BasketRemove, BasketSetting, BasketUpdate, Change, PrincipalRef, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId, targetKey } from "@/utils/configureBasket";
import { buildPreflight, conditionalAccessInput, preflightVerdict, summarizeContextPolicies, type PreflightCheck, type PreflightCheckId, type PreflightInput, type PreflightTargetState } from "@/utils/configurePreflight";
import { ROLE_TEMPLATES, deriveWriteAccess, type WriteAccess } from "@/utils/writeAccess";

const NOW = new Date("2026-10-04T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 86400000).toISOString();
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString();

const cell = { isEnabled: true, additionalRecipients: "", criticalOnly: false };
const BASE: PolicySettings = {
    maxActivationDuration: "PT8H",
    activationRequirement: "none",
    requireJustificationOnActivation: true,
    requireTicketInfo: false,
    requireApproval: false,
    approvers: [],
    allowPermanentEligible: true,
    eligibleExpiration: "P365D",
    allowPermanentActive: true,
    activeExpiration: "P180D",
    requireMfaOnActiveAssignment: false,
    requireJustificationOnActiveAssignment: true,
    notifications: {
        eligibleAssignment: { admin: cell, assignee: cell, approver: cell },
        activeAssignment: { admin: cell, assignee: cell, approver: cell },
        activation: { admin: cell, requestor: cell, approver: cell },
    },
};

const ROLE: Target = { kind: "role", id: ROLE_TEMPLATES.globalAdministrator };
const READER: Target = { kind: "role", id: "reader-role" };
const GROUP_MEMBER: Target = { kind: "group", id: "g1", access: "member" };
const GROUP_OWNER: Target = { kind: "group", id: "g1", access: "owner" };
const OUTSIDE_MEMBER: Target = { kind: "group", id: "g2", access: "member" };

const person = (id: string, displayName = id): PrincipalRef => ({ id, kind: "user", displayName });
const ANNA = person("anna", "Anna");
const BRAM = person("bram", "Bram");
const ME = person("me", "Me");
const BREAKGLASS = person("bg01", "Break glass 01");

const setting = (target: Target, field: BasketSetting["field"], to: BasketSetting["to"], from: BasketSetting["from"] = false, source: BasketSetting["source"] = { from: "edit" }): BasketSetting =>
    ({ kind: "setting", target, field, from, to, source });
const add = (target: Target, principal: PrincipalRef, extra: Partial<BasketAdd> = {}): BasketAdd =>
    ({ kind: "add", target, principal, type: "eligible", scope: "/", start: null, end: inDays(30), justification: "test", source: { from: "edit" }, ...extra });
const remove = (target: Target, principal: PrincipalRef, extra: Partial<BasketRemove["schedule"]> = {}): BasketRemove =>
    ({ kind: "remove", target, schedule: { principal, type: "eligible", scope: "/", end: null, start: ago(60 * 24), ...extra }, source: { from: "edit" } });
const update = (target: Target, principal: PrincipalRef, end: string | null, extra: Partial<BasketUpdate["schedule"]> = {}): BasketUpdate =>
    ({ kind: "update", target, schedule: { principal, type: "active", scope: "/", end: null, start: ago(60 * 24), ...extra }, end, action: "adminUpdate", source: { from: "edit" } });

function state(target: Target, over: Partial<PreflightTargetState> = {}): PreflightTargetState {
    return { target, name: target.kind === "role" ? (target.id === ROLE.id ? "Global Administrator" : "Reports Reader") : target.id === "g1" ? "Tier 0 Admins" : "Sales", settings: BASE, assignments: [], isUnderPim: true, ...over };
}

const praActive = deriveWriteAccess({
    activeRoles: [{ roleDefinitionId: ROLE_TEMPLATES.privilegedRoleAdministrator, directoryScopeId: "/", memberType: "Direct" }],
    eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {},
    appPermission: { directoryRoles: "granted", pimGroups: "granted" },
    roleDefinitions: [{ id: ROLE_TEMPLATES.privilegedRoleAdministrator, templateId: ROLE_TEMPLATES.privilegedRoleAdministrator, displayName: "Privileged Role Administrator", isBuiltIn: true }],
    groups: [{ id: "g1", displayName: "Tier 0 Admins", isAssignableToRole: true, isUnderPim: true }],
});

function input(changes: Change[], over: Partial<PreflightInput> & { states?: PreflightTargetState[] } = {}): PreflightInput {
    const states = over.states ?? [state(ROLE), state(READER, { isPrivileged: false }), state(GROUP_MEMBER), state(GROUP_OWNER), state(OUTSIDE_MEMBER)];
    return {
        basket: { changes },
        targets: Object.fromEntries(states.map((s) => [targetKey(s.target), s])),
        me: { userId: "me", access: praActive },
        emergencyAccounts: new Map([["bg01", "Break glass 01"]]),
        approverRoles: { activeHolders: 2, emergencyNames: [] },
        conditionalAccess: { status: "ready", contexts: { c1: ctx("enabled"), c2: ctx("reportOnly"), c3: ctx("off") } },
        contextNames: { c1: "Phishing-resistant MFA", c2: "Compliant device", c3: "Trusted location" },
        customExtensionIds: new Set(["ext-1"]),
        dryRun: {},
        now: NOW,
        ...over,
    };
}

function ctx(state: "enabled" | "reportOnly" | "off" | "none") {
    return { state, authenticationStrengthIds: [], signInFrequencyEveryTime: false, compliantDevice: false };
}

const find = (checks: PreflightCheck[], id: PreflightCheckId) => checks.find((c) => c.id === id)!;
const outcome = (changes: Change[], id: PreflightCheckId, over: Parameters<typeof input>[1] = {}) => find(buildPreflight(input(changes, over)), id);

describe("buildPreflight: every check of spec 12.4", () => {
    it("lists every check once, in the order of the table", () => {
        const ids = buildPreflight(input([])).map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(23);
        expect(ids[0]).toBe("access");
    });

    it("your access: blocks a target that closed, passes an open one, blocks when the roles could not be read", () => {
        expect(outcome([setting(ROLE, "requireApproval", true)], "access").outcome).toBe("pass");
        const groupsOnly = deriveWriteAccess({ ...{ activeRoles: [{ roleDefinitionId: ROLE_TEMPLATES.groupsAdministrator, directoryScopeId: "/" }], eligibleRoles: [], ownedGroups: [], groupActive: [], groupEligible: [], administrativeUnitGroups: {} }, appPermission: { directoryRoles: "granted", pimGroups: "granted" }, roleDefinitions: [], groups: [] });
        const closed = outcome([setting(ROLE, "requireApproval", true)], "access", { me: { userId: "me", access: groupsOnly } });
        expect(closed.outcome).toBe("block");
        expect(closed.targets).toEqual([ROLE]);
        expect(outcome([setting(ROLE, "requireApproval", true)], "access", { me: { userId: "me", access: null } }).outcome).toBe("block");
    });

    it("app permission: blocks the workload without write consent, with the grant fix", () => {
        const noGroups: WriteAccess = { ...praActive, appPermission: { directoryRoles: "granted", pimGroups: "notGranted" } };
        const hit = outcome([setting(GROUP_MEMBER, "requireApproval", true), setting(ROLE, "requireApproval", true)], "appPermission", { me: { userId: "me", access: noGroups } });
        expect(hit).toMatchObject({ outcome: "block", targets: [GROUP_MEMBER], fix: { kind: "grantPermission", workloads: ["pimGroups"] } });
        expect(outcome([setting(ROLE, "requireApproval", true)], "appPermission", { me: { userId: "me", access: noGroups } }).outcome).toBe("pass");
        // Without the access read the permission is not known: not checked, never passed
        expect(outcome([setting(ROLE, "requireApproval", true)], "appPermission", { me: { userId: "me", access: null } }).outcome).toBe("notChecked");
    });

    it("approval on a group without approvers: blocks from Import, prevented while editing", () => {
        const imported = outcome([setting(GROUP_MEMBER, "requireApproval", true, false, { from: "import", line: 4 })], "groupApprovers");
        expect(imported.outcome).toBe("block");
        expect(outcome([setting(GROUP_MEMBER, "requireApproval", true)], "groupApprovers")).toMatchObject({ outcome: "prevented", targets: [GROUP_MEMBER] });
        const withApprover = outcome([setting(GROUP_MEMBER, "requireApproval", true, false, { from: "import" }), setting(GROUP_MEMBER, "approvers", [{ id: "u1", type: "user" }], [], { from: "import" })], "groupApprovers");
        expect(withApprover).toMatchObject({ outcome: "prevented", targets: [] });
    });

    it("approval on a role without approvers: info, warn when every approver role is only eligible", () => {
        expect(outcome([setting(ROLE, "requireApproval", true)], "roleApprovers")).toMatchObject({ outcome: "pass", info: true });
        const warn = outcome([setting(ROLE, "requireApproval", true)], "roleApprovers", { approverRoles: { activeHolders: 0, emergencyNames: ["Break glass 01"] } });
        expect(warn.outcome).toBe("warn");
        expect(warn.text).toContain("Break glass 01");
        expect(outcome([setting(ROLE, "requireApproval", true), setting(ROLE, "approvers", [{ id: "u1", type: "user" }], [])], "roleApprovers")).toMatchObject({ outcome: "pass" });
        expect(outcome([setting(ROLE, "requireApproval", true), setting(ROLE, "approvers", [{ id: "u1", type: "user" }], [])], "roleApprovers").info).toBeUndefined();
    });

    it("MFA and a context at once is prevented: the requirement is one choice", () => {
        expect(outcome([], "mfaAndContext").outcome).toBe("prevented");
    });

    it("removing the last active Global Administrator assignment blocks (M-26)", () => {
        const states = [state(ROLE, { assignments: [
            { principal: ANNA, type: "active", scope: "/", start: ago(1000), end: null },
            { principal: BRAM, type: "eligible", scope: "/", start: ago(1000), end: null },
        ] })];
        const hit = outcome([remove(ROLE, ANNA, { type: "active", end: null })], "lastOwner", { states });
        expect(hit.outcome).toBe("block");
        expect(hit.items.map((i) => i.text)).toEqual([expect.stringContaining("Global Administrator would have no active assignment left")]);
        expect(outcome([remove(ROLE, BRAM, { type: "eligible", end: null })], "lastOwner", { states }).outcome).toBe("pass");
    });

    it("permanent going off without a maximum (PT0S): blocks and asks for one, never flags every end (W-01)", () => {
        const states = [state(ROLE, { settings: { ...BASE, allowPermanentEligible: true, eligibleExpiration: "PT0S" }, assignments: [
            { principal: BRAM, type: "eligible", scope: "/", start: ago(1000), end: inDays(300) },
            { principal: ANNA, type: "eligible", scope: "/", start: ago(1000), end: null },
        ] })];
        const hit = outcome([setting(ROLE, "allowPermanentEligible", false, true)], "existingAssignments", { states });
        expect(hit.outcome).toBe("block");
        expect(hit.items.map((i) => i.text)).toEqual([expect.stringContaining('no maximum is set. Choose "Eligible assignments end after"'), expect.stringContaining("Anna has a permanent eligible assignment")]);
        // With a maximum chosen in the same apply: no block, and only the end beyond it is listed
        const chosen = outcome([setting(ROLE, "allowPermanentEligible", false, true), setting(ROLE, "eligibleExpiration", "P365D", "PT0S")], "existingAssignments", { states });
        expect(chosen.outcome).toBe("warn");
        expect(chosen.items.map((i) => i.text)).toEqual([expect.stringContaining("Anna")]);
    });

    it("existing assignments that break the new rules: warn with a removal per assignment", () => {
        const states = [state(ROLE, { assignments: [
            { principal: ANNA, type: "eligible", scope: "/", start: ago(1000), end: null },
            { principal: BRAM, type: "eligible", scope: "/", start: ago(1000), end: inDays(300) },
            { principal: person("carl", "Carl"), type: "eligible", scope: "/", start: ago(1000), end: inDays(20) },
            { principal: person("via", "Via group"), type: "eligible", scope: "/", start: ago(1000), end: null, viaGroup: true },
        ] })];
        const hit = outcome([setting(ROLE, "allowPermanentEligible", false, true), setting(ROLE, "eligibleExpiration", "P90D", "P365D")], "existingAssignments", { states });
        expect(hit.outcome).toBe("warn");
        expect(hit.items.map((i) => i.text)).toEqual([
            expect.stringContaining("Anna has a permanent eligible assignment"),
            expect.stringContaining("Bram's eligible assignment"),
        ]);
        expect(hit.fix).toMatchObject({ kind: "removeInThisApply", removals: [{ kind: "remove", schedule: { principal: ANNA } }, { kind: "remove", schedule: { principal: BRAM } }] });
        // Removed in this apply already: not listed again; a change of another field: nothing to check
        expect(outcome([setting(ROLE, "allowPermanentEligible", false, true), remove(ROLE, ANNA)], "existingAssignments", { states }).items).toHaveLength(0);
        expect(outcome([setting(ROLE, "requireApproval", true)], "existingAssignments", { states }).outcome).toBe("pass");
        // An end changed to within the maximum in the same apply is no conflict
        const shortened: BasketUpdate = { ...update(ROLE, BRAM, inDays(60), { type: "eligible", end: inDays(300) }) };
        expect(outcome([setting(ROLE, "allowPermanentEligible", false, true), setting(ROLE, "eligibleExpiration", "P90D", "P365D"), shortened], "existingAssignments", { states }).items.map((i) => i.text))
            .toEqual([expect.stringContaining("Anna")]);
    });

    it("what changes for people who activate: info per target with the number of eligible people", () => {
        const states = [state(ROLE, { assignments: [{ principal: ANNA, type: "eligible", scope: "/", start: null, end: null }, { principal: BRAM, type: "active", scope: "/", start: null, end: null }] })];
        const hit = outcome([setting(ROLE, "activationRequirement", { kind: "mfa" }, { kind: "none" }), setting(ROLE, "maxActivationDuration", "PT2H", "PT8H")], "activationChanges", { states });
        expect(hit).toMatchObject({ outcome: "pass", info: true });
        expect(hit.items.map((i) => i.text)).toEqual([
            "Global Administrator: 1 eligible person must use multifactor authentication at the next activation.",
            "Global Administrator: activations get shorter, 8 hours becomes 2 hours. Running activations keep their end time.",
        ]);
        expect(outcome([setting(ROLE, "requireApproval", false, true)], "activationChanges", { states }).info).toBeUndefined();
    });

    it("permanent allowed on a built-in privileged role: warn", () => {
        const states = [state(ROLE, { isPrivileged: true, isBuiltIn: true, settings: { ...BASE, allowPermanentActive: false } }), state(READER, { isPrivileged: false })];
        expect(outcome([setting(ROLE, "allowPermanentActive", true, false)], "permanentPrivileged", { states })).toMatchObject({ outcome: "warn", text: "Microsoft may answer InvalidPolicy for Global Administrator." });
        expect(outcome([setting(READER, "allowPermanentActive", true, false)], "permanentPrivileged", { states }).outcome).toBe("pass");
    });

    it("activation without a required end: warn for a touched target (T5)", () => {
        const states = [state(ROLE, { activationEndRequired: false }), state(READER, { activationEndRequired: true })];
        expect(outcome([setting(ROLE, "requireApproval", true)], "activationEnd", { states }).outcome).toBe("warn");
        expect(outcome([setting(READER, "requireApproval", true)], "activationEnd", { states }).outcome).toBe("pass");
    });

    it("Conditional Access behind a context: warn for report-only or off, never passed without the read", () => {
        const to = (contextId: string) => setting(ROLE, "activationRequirement", { kind: "authenticationContext", contextId }, { kind: "none" });
        expect(outcome([to("c1")], "contextPolicies").outcome).toBe("pass");
        const reportOnly = outcome([to("c2")], "contextPolicies");
        expect(reportOnly.outcome).toBe("warn");
        expect(reportOnly.items[0].text).toContain("report-only");
        expect(outcome([to("c3")], "contextPolicies").items[0].text).toContain("off");
        expect(outcome([to("c9")], "contextPolicies").items[0].text).toContain("no Conditional Access policy");
        const notChecked = outcome([to("c1")], "contextPolicies", { conditionalAccess: { status: "notChecked", reason: "needs Security Reader" } });
        expect(notChecked).toMatchObject({ outcome: "notChecked", fix: { kind: "checkConditionalAccess" } });
        expect(outcome([setting(ROLE, "requireApproval", true)], "contextPolicies", { conditionalAccess: { status: "notChecked", reason: "x" } }).outcome).toBe("pass");
    });

    it("removing your own access and an emergency account losing access: warn", () => {
        expect(outcome([remove(ROLE, ME)], "ownAccess").outcome).toBe("warn");
        expect(outcome([remove(ROLE, ANNA)], "ownAccess").outcome).toBe("pass");
        expect(outcome([remove(ROLE, BREAKGLASS)], "emergencyAccess").items[0].text).toContain("Break glass 01 loses");
        expect(outcome([update(ROLE, BREAKGLASS, inDays(10))], "emergencyAccess").outcome).toBe("warn");
        expect(outcome([update(ROLE, BREAKGLASS, null)], "emergencyAccess").outcome).toBe("pass");
    });

    it("the last owner of a group: removing it blocks, eligible owners count too (T2b)", () => {
        const owners = [state(GROUP_OWNER, { assignments: [{ principal: ANNA, type: "eligible", scope: "/", start: ago(100), end: null }] })];
        expect(outcome([remove(GROUP_OWNER, ANNA)], "lastOwner", { states: owners }).outcome).toBe("block");
        expect(outcome([remove(GROUP_OWNER, ANNA), add(GROUP_OWNER, BRAM, { type: "active", end: null })], "lastOwner", { states: owners }).outcome).toBe("pass");
        // The last active owner cannot go either, even with an eligible owner left (Learn, T2b)
        const mixed = [state(GROUP_OWNER, { assignments: [{ principal: ANNA, type: "active", scope: "/", start: ago(100), end: null }, { principal: BRAM, type: "eligible", scope: "/", start: ago(100), end: null }] })];
        const hit = outcome([remove(GROUP_OWNER, ANNA, { type: "active" })], "lastOwner", { states: mixed });
        expect(hit.outcome).toBe("block");
        expect(hit.items[0].text).toContain("no active owner left");
        // A change of end of the only active owner is refused as well (tenant run 2026-10-09, adminUpdate replaces the schedule)
        const changed = outcome([update(GROUP_OWNER, ANNA, inDays(20))], "lastOwner", { states: mixed });
        expect(changed.outcome).toBe("block");
        expect(changed.items[0].text).toContain("only active owner");
        // With a second active owner added in the same apply (adds go first) the change of end is fine
        expect(outcome([update(GROUP_OWNER, ANNA, inDays(20)), add(GROUP_OWNER, BRAM, { type: "active", end: null })], "lastOwner", { states: mixed }).outcome).toBe("pass");
    });

    it("the only active owner with an end: warn with Microsoft's rule (T2h), also when the last permanent owner goes", () => {
        const owners = [state(GROUP_OWNER, { assignments: [
            { principal: ANNA, type: "active", scope: "/", start: ago(100), end: null },
            { principal: BRAM, type: "active", scope: "/", start: ago(100), end: inDays(30) },
        ] })];
        const hit = outcome([remove(GROUP_OWNER, ANNA, { type: "active" })], "onlyActiveOwner", { states: owners });
        expect(hit.outcome).toBe("warn");
        expect(hit.items[0].text).toBe("When Bram's ownership ends, Microsoft keeps it until Tier 0 Admins has another active owner, and after 30 days for good. Add a permanent owner.");
        expect(outcome([update(GROUP_OWNER, ANNA, inDays(5)), remove(GROUP_OWNER, BRAM, { type: "active" })], "onlyActiveOwner", { states: owners }).outcome).toBe("warn");
        expect(outcome([add(GROUP_OWNER, person("carl"))], "onlyActiveOwner", { states: owners }).outcome).toBe("pass");
    });

    it("a group comes under PIM: info once per group (T6)", () => {
        const states = [state(OUTSIDE_MEMBER, { isUnderPim: false }), state({ kind: "group", id: "g2", access: "owner" }, { isUnderPim: false })];
        const hit = outcome([add(OUTSIDE_MEMBER, ANNA), add({ kind: "group", id: "g2", access: "owner" }, BRAM)], "comesUnderPim", { states });
        expect(hit).toMatchObject({ outcome: "pass", info: true });
        expect(hit.items).toHaveLength(1);
        expect(hit.items[0].text).toBe("Sales comes under PIM. Its Member and Owner settings stay as they are now.");
        expect(outcome([add(GROUP_MEMBER, ANNA)], "comesUnderPim").info).toBeUndefined();
    });

    it("new assignments checked by Microsoft: blocks a rejected one with its reason, not checked until the dry run ran", () => {
        const a = add(ROLE, ANNA);
        const b = add(ROLE, BRAM);
        const rejected = outcome([a, b], "dryRun", { dryRun: { [changeId(a)]: { ok: true }, [changeId(b)]: { ok: false, message: "The requested duration exceeds what this role's PIM policy allows.", transient: false } } });
        expect(rejected.outcome).toBe("block");
        expect(rejected.items).toEqual([expect.objectContaining({ changeId: changeId(b), text: expect.stringContaining("exceeds") })]);
        expect(outcome([a], "dryRun", { dryRun: { [changeId(a)]: { ok: true } } }).outcome).toBe("pass");
        expect(outcome([a], "dryRun", { dryRun: null }).outcome).toBe("notChecked");
        expect(outcome([a], "dryRun", { dryRun: { [changeId(a)]: { ok: false, message: "throttled", transient: true } } }).outcome).toBe("notChecked");
        // Removals and updates are never sent to the dry run
        expect(outcome([remove(ROLE, ANNA), update(ROLE, BRAM, inDays(3))], "dryRun", { dryRun: null }).outcome).toBe("pass");
    });

    it("an assignment already there: duplicates are skipped and not sent to the dry run", () => {
        const states = [state(ROLE, { assignments: [{ principal: ANNA, type: "eligible", scope: "/", start: null, end: null }] })];
        const dup = add(ROLE, ANNA);
        expect(outcome([dup], "duplicates", { states })).toMatchObject({ outcome: "pass", info: true });
        expect(outcome([dup], "dryRun", { states, dryRun: null }).outcome).toBe("pass");
        expect(outcome([add(ROLE, ANNA, { type: "active" })], "duplicates", { states }).info).toBeUndefined();
    });

    it("scheduled assignments: a later start waits (warn), a change of a scheduled assignment blocks (T8)", () => {
        expect(outcome([add(ROLE, ANNA, { start: inDays(2) })], "scheduled").outcome).toBe("warn");
        expect(outcome([update(ROLE, ANNA, inDays(30), { start: inDays(1) })], "scheduled").outcome).toBe("block");
        expect(outcome([remove(ROLE, ANNA, { start: inDays(1) })], "scheduled").outcome).toBe("block");
        expect(outcome([add(ROLE, ANNA)], "scheduled").outcome).toBe("pass");
    });

    it("a removal less than five minutes after the start: warn with the time it can be removed (L7)", () => {
        const hit = outcome([remove(ROLE, ANNA, { start: ago(2) })], "recentRemoval");
        expect(hit.outcome).toBe("warn");
        expect(hit.items[0].text).toContain("can be removed from 2026-10-04 12:03 UTC");
        expect(outcome([remove(ROLE, ANNA, { start: ago(6) })], "recentRemoval").outcome).toBe("pass");
    });

    it("the five-minute removal rule holds for groups too (Learn, groups-assign-member-owner; R-32)", () => {
        const hit = outcome([remove(GROUP_MEMBER, ANNA, { start: ago(2) }), remove(GROUP_OWNER, BRAM, { start: ago(1), type: "active" })], "recentRemoval");
        expect(hit.outcome).toBe("warn");
        expect(hit.items.map((i) => i.target)).toEqual([GROUP_MEMBER, GROUP_OWNER]);
        expect(outcome([remove(GROUP_MEMBER, ANNA, { start: ago(6) })], "recentRemoval").outcome).toBe("pass");
    });

    it("prevented by the editors: removals through a group, ends beyond the maximum, a group principal that is not role-assignable", () => {
        const checks = buildPreflight(input([]));
        expect(["removalViaGroup", "endBeyondMax", "groupPrincipal"].map((id) => find(checks, id as PreflightCheckId).outcome)).toEqual(["prevented", "prevented", "prevented"]);
    });

    it("a linked custom extension that no longer exists: warn", () => {
        const states = [state(ROLE, { settings: { ...BASE, customExtensions: { preApproval: { customExtensionId: "gone", displayName: "Old" } } as PolicySettings["customExtensions"] } })];
        expect(outcome([setting(ROLE, "requireApproval", true)], "customExtension", { states }).outcome).toBe("warn");
        expect(outcome([setting(ROLE, "requireApproval", true)], "customExtension", { states, customExtensionIds: new Set(["gone"]) }).outcome).toBe("pass");
        expect(outcome([setting(ROLE, "requireApproval", true)], "customExtension", { states, customExtensionIds: null }).outcome).toBe("pass");
    });
});

describe("preflightVerdict and summarizeContextPolicies", () => {
    it("fix before apply when anything blocks, look at warnings and not checked, otherwise ready", () => {
        const base = (o: PreflightCheck["outcome"]): PreflightCheck => ({ id: "access", outcome: o, title: "", text: "", targets: [], items: [] });
        expect(preflightVerdict([base("pass"), base("prevented")])).toEqual({ kind: "ready", count: 0 });
        expect(preflightVerdict([base("warn"), base("notChecked")])).toEqual({ kind: "lookAt", count: 2 });
        expect(preflightVerdict([base("warn"), base("block")])).toEqual({ kind: "fix", count: 1 });
    });

    it("a context is enabled when one policy that targets it is on, else report-only, off or none, with what the enabled ones require", () => {
        const p = (state: string, contexts: string[], extra: object = {}) => ({ state, conditions: { applications: { includeAuthenticationContextClassReferences: contexts } }, ...extra });
        const summary = summarizeContextPolicies([
            p("disabled", ["c1"], { grantControls: { builtInControls: ["compliantDevice"] } }),
            p("enabled", ["c1"], { grantControls: { builtInControls: [], authenticationStrength: { id: "strength-4" } }, sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: "everyTime" } } }),
            p("enabledForReportingButNotEnforced", ["c2"]),
            p("disabled", ["c3"]),
        ], ["c1", "c2", "c3", "c4"]);
        expect(Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.state]))).toEqual({ c1: "enabled", c2: "reportOnly", c3: "off", c4: "none" });
        // Only enabled policies count for the requirements
        expect(summary.c1).toEqual({ state: "enabled", authenticationStrengthIds: ["strength-4"], signInFrequencyEveryTime: true, compliantDevice: false });
    });

    it("conditionalAccessInput: only a completed read is ready; no permission, 403, failure or a running read is not checked", () => {
        const policies = [{ state: "enabled", conditions: { applications: { includeAuthenticationContextClassReferences: ["c1"] } } }];
        expect(conditionalAccessInput("ready", policies, ["c1"])).toMatchObject({ status: "ready", contexts: { c1: { state: "enabled" } } });
        for (const status of ["idle", "checking", "notGranted", "forbidden", "failed"] as const) {
            expect(conditionalAccessInput(status, null, ["c1"]).status).toBe("notChecked");
        }
        expect(conditionalAccessInput("forbidden", null, ["c1"])).toMatchObject({ reason: expect.stringContaining("Security Reader") });
        // And the context check then says Not checked, never Passed
        const to = setting(ROLE, "activationRequirement", { kind: "authenticationContext", contextId: "c1" }, { kind: "none" });
        expect(outcome([to], "contextPolicies", { conditionalAccess: conditionalAccessInput("forbidden", null, ["c1"]) }).outcome).toBe("notChecked");
    });
});

describe("buildPreflight: the undo checks (spec 14.3)", () => {
    const undo = { from: "undo" as const };
    const back = setting(ROLE, "maxActivationDuration", "PT8H", "PT4H", undo);
    const removeAnna = remove(ROLE, ANNA);
    const readd = add(ROLE, BRAM, { source: undo });

    it("only for an undo basket, and only while its change is in the basket", () => {
        expect(buildPreflight(input([back])).some((c) => c.id.startsWith("undo"))).toBe(false);
        const warnings = [{ kind: "changedMeanwhile" as const, target: ROLE, changeId: changeId(back), text: "x" }];
        expect(outcome([back], "undoChangedMeanwhile", { undoWarnings: warnings })).toMatchObject({ outcome: "warn", items: [{ text: "Global Administrator was changed by someone else after this apply; undo would overwrite it." }] });
        expect(outcome([], "undoChangedMeanwhile", { undoWarnings: warnings }).outcome).toBe("pass");
    });

    it("too recent warns with the time, a target not read again warns, the last owner is left to the live check, a re-added assignment says it starts again", () => {
        const from = "2026-10-04T12:03:00.000Z";
        const recent = { kind: "tooRecent" as const, target: ROLE, changeId: changeId(removeAnna), from, text: `Anna can be removed from ${from}.` };
        expect(outcome([removeAnna], "undoTooRecent", { undoWarnings: [recent] }).items[0].text).toBe("Anna can be removed from 2026-10-04 12:03 UTC.");
        expect(buildPreflight(input([removeAnna], { undoWarnings: [{ kind: "lastOwner", target: GROUP_OWNER, text: "Add another owner first." }] })).some((c) => c.id.startsWith("undo") && c.outcome === "block")).toBe(false);
        expect(outcome([removeAnna], "undoNotRead", { undoWarnings: [{ kind: "notRead", target: ROLE, text: "Maximum activation duration could not be read again, so it is left out of the undo." }] }))
            .toMatchObject({ outcome: "warn", items: [{ text: "Global Administrator: Maximum activation duration could not be read again, so it is left out of the undo." }] });
        expect(outcome([readd], "undoLimits", { undoWarnings: [] })).toMatchObject({ outcome: "pass", info: true });
    });
});
