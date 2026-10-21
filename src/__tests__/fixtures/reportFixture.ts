import type { Approver, PimPolicyRule, RoleDetailData } from "@/types/directoryRole.types";
import type { GroupPimAssignment, GroupPimPolicy, PimGroupData } from "@/types/pimGroup.types";
import type { GroupMembership, GroupMembershipPrincipal } from "@/services/groupMembershipService";
import type { AuthenticationContext } from "@/types/shared.types";

/**
 * Contoso data of the Report design boards (docs/Assets/next-gen/report/renders): 146 roles and 12 groups. The renders of the roles
 * view show "Groups 12", the renders of the groups view show 5 groups; this fixture has 12 (5 outside PIM, 7 under PIM), so a
 * filter such as "Holds roles" lists 6 groups where the render says 5 of 5 (known, accepted difference, see blockers.md). Used by
 * the fixture route `/dev/report` and by tests; the numbers are fictitious.
 */

export const REPORT_ROLE_COUNT = 146;
export const GLOBAL_ADMIN_TEMPLATE_ID = "62e90394-69f5-4237-9190-012177145e10";
export const SERVICENOW_EXTENSION = { id: "ext-servicenow", displayName: "ServiceNow ticket check" } as const;
export const REPORT_AUTH_CONTEXTS: AuthenticationContext[] = [{ id: "c1", displayName: "Phishing-resistant", isAvailable: true }];
export const REPORT_EXTENSIONS = [SERVICENOW_EXTENSION, { id: "ext-audit", displayName: "Audit trail hook" }];
export const REPORT_EMERGENCY_IDS = ["u-bg1", "u-bg2"] as const;
/** Blueprint names the fixture route passes to the Report (AG-5) */
export const FIXTURE_BLUEPRINT_NAMES: ReadonlyMap<string, string> = new Map([["00000000-0000-0000-0000-0000000000b1", "Contoso Ops Agent Blueprint"]]);

const T = "#microsoft.graph.unifiedRoleManagementPolicy";
const userP = (id: string, displayName: string, userPrincipalName: string) => ({ id, "@odata.type": "#microsoft.graph.user", displayName, userPrincipalName });
const groupP = (id: string, displayName: string) => ({ id, "@odata.type": "#microsoft.graph.group", displayName });
const appP = (id: string, displayName: string) => ({ id, "@odata.type": "#microsoft.graph.servicePrincipal", displayName });
const agentP = (id: string, displayName: string, blueprintAppId: string) => ({ id, "@odata.type": "#microsoft.graph.agentIdentity", displayName, servicePrincipalType: "ServiceIdentity", agentIdentityBlueprintId: blueprintAppId });

export const PEOPLE = {
    anna: userP("u-anna", "Anna de Vries", "anna@contoso.com"),
    bram: userP("u-bram", "Bram Janssen", "bram@contoso.com"),
    bg1: userP("u-bg1", "Break glass 01", "bg01@contoso.onmicrosoft.com"),
    bg2: userP("u-bg2", "Break glass 02", "bg02@contoso.onmicrosoft.com"),
    lotte: userP("u-lotte", "Lotte Visser", "lotte@contoso.com"),
    mo: userP("u-mo", "Mo Haddad", "mo@contoso.com"),
    ravi: userP("u-ravi", "Ravi Nair", "ravi@contoso.com"),
    erik: userP("u-erik", "Erik van Dam", "erik@contoso.com"),
    guest: userP("u-guest", "Sam Partner (guest)", "sam.partner_fabrikam.com#EXT#@contoso.onmicrosoft.com"),
    app: appP("sp-deploy", "Deploy pipeline"),
};

const target = (caller: string, level: string) => ({ caller, operations: ["All"], level, inheritableSettings: [], enforcedSettings: [] });

