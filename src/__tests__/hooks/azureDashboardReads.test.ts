import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { definitionsOf, loadAzureRoleDefinitions, loadAzureServicePrincipalTypes, planAzureDashboardReads, resetAzureDashboardForRefresh, resetAzureDashboardLoadCache, resetAzureRoleDefinitions, runAzureDashboardReads, type AzureDashboardReads } from "@/hooks/useAzureDashboardReads";
import { resetAzureRolePolicies } from "@/hooks/useAzureRolePolicy";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { createArmClient } from "@/utils/armClient";
import { createGraphClient } from "@/utils/graphClient";
import { RateLimiter } from "@/utils/rateLimiter";
import { AZURE_SCOPE_IDS, buildContosoAzure, DELETED_AZURE_PRINCIPAL } from "@/demo/contoso/azure";
import { CONTOSO_TENANT_ID } from "@/demo/contoso/ids";
import { DELETED_PRINCIPAL } from "@/utils/azureDashboard";
import { buildContosoTenant } from "@/demo/contoso/tenant";
import { createFakeArm, type ArmRequest } from "@/demo/arm/server";
import { createFakeGraph, type GraphRequest } from "@/demo/graph/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { AZURE_INITIAL_EXTRAS, azureAssignmentsAdapter, type AzureExtras } from "@/workloads/azureAssignmentsAdapter";
import type { WorkloadRunContext } from "@/workloads/types";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";
import { createRecordingClient, graphError } from "../support/recordingGraphClient";

/**
 * The reads of the Azure dashboard: what is asked for (pure), the order and outcomes of a run with recording clients,
 * one run against the demo, and the request budget. Nothing here reaches ARM or Graph.
 */

const OWNER = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const READER = "acdd72a7-3385-48ef-bd42-f606fba81ae7";
const S1 = "aaaaaaaa-0000-0000-0000-000000000001";
const S2 = "aaaaaaaa-0000-0000-0000-000000000002";
const MG = "/providers/Microsoft.Management/managementGroups/mg1";
const SP1 = "BBBBBBBB-0000-0000-0000-000000000001";
const SP2 = "bbbbbbbb-0000-0000-0000-000000000002";
const AUTH = "/providers/Microsoft.Authorization";

let counter = 0;
function assignment(scopeId: string, roleDefinitionId: string, extra: Partial<AzureAssignment> = {}): AzureAssignment {
    counter++;
    return {
        id: `${scopeId}${AUTH}/roleAssignmentScheduleInstances/a${counter}`,
        scopeId,
        principalId: `user-${counter}`,
        principalName: `Person ${counter}`,
        principalType: "User",
        roleDefinitionId,
        roleName: "Role",
        state: "active",
        memberType: "direct",
        endDateTime: null,
        ...extra,
    };
}

const scope = (id: string, level: AzureScope["level"], extra: Partial<AzureScope> = {}): AzureScope => ({ id, name: id, level, parentId: null, ...extra });
const SCOPES: AzureScope[] = [scope(MG, "managementGroup"), scope(`/subscriptions/${S1}`, "subscription"), scope(`/subscriptions/${S2}`, "subscription", { access: "partial" })];

const FIXTURE: AzureAssignment[] = [
    assignment(`/subscriptions/${S1}`, OWNER, { principalType: "ServicePrincipal", principalId: SP1 }),
    // The same item twice gives one pair
    assignment(`/subscriptions/${S1}`, OWNER, { principalType: "ServicePrincipal", principalId: SP1 }),
    // A management group item arrives inherited from every subscription, its settings live at its own scope
    assignment(MG, OWNER, { memberType: "inherited", principalType: "ServicePrincipal", principalId: SP2 }),
    // The root is never a pair
    assignment("/", OWNER),
    assignment(`/subscriptions/${S1}`, READER),
    assignment(`/subscriptions/${S2}`, OWNER),
];

