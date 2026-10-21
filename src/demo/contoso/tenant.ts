import { BUILT_IN_ROLES } from "./builtInRoles";
import { CONTOSO_TENANT_ID, demoGuid } from "./ids";
import { COPILOT_STUDIO_BLUEPRINT_APP_ID } from "@/config/constants";
import { buildPolicyRules, type DemoApprover, type PolicyOptions } from "./rules";
import type {
    DemoAdministrativeUnit,
    DemoConditionalAccessPolicy,
    DemoAlert,
    DemoApplication,
    DemoGroup,
    DemoGroupSchedule,
    DemoPolicy,
    DemoRoleDefinition,
    DemoRoleSchedule,
    DemoServicePrincipal,
    DemoTenant,
    DemoUser,
} from "./model";

/**
 * Contoso, the demo tenant. The people are the Microsoft 365 demo accounts (Adele Vance, Alex Wilber, Megan Bowen, ...).
 * Every option the app can show is in here at least once: each scope type, each principal kind, each assignment kind,
 * each policy setting, managed and unmanaged groups, open and passed alerts. `src/__tests__/demo/fakeGraph.test.ts`
 * checks that, so a new option in the app fails the test until the demo shows it too.
 *
 * Dates are relative to `now`, so the demo never ages: an assignment that "ends in 3 days" always does.
 */

const DOMAIN = "contoso.com";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPS_BLUEPRINT_APP_ID = demoGuid("appid:opsblueprint");
const OPS_AGENT_ID = demoGuid("agent:ops");

// ---------------------------------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------------------------------

function member(alias: string, displayName: string, jobTitle: string, department: string): DemoUser {
    const upn = `${alias}@${DOMAIN}`;
    return { id: demoGuid(`user:${alias}`), displayName, userPrincipalName: upn, mail: upn, userType: "Member", jobTitle, department };
}

function guest(alias: string, displayName: string, homeDomain: string): DemoUser {
    const mail = `${alias}@${homeDomain}`;
    return {
        id: demoGuid(`guest:${alias}`),
        displayName,
        userPrincipalName: `${alias}_${homeDomain}#EXT#@contoso.onmicrosoft.com`,
        mail,
        userType: "Guest",
        jobTitle: null,
        department: null,
    };
}

export const PEOPLE = {
    alex: member("AlexW", "Alex Wilber", "IT Administrator", "IT"),
    adele: member("AdeleV", "Adele Vance", "Retail Manager", "Retail"),
    allan: member("AllanD", "Allan Deyoung", "IT Admin", "IT"),
    christie: member("ChristieC", "Christie Cline", "Buyer", "Retail"),
    debra: member("DebraB", "Debra Berger", "Administrative Assistant", "Executive Management"),
    diego: member("DiegoS", "Diego Siciliani", "HR Manager", "HR"),
    emily: member("EmilyB", "Emily Braun", "Budget Analyst", "Finance"),
    enrico: member("EnricoC", "Enrico Cattaneo", "Attorney", "Legal"),
    grady: member("GradyA", "Grady Archie", "Designer", "R&D"),
    henrietta: member("HenriettaM", "Henrietta Mueller", "Developer", "R&D"),
    irvin: member("IrvinS", "Irvin Sayers", "Director", "Sales & Marketing"),
    isaiah: member("IsaiahL", "Isaiah Langer", "Sales Rep", "Sales & Marketing"),
    johanna: member("JohannaL", "Johanna Lorenz", "Senior Engineer", "Engineering"),
    joni: member("JoniS", "Joni Sherman", "Paralegal", "Legal"),
    lee: member("LeeG", "Lee Gu", "Director", "Manufacturing"),
    lidia: member("LidiaH", "Lidia Holloway", "Product Manager", "Engineering"),
    lynne: member("LynneR", "Lynne Robbins", "Planner", "Retail"),
    megan: member("MeganB", "Megan Bowen", "Marketing Manager", "Marketing"),
    miriam: member("MiriamG", "Miriam Graham", "Director", "Sales & Marketing"),
    nestor: member("NestorW", "Nestor Wilke", "Director", "Operations"),
    patti: member("PattiF", "Patti Fernandez", "President", "Executive Management"),
    pradeep: member("PradeepG", "Pradeep Gupta", "Accountant", "Finance"),
    modAdmin: { ...member("admin", "MOD Administrator", "Administrator", "IT"), userPrincipalName: "admin@contoso.onmicrosoft.com", mail: null },
    breakGlass1: { ...member("bg01", "Break Glass 01", "Emergency access", "IT"), userPrincipalName: "bg01@contoso.onmicrosoft.com", mail: null },
    breakGlass2: { ...member("bg02", "Break Glass 02", "Emergency access", "IT"), userPrincipalName: "bg02@contoso.onmicrosoft.com", mail: null },
    opsAgentUser: { ...member("ops.agent", "Contoso Ops Agent (account)", "AI agent", "IT"), agentParentId: OPS_AGENT_ID },
    kim: guest("kim.akers", "Kim Akers (Fabrikam)", "fabrikam.com"),
    ben: guest("ben.walters", "Ben Walters (Northwind Traders)", "northwindtraders.com"),
    tailspin: guest("support", "Tailspin Toys Support", "tailspintoys.com"),
} satisfies Record<string, DemoUser>;

