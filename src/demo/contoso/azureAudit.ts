import { MS_PIM_APP_ID } from "@/utils/azureAuditEvents";
import type { DemoAzureInstance, DemoAzurePrincipal, DemoAzureRole } from "./azure";
import { CONTOSO_TENANT_ID, demoGuid } from "./ids";
import type { DemoGroup, DemoServicePrincipal, DemoUser } from "./model";
import { GROUPS, PEOPLE, SERVICE_PRINCIPALS } from "./tenant";

/**
 * The demo's Azure audit sources, for the fake ARM (`src/demo/arm/server.ts`): the role assignment and eligibility schedule
 * requests, and the Activity Log rows of the authorization provider, in the shape ARM returns them (a row carries more
 * than the app reads: the request, the claims, the addresses), on dates relative to `now`, with Contoso people, roles and
 * scopes. The app's real mapper turns them into events. Every case the Azure Audit page tells is in here once; the ids of
 * the two requests the Entra log decides (`ApproveRoleActivation`, `RejectRoleActivation`) are spelled the same way in
 * `audit.ts`, which is read at every page boot and so does not import this file.
 */

/** A request row of `roleAssignmentScheduleRequests` or `roleEligibilityScheduleRequests`, as ARM returns it */
export interface DemoArmRequest {
    id: string;
    name: string;
    type: string;
    properties: Record<string, unknown> & { scope: string };
}

/** An Activity Log row: more fields than the app reads, which the read drops */
export type DemoActivityRow = Record<string, unknown> & {
    eventDataId: string;
    eventTimestamp: string;
    resourceId: string;
    operationName: { value: string; localizedValue: string };
};

