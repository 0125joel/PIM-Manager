import type { RawAuditDetail, RawAuditTarget, RawDirectoryAudit } from "@/types/audit.types";
import { CONTOSO_TENANT_ID, demoGuid } from "./ids";

/**
 * The demo's Entra audit log: raw directoryAudits rows in the measured shape (the AU-1 brief), on dates relative to `now`,
 * with Contoso people and roles. The fake Graph serves them, and the app's real mapper turns them into events.
 * Ids are spelled out here, not imported from tenant.ts: this file is read by the boot of every page (see history.ts).
 * `src/__tests__/demo/fakeGraph.test.ts` checks the role ids equal the tenant's.
 */

/** Role template ids of the demo tenant, equal to ROLE in tenant.ts */
export const AUDIT_DEMO_ROLES = {
    globalAdmin: "62e90394-69f5-4237-9190-012177145e10",
    privilegedRoleAdmin: "e8611ab8-c189-46e8-94e1-60213ab1f814",
    securityAdmin: "194ae4cb-b126-40b2-bd5b-6091b380977d",
    exchangeAdmin: "29232cdf-9323-42fd-ade2-1d097af3e4de",
    helpdeskAdmin: "729827e3-9c14-49f7-bb1b-9608f156bbb8",
    intuneAdmin: "3a2c62db-5318-420d-8d74-23affee5d9d5",
    teamsAdmin: "69091246-20e8-4a56-aa4d-066075b2a7a8",
    reportsReader: "4a5d8f65-41da-4de4-8968-e035b65339cf",
} as const;

/** The group of the demo tenant, equal to GROUPS.legacyIntune in tenant.ts (`demoGuid("group:legacyintune")`) */
export const AUDIT_DEMO_GROUP_ID = demoGuid("group:legacyintune");

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Person {
    id: string;
    name: string;
    upn: string;
}

/** The ids of tenant.ts's members: `demoGuid("user:{alias}")` */
function person(alias: string, name: string, domain = "contoso.com"): Person {
    return { id: demoGuid(`user:${alias}`), name, upn: `${alias}@${domain}` };
}

/** A guest of the demo tenant, as in tenant.ts: its user principal name holds `#EXT#` */
const KIM: Person = { id: demoGuid("guest:kim.akers"), name: "Kim Akers (Fabrikam)", upn: "kim.akers_fabrikam.com#EXT#@contoso.onmicrosoft.com" };

const PEOPLE = {
    alex: person("AlexW", "Alex Wilber"),
    adele: person("AdeleV", "Adele Vance"),
    allan: person("AllanD", "Allan Deyoung"),
    grady: person("GradyA", "Grady Archie"),
    megan: person("MeganB", "Megan Bowen"),
    johanna: person("JohannaL", "Johanna Lorenz"),
    breakGlass: person("bg01", "Break Glass 01", "contoso.onmicrosoft.com"),
};

/** One row of the demo, before it becomes a raw Graph row. `id` is unique and derives every id of the row. */
interface Ev {
    id: string;
    at: number;
    /** `AuditType`; left out on Core Directory rows, which carry none (measured) */
    type?: string;
    activity: string;
    category?: "RoleManagement" | "GroupManagement" | "ResourceManagement";
    service?: "PIM" | "Core Directory";
    /** The person who initiated it; without one, `app` (default `Azure AD PIM`) initiated it */
    by?: Person;
    app?: string;
    targets: RawAuditTarget[];
    /** The key of the correlation id; defaults to `id`. An expiry shares its activation's (measured). */
    corr?: string;
    /** The key of the RequestId */
    req?: string;
    /** The key of the RoleAssignmentRequestId this row carries */
    ra?: string;
    details?: Record<string, string>;
    /** resultReason of a failed row */
    failure?: string;
    /** resultReason of a successful row (measured: it repeats the justification) */
    reason?: string;
}

/** The group of the demo tenant that holds active Azure roles, equal to GROUPS.platform in tenant.ts (`demoGuid("group:platform")`) */
const PLATFORM_GROUP = { id: demoGuid("group:platform"), name: "Platform Engineers" };