describe("planAzureDashboardReads", () => {
    it("plans the own pairs of privileged roles, sorted, without the root", () => {
        const plan = planAzureDashboardReads({ assignments: FIXTURE, scopes: SCOPES, definitions: null, scope: "privileged" });
        expect(plan.settingsPairs).toEqual([
            { scopeId: MG, roleDefinitionId: OWNER },
            { scopeId: `/subscriptions/${S1}`, roleDefinitionId: OWNER },
            { scopeId: `/subscriptions/${S2}`, roleDefinitionId: OWNER },
        ]);
    });

    it("plans every role for the scope all", () => {
        const plan = planAzureDashboardReads({ assignments: FIXTURE, scopes: SCOPES, definitions: null, scope: "all" });
        expect(plan.settingsPairs).toHaveLength(4);
        expect(plan.settingsPairs).toContainEqual({ scopeId: `/subscriptions/${S1}`, roleDefinitionId: READER });
    });

    it("asks no alerts of a subscription with access set, and lists the service principals once", () => {
        const plan = planAzureDashboardReads({ assignments: FIXTURE, scopes: SCOPES, definitions: null, scope: "privileged" });
        expect(plan.alertSubscriptionIds).toEqual([S1]);
        expect(plan.servicePrincipalIds.sort()).toEqual([SP1.toLowerCase(), SP2]);
    });

    it("counts a role by its actions when the definitions are known", () => {
        const custom = "6c2f0a3e-5b1d-4c8e-9a47-0d3b1e2f7a91";
        const definitions = new Map<string, ArmRoleDefinition>([[custom, { id: "x", name: custom, type: "t", properties: { roleName: "C", permissions: [{ actions: ["*"] }] } }]]);
        const assignments = [assignment(`/subscriptions/${S1}`, custom)];
        expect(planAzureDashboardReads({ assignments, scopes: SCOPES, definitions: null, scope: "privileged" }).settingsPairs).toHaveLength(0);
        expect(planAzureDashboardReads({ assignments, scopes: SCOPES, definitions, scope: "privileged" }).settingsPairs).toHaveLength(1);
    });
});

const role = (id: string, name: string, actions: string[], type = "BuiltInRole") => ({ id: `${AUTH}/roleDefinitions/${id}`, name: id, type: "Microsoft.Authorization/roleDefinitions", properties: { roleName: name, type, permissions: [{ actions }] } });

