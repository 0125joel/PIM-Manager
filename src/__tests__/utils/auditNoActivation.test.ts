import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import type { PimAssignmentSchedule, PimEligibilitySchedule, Principal, RoleDetailData } from "@/types/directoryRole.types";
import type { GroupPimAssignment, PimGroupData } from "@/types/pimGroup.types";
import {
    STATE_GROUP_WORDS,
    TEXT_APP,
    TEXT_APP_ELIGIBLE,
    TEXT_HELD_BY_GROUP,
    TEXT_MEMBERS_UNREAD,
    TEXT_NEVER,
    TEXT_NESTED_GROUP,
    TEXT_NO_MEMBERS,
    buildNoActivationRows,
    countNoActivation,
    eligibleGroupIds,
    filterNoActivationRows,
    noActivationHonesty,
    noActivationLimits,
    stateGroupOf,
    type GroupMembersLookup,
    type NoActivationRow,
} from "@/utils/auditNoActivation";
import { IDLE_EMERGENCY_IDS, IDLE_NOW, buildIdleEvents, buildIdleGroups, buildIdleMembership, buildIdleRoles } from "@/app/dev/audit/idleData";

const NOW = new Date("2026-11-05T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;

const ROLE = "role-1";
const GROUP = "group-1";
const person = (id: string, displayName: string): Principal => ({ id, displayName, "@odata.type": "#microsoft.graph.user" });
const ANNA = person("ANNA-ID", "Anna Test");
const BERT = person("bert-id", "Bert Test");

function eligible(principal: Principal, startDaysAgo: number | null, memberType = "Direct", scope = "/"): PimEligibilitySchedule {
    return {
        id: `el-${principal.id}-${startDaysAgo}-${scope}`,
        principalId: principal.id,
        roleDefinitionId: ROLE,
        directoryScopeId: scope,
        memberType,
        scopeInfo: scope === "/" ? undefined : { type: "administrative-unit", displayName: "Contoso Sales", id: scope },
        status: "Provisioned",
        principal,
        scheduleInfo: startDaysAgo === null ? undefined : { startDateTime: ago(startDaysAgo), expiration: { type: "noExpiration" } },
    };
}

function activeAssigned(principal: Principal, kind: "permanent" | "until", assignmentType = "Assigned"): PimAssignmentSchedule {
    return {
        id: `ac-${principal.id}`,
        principalId: principal.id,
        roleDefinitionId: ROLE,
        directoryScopeId: "/",
        memberType: "Direct",
        status: "Provisioned",
        assignmentType,
        principal,
        scheduleInfo: kind === "permanent"
            ? { startDateTime: ago(300), expiration: { type: "noExpiration" } }
            : { startDateTime: ago(10), expiration: { type: "afterDateTime", endDateTime: "2026-12-01T00:00:00Z" } },
    };
}

function roleOf(eligibleList: PimEligibilitySchedule[], activeList: PimAssignmentSchedule[] = [], extra: { templateId?: string } = {}): RoleDetailData {
    return {
        definition: { id: ROLE, displayName: "Security Administrator", description: "", isBuiltIn: true, ...extra },
        assignments: { permanent: [], eligible: eligibleList, active: activeList },
    };
}

function usage(daysAgo: number, p: Principal, overrides: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id: `ev-${daysAgo}-${p.id}`,
        time: ago(daysAgo),
        kind: "usage",
        environment: "role",
        sentence: "x",
        actor: { name: p.displayName ?? "", id: p.id, kind: "person" },
        target: { name: p.displayName ?? "", id: p.id },
        role: { name: "Security Administrator", id: ROLE },
        scope: "",
        result: "success",
        source: "graph",
        correlationId: "c",
        ...overrides,
    };
}

function groupAssignment(p: Principal, access: "member" | "owner", startDaysAgo: number, extra: Partial<GroupPimAssignment> = {}): GroupPimAssignment {
    return { id: `ga-${p.id}-${access}`, groupId: GROUP, principalId: p.id, principal: p, accessType: access, assignmentType: "eligible", memberType: "Direct", startDateTime: ago(startDaysAgo), ...extra };
}

const groupOf = (assignments: GroupPimAssignment[]): PimGroupData => ({ group: { id: GROUP, displayName: "Finance", groupType: "security" }, assignments });