/** The Azure requests the Azure Audit page's approval rows decide: equal to AZURE_AUDIT_REQUESTS in azureAudit.ts (same seeds) */
const AZURE_APPROVED_REQUEST = demoGuid("azure:audit:request:approved");
const AZURE_DENIED_REQUEST = demoGuid("azure:audit:request:denied");

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

function toRow(e: Ev): RawDirectoryAudit {
    const details: RawAuditDetail[] = [];
    const add = (key: string, value: string) => details.push({ key, value });
    if (e.type) add("AuditType", e.type);
    if (e.req) add("RequestId", demoGuid(`request:${e.req}`));
    if (e.ra) add("RoleAssignmentRequestId", demoGuid(`assignment:${e.ra}`));
    for (const [key, value] of Object.entries(e.details ?? {})) add(key, value);
    if (e.by) {
        add("UserAgent", "Demo browser");
        // The mapper drops these; they are in the raw rows as they are in a tenant
        if ((e.service ?? "PIM") === "PIM") add("ipaddr", "203.0.113.24");
    }
    return {
        id: demoGuid(`audit-row:${e.id}`),
        category: e.category ?? "RoleManagement",
        correlationId: demoGuid(`correlation:${e.corr ?? e.id}`),
        result: e.failure ? "failure" : "success",
        resultReason: e.failure ?? e.reason ?? null,
        activityDisplayName: e.activity,
        activityDateTime: iso(e.at),
        loggedByService: e.service ?? "PIM",
        initiatedBy: e.by
            ? { user: { id: e.by.id, displayName: e.by.name }, app: null }
            : { user: null, app: { displayName: e.app ?? "Azure AD PIM" } },
        targetResources: e.targets,
        additionalDetails: details,
    };
}

// Targets ----------------------------------------------------------------------------------------------------------------

const DIRECTORY: RawAuditTarget = { type: "Directory", id: CONTOSO_TENANT_ID, displayName: "Contoso", modifiedProperties: [] };
const roleTarget = (name: string, id: string): RawAuditTarget => ({ type: "Role", id, displayName: name, modifiedProperties: [] });
const userTarget = (p: Person): RawAuditTarget => ({ type: "User", id: p.id, displayName: p.name, userPrincipalName: p.upn, modifiedProperties: [] });
const requestTarget = (key: string): RawAuditTarget => ({ type: "Request", id: demoGuid(`request:${key}`), modifiedProperties: [] });
const policyTarget = (key: string): RawAuditTarget => ({ type: "Policy", id: demoGuid(`policy:${key}`), displayName: "Policy", modifiedProperties: [] });
/** A Core Directory target: a UPN and no display name, the role name in modifiedProperties (measured) */
const coreUserTarget = (p: Person, roleName: string, roleId: string, side: "added" | "removed"): RawAuditTarget => {
    const quoted = (value: string) => ({ oldValue: side === "removed" ? `"${value}"` : null, newValue: side === "added" ? `"${value}"` : null });
    return {
        type: "User",
        id: p.id,
        userPrincipalName: p.upn,
        modifiedProperties: [{ displayName: "Role.DisplayName", ...quoted(roleName) }, { displayName: "Role.TemplateId", ...quoted(roleId) }],
    };
};
/** A service principal target, as a service principal, an agent identity and a blueprint all are in the log (measured) */
const appTarget = (id: string, name: string): RawAuditTarget => ({ type: "ServicePrincipal", id, displayName: name, modifiedProperties: [] });
const groupTarget = (id: string, name: string): RawAuditTarget => ({ type: "Group", id, displayName: name, modifiedProperties: [] });
/** A group's Role target names the membership kind; the Other target holds the group (measured) */
const groupTargets = (kind: "Member" | "Owner", groupName: string, groupId: string): RawAuditTarget[] => [
    { type: "Role", displayName: kind, modifiedProperties: [] },
    { type: "Other", id: groupId, displayName: groupName, modifiedProperties: [] },
];

