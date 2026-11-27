import type { AuditEvent } from "@/types/audit.types";
import type { PimAssignmentSchedule, PimEligibilitySchedule, Principal, RoleDetailData } from "@/types/directoryRole.types";
import type { GroupPimAssignment, PimGroupData } from "@/types/pimGroup.types";
import { GROUPS_NOT_GRANTED_REASON, type GroupMembersLookup } from "@/utils/auditNoActivation";

/**
 * Invented data for the No activation fixture (`/dev/audit?view=idle`): assignments and audit events that cover every
 * line of the Activation table. Names and ids are made up. The clock is `IDLE_NOW`; the period is 30 days.
 */
export const IDLE_NOW = new Date("2026-11-05T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number): string => new Date(IDLE_NOW.getTime() - days * DAY).toISOString();

const USER = "#microsoft.graph.user";
const user = (id: string, displayName: string): Principal => ({ id, displayName, "@odata.type": USER });
const P = {
    isaiah: user("11111111-0000-4000-8000-000000000001", "Isaiah Langer"),
    lynne: user("11111111-0000-4000-8000-000000000002", "Lynne Robbins"),
    lidia: user("11111111-0000-4000-8000-000000000003", "Lidia Holloway"),
    megan: user("11111111-0000-4000-8000-000000000004", "Megan Bowen"),
    patti: user("11111111-0000-4000-8000-000000000005", "Patti Fernandez"),
    johanna: user("11111111-0000-4000-8000-000000000006", "Johanna Lorenz"),
    alex: user("11111111-0000-4000-8000-000000000007", "Alex Wilber"),
    allan: user("11111111-0000-4000-8000-000000000008", "Allan Deyoung"),
    adele: user("11111111-0000-4000-8000-000000000009", "Adele Vance"),
    grady: user("11111111-0000-4000-8000-00000000000a", "Grady Archie"),
    nestor: user("11111111-0000-4000-8000-00000000000b", "Nestor Wilke"),
    diego: user("11111111-0000-4000-8000-00000000000c", "Diego Siciliani"),
    breakGlass: user("11111111-0000-4000-8000-00000000000d", "Break Glass 01"),
    helpdeskGroup: { id: "22222222-0000-4000-8000-000000000001", displayName: "Contoso-Helpdesk", "@odata.type": "#microsoft.graph.group" } as Principal,
    emptyGroup: { id: "22222222-0000-4000-8000-000000000002", displayName: "Contoso-Interns", "@odata.type": "#microsoft.graph.group" } as Principal,
    unreadGroup: { id: "22222222-0000-4000-8000-000000000003", displayName: "Contoso-Mail-Ops", "@odata.type": "#microsoft.graph.group" } as Principal,
    automation: { id: "33333333-0000-4000-8000-000000000001", displayName: "Contoso Automation", "@odata.type": "#microsoft.graph.servicePrincipal" } as Principal,
    opsAgent: { id: "33333333-0000-4000-8000-000000000002", displayName: "Contoso Ops Agent", "@odata.type": "#microsoft.graph.agentIdentity" } as Principal,
};

export const IDLE_EMERGENCY_IDS: ReadonlySet<string> = new Set([P.breakGlass.id.toLowerCase()]);

const ROLE_IDS = {
    global: "aaaaaaaa-0000-4000-8000-000000000001",
    exchange: "aaaaaaaa-0000-4000-8000-000000000002",
    security: "aaaaaaaa-0000-4000-8000-000000000003",
    privileged: "aaaaaaaa-0000-4000-8000-000000000004",
    helpdesk: "aaaaaaaa-0000-4000-8000-000000000005",
    reports: "aaaaaaaa-0000-4000-8000-000000000006",
    teams: "aaaaaaaa-0000-4000-8000-000000000007",
};
const GROUP_ID = "bbbbbbbb-0000-4000-8000-000000000001";

let counter = 0;
const next = () => `idle-${++counter}`;

/** A negative `startDaysAgo` is a start still ahead; null is an eligibility with no start in the data */
function eligible(principal: Principal, roleId: string, startDaysAgo: number | null, scope: { id: string; name: string } | null = null): PimEligibilitySchedule {
    return {
        id: next(),
        principalId: principal.id,
        roleDefinitionId: roleId,
        directoryScopeId: scope?.id ?? "/",
        memberType: "Direct",
        status: "Provisioned",
        principal,
        scopeInfo: scope ? { type: "administrative-unit", displayName: scope.name, id: scope.id } : undefined,
        scheduleInfo: startDaysAgo === null ? undefined : { startDateTime: ago(startDaysAgo), expiration: { type: "noExpiration" } },
    };
}

const SALES_UNIT = { id: "/administrativeUnits/dddddddd-0000-4000-8000-000000000001", name: "Contoso Sales" };

function active(principal: Principal, roleId: string, kind: "permanent" | "until" | "activated"): PimAssignmentSchedule {
    return {
        id: next(),
        principalId: principal.id,
        roleDefinitionId: roleId,
        directoryScopeId: "/",
        memberType: "Direct",
        status: "Provisioned",
        assignmentType: kind === "activated" ? "Activated" : "Assigned",
        principal,
        scheduleInfo: kind === "permanent"
            ? { startDateTime: ago(200), expiration: { type: "noExpiration" } }
            : { startDateTime: ago(kind === "activated" ? 0.1 : 20), expiration: { type: "afterDateTime", endDateTime: new Date(IDLE_NOW.getTime() + 12 * DAY).toISOString() } },
    };
}

/** Not every role is privileged, and for one Graph gives no flag: Privileged only keeps that one and says so */
const NOT_PRIVILEGED: ReadonlySet<string> = new Set(["Reports Reader"]);
const NOT_JUDGED: ReadonlySet<string> = new Set(["Teams Administrator"]);

function role(id: string, displayName: string, eligibleList: PimEligibilitySchedule[], activeList: PimAssignmentSchedule[] = []): RoleDetailData {
    return {
        definition: { id, displayName, description: "", isBuiltIn: true, isPrivileged: NOT_JUDGED.has(displayName) ? undefined : !NOT_PRIVILEGED.has(displayName) },
        assignments: { permanent: [], eligible: eligibleList, active: activeList },
    };
}

export function buildIdleRoles(): RoleDetailData[] {
    counter = 0;
    return [
        role(ROLE_IDS.global, "Global Administrator", [eligible(P.isaiah, ROLE_IDS.global, 90)], [active(P.breakGlass, ROLE_IDS.global, "permanent")]),
        role(ROLE_IDS.exchange, "Exchange Administrator", [
            eligible(P.lynne, ROLE_IDS.exchange, 75),
            // Members cannot be read in this fixture: one row for the group, not judged
            eligible(P.unreadGroup, ROLE_IDS.exchange, 60),
        ], [active(P.helpdeskGroup, ROLE_IDS.exchange, "permanent")]),
        // The id of Megan is written in capitals here and in lower case in the log
        role(ROLE_IDS.security, "Security Administrator", [eligible({ ...P.megan, id: P.megan.id.toUpperCase() }, ROLE_IDS.security, 120), eligible(P.johanna, ROLE_IDS.security, 60)]),
        role(ROLE_IDS.privileged, "Privileged Role Administrator", [eligible(P.patti, ROLE_IDS.privileged, 100), eligible(P.alex, ROLE_IDS.privileged, 45)], [active(P.allan, ROLE_IDS.privileged, "until"), active(P.alex, ROLE_IDS.privileged, "activated")]),
        role(ROLE_IDS.helpdesk, "Helpdesk Administrator", [
            eligible(P.adele, ROLE_IDS.helpdesk, 3),
            // Eligible for the group: each member is judged (see `buildIdleMembership`)
            eligible(P.helpdeskGroup, ROLE_IDS.helpdesk, 80),
        ], [active(P.automation, ROLE_IDS.helpdesk, "permanent"), active(P.opsAgent, ROLE_IDS.helpdesk, "permanent")]),
        role(ROLE_IDS.reports, "Reports Reader", [
            // The same person on two scopes: the activation of the log is on the administrative unit only
            eligible(P.nestor, ROLE_IDS.reports, 150),
            eligible(P.nestor, ROLE_IDS.reports, 150, SALES_UNIT),
            eligible(P.emptyGroup, ROLE_IDS.reports, 20),
        ]),
        role(ROLE_IDS.teams, "Teams Administrator", [
            // Assigned exactly at the start of the 30 days: it had the whole period
            eligible(P.diego, ROLE_IDS.teams, 30),
            // No start in the data, and a start still ahead: neither is a verdict
            eligible(P.johanna, ROLE_IDS.teams, null),
            eligible(P.alex, ROLE_IDS.teams, -5),
        ]),
    ];
}

function groupAssignment(principal: Principal, access: "member" | "owner", startDaysAgo: number): GroupPimAssignment {
    return {
        id: next(),
        groupId: GROUP_ID,
        principalId: principal.id,
        principal,
        accessType: access,
        assignmentType: "eligible",
        memberType: "Direct",
        startDateTime: ago(startDaysAgo),
    };
}

export function buildIdleGroups(): PimGroupData[] {
    return [{
        group: { id: GROUP_ID, displayName: "Contoso-Finance-Admins", groupType: "security", isAssignableToRole: true },
        assignments: [
            groupAssignment(P.lidia, "member", 40),
            // Activated as owner only: the member row of the same person stays a warning
            groupAssignment(P.lidia, "owner", 40),
            groupAssignment(P.megan, "member", 2),
        ],
    }];
}

function usage(id: string, daysAgo: number, person: Principal, roleId: string, roleName: string, extra: Partial<AuditEvent> = {}, environment: "role" | "group" = "role"): AuditEvent {
    return {
        id,
        time: ago(daysAgo),
        kind: "usage",
        environment,
        sentence: `${person.displayName} activated ${roleName}`,
        actor: { name: person.displayName ?? "", id: person.id, kind: "person" },
        target: { name: person.displayName ?? "", id: person.id.toLowerCase() },
        role: { name: roleName, id: roleId },
        scope: "Directory",
        result: "success",
        source: "graph",
        correlationId: `corr-${id}`,
        ...extra,
    };
}

export function buildIdleEvents(): AuditEvent[] {
    return [
        usage("e1", 1, P.megan, ROLE_IDS.security, "Security Administrator"),
        usage("e2", 10, P.patti, ROLE_IDS.privileged, "Privileged Role Administrator"),
        // A failed activation and a request without a completion do not count
        usage("e3", 4, P.johanna, ROLE_IDS.security, "Security Administrator", { result: "failure", denied: true, approver: "Megan Bowen", sentence: "Activation of Security Administrator by Johanna Lorenz denied" }),
        usage("e4", 6, P.alex, ROLE_IDS.privileged, "Privileged Role Administrator", { requestOnly: true, sentence: "Alex Wilber requested activation of Privileged Role Administrator" }),
        // Outside the period
        usage("e5", 45, P.nestor, ROLE_IDS.reports, "Reports Reader"),
        // On the administrative unit only: it counts for that scope and not for the tenant-wide one
        usage("e8", 7, P.nestor, ROLE_IDS.reports, "Reports Reader", { directoryScopeId: SALES_UNIT.id, scope: SALES_UNIT.name }),
        // Member of the group that is eligible for Helpdesk Administrator: counts for that person only
        usage("e9", 5, P.grady, ROLE_IDS.helpdesk, "Helpdesk Administrator"),
        usage("e6", 5, P.lidia, GROUP_ID, "owner of Contoso-Finance-Admins", {}, "group"),
        // Someone else, not an assignment of this table
        usage("e7", 2, P.breakGlass, ROLE_IDS.global, "Global Administrator"),
    ];
}

/**
 * The members of the groups the roles are eligible for: Helpdesk has two people, Interns has nobody, and the members of
 * Mail-Ops could not be read.
 */
export function buildIdleMembership(): Map<string, GroupMembersLookup> {
    return new Map<string, GroupMembersLookup>([
        [P.helpdeskGroup.id.toLowerCase(), { status: "ready", members: [
            { id: P.grady.id, displayName: P.grady.displayName ?? "", kind: "user" },
            { id: P.lidia.id, displayName: P.lidia.displayName ?? "", kind: "user" },
        ] }],
        [P.emptyGroup.id.toLowerCase(), { status: "ready", members: [] }],
        [P.unreadGroup.id.toLowerCase(), { status: "error" }],
    ]);
}

export function groupsMissingReason(): string {
    return GROUPS_NOT_GRANTED_REASON;
}