function app(key: string, displayName: string): DemoApplication {
    return { id: demoGuid(`app:${key}`), appId: demoGuid(`appid:${key}`), displayName };
}

function servicePrincipal(key: string, displayName: string): DemoServicePrincipal {
    return { id: demoGuid(`sp:${key}`), appId: demoGuid(`appid:${key}`), displayName };
}

function agentBlueprintPrincipal(key: string, displayName: string, appId: string): DemoServicePrincipal {
    return { id: demoGuid(`sp:${key}`), appId, displayName, agent: { type: "agentIdentityBlueprintPrincipal" } };
}

/** An agent identity's object id equals its appId (tenant test 2026-10-11) */
function agentIdentity(id: string, displayName: string, blueprintAppId: string): DemoServicePrincipal {
    return { id, appId: id, displayName, agent: { type: "agentIdentity", blueprintAppId } };
}

export const APPS = {
    expenses: app("expenses", "Contoso Expenses"),
    deploy: app("deploy", "Contoso Deploy Pipeline"),
    hrSync: app("hrsync", "Contoso HR Sync"),
};

export const SERVICE_PRINCIPALS = {
    deploy: servicePrincipal("deploy", "Contoso Deploy Pipeline"),
    hrSync: servicePrincipal("hrsync", "Contoso HR Sync"),
    sentinel: servicePrincipal("sentinel", "Sentinel Playbook Runner"),
    copilotBlueprint: agentBlueprintPrincipal("copilotblueprint", "Microsoft Copilot Studio agent identity blueprint", COPILOT_STUDIO_BLUEPRINT_APP_ID),
    opsBlueprint: agentBlueprintPrincipal("opsblueprint", "Contoso Ops Agent Blueprint", OPS_BLUEPRINT_APP_ID),
    hrAgent: agentIdentity(demoGuid("agent:hr"), "Contoso HR Assistant", COPILOT_STUDIO_BLUEPRINT_APP_ID),
    opsAgent: agentIdentity(OPS_AGENT_ID, "Contoso Ops Agent", OPS_BLUEPRINT_APP_ID),
};

export const ADMINISTRATIVE_UNITS = {
    netherlands: { id: demoGuid("au:nl"), displayName: "Contoso Netherlands", description: "Employees based in the Netherlands", isMemberManagementRestricted: false },
    usSales: { id: demoGuid("au:ussales"), displayName: "US Sales", description: "Sales teams in the United States", isMemberManagementRestricted: false },
    executives: { id: demoGuid("au:exec"), displayName: "Executives (restricted)", description: "Restricted management administrative unit for the leadership team", isMemberManagementRestricted: true },
} satisfies Record<string, DemoAdministrativeUnit>;

// ---------------------------------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------------------------------

type GroupKind = "security" | "m365" | "mailSecurity";

function group(key: string, displayName: string, description: string, kind: GroupKind, options: { roleAssignable: boolean; pim: boolean; members?: string[]; owners?: string[]; membershipRule?: string; synced?: boolean }): DemoGroup {
    const mailNickname = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    return {
        id: demoGuid(`group:${key}`),
        displayName,
        description,
        mail: kind === "security" ? null : `${mailNickname}@${DOMAIN}`,
        mailEnabled: kind !== "security",
        securityEnabled: kind !== "m365",
        groupTypes: kind === "m365" ? ["Unified"] : [],
        isAssignableToRole: options.roleAssignable,
        membershipRule: options.membershipRule ?? null,
        membershipRuleProcessingState: options.membershipRule ? "On" : null,
        onPremisesSyncEnabled: options.synced ? true : null,
        isPimManaged: options.pim,
        members: options.members ?? [],
        owners: options.owners ?? [],
    };
}

const P = PEOPLE;

export const GROUPS = {
    // Under PIM for Groups, role-assignable: the group holds roles, its members come and go through PIM
    tier0: group("tier0", "Tier 0 Identity Admins", "Eligible for Privileged Role Administrator and Security Administrator", "security", { roleAssignable: true, pim: true }),
    helpdesk: group("helpdesk", "Helpdesk Operators", "Holds Helpdesk Administrator, eligible for Password Administrator", "security", { roleAssignable: true, pim: true }),
    exchange: group("exchange", "Exchange Admins", "Mail-enabled security group, eligible for Exchange Administrator", "mailSecurity", { roleAssignable: true, pim: true }),
    securityLeads: group("secleads", "Security Leads", "Approvers for privileged role activations", "security", { roleAssignable: true, pim: true, members: [P.patti.id, P.nestor.id] }),
    // Under PIM for Groups, not role-assignable: access to apps and Azure, members include a nested group
    finance: group("finance", "Finance Approvers", "Microsoft 365 group for the finance approval app", "m365", { roleAssignable: false, pim: true, members: [P.emily.id], owners: [P.pradeep.id] }),
    azureOwners: group("azure", "Azure Subscription Owners", "Owner of the production Azure subscriptions", "security", { roleAssignable: false, pim: true }),
    // Role-assignable but not under PIM: standing access outside PIM
    legacyIntune: group("legacyintune", "Legacy Intune Admins", "Created before PIM, still holds Intune Administrator", "security", { roleAssignable: true, pim: false, members: [P.grady.id, P.henrietta.id, P.isaiah.id, P.johanna.id], owners: [P.alex.id] }),
    teamsRollout: group("teamsrollout", "Teams Rollout Team", "Project group, eligible for Teams Administrator outside PIM for Groups", "security", { roleAssignable: true, pim: false, members: [P.megan.id, P.lynne.id] }),
    sharepointSites: group("spsites", "SharePoint Site Admins", "Empty role-assignable group, no role", "security", { roleAssignable: true, pim: false }),
    // Plain groups: principals in pickers and the nested member of Azure Subscription Owners
    platform: group("platform", "Platform Engineers", "Engineers who run the Azure platform", "security", { roleAssignable: false, pim: false, members: [P.johanna.id, P.lidia.id, P.henrietta.id], owners: [P.alex.id] }),
    // Groups PIM cannot manage: one with a membership rule, one synced from on-premises AD. They sit in the Netherlands unit, so the access check reads them and Configure locks them
    salesDynamic: group("salesdynamic", "Sales Team (dynamic)", "Everyone in Sales, kept by a membership rule", "security", { roleAssignable: false, pim: false, membershipRule: "user.department -eq \"Sales & Marketing\"" }),
    onPremAdmins: group("onpremadmins", "On-premises Admins (synced)", "Synchronised from the on-premises Active Directory", "security", { roleAssignable: false, pim: false, synced: true, members: [P.allan.id] }),
    allCompany: group("allcompany", "All Company", "Everyone at Contoso", "m365", { roleAssignable: false, pim: false, members: [P.adele.id, P.alex.id, P.megan.id, P.patti.id, P.lee.id, P.nestor.id] }),
} satisfies Record<string, DemoGroup>;