// Actions ----------------------------------------------------------------------------------------------------------------

/** An activation: the request and the completed activation, linked by the assignment id `key` */
function activation(key: string, at: number, who: Person, roleName: string, roleId: string, minutes: number, mfa: boolean): Ev[] {
    const details = {
        StartTime: iso(at),
        ExpirationTime: iso(at + minutes * MINUTE),
        Justification: "Demo task",
        IsActivationRequireApproval: "false",
    };
    const targets = [roleTarget(roleName, roleId), DIRECTORY, userTarget(who), requestTarget(key)];
    return [
        { id: `${key}-request`, corr: key, req: key, at, type: "CreateRequestRoleActivation", activity: "Add member to role requested (PIM activation)", by: who, targets, details, reason: "Demo task" },
        { id: `${key}-done`, corr: key, req: key, ra: key, at: at + 2 * MINUTE, type: "ActivateRole", activity: "Add member to role completed (PIM activation)", by: who, targets, details: { ...details, IsAuthenticatedWithMfa: mfa ? "True" : "False" }, reason: "Demo task" },
    ];
}

/**
 * An activation that needs approval, as measured: the request and the approval request under one correlation id; the
 * decision (initiated by the approver, with the approver's own text) under another, with the completion when approved.
 * Only `RoleAssignmentRequestId` joins them. The ticket is on the request and the completion, not on the decision.
 */
function approvalFlow(key: string, at: number, who: Person, roleName: string, roleId: string, decision: { by: Person; approved: boolean } | null, ticket: string): Ev[] {
    const details = { StartTime: iso(at), ExpirationTime: iso(at + HOUR), Justification: "Demo task", TicketNumber: ticket, TicketSystem: "ServiceNow" };
    const targets = [roleTarget(roleName, roleId), DIRECTORY, userTarget(who), requestTarget(key)];
    const rows: Ev[] = [
        { id: `${key}-request`, corr: key, req: key, ra: key, at, type: "CreateRequestRoleActivation", activity: "Add member to role requested (PIM activation)", by: who, targets, details },
        { id: `${key}-approval`, corr: key, req: key, ra: key, at: at + MINUTE, type: "RequestApprovalRoleActivation", activity: "Add member to role approval requested (PIM activation)", by: who, targets, details },
    ];
    if (!decision) return rows;
    const corr = `${key}-decision`;
    const text = { Justification: decision.approved ? "Checked with the requester" : "No change window today" };
    if (!decision.approved) {
        return [...rows, { id: `${key}-denied`, corr, req: corr, ra: key, at: at + 20 * MINUTE, type: "RejectRoleActivation", activity: "Add member to role request denied (PIM activation)", by: decision.by, targets, details: text }];
    }
    return [
        ...rows,
        { id: `${key}-approved`, corr, req: corr, ra: key, at: at + 20 * MINUTE, type: "ApproveRoleActivation", activity: "Add member to role request approved (PIM activation)", by: decision.by, targets, details: text },
        { id: `${key}-done`, corr, req: corr, ra: key, at: at + 21 * MINUTE, type: "ActivateRole", activity: "Add member to role completed (PIM activation)", by: who, targets, details: { ...details, IsAuthenticatedWithMfa: "True", IsActivationRequireApproval: "true" } },
    ];
}

/** The end of an activation by its deactivation: the completed row carries the activation's assignment id (measured) */
function deactivation(key: string, at: number, who: Person, roleName: string, roleId: string, ofAction: string): Ev[] {
    const targets = [roleTarget(roleName, roleId), DIRECTORY, userTarget(who), requestTarget(key)];
    return [
        { id: `${key}-request`, corr: key, req: key, at, type: "CreateRequestRoleDeactivation", activity: "Remove member from role requested (PIM deactivate)", by: who, targets },
        { id: `${key}-done`, corr: key, req: key, ra: ofAction, at: at + MINUTE, type: "DeactivateRole", activity: "Remove member from role completed (PIM deactivate)", by: who, targets },
    ];
}