interface RuleOptions {
    duration?: string;
    mfa?: boolean;
    authContext?: string;
    justification?: boolean;
    ticket?: boolean;
    approvers?: Array<{ kind: "user" | "group" | "manager"; id: string; name?: string }>;
    extensionBefore?: { id: string; name: string };
    extensionAfter?: { id: string; name: string };
    permanentActive?: boolean;
    activationAdminNotified?: boolean;
}

/** A complete policy rule set as Graph returns it for a role or for a group's Member or Owner policy */
export function buildReportRules(o: RuleOptions = {}): PimPolicyRule[] {
    const rule = (id: string, type: string, caller: string, level: string, extra: Record<string, unknown> = {}) => ({ id, "@odata.type": `${T}${type}Rule`, target: target(caller, level), ...extra });
    const notification = (id: string, caller: string, level: string, recipientType: string, extra: Record<string, unknown> = {}) =>
        rule(id, "Notification", caller, level, { notificationType: "Email", recipientType, notificationLevel: "All", isDefaultRecipientsEnabled: true, notificationRecipients: [], ...extra });
    const approvers = (o.approvers ?? []).map((a) => (a.kind === "manager"
        ? { "@odata.type": "#microsoft.graph.requestorManager" }
        : a.kind === "user"
            ? { "@odata.type": "#microsoft.graph.singleUser", userId: a.id, description: a.name ?? a.id }
            : { "@odata.type": "#microsoft.graph.groupMembers", groupId: a.id, description: a.name ?? a.id }));
    const extension = (slot: "PreApproval" | "PostApproval", link?: { id: string; name: string }) =>
        rule(`CustomExtension_${slot}_EndUser_Assignment`, "CustomExtension", "EndUser", "Assignment", link
            ? { isEnabled: true, customExtensionId: link.id, displayName: link.name, customAttributes: [] }
            : { isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [] });
    return [
        rule("Expiration_EndUser_Assignment", "Expiration", "EndUser", "Assignment", { isExpirationRequired: true, maximumDuration: o.duration ?? "PT8H" }),
        rule("Enablement_EndUser_Assignment", "Enablement", "EndUser", "Assignment", {
            enabledRules: [...(o.mfa === false ? [] : o.authContext ? [] : ["MultiFactorAuthentication"]), ...(o.justification === false ? [] : ["Justification"]), ...(o.ticket ? ["Ticketing"] : [])],
        }),
        rule("Approval_EndUser_Assignment", "Approval", "EndUser", "Assignment", { setting: { isApprovalRequired: approvers.length > 0, approvalStages: approvers.length > 0 ? [{ primaryApprovers: approvers }] : [] } }),
        rule("AuthenticationContext_EndUser_Assignment", "AuthenticationContext", "EndUser", "Assignment", o.authContext ? { isEnabled: true, claimValue: o.authContext } : { isEnabled: false, claimValue: "" }),
        extension("PreApproval", o.extensionBefore),
        ...(o.extensionAfter ? [extension("PostApproval", o.extensionAfter)] : []),
        rule("Expiration_Admin_Eligibility", "Expiration", "Admin", "Eligibility", { isExpirationRequired: false, maximumDuration: "P365D" }),
        rule("Expiration_Admin_Assignment", "Expiration", "Admin", "Assignment", { isExpirationRequired: o.permanentActive !== true, maximumDuration: "P180D" }),
        rule("Enablement_Admin_Assignment", "Enablement", "Admin", "Assignment", { enabledRules: ["MultiFactorAuthentication", "Justification"] }),
        notification("Notification_Admin_Admin_Eligibility", "Admin", "Eligibility", "Admin"),
        notification("Notification_Requestor_Admin_Eligibility", "Admin", "Eligibility", "Requestor"),
        notification("Notification_Approver_Admin_Eligibility", "Admin", "Eligibility", "Approver"),
        notification("Notification_Admin_Admin_Assignment", "Admin", "Assignment", "Admin"),
        notification("Notification_Requestor_Admin_Assignment", "Admin", "Assignment", "Requestor"),
        notification("Notification_Approver_Admin_Assignment", "Admin", "Assignment", "Approver"),
        notification("Notification_Admin_EndUser_Assignment", "EndUser", "Assignment", "Admin", { isDefaultRecipientsEnabled: o.activationAdminNotified !== false }),
        notification("Notification_Requestor_EndUser_Assignment", "EndUser", "Assignment", "Requestor"),
        notification("Notification_Approver_EndUser_Assignment", "EndUser", "Assignment", "Approver"),
    ] as unknown as PimPolicyRule[];
}