// ---------------------------------------------------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------------------------------------------------

function builtIn(): DemoRoleDefinition[] {
    return BUILT_IN_ROLES.map((role) => ({
        id: role.templateId,
        displayName: role.name,
        description: role.description,
        isBuiltIn: true,
        isEnabled: true,
        isPrivileged: role.isPrivileged,
        templateId: role.templateId,
        resourceScopes: ["/"],
        rolePermissions: [],
        version: "1",
    }));
}

function custom(key: string, displayName: string, description: string): DemoRoleDefinition {
    const id = demoGuid(`customrole:${key}`);
    return { id, displayName, description, isBuiltIn: false, isEnabled: true, isPrivileged: false, templateId: id, resourceScopes: ["/"], rolePermissions: [], version: null };
}

export const CUSTOM_ROLES = {
    helpdeskTier1: custom("helpdesk-tier1", "Contoso Helpdesk Tier 1", "Reset passwords of non-administrators and read sign-in logs."),
    appReviewer: custom("app-reviewer", "Contoso App Registration Reviewer", "Read application registrations and their consent grants."),
};

/** Role ids by name, for the assignments below; throws on a typo so the tenant never silently loses an assignment */
function roleId(name: string): string {
    const role = BUILT_IN_ROLES.find((r) => r.name === name);
    if (!role) throw new Error(`Demo tenant: unknown built-in role "${name}"`);
    return role.templateId;
}

export const ROLE = {
    globalAdmin: roleId("Global Administrator"),
    privilegedRoleAdmin: roleId("Privileged Role Administrator"),
    privilegedAuthAdmin: roleId("Privileged Authentication Administrator"),
    securityAdmin: roleId("Security Administrator"),
    securityReader: roleId("Security Reader"),
    exchangeAdmin: roleId("Exchange Administrator"),
    userAdmin: roleId("User Administrator"),
    helpdeskAdmin: roleId("Helpdesk Administrator"),
    passwordAdmin: roleId("Password Administrator"),
    cloudAppAdmin: roleId("Cloud Application Administrator"),
    appAdmin: roleId("Application Administrator"),
    intuneAdmin: roleId("Intune Administrator"),
    teamsAdmin: roleId("Teams Administrator"),
    conditionalAccessAdmin: roleId("Conditional Access Administrator"),
    authAdmin: roleId("Authentication Administrator"),
    billingAdmin: roleId("Billing Administrator"),
    globalReader: roleId("Global Reader"),
    reportsReader: roleId("Reports Reader"),
    sharePointAdmin: roleId("SharePoint Administrator"),
    complianceAdmin: roleId("Compliance Administrator"),
    licenseAdmin: roleId("License Administrator"),
    groupsAdmin: roleId("Groups Administrator"),
    exchangeRecipientAdmin: roleId("Exchange Recipient Administrator"),
};

// ---------------------------------------------------------------------------------------------------------------------
// Custom extensions and authentication contexts
// ---------------------------------------------------------------------------------------------------------------------

export const EXTENSIONS = {
    serviceNow: { id: demoGuid("ext:servicenow"), displayName: "ServiceNow ticket check", description: "Checks that the ticket number is an open change in ServiceNow", targetUrl: "https://contoso-pim.azure-api.net/servicenow/check" },
    sentinel: { id: demoGuid("ext:sentinel"), displayName: "Audit trail to Sentinel", description: "Writes every activation of a privileged role to Microsoft Sentinel", targetUrl: "https://contoso-pim.azure-api.net/sentinel/audit" },
    teams: { id: demoGuid("ext:teams"), displayName: "Teams approval notice", description: "Posts pending approvals to the security team channel", targetUrl: "https://contoso-pim.azure-api.net/teams/notify" },
};
/** Linked from a policy, but no longer in the tenant's extension list (deleted): shown as an unknown extension */
export const DELETED_EXTENSION_ID = demoGuid("ext:deleted");