export interface DemoAzureAudit {
    assignmentRequests: DemoArmRequest[];
    eligibilityRequests: DemoArmRequest[];
    activity: DemoActivityRow[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const AUTH = "/providers/Microsoft.Authorization";
/** The Azure portal, which makes a direct change in the log */
const PORTAL_APP_ID = "c44b4083-3bb0-49c1-b47d-974e53cbdf3c";

/** The request names the Entra log refers to (`audit.ts` spells the same seeds) */
export const AZURE_AUDIT_REQUESTS = {
    approved: demoGuid("azure:audit:request:approved"),
    denied: demoGuid("azure:audit:request:denied"),
} as const;

const prefix = (scope: string) => (scope === "/" ? "" : scope);
const subscriptionOf = (scope: string) => scope.match(/^\/subscriptions\/[^/]+/i)?.[0] ?? "";
const lastSegment = (scope: string) => scope.split("/").filter((s) => s !== "").pop() ?? scope;
const iso = (ms: number) => new Date(ms).toISOString();

const user = (u: DemoUser): DemoAzurePrincipal => ({ id: u.id, displayName: u.displayName, type: "User", email: u.mail ?? u.userPrincipalName, userPrincipalName: u.userPrincipalName });
const group = (g: DemoGroup): DemoAzurePrincipal => ({ id: g.id, displayName: g.displayName, type: "Group" });
const agent = (sp: DemoServicePrincipal): DemoAzurePrincipal => ({ id: sp.id, displayName: sp.displayName, type: "AgentIdentity" });

interface RequestSpec {
    name: string;
    list: "assignment" | "eligibility";
    type: string;
    status: string;
    principal: DemoAzurePrincipal;
    requestor: DemoAzurePrincipal;
    role: DemoAzureRole;
    scope: string;
    createdOn: number;
    start?: number;
    duration?: string;
    endsAt?: number;
    approval?: boolean;
    justification?: string;
    ticket?: [string, string];
    linkedEligibilityKey?: string;
}

function request(spec: RequestSpec): DemoArmRequest {
    const listName = spec.list === "assignment" ? "roleAssignmentScheduleRequests" : "roleEligibilityScheduleRequests";
    const at = `${prefix(spec.scope)}${AUTH}`;
    const roleId = `${subscriptionOf(spec.scope)}${AUTH}/roleDefinitions/${spec.role.id}`;
    const { principal } = spec;
    const expiration = spec.endsAt !== undefined
        ? { type: "AfterDateTime", endDateTime: iso(spec.endsAt), duration: null }
        : spec.duration
            ? { type: "AfterDuration", endDateTime: null, duration: spec.duration }
            : { type: "NoExpiration", endDateTime: null, duration: null };
    return {
        id: `${at}/${listName}/${spec.name}`,
        name: spec.name,
        type: `Microsoft.Authorization/${listName}`,
        properties: {
            scope: spec.scope,
            roleDefinitionId: roleId,
            principalId: principal.id,
            principalType: principal.type,
            requestorId: spec.requestor.id,
            requestType: spec.type,
            status: spec.status,
            createdOn: iso(spec.createdOn),
            ...(spec.justification ? { justification: spec.justification } : {}),
            ...(spec.ticket ? { ticketInfo: { ticketNumber: spec.ticket[0], ticketSystem: spec.ticket[1] } } : {}),
            ...(spec.start !== undefined ? { scheduleInfo: { startDateTime: iso(spec.start), expiration } } : {}),
            ...(spec.approval ? { approvalId: `${at}/roleAssignmentApprovals/${spec.name}` } : {}),
            ...(spec.linkedEligibilityKey
                ? { linkedRoleEligibilityScheduleId: `${at}/roleEligibilitySchedules/${demoGuid(`azure:schedule:${spec.linkedEligibilityKey}`)}` }
                : {}),
            expandedProperties: {
                principal: {
                    displayName: principal.displayName,
                    ...(principal.email ? { email: principal.email } : {}),
                    id: principal.id,
                    type: principal.type,
                    ...(principal.userPrincipalName ? { userPrincipalName: principal.userPrincipalName } : {}),
                },
                roleDefinition: { displayName: spec.role.displayName, id: roleId, type: spec.role.custom ? "CustomRole" : "BuiltInRole" },
                scope: { displayName: lastSegment(spec.scope), id: spec.scope },
            },
        },
    };
}

interface LogSpec {
    key: string;
    at: number;
    op: string;
    /** A user principal name, or an id for a service */
    caller: string;
    callerName?: string;
    resource: string;
    app: string;
    method: "PUT" | "DELETE" | "POST";
    request?: unknown;
    response?: unknown;
    /** The write failed: the completion carries this error */
    fail?: { code: string; message: string };
    /** Only the start: the log has no completion (yet) */
    startOnly?: boolean;
}

/** The two rows of one operation in the log: the start, which holds the request, and its completion, which holds the response */
function logAction(spec: LogSpec): DemoActivityRow[] {
    const correlationId = demoGuid(`azure:audit:correlation:${spec.key}`);
    const subscription = subscriptionOf(spec.resource).split("/")[2];
    const base = (suffix: string, at: number, status: string) => ({
        authorization: { action: spec.op, scope: spec.resource },
        caller: spec.caller,
        category: { value: "Administrative", localizedValue: "Administrative" },
        channels: "Operation",
        claims: {
            aud: "https://management.azure.com/",
            iss: `https://sts.windows.net/${CONTOSO_TENANT_ID}/`,
            appid: spec.app,
            appidacr: "2",
            ipaddr: "203.0.113.24",
            ...(spec.callerName ? { name: spec.callerName } : {}),
        },
        correlationId,
        description: "",
        eventDataId: demoGuid(`azure:audit:event:${spec.key}:${suffix}`),
        eventName: { value: suffix === "start" ? "BeginRequest" : "EndRequest", localizedValue: suffix === "start" ? "Begin request" : "End request" },
        eventTimestamp: iso(at),
        httpRequest: { clientRequestId: demoGuid(`azure:audit:client:${spec.key}`), clientIpAddress: "203.0.113.24", method: spec.method },
        id: `${spec.resource}/events/${demoGuid(`azure:audit:event:${spec.key}:${suffix}`)}/ticks/${at}`,
        level: status === "Failed" ? "Error" : "Informational",
        operationId: correlationId,
        operationName: { value: spec.op, localizedValue: spec.op },
        resourceGroupName: spec.resource.match(/\/resourceGroups\/([^/]+)/i)?.[1],
        resourceId: spec.resource,
        resourceProviderName: { value: "Microsoft.Authorization", localizedValue: "Microsoft Authorization" },
        resourceType: { value: spec.op.split("/").slice(0, 2).join("/"), localizedValue: spec.op.split("/").slice(0, 2).join("/") },
        status: { value: status, localizedValue: status },
        subStatus: { value: "", localizedValue: "" },
        submissionTimestamp: iso(at + 5_000),
        ...(subscription ? { subscriptionId: subscription } : {}),
        tenantId: CONTOSO_TENANT_ID,
    });
    const started: DemoActivityRow = {
        ...base("start", spec.at, "Started"),
        properties: spec.request === undefined ? {} : { requestbody: JSON.stringify(spec.request) },
    };
    if (spec.startOnly) return [started];
    const status = spec.fail ? "Failed" : "Succeeded";
    const done: DemoActivityRow = {
        ...base("end", spec.at + 2_000, status),
        properties: {
            statusCode: spec.fail ? "Conflict" : spec.method === "DELETE" ? "OK" : "Created",
            serviceRequestId: demoGuid(`azure:audit:service:${spec.key}`),
            ...(spec.response === undefined ? {} : { responseBody: JSON.stringify(spec.response) }),
            ...(spec.fail ? { statusMessage: JSON.stringify({ status: "Failed", error: { code: spec.fail.code, message: spec.fail.message } }) } : {}),
        },
    };
    return [started, done];
}

export function buildDemoAzureAudit(now: Date, instances: readonly DemoAzureInstance[]): DemoAzureAudit {
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const t = (daysAgo: number, hour: number, minute = 0, second = 0) => midnight - daysAgo * DAY + hour * HOUR + minute * MINUTE + second * 1000;
    const found = (key: string): DemoAzureInstance => {
        const instance = instances.find((i) => i.key === key);
        if (!instance) throw new Error(`The demo has no Azure item ${key}`);
        return instance;
    };

    // Scopes, roles and people come from the demo's own items, so the audit and the assignments agree
    const SCOPE = {
        trg: found("a:trg-owner-bg01").scope,
        platform: found("e:platform-owner-azureowners").scope,
        production: found("a:prod-owner-johanna").scope,
        test: found("a:test-owner-platform").scope,
        rgData: found("e:rgdata-contributor-alex").scope,
        appService: found("e:appservice-contributor-grady").scope,
        eventHub: found("a:evh-reader-lidia").scope,
        rgSandbox: found("e:sandbox-contributor-henrietta").scope,
        fabrikam: found("a:fabrikam-contributor-lidia").scope,
        corpApps: found("e:corpapps-contributor-kim").scope,
        rgCorpApps: found("a:rgcorpapps-reader-opsagent").scope,
        rgLabs: found("a:rglabs-reader-alex").scope,
        rgPrivate: found("a:rgprivate-contributor-deploy").scope,
    };
    const ROLE = {
        owner: found("a:prod-owner-johanna").role,
        contributor: found("e:rgdata-contributor-alex").role,
        reader: found("a:evh-reader-lidia").role,
        custom: found("e:rgweb-weboperator-grady").role,
    };
    const P = PEOPLE;
    const who = {
        alex: user(P.alex),
        johanna: user(P.johanna),
        lidia: user(P.lidia),
        henrietta: user(P.henrietta),
        grady: user(P.grady),
        kim: user(P.kim),
        breakGlass: user(P.breakGlass1),
        azureOwners: group(GROUPS.azureOwners),
        opsAgent: agent(SERVICE_PRINCIPALS.opsAgent),
    };

    const assignmentRequests: DemoArmRequest[] = [];
    const eligibilityRequests: DemoArmRequest[] = [];
    const activity: DemoActivityRow[] = [];
    const add = (spec: RequestSpec) => (spec.list === "assignment" ? assignmentRequests : eligibilityRequests).push(request(spec));

    const roleDefinitionId = (scope: string, role: DemoAzureRole) => `${subscriptionOf(scope)}${AUTH}/roleDefinitions/${role.id}`;
    const assignmentResource = (scope: string, key: string) => `${prefix(scope)}${AUTH}/roleAssignments/${demoGuid(`azure:audit:assignment:${key}`)}`;
    /** The write of a role assignment by PIM: the names are in the start, as PIM writes them (capitalised) */
    const pimWrite = (key: string, at: number, scope: string, principal: DemoAzurePrincipal, role: DemoAzureRole) => {
        activity.push(...logAction({
            key, at, op: "Microsoft.Authorization/roleAssignments/write", caller: demoGuid("azure:audit:mspim"), resource: assignmentResource(scope, key), app: MS_PIM_APP_ID, method: "PUT",
            request: { Properties: { PrincipalId: principal.id, PrincipalType: principal.type, RoleDefinitionId: roleDefinitionId(scope, role), Scope: scope } },
        }));
    };
    /** The delete of a role assignment by PIM: the names are in the response of the completion */
    const pimDelete = (key: string, at: number, scope: string, principal: DemoAzurePrincipal, role: DemoAzureRole) => {
        activity.push(...logAction({
            key, at, op: "Microsoft.Authorization/roleAssignments/delete", caller: demoGuid("azure:audit:mspim"), resource: assignmentResource(scope, key), app: MS_PIM_APP_ID, method: "DELETE",
            response: { properties: { principalId: principal.id, principalType: principal.type, roleDefinitionId: roleDefinitionId(scope, role), scope } },
        }));
    };
    /** A change a person makes in the portal, outside PIM */
    const direct = (key: string, at: number, op: "write" | "delete", by: DemoAzurePrincipal, scope: string, principal: DemoAzurePrincipal, role: DemoAzureRole, principalType: string = principal.type) => {
        const body = { properties: { principalId: principal.id, principalType, roleDefinitionId: roleDefinitionId(scope, role), scope } };
        activity.push(...logAction({
            key, at, op: `Microsoft.Authorization/roleAssignments/${op}`, caller: by.userPrincipalName ?? by.id, callerName: by.displayName, resource: assignmentResource(scope, key), app: PORTAL_APP_ID,
            method: op === "write" ? "PUT" : "DELETE", ...(op === "write" ? { request: body } : { response: body }),
        }));
    };

    // An activation with approval and its write, used and expired: the approval is in the Entra log (audit.ts)
    {
        const created = t(13, 9, 0);
        const start = t(13, 9, 21);
        add({ name: AZURE_AUDIT_REQUESTS.approved, list: "assignment", type: "SelfActivate", status: "Provisioned", principal: who.johanna, requestor: who.johanna, role: ROLE.owner, scope: SCOPE.production, createdOn: created, start, duration: "PT4H", approval: true, justification: "Quarterly access review", ticket: ["CHG0031207", "ServiceNow"] });
        // The decision: the write of the approval stage, by the approver (the Entra log names the same person)
        activity.push(...logAction({
            key: "approved-stage", at: t(13, 9, 20), op: "Microsoft.Authorization/roleAssignmentApprovals/stages/write", caller: who.alex.userPrincipalName ?? who.alex.id, callerName: who.alex.displayName,
            resource: `${prefix(SCOPE.production)}${AUTH}/roleAssignmentApprovals/${AZURE_AUDIT_REQUESTS.approved}/stages/${demoGuid("azure:audit:approvalstage:approved")}`, app: PORTAL_APP_ID, method: "PUT",
        }));
        pimWrite("approved-write", start + 1_000, SCOPE.production, who.johanna, ROLE.owner);
        pimDelete("approved-expiry", start + 4 * HOUR + MINUTE, SCOPE.production, who.johanna, ROLE.owner);
    }
    // An activation deactivated, with SelfDeactivate and its delete
    {
        const created = t(9, 10, 0);
        add({ name: demoGuid("azure:audit:request:activated"), list: "assignment", type: "SelfActivate", status: "Provisioned", principal: who.lidia, requestor: who.lidia, role: ROLE.contributor, scope: SCOPE.test, createdOn: created, start: created, duration: "PT8H", justification: "Fix the build pipeline" });
        pimWrite("activated-write", created + 5_000, SCOPE.test, who.lidia, ROLE.contributor);
        add({ name: demoGuid("azure:audit:request:deactivated"), list: "assignment", type: "SelfDeactivate", status: "Provisioned", principal: who.lidia, requestor: who.lidia, role: ROLE.contributor, scope: SCOPE.test, createdOn: created + 90 * MINUTE });
        pimDelete("deactivated-delete", created + 90 * MINUTE + 3_000, SCOPE.test, who.lidia, ROLE.contributor);
    }
    // Denied, waiting and failed
    add({ name: AZURE_AUDIT_REQUESTS.denied, list: "assignment", type: "SelfActivate", status: "Denied", principal: who.grady, requestor: who.grady, role: ROLE.contributor, scope: SCOPE.appService, createdOn: t(7, 14, 0), start: t(7, 14, 0), duration: "PT2H", approval: true, justification: "Restart the API after the release", ticket: ["INC0012951", "ServiceNow"] });
    add({ name: demoGuid("azure:audit:request:waiting"), list: "assignment", type: "SelfActivate", status: "PendingApproval", principal: who.henrietta, requestor: who.henrietta, role: ROLE.owner, scope: SCOPE.fabrikam, createdOn: t(1, 15, 0), start: t(1, 15, 0), duration: "PT4H", approval: true, justification: "Onboard the Fabrikam landing zone" });
    {
        const created = t(5, 11, 0);
        add({ name: demoGuid("azure:audit:request:failed"), list: "assignment", type: "SelfActivate", status: "Failed", principal: who.alex, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.rgData, createdOn: created, start: created, duration: "PT1H", justification: "Check the storage firewall" });
        activity.push(...logAction({
            key: "failed-write", at: created + 2_000, op: "Microsoft.Authorization/roleAssignments/write", caller: demoGuid("azure:audit:mspim"), resource: assignmentResource(SCOPE.rgData, "failed-write"), app: MS_PIM_APP_ID, method: "PUT",
            request: { Properties: { PrincipalId: who.alex.id, PrincipalType: "User", RoleDefinitionId: roleDefinitionId(SCOPE.rgData, ROLE.contributor), Scope: SCOPE.rgData } },
            fail: { code: "RoleAssignmentExists", message: "The role assignment already exists." },
        }));
    }
    // An extension ARM refused (ActiveDurationTooShort): it was never created, so only the log has it (AU-17, P8)
    activity.push(...logAction({
        key: "refused-extend", at: t(2, 10, 0), op: "Microsoft.Authorization/roleEligibilityScheduleRequests/write", caller: who.alex.userPrincipalName ?? who.alex.id, callerName: who.alex.displayName,
        resource: `${prefix(SCOPE.test)}${AUTH}/roleEligibilityScheduleRequests/${demoGuid("azure:audit:request:refused-extend")}`, app: PORTAL_APP_ID, method: "PUT",
        request: { properties: { principalId: who.lidia.id, roleDefinitionId: roleDefinitionId(SCOPE.test, ROLE.contributor), requestType: "AdminExtend" } },
        fail: { code: "ActiveDurationTooShort", message: "The active duration is shorter than the minimum." },
    }));
    // An activation through a group: the eligibility it links to belongs to a group
    {
        const created = t(4, 10, 0);
        add({ name: demoGuid("azure:audit:request:viagroup"), list: "assignment", type: "SelfActivate", status: "Provisioned", principal: who.henrietta, requestor: who.henrietta, role: ROLE.owner, scope: SCOPE.platform, createdOn: created, start: created, duration: "PT4H", justification: "Policy change on the platform", linkedEligibilityKey: "e:platform-owner-azureowners" });
        pimWrite("viagroup-write", created + 6_000, SCOPE.platform, who.henrietta, ROLE.owner);
    }
    // Admin: assign eligible and active, remove
    add({ name: demoGuid("azure:audit:request:assign-eligible"), list: "eligibility", type: "AdminAssign", status: "Provisioned", principal: who.lidia, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.test, createdOn: t(20, 9, 0), start: t(20, 9, 0), endsAt: t(-27, 9, 0), justification: "Joins the platform team" });
    {
        const created = t(6, 16, 0);
        add({ name: demoGuid("azure:audit:request:assign-active"), list: "assignment", type: "AdminAssign", status: "Provisioned", principal: who.lidia, requestor: who.alex, role: ROLE.reader, scope: SCOPE.eventHub, createdOn: created, start: created, endsAt: t(-14, 16, 0), justification: "Reads the event hub during the migration" });
        pimWrite("assign-active-write", created + 8_000, SCOPE.eventHub, who.lidia, ROLE.reader);
    }
    add({ name: demoGuid("azure:audit:request:remove-eligible"), list: "eligibility", type: "AdminRemove", status: "Revoked", principal: who.grady, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.rgSandbox, createdOn: t(15, 13, 0) });
    // The guest, and the agent
    add({ name: demoGuid("azure:audit:request:guest"), list: "eligibility", type: "AdminAssign", status: "Provisioned", principal: who.kim, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.corpApps, createdOn: t(14, 9, 30), start: t(14, 9, 30), endsAt: t(-75, 9, 30), justification: "Fabrikam partner project" });
    {
        const created = t(8, 10, 0);
        add({ name: demoGuid("azure:audit:request:agent"), list: "assignment", type: "AdminAssign", status: "Provisioned", principal: who.opsAgent, requestor: who.alex, role: ROLE.reader, scope: SCOPE.rgCorpApps, createdOn: created, start: created, justification: "The ops agent reads the corp apps" });
        pimWrite("agent-write", created + 9_000, SCOPE.rgCorpApps, who.opsAgent, ROLE.reader);
    }
    // Read below a subscription: the request at a scope the demo account reads in Contoso Labs
    add({ name: demoGuid("azure:audit:request:labs"), list: "eligibility", type: "AdminAssign", status: "Provisioned", principal: who.henrietta, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.rgLabs, createdOn: t(9, 10, 0), start: t(9, 10, 0), endsAt: t(-81, 10, 0), justification: "Lab work" });
    // The demo account's own request on a scope it cannot read: only the `asTarget()` read at the root gives it
    add({ name: demoGuid("azure:audit:request:own-private"), list: "assignment", type: "SelfActivate", status: "Provisioned", principal: who.alex, requestor: who.alex, role: ROLE.contributor, scope: SCOPE.rgPrivate, createdOn: t(6, 9, 0), start: t(6, 9, 0), duration: "PT2H", justification: "Check the private deployment" });

    // Direct changes outside PIM, by a person, by the emergency account, and the delete of an agent (the log calls it a service principal)
    direct("direct-write", t(18, 15, 0), "write", who.alex, SCOPE.test, who.henrietta, ROLE.reader);
    direct("direct-delete", t(16, 9, 0), "delete", who.alex, SCOPE.test, who.henrietta, ROLE.reader);
    direct("emergency-write", t(3, 2, 30), "write", who.breakGlass, SCOPE.production, who.lidia, ROLE.reader);
    direct("agent-delete", t(11, 12, 0), "delete", who.alex, SCOPE.rgCorpApps, who.opsAgent, ROLE.contributor, "ServicePrincipal");
    direct("labs-write", t(10, 11, 0), "write", who.alex, SCOPE.rgLabs, who.grady, ROLE.reader);
    direct("private-write", t(10, 11, 30), "write", who.alex, SCOPE.rgData, who.grady, ROLE.reader);

    // A policy write at the Tenant Root Group (only in the management group and tenant answers), a custom role write, a
    // validation that is never an event, and an operation with a GUID in it
    activity.push(...logAction({
        key: "policy-write", at: t(13, 14, 0), op: "Microsoft.Authorization/roleManagementPolicies/write", caller: who.alex.userPrincipalName ?? who.alex.id, callerName: who.alex.displayName,
        resource: `${prefix(SCOPE.trg)}${AUTH}/roleManagementPolicies/${demoGuid("azure:audit:policy")}`, app: PORTAL_APP_ID, method: "PUT",
        request: { properties: { rules: [{ id: "Expiration_Admin_Eligibility" }, { id: "Expiration_Admin_Assignment" }, { id: "Expiration_EndUser_Assignment" }, { id: "Enablement_Admin_Eligibility" }, { id: "Enablement_Admin_Assignment" }, { id: "Enablement_EndUser_Assignment" }, { id: "Approval_EndUser_Assignment" }, { id: "Notification_Admin_Admin_Assignment" }] } },
    }));
    activity.push(...logAction({
        key: "role-write", at: t(22, 10, 0), op: "Microsoft.Authorization/roleDefinitions/write", caller: who.alex.userPrincipalName ?? who.alex.id, callerName: who.alex.displayName,
        resource: `${prefix(SCOPE.production)}${AUTH}/roleDefinitions/${ROLE.custom.id}`, app: PORTAL_APP_ID, method: "PUT",
        request: { properties: { roleName: ROLE.custom.displayName, type: "CustomRole" } },
    }));
    activity.push(...logAction({
        key: "validate", at: t(10, 10, 0), op: "Microsoft.Authorization/roleAssignmentScheduleRequests/validate/action", caller: who.lidia.userPrincipalName ?? who.lidia.id, callerName: who.lidia.displayName,
        resource: `${prefix(SCOPE.production)}${AUTH}/roleAssignmentScheduleRequests/${demoGuid("azure:audit:validate")}`, app: PORTAL_APP_ID, method: "POST",
    }));
    activity.push(...logAction({
        key: "guid-operation", at: t(13, 9, 15), op: `Microsoft.Authorization/roleAssignmentApprovals/${demoGuid("azure:audit:approvalstage")}/write`, caller: demoGuid("azure:audit:mspim"),
        resource: `${prefix(SCOPE.production)}${AUTH}/roleAssignmentApprovals/${demoGuid("azure:audit:approvalstage")}`, app: MS_PIM_APP_ID, method: "PUT",
    }));

    // Rows of other providers: the subscription answers leave them out through the filter, the management group and tenant answers hold them
    const other = (key: string, at: number, op: string, resource: string): DemoActivityRow[] =>
        logAction({ key, at, op, caller: who.alex.userPrincipalName ?? who.alex.id, callerName: who.alex.displayName, resource, app: PORTAL_APP_ID, method: "PUT" })
            .map((row) => ({ ...row, resourceProviderName: { value: op.split("/")[0], localizedValue: op.split("/")[0] } }));
    activity.push(...other("mg-write", t(30, 9, 0), "Microsoft.Management/managementGroups/write", SCOPE.platform));
    activity.push(...other("site-write", t(6, 9, 0), "Microsoft.Web/sites/write", SCOPE.appService));

    activity.sort((a, b) => Date.parse(b.eventTimestamp) - Date.parse(a.eventTimestamp));
    return { assignmentRequests, eligibilityRequests, activity };
}