const ends = (iso: string) => ({ scheduleInfo: { expiration: { type: "afterDateTime", endDateTime: iso } } });
const noEnd = { scheduleInfo: { expiration: { type: "noExpiration" } } };
const tenant = { scopeInfo: { type: "tenant-wide", displayName: "Tenant-wide" }, directoryScopeId: "/" };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

type Principal = ReturnType<typeof userP> | ReturnType<typeof groupP> | ReturnType<typeof appP> | ReturnType<typeof agentP>;

const eligible = (roleId: string, principal: Principal, extra: Record<string, unknown> = {}) => ({
    id: nextId("elig"), principalId: principal.id, principal, roleDefinitionId: roleId, memberType: "Direct", status: "Provisioned", ...tenant, ...extra,
});
const active = (roleId: string, principal: Principal, extra: Record<string, unknown> = {}) => ({
    id: nextId("act"), principalId: principal.id, principal, roleDefinitionId: roleId, memberType: "Direct", status: "Provisioned", assignmentType: "Assigned", ...tenant, ...extra,
});

interface RoleSpec {
    id: string;
    name: string;
    description?: string;
    templateId?: string;
    isPrivileged?: boolean;
    isBuiltIn?: boolean;
    eligible?: Record<string, unknown>[];
    active?: Record<string, unknown>[];
    rules?: PimPolicyRule[] | null;
    approvers?: Approver[];
    configError?: string;
}

function makeRole(spec: RoleSpec): RoleDetailData {
    return {
        definition: { id: spec.id, displayName: spec.name, description: spec.description ?? `Can manage ${spec.name.toLowerCase()} settings.`, templateId: spec.templateId, isBuiltIn: spec.isBuiltIn ?? true, isPrivileged: spec.isPrivileged ?? false } as RoleDetailData["definition"],
        assignments: { permanent: [], eligible: (spec.eligible ?? []) as never, active: (spec.active ?? []) as never },
        policy: spec.rules === null ? null : { assignment: { id: `pa-${spec.id}`, policyId: `pol-${spec.id}`, scopeId: "/", scopeType: "DirectoryRole", roleDefinitionId: spec.id }, details: { id: `pol-${spec.id}`, rules: spec.rules ?? buildReportRules() }, approvers: spec.approvers ?? [] },
        configError: spec.configError,
    } as unknown as RoleDetailData;
}

const SECURITY_LEADS: Approver = { id: "g-secleads", displayName: "Security Leads", type: "group", "@odata.type": "#microsoft.graph.groupMembers" };

/** Real built-in role names for the rest of the list */
const FILLER_NAMES = [
    "Attack Payload Author", "Attribute Assignment Administrator", "Billing Administrator", "Cloud Application Administrator", "Compliance Administrator",
    "Conditional Access Administrator", "Customer LockBox Access Approver", "Desktop Analytics Administrator", "Directory Readers", "Domain Name Administrator",
    "Dynamics 365 Administrator", "Fabric Administrator", "Global Reader", "Groups Administrator", "Guest Inviter", "Helpdesk Administrator", "Identity Governance Administrator",
    "Insights Administrator", "Intune Administrator", "License Administrator", "Message Center Reader", "Network Administrator", "Password Administrator",
    "Power Platform Administrator", "Printer Administrator", "Reports Reader", "Search Administrator", "Security Operator", "Security Reader", "SharePoint Administrator",
    "Teams Administrator", "Usage Summary Reports Reader", "Windows 365 Administrator", "Authentication Administrator", "Authentication Policy Administrator",
    "Azure DevOps Administrator", "B2C IEF Keyset Administrator", "Cloud Device Administrator", "Directory Writers", "External ID User Flow Administrator",
];

