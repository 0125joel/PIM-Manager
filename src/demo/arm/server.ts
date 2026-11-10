import { AZURE_ALERT_DEFINITIONS } from "@/demo/contoso/azureAlerts";
import { AZURE_CUSTOM_ROLES, AZURE_ROLES, type DemoAzure, type DemoAzureAlertState, type DemoAzureInstance, type DemoAzureRole, type DemoAzurePolicy, type DemoAzureScope } from "@/demo/contoso/azure";
import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { demoGuid } from "@/demo/contoso/ids";
import { DEMO_WRITE_ERROR_CODE, DEMO_WRITE_MESSAGE } from "@/demo/graph/server";

/**
 * An Azure Resource Manager that lives in the browser and answers from the demo's Contoso Azure tree. It serves the
 * reads of the Azure Report (implementation spec sections 4 and 15) by path and api-version, in the shape ARM returns them (the
 * spike fixtures in `docs/Assets/azure/spike-fixtures/`), so the demo runs the app's real ARM client and services.
 * It also serves the reads of the Azure dashboard (`docs/Assets/azure/dashboard/implementation-spec.md` section 3.2):
 * role definition lists with their actions and the PIM alerts per subscription.
 * Every write is refused with 403 `DemoEnvironment`. An unknown read, or a known path with another api-version or
 * filter, answers 404 and is reported through `onUnhandled`, so `src/__tests__/demo/fakeArm.test.ts` fails on a new
 * ARM call until this serves it too.
 */

export interface ArmRequest {
    method: string;
    /** Absolute: `https://management.azure.com/...?api-version=...` */
    url: string;
    body?: unknown;
}

export interface ArmResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}

export interface FakeArm {
    handle(request: ArmRequest): ArmResponse;
}

export interface FakeArmOptions {
    onUnhandled?: (request: ArmRequest) => void;
}

/** The api-versions of facts.md section 2 that the app sends */
export const ARM_API_VERSIONS = {
    subscriptions: "2022-12-01",
    authorization: "2020-10-01",
    resources: "2021-04-01",
    roleDefinitions: "2022-04-01",
    alerts: "2022-08-01-preview",
    managementGroups: "2020-05-01",
} as const;

type Item = Record<string, unknown>;

class ArmHttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

class Unhandled extends Error {}

const json = (status: number, body: unknown): ArmResponse => ({ status, headers: { "content-type": "application/json" }, body });
const list = (value: unknown[]): ArmResponse => json(200, { value });

const PROVIDER = "/providers/Microsoft.Authorization";
const GET_ENTITIES_PATH = "/providers/Microsoft.Management/getEntities";
const INSTANCE_LISTS = {
    roleAssignmentScheduleInstances: "active",
    roleEligibilityScheduleInstances: "eligible",
    roleEligibilitySchedules: "eligible",
} as const;

type InstanceListName = keyof typeof INSTANCE_LISTS;

/** Stable GUIDs for the names ARM gives (instances, schedules, policies); the `azure:` seed keeps them apart from Entra ids */
const demoArmGuid = (seed: string) => demoGuid(`azure:${seed}`);

/** A scope written as ARM writes it inside ids: the root `/` adds nothing in front of `/providers/...` */
const prefix = (scope: string) => (scope === "/" ? "" : scope);

/** The scope part of a path in front of `/providers/Microsoft.Authorization/...`, `/` for the root */
function splitAuthorizationPath(path: string): { scope: string; resource: string } | null {
    const at = path.toLowerCase().lastIndexOf(`${PROVIDER.toLowerCase()}/`);
    if (at < 0) return null;
    const resource = path.slice(at + PROVIDER.length + 1);
    if (resource.includes("/")) return null;
    return { scope: path.slice(0, at) || "/", resource };
}