export const AUTH_CONTEXTS = [
    { id: "c1", displayName: "Phishing-resistant MFA", description: "Requires a FIDO2 key or Windows Hello for Business", isAvailable: true },
    { id: "c2", displayName: "Compliant device", description: "Requires an Intune compliant device", isAvailable: true },
    { id: "c3", displayName: "Trusted location", description: "Only from the Contoso office network", isAvailable: false },
];

/**
 * One Conditional Access policy per context, one state each: c1 enabled (phishing-resistant strength, sign-in every
 * time), c2 report-only (compliant device), c3 off. Configure's optional check shows all three.
 */
export const CONDITIONAL_ACCESS_POLICIES: DemoConditionalAccessPolicy[] = [
    {
        id: "6b1f2c3d-0a4e-4f5a-9b6c-7d8e9f0a1b21", displayName: "PIM: phishing-resistant for privileged activation", state: "enabled",
        conditions: { applications: { includeAuthenticationContextClassReferences: ["c1"] } },
        grantControls: { operator: "OR", builtInControls: [], authenticationStrength: { id: "00000000-0000-0000-0000-000000000004" } },
        sessionControls: { signInFrequency: { isEnabled: true, frequencyInterval: "everyTime" } },
    },
    {
        id: "6b1f2c3d-0a4e-4f5a-9b6c-7d8e9f0a1b22", displayName: "PIM: compliant device (report-only)", state: "enabledForReportingButNotEnforced",
        conditions: { applications: { includeAuthenticationContextClassReferences: ["c2"] } },
        grantControls: { operator: "OR", builtInControls: ["compliantDevice"], authenticationStrength: null },
        sessionControls: null,
    },
    {
        id: "6b1f2c3d-0a4e-4f5a-9b6c-7d8e9f0a1b23", displayName: "PIM: trusted location (off)", state: "disabled",
        conditions: { applications: { includeAuthenticationContextClassReferences: ["c3"] } },
        grantControls: { operator: "OR", builtInControls: ["mfa"], authenticationStrength: null },
        sessionControls: null,
    },
];

// ---------------------------------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------------------------------

const SECURITY_LEADS: DemoApprover = { kind: "group", id: GROUPS.securityLeads.id, name: GROUPS.securityLeads.displayName };
const PATTI: DemoApprover = { kind: "user", id: P.patti.id, name: P.patti.displayName };
const NESTOR: DemoApprover = { kind: "user", id: P.nestor.id, name: P.nestor.displayName };
const MANAGER: DemoApprover = { kind: "manager" };

/** Settings per role; every other role keeps the Microsoft default (8 hours, MFA, justification) */
const ROLE_POLICIES: Record<string, PolicyOptions> = {
    [ROLE.globalAdmin]: {
        activationDuration: "PT1H",
        activationRequirement: { authenticationContext: "c1" },
        ticket: true,
        approvers: [SECURITY_LEADS, PATTI],
        extensionBeforeApproval: EXTENSIONS.serviceNow.id,
        extensionAfterApproval: EXTENSIONS.sentinel.id,
        eligibleMustEnd: "P365D",
        activationAdminNotification: { defaultRecipients: true, extraRecipients: ["secops@contoso.com"] },
        eligibleAssignmentRecipients: ["identity-team@contoso.com"],
    },
    [ROLE.privilegedRoleAdmin]: { activationDuration: "PT2H", approvers: [MANAGER], eligibleMustEnd: "P180D" },
    [ROLE.privilegedAuthAdmin]: { activationDuration: "PT2H", approvers: [SECURITY_LEADS] },
    [ROLE.securityAdmin]: {
        activationDuration: "PT4H",
        approvers: [PATTI, NESTOR],
        activationAdminNotification: { defaultRecipients: false, extraRecipients: [] },
    },
    [ROLE.conditionalAccessAdmin]: { activationDuration: "PT2H", activationRequirement: { authenticationContext: "c2" }, approvers: [SECURITY_LEADS], extensionAfterApproval: EXTENSIONS.sentinel.id },
    [ROLE.exchangeAdmin]: { activationRequirement: "none", requestorCriticalOnly: true },
    [ROLE.helpdeskAdmin]: { activationDuration: "PT24H", activationRequirement: "none", justification: false, activationAdminNotification: { defaultRecipients: false, extraRecipients: [] } },
    [ROLE.userAdmin]: { activationDuration: "PT10H" },
    [ROLE.intuneAdmin]: { activationDuration: "PT12H", ticket: true },
    [ROLE.billingAdmin]: { activationDuration: "PT30M", activeMayBePermanent: true, activeAssignmentMfa: false },
    [ROLE.sharePointAdmin]: { activationDuration: "PT6H", extensionBeforeApproval: DELETED_EXTENSION_ID },
    [ROLE.cloudAppAdmin]: { activationDuration: "PT4H", activeMayBePermanent: true },
    [ROLE.reportsReader]: { activeMayBePermanent: true },
    [ROLE.globalReader]: { activationDuration: "PT12H", activeMayBePermanent: true },
    [ROLE.authAdmin]: { activationDuration: "PT3H", ticket: true, approvers: [MANAGER, SECURITY_LEADS] },
};