/** The expiry of an activation, initiated by the app, with the activation's correlation id (measured) */
function expiry(id: string, at: number, who: Person, roleName: string, roleId: string, ofAction: string): Ev {
    return { id, corr: ofAction, at, type: "RemoveActivatedRole", activity: "Remove member from role (PIM activation expired)", app: "Azure AD PIM", targets: [roleTarget(roleName, roleId), DIRECTORY, userTarget(who)], ra: ofAction };
}

/** The group version of an activation: a Role target `Member` and the group as Other */
function groupActivation(key: string, at: number, who: Person, minutes: number, group: { id: string; name: string } = { id: AUDIT_DEMO_GROUP_ID, name: "Legacy Intune Admins" }): Ev[] {
    const targets = [...groupTargets("Member", group.name, group.id), DIRECTORY, userTarget(who), requestTarget(key)];
    const details = { StartTime: iso(at), ExpirationTime: iso(at + minutes * MINUTE), Justification: "Demo task" };
    return [
        { id: `${key}-request`, corr: key, req: key, at, type: "CreateRequestRoleActivation", category: "GroupManagement", activity: "Add member to group requested (PIM activation)", by: who, targets, details, reason: "Demo task" },
        { id: `${key}-done`, corr: key, req: key, ra: key, at: at + 2 * MINUTE, type: "ActivateRole", category: "GroupManagement", activity: "Add member to group completed (PIM activation)", by: who, targets, details },
        { id: `${key}-off-request`, corr: `${key}-off`, req: `${key}-off`, at: at + 50 * MINUTE, type: "CreateRequestRoleDeactivation", category: "GroupManagement", activity: "Remove member from group requested (PIM deactivate)", by: who, targets },
        { id: `${key}-off-done`, corr: `${key}-off`, req: `${key}-off`, ra: key, at: at + 51 * MINUTE, type: "DeactivateRole", category: "GroupManagement", activity: "Remove member from group completed (PIM deactivate)", by: who, targets },
    ];
}

/** A setting of a role, changed by a person: an UpdatePolicy row with no user target (measured) */
function setting(key: string, at: number, who: Person, roleName: string, roleId: string, newValue: string): Ev {
    return {
        id: key,
        at,
        type: "UpdatePolicy",
        activity: "Update role setting in PIM",
        by: who,
        targets: [roleTarget(roleName, roleId), DIRECTORY, policyTarget(key)],
        details: { Justification: newValue },
    };
}

/**
 * The whole demo log. Times are relative to the UTC day of `now`, so a read of the last 30 days shows about forty actions
 * across every kind: role and group activations (with a deactivation, an expiry, a failure and a request without an end),
 * app-run assignments, settings (one by an emergency access account), direct changes outside PIM with their alert, and
 * the rows the mapper drops or keeps as System (MS-PIM, ResourceManagement, failed daily expiry, unknown types).
 */
