import { describe, expect, it } from "vitest";
import { buildReportGroups, buildReportRoles, buildReportRules, PEOPLE } from "@/__tests__/fixtures/reportFixture";
import type { RoleDefinition } from "@/types/directoryRole.types";
import {
    ACTIVATED_NOTE,
    EMPTY_FORM,
    LAST_ACTIVE_OWNER,
    LAST_OWNER,
    ONLY_NO_END,
    allowsOnlyNoEnd,
    buildAdds,
    capEnd,
    buildGroupWhoRows,
    buildRoleWhoRows,
    checkForm,
    countWhoRows,
    describeEnd,
    describeMaxChoice,
    describePolicySentence,
    endChange,
    filterWhoRows,
    hasProblems,
    maxEndFrom,
    onSide,
    policyLimits,
    removeChange,
    scopeOptions,
    supportsAdministrativeUnit,
    supportsApplication,
    type AddForm,
    type FormTarget,
} from "@/utils/assignmentForm";
import { addChange, EMPTY_BASKET } from "@/utils/configureBasket";
import { readTargetSettings } from "@/utils/configureSettingRows";

const now = new Date(2026, 9, 4, 12, 0);
const roles = buildReportRoles();
const groups = buildReportGroups();
const ctx = { basket: EMPTY_BASKET, emergencyAccountIds: new Set([PEOPLE.bg1.id.toLowerCase()]), now };
const role = (id: string) => roles.find((r) => r.definition.id === id)!;
const group = (id: string) => groups.find((g) => g.group.id === id)!;
// Fixture policy: eligible up to 365 days and permanent allowed, active up to 180 days with an end and a justification
const settings = readTargetSettings(buildReportRules());
const roleTarget = (id: string): FormTarget => ({ target: { kind: "role", id }, name: role(id).definition.displayName, settings });
const form = (o: Partial<AddForm>): AddForm => ({ ...EMPTY_FORM(), principals: [{ id: PEOPLE.mo.id, kind: "user", displayName: PEOPLE.mo.displayName }], ...o });

