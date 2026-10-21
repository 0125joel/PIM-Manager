import type { DemoGroup, DemoGroupSchedule, DemoPolicy, DemoRoleSchedule, DemoServicePrincipal, DemoTenant, DemoUser } from "@/demo/contoso/model";
import { applySelect, parseExpand, parseFilter, parseSearch } from "./odata";

/**
 * A Microsoft Graph that lives in the browser and answers from the demo tenant. It serves the read requests the app
 * makes, in the shape Graph returns them, so the demo runs the app's real services, parsers and loaders. Every write is
 * refused with 403 `DemoEnvironment`; the UI disables those actions first (`DemoLock`), this is the backstop. A dry run
 * of a new assignment (`isValidationOnly`, Configure's pre-flight) writes nothing and is accepted.
 *
 * An unknown read answers 404 and is reported through `onUnhandled`, and `src/__tests__/demo/fakeGraph.test.ts` loads
 * the whole app through it, so a new Graph call in the app fails the tests until the fake Graph serves it too.
 */

export interface GraphRequest {
    method: string;
    /** Absolute (`https://graph.microsoft.com/v1.0/...`) or relative to the version (`/users/x`, inside `$batch`) */
    url: string;
    body?: unknown;
}

export interface GraphResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
}

export interface FakeGraph {
    handle(request: GraphRequest): GraphResponse;
}

export interface FakeGraphOptions {
    now?: () => Date;
    onUnhandled?: (request: GraphRequest) => void;
    /**
     * Answers 403 on the policy reads the predicate names, like a user without a directory role that may read PIM settings
     * (tenant run 2026-10-10, FIX-11). `scopeId` is the group id, or "/" for the directory roles.
     */
    policyReadDenied?: (read: { scopeType: string; scopeId: string }) => boolean;
}

export const DEMO_WRITE_ERROR_CODE = "DemoEnvironment";
export const DEMO_WRITE_MESSAGE = "This is a demo environment. Changes are not saved to a tenant.";

type Item = Record<string, unknown>;

class HttpError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

/** The four schedule request endpoints whose validation-only requests the demo accepts */
const VALIDATION_PATHS = /^\/(roleManagement\/directory\/role(Eligibility|Assignment)ScheduleRequests|identityGovernance\/privilegedAccess\/group\/(eligibility|assignment)ScheduleRequests)$/;

const json = (status: number, body: unknown): GraphResponse => ({ status, headers: { "content-type": "application/json" }, body });
const list = (value: unknown[]): GraphResponse => json(200, { value });
const notFound = (what: string) => new HttpError(404, "Request_ResourceNotFound", `Resource '${what}' does not exist or one of its queried reference-property objects are not present.`);

function scheduleInfo(startDateTime: string, endDateTime: string | null) {
    return {
        startDateTime,
        recurrence: null,
        expiration: endDateTime
            ? { type: "afterDateTime", endDateTime, duration: null }
            : { type: "noExpiration", endDateTime: null, duration: null },
    };
}