/** Member and owner policy per group under PIM; the rest keeps the default */
const GROUP_POLICIES: Record<string, { member?: PolicyOptions; owner?: PolicyOptions }> = {
    [GROUPS.tier0.id]: {
        member: { activationDuration: "PT2H", activationRequirement: { authenticationContext: "c1" }, approvers: [SECURITY_LEADS], extensionBeforeApproval: EXTENSIONS.serviceNow.id },
        owner: { activationDuration: "PT1H", approvers: [MANAGER], eligibleMustEnd: "P90D" },
    },
    [GROUPS.helpdesk.id]: { member: { activationDuration: "PT4H", ticket: true }, owner: { activationDuration: "PT8H" } },
    [GROUPS.exchange.id]: { member: { activationDuration: "PT8H", activationRequirement: "none" } },
    [GROUPS.finance.id]: { member: { activationDuration: "PT24H", activationRequirement: "none", justification: false, activeMayBePermanent: true } },
    [GROUPS.azureOwners.id]: { member: { activationDuration: "PT4H", approvers: [PATTI], activationAdminNotification: { defaultRecipients: false, extraRecipients: ["cloud-team@contoso.com"] } } },
};

function rolePolicies(roles: DemoRoleDefinition[]): DemoPolicy[] {
    return roles.map((role) => ({
        id: `Directory_${CONTOSO_TENANT_ID}_${demoGuid(`policy:${role.id}`)}`,
        displayName: "Directory",
        scopeId: "/",
        scopeType: "Directory",
        roleDefinitionId: role.id,
        rules: buildPolicyRules(ROLE_POLICIES[role.id] ?? {}, true),
    }));
}

function groupPolicies(groups: DemoGroup[]): DemoPolicy[] {
    return groups.filter((g) => g.isPimManaged).flatMap((g) => (["member", "owner"] as const).map((access) => ({
        id: `Group_${g.id}_${demoGuid(`grouppolicy:${g.id}:${access}`)}`,
        displayName: "Group",
        scopeId: g.id,
        scopeType: "Group" as const,
        roleDefinitionId: access,
        rules: buildPolicyRules(GROUP_POLICIES[g.id]?.[access] ?? {}, false),
    })));
}

// ---------------------------------------------------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------------------------------------------------

interface ScheduleOptions {
    /** Hours from now; negative is in the past (default: 120 days ago) */
    startsIn?: number;
    /** Hours from now; omitted is no end */
    endsIn?: number;
    scope?: string;
}

const auScope = (au: DemoAdministrativeUnit) => `/administrativeUnits/${au.id}`;