function rows(input: { roles?: RoleDetailData[]; groups?: PimGroupData[]; events?: AuditEvent[]; days?: number; emergencyIds?: ReadonlySet<string>; membership?: ReadonlyMap<string, GroupMembersLookup> }): NoActivationRow[] {
    return buildNoActivationRows({ roles: input.roles ?? [], groups: input.groups ?? [], events: input.events ?? [], days: input.days ?? 30, now: NOW, emergencyIds: input.emergencyIds, format: FORMAT, membership: input.membership });
}

const HELPDESK: Principal = { id: "g1", displayName: "Helpdesk", "@odata.type": "#microsoft.graph.group" };
const SP: Principal = { id: "s1", displayName: "Automation", "@odata.type": "#microsoft.graph.servicePrincipal" };
const ready = (...people: Principal[]): GroupMembersLookup => ({ status: "ready", members: people.map((p) => ({ id: p.id, displayName: p.displayName ?? "", kind: "user" as const })) });
const members = (lookup: GroupMembersLookup) => new Map<string, GroupMembersLookup>([[HELPDESK.id, lookup]]);

describe("the Activation cell of an eligible assignment", () => {
    it("says Last activated with the date when it was activated in the period", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 90)])], events: [usage(3, ANNA)] });
        expect(row.activationText).toBe("Last activated 2 Nov 2026");
        expect(row.state).toBe("activated");
        expect(row.isWarning).toBe(false);
    });

    it("uses the latest of several activations", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 90)])], events: [usage(10, ANNA), usage(2, ANNA), usage(20, ANNA)] });
        expect(row.lastActivated).toBe(ago(2));
    });

    it("warns when assigned before the period and not activated", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 90)])] });
        expect(row.activationText).toBe("None in this period");
        expect(row.isWarning).toBe(true);
        expect(row.state).toBe("none");
    });

    it("does not warn when assigned inside the period and says how long ago", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 3.5)])] });
        expect(row.activationText).toBe("None in this period; assigned 3 days ago");
        expect(row.isWarning).toBe(false);
        expect(rows({ roles: [roleOf([eligible(ANNA, 1.2)])] })[0].activationText).toBe("None in this period; assigned 1 day ago");
        expect(rows({ roles: [roleOf([eligible(ANNA, 0.2)])] })[0].activationText).toBe("None in this period; assigned today");
    });

    it("treats an assignment that starts exactly at the start of the period as having had the whole period", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 30)])] });
        expect(row.state).toBe("none");
        const [justInside] = rows({ roles: [roleOf([eligible(ANNA, 29.99)])] });
        expect(justInside.state).toBe("new");
    });

    it("gives no verdict and no warning when the start is missing, and never the text of a judged row", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, null)])] });
        expect(row.state).toBe("unknown-start");
        expect(row.activationText).toBe("None in this period; start date not known");
        expect(row.isWarning).toBe(false);
        expect(stateGroupOf(row.state)).toBe("notRead");
    });

    it("says when the start lies ahead, without a verdict", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, -5)])] });
        expect(row.state).toBe("unknown-start");
        expect(row.activationText).toBe("Starts 10 Nov 2026");
        expect(row.isWarning).toBe(false);
    });

    it("judges a person whose eligibility says memberType Group like any eligible person", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 90, "Group")])] });
        expect(row.state).toBe("none");
    });

    it("shows an eligible app as not read and never as a normal state", () => {
        const [row] = rows({ roles: [roleOf([eligible(SP, 90)])] });
        expect(row.state).toBe("not-read");
        expect(row.activationText).toBe(TEXT_APP_ELIGIBLE);
        expect(row.isWarning).toBe(false);
        expect(stateGroupOf(row.state)).toBe("notRead");
    });

    it("says an active app does not activate", () => {
        const [row] = rows({ roles: [roleOf([], [activeAssigned(SP, "permanent")])] });
        expect(row.state).toBe("app");
        expect(row.activationText).toBe(TEXT_APP);
        expect(row.isWarning).toBe(false);
    });
});