export function createFakeGraph(tenant: DemoTenant, options: FakeGraphOptions = {}): FakeGraph {
    const now = () => (options.now ? options.now() : new Date()).getTime();
    const usersById = new Map(tenant.users.map((u) => [u.id.toLowerCase(), u]));
    const groupsById = new Map(tenant.groups.map((g) => [g.id.toLowerCase(), g]));
    const spsById = new Map(tenant.servicePrincipals.map((s) => [s.id.toLowerCase(), s]));

    // Directory objects ------------------------------------------------------------------------------------------

    const userObject = (u: DemoUser): Item => ({
        "@odata.type": u.agentParentId ? "#microsoft.graph.agentUser" : "#microsoft.graph.user",
        id: u.id,
        displayName: u.displayName,
        userPrincipalName: u.userPrincipalName,
        mail: u.mail,
        jobTitle: u.jobTitle,
        department: u.department,
        userType: u.userType,
        accountEnabled: true,
        ...(u.agentParentId ? { identityParentId: u.agentParentId } : {}),
    });
    const groupObject = (g: DemoGroup): Item => ({
        "@odata.type": "#microsoft.graph.group",
        id: g.id,
        displayName: g.displayName,
        description: g.description,
        mail: g.mail,
        mailEnabled: g.mailEnabled,
        securityEnabled: g.securityEnabled,
        groupTypes: g.groupTypes,
        isAssignableToRole: g.isAssignableToRole,
        membershipRule: g.membershipRule,
        membershipRuleProcessingState: g.membershipRuleProcessingState,
        onPremisesSyncEnabled: g.onPremisesSyncEnabled ?? null,
    });
    /**
     * A service principal as Graph returns it. An agent identity and a blueprint principal carry their derived type,
     * except on roleAssignments, which returns the base type (asBaseType, tenant test 2026-10-11: servicePrincipalType
     * ServiceIdentity stays, agentIdentityBlueprintId is absent).
     */
    const spObject = (sp: DemoServicePrincipal, asBaseType = false): Item => {
        const base = { id: sp.id, appId: sp.appId, displayName: sp.displayName, tags: [] as string[] };
        if (sp.agent?.type === "agentIdentity") {
            return asBaseType
                ? { "@odata.type": "#microsoft.graph.servicePrincipal", ...base, servicePrincipalType: "ServiceIdentity" }
                : { "@odata.type": "#microsoft.graph.agentIdentity", ...base, servicePrincipalType: "ServiceIdentity", agentIdentityBlueprintId: sp.agent.blueprintAppId };
        }
        if (sp.agent?.type === "agentIdentityBlueprintPrincipal") {
            return { "@odata.type": asBaseType ? "#microsoft.graph.servicePrincipal" : "#microsoft.graph.agentIdentityBlueprintPrincipal", ...base, servicePrincipalType: "Application" };
        }
        return { "@odata.type": "#microsoft.graph.servicePrincipal", ...base, servicePrincipalType: "Application" };
    };
    /** The expanded `principal` of a schedule: the default properties, no `userType` (Graph does not return it there) */
    const principalObject = (id: string, asBaseType = false): Item | null => {
        const key = id.toLowerCase();
        const user = usersById.get(key);
        if (user) {
            const { userType: _userType, department: _department, ...rest } = userObject(user);
            void _userType; void _department;
            return rest;
        }
        const group = groupsById.get(key);
        if (group) return groupObject(group);
        const sp = spsById.get(key);
        if (sp) return spObject(sp, asBaseType);
        return null;
    };
    const anyObject = (id: string): Item | null => {
        const user = usersById.get(id.toLowerCase());
        return user ? userObject(user) : principalObject(id);
    };

    // Schedules --------------------------------------------------------------------------------------------------

    const isCurrent = (s: { startDateTime: string; endDateTime: string | null }) => {
        const t = now();
        return Date.parse(s.startDateTime) <= t && (s.endDateTime === null || Date.parse(s.endDateTime) > t);
    };
    const notEnded = (s: { endDateTime: string | null }) => s.endDateTime === null || Date.parse(s.endDateTime) > now();
    const withPrincipal = (item: Item, principalId: string, expand: Record<string, string>, asBaseType = false) => {
        if ("principal" in expand) item.principal = principalObject(principalId, asBaseType);
        return item;
    };

    const roleSchedule = (s: DemoRoleSchedule): Item => ({
        id: s.id,
        principalId: s.principalId,
        roleDefinitionId: s.roleDefinitionId,
        directoryScopeId: s.directoryScopeId,
        appScopeId: null,
        createdUsing: s.id,
        createdDateTime: s.createdDateTime,
        modifiedDateTime: null,
        status: "Provisioned",
        memberType: "Direct",
        scheduleInfo: scheduleInfo(s.startDateTime, s.endDateTime),
        ...(s.kind === "active" ? { assignmentType: s.assignmentType } : {}),
    });
    const roleInstance = (s: DemoRoleSchedule): Item => ({
        id: `${s.id}-instance`,
        principalId: s.principalId,
        roleDefinitionId: s.roleDefinitionId,
        directoryScopeId: s.directoryScopeId,
        appScopeId: null,
        startDateTime: s.startDateTime,
        endDateTime: s.endDateTime,
        memberType: s.throughGroup ? "Group" : "Direct",
        assignmentType: s.assignmentType,
        roleAssignmentOriginId: s.id,
        roleAssignmentScheduleId: s.id,
    });
    const activeRoles = () => tenant.roleSchedules.filter((s) => s.kind === "active" && isCurrent(s));

    const groupSchedule = (s: DemoGroupSchedule): Item => ({
        id: s.id,
        groupId: s.groupId,
        principalId: s.principalId,
        accessId: s.accessId,
        memberType: "Direct",
        status: "Provisioned",
        createdUsing: s.id,
        createdDateTime: s.startDateTime,
        modifiedDateTime: null,
        scheduleInfo: scheduleInfo(s.startDateTime, s.endDateTime),
        ...(s.kind === "active" ? { assignmentType: s.assignmentType } : {}),
    });
    const groupInstance = (s: DemoGroupSchedule): Item => ({
        id: `${s.id}-instance`,
        groupId: s.groupId,
        principalId: s.principalId,
        accessId: s.accessId,
        memberType: "Direct",
        startDateTime: s.startDateTime,
        endDateTime: s.endDateTime,
        ...(s.kind === "active" ? { assignmentType: s.assignmentType, assignmentScheduleId: s.id } : { eligibilityScheduleId: s.id }),
    });

    /** Members (or owners) of a group right now: the ones outside PIM plus the active PIM assignments */
    const groupPeople = (group: DemoGroup, access: "member" | "owner"): string[] => {
        const ids = new Set((access === "member" ? group.members : group.owners).map((id) => id.toLowerCase()));
        for (const s of tenant.groupSchedules) {
            if (s.groupId === group.id && s.accessId === access && s.kind === "active" && isCurrent(s)) ids.add(s.principalId.toLowerCase());
        }
        return [...ids];
    };

    // Policies ---------------------------------------------------------------------------------------------------

    const policyAssignment = (p: DemoPolicy, expand: Record<string, string>): Item => {
        const item: Item = {
            id: `${p.id}_${p.roleDefinitionId}`,
            policyId: p.id,
            scopeId: p.scopeId,
            scopeType: p.scopeType,
            roleDefinitionId: p.roleDefinitionId,
        };
        if ("policy" in expand) {
            item.policy = {
                id: p.id,
                displayName: p.displayName,
                description: p.displayName,
                isOrganizationDefault: false,
                scopeId: p.scopeId,
                scopeType: p.scopeType,
                lastModifiedDateTime: null,
                ...(expand.policy.includes("rules") ? { rules: p.rules } : {}),
            };
        }
        return item;
    };

    // Query handling ---------------------------------------------------------------------------------------------

    const query = (items: Item[], params: URLSearchParams): Item[] => {
        let result = items;
        const filter = params.get("$filter");
        if (filter) {
            let predicate;
            try {
                predicate = parseFilter(filter);
            } catch (error) {
                throw new HttpError(400, "BadRequest", error instanceof Error ? error.message : String(error));
            }
            result = result.filter(predicate);
        }
        const search = params.get("$search");
        if (search) result = result.filter(parseSearch(search));
        const top = Number(params.get("$top"));
        if (Number.isFinite(top) && top > 0) result = result.slice(0, top);
        const select = params.get("$select");
        const expanded = Object.keys(parseExpand(params.get("$expand")));
        return result.map((item) => applySelect(item, select, expanded));
    };

    type Route = [RegExp, (match: RegExpMatchArray, params: URLSearchParams) => GraphResponse];
    const one = (item: Item | null | undefined, what: string, params: URLSearchParams): GraphResponse => {
        if (!item) throw notFound(what);
        return json(200, applySelect(item, params.get("$select")));
    };

    const routes: Route[] = [
        [/^\/organization$/, () => list([{ id: tenant.id, displayName: tenant.displayName, verifiedDomains: [{ name: "contoso.com", isDefault: true }] }])],
        [/^\/me$/, (_m, params) => one(anyObject(tenant.signedInUserId), "me", params)],

        // Directory roles
        [/^\/roleManagement\/directory\/roleDefinitions$/, (_m, params) => list(query(tenant.roleDefinitions.map((r) => ({ ...r })), params))],
        [/^\/roleManagement\/directory\/roleDefinitions\/([^/]+)$/, (m, params) => one(tenant.roleDefinitions.find((r) => r.id.toLowerCase() === m[1].toLowerCase()) as Item | undefined, m[1], params)],
        [/^\/roleManagement\/directory\/roleEligibilitySchedules$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.roleSchedules.filter((s) => s.kind === "eligible" && notEnded(s)).map((s) => withPrincipal(roleSchedule(s), s.principalId, expand)), params));
        }],
        [/^\/roleManagement\/directory\/roleAssignmentSchedules$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(activeRoles().map((s) => withPrincipal(roleSchedule(s), s.principalId, expand)), params));
        }],
        [/^\/roleManagement\/directory\/roleAssignmentScheduleInstances$/, (_m, params) => list(query(activeRoles().map(roleInstance), params))],
        [/^\/roleManagement\/directory\/roleEligibilityScheduleInstances$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.roleSchedules.filter((s) => s.kind === "eligible" && isCurrent(s)).map((s) => withPrincipal(roleInstance(s), s.principalId, expand)), params));
        }],
        // Every active role assignment, PIM or not; the app compares it with the schedules (assignmentKinds.ts)
        [/^\/roleManagement\/directory\/roleAssignments$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(activeRoles().map((s) => withPrincipal({ id: `${s.id}-assignment`, roleDefinitionId: s.roleDefinitionId, principalId: s.principalId, directoryScopeId: s.directoryScopeId }, s.principalId, expand, true)), params));
        }],
        [/^\/roleManagement\/directory\/role(Eligibility|Assignment)ScheduleRequests$/, () => list([])],

        // The signed-in admin's own roles and groups (Configure access check, spec 3.1)
        [/^\/roleManagement\/directory\/roleAssignmentScheduleInstances\/filterByCurrentUser\(on='principal'\)$/, (_m, params) =>
            list(query(activeRoles().filter((s) => s.principalId === tenant.signedInUserId).map(roleInstance), params))],
        [/^\/roleManagement\/directory\/roleEligibilityScheduleInstances\/filterByCurrentUser\(on='principal'\)$/, (_m, params) =>
            list(query(tenant.roleSchedules.filter((s) => s.kind === "eligible" && isCurrent(s) && s.principalId === tenant.signedInUserId).map(roleInstance), params))],
        [/^\/me\/ownedObjects\/microsoft\.graph\.group$/, (_m, params) => {
            const me = tenant.signedInUserId.toLowerCase();
            const owned = tenant.groups.filter((g) => groupPeople(g, "owner").includes(me));
            return list(query(owned.map(groupObject), params));
        }],
        [/^\/identityGovernance\/privilegedAccess\/group\/(eligibility|assignment)ScheduleInstances\/filterByCurrentUser\(on='principal'\)$/, (m, params) => {
            const kind = m[1] === "eligibility" ? "eligible" : "active";
            // The group API answers its enums in lower case (tenant test T2b)
            return list(query(tenant.groupSchedules.filter((s) => s.kind === kind && isCurrent(s) && s.principalId === tenant.signedInUserId).map((s) => {
                const instance = groupInstance(s);
                return { ...instance, memberType: "direct", ...(typeof instance.assignmentType === "string" ? { assignmentType: instance.assignmentType.toLowerCase() } : {}) };
            }), params));
        }],
        [/^\/(?:directory\/)?administrativeUnits\/([^/]+)\/members\/microsoft\.graph\.group$/, (m, params) => {
            const unit = tenant.administrativeUnits.find((a) => a.id.toLowerCase() === m[1].toLowerCase());
            if (!unit) throw notFound(m[1]);
            const ids = new Set((unit.groupMembers ?? []).map((id) => id.toLowerCase()));
            return list(query(tenant.groups.filter((g) => ids.has(g.id.toLowerCase())).map(groupObject), params));
        }],

        // Policies of roles and groups
        [/^\/policies\/roleManagementPolicyAssignments$/, (_m, params) => {
            denyPolicyRead(params.get("$filter"));
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.policies.map((p) => policyAssignment(p, expand)), params));
        }],
        [/^\/policies\/roleManagementPolicies\/([^/]+)$/, (m, params) => {
            const policy = tenant.policies.find((p) => p.id === m[1]);
            return one(policy ? { id: policy.id, displayName: policy.displayName, scopeId: policy.scopeId, scopeType: policy.scopeType, rules: policy.rules } : null, m[1], params);
        }],
        [/^\/policies\/roleManagementPolicies\/([^/]+)\/rules$/, (m) => {
            const policy = tenant.policies.find((p) => p.id === m[1]);
            if (!policy) throw notFound(m[1]);
            return list(policy.rules);
        }],
        [/^\/identity\/conditionalAccess\/authenticationContextClassReferences$/, (_m, params) => list(query(tenant.authenticationContexts.map((c) => ({ ...c })), params))],
        [/^\/identity\/conditionalAccess\/policies$/, (_m, params) => list(query(tenant.conditionalAccessPolicies.map((p) => ({ ...p }) as unknown as Item), params))],

        // Security alerts: navigation properties only when expanded
        [/^\/identityGovernance\/roleManagementAlerts\/alerts$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.alerts.map((a) => {
                const { alertDefinition, alertConfiguration, alertIncidents, ...rest } = a;
                return {
                    ...rest,
                    ...("alertDefinition" in expand ? { alertDefinition } : {}),
                    ...("alertConfiguration" in expand ? { alertConfiguration } : {}),
                    ...("alertIncidents" in expand ? { alertIncidents } : {}),
                };
            }), params));
        }],

        // PIM Custom Extensions (preview)
        [/^\/identityGovernance\/privilegedAccess\/customExtensions$/, () => list(tenant.customExtensions.map((e) => ({
            "@odata.type": "#microsoft.graph.roleManagementCustomCalloutExtension",
            id: e.id,
            displayName: e.displayName,
            description: e.description,
            customAttributes: [],
            endpointConfiguration: { "@odata.type": "#microsoft.graph.httpRequestEndpoint", targetUrl: e.targetUrl },
            clientConfiguration: { timeoutInMilliseconds: 10000, maximumRetries: 1 },
            authenticationConfiguration: { "@odata.type": "#microsoft.graph.azureAdPopTokenAuthentication", resourceId: `api://contoso-pim.azure-api.net/${e.id}` },
        })))],

        // PIM for Groups
        [/^\/identityGovernance\/privilegedAccess\/group\/resources$/, (_m, params) => list(query(tenant.groups.filter((g) => g.isPimManaged).map((g) => ({ id: g.id, displayName: g.displayName, type: "Security", externalId: g.id })), params))],
        [/^\/identityGovernance\/privilegedAccess\/group\/eligibilityScheduleInstances$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.groupSchedules.filter((s) => s.kind === "eligible" && isCurrent(s)).map((s) => withPrincipal(groupInstance(s), s.principalId, expand)), params));
        }],
        [/^\/identityGovernance\/privilegedAccess\/group\/assignmentScheduleInstances$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.groupSchedules.filter((s) => s.kind === "active" && isCurrent(s)).map((s) => withPrincipal(groupInstance(s), s.principalId, expand)), params));
        }],
        [/^\/identityGovernance\/privilegedAccess\/group\/eligibilitySchedules$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.groupSchedules.filter((s) => s.kind === "eligible" && notEnded(s)).map((s) => withPrincipal(groupSchedule(s), s.principalId, expand)), params));
        }],
        [/^\/identityGovernance\/privilegedAccess\/group\/assignmentSchedules$/, (_m, params) => {
            const expand = parseExpand(params.get("$expand"));
            return list(query(tenant.groupSchedules.filter((s) => s.kind === "active" && notEnded(s)).map((s) => withPrincipal(groupSchedule(s), s.principalId, expand)), params));
        }],
        [/^\/identityGovernance\/privilegedAccess\/group\/(eligibility|assignment)ScheduleRequests$/, () => list([])],

        // Users, groups, applications, administrative units
        [/^\/users$/, (_m, params) => {
            const items = tenant.users.map(userObject).map(({ "@odata.type": _type, ...rest }) => { void _type; return rest; });
            return list(query(items, params));
        }],
        [/^\/users\/([^/]+)$/, (m, params) => {
            const key = decodeURIComponent(m[1]).toLowerCase();
            const user = usersById.get(key) ?? tenant.users.find((u) => u.userPrincipalName.toLowerCase() === key);
            return one(user ? userObject(user) : null, m[1], params);
        }],
        [/^\/groups$/, (_m, params) => list(query(tenant.groups.map(groupObject), params))],
        [/^\/groups\/([^/]+)$/, (m, params) => one(groupsById.has(m[1].toLowerCase()) ? groupObject(groupsById.get(m[1].toLowerCase())!) : null, m[1], params)],
        [/^\/groups\/([^/]+)\/(members|owners)\/\$count$/, (m) => {
            const group = groupsById.get(m[1].toLowerCase());
            if (!group) throw notFound(m[1]);
            return { status: 200, headers: { "content-type": "text/plain" }, body: String(groupPeople(group, m[2] === "members" ? "member" : "owner").length) };
        }],
        [/^\/groups\/([^/]+)\/(members|owners)$/, (m, params) => {
            const group = groupsById.get(m[1].toLowerCase());
            if (!group) throw notFound(m[1]);
            const ids = groupPeople(group, m[2] === "members" ? "member" : "owner");
            return list(query(ids.map(anyObject).filter((o): o is Item => o !== null), params));
        }],
        [/^\/servicePrincipals$/, (_m, params) => list(query(tenant.servicePrincipals.map((s) => spObject(s)), params))],
        [/^\/servicePrincipals\/([^/]+)$/, (m, params) => {
            const sp = spsById.get(m[1].toLowerCase());
            return one(sp ? spObject(sp) : null, m[1], params);
        }],
        [/^\/applications$/, (_m, params) => list(query(tenant.applications.map((a) => ({ ...a }) as Item), params))],
        [/^\/applications\/([^/]+)$/, (m, params) => one(tenant.applications.find((a) => a.id.toLowerCase() === m[1].toLowerCase()) as Item | undefined, m[1], params)],
        [/^\/directoryObjects\/([^/]+)$/, (m, params) => one(anyObject(m[1]), m[1], params)],
        [/^\/(?:directory\/)?administrativeUnits$/, (_m, params) => list(query(tenant.administrativeUnits.map((a) => ({ ...a })), params))],
        [/^\/(?:directory\/)?administrativeUnits\/([^/]+)$/, (m, params) => one(tenant.administrativeUnits.find((a) => a.id.toLowerCase() === m[1].toLowerCase()) as Item | undefined, m[1], params)],
    ];

    const parse = (url: string): { path: string; params: URLSearchParams } => {
        const parsed = new URL(url, "https://graph.microsoft.com/v1.0/");
        // Absolute: /v1.0/... or /beta/...; relative ($batch): the path as given
        const path = parsed.pathname.replace(/^\/(v1\.0|beta)(?=\/)/, "").replace(/\/+$/, "") || "/";
        return { path: decodeURI(path), params: parsed.searchParams };
    };

    /** A policy read the user may not make answers 403 `Authorization_RequestDenied`, as Graph does (no retry helps) */
    const denyPolicyRead = (filter: string | null) => {
        const scope = (filter ?? "").match(/scopeId eq '([^']*)' and scopeType eq '([^']*)'/);
        if (!scope || !options.policyReadDenied) return;
        if (options.policyReadDenied({ scopeId: scope[1], scopeType: scope[2] })) {
            throw new HttpError(403, "Authorization_RequestDenied", "Insufficient privileges to complete the operation.");
        }
    };

    const handleOne = (request: GraphRequest): GraphResponse => {
        const method = request.method.toUpperCase();
        const { path, params } = parse(request.url);
        try {
            if (method === "POST" && path === "/$batch") {
                const requests = ((request.body as { requests?: Array<{ id: string; method: string; url: string; body?: unknown }> })?.requests) ?? [];
                return json(200, {
                    responses: requests.map((sub) => {
                        const response = handleOne({ method: sub.method, url: sub.url.startsWith("/") ? sub.url : `/${sub.url}`, body: sub.body });
                        return { id: sub.id, status: response.status, headers: response.headers, body: response.body };
                    }),
                });
            }
            // A dry run (`isValidationOnly`) writes nothing, so the demo answers it like Microsoft accepts it
            if (method === "POST" && VALIDATION_PATHS.test(path) && (request.body as { isValidationOnly?: unknown } | undefined)?.isValidationOnly === true) {
                return json(201, { ...(request.body as Record<string, unknown>), id: "00000000-0000-0000-0000-00000000dead", status: "Granted" });
            }
            if (method !== "GET") throw new HttpError(403, DEMO_WRITE_ERROR_CODE, DEMO_WRITE_MESSAGE);
            for (const [pattern, handler] of routes) {
                const match = path.match(pattern);
                if (match) return handler(match, params);
            }
            options.onUnhandled?.(request);
            throw notFound(path);
        } catch (error) {
            if (error instanceof HttpError) {
                return json(error.status, { error: { code: error.code, message: error.message, innerError: { "request-id": "demo", date: new Date(now()).toISOString() } } });
            }
            throw error;
        }
    };

    return { handle: handleOne };
}