function buildRoleSchedules(now: number): DemoRoleSchedule[] {
    const schedules: DemoRoleSchedule[] = [];
    const add = (kind: "eligible" | "active", role: string, principalId: string, o: ScheduleOptions & { assignmentType?: "Assigned" | "Activated"; throughGroup?: boolean } = {}) => {
        const start = now + (o.startsIn ?? -120 * 24) * HOUR;
        schedules.push({
            kind,
            id: demoGuid(`rs:${kind}:${role}:${principalId}:${o.scope ?? "/"}:${o.assignmentType ?? ""}`),
            roleDefinitionId: role,
            principalId,
            directoryScopeId: o.scope ?? "/",
            startDateTime: new Date(start).toISOString(),
            endDateTime: o.endsIn === undefined ? null : new Date(now + o.endsIn * HOUR).toISOString(),
            assignmentType: kind === "active" ? o.assignmentType ?? "Assigned" : undefined,
            throughGroup: o.throughGroup,
            createdDateTime: new Date(Math.min(start, now) - DAY).toISOString(),
        });
    };
    const eligible = (role: string, principalId: string, o?: ScheduleOptions) => add("eligible", role, principalId, o);
    const assigned = (role: string, principalId: string, o?: ScheduleOptions) => add("active", role, principalId, { ...o, assignmentType: "Assigned" });
    const activated = (role: string, principalId: string, endsInHours: number, throughGroup = false) =>
        add("active", role, principalId, { startsIn: -0.5, endsIn: endsInHours, assignmentType: "Activated", throughGroup });

    // Global Administrator: two emergency accounts and one admin with standing access, the rest eligible
    assigned(ROLE.globalAdmin, P.breakGlass1.id);
    assigned(ROLE.globalAdmin, P.breakGlass2.id);
    assigned(ROLE.globalAdmin, P.modAdmin.id);
    eligible(ROLE.globalAdmin, P.alex.id, { endsIn: 200 * 24 });
    eligible(ROLE.globalAdmin, P.megan.id, { endsIn: 90 * 24 });
    activated(ROLE.globalAdmin, P.alex.id, 0.75);

    // Privileged Role Administrator: a group under PIM and one person whose eligibility ends this week
    eligible(ROLE.privilegedRoleAdmin, GROUPS.tier0.id, { endsIn: 150 * 24 });
    eligible(ROLE.privilegedRoleAdmin, P.patti.id, { endsIn: 5 * 24 });
    eligible(ROLE.privilegedRoleAdmin, P.alex.id, { endsIn: 160 * 24 });

    // Privileged Authentication Administrator: standing access only, nobody eligible
    assigned(ROLE.privilegedAuthAdmin, P.henrietta.id);

    // Security Administrator: through Tier 0 (one member activated it through the group), a guest with active access
    eligible(ROLE.securityAdmin, GROUPS.tier0.id);
    eligible(ROLE.securityAdmin, P.diego.id, { endsIn: 60 * 24 });
    eligible(ROLE.securityAdmin, P.alex.id);
    activated(ROLE.securityAdmin, P.lee.id, 3, true);
    assigned(ROLE.securityAdmin, P.kim.id, { endsIn: 14 * 24 });

    eligible(ROLE.securityReader, P.ben.id);
    eligible(ROLE.securityReader, P.grady.id, { endsIn: 30 * 24 });
    assigned(ROLE.securityReader, SERVICE_PRINCIPALS.sentinel.id);

    // AI agents (Microsoft Entra Agent ID): a Copilot Studio agent with standing access, an own agent with an end, its user account and its blueprint
    assigned(ROLE.exchangeRecipientAdmin, SERVICE_PRINCIPALS.hrAgent.id);
    assigned(ROLE.securityReader, SERVICE_PRINCIPALS.opsAgent.id, { endsIn: 60 * 24 });
    assigned(ROLE.reportsReader, P.opsAgentUser.id, { endsIn: 90 * 24 });
    assigned(ROLE.securityReader, SERVICE_PRINCIPALS.opsBlueprint.id);

    eligible(ROLE.exchangeAdmin, GROUPS.exchange.id);
    eligible(ROLE.exchangeAdmin, P.allan.id, { endsIn: 45 * 24 });

    // User Administrator: tenant-wide, an administrative unit and a restricted management administrative unit
    assigned(ROLE.userAdmin, P.henrietta.id, { endsIn: 25 * 24 });
    eligible(ROLE.userAdmin, P.christie.id, { scope: auScope(ADMINISTRATIVE_UNITS.netherlands) });
    eligible(ROLE.userAdmin, P.johanna.id, { scope: auScope(ADMINISTRATIVE_UNITS.executives), endsIn: 120 * 24 });
    eligible(ROLE.userAdmin, P.irvin.id, { scope: auScope(ADMINISTRATIVE_UNITS.usSales), endsIn: 20 * 24 });

    assigned(ROLE.helpdeskAdmin, GROUPS.helpdesk.id);
    eligible(ROLE.helpdeskAdmin, P.irvin.id, { scope: auScope(ADMINISTRATIVE_UNITS.usSales) });
    eligible(ROLE.passwordAdmin, GROUPS.helpdesk.id);

    // Applications: a service principal with standing access, one with an end, a person scoped to one app registration
    assigned(ROLE.cloudAppAdmin, SERVICE_PRINCIPALS.deploy.id);
    eligible(ROLE.cloudAppAdmin, P.pradeep.id, { scope: `/${APPS.expenses.id}`, endsIn: 100 * 24 });
    assigned(ROLE.appAdmin, SERVICE_PRINCIPALS.hrSync.id, { endsIn: 30 * 24 });
    eligible(ROLE.appAdmin, P.henrietta.id);

    // A role-assignable group outside PIM with standing access, another one eligible
    assigned(ROLE.intuneAdmin, GROUPS.legacyIntune.id);
    eligible(ROLE.intuneAdmin, P.allan.id, { endsIn: 80 * 24 });
    eligible(ROLE.teamsAdmin, GROUPS.teamsRollout.id, { endsIn: 40 * 24 });

    eligible(ROLE.conditionalAccessAdmin, P.nestor.id);
    eligible(ROLE.conditionalAccessAdmin, P.alex.id, { endsIn: 300 * 24 });

    // Starts in three days: an eligibility that is planned, not yet usable
    eligible(ROLE.authAdmin, P.lynne.id, { startsIn: 3 * 24, endsIn: 93 * 24 });
    eligible(ROLE.authAdmin, P.debra.id);

    assigned(ROLE.billingAdmin, P.debra.id, { endsIn: 10 * 24 });
    eligible(ROLE.billingAdmin, P.emily.id);

    for (const person of [P.adele, P.emily, P.joni, P.lidia, P.miriam, P.tailspin]) eligible(ROLE.globalReader, person.id);
    assigned(ROLE.globalReader, P.adele.id, { endsIn: 2 * 24 });
    assigned(ROLE.reportsReader, P.emily.id);
    assigned(ROLE.reportsReader, SERVICE_PRINCIPALS.sentinel.id);

    eligible(ROLE.sharePointAdmin, P.miriam.id, { endsIn: 2 * 24 });
    eligible(ROLE.complianceAdmin, P.lidia.id);
    activated(ROLE.complianceAdmin, P.lidia.id, 6);
    eligible(ROLE.licenseAdmin, P.lynne.id);
    eligible(ROLE.groupsAdmin, P.diego.id, { scope: auScope(ADMINISTRATIVE_UNITS.netherlands) });

    eligible(CUSTOM_ROLES.helpdeskTier1.id, P.joni.id);
    eligible(CUSTOM_ROLES.helpdeskTier1.id, P.isaiah.id, { endsIn: 12 * 24 });

    return schedules;
}

