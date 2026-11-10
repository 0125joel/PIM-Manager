import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArmClient } from "@/utils/armClient";
import { ArmError, createArmClient } from "@/utils/armClient";
import { RateLimiter, armRateLimiter } from "@/utils/rateLimiter";
import { createWorkloadEngine } from "@/workloads/engine";
import { AZURE_INITIAL_EXTRAS, AZURE_OWNER_KEY, azureAssignmentsAdapter, azureCacheOwner, createAzureAssignmentsAdapter, type AzureExtras } from "@/workloads/azureAssignmentsAdapter";
import type { EngineState, WorkloadContent, WorkloadRunContext } from "@/workloads/types";
import type { AzureAssignment } from "@/types/azureResource.types";
import { AZURE_SCOPE_IDS, buildContosoAzure } from "@/demo/contoso/azure";
import { createFakeArm } from "@/demo/arm/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { armError, createRecordingArmClient, type RecordingArmClient } from "../support/recordingArmClient";

/**
 * The Azure adapter (Azure spec 5) with a fake ARM client: per subscription the two instance lists, a subscription the
 * user cannot read left out, inherited items once, the tree built from what came back, and a failed read that fails
 * the load. Then the engine with this adapter, and one run against the demo's fake ARM. Nothing here reaches ARM.
 */

const AUTH = "/providers/Microsoft.Authorization";
const MG = "/providers/Microsoft.Management/managementGroups";
const TENANT = "11111111-1111-1111-1111-111111111111";
const S1 = "aaaaaaaa-0000-0000-0000-000000000001";
const S2 = "aaaaaaaa-0000-0000-0000-000000000002";
const S3 = "aaaaaaaa-0000-0000-0000-000000000003";

const subscription = (id: string, displayName: string) => ({ id: `/subscriptions/${id}`, subscriptionId: id, displayName, state: "Enabled", tenantId: TENANT });

function instance(name: string, scope: string, memberType: "Direct" | "Inherited", list: "roleAssignmentScheduleInstances" | "roleEligibilitySchedules", scopeName: string, from: string, extra: { startDateTime?: string; endDateTime?: string; custom?: boolean } = {}) {
    return {
        id: `${scope === "/" ? "" : scope}${AUTH}/${list}/${name}`,
        name,
        type: `Microsoft.Authorization/${list}`,
        properties: {
            scope,
            memberType,
            principalId: `p-${name}`,
            principalType: "User",
            roleDefinitionId: `/subscriptions/${from}${AUTH}/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635`,
            status: "Provisioned",
            ...(extra.startDateTime ? { startDateTime: extra.startDateTime } : {}),
            ...(extra.endDateTime ? { endDateTime: extra.endDateTime } : {}),
            expandedProperties: {
                scope: { id: scope, displayName: scopeName, type: "x" },
                principal: { id: `p-${name}`, displayName: `Person ${name}`, type: "User" },
                ...(extra.custom ? { roleDefinition: { id: "x", displayName: "Custom Operator", type: "CustomRole" } } : {}),
            },
        },
    };
}

/** Two readable subscriptions under the Tenant Root Group, each seeing the same inherited item; a third answers 403 */
function tenant(): RecordingArmClient {
    const inheritedFrom = (sub: string) => instance("i-root", `${MG}/${TENANT}`, "Inherited", "roleAssignmentScheduleInstances", "Tenant Root Group", sub);
    return createRecordingArmClient([
        { match: /^\/subscriptions$/, respond: () => ({ body: { value: [subscription(S1, "Production"), subscription(S2, "Test"), subscription(S3, "Hidden")] } }) },
        { match: new RegExp(`^/subscriptions/${S1}${AUTH}/roleAssignmentScheduleInstances$`), respond: () => ({ body: { value: [inheritedFrom(S1), instance("a1", `/subscriptions/${S1}/resourceGroups/rg-web`, "Direct", "roleAssignmentScheduleInstances", "rg-web", S1)] } }) },
        { match: new RegExp(`^/subscriptions/${S1}${AUTH}/roleEligibilitySchedules$`), respond: () => ({ body: { value: [instance("e1", `/subscriptions/${S1}`, "Direct", "roleEligibilitySchedules", "Production", S1)] } }) },
        { match: new RegExp(`^/subscriptions/${S2}${AUTH}/roleAssignmentScheduleInstances$`), respond: () => ({ body: { value: [inheritedFrom(S2)] } }) },
        { match: new RegExp(`^/subscriptions/${S2}${AUTH}/roleEligibilitySchedules$`), respond: () => ({ body: { value: [] } }) },
        { match: new RegExp(`^/subscriptions/${S3}${AUTH}/`), respond: () => armError(403, "AuthorizationFailed") },
    ]);
}

const RG_A = `/subscriptions/${S2}/resourceGroups/rg-a`;
const KV = `${RG_A}/providers/Microsoft.KeyVault/vaults/kv-a`;
const VM = `/subscriptions/${S2}/resourceGroups/rg-b/providers/Microsoft.Compute/virtualMachines/vm-b`;