/** Recording ARM and Graph clients that write one shared log, in the order the requests arrive */
function recorded(options: { tenantStatus?: number; alertStatus?: Record<string, number>; customStatus?: Record<string, number> } = {}) {
    const log: string[] = [];
    const arm = createRecordingArmClient([
        {
            match: /\/roleDefinitions$/,
            respond: (request) => {
                const type = request.query.$filter?.includes("BuiltInRole") ? "BuiltInRole" : "CustomRole";
                const atTenant = !request.path.startsWith("/subscriptions");
                log.push(`definitions:${atTenant ? "tenant" : "subscription"}:${type}`);
                if (atTenant && options.tenantStatus === 403) return armError(403, "AuthorizationFailed");
                if (atTenant && options.tenantStatus === 500) return armError(500, "InternalServerError");
                if (!atTenant && type === "CustomRole" && options.customStatus?.[request.path.split("/")[2]] === 400) return armError(400, "BadRequest");
                return { body: { value: type === "BuiltInRole" ? [role(OWNER, "Owner", ["*"]), role(READER, "Reader", ["*/read"])] : [] } };
            },
        },
        { match: /\/roleManagementPolicies$/, respond: () => { log.push("settings"); return { body: { value: [] } }; } },
        {
            match: /\/roleManagementAlerts$/,
            respond: (request) => {
                const sub = request.path.split("/")[2];
                log.push("alerts");
                const status = options.alertStatus?.[sub];
                if (status === 403) return armError(403, "AuthorizationFailed");
                return { body: { value: [{ id: "a", name: "A", properties: { isActive: true, incidentCount: 1 } }] } };
            },
        },
    ]);
    const graph = createRecordingClient([{ match: /^\/servicePrincipals$/, respond: (request) => {
        log.push("graph");
        const asked = [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
        return { value: asked.map((id) => ({ id, servicePrincipalType: "Application" })) };
    } }]);
    return { arm, graph, log };
}

beforeEach(() => {
    resetAzureRoleDefinitions();
    resetAzureDashboardLoadCache();
    resetAzureRolePolicies();
});

const input = { assignments: FIXTURE, scopes: SCOPES, scope: "privileged" as const };

describe("runAzureDashboardReads", () => {
    it("reads the two tenant lists, the Graph types, the settings and the alerts, in that order", async () => {
        const { arm, graph, log } = recorded();
        const changes: AzureDashboardReads[] = [];
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client }, input, (r) => changes.push(r));
        expect(log).toEqual(["definitions:tenant:BuiltInRole", "definitions:tenant:CustomRole", "graph", "settings", "settings", "settings", "alerts"]);
        expect(reads.definitions).toMatchObject({ status: "loaded", source: "tenant" });
        expect(reads.spTypes.status).toBe("loaded");
        expect(reads.settings.size).toBe(3);
        expect(reads.alerts.get(S1)).toMatchObject({ status: "loaded" });
        expect(reads.alertsProgress).toEqual({ done: 1, total: 1 });
        // A fresh object after every step
        expect(new Set(changes).size).toBe(changes.length);
    });

    it("falls back to the subscriptions when the tenant list answers 403", async () => {
        const { arm, graph, log } = recorded({ tenantStatus: 403 });
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client }, input, () => undefined);
        expect(log.slice(0, 3)).toEqual(["definitions:tenant:BuiltInRole", "definitions:subscription:BuiltInRole", "definitions:subscription:CustomRole"]);
        expect(reads.definitions).toMatchObject({ status: "loaded", source: "subscriptions" });
    });

    it("gives failed definitions on a 500 and still reads the rest", async () => {
        const { arm, graph } = recorded({ tenantStatus: 500 });
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client }, input, () => undefined);
        expect(reads.definitions).toEqual({ status: "failed" });
        expect(reads.settings.size).toBe(3);
    }, 20_000);

    it("marks an alert 403 as noAccess for that subscription only", async () => {
        const { arm, graph } = recorded({ alertStatus: { [S1]: 403 } });
        const scopes = [...SCOPES.slice(0, 2), scope(`/subscriptions/${S2}`, "subscription")];
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client }, { ...input, scopes }, () => undefined);
        expect(reads.alerts.get(S1)).toEqual({ status: "noAccess" });
        expect(reads.alerts.get(S2)).toMatchObject({ status: "loaded" });
    });

    it("reads the role definitions once per page session", async () => {
        const { arm, graph, log } = recorded();
        const deps = { arm: arm.client, getGraph: async () => graph.client };
        await runAzureDashboardReads(deps, input, () => undefined);
        const first = log.filter((l) => l.startsWith("definitions")).length;
        expect(first).toBe(2);
        const second = await runAzureDashboardReads(deps, input, () => undefined);
        expect(log.filter((l) => l.startsWith("definitions"))).toHaveLength(2);
        expect(second.definitions).toMatchObject({ status: "loaded", source: "tenant" });
        resetAzureRoleDefinitions();
        await runAzureDashboardReads(deps, input, () => undefined);
        expect(log.filter((l) => l.startsWith("definitions"))).toHaveLength(4);
    });

    it("reads the principal types and alerts once per load when only the scope changes", async () => {
        const { arm, graph, log } = recorded();
        const deps = { arm: arm.client, getGraph: async () => graph.client, loadKey: "load-1" };
        await runAzureDashboardReads(deps, input, () => undefined);
        const changes: AzureDashboardReads[] = [];
        const second = await runAzureDashboardReads(deps, { ...input, scope: "all" }, (r) => changes.push(r));
        expect(log.filter((l) => l === "graph")).toHaveLength(1);
        expect(log.filter((l) => l === "alerts")).toHaveLength(1);
        expect(changes[0].spTypes.status).toBe("loaded");
        expect(changes[0].alerts.get(S1)?.status).toBe("loaded");
        expect(second.settings.size).toBe(4);

        await runAzureDashboardReads({ ...deps, loadKey: "load-2" }, input, () => undefined);
        expect(log.filter((l) => l === "graph")).toHaveLength(2);
        expect(log.filter((l) => l === "alerts")).toHaveLength(2);
    });

    it("stops on an abort without calling it a failure", async () => {
        const { arm, graph, log } = recorded();
        const controller = new AbortController();
        controller.abort();
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client, signal: controller.signal }, input, () => undefined);
        expect(log).toEqual([]);
        expect(reads.definitions.status).toBe("loading");
    });
});