describe("scope", () => {
    const SALES = "/administrativeunits/au-1";

    it("counts an activation only for the assignment on the same scope", () => {
        const roles = [roleOf([eligible(ANNA, 90), eligible(ANNA, 90, "Direct", SALES)])];
        const result = rows({ roles, events: [usage(3, ANNA, { directoryScopeId: SALES })] });
        const tenantWide = result.find((r) => r.scopeId === "/");
        const unit = result.find((r) => r.scopeId === SALES);
        expect(unit?.state).toBe("activated");
        expect(tenantWide?.state).toBe("none");
        expect(tenantWide?.activationText).toBe("None in this period");
    });

    it("counts a tenant-wide activation only for the tenant-wide assignment", () => {
        const roles = [roleOf([eligible(ANNA, 90), eligible(ANNA, 90, "Direct", SALES)])];
        const result = rows({ roles, events: [usage(3, ANNA)] });
        expect(result.find((r) => r.scopeId === "/")?.state).toBe("activated");
        expect(result.find((r) => r.scopeId === SALES)?.state).toBe("none");
    });

    it("compares scopes without case, and reads an empty scope as tenant-wide, the same as /", () => {
        const roles = [roleOf([eligible(ANNA, 90, "Direct", SALES.toUpperCase())])];
        expect(rows({ roles, events: [usage(3, ANNA, { directoryScopeId: SALES })] })[0].state).toBe("activated");
        expect(rows({ roles: [roleOf([eligible(ANNA, 90, "Direct", "")])], events: [usage(3, ANNA, { directoryScopeId: "/" })] })[0].state).toBe("activated");
        expect(rows({ roles: [roleOf([eligible(ANNA, 90)])], events: [usage(3, ANNA, { directoryScopeId: "" })] })[0].state).toBe("activated");
    });

    it("names the scope as the Report does, and Directory for tenant-wide", () => {
        const result = rows({ roles: [roleOf([eligible(ANNA, 90), eligible(ANNA, 90, "Direct", SALES)])] });
        expect(result.map((r) => r.scopeName).sort()).toEqual(["Contoso Sales", "Directory"]);
    });
});

describe("eligible through a group", () => {
    const role = () => roleOf([eligible(HELPDESK, 80)]);

    it("gives one row per member, with the person as Who and the group under the name, each judged on their own", () => {
        const result = rows({ roles: [role()], membership: members(ready(ANNA, BERT)), events: [usage(3, BERT)] });
        expect(result).toHaveLength(2);
        const anna = result.find((r) => r.who === "Anna Test");
        const bert = result.find((r) => r.who === "Bert Test");
        expect(anna?.viaGroup).toBe("Helpdesk");
        expect(anna?.state).toBe("none");
        expect(anna?.isPerson).toBe(true);
        expect(bert?.state).toBe("activated");
    });

    it("takes the start of the group for each member", () => {
        const result = rows({ roles: [roleOf([eligible(HELPDESK, 3)])], membership: members(ready(ANNA)) });
        expect(result[0].state).toBe("new");
        expect(result[0].assignedAt).toBe(ago(3));
    });

    it("judges a member on the scope of the group's eligibility", () => {
        const sales = "/administrativeUnits/au-1";
        const result = rows({ roles: [roleOf([eligible(HELPDESK, 80, "Direct", sales)])], membership: members(ready(ANNA)), events: [usage(3, ANNA)] });
        expect(result[0].state).toBe("none");
        expect(rows({ roles: [roleOf([eligible(HELPDESK, 80, "Direct", sales)])], membership: members(ready(ANNA)), events: [usage(3, ANNA, { directoryScopeId: sales })] })[0].state).toBe("activated");
    });

    it("shows a skeleton row while the members are read", () => {
        const [row] = rows({ roles: [role()], membership: members({ status: "loading" }) });
        expect(row.state).toBe("loading");
        expect(row.isWarning).toBe(false);
    });

    it("says the members could not be read, as one row of the group and never as a verdict on the role", () => {
        for (const membership of [members({ status: "error" }), undefined]) {
            const result = rows({ roles: [role()], membership });
            expect(result).toHaveLength(1);
            expect(result[0].state).toBe("not-read");
            expect(result[0].activationText).toBe(TEXT_MEMBERS_UNREAD);
            expect(result[0].membersUnread).toBe(true);
            expect(result[0].isWarning).toBe(false);
            expect(result[0].who).toBe("Helpdesk");
        }
    });

    it("says a group with no members cannot be activated by anybody, and does not warn", () => {
        const [row] = rows({ roles: [role()], membership: members(ready()) });
        expect(row.state).toBe("no-members");
        expect(row.activationText).toBe(TEXT_NO_MEMBERS);
        expect(row.isWarning).toBe(false);
        expect(stateGroupOf(row.state)).toBe("na");
    });

    it("says an app member does not activate, and a group inside the group is not judged", () => {
        const nested: Principal = { id: "g2", displayName: "Inner", "@odata.type": "#microsoft.graph.group" };
        const result = rows({
            roles: [role()],
            membership: members({ status: "ready", members: [{ id: SP.id, displayName: "Automation", kind: "servicePrincipal" }, { id: nested.id, displayName: "Inner", kind: "group" }] }),
        });
        expect(result.find((r) => r.who === "Automation")?.activationText).toBe(TEXT_APP);
        expect(result.find((r) => r.who === "Inner")?.activationText).toBe(TEXT_NESTED_GROUP);
    });

    it("marks an emergency access member by id", () => {
        const [row] = rows({ roles: [role()], membership: members(ready(ANNA)), emergencyIds: new Set(["anna-id"]) });
        expect(row.isEmergency).toBe(true);
    });

    it("finds the groups whose members are to be read", () => {
        const groups = [groupOf([groupAssignment(HELPDESK, "member", 90), groupAssignment(ANNA, "member", 90)])];
        expect(eligibleGroupIds([role(), roleOf([eligible(ANNA, 90)])], groups)).toEqual(["g1"]);
        expect(eligibleGroupIds([roleOf([eligible(ANNA, 90)])], [])).toEqual([]);
    });
});