/** S2 refuses its own lists (400 InsufficientPermissions); the user reads rg-a (with a vault in it) and one vm in rg-b */
function below(arm: RecordingArmClient): RecordingArmClient {
    const subItem = (from: string) => instance("b-sub", `/subscriptions/${S2}`, "Inherited", "roleAssignmentScheduleInstances", "Test", from);
    arm.on({ match: new RegExp(`^/subscriptions/${S2}${AUTH}/`), respond: () => armError(400, "InsufficientPermissions") });
    arm.on({ match: new RegExp(`^/subscriptions/${S2}/resourcegroups$`), respond: () => ({ body: { value: [{ id: RG_A, name: "rg-a", type: "Microsoft.Resources/resourceGroups" }] } }) });
    arm.on({ match: new RegExp(`^/subscriptions/${S2}/resources$`), respond: () => ({ body: { value: [{ id: KV, name: "kv-a", type: "Microsoft.KeyVault/vaults" }, { id: VM, name: "vm-b", type: "Microsoft.Compute/virtualMachines" }] } }) });
    arm.on({ match: new RegExp(`^${RG_A}${AUTH}/roleAssignmentScheduleInstances$`), respond: () => ({ body: { value: [subItem(S2), instance("b-rg", RG_A, "Direct", "roleAssignmentScheduleInstances", "rg-a", S2)] } }) });
    arm.on({ match: new RegExp(`^${RG_A}${AUTH}/roleEligibilitySchedules$`), respond: () => ({ body: { value: [] } }) });
    arm.on({ match: new RegExp(`^${VM}${AUTH}/roleAssignmentScheduleInstances$`), respond: () => ({ body: { value: [subItem(S2)] } }) });
    arm.on({ match: new RegExp(`^${VM}${AUTH}/roleEligibilitySchedules$`), respond: () => ({ body: { value: [instance("b-vm", VM, "Direct", "roleEligibilitySchedules", "vm-b", S2)] } }) });
    return arm;
}

/** The content after the background phase: the last patch applied to what the run returned */
function latest(ctx: ReturnType<typeof runContext>, outcome: WorkloadContent<AzureAssignment, AzureExtras>): WorkloadContent<AzureAssignment, AzureExtras> {
    const calls = ctx.patch.mock.calls;
    return calls.reduce((content, [updater]) => updater(content), { data: outcome.data, extras: outcome.extras });
}

function runContext(client: ArmClient, signal: AbortSignal = new AbortController().signal) {
    const ctx = {
        client,
        signal,
        force: false,
        current: (): WorkloadContent<AzureAssignment, AzureExtras> => ({ data: [], extras: AZURE_INITIAL_EXTRAS }),
        progress: vi.fn<(current: number, total: number, message: string) => void>(),
        backgroundProgress: vi.fn(),
        message: vi.fn(),
        setBlocking: vi.fn(),
        patch: vi.fn(),
    } satisfies WorkloadRunContext<AzureAssignment, AzureExtras, ArmClient>;
    return ctx;
}

