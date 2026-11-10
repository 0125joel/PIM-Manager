import { CONTOSO_TENANT_ID, demoGuid } from "./ids";
import { GROUPS, PEOPLE, SERVICE_PRINCIPALS } from "./tenant";
import type { DemoGroup, DemoServicePrincipal, DemoUser } from "./model";

/**
 * The Azure side of Contoso, for the fake ARM (`src/demo/arm/server.ts`): the tree the board shows (root, Tenant Root
 * Group, management groups, five subscriptions (one delegated from another tenant), resource groups, a few resources; the third is readable only
 * below its own level), the active and eligible PIM items
 * on it and a role management policy per privileged role on the management groups, subscriptions, resource groups and resources. The shapes follow
 * the spike fixtures in `docs/Assets/azure/spike-fixtures/` and the Learn REST reference. Principals are the people,
 * groups and service principals of the Entra tenant, with the same ids, so both sides of the demo agree.
 */

export type DemoAzureLevel = "tenant" | "managementgroup" | "subscription" | "resourcegroup" | "resource";

export interface DemoAzureScope {
    /** The ARM scope id: `/`, `/providers/Microsoft.Management/managementGroups/{name}`, `/subscriptions/{id}/...` */
    id: string;
    displayName: string;
    level: DemoAzureLevel;
    /** The scope above it; null for the root */
    parentId: string | null;
}

export interface DemoAzureSubscription {
    subscriptionId: string;
    displayName: string;
    state: "Enabled" | "Warned" | "PastDue" | "Disabled" | "Deleted";
    /** Another tenant's subscription delegated to Contoso through Azure Lighthouse; absent: the Contoso tenant */
    tenantId?: string;
    /**
     * The demo account holds no role on the subscription itself, only on these scopes below it: a list at the
     * subscription, or at a scope not at or below one of these, answers 400 `InsufficientPermissions` (tenant test T4),
     * and the resource group and resource lists hold only these scopes and what is below them.
     */
    readableScopes?: string[];
}

export interface DemoAzurePrincipal {
    id: string;
    displayName: string;
    type: "User" | "Group" | "ServicePrincipal" | "AgentIdentity";
    email?: string;
    userPrincipalName?: string;
}

export interface DemoAzureRole {
    /** The role definition GUID (Learn, built-in roles) */
    id: string;
    displayName: string;
    /** The `description` of the role definition, verbatim from the JSON on Learn's built-in roles pages */
    description: string;
    /** A custom role: where it can be assigned (Learn: a management group, subscription or resource group) */
    custom?: { assignableScopes: string[] };
    permissions: { actions: string[]; notActions: string[]; dataActions: string[]; notDataActions: string[] };
}

export interface DemoAzureInstance {
    /** Seed of the instance and schedule GUIDs */
    key: string;
    kind: "eligible" | "active";
    principal: DemoAzurePrincipal;
    role: DemoAzureRole;
    scope: string;
    startDateTime: string;
    /** null: permanent; ARM then leaves `endDateTime` out */
    endDateTime: string | null;
    createdOn: string;
    /** Active items only: `Activated` came from an eligibility (`linkedEligibilityKey`), `Assigned` is direct */
    assignmentType?: "Assigned" | "Activated";
    linkedEligibilityKey?: string;
}

export interface DemoAzurePolicyAssignee {
    id: string;
    description: string;
    userType: "User" | "Group";
}

/** The settings of one role at one scope; the rules are built from them in the shape of the fixtures */
export interface DemoAzurePolicySettings {
    activationMaxDuration: string;
    requireMfa: boolean;
    requireJustification: boolean;
    approvers: DemoAzurePolicyAssignee[];
    eligibleMaxDuration: string;
    activeMaxDuration: string;
}

export interface DemoAzurePolicy {
    scope: string;
    role: DemoAzureRole;
    settings: DemoAzurePolicySettings;
    /** Set when the policy was changed from the default */
    lastModified: { at: string; by: DemoAzurePrincipal } | null;
}