export function buildDemoAuditRows(now: Date): RawDirectoryAudit[] {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const t = (daysAgo: number, hour: number, minute = 0) => midnight - daysAgo * DAY + hour * HOUR + minute * MINUTE;
    const role = (name: keyof typeof AUDIT_DEMO_ROLES, label: string) => ({ name: label, id: AUDIT_DEMO_ROLES[name] });
    const ROLE = {
        global: role("globalAdmin", "Global Administrator"),
        privileged: role("privilegedRoleAdmin", "Privileged Role Administrator"),
        security: role("securityAdmin", "Security Administrator"),
        exchange: role("exchangeAdmin", "Exchange Administrator"),
        helpdesk: role("helpdeskAdmin", "Helpdesk Administrator"),
        intune: role("intuneAdmin", "Intune Administrator"),
        teams: role("teamsAdmin", "Teams Administrator"),
        reports: role("reportsReader", "Reports Reader"),
    };
    const on = (name: keyof typeof ROLE) => [ROLE[name].name, ROLE[name].id] as const;
    const rows: Ev[] = [];
    const push = (...events: Ev[]) => rows.push(...events);

    // Activations, role and group
    push(...activation("act1", t(1, 8, 10), PEOPLE.alex, ...on("security"), 60, true));
    push(...activation("act2", t(2, 8, 30), PEOPLE.adele, ...on("exchange"), 120, true));
    push(...deactivation("deact2", t(2, 10, 0), PEOPLE.adele, ...on("exchange"), "act2"));
    push(...activation("act3", t(3, 6, 0), PEOPLE.allan, ...on("global"), 60, true));
    push(expiry("act3-expired", t(3, 7, 0), PEOPLE.allan, ...on("global"), "act3"));
    // Approval: denied, still waiting, and approved
    push(...approvalFlow("act4", t(4, 9, 0), PEOPLE.megan, ...on("global"), { by: PEOPLE.alex, approved: false }, "INC0012907"));
    push(...approvalFlow("act5", t(5, 14, 0), PEOPLE.grady, ...on("helpdesk"), null, "INC0012944"));
    push(...approvalFlow("act9", t(8, 10, 0), PEOPLE.johanna, ...on("global"), { by: PEOPLE.alex, approved: true }, "INC0012871"));
    push(...activation("act6", t(7, 11, 0), PEOPLE.adele, ...on("intune"), 240, false));
    push(...activation("act7", t(10, 13, 0), PEOPLE.alex, ...on("privileged"), 30, true));
    push(...deactivation("deact7", t(10, 13, 30), PEOPLE.alex, ...on("privileged"), "act7"));
    push(...activation("act8", t(6, 9, 15), PEOPLE.johanna, ...on("exchange"), 60, true));
    push(...activation("act9", t(12, 9, 0), PEOPLE.grady, ...on("reports"), 60, true));
    push(...activation("act10", t(20, 8, 0), PEOPLE.allan, ...on("helpdesk"), 45, true));
    push(...activation("act11", t(25, 16, 0), PEOPLE.adele, ...on("security"), 60, true));
    push(expiry("act11-expired", t(25, 17, 0), PEOPLE.adele, ...on("security"), "act11"));
    push(...activation("act12", t(21, 13, 0), PEOPLE.megan, ...on("teams"), 90, true));
    push(...groupActivation("gact9", t(15, 10, 0), PEOPLE.megan, 60));
    // A group that holds active Azure roles: the Azure Audit page shows the activation once per role it gives
    push(...groupActivation("gact10", t(5, 11, 0), PEOPLE.alex, 60, PLATFORM_GROUP));
    push(...activation("old1", t(45, 9, 0), PEOPLE.megan, ...on("helpdesk"), 60, true));

    // Settings: a change by a person, and by an emergency access account
    push(setting("set1", t(2, 9, 0), PEOPLE.alex, ...on("exchange"), "Maximum activation duration set to 8 hours"));
    push(setting("set2", t(5, 14, 40), PEOPLE.breakGlass, ...on("global"), "Approval required for activation"));
    push(setting("set3", t(8, 10, 0), PEOPLE.alex, ...on("helpdesk"), "Notification to the admin on activation"));
    push({
        id: "set4", at: t(17, 15, 0), type: "UpdatePolicy", activity: "Update role setting in PIM", category: "GroupManagement", by: PEOPLE.alex,
        targets: [...groupTargets("Member", "Legacy Intune Admins", AUDIT_DEMO_GROUP_ID), DIRECTORY, policyTarget("set4")],
        details: { Justification: "Eligible assignments expire after six months" },
    });

    // Direct changes outside PIM: a direct add with its alert 99 seconds later (one row), and a direct removal
    push({
        id: "core1", service: "Core Directory", at: t(14, 16, 0), activity: "Add member to role", by: PEOPLE.alex,
        targets: [coreUserTarget(PEOPLE.adele, ...on("exchange"), "added")],
    });
    push({
        id: "alert1", at: t(14, 16, 0) + 99_000, type: "RoleElevatedOutsidePimAlert", corr: "alert1",
        activity: "Add member to role outside of PIM (permanent)", by: PEOPLE.alex,
        targets: [roleTarget(...on("exchange")), DIRECTORY, userTarget(PEOPLE.adele)],
    });
    push({
        id: "core2", service: "Core Directory", at: t(12, 12, 0), activity: "Remove member from role", by: PEOPLE.alex,
        targets: [coreUserTarget(PEOPLE.adele, ...on("exchange"), "removed")],
    });

    // Assignments: requested by a person, completed by the app (measured)
    push({
        id: "asg1", corr: "asg1", req: "asg1", at: t(8, 7, 0), by: PEOPLE.alex, details: { StartTime: new Date(t(8, 7, 0)).toISOString(), ExpirationTime: new Date(t(-172, 7, 0)).toISOString() }, type: "CreateRequestEligibleRole", activity: "Add eligible member to role requested (PIM assignment)",
        targets: [roleTarget(...on("helpdesk")), DIRECTORY, userTarget(PEOPLE.megan), requestTarget("asg1")],
    });
    push({
        id: "asg1-done", corr: "asg1", req: "asg1", at: t(8, 7, 2), type: "AssignEligibleRole", activity: "Add eligible member to role completed (PIM assignment)",
        targets: [roleTarget(...on("helpdesk")), DIRECTORY, userTarget(PEOPLE.megan), requestTarget("asg1")],
    });
    push({
        id: "asg2", corr: "asg2", req: "asg2", at: t(9, 7, 30), by: PEOPLE.alex, details: { StartTime: new Date(t(9, 7, 0)).toISOString(), ExpirationTime: new Date(t(-171, 7, 0)).toISOString() }, type: "CreateRequestGrantedRole", activity: "Add member to role requested (PIM assignment)",
        targets: [roleTarget(...on("reports")), DIRECTORY, userTarget(PEOPLE.johanna), requestTarget("asg2")],
    });
    push({
        id: "asg2-done", corr: "asg2", req: "asg2", at: t(9, 7, 31), type: "AssignGrantedRole", activity: "Add member to role completed (PIM assignment)",
        targets: [roleTarget(...on("reports")), DIRECTORY, userTarget(PEOPLE.johanna), requestTarget("asg2")],
    });
    push({
        id: "asg3", at: t(10, 8, 0), by: PEOPLE.alex, type: "AdminRemoveEligibleRole", activity: "Remove eligible member from role (PIM)",
        targets: [roleTarget(...on("helpdesk")), DIRECTORY, userTarget(PEOPLE.grady)],
    });
    push({
        id: "asg4", corr: "asg4", req: "asg4", at: t(11, 8, 15), by: PEOPLE.alex, details: { StartTime: new Date(t(11, 7, 0)).toISOString(), ExpirationTime: new Date(t(-169, 7, 0)).toISOString() }, type: "CreateRequestRenewEligibleRole", activity: "Renew eligible member of role requested (PIM assignment)",
        targets: [roleTarget(...on("exchange")), DIRECTORY, userTarget(PEOPLE.adele), requestTarget("asg4")],
    });
    push({
        id: "asg4-done", corr: "asg4", req: "asg4", at: t(11, 8, 16), type: "AssignEligibleRole", activity: "Renew eligible member of role completed (PIM assignment)",
        targets: [roleTarget(...on("exchange")), DIRECTORY, userTarget(PEOPLE.adele), requestTarget("asg4")],
    });
    push({
        id: "asg5", at: t(13, 8, 0), by: PEOPLE.alex, type: "AdminRemoveGrantedRole", activity: "Remove member from role (PIM assignment)",
        targets: [roleTarget(...on("reports")), DIRECTORY, userTarget(PEOPLE.johanna)],
    });
    push({
        id: "asg6", at: t(16, 9, 0), by: PEOPLE.alex, type: "CreateRoleUpdateRequest", activity: "Update role assignment (PIM)",
        targets: [roleTarget(...on("exchange")), DIRECTORY, userTarget(PEOPLE.adele)],
    });
    // Requested by a person, completed by the app
    push({
        id: "asg7", corr: "asg7", req: "asg7", at: t(18, 10, 0), type: "CreateRequestEligibleRole", activity: "Add eligible member to role requested (PIM assignment)", by: PEOPLE.alex,
        targets: [roleTarget(...on("security")), DIRECTORY, userTarget(PEOPLE.allan), requestTarget("asg7")],
    });
    push({
        id: "asg7-done", corr: "asg7", req: "asg7", at: t(18, 10, 2), type: "AssignEligibleRole", activity: "Add eligible member to role completed (PIM assignment)",
        targets: [roleTarget(...on("security")), DIRECTORY, userTarget(PEOPLE.allan), requestTarget("asg7")],
    });
    // Requested by a person, not yet completed
    push({
        id: "asg8", corr: "asg8", req: "asg8", at: t(4, 15, 0), type: "CreateRequestEligibleRole", activity: "Add eligible member to role requested (PIM assignment)", by: PEOPLE.alex,
        targets: [roleTarget(...on("helpdesk")), DIRECTORY, userTarget(PEOPLE.grady), requestTarget("asg8")],
    });

    // A person made eligible for a group that holds a role: the assignment shows with its Through link on the Entra Audit page
    push({
        id: "asg11", corr: "asg11", req: "asg11", at: t(9, 13, 0), type: "CreateRequestEligibleRole", category: "GroupManagement", activity: "Add eligible member to group requested (PIM assignment)", by: PEOPLE.alex,
        targets: [...groupTargets("Member", "Legacy Intune Admins", AUDIT_DEMO_GROUP_ID), DIRECTORY, userTarget(PEOPLE.johanna), requestTarget("asg11")],
    });
    push({
        id: "asg11-done", corr: "asg11", req: "asg11", at: t(9, 13, 2), type: "AssignEligibleRole", category: "GroupManagement", activity: "Add eligible member to group completed (PIM assignment)",
        targets: [...groupTargets("Member", "Legacy Intune Admins", AUDIT_DEMO_GROUP_ID), DIRECTORY, userTarget(PEOPLE.johanna), requestTarget("asg11")],
    });

    // Who else can hold a role: an app made active outside PIM, and a group made eligible
    push({
        id: "alert2", at: t(19, 11, 0), type: "RoleElevatedOutsidePimAlert", corr: "alert2",
        activity: "Add member to role outside of PIM (permanent)", by: PEOPLE.alex,
        targets: [roleTarget(...on("reports")), DIRECTORY, appTarget(demoGuid("sp:deploy"), "Contoso Deploy Pipeline")],
    });
    push({
        id: "asg10", corr: "asg10", req: "asg10", at: t(21, 16, 0), type: "CreateRequestEligibleRole", activity: "Add eligible member to role requested (PIM assignment)", by: PEOPLE.alex,
        targets: [roleTarget(...on("reports")), DIRECTORY, userTarget(KIM), requestTarget("asg10")],
    });
    push({
        id: "alert3", at: t(20, 14, 30), type: "RoleElevatedOutsidePimAlert", corr: "alert3",
        activity: "Add member to role outside of PIM (permanent)", by: PEOPLE.alex,
        targets: [roleTarget(...on("reports")), DIRECTORY, appTarget(demoGuid("agent:ops"), "Contoso Ops Agent")],
    });
    // Holds no role now, so nothing tells whether it was an app or an agent
    push({
        id: "alert4", at: t(21, 10, 15), type: "RoleElevatedOutsidePimAlert", corr: "alert4",
        activity: "Add member to role outside of PIM (permanent)", by: PEOPLE.alex,
        targets: [roleTarget(...on("reports")), DIRECTORY, appTarget(demoGuid("sp:retiredbot"), "Contoso Retired Bot")],
    });
    push({
        id: "asg9", corr: "asg9", req: "asg9", at: t(22, 9, 0), type: "CreateRequestEligibleRole", activity: "Add eligible member to role requested (PIM assignment)", by: PEOPLE.alex,
        targets: [roleTarget(...on("intune")), DIRECTORY, groupTarget(AUDIT_DEMO_GROUP_ID, "Legacy Intune Admins"), requestTarget("asg9")],
    });
    push({
        id: "asg9-done", corr: "asg9", req: "asg9", at: t(22, 9, 2), type: "AssignEligibleRole", activity: "Add eligible member to role completed (PIM assignment)",
        targets: [roleTarget(...on("intune")), DIRECTORY, groupTarget(AUDIT_DEMO_GROUP_ID, "Legacy Intune Admins"), requestTarget("asg9")],
    });

    // The decisions on two Azure role activation requests (Azure Audit): ResourceManagement rows, dropped from the Entra list,
    // that name the ARM request they decide
    push({
        id: "azure-approved", category: "ResourceManagement", at: t(13, 9, 20), type: "ApproveRoleActivation", activity: "Approve role activation request", by: PEOPLE.alex,
        targets: [DIRECTORY], details: { RoleAssignmentRequestId: AZURE_APPROVED_REQUEST, Justification: "Checked with the requester" },
    });
    push({
        id: "azure-denied", category: "ResourceManagement", at: t(7, 14, 40), type: "RejectRoleActivation", activity: "Reject role activation request", by: PEOPLE.megan,
        targets: [DIRECTORY], details: { RoleAssignmentRequestId: AZURE_DENIED_REQUEST, Justification: "No release window today" },
    });

    // Dropped by the mapper: Azure resources, and MS-PIM mirrors of the PIM rows in Core Directory
    push({ id: "res1", category: "ResourceManagement", at: t(6, 12, 0), type: "CreateResource", activity: "Create resource", targets: [{ type: "Subscription", id: demoGuid("subscription:production"), displayName: "Contoso Production", modifiedProperties: [] }] });
    push({ id: "res2", category: "ResourceManagement", at: t(6, 12, 5), type: "UpdateResource", activity: "Update resource", targets: [{ type: "Subscription", id: demoGuid("subscription:production"), displayName: "Contoso Production", modifiedProperties: [] }] });
    push({
        id: "mirror1", service: "Core Directory", app: "MS-PIM", at: t(1, 8, 10) + 20_000, activity: "Add member to role",
        targets: [coreUserTarget(PEOPLE.alex, ...on("security"), "added")],
    });

    // System: an alert, failed daily expiry attempts (one request id, one per day), an unknown type, an end without a start
    push({ id: "sys1", at: t(3, 3, 0), type: "ActivateAlert", activity: "Triggered PIM alert", targets: [DIRECTORY] });
    push({ id: "sys2", at: t(16, 3, 0), type: "ActivateAlert", activity: "Triggered PIM alert", targets: [DIRECTORY] });
    for (const day of [2, 3]) {
        push({
            id: `expiry-day${day}`, corr: `expiry-day${day}`, req: "daily-expiry", at: t(day, 0, 5), type: "RemoveActivatedRoleExpiredOver30Days",
            failure: "CannotDeleteLastAdminAssignment", activity: "Remove member from role (PIM activation expired)",
            targets: [roleTarget(...on("intune")), DIRECTORY, userTarget(PEOPLE.allan)],
        });
    }
    push({ id: "sync1", at: t(11, 4, 0), type: "PimPolicyTemplateSync", activity: "Synchronised PIM policy template", app: "Azure AD PIM", targets: [DIRECTORY] });
    push({
        id: "orphan1", corr: "orphan1", ra: "orphan1", at: t(19, 7, 0), type: "RemoveActivatedRole", activity: "Remove member from role (PIM activation expired)",
        app: "Azure AD PIM", targets: [roleTarget(...on("helpdesk")), DIRECTORY, userTarget(PEOPLE.johanna)],
    });

    return rows.map(toRow).sort((a, b) => Date.parse(b.activityDateTime) - Date.parse(a.activityDateTime));
}
