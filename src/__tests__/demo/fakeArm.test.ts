import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AZURE_CUSTOM_ROLES, AZURE_PRIVILEGED_ROLES, AZURE_ROLES, AZURE_SCOPE_IDS, FABRIKAM_TENANT_ID, buildContosoAzure } from "@/demo/contoso/azure";
import { DEMO_ACCOUNT } from "@/demo/contoso/account";
import { GROUPS } from "@/demo/contoso/tenant";
import { ARM_API_VERSIONS, createFakeArm, type ArmRequest } from "@/demo/arm/server";
import { DEMO_WRITE_ERROR_CODE } from "@/demo/graph/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { listResourceGroups, listResources, listSubscriptions } from "@/services/azureScopeService";
import { listAssignmentInstances, listAssignmentInstancesAt, listEligibilitySchedules, listEligibilitySchedulesAt, listMyAssignments, listMyEligibilities } from "@/services/azureAssignmentService";
import { getRoleDefinition } from "@/services/azureRoleDefinitionService";
import { ArmError, createArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";

/**
 * The demo answers ARM in the tab. This test makes the reads of the Azure Report (implementation spec sections 4 and 15) through
 * the real ARM client and the demo `fetch`: every read must be answered, in the shape the app reads, and no ARM request
 * may reach the network. The Azure services make their calls here too.
 */

const now = new Date();
const azure = buildContosoAzure(now);
const unhandled: ArmRequest[] = [];
const arm = createFakeArm(azure, { onUnhandled: (r) => unhandled.push(r) });
const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));
const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });
const AUTH = "/providers/Microsoft.Authorization";
const S = AZURE_SCOPE_IDS;

type Instance = { id: string; name: string; type: string; properties: Record<string, unknown> & { scope: string; memberType: string; principalId: string; expandedProperties: { scope: { type: string; id: string } } } };
/** The subscriptions the demo account reads as a whole; Contoso Labs it reads only below its own level */
const WHOLE = azure.subscriptions.filter((s) => !s.readableScopes);
/** Those in the Contoso tree: the delegated subscription inherits nothing from the Contoso root or Tenant Root Group */
const WHOLE_IN_TREE = WHOLE.filter((s) => s.tenantId === undefined);

type Policy = { id: string; properties: { scope: string; rules: Array<Record<string, unknown>>; effectiveRules: unknown[] } };

const roleFilter = (scope: string, roleId: string) => ({ $filter: `roleDefinitionId eq '${scope}${AUTH}/roleDefinitions/${roleId}'` });
const CUSTOM_ROLE_ID = "6c2f0a3e-5b1d-4c8e-9a47-0d3b1e2f7a91";

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph in this test")), arm: async () => arm, realFetch }));
});
afterAll(() => {
    vi.unstubAllGlobals();
    expect(realFetch).not.toHaveBeenCalled();
});