function buildGroupSchedules(now: number): DemoGroupSchedule[] {
    const schedules: DemoGroupSchedule[] = [];
    const add = (kind: "eligible" | "active", g: DemoGroup, principalId: string, accessId: "member" | "owner", o: ScheduleOptions & { assignmentType?: "assigned" | "activated" } = {}) => {
        schedules.push({
            kind,
            id: demoGuid(`gs:${kind}:${g.id}:${principalId}:${accessId}:${o.assignmentType ?? ""}`),
            groupId: g.id,
            principalId,
            accessId,
            startDateTime: new Date(now + (o.startsIn ?? -60 * 24) * HOUR).toISOString(),
            endDateTime: o.endsIn === undefined ? null : new Date(now + o.endsIn * HOUR).toISOString(),
            assignmentType: kind === "active" ? o.assignmentType ?? "assigned" : undefined,
        });
    };
    const eligible = (g: DemoGroup, principalId: string, accessId: "member" | "owner", o?: ScheduleOptions) => add("eligible", g, principalId, accessId, o);
    const assigned = (g: DemoGroup, principalId: string, accessId: "member" | "owner", o?: ScheduleOptions) => add("active", g, principalId, accessId, { ...o, assignmentType: "assigned" });
    const activated = (g: DemoGroup, principalId: string, accessId: "member" | "owner", endsIn: number) => add("active", g, principalId, accessId, { startsIn: -1, endsIn, assignmentType: "activated" });
    const G = GROUPS;

    // Tier 0: eligible members (one activated the group's Security Administrator role), permanent and eligible owners
    eligible(G.tier0, P.lee.id, "member", { endsIn: 180 * 24 });
    activated(G.tier0, P.lee.id, "member", 3);
    eligible(G.tier0, P.diego.id, "member");
    eligible(G.tier0, P.megan.id, "member", { endsIn: 4 * 24 });
    assigned(G.tier0, P.isaiah.id, "member");
    assigned(G.tier0, P.alex.id, "owner");
    eligible(G.tier0, P.patti.id, "owner", { endsIn: 60 * 24 });

    // Helpdesk: members with an end, an activation running now, a guest, an owner with an end
    eligible(G.helpdesk, P.irvin.id, "member", { endsIn: 30 * 24 });
    eligible(G.helpdesk, P.joni.id, "member", { endsIn: 6 * 24 });
    eligible(G.helpdesk, P.kim.id, "member");
    activated(G.helpdesk, P.joni.id, "member", 2);
    assigned(G.helpdesk, P.grady.id, "member", { endsIn: 20 * 24 });
    assigned(G.helpdesk, P.alex.id, "owner", { endsIn: 365 * 24 });

    eligible(G.exchange, P.allan.id, "member");
    eligible(G.exchange, P.christie.id, "member", { endsIn: 90 * 24 });
    assigned(G.exchange, P.allan.id, "owner");

    eligible(G.securityLeads, P.diego.id, "member", { endsIn: 30 * 24 });
    assigned(G.securityLeads, P.patti.id, "owner");

    // Finance: Microsoft 365 group, permanent member, eligible owner
    eligible(G.finance, P.emily.id, "member");
    eligible(G.finance, P.pradeep.id, "member", { endsIn: 120 * 24 });
    assigned(G.finance, P.debra.id, "member");
    // An agent's user account in a group that is not role-assignable (agents can never be in a role-assignable group)
    assigned(G.finance, P.opsAgentUser.id, "member", { endsIn: 30 * 24 });
    eligible(G.finance, P.patti.id, "owner");

    // Azure owners: a nested group as eligible member, a guest, an owner that is about to end
    eligible(G.azureOwners, G.platform.id, "member", { endsIn: 180 * 24 });
    eligible(G.azureOwners, P.johanna.id, "member");
    eligible(G.azureOwners, P.tailspin.id, "member", { endsIn: 7 * 24 });
    activated(G.azureOwners, P.johanna.id, "member", 1);
    assigned(G.azureOwners, P.nestor.id, "owner", { endsIn: 3 * 24 });

    return schedules;
}

// ---------------------------------------------------------------------------------------------------------------------
// Security alerts (Microsoft Learn: Configure security alerts for Microsoft Entra roles in PIM, severities as listed)
// ---------------------------------------------------------------------------------------------------------------------