/** PIM's alert state of one subscription; `lastScannedDateTime` null: never scanned (ARM gives 0001-01-01, measured 2026-10-24) */
export interface DemoAzureAlertState {
    subscriptionId: string;
    lastScannedDateTime: string | null;
    /** Alert definition name to incident count; an alert not listed has 0 and is not active */
    incidents: Partial<Record<"TooManyOwnersAssignedToResource" | "TooManyPermanentOwnersAssignedToResource" | "DuplicateRoleCreated" | "AzureRolesAssignedOutsidePimAlert", number>>;
}

export interface DemoAzure {
    tenantId: string;
    scopes: DemoAzureScope[];
    subscriptions: DemoAzureSubscription[];
    instances: DemoAzureInstance[];
    policies: DemoAzurePolicy[];
    alerts: DemoAzureAlertState[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Roles and principals
// ---------------------------------------------------------------------------------------------------------------------

const NONE: string[] = [];

export const AZURE_ROLES = {
    owner: { id: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635", displayName: "Owner", description: "Grants full access to manage all resources, including the ability to assign roles in Azure RBAC.", permissions: { actions: ["*"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
    // Abridged from Learn
    contributor: { id: "b24988ac-6180-42a0-ab88-20f7382dd24c", displayName: "Contributor", description: "Grants full access to manage all resources, but does not allow you to assign roles in Azure RBAC, manage assignments in Azure Blueprints, or share image galleries.", permissions: { actions: ["*"], notActions: ["Microsoft.Authorization/*/Delete", "Microsoft.Authorization/*/Write", "Microsoft.Authorization/elevateAccess/Action"], dataActions: NONE, notDataActions: NONE } },
    reader: { id: "acdd72a7-3385-48ef-bd42-f606fba81ae7", displayName: "Reader", description: "View all resources, but does not allow you to make any changes.", permissions: { actions: ["*/read"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
    userAccessAdministrator: { id: "18d7d88d-d35e-4fb5-a5c3-7773c20a72d9", displayName: "User Access Administrator", description: "Lets you manage user access to Azure resources.", permissions: { actions: ["*/read", "Microsoft.Authorization/*", "Microsoft.Support/*"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
    rbacAdministrator: { id: "f58310d9-a9f6-439a-9e8d-f62e7b41a168", displayName: "Role Based Access Control Administrator", description: "Manage access to Azure resources by assigning roles using Azure RBAC. This role does not allow you to manage access using other ways, such as Azure Policy.", permissions: { actions: ["Microsoft.Authorization/roleAssignments/write", "Microsoft.Authorization/roleAssignments/delete", "*/read", "Microsoft.Support/*"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
    storageBlobDataReader: { id: "2a2b9908-6ea1-4ae2-8e65-a410df84e7d1", displayName: "Storage Blob Data Reader", description: "Allows for read access to Azure Storage blob containers and data", permissions: { actions: ["Microsoft.Storage/storageAccounts/blobServices/containers/read", "Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action"], notActions: NONE, dataActions: ["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read"], notDataActions: NONE } },
    // Abridged from Learn
    keyVaultAdministrator: { id: "00482a5a-887f-4fb3-b363-3b7fe8e74483", displayName: "Key Vault Administrator", description: "Perform all data plane operations on a key vault and all objects in it, including certificates, keys, and secrets. Cannot manage key vault resources or manage role assignments. Only works for key vaults that use the 'Azure role-based access control' permission model.", permissions: { actions: ["Microsoft.Authorization/*/read", "Microsoft.Resources/subscriptions/resourceGroups/read", "Microsoft.KeyVault/vaults/*/read"], notActions: NONE, dataActions: ["Microsoft.KeyVault/vaults/*"], notDataActions: NONE } },
} satisfies Record<string, DemoAzureRole>;

/** The roles with a policy on every management group, subscription, resource group and resource */
export const AZURE_PRIVILEGED_ROLES: DemoAzureRole[] = [AZURE_ROLES.owner, AZURE_ROLES.contributor, AZURE_ROLES.userAccessAdministrator, AZURE_ROLES.rbacAdministrator];

const user = (u: DemoUser): DemoAzurePrincipal => ({ id: u.id, displayName: u.displayName, type: "User", email: u.mail ?? u.userPrincipalName, userPrincipalName: u.userPrincipalName });
const group = (g: DemoGroup): DemoAzurePrincipal => ({ id: g.id, displayName: g.displayName, type: "Group" });
const servicePrincipal = (sp: DemoServicePrincipal): DemoAzurePrincipal => ({ id: sp.id, displayName: sp.displayName, type: "ServicePrincipal" });
const agent = (sp: DemoServicePrincipal): DemoAzurePrincipal => ({ id: sp.id, displayName: sp.displayName, type: "AgentIdentity" });

/**
 * A user deleted from Entra ID who still holds a role: ARM keeps the type and the name for a while (measured
 * 2026-10-29), the fake Graph has no such user, so the app shows Deleted
 */
export const DELETED_AZURE_PRINCIPAL: DemoAzurePrincipal = { id: demoGuid("user:deleted:BrianJ"), displayName: "Brian Johnson", type: "User", email: "BrianJ@contoso.com", userPrincipalName: "BrianJ@contoso.com" };

// ---------------------------------------------------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------------------------------------------------

const PRODUCTION_ID = demoGuid("azure:sub:production");
const TEST_ID = demoGuid("azure:sub:test");
const LABS_ID = demoGuid("azure:sub:labs");
const CORP_APPS_ID = demoGuid("azure:sub:corpapps");
const FABRIKAM_PROD_ID = demoGuid("azure:sub:fabrikam-prod");
/** The tenant of the delegated (Lighthouse) subscription */
export const FABRIKAM_TENANT_ID = demoGuid("tenant:fabrikam");
const PRODUCTION = `/subscriptions/${PRODUCTION_ID}`;
const TEST = `/subscriptions/${TEST_ID}`;
const LABS = `/subscriptions/${LABS_ID}`;
const CORP_APPS = `/subscriptions/${CORP_APPS_ID}`;
const FABRIKAM_PROD = `/subscriptions/${FABRIKAM_PROD_ID}`;

export const AZURE_SCOPE_IDS = {
    root: "/",
    // The Tenant Root Group carries the tenant id as its name
    tenantRootGroup: `/providers/Microsoft.Management/managementGroups/${CONTOSO_TENANT_ID}`,
    platform: "/providers/Microsoft.Management/managementGroups/contoso-platform",
    landingZones: "/providers/Microsoft.Management/managementGroups/contoso-landingzones",
    corp: "/providers/Microsoft.Management/managementGroups/contoso-corp",
    production: PRODUCTION,
    test: TEST,
    rgWeb: `${PRODUCTION}/resourceGroups/rg-web`,
    rgData: `${PRODUCTION}/resourceGroups/rg-data`,
    rgSandbox: `${TEST}/resourceGroups/rg-sandbox`,
    storage: `${PRODUCTION}/resourceGroups/rg-data/providers/Microsoft.Storage/storageAccounts/stcontosodata`,
    keyVault: `${PRODUCTION}/resourceGroups/rg-web/providers/Microsoft.KeyVault/vaults/kv-contoso-web`,
    appService: `${PRODUCTION}/resourceGroups/rg-web/providers/Microsoft.Web/sites/app-contoso-api`,
    // A type without its own icon in resource-icons.json: shows the generic resource icon
    eventHub: `${PRODUCTION}/resourceGroups/rg-web/providers/Microsoft.EventHub/namespaces/evh-contoso-events`,
    // Contoso Labs: the demo account reads only rg-labs and one virtual machine in rg-shared; rg-private stays hidden
    labs: LABS,
    rgLabs: `${LABS}/resourceGroups/rg-labs`,
    rgShared: `${LABS}/resourceGroups/rg-shared`,
    rgPrivate: `${LABS}/resourceGroups/rg-private`,
    labsVm: `${LABS}/resourceGroups/rg-shared/providers/Microsoft.Compute/virtualMachines/vm-labs-build`,
    labsVault: `${LABS}/resourceGroups/rg-labs/providers/Microsoft.KeyVault/vaults/kv-contoso-labs`,
    // Contoso Corp Apps: under the Corp management group, two levels below the Tenant Root Group
    corpApps: CORP_APPS,
    rgCorpApps: `${CORP_APPS}/resourceGroups/rg-corp-apps`,
    aksCorp: `${CORP_APPS}/resourceGroups/rg-corp-apps/providers/Microsoft.ContainerService/managedClusters/aks-contoso-corp`,
    // Fabrikam Production: delegated by another tenant (Azure Lighthouse), not in the Contoso tree
    fabrikamProd: FABRIKAM_PROD,
    rgFabrikamWeb: `${FABRIKAM_PROD}/resourceGroups/rg-fabrikam-web`,
} as const;

/** Custom roles of the demo; the built-in ones are in `AZURE_ROLES` */
export const AZURE_CUSTOM_ROLES = {
    contosoWebOperator: { id: "6c2f0a3e-5b1d-4c8e-9a47-0d3b1e2f7a91", displayName: "Contoso Web Operator", description: "Restart and read the Contoso web apps in rg-web.", custom: { assignableScopes: [AZURE_SCOPE_IDS.rgWeb] }, permissions: { actions: ["Microsoft.Web/sites/read", "Microsoft.Web/sites/restart/action"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
    contosoPlatformOperator: { id: "3f8d2b6c-9e41-4a7d-b5c2-8e1f0a9d4c37", displayName: "Contoso Platform Operator", description: "Full control of the Contoso platform management group, including role assignments.", custom: { assignableScopes: [AZURE_SCOPE_IDS.platform] }, permissions: { actions: ["*"], notActions: NONE, dataActions: NONE, notDataActions: NONE } },
} satisfies Record<string, DemoAzureRole>;

const S = AZURE_SCOPE_IDS;

const SCOPES: DemoAzureScope[] = [
    // The display name of the root scope `/` was anonymised in the fixtures; "Root" is the demo's choice
    { id: S.root, displayName: "Root", level: "tenant", parentId: null },
    { id: S.tenantRootGroup, displayName: "Tenant Root Group", level: "managementgroup", parentId: S.root },
    { id: S.platform, displayName: "Contoso Platform", level: "managementgroup", parentId: S.tenantRootGroup },
    { id: S.production, displayName: "Contoso Production", level: "subscription", parentId: S.platform },
    { id: S.test, displayName: "Contoso Test", level: "subscription", parentId: S.platform },
    { id: S.rgWeb, displayName: "rg-web", level: "resourcegroup", parentId: S.production },
    { id: S.rgData, displayName: "rg-data", level: "resourcegroup", parentId: S.production },
    { id: S.rgSandbox, displayName: "rg-sandbox", level: "resourcegroup", parentId: S.test },
    { id: S.storage, displayName: "stcontosodata", level: "resource", parentId: S.rgData },
    { id: S.keyVault, displayName: "kv-contoso-web", level: "resource", parentId: S.rgWeb },
    { id: S.appService, displayName: "app-contoso-api", level: "resource", parentId: S.rgWeb },
    { id: S.eventHub, displayName: "evh-contoso-events", level: "resource", parentId: S.rgWeb },
    { id: S.labs, displayName: "Contoso Labs", level: "subscription", parentId: S.platform },
    { id: S.rgLabs, displayName: "rg-labs", level: "resourcegroup", parentId: S.labs },
    { id: S.rgShared, displayName: "rg-shared", level: "resourcegroup", parentId: S.labs },
    { id: S.rgPrivate, displayName: "rg-private", level: "resourcegroup", parentId: S.labs },
    { id: S.labsVm, displayName: "vm-labs-build", level: "resource", parentId: S.rgShared },
    { id: S.labsVault, displayName: "kv-contoso-labs", level: "resource", parentId: S.rgLabs },
    { id: S.landingZones, displayName: "Contoso Landing Zones", level: "managementgroup", parentId: S.tenantRootGroup },
    { id: S.corp, displayName: "Corp", level: "managementgroup", parentId: S.landingZones },
    { id: S.corpApps, displayName: "Contoso Corp Apps", level: "subscription", parentId: S.corp },
    { id: S.rgCorpApps, displayName: "rg-corp-apps", level: "resourcegroup", parentId: S.corpApps },
    { id: S.aksCorp, displayName: "aks-contoso-corp", level: "resource", parentId: S.rgCorpApps },
    { id: S.fabrikamProd, displayName: "Fabrikam Production", level: "subscription", parentId: null },
    { id: S.rgFabrikamWeb, displayName: "rg-fabrikam-web", level: "resourcegroup", parentId: S.fabrikamProd },
];

const SUBSCRIPTIONS: DemoAzureSubscription[] = [
    { subscriptionId: PRODUCTION_ID, displayName: "Contoso Production", state: "Enabled" },
    { subscriptionId: TEST_ID, displayName: "Contoso Test", state: "Enabled" },
    { subscriptionId: LABS_ID, displayName: "Contoso Labs", state: "Enabled", readableScopes: [S.rgLabs, S.labsVm] },
    { subscriptionId: CORP_APPS_ID, displayName: "Contoso Corp Apps", state: "Enabled" },
    { subscriptionId: FABRIKAM_PROD_ID, displayName: "Fabrikam Production", state: "Enabled", tenantId: FABRIKAM_TENANT_ID },
];

// ---------------------------------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------------------------------

/** The settings of a role nobody changed, as the fixtures of a fresh subscription and management group show them */
const DEFAULT_SETTINGS: DemoAzurePolicySettings = {
    activationMaxDuration: "PT8H",
    requireMfa: false,
    requireJustification: true,
    approvers: [],
    eligibleMaxDuration: "P365D",
    activeMaxDuration: "P180D",
};

const SECURITY_LEADS: DemoAzurePolicyAssignee = { id: GROUPS.securityLeads.id, description: GROUPS.securityLeads.displayName, userType: "Group" };

/** Changed settings, so the same role reads differently per scope (settings are not inherited) */
const CHANGED: Array<{ scope: string; role: DemoAzureRole; settings: Partial<DemoAzurePolicySettings>; daysAgo: number }> = [
    // The board's role panel: Owner on production, 8 hours, MFA and a reason, no approval, eligible for 12 months
    { scope: S.production, role: AZURE_ROLES.owner, settings: { requireMfa: true }, daysAgo: 21 },
    { scope: S.platform, role: AZURE_ROLES.owner, settings: { activationMaxDuration: "PT4H", requireMfa: true, approvers: [SECURITY_LEADS] }, daysAgo: 45 },
    { scope: S.tenantRootGroup, role: AZURE_ROLES.userAccessAdministrator, settings: { activationMaxDuration: "PT2H", requireMfa: true, approvers: [SECURITY_LEADS], eligibleMaxDuration: "P90D" }, daysAgo: 60 },
    { scope: S.production, role: AZURE_ROLES.contributor, settings: { activationMaxDuration: "PT4H", requireMfa: true }, daysAgo: 21 },
    { scope: S.corpApps, role: AZURE_ROLES.owner, settings: { requireMfa: true, approvers: [SECURITY_LEADS] }, daysAgo: 10 },
    { scope: S.fabrikamProd, role: AZURE_ROLES.contributor, settings: { activationMaxDuration: "PT12H" }, daysAgo: 5 },
];

const POLICY_SCOPES = [S.tenantRootGroup, S.platform, S.production, S.test, S.rgWeb, S.rgData, S.rgSandbox, S.storage, S.keyVault, S.appService, S.eventHub, S.labs, S.rgLabs, S.rgShared, S.rgPrivate, S.labsVm, S.labsVault, S.landingZones, S.corp, S.corpApps, S.rgCorpApps, S.aksCorp, S.fabrikamProd, S.rgFabrikamWeb];

// ---------------------------------------------------------------------------------------------------------------------
// The data, dated from now
// ---------------------------------------------------------------------------------------------------------------------

export function buildContosoAzure(now: Date = new Date()): DemoAzure {
    const at = (days: number, hours = 0) => new Date(now.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();
    const P = PEOPLE;
    const R = AZURE_ROLES;
    const CUSTOM = AZURE_CUSTOM_ROLES;

    const active = (key: string, principal: DemoAzurePrincipal, role: DemoAzureRole, scope: string, from: string, until: string | null, extra: Partial<DemoAzureInstance> = {}): DemoAzureInstance =>
        ({ key, kind: "active", principal, role, scope, startDateTime: from, endDateTime: until, createdOn: from, assignmentType: "Assigned", ...extra });
    const eligible = (key: string, principal: DemoAzurePrincipal, role: DemoAzureRole, scope: string, from: string, until: string | null): DemoAzureInstance =>
        ({ key, kind: "eligible", principal, role, scope, startDateTime: from, endDateTime: until, createdOn: from });

    const instances: DemoAzureInstance[] = [
        // Standing access, at every level of the tree
        active("a:root-uaa", user(P.modAdmin), R.userAccessAdministrator, S.root, at(-700), null),
        active("a:trg-reader-sentinel", servicePrincipal(SERVICE_PRINCIPALS.sentinel), R.reader, S.tenantRootGroup, at(-320), null),
        active("a:prod-contributor-platform", group(GROUPS.platform), R.contributor, S.production, at(-400), null),
        active("a:test-owner-platform", group(GROUPS.platform), R.owner, S.test, at(-400), null),
        active("a:rgweb-contributor-deploy", servicePrincipal(SERVICE_PRINCIPALS.deploy), R.contributor, S.rgWeb, at(-150), null),
        // Time-bound, on resources
        active("a:storage-blobreader-henrietta", user(P.henrietta), R.storageBlobDataReader, S.storage, at(-5), at(30)),
        active("a:kv-admin-alex", user(P.alex), R.keyVaultAdministrator, S.keyVault, at(-10), at(90)),
        active("a:evh-reader-lidia", user(P.lidia), R.reader, S.eventHub, at(-2), at(14)),
        // Activated from Johanna's eligibility, ends today
        active("a:prod-owner-johanna", user(P.johanna), R.owner, S.production, at(0, -1), at(0, 7), { assignmentType: "Activated", linkedEligibilityKey: "e:prod-owner-johanna" }),

        eligible("e:prod-owner-johanna", user(P.johanna), R.owner, S.production, at(-60), at(305)),
        eligible("e:platform-owner-azureowners", group(GROUPS.azureOwners), R.owner, S.platform, at(-30), at(150)),
        eligible("e:rgdata-contributor-alex", user(P.alex), R.contributor, S.rgData, at(-20), at(70)),
        eligible("e:test-contributor-lidia", user(P.lidia), R.contributor, S.test, at(-3), at(27)),
        eligible("e:sandbox-contributor-henrietta", user(P.henrietta), R.contributor, S.rgSandbox, at(-14), at(46)),
        eligible("e:appservice-contributor-grady", user(P.grady), R.contributor, S.appService, at(-7), at(83)),
        // A custom role assignable only at rg-web: the eligibility instance list at the subscription leaves it out (measured 2026-10-22)
        eligible("e:rgweb-weboperator-grady", user(P.grady), CUSTOM.contosoWebOperator, S.rgWeb, at(-6), at(84)),

        // Contoso Labs, read below its own level: the demo account's own roles, one item on the subscription that is
        // inherited onto what it reads, and one in rg-private that it cannot see
        active("a:rglabs-reader-alex", user(P.alex), R.reader, S.rgLabs, at(-90), null),
        active("a:labsvm-reader-alex", user(P.alex), R.reader, S.labsVm, at(-4), at(26)),
        active("a:labs-owner-platform", group(GROUPS.platform), R.owner, S.labs, at(-200), null),
        eligible("e:rglabs-contributor-henrietta", user(P.henrietta), R.contributor, S.rgLabs, at(-9), at(81)),
        active("a:labsvault-admin-grady", user(P.grady), R.keyVaultAdministrator, S.labsVault, at(-1), at(6)),
        active("a:rgprivate-contributor-deploy", servicePrincipal(SERVICE_PRINCIPALS.deploy), R.contributor, S.rgPrivate, at(-30), null),

        // The Azure dashboard: a break-glass account, a deeper tree, a managed identity, an agent and a delegated subscription
        active("a:trg-owner-bg01", user(P.breakGlass1), R.owner, S.tenantRootGroup, at(-500), null),
        eligible("e:landingzones-owner-azureowners", group(GROUPS.azureOwners), R.owner, S.landingZones, at(-40), at(140)),
        eligible("e:platform-operator-johanna", user(P.johanna), CUSTOM.contosoPlatformOperator, S.platform, at(-12), at(168)),
        active("a:corpapps-owner-deploy", servicePrincipal(SERVICE_PRINCIPALS.deploy), R.owner, S.corpApps, at(-90), null),
        active("a:corpapps-contributor-mi", servicePrincipal(SERVICE_PRINCIPALS.aksIdentity), R.contributor, S.corpApps, at(-60), null),
        active("a:rgcorpapps-reader-opsagent", agent(SERVICE_PRINCIPALS.opsAgent), R.reader, S.rgCorpApps, at(-8), null),
        eligible("e:corpapps-contributor-kim", user(P.kim), R.contributor, S.corpApps, at(-15), at(75)),
        eligible("e:aks-contributor-henrietta", user(P.henrietta), R.contributor, S.aksCorp, at(-3), at(5)),
        active("a:fabrikam-contributor-lidia", user(P.lidia), R.contributor, S.fabrikamProd, at(-1), at(13)),
        eligible("e:fabrikam-owner-henrietta", user(P.henrietta), R.owner, S.fabrikamProd, at(-30), at(335)),
        active("a:rgfabrikamweb-reader-kim", user(P.kim), R.reader, S.rgFabrikamWeb, at(-20), null),
        eligible("e:corp-contributor-isaiah", user(P.isaiah), R.contributor, S.corp, at(-25), at(155)),
        active("a:rgdata-reader-deleted", DELETED_AZURE_PRINCIPAL, R.reader, S.rgData, at(-210), null),
    ];

    const policies: DemoAzurePolicy[] = [
        ...POLICY_SCOPES.flatMap((scope) =>
            AZURE_PRIVILEGED_ROLES.map((role) => {
                const change = CHANGED.find((c) => c.scope === scope && c.role.id === role.id);
                return {
                    scope,
                    role,
                    settings: { ...DEFAULT_SETTINGS, ...change?.settings },
                    lastModified: change ? { at: at(-change.daysAgo), by: user(P.alex) } : null,
                };
            }),
        ),
        { scope: S.rgWeb, role: CUSTOM.contosoWebOperator, settings: DEFAULT_SETTINGS, lastModified: null },
        { scope: S.platform, role: CUSTOM.contosoPlatformOperator, settings: DEFAULT_SETTINGS, lastModified: null },
    ];

    // Contoso Labs has no entry: the demo account has no role on the subscription itself
    const alerts: DemoAzureAlertState[] = [
        { subscriptionId: PRODUCTION_ID, lastScannedDateTime: at(-1), incidents: { TooManyPermanentOwnersAssignedToResource: 2 } },
        { subscriptionId: TEST_ID, lastScannedDateTime: at(-1), incidents: { AzureRolesAssignedOutsidePimAlert: 1 } },
        { subscriptionId: CORP_APPS_ID, lastScannedDateTime: at(-2), incidents: {} },
        { subscriptionId: FABRIKAM_PROD_ID, lastScannedDateTime: null, incidents: {} },
    ];

    return { tenantId: CONTOSO_TENANT_ID, scopes: SCOPES, subscriptions: SUBSCRIPTIONS, instances, policies, alerts };
}