describe("Who has it rows (spec 5.7)", () => {
    it("maps Agent ID principals to Configure's service principal or user kinds", () => {
        const base = role("role-ga");
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
        const rows = buildRoleWhoRows(withAgents, groups, ctx);
        expect(rows.find((row) => row.principal.id === "agent-identity")?.principal.kind).toBe("servicePrincipal");
        expect(rows.find((row) => row.principal.id === "agent-user")?.principal.kind).toBe("user");
    });

    it("a role: eligible and active rows with their end, scope, emergency access and actions", () => {
        const rows = buildRoleWhoRows(role("role-ga"), groups, ctx);
        expect(countWhoRows(rows)).toEqual({ all: 5, eligible: 3, active: 2 });
        const anna = rows.find((r) => r.principal.id === PEOPLE.anna.id)!;
        expect([anna.type, describeEnd(anna), anna.scopeLabel, anna.canRemove, anna.canChangeEnd]).toEqual(["eligible", "Ends 14 Mar 2027", "Tenant-wide", true, true]);
        const bg1 = rows.find((r) => r.principal.id === PEOPLE.bg1.id)!;
        expect([bg1.isEmergency, describeEnd(bg1), bg1.canChangeEnd, bg1.canRemove]).toEqual([true, "No end date", false, true]);
        expect(rows.find((r) => r.principal.id === "g-tier0")?.kind).toBe("group");
    });

    it("an activation ends by itself: no Remove, no Change end", () => {
        const ravi = buildRoleWhoRows(role("role-sec"), groups, ctx).find((r) => r.principal.id === PEOPLE.ravi.id)!;
        expect([ravi.isActivated, ravi.canRemove, ravi.canChangeEnd, ravi.note]).toEqual([true, false, false, ACTIVATED_NOTE]);
    });

    it("an activation through a group names its group (the one group that holds the role with the person as a member)", () => {
        const base = role("role-pra");
        const viaRole = {
            ...base,
            assignments: {
                ...base.assignments,
                eligible: [...base.assignments.eligible, { ...base.assignments.eligible[0], id: "e-hd", principalId: "g-helpdesk1", principal: { id: "g-helpdesk1", displayName: "Helpdesk Tier 1", "@odata.type": "#microsoft.graph.group" } }],
                active: [{ ...base.assignments.eligible[0], id: "a-lotte", principalId: PEOPLE.lotte.id, principal: { ...PEOPLE.lotte }, assignmentType: "Activated", viaGroup: true }],
            },
        } as unknown as typeof base;
        const lotte = buildRoleWhoRows(viaRole, groups, ctx).find((r) => r.key === "active:a-lotte")!;
        expect(lotte.viaGroup).toEqual({ id: "g-helpdesk1", name: "Helpdesk Tier 1" });
        expect([lotte.canRemove, lotte.note]).toEqual([false, "Comes from Helpdesk Tier 1. Change the group's members instead."]);
    });

    it("an end in the past that Microsoft still lists shows as Ended, counts by its type and has no Renew (tenant run 2026-10-09)", () => {
        const g = group("g-dev");
        // Bram's eligible membership ended yesterday (Microsoft keeps such a row only for the last active owner, T2h)
        const ended = { ...g, assignments: g.assignments.map((a) => (a.principalId === PEOPLE.bram.id ? { ...a, endDateTime: "2026-10-03T00:00:00Z" } : a)) };
        const rows = buildGroupWhoRows(ended, ctx);
        const bram = rows.find((r) => r.principal.id === PEOPLE.bram.id)!;
        expect([bram.status, describeEnd(bram), bram.canRemove, bram.canChangeEnd]).toEqual(["expired", "Ended 3 Oct 2026", false, false]);
        expect("canRenew" in bram).toBe(false);
        expect(filterWhoRows(rows, "eligible").some((r) => r.principal.id === PEOPLE.bram.id)).toBe(true);
        expect(Object.keys(countWhoRows(rows))).toEqual(["all", "eligible", "active"]);
        expect(endChange(bram, "2027-04-01T00:00:00.000Z").action).toBe("adminUpdate");
    });

    it("a group lists both sides, each with its own target; the last owner cannot be removed", () => {
        const rows = buildGroupWhoRows(group("g-helpdesk1"), ctx);
        const erik = rows.find((r) => r.access === "owner")!;
        expect(erik.target).toEqual({ kind: "group", id: "g-helpdesk1", access: "owner" });
        expect([erik.canRemove, erik.removeBlockedReason]).toEqual([false, LAST_OWNER]);
        expect(rows.filter((r) => r.access === "member").every((r) => r.removeBlockedReason === null)).toBe(true);
    });

    it("with two owners one may go; once its removal waits, the other is the last", () => {
        const g = group("g-helpdesk1");
        const two = { ...g, assignments: [...g.assignments, { ...g.assignments.find((a) => a.accessType === "owner")!, id: "second", principalId: PEOPLE.lotte.id, principal: { ...PEOPLE.lotte } }] };
        const rows = buildGroupWhoRows(two as typeof g, ctx);
        expect(rows.filter((r) => r.access === "owner").map((r) => r.canRemove)).toEqual([true, true]);
        const basket = addChange(EMPTY_BASKET, removeChange(rows.find((r) => r.access === "owner")!));
        const after = buildGroupWhoRows(two as typeof g, { ...ctx, basket });
        const owners = after.filter((r) => r.access === "owner");
        expect(owners[0].pending?.kind).toBe("remove");
        expect([owners[1].canRemove, owners[1].removeBlockedReason]).toEqual([false, LAST_OWNER]);
    });

    it("the only active owner next to eligible owners: no Remove and no Change end (tenant run 2026-10-09)", () => {
        const g = group("g-helpdesk1");
        const owner = g.assignments.find((a) => a.accessType === "owner")!;
        // Erik is the active owner, with an end; Lotte becomes an eligible owner next to him
        const mixed = { ...g, assignments: [...g.assignments.map((a) => (a === owner ? { ...a, endDateTime: "2027-01-01T00:00:00Z" } : a)), { ...owner, id: "eligible-owner", principalId: PEOPLE.lotte.id, principal: { ...PEOPLE.lotte }, assignmentType: "eligible" }] };
        const owners = buildGroupWhoRows(mixed as typeof g, ctx).filter((r) => r.access === "owner");
        const active = owners.find((r) => r.type === "active")!;
        const eligible = owners.find((r) => r.type === "eligible")!;
        expect([active.canRemove, active.canChangeEnd, active.removeBlockedReason]).toEqual([false, false, LAST_ACTIVE_OWNER]);
        expect([eligible.canRemove, eligible.removeBlockedReason]).toEqual([true, null]);
    });

    it("a change of end waits on its row; back to the end read removes it", () => {
        const anna = buildRoleWhoRows(role("role-ga"), groups, ctx).find((r) => r.principal.id === PEOPLE.anna.id)!;
        const change = endChange(anna, "2027-01-31T00:00:00.000Z");
        expect(change.action).toBe("adminUpdate");
        const basket = addChange(EMPTY_BASKET, change);
        expect(buildRoleWhoRows(role("role-ga"), groups, { ...ctx, basket }).find((r) => r.key === anna.key)?.pending).toEqual(change);
        expect(addChange(basket, endChange(anna, anna.schedule.end)).changes).toEqual([]);
    });
});