export function buildReportRoles(): RoleDetailData[] {
    counter = 0;
    const ga = "role-ga";
    const roles: RoleDetailData[] = [
        makeRole({
            id: ga, name: "Global Administrator", templateId: GLOBAL_ADMIN_TEMPLATE_ID, isPrivileged: true,
            description: "Can manage all aspects of Microsoft Entra ID and Microsoft services that use Microsoft Entra identities.",
            eligible: [eligible(ga, PEOPLE.anna, ends("2027-03-14T00:00:00Z")), eligible(ga, PEOPLE.bram, ends("2026-12-31T00:00:00Z")), eligible(ga, groupP("g-tier0", "Tier 0 Admins"), ends("2026-12-31T00:00:00Z"))],
            active: [active(ga, PEOPLE.bg1, noEnd), active(ga, PEOPLE.bg2, noEnd)],
            rules: buildReportRules({ duration: "PT4H", authContext: "c1", justification: true, ticket: true, approvers: [{ kind: "group", id: "g-secleads", name: "Security Leads" }], extensionBefore: { id: SERVICENOW_EXTENSION.id, name: SERVICENOW_EXTENSION.displayName } }),
            approvers: [SECURITY_LEADS],
        }),
        makeRole({ id: "role-pra", name: "Privileged Role Administrator", isPrivileged: true, eligible: [eligible("role-pra", PEOPLE.anna, ends("2027-01-31T00:00:00Z")), eligible("role-pra", PEOPLE.lotte, ends("2027-02-28T00:00:00Z"))] }),
        makeRole({ id: "role-sec", name: "Security Administrator", isPrivileged: true, eligible: [eligible("role-sec", PEOPLE.bram, ends("2027-01-31T00:00:00Z")), eligible("role-sec", PEOPLE.mo, noEnd)], active: [active("role-sec", PEOPLE.ravi, { assignmentType: "Activated", ...ends("2026-10-02T18:00:00Z") })] }),
        makeRole({
            id: "role-ua", name: "User Administrator", isPrivileged: true,
            eligible: [eligible("role-ua", PEOPLE.lotte, ends("2027-03-31T00:00:00Z"))],
            active: [active("role-ua", PEOPLE.erik, noEnd), active("role-ua", PEOPLE.guest, noEnd)],
            rules: buildReportRules({ mfa: false, permanentActive: true, activationAdminNotified: false }),
        }),
        makeRole({ id: "role-exo", name: "Exchange Administrator", eligible: [eligible("role-exo", PEOPLE.mo, noEnd), eligible("role-exo", groupP("g-exo", "Exchange Operators"), noEnd)] }),
        makeRole({
            id: "role-app", name: "Application Administrator", isPrivileged: true,
            eligible: [eligible("role-app", PEOPLE.bram, ends("2027-02-28T00:00:00Z")), eligible("role-app", PEOPLE.app, noEnd)],
            active: [
                active("role-app", agentP("agent-hr", "Contoso HR Assistant", "25664c89-cea5-4ab6-b924-a54fd8a19ae0"), noEnd),
                active("role-app", agentP("agent-ops", "Contoso Ops Agent", "00000000-0000-0000-0000-0000000000b1"), noEnd),
            ],
        }),
        makeRole({
            id: "role-chr", name: "Contoso Helpdesk Reader", isBuiltIn: false, description: "Reads helpdesk tickets and basic user properties.",
            eligible: [eligible("role-chr", groupP("g-helpdesk1", "Helpdesk Tier 1"), noEnd)],
            rules: buildReportRules({ mfa: false }),
        }),
        makeRole({
            id: "role-soc", name: "Security Reader", isPrivileged: false,
            eligible: [eligible("role-soc", groupP("g-soc", "SOC Analysts"), noEnd)],
            active: [],
        }),
        makeRole({ id: "role-soc-op", name: "Security Operator", eligible: [], active: [active("role-soc-op", groupP("g-soc", "SOC Analysts"), noEnd)] }),
        makeRole({ id: "role-dev", name: "Contoso Developer Support", isBuiltIn: false, eligible: [eligible("role-dev", groupP("g-dev", "Dev Leads"), ends("2027-06-30T00:00:00Z"))], active: [active("role-dev", groupP("g-dev", "Dev Leads"), ends("2026-12-31T00:00:00Z"))] }),
    ];
    // A role without a policy because its read failed, and one that nobody holds
    roles.push(makeRole({ id: "role-failed", name: "Contoso Billing Reviewer", isBuiltIn: false, rules: null, configError: "429", eligible: [eligible("role-failed", PEOPLE.lotte, noEnd)] }));
    roles.push(makeRole({ id: "role-nobody", name: "Contoso Audit Reader", isBuiltIn: false, isPrivileged: false }));

    const used = new Set(roles.map((r) => r.definition.displayName));
    const fillerNames = FILLER_NAMES.filter((name) => !used.has(name));
    for (let i = 0; roles.length < REPORT_ROLE_COUNT; i++) {
        const name = fillerNames[i % fillerNames.length];
        const id = `role-f${String(i).padStart(3, "0")}`;
        const holders = i % 3 === 0 ? [] : i % 3 === 1 ? [PEOPLE.mo] : [PEOPLE.lotte, PEOPLE.ravi];
        roles.push(makeRole({
            id, name: i < fillerNames.length ? name : `${name} (${Math.floor(i / fillerNames.length) + 1})`, isPrivileged: i % 5 === 0,
            eligible: holders.map((h, n) => eligible(id, h, n === 0 ? noEnd : ends("2027-05-31T00:00:00Z"))),
        }));
    }
    return roles;
}