describe("a group that holds a role actively", () => {
    it("says it is not applicable, held by the group, and not a warning", () => {
        const [row] = rows({ roles: [roleOf([], [activeAssigned(HELPDESK, "permanent")])] });
        expect(row.state).toBe("held-by-group");
        expect(row.activationText).toBe(TEXT_HELD_BY_GROUP);
        expect(row.isWarning).toBe(false);
        expect(stateGroupOf(row.state)).toBe("na");
    });
});

describe("what counts as an activation", () => {
    const roles = [roleOf([eligible(ANNA, 90)])];

    it("does not count a failed activation", () => {
        expect(rows({ roles, events: [usage(3, ANNA, { result: "failure" })] })[0].state).toBe("none");
    });

    it("does not count a request without a completion", () => {
        expect(rows({ roles, events: [usage(3, ANNA, { requestOnly: true })] })[0].state).toBe("none");
    });

    it("does not count an activation outside the period", () => {
        expect(rows({ roles, events: [usage(31, ANNA)] })[0].state).toBe("none");
        expect(rows({ roles, events: [usage(29, ANNA)] })[0].state).toBe("activated");
    });

    it("follows days, never anything else: a shorter period leaves out an older activation", () => {
        expect(rows({ roles, events: [usage(10, ANNA)], days: 7 })[0].state).toBe("none");
        expect(rows({ roles, events: [usage(10, ANNA)], days: 14 })[0].state).toBe("activated");
    });

    it("does not count events of other kinds", () => {
        expect(rows({ roles, events: [usage(3, ANNA, { kind: "assignment" })] })[0].state).toBe("none");
    });

    it("matches ids without case, on the assignment and on the event", () => {
        expect(rows({ roles, events: [usage(3, ANNA, { target: { name: "Anna", id: "anna-id" } })] })[0].state).toBe("activated");
        expect(rows({ roles: [roleOf([eligible(person("anna-id", "Anna"), 90)])], events: [usage(3, ANNA, { target: { name: "Anna", id: "ANNA-ID" } })] })[0].state).toBe("activated");
        expect(rows({ roles: [{ ...roleOf([eligible(ANNA, 90)]), definition: { id: "ROLE-1", displayName: "x", description: "", isBuiltIn: true } }], events: [usage(3, ANNA, { role: { name: "x", id: "role-1" } })] })[0].state).toBe("activated");
    });

    it("takes the person from the actor only when the event has no target and the actor is a person", () => {
        const noTarget = usage(3, ANNA, { target: undefined });
        expect(rows({ roles, events: [noTarget] })[0].state).toBe("activated");
        const systemActor = usage(3, ANNA, { target: undefined, actor: { name: "PIM", id: ANNA.id, kind: "system" } });
        expect(rows({ roles, events: [systemActor] })[0].state).toBe("none");
    });

    it("does not match another person or another role", () => {
        expect(rows({ roles, events: [usage(3, BERT)] })[0].state).toBe("none");
        expect(rows({ roles, events: [usage(3, ANNA, { role: { name: "x", id: "role-2" } })] })[0].state).toBe("none");
    });

    it("also matches the template id of a role", () => {
        const withTemplate = roleOf([eligible(ANNA, 90)], [], { templateId: "template-1" });
        expect(rows({ roles: [withTemplate], events: [usage(3, ANNA, { role: { name: "x", id: "template-1" } })] })[0].state).toBe("activated");
    });

    it("keeps role events and group events apart", () => {
        const groups = [groupOf([groupAssignment(ANNA, "member", 90)])];
        const roleEvent = usage(3, ANNA, { role: { name: "member of Finance", id: GROUP } });
        expect(rows({ groups, events: [roleEvent] })[0].state).toBe("none");
    });
});