describe("the policy decides (spec 5.7, bug 9)", () => {
    it("limits per type from the policy as read", () => {
        expect(policyLimits(settings, "eligible")).toEqual({ maxDuration: "P1Y", permanentAllowed: true, justificationRequired: false });
        expect(policyLimits(settings, "active")).toEqual({ maxDuration: "P180D", permanentAllowed: false, justificationRequired: true });
        expect(policyLimits(null, "active")).toEqual({ maxDuration: null, permanentAllowed: null, justificationRequired: false });
        expect(describePolicySentence(settings)).toBe("The policy decides what is allowed: permanent eligible assignments are allowed, active assignments end within 6 months, a justification is required for active.");
    });

    it("no end date is refused when the policy requires an end", () => {
        expect(checkForm(form({ type: "active", end: { kind: "none" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBe("The policy requires an end date.");
        expect(hasProblems(checkForm(form({ type: "eligible", end: { kind: "none" } }), [roleTarget("role-ga")], now))).toBe(false);
    });

    it("an end beyond the maximum is refused; the maximum itself is fine", () => {
        expect(checkForm(form({ type: "active", end: { kind: "date", date: "2027-06-01" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBe("Later than the policy maximum of Global Administrator.");
        expect(checkForm(form({ type: "active", end: { kind: "date", date: "2027-03-01" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBeUndefined();
        // The day of the maximum itself is fine, and its end is the maximum, not the end of that day
        expect(checkForm(form({ type: "active", end: { kind: "date", date: "2027-04-02" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBeUndefined();
        expect(checkForm(form({ type: "active", end: { kind: "date", date: "2027-04-03" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBe("Later than the policy maximum of Global Administrator.");
        expect(capEnd("2027-04-02", policyLimits(settings, "active"), now)).toBe(new Date(2027, 3, 2, 12, 0).toISOString());
        expect(checkForm(form({ type: "active", end: { kind: "date", date: "2026-10-01" }, justification: "x" }), [roleTarget("role-ga")], now).end).toBe("The end must be after the start.");
    });

    it("an end today that leaves less than five minutes is refused (Learn: at least five minutes, R-53)", () => {
        const late = new Date(2026, 9, 4, 23, 57);
        expect(checkForm(form({ end: { kind: "date", date: "2026-10-04" } }), [roleTarget("role-ga")], late).end).toBe("An assignment must last at least five minutes.");
        expect(checkForm(form({ end: { kind: "date", date: "2026-10-04" } }), [roleTarget("role-ga")], new Date(2026, 9, 4, 23, 50)).end).toBeUndefined();
        expect(checkForm(form({ end: { kind: "date", date: "2026-10-05" } }), [roleTarget("role-ga")], late).end).toBeUndefined();
    });

    it("justification required for active when the policy says so; a start in the past refused", () => {
        expect(checkForm(form({ type: "active" }), [roleTarget("role-ga")], now).justification).toBe("The policy requires a justification for active assignments.");
        expect(checkForm(form({ type: "eligible" }), [roleTarget("role-ga")], now).justification).toBeUndefined();
        expect(checkForm(form({ start: { kind: "date", date: "2026-10-01" } }), [roleTarget("role-ga")], now).start).toBe("The start cannot be in the past.");
        expect(checkForm(form({ principals: [] }), [roleTarget("role-ga")], now).principals).toBe("Choose at least one person or group.");
    });

    it("the maximum choice names the duration and its date", () => {
        expect(describeMaxChoice([roleTarget("role-ga")], "active", now)).toBe("Policy maximum: 6 months (2 Apr 2027)");
        expect(describeMaxChoice([roleTarget("role-ga"), roleTarget("role-pra")], "active", now)).toBe("The maximum of each policy");
        // Permanent allowed: the stored maximum still caps a date (tenant test T3, M-13); no end at all stays allowed
        expect(describeMaxChoice([roleTarget("role-ga")], "eligible", now)).toBe("Policy maximum: 1 year (4 Oct 2027)");
        expect(checkForm(form({ end: { kind: "date", date: "2028-01-01" } }), [roleTarget("role-ga")], now).end).toContain("Later than the policy maximum");
        expect(checkForm(form({ end: { kind: "date", date: "2027-06-01" } }), [roleTarget("role-ga")], now).end).toBeUndefined();
    });
});

describe("a policy stored as PT0S allows only no end (tenant run 2026-10-09, M-13)", () => {
    // Permanent eligible allowed with the maximum Graph stores as PT0S: Microsoft refused P30D and granted noExpiration
    const pt0s = { ...settings!, eligibleExpiration: "PT0S" };
    const pt0sTarget: FormTarget = { target: { kind: "role", id: "role-gi" }, name: "Guest Inviter", settings: pt0s };

    it("knows the policy, offers no end as the maximum and gives no dated maximum", () => {
        const limits = policyLimits(pt0s, "eligible");
        expect(allowsOnlyNoEnd(limits)).toBe(true);
        expect(allowsOnlyNoEnd(policyLimits(settings, "eligible"))).toBe(false);
        expect(maxEndFrom(limits, now)).toBeNull();
        expect(describeMaxChoice([pt0sTarget], "eligible", now)).toBe("No end date (the only end the policy allows)");
        expect(describePolicySentence(pt0s)).toContain("eligible assignments must be permanent");
    });

    it("refuses a dated end, takes no end, and the maximum choice writes no end", () => {
        expect(checkForm(form({ end: { kind: "date", date: "2026-11-01" } }), [pt0sTarget], now).end).toBe(ONLY_NO_END);
        expect(checkForm(form({ end: { kind: "none" } }), [pt0sTarget], now).end).toBeUndefined();
        expect(buildAdds(form({ end: { kind: "max" } }), [pt0sTarget], now)[0].end).toBeNull();
        expect(checkForm(form({ end: { kind: "date", date: "2026-11-01" } }), [pt0sTarget, roleTarget("role-ga")], now).end).toBe("The policy of Guest Inviter allows only assignments without an end date.");
    });
});

describe("a change of end carries a justification (tenant run 2026-10-09: JustificationRule on adminUpdate)", () => {
    it("adds the justification when given, leaves it out when empty", () => {
        const anna = buildRoleWhoRows(role("role-ga"), groups, ctx).find((r) => r.principal.id === PEOPLE.anna.id)!;
        expect(endChange(anna, "2027-01-31T00:00:00.000Z", "  extend for the project ").justification).toBe("extend for the project");
        expect("justification" in endChange(anna, "2027-01-31T00:00:00.000Z")).toBe(false);
    });
});

describe("the changes of the form", () => {
    it("one add per person and target; when applied leaves the start out; the end is the policy maximum", () => {
        const adds = buildAdds(form({ type: "active", justification: " needed " }), [roleTarget("role-ga"), roleTarget("role-pra")], now);
        expect(adds).toHaveLength(2);
        expect(adds[0]).toMatchObject({ kind: "add", target: { kind: "role", id: "role-ga" }, type: "active", scope: "/", start: null, justification: "needed" });
        expect(new Date(adds[0].end!).toDateString()).toBe(new Date(2027, 3, 2, 12).toDateString());
    });

    it("a future start makes a scheduled add; a group writes the side chosen; no end when allowed", () => {
        const owner = readTargetSettings(buildReportRules({ permanentActive: true }));
        const g: FormTarget = { target: { kind: "group", id: "g-dev", access: "member" }, name: "Dev Leads", settings, sides: { member: settings, owner } };
        const [sided] = onSide([g], "owner");
        expect(sided.settings).toBe(owner);
        const [add] = buildAdds(form({ access: "owner", start: { kind: "date", date: "2026-11-01" }, end: { kind: "none" } }), [sided], now);
        expect(add.target).toEqual({ kind: "group", id: "g-dev", access: "owner" });
        expect(new Date(add.start!).getDate()).toBe(1);
        expect(add.end).toBeNull();
    });
});

describe("scopes of a role (Microsoft Learn: Assign Microsoft Entra roles)", () => {
    const def = (o: Partial<RoleDefinition>): RoleDefinition => ({ id: "r", displayName: "X", description: "", isBuiltIn: true, ...o });
    it("administrative units for the documented built-in roles and custom roles on users, groups or devices", () => {
        expect(supportsAdministrativeUnit(def({ displayName: "User Administrator" }))).toBe(true);
        expect(supportsAdministrativeUnit(def({ displayName: "Global Administrator" }))).toBe(false);
        expect(supportsAdministrativeUnit(def({ isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/users/password/update"] }] }))).toBe(true);
        expect(supportsAdministrativeUnit(def({ isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/applications/basic/update"] }] }))).toBe(false);
    });

    it("one application for Application Administrator and custom app registration roles", () => {
        expect(supportsApplication(def({ displayName: "Application Administrator" }))).toBe(true);
        expect(supportsApplication(def({ displayName: "Cloud Application Administrator" }))).toBe(true);
        expect(supportsApplication(def({ displayName: "Global Administrator" }))).toBe(false);
        expect(supportsApplication(def({ isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/applications/credentials/update"] }] }))).toBe(true);
        expect(supportsApplication(def({ isBuiltIn: false, rolePermissions: [{ allowedResourceActions: ["microsoft.directory/applications/credentials/update", "microsoft.directory/users/basic/update"] }] }))).toBe(false);
        const options = scopeOptions(def({ displayName: "User Administrator" }), [{ id: "au1", displayName: "Netherlands" }], [{ id: "app1", displayName: "Payroll" }]);
        expect(options).toEqual([{ value: "/", label: "Tenant-wide" }, { value: "/administrativeUnits/au1", label: "Administrative unit: Netherlands" }]);
    });
});