const assignment = (groupId: string, principal: Principal, accessType: "member" | "owner", kind: "eligible" | "active" | "permanent", extra: Partial<GroupPimAssignment> = {}): GroupPimAssignment => ({
    id: nextId("gas"), groupId, principalId: principal.id, principal: principal as never, accessType,
    assignmentType: kind,
    ...(kind === "eligible" ? {} : { assignmentOrigin: kind === "permanent" ? ("assigned" as const) : ("activated" as const) }),
    memberType: "Direct",
    ...extra,
});

const groupPolicy = (groupId: string, policyType: "member" | "owner", o: RuleOptions = {}, approvers?: Approver[]): GroupPimPolicy => ({
    id: `${groupId}-${policyType}`, groupId, policyType, rules: buildReportRules(o) as unknown as GroupPimPolicy["rules"], approvers,
});

function makeGroup(id: string, name: string, o: Partial<PimGroupData> & { description?: string; type?: "security" | "m365"; isAssignableToRole?: boolean } = {}): PimGroupData {
    const { description, type, isAssignableToRole, ...rest } = o;
    return {
        group: { id, displayName: name, description, groupType: type ?? "security", isAssignableToRole: isAssignableToRole ?? true },
        assignments: [],
        isManaged: true,
        ...rest,
    };
}