describe("assignments that never activate", () => {
    it("never warns for a permanent assignment, whatever the events say", () => {
        const roles = [roleOf([], [activeAssigned(ANNA, "permanent")])];
        for (const events of [[], [usage(3, ANNA)], [usage(3, ANNA, { result: "failure" })]]) {
            const [row] = rows({ roles, events });
            expect(row.typeText).toBe("Permanently active");
            expect(row.activationText).toBe(TEXT_NEVER);
            expect(row.isWarning).toBe(false);
            expect(row.activationText.toLowerCase()).not.toContain("not used");
        }
    });

    it("says Active until with the date for a time-bound assignment", () => {
        const [row] = rows({ roles: [roleOf([], [activeAssigned(ANNA, "until")])] });
        expect(row.typeText).toBe("Active until 1 Dec 2026");
        expect(row.activationText).toBe(TEXT_NEVER);
        expect(row.isWarning).toBe(false);
    });

    it("leaves out an activation of an eligibility: it is the event, not an assignment", () => {
        expect(rows({ roles: [roleOf([], [activeAssigned(ANNA, "until", "Activated")])] })).toEqual([]);
    });

    it("shows standing access that no schedule covers as permanently active", () => {
        const role = roleOf([]);
        role.assignments.permanent.push({ id: "ra", roleDefinitionId: ROLE, principalId: BERT.id, directoryScopeId: "/", principal: BERT, createdDateTime: ago(200) });
        const [row] = rows({ roles: [role] });
        expect(row.typeText).toBe("Permanently active");
        expect(row.isWarning).toBe(false);
    });
});

describe("groups", () => {
    it("keeps member and owner apart", () => {
        const groups = [groupOf([groupAssignment(ANNA, "member", 90), groupAssignment(ANNA, "owner", 90)])];
        const events = [usage(3, ANNA, { environment: "group", role: { name: "owner of Finance", id: GROUP } })];
        const result = rows({ groups, events });
        const member = result.find((r) => r.resourceName === "Member of Finance");
        const owner = result.find((r) => r.resourceName === "Owner of Finance");
        expect(member?.state).toBe("none");
        expect(owner?.state).toBe("activated");
    });

    it("counts an activation without a member or owner label for both, so the log's silence never reads as unused", () => {
        const groups = [groupOf([groupAssignment(ANNA, "member", 90), groupAssignment(ANNA, "owner", 90)])];
        const events = [usage(3, ANNA, { environment: "group", role: { name: "Finance", id: GROUP } })];
        expect(rows({ groups, events }).map((r) => r.state)).toEqual(["activated", "activated"]);
    });

    it("matches the group id without case", () => {
        const groups = [groupOf([groupAssignment(ANNA, "member", 90)])];
        const events = [usage(3, ANNA, { environment: "group", role: { name: "member of Finance", id: GROUP.toUpperCase() } })];
        expect(rows({ groups, events })[0].state).toBe("activated");
    });

    it("names the row Member of or Owner of the group", () => {
        const names = rows({ groups: [groupOf([groupAssignment(ANNA, "member", 90), groupAssignment(BERT, "owner", 90)])] }).map((r) => r.resourceName).sort();
        expect(names).toEqual(["Member of Finance", "Owner of Finance"]);
    });

    it("skips an instance made by an activation and shows an assigned one as not applicable", () => {
        const groups = [groupOf([
            groupAssignment(ANNA, "member", 5, { assignmentType: "active", assignmentOrigin: "activated" }),
            groupAssignment(BERT, "member", 50, { assignmentType: "permanent" }),
        ])];
        const result = rows({ groups });
        expect(result).toHaveLength(1);
        expect(result[0].activationText).toBe(TEXT_NEVER);
    });

    it("gives a group that is eligible for the access one row per member, judged on the group access", () => {
        const groups = [groupOf([groupAssignment(HELPDESK, "member", 90)])];
        const events = [usage(3, BERT, { environment: "group", role: { name: "member of Finance", id: GROUP } })];
        const result = rows({ groups, events, membership: members(ready(ANNA, BERT)) });
        expect(result.map((r) => [r.who, r.state, r.viaGroup])).toEqual([["Anna Test", "none", "Helpdesk"], ["Bert Test", "activated", "Helpdesk"]]);
    });

    it("says a group that holds the group access actively is held by the group", () => {
        const [row] = rows({ groups: [groupOf([groupAssignment(HELPDESK, "member", 90, { assignmentType: "permanent" })])] });
        expect(row.state).toBe("held-by-group");
    });

    it("says an app with permanent group access does not activate, and an eligible app is not read", () => {
        const [permanent] = rows({ groups: [groupOf([groupAssignment(SP, "member", 90, { assignmentType: "permanent" })])] });
        expect(permanent.activationText).toBe(TEXT_APP);
        const [eligibleApp] = rows({ groups: [groupOf([groupAssignment(SP, "member", 90)])] });
        expect(eligibleApp.activationText).toBe(TEXT_APP_ELIGIBLE);
    });

    it("names Directory as the scope of a group row", () => {
        expect(rows({ groups: [groupOf([groupAssignment(ANNA, "member", 90)])] })[0].scopeName).toBe("Directory");
    });
});