export function createFakeArm(azure: DemoAzure, options: FakeArmOptions = {}): FakeArm {
    const scopesById = new Map(azure.scopes.map((s) => [s.id.toLowerCase(), s]));
    const findScope = (id: string): DemoAzureScope | undefined => scopesById.get(id.toLowerCase());

    /** The scope and every scope above it, up to the root */
    const ancestry = (scope: DemoAzureScope): string[] => {
        const chain: string[] = [];
        for (let s: DemoAzureScope | undefined = scope; s; s = s.parentId ? findScope(s.parentId) : undefined) chain.push(s.id.toLowerCase());
        return chain;
    };
    const isAtOrBelow = (itemScope: string, scope: string) => {
        const item = itemScope.toLowerCase();
        const at = scope.toLowerCase();
        return at === "/" || item === at || item.startsWith(`${at}/`);
    };
    const subscriptionOf = (scope: string): string | null => scope.match(/^\/subscriptions\/([^/]+)/i)?.[1] ?? null;

    /**
     * A scope in a subscription the demo account reads only below its own level (`readableScopes`): readable when it is
     * at or below one of those scopes. Every other scope is readable.
     */
    const readableScopesOf = (scope: string): string[] | null => {
        const id = subscriptionOf(scope);
        return azure.subscriptions.find((s) => id !== null && s.subscriptionId.toLowerCase() === id.toLowerCase())?.readableScopes ?? null;
    };
    const isReadable = (scope: string): boolean => {
        const readable = readableScopesOf(scope);
        return readable === null || readable.some((r) => isAtOrBelow(scope, r));
    };

    /**
     * Seen from a subscription, ARM qualifies the role definition id with that subscription, also for an item inherited
     * from above (fixture `subscription-roleAssignmentScheduleInstances-nofilter.json`). Above a subscription the
     * unqualified form is used; that form was not captured.
     */
    const roleDefinitionId = (roleId: string, queryScope: string) => {
        const subscription = subscriptionOf(queryScope);
        return `${subscription ? `/subscriptions/${subscription}` : ""}${PROVIDER}/roleDefinitions/${roleId}`;
    };

    const expandedScope = (id: string) => {
        const scope = findScope(id);
        return { displayName: scope?.displayName ?? id, id: scope?.id ?? id, type: scope?.level ?? "tenant" };
    };

    const scopeOfInstance = (key: string) => azure.instances.find((i) => i.key === key)?.scope ?? "/";

    /**
     * One item of an instance list, or of the eligibility schedule list: a schedule is named by the schedule GUID, has a
     * `roleEligibilityScheduleRequestId` instead of a `roleEligibilityScheduleId` (measured 2026-10-22)
     */
    const instanceItem = (instance: DemoAzureInstance, queryScope: string, inherited: boolean, listName: InstanceListName): Item => {
        const isSchedule = listName === "roleEligibilitySchedules";
        const name = demoArmGuid(`${isSchedule ? "schedule" : "instance"}:${instance.key}`);
        const at = `${prefix(instance.scope)}${PROVIDER}`;
        const roleId = roleDefinitionId(instance.role.id, queryScope);
        const { principal } = instance;
        const properties: Item = {
            ...(instance.kind === "active" ? { assignmentType: instance.assignmentType } : {}),
            createdOn: instance.createdOn,
            ...(instance.endDateTime ? { endDateTime: instance.endDateTime } : {}),
            expandedProperties: {
                principal: {
                    displayName: principal.displayName,
                    ...(principal.email ? { email: principal.email } : {}),
                    id: principal.id,
                    type: principal.type,
                    ...(principal.userPrincipalName ? { userPrincipalName: principal.userPrincipalName } : {}),
                },
                roleDefinition: { displayName: instance.role.displayName, id: roleId, type: instance.role.custom ? "CustomRole" : "BuiltInRole" },
                scope: expandedScope(instance.scope),
            },
            ...(instance.linkedEligibilityKey
                ? { linkedRoleEligibilityScheduleId: `${prefix(scopeOfInstance(instance.linkedEligibilityKey))}${PROVIDER}/roleEligibilitySchedules/${demoArmGuid(`schedule:${instance.linkedEligibilityKey}`)}` }
                : {}),
            memberType: inherited ? "Inherited" : "Direct",
            ...(instance.kind === "active" ? { originRoleAssignmentId: `${at}/roleAssignments/${name}` } : {}),
            principalId: principal.id,
            principalType: principal.type,
            ...(instance.kind === "active"
                ? { roleAssignmentScheduleId: `${at}/roleAssignmentSchedules/${demoArmGuid(`schedule:${instance.key}`)}` }
                : isSchedule
                    ? { roleEligibilityScheduleRequestId: `${at}/roleEligibilityScheduleRequests/${demoArmGuid(`request:${instance.key}`)}` }
                    : { roleEligibilityScheduleId: `${at}/roleEligibilitySchedules/${demoArmGuid(`schedule:${instance.key}`)}` }),
            roleDefinitionId: roleId,
            scope: instance.scope,
            startDateTime: instance.startDateTime,
            status: "Provisioned",
        };
        return { id: `${at}/${listName}/${name}`, name, properties, type: `Microsoft.Authorization/${listName}` };
    };

    /**
     * An unfiltered list at a scope: the items at it, below it and inherited from above (spike S4). `asTarget()`: the
     * same, limited to the signed-in user's own items; at the root that is every one of them (spec 8).
     */
    const instanceList = (listName: InstanceListName, scope: DemoAzureScope, filter: string | null): ArmResponse => {
        const kind = INSTANCE_LISTS[listName];
        if (filter !== null && filter !== "asTarget()") throw new Unhandled();
        // The words ARM gives at a subscription the user holds a role below but not on (tenant test T4)
        if (filter === null && !isReadable(scope.id)) {
            throw new ArmHttpError(400, "InsufficientPermissions", "The user does not have permissions for this request. Please use $filter=asTarget() to see the role assignments on which the user is a principal.");
        }
        const above = new Set(ancestry(scope).slice(1));
        const items = azure.instances
            .filter((i) => i.kind === kind)
            .filter((i) => filter === null || i.principal.id === DEMO_ACCOUNT.id)
            // The eligibility instance list leaves out a custom role not assignable at the listed scope; the schedules do not (measured 2026-10-22)
            .filter((i) => listName !== "roleEligibilityScheduleInstances" || !i.role.custom || i.role.custom.assignableScopes.some((a) => isAtOrBelow(scope.id, a)))
            .flatMap((i) => {
                if (isAtOrBelow(i.scope, scope.id)) return [instanceItem(i, scope.id, false, listName)];
                if (above.has(i.scope.toLowerCase())) return [instanceItem(i, scope.id, true, listName)];
                return [];
            });
        return list(items);
    };

    const policyRules = (policy: DemoAzurePolicy): Item[] => {
        const { settings } = policy;
        const target = (caller: "Admin" | "EndUser", level: "Eligibility" | "Assignment") => ({ caller, enforcedSettings: [], inheritableSettings: [], level, operations: ["All"], targetObjects: [] });
        const notifications = (caller: "Admin" | "EndUser", level: "Eligibility" | "Assignment") =>
            (["Admin", "Requestor", "Approver"] as const).map((recipientType) => ({
                id: `Notification_${recipientType}_${caller}_${level}`,
                isDefaultRecipientsEnabled: true,
                notificationLevel: "All",
                notificationType: "Email",
                recipientType,
                ruleType: "RoleManagementPolicyNotificationRule",
                target: target(caller, level),
            }));
        const activationRules = [settings.requireMfa && "MultiFactorAuthentication", settings.requireJustification && "Justification"].filter((r): r is string => Boolean(r));
        const approvalRequired = settings.approvers.length > 0;
        return [
            { id: "Expiration_Admin_Eligibility", isExpirationRequired: true, maximumDuration: settings.eligibleMaxDuration, ruleType: "RoleManagementPolicyExpirationRule", target: target("Admin", "Eligibility") },
            { enabledRules: [], id: "Enablement_Admin_Eligibility", ruleType: "RoleManagementPolicyEnablementRule", target: target("Admin", "Eligibility") },
            ...notifications("Admin", "Eligibility"),
            { id: "Expiration_Admin_Assignment", isExpirationRequired: true, maximumDuration: settings.activeMaxDuration, ruleType: "RoleManagementPolicyExpirationRule", target: target("Admin", "Assignment") },
            { enabledRules: ["Justification"], id: "Enablement_Admin_Assignment", ruleType: "RoleManagementPolicyEnablementRule", target: target("Admin", "Assignment") },
            ...notifications("Admin", "Assignment"),
            { id: "Expiration_EndUser_Assignment", isExpirationRequired: true, maximumDuration: settings.activationMaxDuration, ruleType: "RoleManagementPolicyExpirationRule", target: target("EndUser", "Assignment") },
            {
                id: "Approval_EndUser_Assignment",
                ruleType: "RoleManagementPolicyApprovalRule",
                setting: {
                    approvalMode: "SingleStage",
                    approvalStages: [{
                        approvalStageTimeOutInDays: 1,
                        escalationTimeInMinutes: 0,
                        isApproverJustificationRequired: true,
                        isEscalationEnabled: false,
                        ...(approvalRequired ? { primaryApprovers: settings.approvers.map((a) => ({ id: a.id, description: a.description, isBackup: false, userType: a.userType })) } : {}),
                    }],
                    isApprovalRequired: approvalRequired,
                    isApprovalRequiredForExtension: false,
                    isRequestorJustificationRequired: true,
                },
                target: target("EndUser", "Assignment"),
            },
            { enabledRules: activationRules, id: "Enablement_EndUser_Assignment", ruleType: "RoleManagementPolicyEnablementRule", target: target("EndUser", "Assignment") },
            { id: "AuthenticationContext_EndUser_Assignment", isEnabled: false, ruleType: "RoleManagementPolicyAuthenticationContextRule", target: target("EndUser", "Assignment") },
            ...notifications("EndUser", "Assignment"),
        ];
    };

    const policyItem = (policy: DemoAzurePolicy): Item => {
        const name = demoArmGuid(`policy:${policy.scope}:${policy.role.id}`);
        const rules = policyRules(policy);
        const by = policy.lastModified?.by;
        return {
            id: `${prefix(policy.scope)}${PROVIDER}/roleManagementPolicies/${name}`,
            name,
            properties: {
                effectiveRules: rules,
                isOrganizationDefault: false,
                lastModifiedBy: by ? { displayName: by.displayName, email: by.email ?? null, id: by.id, type: by.type } : {},
                ...(policy.lastModified ? { lastModifiedDateTime: policy.lastModified.at } : {}),
                policyProperties: { scope: expandedScope(policy.scope) },
                rules,
                scope: policy.scope,
            },
            type: "Microsoft.Authorization/roleManagementPolicies",
        };
    };

    /**
     * One role's policy: `$filter=roleDefinitionId eq '{scope}/providers/Microsoft.Authorization/roleDefinitions/{id}'`
     * (Learn REST sample, measured). A role without a policy at the scope answers 400 `ResourceNotFound` (measured).
     */
    const policyList = (scope: DemoAzureScope, filter: string | null): ArmResponse => {
        const role = filter?.match(/^roleDefinitionId eq '[^']*\/providers\/Microsoft\.Authorization\/roleDefinitions\/([^/']+)'$/i)?.[1];
        if (!role) throw new Unhandled();
        const policy = azure.policies.find((p) => p.scope.toLowerCase() === scope.id.toLowerCase() && p.role.id.toLowerCase() === role.toLowerCase());
        if (!policy) throw new ArmHttpError(400, "ResourceNotFound", `The role management policy for role definition '${role}' could not be found at scope '${scope.id}'.`);
        return list([policyItem(policy)]);
    };

    const subscriptionItem = (s: DemoAzure["subscriptions"][number]): Item => ({
        authorizationSource: "RoleBased",
        displayName: s.displayName,
        id: `/subscriptions/${s.subscriptionId}`,
        managedByTenants: [],
        state: s.state,
        subscriptionId: s.subscriptionId,
        // The values of the Learn sample (Subscriptions - List, 2022-12-01); the app does not read them
        subscriptionPolicies: { locationPlacementId: "Internal_2014-09-01", quotaId: "Internal_2014-09-01", spendingLimit: "Off" },
        tags: {},
        tenantId: s.tenantId ?? azure.tenantId,
    });

    /**
     * `GET /subscriptions/{id}/resourcegroups` and `/resources` (Learn, `2021-04-01`): what the demo account can read,
     * so below a subscription read only below its own level just its own scopes and what is under them (tenant test T4).
     */
    const resourceList = (subscriptionId: string, kind: "resourcegroups" | "resources"): ArmResponse => {
        const subscription = `/subscriptions/${subscriptionId}`.toLowerCase();
        const level = kind === "resourcegroups" ? "resourcegroup" : "resource";
        const items = azure.scopes
            .filter((s) => s.level === level && s.id.toLowerCase().startsWith(`${subscription}/`) && isReadable(s.id))
            .map((s) => {
                const segs = s.id.split("/").filter((x) => x !== "");
                const type = level === "resourcegroup" ? "Microsoft.Resources/resourceGroups" : `${segs[5]}/${segs[6]}`;
                return { id: s.id, location: "westeurope", name: segs[segs.length - 1], type };
            });
        return list(items);
    };

    /** One role definition in the shape of the Learn example, with its id written at the scope it is read at */
    const roleDefinitionItem = (scope: string, role: DemoAzureRole): Item => ({
        id: `${prefix(scope)}${PROVIDER}/roleDefinitions/${role.id}`,
        name: role.id,
        properties: { assignableScopes: role.custom?.assignableScopes ?? ["/"], description: role.description, permissions: [role.permissions], roleName: role.displayName, type: role.custom ? "CustomRole" : "BuiltInRole" },
        type: "Microsoft.Authorization/roleDefinitions",
    });

    /**
     * One role definition by GUID at a scope (Learn, Role Definitions - Get, `2022-04-01`), in the shape of the Learn
     * example. Built-in roles answer at any known scope with assignable scope `/`; the custom role answers with its own
     * assignable scopes (Get works at any scope, measured 2026-10-22). An unknown role answers 404
     * `RoleDefinitionDoesNotExist`.
     */
    const roleDefinition = (scope: string, roleId: string): ArmResponse => {
        const roles: DemoAzureRole[] = [...Object.values(AZURE_ROLES), ...Object.values(AZURE_CUSTOM_ROLES)];
        const role = roles.find((r) => r.id.toLowerCase() === roleId.toLowerCase());
        if (!role) throw new ArmHttpError(404, "RoleDefinitionDoesNotExist", "The specified role definition does not exist.");
        return json(200, roleDefinitionItem(scope, role));
    };

    /** The role definitions of one type, listed at the root or at a subscription (Learn, Role Definitions - List, `2022-04-01`) */
    const roleDefinitionList = (scope: string, filter: string | null): ArmResponse => {
        if (filter !== "type eq 'BuiltInRole'" && filter !== "type eq 'CustomRole'") throw new Unhandled();
        if (scope !== "/" && !azure.subscriptions.some((s) => `/subscriptions/${s.subscriptionId}`.toLowerCase() === scope.toLowerCase())) throw new Unhandled();
        if (filter === "type eq 'BuiltInRole'") return list(Object.values(AZURE_ROLES).map((role) => roleDefinitionItem(scope, role)));
        // A custom role assignable at, above or below the subscription is listed there (measured 2026-10-24: one assignable only at a resource group comes back in its subscription's list)
        const subscriptionScope = findScope(scope);
        const above = subscriptionScope ? ancestry(subscriptionScope) : [scope.toLowerCase()];
        const roles = Object.values<DemoAzureRole>(AZURE_CUSTOM_ROLES).filter((role) => scope === "/" || (role.custom?.assignableScopes ?? []).some((a) => isAtOrBelow(a, scope) || above.includes(a.toLowerCase())));
        return list(roles.map((role) => roleDefinitionItem(scope, role)));
    };

    /**
     * The PIM alerts of a subscription (`roleManagementAlerts`, `2022-08-01-preview`): four items, one per alert. Only a
     * subscription has them (measured 2026-10-24); one the demo account has no role on answers 403.
     */
    const alertList = (scope: DemoAzureScope, filter: string | null): ArmResponse => {
        if (filter !== null) throw new Unhandled();
        if (scope.level === "managementgroup" || scope.level === "resourcegroup") throw new ArmHttpError(400, "ResourceTypeNotSupportedForAlert", "The resource type is not supported for alerts.");
        if (scope.level !== "subscription") throw new Unhandled();
        const subscription = azure.subscriptions.find((s) => `/subscriptions/${s.subscriptionId}`.toLowerCase() === scope.id.toLowerCase());
        if (!subscription) throw new Unhandled();
        const id = subscription.subscriptionId;
        if (subscription.readableScopes) {
            throw new ArmHttpError(403, "AuthorizationFailed", `The client does not have authorization to perform action 'Microsoft.Authorization/roleManagementAlerts/read' over scope '/subscriptions/${id}'.`);
        }
        const state = azure.alerts.find((a) => a.subscriptionId.toLowerCase() === id.toLowerCase());
        const scanned = state?.lastScannedDateTime ?? "0001-01-01T00:00:00-08:00";
        const at = `/subscriptions/${id}`;
        return list(AZURE_ALERT_DEFINITIONS.map(({ name, configuration, definition }) => {
            const count = state?.incidents[name as keyof DemoAzureAlertState["incidents"]] ?? 0;
            return {
                id: `${at}${PROVIDER}/roleManagementAlerts/${name}`,
                name,
                properties: {
                    alertConfiguration: { id: `${at}${PROVIDER}/roleManagementAlertConfigurations/${name}`, name, properties: { ...configuration, scope: at }, type: "Microsoft.Authorization/roleManagementAlertConfigurations" },
                    alertDefinition: { id: `${at}${PROVIDER}/roleManagementAlertDefinitions/${name}`, name, properties: { ...definition, scope: at }, type: "Microsoft.Authorization/roleManagementAlertDefinitions" },
                    incidentCount: count,
                    isActive: count > 0,
                    lastModifiedDateTime: scanned,
                    lastScannedDateTime: scanned,
                    scope: at,
                },
                type: "Microsoft.Authorization/roleManagementAlerts",
            };
        }));
    };

    /**
     * `POST /providers/Microsoft.Management/getEntities` (Learn, Entities - List, `2020-05-01`): every management group
     * and subscription of the home tenant's hierarchy with its parent, in the shape of the spike fixture
     * `getEntities.json`. The delegated subscription (another tenant) is not in that hierarchy. The Tenant Root Group
     * has an empty `parent`.
     */
    const entityList = (): ArmResponse => {
        const delegated = new Set(azure.subscriptions.filter((s) => s.tenantId !== undefined && s.tenantId !== azure.tenantId).map((s) => `/subscriptions/${s.subscriptionId}`.toLowerCase()));
        const items = azure.scopes
            .filter((s) => (s.level === "managementgroup" || s.level === "subscription") && !delegated.has(s.id.toLowerCase()))
            .map((s) => {
                const isGroup = s.level === "managementgroup";
                const parent = s.parentId && findScope(s.parentId)?.level === "managementgroup" ? { id: s.parentId } : {};
                return {
                    id: s.id,
                    name: s.id.split("/").pop(),
                    properties: { displayName: s.displayName, parent, tenantId: azure.tenantId },
                    type: isGroup ? "Microsoft.Management/managementGroups" : "/subscriptions",
                };
            });
        return list(items);
    };

    const route = (path: string, params: URLSearchParams): ArmResponse => {
        const apiVersion = params.get("api-version");
        const filter = params.get("$filter");
        const definitions = path.match(/^(.*)\/providers\/Microsoft\.Authorization\/roleDefinitions$/i);
        if (definitions) {
            const scope = definitions[1] || "/";
            if (apiVersion !== ARM_API_VERSIONS.roleDefinitions) throw new Unhandled();
            return roleDefinitionList(scope, filter);
        }
        const definition = path.match(/^(.*)\/providers\/Microsoft\.Authorization\/roleDefinitions\/([^/]+)$/i);
        if (definition) {
            const scope = definition[1] || "/";
            if (apiVersion !== ARM_API_VERSIONS.roleDefinitions || filter !== null || !findScope(scope)) throw new Unhandled();
            return roleDefinition(scope, definition[2]);
        }
        if (path.toLowerCase() === "/subscriptions") {
            if (apiVersion !== ARM_API_VERSIONS.subscriptions || filter !== null) throw new Unhandled();
            return list(azure.subscriptions.map(subscriptionItem));
        }
        const resources = path.match(/^\/subscriptions\/([^/]+)\/(resourcegroups|resources)$/i);
        if (resources) {
            if (apiVersion !== ARM_API_VERSIONS.resources || filter !== null) throw new Unhandled();
            if (!azure.subscriptions.some((s) => s.subscriptionId.toLowerCase() === resources[1].toLowerCase())) throw new Unhandled();
            return resourceList(resources[1], resources[2].toLowerCase() as "resourcegroups" | "resources");
        }
        const target = splitAuthorizationPath(path);
        const scope = target && findScope(target.scope);
        if (target && scope && target.resource.toLowerCase() === "rolemanagementalerts" && apiVersion === ARM_API_VERSIONS.alerts) return alertList(scope, filter);
        if (!target || !scope || apiVersion !== ARM_API_VERSIONS.authorization) throw new Unhandled();
        const listName = (Object.keys(INSTANCE_LISTS) as InstanceListName[]).find((name) => name.toLowerCase() === target.resource.toLowerCase());
        if (listName) return instanceList(listName, scope, filter);
        if (target.resource.toLowerCase() === "rolemanagementpolicies") return policyList(scope, filter);
        throw new Unhandled();
    };

    const handle = (request: ArmRequest): ArmResponse => {
        try {
            const url = new URL(request.url);
            // getEntities is a POST that only reads (Learn, Entities - List): it is the one POST the demo answers
            const isEntities = request.method.toUpperCase() === "POST" && decodeURIComponent(url.pathname).replace(/\/+$/, "").toLowerCase() === GET_ENTITIES_PATH.toLowerCase();
            if (isEntities) {
                if (url.searchParams.get("api-version") !== ARM_API_VERSIONS.managementGroups || [...url.searchParams.keys()].some((k) => k !== "api-version")) throw new Unhandled();
                return entityList();
            }
            if (request.method.toUpperCase() !== "GET") throw new ArmHttpError(403, DEMO_WRITE_ERROR_CODE, DEMO_WRITE_MESSAGE);
            return route(decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/", url.searchParams);
        } catch (error) {
            if (error instanceof Unhandled) {
                options.onUnhandled?.(request);
                return json(404, { error: { code: "NotFound", message: `The demo has no answer for ${request.method} ${request.url}.` } });
            }
            if (error instanceof ArmHttpError) return json(error.status, { error: { code: error.code, message: error.message } });
            throw error;
        }
    };

    return { handle };
}