export function buildReportGroups(): PimGroupData[] {
    counter = 1000;
    const outside = (id: string, name: string, memberCount: number, description?: string) => makeGroup(id, name, { isManaged: false, memberCount, description });
    const groups: PimGroupData[] = [
        outside("g-tier0", "Tier 0 Admins", 3, "Role-assignable security group. Members get its roles all the time."),
        outside("g-soc", "SOC Analysts", 7, "Security operations. Members read and triage incidents."),
        outside("g-exo", "Exchange Operators", 4),
        outside("g-legacy", "Legacy Admins", 12),
        outside("g-teams", "Teams Admins", 5),
        makeGroup("g-helpdesk1", "Helpdesk Tier 1", {
            description: "Service desk. Members activate their membership to get the helpdesk role.",
            assignments: [
                assignment("g-helpdesk1", PEOPLE.lotte, "member", "eligible", { endDateTime: "2027-06-30T00:00:00Z", scheduleInfo: { expiration: { type: "afterDateTime", endDateTime: "2027-06-30T00:00:00Z" } } }),
                assignment("g-helpdesk1", PEOPLE.mo, "member", "eligible", { scheduleInfo: { expiration: { type: "noExpiration" } } }),
                assignment("g-helpdesk1", PEOPLE.ravi, "member", "active", { endDateTime: "2026-10-02T18:00:00Z" }),
                assignment("g-helpdesk1", PEOPLE.erik, "owner", "permanent"),
            ],
            policies: { member: groupPolicy("g-helpdesk1", "member", { permanentActive: true, extensionBefore: undefined }, []), owner: groupPolicy("g-helpdesk1", "owner", { permanentActive: true, mfa: false }, []) },
        }),
        makeGroup("g-dev", "Dev Leads", {
            assignments: [
                assignment("g-dev", PEOPLE.bram, "member", "eligible", { endDateTime: "2027-05-31T00:00:00Z" }),
                assignment("g-dev", PEOPLE.guest, "member", "eligible", { principalUserType: "Guest" }),
                assignment("g-dev", PEOPLE.anna, "member", "active", { endDateTime: "2026-10-03T00:00:00Z" }),
            ],
            policies: { member: groupPolicy("g-dev", "member", { duration: "PT4H" }, []), owner: groupPolicy("g-dev", "owner", {}, []) },
        }),
        makeGroup("g-finance", "Finance Approvers", {
            description: "Approves finance requests.",
            assignments: [assignment("g-finance", PEOPLE.lotte, "member", "eligible")],
            policies: {
                member: groupPolicy("g-finance", "member", { approvers: [{ kind: "user", id: "u-erik", name: "Erik van Dam" }] }, [{ id: "u-erik", displayName: "Erik van Dam", type: "user", "@odata.type": "#microsoft.graph.singleUser" }]),
                owner: groupPolicy("g-finance", "owner", {}, []),
            },
        }),
    ];
    ["Release Managers", "Data Stewards", "Legal Reviewers", "Partner Access"].forEach((name, i) => {
        const id = `g-x${i}`;
        groups.push(makeGroup(id, name, {
            type: "m365", isAssignableToRole: false,
            assignments: i === 0 ? [] : [assignment(id, PEOPLE.mo, "member", "eligible")],
            policies: { member: groupPolicy(id, "member", {}, []), owner: groupPolicy(id, "owner", {}, []) },
        }));
    });
    return groups;
}

/** Members and owners of the groups outside PIM, as the on-demand read returns them */
export function buildReportMembership(groupId: string): GroupMembership {
    const user = (p: ReturnType<typeof userP>, extra: Partial<GroupMembershipPrincipal> = {}): GroupMembershipPrincipal => ({ id: p.id, displayName: p.displayName, userPrincipalName: p.userPrincipalName, userType: "Member", kind: "user", ...extra });
    switch (groupId) {
        case "g-tier0":
            return { members: [user(PEOPLE.bram), user(PEOPLE.anna)], owners: [user(PEOPLE.bg1)] };
        case "g-soc":
            return { members: [user(PEOPLE.anna), user(PEOPLE.bram), user(PEOPLE.lotte), user(PEOPLE.mo), user(PEOPLE.ravi), user(PEOPLE.erik), user(PEOPLE.guest, { userType: "Guest" })], owners: [] };
        default:
            return { members: [user(PEOPLE.mo)], owners: [] };
    }
}