describe("the Azure Report's reads against the fake ARM", () => {
    it("lists the five subscriptions, the delegated one with the tenant id of its own tenant", async () => {
        const subscriptions = await client.getAll<{ id: string; subscriptionId: string; displayName: string; state: string; tenantId: string }>("/subscriptions", ARM_API_VERSIONS.subscriptions);
        expect(subscriptions.map((s) => s.displayName)).toEqual(["Contoso Production", "Contoso Test", "Contoso Labs", "Contoso Corp Apps", "Fabrikam Production"]);
        expect(subscriptions.every((s) => s.id === `/subscriptions/${s.subscriptionId}` && s.state === "Enabled")).toBe(true);
        expect(subscriptions.filter((s) => s.displayName !== "Fabrikam Production").every((s) => s.tenantId === azure.tenantId)).toBe(true);
        expect(subscriptions.find((s) => s.displayName === "Fabrikam Production")?.tenantId).toBe(FABRIKAM_TENANT_ID);
    });

    it("answers both instance lists at every subscription read as a whole, with items at, below and above it", async () => {
        for (const subscription of WHOLE_IN_TREE) {
            const path = `/subscriptions/${subscription.subscriptionId}${AUTH}`;
            const active = await client.getAll<Instance>(`${path}/roleAssignmentScheduleInstances`, ARM_API_VERSIONS.authorization);
            const eligible = await client.getAll<Instance>(`${path}/roleEligibilityScheduleInstances`, ARM_API_VERSIONS.authorization);
            expect(active.length).toBeGreaterThan(0);
            expect(eligible.length).toBeGreaterThan(0);
            // Inherited from the root and the Tenant Root Group, as in the spike fixtures
            const inherited = active.filter((i) => i.properties.memberType === "Inherited").map((i) => i.properties.expandedProperties.scope.type);
            expect(inherited).toEqual(expect.arrayContaining(["tenant", "managementgroup"]));
            for (const item of [...active, ...eligible]) {
                expect(item.id).toBe(`${item.properties.scope === "/" ? "" : item.properties.scope}${AUTH}/${item.type.split("/")[1]}/${item.name}`);
                expect(item.properties.roleDefinitionId).toMatch(new RegExp(`^/subscriptions/${subscription.subscriptionId}${AUTH}/roleDefinitions/`));
            }
        }
    });

    it("has the shapes the Report shows: below the subscription, on a resource, activated, permanent and time-bound", async () => {
        const path = `${S.production}${AUTH}`;
        const active = await client.getAll<Instance>(`${path}/roleAssignmentScheduleInstances`, ARM_API_VERSIONS.authorization);
        const eligible = await client.getAll<Instance>(`${path}/roleEligibilityScheduleInstances`, ARM_API_VERSIONS.authorization);
        const types = new Set([...active, ...eligible].map((i) => i.properties.expandedProperties.scope.type));
        expect([...types]).toEqual(expect.arrayContaining(["tenant", "managementgroup", "subscription", "resourcegroup", "resource"]));

        const activated = active.find((i) => i.properties.assignmentType === "Activated");
        expect(activated?.properties.linkedRoleEligibilityScheduleId).toBe(eligible.find((e) => e.properties.principalId === activated?.properties.principalId && e.properties.scope === activated?.properties.scope)?.properties.roleEligibilityScheduleId);
        expect(active.some((i) => i.properties.assignmentType === "Assigned" && !("endDateTime" in i.properties))).toBe(true);
        expect(active.some((i) => typeof i.properties.endDateTime === "string")).toBe(true);
        // Eligibility instances carry no assignment fields (Learn, 2020-10-01)
        expect(eligible.every((i) => !("assignmentType" in i.properties) && !("linkedRoleEligibilityScheduleId" in i.properties))).toBe(true);
        expect(active.some((i) => i.properties.principalType === "Group" && i.properties.principalId === GROUPS.platform.id)).toBe(true);
    });

    it("answers the eligibility schedules with the same items as the eligibility instances, as schedules", async () => {
        for (const subscription of WHOLE_IN_TREE) {
            const path = `/subscriptions/${subscription.subscriptionId}${AUTH}`;
            // The custom roles are left out here: the instance list leaves out one not assignable at the listed scope, the schedules keep it (checked below)
            const customIds = Object.values(AZURE_CUSTOM_ROLES).map((r) => r.id);
            const notCustom = (i: Instance) => !customIds.some((id) => String(i.properties.roleDefinitionId).endsWith(`/${id}`));
            const instances = (await client.getAll<Instance>(`${path}/roleEligibilityScheduleInstances`, ARM_API_VERSIONS.authorization)).filter(notCustom);
            const schedules = (await client.getAll<Instance>(`${path}/roleEligibilitySchedules`, ARM_API_VERSIONS.authorization)).filter(notCustom);
            const key = (i: Instance) => `${i.properties.principalId}|${i.properties.scope}|${i.properties.roleDefinitionId}`;
            expect(schedules.map(key).sort()).toEqual(instances.map(key).sort());
            for (const schedule of schedules) {
                expect(schedule.type).toBe("Microsoft.Authorization/roleEligibilitySchedules");
                expect(schedule.id).toBe(`${schedule.properties.scope === "/" ? "" : schedule.properties.scope}${AUTH}/roleEligibilitySchedules/${schedule.name}`);
                // A schedule names its request, not a schedule (measured 2026-10-22)
                expect("roleEligibilityScheduleId" in schedule.properties).toBe(false);
                expect(schedule.properties.roleEligibilityScheduleRequestId).toMatch(/\/roleEligibilityScheduleRequests\//);
            }
            // The id an activation links to is the schedule's own id
            const instanceSchedules = new Set(instances.map((i) => String(i.properties.roleEligibilityScheduleId).toLowerCase()));
            expect(schedules.every((sch) => instanceSchedules.has(sch.id.toLowerCase()))).toBe(true);
        }
    });

    it("answers an eligible custom role at the scope it is assignable at, and leaves it out of the instances above that scope", async () => {
        const principal = azure.instances.find((i) => i.key === "e:rgweb-weboperator-grady")?.principal.id;
        expect(principal).toBeDefined();
        const custom = async (scope: string, list: string) =>
            (await client.getAll<Instance>(`${scope}${AUTH}/${list}`, ARM_API_VERSIONS.authorization)).filter((i) => i.properties.principalId === principal && String(i.properties.roleDefinitionId).endsWith(`/${CUSTOM_ROLE_ID}`));
        expect(await custom(S.production, "roleEligibilitySchedules")).toHaveLength(1);
        expect(await custom(S.production, "roleEligibilityScheduleInstances")).toHaveLength(0);
        expect(await custom(S.rgWeb, "roleEligibilitySchedules")).toHaveLength(1);
        const [item] = await custom(S.rgWeb, "roleEligibilityScheduleInstances");
        expect(item).toBeDefined();
        expect((item.properties.expandedProperties as unknown as { roleDefinition: { type: string } }).roleDefinition.type).toBe("CustomRole");

        const response = await fetch(`https://management.azure.com${S.rgWeb}${AUTH}/roleDefinitions/${CUSTOM_ROLE_ID}?api-version=${ARM_API_VERSIONS.roleDefinitions}`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { properties: { type: string; assignableScopes: string[] } };
        expect(body.properties).toMatchObject({ type: "CustomRole", assignableScopes: [S.rgWeb] });
    });

    it("keeps the other subscription's items out", async () => {
        const active = await client.getAll<Instance>(`${S.test}${AUTH}/roleAssignmentScheduleInstances`, ARM_API_VERSIONS.authorization);
        expect(active.some((i) => i.properties.scope.toLowerCase().startsWith(S.production.toLowerCase()))).toBe(false);
    });

    it("answers the signed-in user's own eligible roles at root scope with asTarget()", async () => {
        const mine = await client.getAll<Instance>(`${AUTH}/roleEligibilityScheduleInstances`, ARM_API_VERSIONS.authorization, { $filter: "asTarget()" });
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((i) => i.properties.principalId === DEMO_ACCOUNT.id && i.properties.memberType === "Direct")).toBe(true);
        expect(mine.every((i) => i.properties.roleDefinitionId === `${AUTH}/roleDefinitions/${String(i.properties.roleDefinitionId).split("/").pop()}`)).toBe(true);
    });

    it("answers one role's policy at a scope, and 400 ResourceNotFound for a role without one", async () => {
        for (const scope of [S.tenantRootGroup, S.platform, S.production, S.test, S.rgWeb, S.rgData, S.rgSandbox, S.storage, S.keyVault, S.appService, S.eventHub]) {
            for (const role of AZURE_PRIVILEGED_ROLES) {
                const [policy, ...rest] = await client.getAll<Policy>(`${scope}${AUTH}/roleManagementPolicies`, ARM_API_VERSIONS.authorization, roleFilter(scope, role.id));
                expect(rest).toEqual([]);
                expect(policy.properties.scope).toBe(scope);
                expect(policy.properties.rules).toHaveLength(17);
                expect(policy.properties.effectiveRules).toEqual(policy.properties.rules);
            }
        }
        const error = await client.getAll(`${S.production}${AUTH}/roleManagementPolicies`, ARM_API_VERSIONS.authorization, roleFilter(S.production, AZURE_ROLES.reader.id)).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ArmError);
        expect((error as ArmError).statusCode).toBe(400);
        expect((error as ArmError).code).toBe("ResourceNotFound");
    });

    it("shows the board's Owner settings on production, which differ from test", async () => {
        const rule = async (scope: string, id: string) => {
            const [policy] = await client.getAll<Policy>(`${scope}${AUTH}/roleManagementPolicies`, ARM_API_VERSIONS.authorization, roleFilter(scope, AZURE_ROLES.owner.id));
            return policy.properties.rules.find((r) => r.id === id);
        };
        expect(await rule(S.production, "Expiration_EndUser_Assignment")).toMatchObject({ maximumDuration: "PT8H" });
        expect(await rule(S.production, "Enablement_EndUser_Assignment")).toMatchObject({ enabledRules: ["MultiFactorAuthentication", "Justification"] });
        expect(await rule(S.production, "Approval_EndUser_Assignment")).toMatchObject({ setting: { isApprovalRequired: false } });
        expect(await rule(S.production, "Expiration_Admin_Eligibility")).toMatchObject({ maximumDuration: "P365D" });
        expect(await rule(S.test, "Enablement_EndUser_Assignment")).toMatchObject({ enabledRules: ["Justification"] });
        expect(await rule(S.platform, "Approval_EndUser_Assignment")).toMatchObject({
            setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: [{ id: GROUPS.securityLeads.id, userType: "Group" }] }] },
        });
    });

    it("refuses the lists at Contoso Labs with 400 InsufficientPermissions and answers the scopes below it the account can read", async () => {
        for (const list of ["roleAssignmentScheduleInstances", "roleEligibilityScheduleInstances", "roleEligibilitySchedules"]) {
            const error = await client.getAll(`${S.labs}${AUTH}/${list}`, ARM_API_VERSIONS.authorization).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ArmError);
            expect((error as ArmError).statusCode).toBe(400);
            expect((error as ArmError).code).toBe("InsufficientPermissions");
        }
        const labsId = S.labs.split("/")[2];
        expect((await listResourceGroups(client, labsId)).map((g) => g.id)).toEqual([S.rgLabs]);
        expect((await listResources(client, labsId)).map((r) => r.id).sort()).toEqual([S.labsVault, S.labsVm].sort());
        // At a readable scope: its own items and what is inherited onto it, never rg-private
        const atGroup = [...await listAssignmentInstancesAt(client, S.rgLabs), ...await listEligibilitySchedulesAt(client, S.rgLabs)];
        expect(atGroup.map((i) => i.properties.scope)).toEqual(expect.arrayContaining([S.rgLabs, S.labsVault, S.labs, S.root]));
        const atVm = await listAssignmentInstancesAt(client, S.labsVm);
        expect(atVm.map((i) => i.properties.scope)).toEqual(expect.arrayContaining([S.labsVm, S.labs]));
        expect([...atGroup, ...atVm].some((i) => i.properties.scope.toLowerCase().startsWith(S.rgPrivate.toLowerCase()))).toBe(false);
        const refused = await listAssignmentInstancesAt(client, S.rgPrivate).catch((e: unknown) => e);
        expect((refused as ArmError).code).toBe("InsufficientPermissions");
    });

    it("lists every resource group and resource of a subscription read as a whole", async () => {
        const productionId = S.production.split("/")[2];
        expect((await listResourceGroups(client, productionId)).map((g) => g.id).sort()).toEqual([S.rgWeb, S.rgData].sort());
        expect(await listResources(client, productionId)).toHaveLength(4);
    });

    it("answers every call of the Azure read services", async () => {
        const subscriptions = await listSubscriptions(client);
        expect(subscriptions.map((s) => s.subscriptionId)).toEqual(azure.subscriptions.map((s) => s.subscriptionId));
        for (const subscription of subscriptions.filter((s) => WHOLE.some((w) => w.subscriptionId === s.subscriptionId))) {
            expect((await listAssignmentInstances(client, subscription.subscriptionId)).length).toBeGreaterThan(0);
            expect((await listEligibilitySchedules(client, subscription.subscriptionId)).length).toBeGreaterThan(0);
        }
        const mine = await listMyEligibilities(client);
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((i) => i.properties.principalId === DEMO_ACCOUNT.id)).toBe(true);
        const myActive = await listMyAssignments(client);
        expect(myActive.length).toBeGreaterThan(0);
        expect(myActive.every((i) => i.properties.principalId === DEMO_ACCOUNT.id)).toBe(true);
    });

    it("answers a role definition at any scope with its Learn description and actions, and 404 for an unknown role", async () => {
        for (const scope of [S.root, S.platform, S.production, S.rgWeb, S.keyVault]) {
            for (const role of Object.values(AZURE_ROLES)) {
                const definition = await getRoleDefinition(client, scope, role.id);
                expect(definition.properties).toMatchObject({ roleName: role.displayName, description: role.description, type: "BuiltInRole" });
                expect(definition.id).toBe(`${scope === "/" ? "" : scope}${AUTH}/roleDefinitions/${role.id}`);
            }
        }
        const owner = await fetch(`https://management.azure.com${S.production}${AUTH}/roleDefinitions/${AZURE_ROLES.owner.id}?api-version=${ARM_API_VERSIONS.roleDefinitions}`);
        expect(((await owner.json()) as { properties: { permissions: Array<{ actions: string[] }> } }).properties.permissions[0].actions).toEqual(["*"]);
        expect(AZURE_CUSTOM_ROLES.contosoPlatformOperator.custom.assignableScopes).toEqual([S.platform]);
        const error = await getRoleDefinition(client, S.production, "00000000-0000-0000-0000-000000000000").catch((e: unknown) => e);
        expect((error as ArmError).statusCode).toBe(404);
    });

    it("lists the role definitions with their actions, by type, at the root and at a subscription", async () => {
        type Definition = { properties: { roleName: string; type: string; permissions: Array<{ actions: string[] }> } };
        const typed = (scope: string, type: string) => client.getAll<Definition>(`${scope === "/" ? "" : scope}${AUTH}/roleDefinitions`, ARM_API_VERSIONS.roleDefinitions, { $filter: `type eq '${type}'` });
        const builtIn = await typed("/", "BuiltInRole");
        expect(builtIn).toHaveLength(7);
        expect(builtIn.every((d) => d.properties.type === "BuiltInRole" && Array.isArray(d.properties.permissions[0].actions))).toBe(true);
        expect(builtIn.find((d) => d.properties.roleName === "Owner")?.properties.permissions[0].actions).toEqual(["*"]);
        expect((await typed("/", "CustomRole")).map((d) => d.properties.roleName).sort()).toEqual(["Contoso Platform Operator", "Contoso Web Operator"]);
        // One assignable below the subscription, one above it
        expect((await typed(S.production, "CustomRole")).map((d) => d.properties.roleName).sort()).toEqual(["Contoso Platform Operator", "Contoso Web Operator"]);
        expect(await typed(S.corpApps, "CustomRole")).toEqual([]);
    });

    it("answers the PIM alerts of a subscription, and the errors ARM gives elsewhere", async () => {
        type Alert = { name: string; properties: { isActive: boolean; incidentCount: number; lastScannedDateTime: string } };
        const alerts = (scope: string) => client.getAll<Alert>(`${scope}${AUTH}/roleManagementAlerts`, ARM_API_VERSIONS.alerts);
        const NEVER = "0001-01-01T00:00:00-08:00";
        const production = await alerts(S.production);
        expect(production).toHaveLength(4);
        for (const alert of production) {
            const permanent = alert.name === "TooManyPermanentOwnersAssignedToResource";
            expect(alert.properties.isActive).toBe(permanent);
            if (permanent) expect(alert.properties.incidentCount).toBe(2);
            expect(alert.properties.lastScannedDateTime).not.toBe(NEVER);
        }
        const fabrikam = await alerts(S.fabrikamProd);
        expect(fabrikam).toHaveLength(4);
        expect(fabrikam.every((a) => !a.properties.isActive && a.properties.lastScannedDateTime === NEVER)).toBe(true);
        const labs = await alerts(S.labs).catch((e: unknown) => e);
        expect(labs).toBeInstanceOf(ArmError);
        expect((labs as ArmError).statusCode).toBe(403);
        expect((labs as ArmError).code).toBe("AuthorizationFailed");
        const group = await alerts(S.platform).catch((e: unknown) => e);
        expect(group).toBeInstanceOf(ArmError);
        expect((group as ArmError).statusCode).toBe(400);
        expect((group as ArmError).code).toBe("ResourceTypeNotSupportedForAlert");
    });

    it("holds a managed identity, an agent and a delegated subscription with their own principals and no inheritance", async () => {
        const active = (scope: string) => client.getAll<Instance>(`${scope}${AUTH}/roleAssignmentScheduleInstances`, ARM_API_VERSIONS.authorization);
        const name = (i: Instance) => (i.properties.expandedProperties as unknown as { principal: { displayName: string } }).principal.displayName;
        const corp = await active(S.corpApps);
        expect(corp.some((i) => i.properties.principalType === "ServicePrincipal" && name(i) === "mi-aks-contoso-corp")).toBe(true);
        const corpGroup = await active(S.rgCorpApps);
        expect(corpGroup.some((i) => i.properties.principalType === "AgentIdentity" && name(i) === "Contoso Ops Agent")).toBe(true);
        const fabrikam = [...await active(S.fabrikamProd), ...await client.getAll<Instance>(`${S.fabrikamProd}${AUTH}/roleEligibilityScheduleInstances`, ARM_API_VERSIONS.authorization)];
        expect(fabrikam.length).toBeGreaterThan(0);
        expect(fabrikam.every((i) => i.properties.memberType === "Direct" && i.properties.scope.toLowerCase().startsWith(S.fabrikamProd.toLowerCase()))).toBe(true);
    });

    it("left nothing unanswered", () => {
        expect(unhandled).toEqual([]);
    });
});