describe("runAzureDashboardReads against the demo", () => {
    const now = new Date();
    const azure = buildContosoAzure(now);
    const tenant = buildContosoTenant(now);
    const unhandledArm: ArmRequest[] = [];
    const unhandledGraph: GraphRequest[] = [];
    const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));

    beforeAll(() => {
        const fakeArm = createFakeArm(azure, { onUnhandled: (r) => unhandledArm.push(r) });
        const fakeGraph = createFakeGraph(tenant, { now: () => now, onUnhandled: (r) => unhandledGraph.push(r) });
        vi.stubGlobal("fetch", createDemoFetch({ graph: async () => fakeGraph, arm: async () => fakeArm, realFetch }));
    });
    afterAll(() => {
        vi.unstubAllGlobals();
        expect(realFetch).not.toHaveBeenCalled();
        expect(unhandledArm).toEqual([]);
        expect(unhandledGraph).toEqual([]);
    });

    it("reads nine roles from the tenant, the principal types, the deleted user, the settings and the alerts of Contoso", async () => {
        const arm = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });
        const ctx = {
            client: arm,
            signal: new AbortController().signal,
            force: false,
            current: () => ({ data: [], extras: AZURE_INITIAL_EXTRAS }),
            progress: vi.fn(),
            backgroundProgress: vi.fn(),
            message: vi.fn(),
            setBlocking: vi.fn(),
            patch: vi.fn(),
        } satisfies WorkloadRunContext<AzureAssignment, AzureExtras, typeof arm>;
        const first = await azureAssignmentsAdapter.run(ctx);
        await first.background;
        const content = ctx.patch.mock.calls.reduce((c, [updater]) => updater(c), { data: first.data, extras: first.extras });

        const reads = await runAzureDashboardReads(
            { arm, getGraph: async () => createGraphClient("demo-token") },
            { assignments: content.data, scopes: content.extras.scopes, scope: "privileged", homeTenantId: CONTOSO_TENANT_ID },
            () => undefined,
        );

        expect(reads.definitions.status).toBe("loaded");
        if (reads.definitions.status === "loaded") {
            expect(reads.definitions.source).toBe("tenant");
            expect(reads.definitions.byId.size).toBe(9);
        }
        expect(reads.spTypes.status).toBe("loaded");
        if (reads.spTypes.status === "loaded") {
            const kinds = new Set(reads.spTypes.byId.values());
            expect(kinds).toContain("Application");
            expect(kinds).toContain("ManagedIdentity");
            expect(reads.spTypes.isDeletedChecked).toBe(true);
            // Only the user the fake Graph does not have
            expect([...reads.spTypes.byId].filter(([, type]) => type === DELETED_PRINCIPAL).map(([id]) => id)).toEqual([DELETED_AZURE_PRINCIPAL.id.toLowerCase()]);
        }
        expect([...reads.settings.values()].filter((o) => o.status === "failed")).toEqual([]);

        const production = reads.alerts.get(AZURE_SCOPE_IDS.production.split("/")[2].toLowerCase());
        expect(production?.status).toBe("loaded");
        if (production?.status === "loaded") expect(production.alerts.filter((a) => a.properties.isActive)).toHaveLength(1);
        expect([...reads.alerts.values()].filter((o) => o.status === "noAccess")).toEqual([]);
    }, 60_000);
});