describe("azureAssignmentsAdapter.run", () => {
    it("reads both lists of every subscription, leaves the unreadable one out and keeps an inherited item once", async () => {
        const arm = tenant();
        const ctx = runContext(arm.client);
        const outcome = await azureAssignmentsAdapter.run(ctx);

        expect(outcome.data.map((a) => a.id).sort()).toEqual([
            `${MG}/${TENANT}${AUTH}/roleAssignmentScheduleInstances/i-root`,
            `/subscriptions/${S1}${AUTH}/roleEligibilitySchedules/e1`,
            `/subscriptions/${S1}/resourceGroups/rg-web${AUTH}/roleAssignmentScheduleInstances/a1`,
        ].sort());
        expect(outcome.data.find((a) => a.id.endsWith("/e1"))).toMatchObject({ state: "eligible", memberType: "direct", principalName: "Person e1", roleDefinitionId: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635" });

        expect(outcome.extras.scopes).toEqual([
            { id: `${MG}/${TENANT}`, name: "Tenant Root Group", level: "managementGroup", parentId: null },
            { id: `/subscriptions/${S1}`, name: "Production", level: "subscription", parentId: `${MG}/${TENANT}`, tenantId: TENANT },
            { id: `/subscriptions/${S2}`, name: "Test", level: "subscription", parentId: `${MG}/${TENANT}`, tenantId: TENANT },
            { id: `/subscriptions/${S1}/resourceGroups/rg-web`, name: "rg-web", level: "resourceGroup", parentId: `/subscriptions/${S1}` },
        ]);
        expect(outcome.message).toBe("Loaded 3 Azure role assignments from 2 subscriptions");

        // One subscription list, then the active instances and the eligibility schedules of every subscription together,
        // the hidden one included
        const paths = arm.requests.map((r) => r.path);
        expect(paths[0]).toBe("/subscriptions");
        // The hierarchy is asked once, after the subscriptions (this fake has no answer for it: the tree stays flat)
        expect(paths[1]).toBe("/providers/Microsoft.Management/getEntities");
        expect(arm.requests[1].method).toBe("POST");
        expect(paths.slice(2).sort()).toEqual([S1, S2, S3].flatMap((s) => [`/subscriptions/${s}${AUTH}/roleAssignmentScheduleInstances`, `/subscriptions/${s}${AUTH}/roleEligibilitySchedules`]).sort());
        expect(outcome.background).toBeUndefined();
        expect(ctx.progress).toHaveBeenLastCalledWith(3, 3, "Loading Azure role assignments: 3 of 3 subscriptions");
    });

    it("keeps the tree flat and completes the load when getEntities answers 403", async () => {
        const arm = tenant();
        arm.on({ match: /^\/providers\/Microsoft\.Management\/getEntities$/, respond: () => armError(403, "AuthorizationFailed") });
        const outcome = await azureAssignmentsAdapter.run(runContext(arm.client));
        expect(outcome.data).toHaveLength(3);
        expect(outcome.extras.scopes.map((s) => [s.id, s.parentId])).toEqual([
            [`${MG}/${TENANT}`, null],
            [`/subscriptions/${S1}`, `${MG}/${TENANT}`],
            [`/subscriptions/${S2}`, `${MG}/${TENANT}`],
            [`/subscriptions/${S1}/resourceGroups/rg-web`, `/subscriptions/${S1}`],
        ]);
    });

    it("reads eligible roles from the schedules, a custom role on a resource group included, and keeps only the current ones", async () => {
        const arm = tenant();
        const rg = `/subscriptions/${S2}/resourceGroups/rg-ops`;
        const day = 86_400_000;
        const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
        arm.on({
            match: new RegExp(`^/subscriptions/${S2}${AUTH}/roleEligibilitySchedules$`),
            respond: () => ({ body: { value: [
                // A custom role assignable only at rg-ops: the instance list at the subscription leaves it out, the schedules do not (2026-10-22)
                instance("custom", rg, "Direct", "roleEligibilitySchedules", "rg-ops", S2, { startDateTime: iso(-day), endDateTime: iso(30 * day), custom: true }),
                instance("future", rg, "Direct", "roleEligibilitySchedules", "rg-ops", S2, { startDateTime: iso(day), endDateTime: iso(30 * day) }),
                instance("ended", rg, "Direct", "roleEligibilitySchedules", "rg-ops", S2, { startDateTime: iso(-30 * day), endDateTime: iso(-day) }),
                instance("permanent", rg, "Direct", "roleEligibilitySchedules", "rg-ops", S2),
            ] } }),
        });
        const outcome = await azureAssignmentsAdapter.run(runContext(arm.client));

        const ids = outcome.data.map((a) => a.id);
        expect(ids).toEqual(expect.arrayContaining([`${rg}${AUTH}/roleEligibilitySchedules/custom`, `${rg}${AUTH}/roleEligibilitySchedules/permanent`]));
        expect(ids.some((id) => id.endsWith("/future") || id.endsWith("/ended"))).toBe(false);
        expect(outcome.data.find((a) => a.id.endsWith("/custom"))).toMatchObject({ state: "eligible", isCustomRole: true, roleName: "Custom Operator", scopeId: rg });
        expect(outcome.extras.scopes.map((s) => s.id)).toContain(rg);
        expect(arm.requests.some((r) => r.path.endsWith("/roleEligibilityScheduleInstances"))).toBe(false);
    });

    it("leaves out a subscription that is gone (404)", async () => {
        const arm = tenant();
        arm.on({ match: new RegExp(`^/subscriptions/${S2}${AUTH}/`), respond: () => armError(404, "SubscriptionNotFound") });
        const outcome = await azureAssignmentsAdapter.run(runContext(arm.client));
        expect(outcome.extras.scopes.map((s) => s.id)).not.toContain(`/subscriptions/${S2}`);
        expect(outcome.message).toBe("Loaded 3 Azure role assignments from 1 subscription");
    });

    it("reads a subscription refused at its own level from its readable scopes, in the background", async () => {
        const arm = below(tenant());
        const ctx = runContext(arm.client);
        const outcome = await azureAssignmentsAdapter.run(ctx);

        // Shown at once: the readable subscription, and the refused one as loading
        expect(outcome.extras.scopes.find((s) => s.id === `/subscriptions/${S2}`)?.access).toBe("loading");
        expect(outcome.backgroundMessage).toBe("Reading the resource groups and resources you can read in 1 subscription...");
        expect(outcome.background).toBeDefined();
        await outcome.background;

        const final = latest(ctx, outcome);
        expect(final.extras.scopes.find((s) => s.id === `/subscriptions/${S2}`)?.access).toBe("partial");
        expect(final.extras.scopes.find((s) => s.id === `/subscriptions/${S1}`)?.access).toBeUndefined();
        const ids = final.data.map((a) => a.id);
        expect(ids).toEqual(expect.arrayContaining([`${RG_A}${AUTH}/roleAssignmentScheduleInstances/b-rg`, `${VM}${AUTH}/roleEligibilitySchedules/b-vm`, `/subscriptions/${S2}${AUTH}/roleAssignmentScheduleInstances/b-sub`]));
        // The subscription item came back from both scopes: once
        expect(ids.filter((id) => id.endsWith("/b-sub"))).toHaveLength(1);
        expect(new Set(ids).size).toBe(ids.length);

        // The vault under rg-a is not read on its own; rg-a and the vm are, both lists each
        const paths = arm.requests.map((r) => r.path);
        expect(paths).toEqual(expect.arrayContaining([`/subscriptions/${S2}/resourcegroups`, `/subscriptions/${S2}/resources`]));
        expect(paths.filter((p) => p.startsWith(`${RG_A}${AUTH}/`) || p.startsWith(`${VM}${AUTH}/`))).toHaveLength(4);
        expect(paths.some((p) => p.startsWith(`${KV}${AUTH}/`))).toBe(false);
        expect(ctx.backgroundProgress).toHaveBeenLastCalledWith(2, 2);
    });

    it("reads below in the blocking phase when nothing is readable as a whole", async () => {
        const arm = below(tenant());
        arm.on({ match: /^\/subscriptions$/, respond: () => ({ body: { value: [subscription(S2, "Test")] } }) });
        const ctx = runContext(arm.client);
        const outcome = await azureAssignmentsAdapter.run(ctx);
        expect(outcome.background).toBeUndefined();
        expect(outcome.extras.scopes.find((s) => s.id === `/subscriptions/${S2}`)?.access).toBe("partial");
        expect(outcome.data.length).toBeGreaterThan(0);
        expect(outcome.message).toBe(`Loaded ${outcome.data.length} Azure role assignments from 1 subscription`);
        expect(ctx.message).toHaveBeenCalledWith("Reading the resource groups and resources you can read in 1 subscription...");
    });

    it("marks the subscription failed when a scope below it fails, and keeps what was read", async () => {
        const arm = below(tenant());
        arm.on({ match: new RegExp(`^${VM}${AUTH}/roleEligibilitySchedules$`), respond: () => armError(500, "InternalServerError") });
        const ctx = runContext(arm.client);
        const outcome = await azureAssignmentsAdapter.run(ctx);
        await outcome.background;
        const final = latest(ctx, outcome);
        expect(final.extras.scopes.find((s) => s.id === `/subscriptions/${S2}`)?.access).toBe("failed");
        expect(final.data.map((a) => a.id)).toContain(`${RG_A}${AUTH}/roleAssignmentScheduleInstances/b-rg`);
    });

    it("drops a refused subscription with nothing readable below it", async () => {
        const arm = below(tenant());
        arm.on({ match: new RegExp(`^/subscriptions/${S2}/(resourcegroups|resources)$`), respond: () => ({ body: { value: [] } }) });
        const ctx = runContext(arm.client);
        const outcome = await azureAssignmentsAdapter.run(ctx);
        await outcome.background;
        expect(latest(ctx, outcome).extras.scopes.map((s) => s.id)).not.toContain(`/subscriptions/${S2}`);
    });

    it("fails the load on any other error, with the ARM error", async () => {
        const arm = tenant();
        arm.on({ match: new RegExp(`^/subscriptions/${S2}${AUTH}/roleEligibilitySchedules$`), respond: () => armError(400, "InvalidFilter") });
        const failure = await azureAssignmentsAdapter.run(runContext(arm.client)).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ArmError);
        expect((failure as ArmError).code).toBe("InvalidFilter");
    });

    it("fails the load when the subscription list fails", async () => {
        const arm = tenant();
        arm.on({ match: /^\/subscriptions$/, respond: () => armError(400, "BadRequest") });
        await expect(azureAssignmentsAdapter.run(runContext(arm.client))).rejects.toBeInstanceOf(ArmError);
    });

    it("gives no scopes and no assignments when no subscription is readable", async () => {
        const arm = createRecordingArmClient([{ match: /^\/subscriptions$/, respond: () => ({ body: { value: [] } }) }]);
        const outcome = await azureAssignmentsAdapter.run(runContext(arm.client));
        expect(outcome.data).toEqual([]);
        expect(outcome.extras.scopes).toEqual([]);
    });

    it("stops when the run is aborted", async () => {
        const arm = tenant();
        const controller = new AbortController();
        controller.abort();
        await expect(azureAssignmentsAdapter.run(runContext(arm.client, controller.signal))).rejects.toThrow();
    });
});

describe("the engine with the Azure adapter and an ARM client", () => {
    type State = EngineState<AzureAssignment, AzureExtras>;

    const ALICE = { homeAccountId: "alice-oid.tenant-id" };
    const BOB = { homeAccountId: "bob-oid.tenant-id" };

    function setup(arm: RecordingArmClient, account: { homeAccountId: string } | null = ALICE) {
        const adapter = createAzureAssignmentsAdapter(() => azureCacheOwner(account));
        let state: State = { data: [], extras: AZURE_INITIAL_EXTRAS, loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" }, consent: { consented: true } };
        const storage = new Map<string, string>();
        vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
        const engine = createWorkloadEngine(adapter, {
            store: { get: () => state, apply: (updater) => { state = updater(state); } },
            getClient: async () => arm.client,
            onSynced: vi.fn(),
        });
        return { engine, adapter, get: () => state, storage };
    }

    it("loads, writes the cache with the scopes and keeps the data when a refresh fails", async () => {
        const arm = tenant();
        const { engine, get, storage } = setup(arm);
        await engine.load();
        expect(get().loading.phase).toBe("complete");
        expect(get().data).toHaveLength(3);
        expect(get().extras.scopes).toHaveLength(4);

        engine.persist();
        expect(JSON.parse(storage.get("pim_azure_assignments_v2") ?? "[]")).toHaveLength(3);
        expect(JSON.parse(storage.get("pim_azure_scopes_v1") ?? "[]")).toHaveLength(4);

        arm.on({ match: new RegExp(`^/subscriptions/${S1}${AUTH}/roleAssignmentScheduleInstances$`), respond: () => armError(400, "InvalidFilter") });
        await engine.refresh(false);
        expect(get().loading.phase).toBe("error");
        // In ARM words (mapArmError), not the Graph sentence of describeLoadFailure
        expect(get().loading.error).toBe("Request not supported. Azure Resource Manager rejected the filter of this request. This is a fault in PIM Manager; please report it.");
        expect(get().data).toHaveLength(3);
        vi.unstubAllGlobals();
    });

    it("shows the cache again after a reload, scopes included", async () => {
        const arm = tenant();
        const first = setup(arm);
        await first.engine.load();
        first.engine.persist();
        const saved = new Map(first.storage);

        const second = setup(arm);
        for (const [k, v] of saved) second.storage.set(k, v);
        const content: WorkloadContent<AzureAssignment, AzureExtras> | null = second.adapter.cache.read();
        expect(content?.extras.scopes).toHaveLength(4);
        expect(second.engine.hydrate()).not.toBeNull();
        expect(second.get().data).toHaveLength(3);
        expect(second.get().extras.scopes).toHaveLength(4);
        vi.unstubAllGlobals();
    });

    it("binds the cache to the account by a hash, and another account in the same tab neither sees nor waits for it", async () => {
        const arm = tenant();
        const first = setup(arm, ALICE);
        await first.engine.load();
        first.engine.persist();
        const owner = first.storage.get(AZURE_OWNER_KEY);
        expect(owner).toMatch(/^[0-9a-f]{8}$/);
        expect(owner).not.toContain("alice");
        const saved = new Map(first.storage);

        const second = setup(arm, BOB);
        for (const [k, v] of saved) second.storage.set(k, v);
        expect(second.engine.hydrate()).toBeNull();
        expect(second.get().data).toEqual([]);
        expect(second.storage.has("pim_azure_assignments_v2")).toBe(false);
        // load does not wait for a cache that is not this account's: it reads Bob's own data
        const before = arm.requests.length;
        await second.engine.load();
        expect(arm.requests.length).toBeGreaterThan(before);
        vi.unstubAllGlobals();
    });

    it("the adapter without an account never caches", async () => {
        const arm = tenant();
        const { engine, storage } = setup(arm, null);
        await engine.load();
        engine.persist();
        expect(storage.size).toBe(0);
        expect(azureAssignmentsAdapter.cache.read()).toBeNull();
        vi.unstubAllGlobals();
    });
});

describe("the read budget below a refused subscription, and Read the rest", () => {
    type State = EngineState<AzureAssignment, AzureExtras>;
    // The budget is what these tests count, not the shared limiter's window: the rounds here would otherwise wait for the
    // window the tests above filled
    beforeEach(() => {
        vi.spyOn(armRateLimiter, "acquire").mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    const rgOf = (n: number) => `/subscriptions/${S2}/resourceGroups/rg-${n}`;
    const subItem = () => instance("b-sub", `/subscriptions/${S2}`, "Inherited", "roleAssignmentScheduleInstances", "Test", S2);

    /** S2 refuses its own lists; the user reads `count` resource groups, each with one assignment and the inherited subscription item */
    function manyBelow(count: number): RecordingArmClient {
        const arm = tenant();
        arm.on({ match: new RegExp(`^/subscriptions/${S2}${AUTH}/`), respond: () => armError(400, "InsufficientPermissions") });
        arm.on({ match: new RegExp(`^/subscriptions/${S2}/resourcegroups$`), respond: () => ({ body: { value: Array.from({ length: count }, (_, i) => ({ id: rgOf(i), name: `rg-${i}`, type: "Microsoft.Resources/resourceGroups" })) } }) });
        arm.on({ match: new RegExp(`^/subscriptions/${S2}/resources$`), respond: () => ({ body: { value: [] } }) });
        arm.on({
            match: new RegExp(`^/subscriptions/${S2}/resourceGroups/rg-\\d+${AUTH}/roleAssignmentScheduleInstances$`),
            respond: (r) => {
                const rg = r.path.slice(0, r.path.indexOf(AUTH));
                return { body: { value: [subItem(), instance(`a-${rg.split("/").pop()}`, rg, "Direct", "roleAssignmentScheduleInstances", rg.split("/").pop() ?? "", S2)] } };
            },
        });
        arm.on({ match: new RegExp(`^/subscriptions/${S2}/resourceGroups/rg-\\d+${AUTH}/roleEligibilitySchedules$`), respond: () => ({ body: { value: [] } }) });
        return arm;
    }

    /** The resource groups whose lists were asked, in order, each once per list */
    const readGroups = (arm: RecordingArmClient, from = 0) => arm.requests.slice(from).filter((r) => r.path.endsWith(`${AUTH}/roleAssignmentScheduleInstances`) && r.path.includes("/resourceGroups/")).map((r) => r.path.slice(0, r.path.indexOf(AUTH)));
    const listings = (arm: RecordingArmClient, from = 0) => arm.requests.slice(from).filter((r) => r.path === `/subscriptions/${S2}/resourcegroups`).length;
    const s2Of = (scopes: AzureExtras["scopes"]) => scopes.find((s) => s.id === `/subscriptions/${S2}`);

    function setup(arm: RecordingArmClient, belowBudget: number, storage = new Map<string, string>()) {
        const adapter = createAzureAssignmentsAdapter(() => azureCacheOwner({ homeAccountId: "alice-oid.tenant-id" }), { belowBudget });
        let state: State = { data: [], extras: AZURE_INITIAL_EXTRAS, loading: { phase: "idle", progress: { current: 0, total: 0 }, message: "" }, consent: { consented: true } };
        vi.stubGlobal("sessionStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); }, removeItem: (k: string) => { storage.delete(k); } });
        const engine = createWorkloadEngine(adapter, {
            store: { get: () => state, apply: (updater) => { state = updater(state); } },
            getClient: async () => arm.client,
            onSynced: vi.fn(),
        });
        const settled = () => vi.waitFor(() => expect(state.loading.phase).toBe("complete"), { timeout: 15_000 });
        return { engine, get: () => state, storage, settled };
    }

    it("stops the round when the budget is spent, without an error, and keeps the rest on the subscription", async () => {
        const arm = manyBelow(5);
        const ctx = runContext(arm.client);
        // The listing (2) and two resource groups (2 each)
        const first = await createAzureAssignmentsAdapter(() => null, { belowBudget: 6 }).run(ctx);
        await expect(first.background).resolves.toBeUndefined();
        const final = latest(ctx, first);
        expect(readGroups(arm)).toEqual([rgOf(0), rgOf(1)]);
        expect(s2Of(final.extras.scopes)).toMatchObject({ access: "partial", unreadScopeIds: [rgOf(2), rgOf(3), rgOf(4)] });
        // What was not read is not in the tree or the data
        expect(final.extras.scopes.map((s) => s.id)).not.toContain(rgOf(2));
        expect(final.data.map((a) => a.scopeId)).not.toContain(rgOf(2));
        expect(final.data.map((a) => a.scopeId)).toContain(rgOf(1));
    });

    it("keeps a refused subscription whose scopes the budget did not reach at all, partial and with nothing read", async () => {
        const arm = manyBelow(3);
        const ctx = runContext(arm.client);
        const first = await createAzureAssignmentsAdapter(() => null, { belowBudget: 3 }).run(ctx);
        await first.background;
        expect(s2Of(latest(ctx, first).extras.scopes)).toMatchObject({ access: "partial", unreadScopeIds: [rgOf(0), rgOf(1), rgOf(2)] });
        expect(readGroups(arm)).toEqual([]);
        // A budget too small for the listing: not listed yet
        const unlistedCtx = runContext(manyBelow(3).client);
        const unlisted = await createAzureAssignmentsAdapter(() => null, { belowBudget: 1 }).run(unlistedCtx);
        await unlisted.background;
        expect(s2Of(latest(unlistedCtx, unlisted).extras.scopes)).toMatchObject({ access: "partial", isUnlisted: true });
    });

    it("counts a 403 or a 400 InsufficientPermissions on the way as not readable, not as unread or failed", async () => {
        const arm = manyBelow(4);
        arm.on({ match: new RegExp(`^${rgOf(0)}${AUTH}/`), respond: () => armError(403, "AuthorizationFailed") });
        arm.on({ match: new RegExp(`^${rgOf(1)}${AUTH}/`), respond: () => armError(400, "InsufficientPermissions") });
        const ctx = runContext(arm.client);
        const first = await createAzureAssignmentsAdapter(() => null, { belowBudget: 6 }).run(ctx);
        await first.background;
        const s2 = s2Of(latest(ctx, first).extras.scopes);
        expect(s2?.access).toBe("partial");
        expect(s2?.unreadScopeIds).toEqual([rgOf(2), rgOf(3)]);
    });

    it("reads only the rest in each next round, with the same budget, and merges without duplicates; the data keeps its age", async () => {
        const arm = manyBelow(7);
        const { engine, get, settled } = setup(arm, 6);
        await engine.load();
        await settled();
        expect(s2Of(get().extras.scopes)?.unreadScopeIds).toHaveLength(5);
        const lastFetched = get().lastFetched;

        // Round 2: no listing, three resource groups (6 requests)
        const before = arm.requests.length;
        await engine.resume();
        await settled();
        expect(listings(arm, before)).toBe(0);
        expect(readGroups(arm, before)).toEqual([rgOf(2), rgOf(3), rgOf(4)]);
        expect(s2Of(get().extras.scopes)?.unreadScopeIds).toEqual([rgOf(5), rgOf(6)]);

        // Round 3 reads the last two, and nothing is left
        const second = arm.requests.length;
        await engine.resume();
        await settled();
        expect(readGroups(arm, second)).toEqual([rgOf(5), rgOf(6)]);
        expect(s2Of(get().extras.scopes)?.unreadScopeIds).toBeUndefined();
        expect(s2Of(get().extras.scopes)?.access).toBe("partial");

        // Every group read once, its scope in the tree once, every assignment once (the inherited one came back seven times)
        expect(readGroups(arm)).toEqual(Array.from({ length: 7 }, (_, i) => rgOf(i)));
        const ids = get().data.map((a) => a.id.toLowerCase());
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.filter((id) => id.endsWith("/b-sub"))).toHaveLength(1);
        expect(get().extras.scopes.filter((s) => s.level === "resourceGroup" && s.id.includes(S2))).toHaveLength(7);
        expect(get().lastFetched).toBe(lastFetched);

        // Nothing left: a resume reads nothing
        const third = arm.requests.length;
        await engine.resume();
        await settled();
        expect(arm.requests.length).toBe(third);
        vi.unstubAllGlobals();
    });

    it("caches what is left, so after a reload the line and Read the rest are right, and Refresh starts from zero", async () => {
        const arm = manyBelow(5);
        const first = setup(arm, 6);
        await first.engine.load();
        await first.settled();
        first.engine.persist();

        const second = setup(arm, 6, new Map(first.storage));
        expect(second.engine.hydrate()).not.toBeNull();
        expect(s2Of(second.get().extras.scopes)).toMatchObject({ access: "partial", unreadScopeIds: [rgOf(2), rgOf(3), rgOf(4)] });
        const before = arm.requests.length;
        await second.engine.resume();
        await second.settled();
        expect(readGroups(arm, before)).toEqual([rgOf(2), rgOf(3), rgOf(4)]);
        expect(s2Of(second.get().extras.scopes)?.unreadScopeIds).toBeUndefined();

        // Refresh: the listing again and a fresh budget from the first group
        const refreshed = arm.requests.length;
        await second.engine.refresh(false);
        await second.settled();
        expect(listings(arm, refreshed)).toBe(1);
        expect(readGroups(arm, refreshed)).toEqual([rgOf(0), rgOf(1)]);
        expect(s2Of(second.get().extras.scopes)?.unreadScopeIds).toEqual([rgOf(2), rgOf(3), rgOf(4)]);
        vi.unstubAllGlobals();
    });

    it("an abort during Read the rest leaves no half result as complete and caches nothing of it", async () => {
        const arm = manyBelow(6);
        const { engine, get, storage, settled } = setup(arm, 6);
        await engine.load();
        await settled();
        engine.persist();
        const cached = storage.get("pim_azure_scopes_v1");
        expect(s2Of(get().extras.scopes)?.unreadScopeIds).toEqual([rgOf(2), rgOf(3), rgOf(4), rgOf(5)]);

        // The provider unmounts while the second group of the round is read
        arm.on({
            match: new RegExp(`^${rgOf(3)}${AUTH}/roleEligibilitySchedules$`),
            respond: () => {
                engine.abort();
                return { body: { value: [] } };
            },
        });
        await engine.resume();
        await vi.waitFor(() => expect(readGroups(arm)).toContain(rgOf(3)), { timeout: 15_000 });
        await new Promise((resolve) => setTimeout(resolve, 600));
        // The subscription keeps everything it had left: rg-2 and rg-3 were read in part of a round that never settled
        expect(s2Of(get().extras.scopes)?.unreadScopeIds).toEqual([rgOf(2), rgOf(3), rgOf(4), rgOf(5)]);
        expect(get().data.map((a) => a.scopeId)).not.toContain(rgOf(2));
        engine.persist();
        expect(storage.get("pim_azure_scopes_v1")).toBe(cached);
        vi.unstubAllGlobals();
    });
});

describe("the Azure adapter against the demo's fake ARM", () => {
    const azure = buildContosoAzure(new Date());
    const unhandled: unknown[] = [];
    const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));

    beforeAll(() => {
        const arm = createFakeArm(azure, { onUnhandled: (r) => unhandled.push(r) });
        vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph in this test")), arm: async () => arm, realFetch }));
    });
    afterAll(() => {
        vi.unstubAllGlobals();
        expect(realFetch).not.toHaveBeenCalled();
        expect(unhandled).toEqual([]);
    });

    it("builds the Contoso tree as the demo defines it, Contoso Labs from what the account reads below it", async () => {
        const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });
        const ctx = runContext(client);
        const first = await azureAssignmentsAdapter.run(ctx);
        await first.background;
        const outcome = latest(ctx, first);
        const S = AZURE_SCOPE_IDS;
        const parentOf = (id: string) => outcome.extras.scopes.find((s) => s.id === id)?.parentId;
        expect(parentOf(S.labs)).toBe(S.platform);
        expect(outcome.extras.scopes.find((s) => s.id === S.labs)?.access).toBe("partial");
        expect(outcome.extras.scopes.map((s) => s.id)).toEqual(expect.arrayContaining([S.rgLabs, S.labsVault, S.rgShared, S.labsVm]));
        expect(outcome.extras.scopes.map((s) => s.id)).not.toContain(S.rgPrivate);

        expect(parentOf(S.root)).toBeNull();
        expect(parentOf(S.tenantRootGroup)).toBe(S.root);
        expect(parentOf(S.platform)).toBe(S.tenantRootGroup);
        expect(parentOf(S.production)).toBe(S.platform);
        expect(parentOf(S.test)).toBe(S.platform);
        // Every scope in the tree is one of the demo's, under the same parent, a scope whose parent has no item of its
        // own being shown under the nearest parent above it that has one
        const inTree = new Set(outcome.extras.scopes.map((s) => s.id));
        const shownParent = (id: string): string | null => {
            let parent = azure.scopes.find((s) => s.id === id)?.parentId ?? null;
            while (parent !== null && !inTree.has(parent)) parent = azure.scopes.find((s) => s.id === parent)?.parentId ?? null;
            return parent;
        };
        for (const scope of outcome.extras.scopes) {
            // The delegated subscription is in no Contoso management group; the tree builder hangs it under the root when the root is shown
            if (scope.level === "subscription" && azure.scopes.find((s) => s.id === scope.id)?.parentId === null) continue;
            expect(shownParent(scope.id)).toBe(scope.parentId);
        }
        // getEntities gives the nesting: Tenant Root Group > Landing Zones > Corp > Corp Apps
        expect(parentOf(S.landingZones)).toBe(S.tenantRootGroup);
        expect(parentOf(S.corp)).toBe(S.landingZones);
        expect(parentOf(S.corpApps)).toBe(S.corp);
        expect(outcome.data.length).toBe(new Set(outcome.data.map((a) => a.id)).size);
        expect(outcome.data.length).toBeGreaterThan(0);
        expect(outcome.data.find((a) => a.roleName === "Contoso Web Operator")).toMatchObject({ state: "eligible", isCustomRole: true, scopeId: S.rgWeb });
    });

    it("shows a spent budget below Contoso Labs, and Read the rest reads vm-labs-build", async () => {
        const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });
        const S = AZURE_SCOPE_IDS;
        // The listing (2) and one scope (2): rg-labs is read, vm-labs-build is left
        const adapter = createAzureAssignmentsAdapter(() => null, { belowBudget: 4 });
        const ctx = runContext(client);
        const first = await adapter.run(ctx);
        await first.background;
        const partial = latest(ctx, first);
        expect(partial.extras.scopes.find((s) => s.id === S.labs)).toMatchObject({ access: "partial", unreadScopeIds: [S.labsVm] });
        expect(partial.data.map((a) => a.scopeId)).not.toContain(S.labsVm);

        const restCtx = { ...runContext(client), current: () => partial };
        const rest = await adapter.resume!.run(restCtx);
        await rest.background;
        const done = latest(restCtx, rest);
        expect(done.extras.scopes.find((s) => s.id === S.labs)?.unreadScopeIds).toBeUndefined();
        expect(done.extras.scopes.map((s) => s.id)).toContain(S.labsVm);
        expect(done.data.map((a) => a.scopeId)).toContain(S.labsVm);
        expect(new Set(done.data.map((a) => a.id)).size).toBe(done.data.length);
    });
});