describe("getEntities against the fake ARM", () => {
    type Entity = { id: string; name: string; type: string; properties: { displayName: string; parent: { id?: string }; tenantId: string } };

    it("answers POST as a read, with the Contoso hierarchy and without the delegated subscription", async () => {
        const entities = await client.postAll<Entity>("/providers/Microsoft.Management/getEntities", ARM_API_VERSIONS.managementGroups);
        const parentOf = (id: string) => entities.find((e) => e.id === id)?.properties.parent.id;
        expect(parentOf(S.tenantRootGroup)).toBeUndefined();
        expect(parentOf(S.landingZones)).toBe(S.tenantRootGroup);
        expect(parentOf(S.corp)).toBe(S.landingZones);
        expect(parentOf(S.corpApps)).toBe(S.corp);
        expect(entities.find((e) => e.id === S.corp)?.properties.displayName).toBe("Corp");
        expect(entities.some((e) => e.id === S.fabrikamProd)).toBe(false);
        expect(entities.some((e) => e.id === S.root || e.id === S.rgWeb)).toBe(false);
    });

    it("still refuses another POST and another api-version", () => {
        const seen: ArmRequest[] = [];
        const fake = createFakeArm(azure, { onUnhandled: (r) => seen.push(r) });
        const post = (url: string) => fake.handle({ method: "POST", url: `https://management.azure.com${url}` });
        expect(post(`/providers/Microsoft.Management/getEntities?api-version=${ARM_API_VERSIONS.managementGroups}`).status).toBe(200);
        expect(post("/providers/Microsoft.Management/getEntities?api-version=2023-04-01").status).toBe(404);
        expect(post(`/providers/Microsoft.Management/managementGroups/x?api-version=${ARM_API_VERSIONS.managementGroups}`).status).toBe(403);
        expect(seen).toHaveLength(1);
    });
});