describe("emergency access, order, filters and counts", () => {
    it("marks an emergency access account by id, without case", () => {
        const [row] = rows({ roles: [roleOf([eligible(ANNA, 90)])], emergencyIds: new Set(["anna-id"]) });
        expect(row.isEmergency).toBe(true);
    });

    it("orders warnings, assigned in the period, activated oldest first, then not applicable; then by name", () => {
        const carl = person("carl", "Carl");
        const dora = person("dora", "Dora");
        const result = rows({
            roles: [roleOf([eligible(ANNA, 90), eligible(BERT, 90), eligible(carl, 2), eligible(dora, 90)], [activeAssigned(person("fay", "Fay"), "permanent")])],
            events: [usage(2, BERT), usage(9, dora)],
        });
        expect(result.map((r) => r.who)).toEqual(["Anna Test", "Carl", "Dora", "Bert Test", "Fay"]);
    });

    it("filters by environment and searches role, group and person", () => {
        const all = rows({ roles: [roleOf([eligible(ANNA, 90)])], groups: [groupOf([groupAssignment(BERT, "member", 90)])] });
        expect(filterNoActivationRows(all, "role", "")).toHaveLength(1);
        expect(filterNoActivationRows(all, "group", "")).toHaveLength(1);
        expect(filterNoActivationRows(all, "both", "anna")).toHaveLength(1);
        expect(filterNoActivationRows(all, "both", "finance")).toHaveLength(1);
        expect(filterNoActivationRows(all, "both", "security")).toHaveLength(1);
        expect(filterNoActivationRows(all, "both", "nobody")).toHaveLength(0);
    });

    it("searches the group a member is eligible through", () => {
        const all = rows({ roles: [roleOf([eligible(HELPDESK, 80)])], membership: members(ready(ANNA)) });
        expect(filterNoActivationRows(all, "both", "helpdesk")).toHaveLength(1);
    });

    it("counts every row in one of five parts that add up to the total", () => {
        const all = fixtureRows();
        const counts = countNoActivation(all);
        expect(counts.total).toBe(all.length);
        expect(counts.none + counts.new + counts.activated + counts.na + counts.notRead).toBe(counts.total);
        // Every part is present in the fixture, so the check is not a sum of zeros
        for (const part of [counts.none, counts.new, counts.activated, counts.na, counts.notRead]) expect(part).toBeGreaterThan(0);
    });

    it("keeps the parts adding up to the rows with every filter", () => {
        const all = fixtureRows();
        for (const env of ["both", "role", "group"] as const) {
            for (const query of ["", "helpdesk", "administrator", "nestor", "emergency", "nobody-here"]) {
                const shown = filterNoActivationRows(all, env, query);
                const counts = countNoActivation(shown);
                expect(counts.total, `${env} ${query}`).toBe(shown.length);
                expect(counts.none + counts.new + counts.activated + counts.na + counts.notRead, `${env} ${query}`).toBe(shown.length);
            }
        }
    });

    it("writes the sentence literally, leaves out a part that is zero except no activation, and names every row", () => {
        const tail = "This shows a role was not activated in the period, not that it can go: a role used once a quarter needs a longer period.";
        expect(noActivationHonesty({ total: 1, none: 0, new: 0, activated: 0, na: 1, notRead: 0 })).toContain("1 assignment: 0 with no activation, 1 that does not activate.");
        expect(noActivationHonesty({ total: 12, none: 2, new: 3, activated: 4, na: 2, notRead: 1 })).toBe(`12 assignments: 2 with no activation, 3 assigned during the period, 4 activated, 2 that do not activate, 1 not judged. ${tail}`);
        expect(noActivationHonesty({ total: 5, none: 0, new: 0, activated: 5, na: 0, notRead: 0 })).toBe(`5 assignments: 0 with no activation, 5 activated. ${tail}`);
        expect(noActivationHonesty({ total: 0, none: 0, new: 0, activated: 0, na: 0, notRead: 0 })).toBe(`0 assignments: 0 with no activation. ${tail}`);
    });

    it("never writes the texts of the first version", () => {
        const text = JSON.stringify(fixtureRows());
        expect(text).not.toContain("Through a group: activation is on the group");
        expect(text).not.toContain("Not judged as unused");
    });

    it("gives the State words of the exports for each part", () => {
        expect(STATE_GROUP_WORDS).toEqual({ none: "no activation", new: "assigned during the period", activated: "activated", na: "does not activate", notRead: "not judged" });
        for (const row of fixtureRows()) expect(STATE_GROUP_WORDS[stateGroupOf(row.state)]).toBeTruthy();
    });
});