describe("the request budget", () => {
    const subs = (n: number) => Array.from({ length: n }, (_, i) => `cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const sp = (i: number) => ({ principalType: "ServicePrincipal", principalId: `dddddddd-0000-0000-0000-${String(i).padStart(12, "0")}` });

    it("plans 500 settings pairs, 14 alert subscriptions and 40 ids, so at most 2 + 500 + 14 ARM and 3 Graph requests", () => {
        const subscriptions = subs(14);
        const scopes = subscriptions.map((id) => scope(`/subscriptions/${id}`, "subscription"));
        const assignments = Array.from({ length: 500 }, (_, i) =>
            assignment(`/subscriptions/${subscriptions[i % 14]}/resourceGroups/rg-${i}`, OWNER, i < 40 ? sp(i) : {}),
        );
        const plan = planAzureDashboardReads({ assignments, scopes, definitions: null, scope: "privileged" });
        expect(plan.settingsPairs).toHaveLength(500);
        expect(plan.alertSubscriptionIds).toHaveLength(14);
        expect(plan.servicePrincipalIds).toHaveLength(40);
        expect(2 + plan.settingsPairs.length + plan.alertSubscriptionIds.length).toBe(516);
        expect(Math.ceil(plan.servicePrincipalIds.length / 15)).toBe(3);
    });

    it("sends no role definition and no settings request in a second run, only the alerts", async () => {
        const subscriptions = subs(2);
        const scopes = subscriptions.map((id) => scope(`/subscriptions/${id}`, "subscription"));
        const assignments = Array.from({ length: 20 }, (_, i) =>
            assignment(`/subscriptions/${subscriptions[i % 2]}/resourceGroups/rg-${i}`, OWNER, i < 3 ? sp(i) : {}),
        );
        const { arm, graph } = recorded();
        const deps = { arm: arm.client, getGraph: async () => graph.client };
        const run = { assignments, scopes, scope: "privileged" as const };
        await runAzureDashboardReads(deps, run, () => undefined);
        expect(arm.requests.length).toBe(2 + 20 + 2);
        expect(graph.requests).toHaveLength(1);

        const before = arm.requests.length;
        await runAzureDashboardReads(deps, run, () => undefined);
        const second = arm.requests.slice(before);
        expect(second.filter((r) => r.path.endsWith("/roleManagementPolicies"))).toHaveLength(0);
        expect(second.filter((r) => r.path.endsWith("/roleDefinitions"))).toHaveLength(0);
        expect(second).toHaveLength(2);
    }, 60_000);
});

describe("loadAzureServicePrincipalTypes with a directory lookup", () => {
    const U1 = "eeeeeeee-0000-0000-0000-000000000001";
    const U2 = "eeeeeeee-0000-0000-0000-000000000002";
    const G1 = "ffffffff-0000-0000-0000-000000000001";
    const SP_GONE = "bbbbbbbb-0000-0000-0000-000000000009";

    function directory(options: { usersFail?: boolean } = {}) {
        const paths: string[] = [];
        const echo = (path: string, keep: (id: string) => boolean) => ({
            match: new RegExp(`^\\${path}$`),
            respond: (request: { query: { filter?: string } }) => {
                paths.push(path);
                if (path === "/users" && options.usersFail) throw graphError(403, "Authorization_RequestDenied");
                const asked = [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
                return { value: asked.filter(keep).map((id) => ({ id, servicePrincipalType: "Application" })) };
            },
        });
        const graph = createRecordingClient([echo("/servicePrincipals", (id) => id !== SP_GONE), echo("/users", (id) => id !== U2), echo("/groups", () => false)]);
        return { getGraph: async () => graph.client, paths };
    }
    const lookup = { users: [U1, U2], groups: [G1], servicePrincipals: [SP1.toLowerCase(), SP_GONE] };

    it("marks the users, groups and service principals Graph does not return as deleted", async () => {
        const { getGraph, paths } = directory();
        const state = await loadAzureServicePrincipalTypes(getGraph, [], "k", undefined, [SP1.toLowerCase(), SP_GONE], lookup);
        expect(paths).toEqual(["/servicePrincipals", "/users", "/groups"]);
        expect(state).toMatchObject({ status: "loaded", isDeletedChecked: true });
        if (state.status !== "loaded") return;
        expect(state.byId.get(SP1.toLowerCase())).toBe("Application");
        expect(state.byId.get(SP_GONE)).toBe(DELETED_PRINCIPAL);
        expect(state.byId.get(U2)).toBe(DELETED_PRINCIPAL);
        expect(state.byId.get(G1)).toBe(DELETED_PRINCIPAL);
        expect(state.byId.has(U1)).toBe(false);
    });

    it("keeps the types and marks no user or group when that read fails", async () => {
        const { getGraph } = directory({ usersFail: true });
        const state = await loadAzureServicePrincipalTypes(getGraph, [], "k", undefined, [SP1.toLowerCase()], lookup);
        expect(state).toMatchObject({ status: "loaded", isDeletedChecked: false });
        if (state.status !== "loaded") return;
        expect(state.byId.get(SP1.toLowerCase())).toBe("Application");
        expect(state.byId.has(U2)).toBe(false);
        expect(state.byId.has(G1)).toBe(false);
    });

    it("reads the users even when no service principal holds a role", async () => {
        const { getGraph, paths } = directory();
        const state = await loadAzureServicePrincipalTypes(getGraph, [], "k", undefined, [], { users: [U2], groups: [], servicePrincipals: [] });
        expect(paths).toEqual(["/users"]);
        expect(state.status === "loaded" && state.byId.get(U2)).toBe(DELETED_PRINCIPAL);
    });
});

describe("role definitions read per subscription", () => {
    const twoSubscriptions = [scope(MG, "managementGroup"), scope(`/subscriptions/${S1}`, "subscription"), scope(`/subscriptions/${S2}`, "subscription")];
    const definitionReads = (log: string[]) => log.filter((l) => l.startsWith("definitions")).length;

    it("are partial when the custom roles of a subscription fail, and are not cached", async () => {
        const { arm, log } = recorded({ tenantStatus: 403, customStatus: { [S2]: 400 } });
        const first = await loadAzureRoleDefinitions(arm.client, twoSubscriptions);
        expect(first).toMatchObject({ status: "partial", source: "subscriptions", failedSubscriptions: 1, subscriptionCount: 2 });
        // The built-in roles are still there to count with
        expect(definitionsOf(first)?.has(OWNER)).toBe(true);
        const reads = definitionReads(log);
        await loadAzureRoleDefinitions(arm.client, twoSubscriptions);
        expect(definitionReads(log)).toBeGreaterThan(reads);
    });

    it("are loaded and cached when every subscription answers", async () => {
        const { arm, log } = recorded({ tenantStatus: 403 });
        expect((await loadAzureRoleDefinitions(arm.client, twoSubscriptions)).status).toBe("loaded");
        const reads = definitionReads(log);
        await loadAzureRoleDefinitions(arm.client, twoSubscriptions);
        expect(definitionReads(log)).toBe(reads);
    });

    it("give the dashboard a partial state, and count with its list", async () => {
        const { arm, graph } = recorded({ tenantStatus: 403, customStatus: { [S2]: 400 } });
        const reads = await runAzureDashboardReads({ arm: arm.client, getGraph: async () => graph.client }, { ...input, scopes: twoSubscriptions }, () => undefined);
        expect(reads.definitions.status).toBe("partial");
        expect(definitionsOf({ status: "failed" })).toBeNull();
        expect(definitionsOf({ status: "loading" })).toBeNull();
    });
});

describe("Refresh of the dashboard", () => {
    it("forgets the cached role definitions, so they are read again", async () => {
        const { arm, log } = recorded();
        await loadAzureRoleDefinitions(arm.client, SCOPES);
        const reads = log.filter((l) => l.startsWith("definitions")).length;
        await loadAzureRoleDefinitions(arm.client, SCOPES);
        expect(log.filter((l) => l.startsWith("definitions")).length).toBe(reads);
        resetAzureDashboardForRefresh();
        await loadAzureRoleDefinitions(arm.client, SCOPES);
        expect(log.filter((l) => l.startsWith("definitions")).length).toBe(reads * 2);
    });
});

describe("the loaders of the Report", () => {
    it("loadAzureRoleDefinitions reads once and returns the cache the second time", async () => {
        const { arm, log } = recorded();
        const first = await loadAzureRoleDefinitions(arm.client, SCOPES);
        expect(first.status).toBe("loaded");
        const reads = log.filter((l) => l.startsWith("definitions")).length;
        expect(reads).toBeGreaterThan(0);
        const second = await loadAzureRoleDefinitions(arm.client, SCOPES);
        expect(second.status).toBe("loaded");
        expect(log.filter((l) => l.startsWith("definitions")).length).toBe(reads);
    });

    it("loadAzureServicePrincipalTypes reads once per loadKey", async () => {
        const { graph, log } = recorded();
        const getGraph = async () => graph.client;
        const first = await loadAzureServicePrincipalTypes(getGraph, FIXTURE, "k1");
        expect(first.status).toBe("loaded");
        await loadAzureServicePrincipalTypes(getGraph, FIXTURE, "k1");
        expect(log.filter((l) => l === "graph")).toHaveLength(1);
        await loadAzureServicePrincipalTypes(getGraph, FIXTURE, "k2");
        expect(log.filter((l) => l === "graph")).toHaveLength(2);
    });
});