describe("the fake ARM's edges", () => {
    it("refuses every write with 403 DemoEnvironment", async () => {
        for (const method of ["PUT", "PATCH", "POST", "DELETE"]) {
            const response = await fetch(`https://management.azure.com${S.production}${AUTH}/roleEligibilityScheduleRequests/x?api-version=2020-10-01`, { method, body: method === "DELETE" ? undefined : "{}" });
            expect(response.status).toBe(403);
            expect(((await response.json()) as { error: { code: string } }).error.code).toBe(DEMO_WRITE_ERROR_CODE);
        }
    });

    it("answers an unknown read, another api-version or another filter with 404 and reports it", async () => {
        const seen: ArmRequest[] = [];
        const fake = createFakeArm(azure, { onUnhandled: (r) => seen.push(r) });
        const get = (url: string) => fake.handle({ method: "GET", url: `https://management.azure.com${url}` });
        expect(get(`${S.production}/resourcegroups?api-version=2022-09-01`).status).toBe(404);
        expect(get(`${S.production}${AUTH}/roleAssignmentScheduleInstances?api-version=2022-04-01`).status).toBe(404);
        expect(get(`${S.production}${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01&$filter=atScope()`).status).toBe(404);
        expect(get(`/subscriptions/00000000-0000-0000-0000-000000000000${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01`).status).toBe(404);
        // A role definition list needs the type filter
        expect(get(`${AUTH}/roleDefinitions?api-version=${ARM_API_VERSIONS.roleDefinitions}`).status).toBe(404);
        expect(seen).toHaveLength(5);
    });

    it("sends no ARM request to the network, also without a fake ARM", async () => {
        const network = vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}")));
        const withoutArm = createDemoFetch({ graph: () => Promise.reject(new Error("no Graph")), realFetch: network });
        await expect(withoutArm(`https://management.azure.com/subscriptions?api-version=${ARM_API_VERSIONS.subscriptions}`)).rejects.toThrow(TypeError);
        expect(network).not.toHaveBeenCalled();
    });
});