describe("what limits the table", () => {
    const from = new Date("2026-10-06T12:00:00Z");

    it("names PIM for Groups, the groups whose members were not read, and a source that reaches less than the period, each once", () => {
        const unread = rows({ roles: [roleOf([eligible(HELPDESK, 80)])], membership: members({ status: "error" }) });
        const lines = noActivationLimits({ groupsReason: "read access to PIM for Groups has not been granted", rows: unread, sourceFrom: new Date("2026-10-20T00:00:00Z"), periodFrom: from, format: FORMAT });
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe("PIM for Groups is not included: read access to PIM for Groups has not been granted.");
        expect(lines[1]).toContain("Helpdesk");
        expect(lines[1]).toContain("not judged");
        expect(lines[2]).toContain("20 Oct 2026");
    });

    it("has no line when nothing limits the table", () => {
        expect(noActivationLimits({ groupsReason: null, rows: rows({ roles: [roleOf([eligible(ANNA, 90)])] }), sourceFrom: from, periodFrom: from })).toEqual([]);
        expect(noActivationLimits({ groupsReason: null, rows: [], sourceFrom: new Date("2026-09-01T00:00:00Z"), periodFrom: from })).toEqual([]);
    });
});

describe("no duplicates", () => {
    it("keeps one row when a member appears both as memberType Group and through the expanded group", () => {
        const found = rows({ roles: [roleOf([eligible(HELPDESK, 90), eligible(ANNA, 90, "Group")])], membership: members(ready(ANNA)) } as never);
        expect(found.filter((row) => row.whoId === ANNA.id)).toHaveLength(1);
        expect(found[0].viaGroup).toBeDefined();
    });

    it("keeps both rows when a person holds a role directly and through a group", () => {
        const found = rows({ roles: [roleOf([eligible(HELPDESK, 90), eligible(ANNA, 90)])], membership: members(ready(ANNA)) } as never);
        expect(found.filter((row) => row.whoId === ANNA.id)).toHaveLength(2);
    });

    it("says one assignment, not one assignments", () => {
        expect(noActivationHonesty(countNoActivation(rows({ roles: [roleOf([eligible(ANNA, 90)])] })))).toMatch(/^1 assignment:/);
    });
});

function fixtureRows(): NoActivationRow[] {
    return buildNoActivationRows({ roles: buildIdleRoles(), groups: buildIdleGroups(), events: buildIdleEvents(), days: 30, now: IDLE_NOW, emergencyIds: IDLE_EMERGENCY_IDS, format: FORMAT, membership: buildIdleMembership() });
}