function buildAlerts(now: number): DemoAlert[] {
    const scanned = new Date(now - 2 * HOUR).toISOString();
    const alert = (key: string, severityLevel: string, displayName: string, description: string, securityImpact: string, mitigationSteps: string, howToPrevent: string, incidents: Record<string, unknown>[], configuration: Record<string, unknown> = {}): DemoAlert => {
        const id = `DirectoryRole_${CONTOSO_TENANT_ID}_${key}`;
        return {
            id,
            alertDefinitionId: id,
            isActive: incidents.length > 0,
            incidentCount: incidents.length,
            lastModifiedDateTime: scanned,
            lastScannedDateTime: scanned,
            scopeId: "/",
            scopeType: "DirectoryRole",
            alertDefinition: { id, displayName, description, severityLevel, securityImpact, mitigationSteps, howToPrevent, isRemediatable: true, isConfigurable: true, scopeType: "DirectoryRole", scopeId: "/" },
            alertConfiguration: { id, alertDefinitionId: id, isEnabled: true, scopeType: "DirectoryRole", scopeId: "/", ...configuration },
            alertIncidents: incidents.map((incident, i) => ({ id: `${key}-${i}`, ...incident })),
        };
    };
    const person = (user: DemoUser, role: string, roleName: string) => ({ assigneeId: user.id, assigneeDisplayName: user.displayName, assigneeUserPrincipalName: user.userPrincipalName, roleDefinitionId: role, roleDisplayName: roleName });
    const role = (id: string, name: string) => ({ roleDefinitionId: id, roleDisplayName: name });

    return [
        alert("RolesAssignedOutsidePimAlert", "high", "Roles are being assigned outside of Privileged Identity Management", "{0} privileged role assignments were made outside of Privileged Identity Management.",
            "Privileged role assignments made outside of Privileged Identity Management aren't properly monitored and might indicate an active attack.",
            "Review the users in the list and remove them from privileged roles assigned outside of Privileged Identity Management.",
            "Investigate where users are being assigned privileged roles outside of Privileged Identity Management and prohibit future assignments from there.",
            [person(P.grady, ROLE.intuneAdmin, "Intune Administrator")]),
        alert("StaleSignInAlert", "medium", "Potential stale accounts in a privileged role", "{0} accounts in a privileged role have not signed in during the past {1} days.",
            "Accounts in a privileged role that haven't signed in might be service or shared accounts that aren't being maintained and are vulnerable to attackers.",
            "Review the accounts in the list. If they no longer need access, remove them from their privileged roles.",
            "Regularly review accounts with privileged roles using access reviews and remove role assignments that are no longer needed.",
            [person(P.modAdmin, ROLE.globalAdmin, "Global Administrator"), person(P.henrietta, ROLE.privilegedAuthAdmin, "Privileged Authentication Administrator")],
            { duration: "P30D" }),
        alert("NoMfaOnRoleActivationAlert", "low", "Roles don't require multifactor authentication for activation", "{0} roles can be activated without multifactor authentication.",
            "Without multifactor authentication, compromised users can activate privileged roles.",
            "Review the list of roles and require multifactor authentication for every role.",
            "Require MFA for every role.",
            [role(ROLE.exchangeAdmin, "Exchange Administrator"), role(ROLE.helpdeskAdmin, "Helpdesk Administrator")]),
        alert("RedundantAssignmentAlert", "low", "Administrators aren't using their privileged roles", "{0} administrators have not activated their privileged role in the past {1} days.",
            "Users that have assigned privileged roles they don't need increase the chances of an attack.",
            "Review the users in the list and remove them from privileged roles that they don't need.",
            "Assign privileged roles only to users who have a business justification, and schedule regular access reviews.",
            [person(P.megan, ROLE.globalAdmin, "Global Administrator")],
            { duration: "P90D" }),
        alert("TooManyGlobalAdminsAssignedToTenantAlert", "low", "There are too many Global Administrators", "There are {0} Global Administrators.",
            "Global Administrator is the highest privileged role. If a Global Administrator is compromised, the attacker gains access to all of their permissions.",
            "Review the users in the list and remove any that don't absolutely need the Global Administrator role.",
            "Assign users the least privileged role they need.",
            [], { globalAdminCountThreshold: 5, percentageOfGlobalAdminsOutOfRolesThreshold: 50 }),
        alert("SequentialActivationRenewalsAlert", "low", "Roles are being activated too frequently", "{0} roles were activated several times within {1} hours.",
            "Multiple activations to the same privileged role by the same user is a sign of an attack.",
            "Review the users in the list and ensure that the activation duration for their privileged role is set long enough for them to perform their tasks.",
            "Ensure that the activation duration for privileged roles is set long enough for users to perform their tasks.",
            [], { timeIntervalBetweenActivations: "PT1H", sequentialActivationCounterThreshold: 10 }),
        alert("InvalidLicenseAlert", "low", "The organization doesn't have Microsoft Entra ID P2 or Microsoft Entra ID Governance", "The current organization doesn't have Microsoft Entra ID P2 or Microsoft Entra ID Governance.",
            "Without the licence, PIM features stop working for the organization.",
            "Upgrade to Microsoft Entra ID P2 or Microsoft Entra ID Governance.",
            "Keep enough licences for every user who uses PIM.",
            []),
    ];
}

// ---------------------------------------------------------------------------------------------------------------------
// The tenant
// ---------------------------------------------------------------------------------------------------------------------

export function buildContosoTenant(now: Date = new Date()): DemoTenant {
    const t = now.getTime();
    const roleDefinitions = [...builtIn(), CUSTOM_ROLES.helpdeskTier1, CUSTOM_ROLES.appReviewer];
    const groups = Object.values(GROUPS);
    return {
        id: CONTOSO_TENANT_ID,
        displayName: "Contoso",
        signedInUserId: P.alex.id,
        users: Object.values(PEOPLE),
        servicePrincipals: Object.values(SERVICE_PRINCIPALS),
        applications: Object.values(APPS),
        // Contoso Netherlands holds the Platform Engineers group: a Groups Administrator scoped to the unit may change it
        administrativeUnits: Object.values(ADMINISTRATIVE_UNITS).map((au) => (au.id === ADMINISTRATIVE_UNITS.netherlands.id ? { ...au, groupMembers: [GROUPS.platform.id, GROUPS.salesDynamic.id, GROUPS.onPremAdmins.id] } : au)),
        groups,
        roleDefinitions,
        roleSchedules: buildRoleSchedules(t),
        groupSchedules: buildGroupSchedules(t),
        policies: [...rolePolicies(roleDefinitions), ...groupPolicies(groups)],
        alerts: buildAlerts(t),
        customExtensions: Object.values(EXTENSIONS),
        authenticationContexts: AUTH_CONTEXTS,
        conditionalAccessPolicies: CONDITIONAL_ACCESS_POLICIES,
        emergencyAccountIds: [P.breakGlass1.id, P.breakGlass2.id],
    };
}
