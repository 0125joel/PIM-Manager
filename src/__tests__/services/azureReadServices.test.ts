import { afterEach, describe, expect, it, vi } from "vitest";
import { listEntities, listResourceGroups, listResources, listSubscriptions } from "@/services/azureScopeService";
import { listAssignmentInstances, listAssignmentInstancesAt, listEligibilitySchedules, listEligibilitySchedulesAt, listMyAssignments, listMyEligibilities } from "@/services/azureAssignmentService";
import { ArmError } from "@/utils/armClient";
import { armError, createRecordingArmClient } from "../support/recordingArmClient";

/**
 * The Azure read services (implementation spec section 4 and 8) against the recording ARM client: the exact URLs and
 * api-versions of facts.md section 2, items passed on as they come, and a failed read that throws instead of shrinking
 * the list. Nothing here reaches ARM.
 */

const SUB = "00000000-0000-0000-0000-000000000003";
const ARM = "https://management.azure.com";
const AUTH = "/providers/Microsoft.Authorization";

const instance = (name: string, scope: string, memberType: string) => ({
    id: `${scope === "/" ? "" : scope}${AUTH}/roleAssignmentScheduleInstances/${name}`,
    name,
    type: "Microsoft.Authorization/roleAssignmentScheduleInstances",
    properties: { scope, memberType, principalId: "p", principalType: "User", roleDefinitionId: `/subscriptions/${SUB}${AUTH}/roleDefinitions/r`, status: "Provisioned" },
});

afterEach(() => {
    vi.useRealTimers();
});

describe("golden URLs", () => {
    it("listSubscriptions: GET /subscriptions at 2022-12-01", async () => {
        const arm = createRecordingArmClient([{ match: /^\/subscriptions$/, respond: () => ({ body: { value: [] } }) }]);
        await listSubscriptions(arm.client);
        expect(arm.requests.map((r) => r.url)).toEqual([`${ARM}/subscriptions?api-version=2022-12-01`]);
        expect(arm.requests[0].method).toBe("GET");
        expect(arm.requests[0].headers.Authorization).toBe("Bearer test-token");
    });

    it("the active instances and the eligibility schedules at a subscription, unfiltered, at 2020-10-01", async () => {
        const arm = createRecordingArmClient([{ match: /(ScheduleInstances|Schedules)$/, respond: () => ({ body: { value: [] } }) }]);
        await listAssignmentInstances(arm.client, SUB);
        await listEligibilitySchedules(arm.client, SUB);
        expect(arm.requests.map((r) => r.url)).toEqual([
            `${ARM}/subscriptions/${SUB}${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01`,
            `${ARM}/subscriptions/${SUB}${AUTH}/roleEligibilitySchedules?api-version=2020-10-01`,
        ]);
    });

    it("listMyEligibilities: asTarget() at root scope, at 2020-10-01", async () => {
        const arm = createRecordingArmClient([{ match: /ScheduleInstances$/, respond: () => ({ body: { value: [] } }) }]);
        await listMyEligibilities(arm.client);
        expect(arm.requests.map((r) => r.url)).toEqual([
            `${ARM}${AUTH}/roleEligibilityScheduleInstances?api-version=2020-10-01&$filter=asTarget()`,
        ]);
        expect(arm.requests[0].query).toEqual({ $filter: "asTarget()" });
    });

    it("listMyAssignments: asTarget() on the active list at root scope, at 2020-10-01", async () => {
        const arm = createRecordingArmClient([{ match: /ScheduleInstances$/, respond: () => ({ body: { value: [] } }) }]);
        await listMyAssignments(arm.client);
        expect(arm.requests.map((r) => r.url)).toEqual([
            `${ARM}${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01&$filter=asTarget()`,
        ]);
    });

    it("the resource groups and resources of a subscription, at 2021-04-01", async () => {
        const arm = createRecordingArmClient([{ match: /\/(resourcegroups|resources)$/, respond: () => ({ body: { value: [] } }) }]);
        await listResourceGroups(arm.client, SUB);
        await listResources(arm.client, SUB);
        expect(arm.requests.map((r) => r.url)).toEqual([
            `${ARM}/subscriptions/${SUB}/resourcegroups?api-version=2021-04-01`,
            `${ARM}/subscriptions/${SUB}/resources?api-version=2021-04-01`,
        ]);
    });

    it("the active instances and the eligibility schedules at a resource group, unfiltered, at 2020-10-01", async () => {
        const rg = `/subscriptions/${SUB}/resourceGroups/rg-a`;
        const arm = createRecordingArmClient([{ match: /(ScheduleInstances|Schedules)$/, respond: () => ({ body: { value: [] } }) }]);
        await listAssignmentInstancesAt(arm.client, rg);
        await listEligibilitySchedulesAt(arm.client, rg);
        expect(arm.requests.map((r) => r.url)).toEqual([
            `${ARM}${rg}${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01`,
            `${ARM}${rg}${AUTH}/roleEligibilitySchedules?api-version=2020-10-01`,
        ]);
    });

    it("encodes a subscription id that is not a plain GUID, so it cannot change the path", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ body: { value: [] } }) }]);
        await listAssignmentInstances(arm.client, "../x?y");
        expect(arm.requests[0].url).toBe(`${ARM}/subscriptions/..%2Fx%3Fy${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01`);
    });
});

describe("results", () => {
    it("returns the items at, below and above the subscription as they come, over every page", async () => {
        const next = `${ARM}/subscriptions/${SUB}${AUTH}/roleAssignmentScheduleInstances?api-version=2020-10-01&$skiptoken=2`;
        const first = [instance("a", "/", "Inherited"), instance("b", `/subscriptions/${SUB}`, "Direct")];
        const second = [instance("c", `/subscriptions/${SUB}/resourceGroups/rg`, "Direct")];
        const arm = createRecordingArmClient([{
            match: /roleAssignmentScheduleInstances$/,
            respond: (r) => (r.query.$skiptoken ? { body: { value: second } } : { body: { value: first, nextLink: next } }),
        }]);
        const items = await listAssignmentInstances(arm.client, SUB);
        expect(items).toEqual([...first, ...second]);
        expect(arm.requests).toHaveLength(2);
    });

    it("passes the subscriptions on with their tenant id", async () => {
        const subscription = { id: `/subscriptions/${SUB}`, subscriptionId: SUB, displayName: "Contoso Production", state: "Enabled", tenantId: "t" };
        const arm = createRecordingArmClient([{ match: /^\/subscriptions$/, respond: () => ({ body: { value: [subscription] } }) }]);
        expect(await listSubscriptions(arm.client)).toEqual([subscription]);
    });
});

describe("failures", () => {
    it("throws a 403 AuthorizationFailed at once, without a retry and without an empty list", async () => {
        const arm = createRecordingArmClient([{ match: /Schedules$/, respond: () => armError(403, "AuthorizationFailed") }]);
        const error = await listEligibilitySchedules(arm.client, SUB).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ArmError);
        expect((error as ArmError).statusCode).toBe(403);
        expect((error as ArmError).code).toBe("AuthorizationFailed");
        expect(arm.requests).toHaveLength(1);
    });

    it("throws when a later page fails, never a partial list", async () => {
        const next = `${ARM}/subscriptions?api-version=2022-12-01&$skiptoken=2`;
        const arm = createRecordingArmClient([{
            match: /^\/subscriptions$/,
            respond: (r) => (r.query.$skiptoken ? armError(400, "InvalidFilter") : { body: { value: [{ id: "x" }], nextLink: next } }),
        }]);
        await expect(listSubscriptions(arm.client)).rejects.toBeInstanceOf(ArmError);
    });

    it("retries a 5xx and then returns the whole list", async () => {
        vi.useFakeTimers();
        let calls = 0;
        const arm = createRecordingArmClient([{
            match: /^\/subscriptions$/,
            respond: () => (++calls === 1 ? armError(503, "ServiceUnavailable") : { body: { value: [{ id: "x" }] } }),
        }]);
        const result = listSubscriptions(arm.client);
        await vi.advanceTimersByTimeAsync(1000);
        expect(await result).toEqual([{ id: "x" }]);
        expect(arm.requests).toHaveLength(2);
    });

    it("stops when the signal is aborted", async () => {
        const arm = createRecordingArmClient([{ match: () => true, respond: () => ({ body: { value: [] } }) }]);
        const controller = new AbortController();
        controller.abort();
        await expect(listMyEligibilities(arm.client, controller.signal)).rejects.toThrow();
        expect(arm.requests).toHaveLength(0);
    });
});

describe("listEntities", () => {
    const GET_ENTITIES = "/providers/Microsoft.Management/getEntities";
    const ROOT = "/providers/Microsoft.Management/managementGroups/00000000-0000-0000-0000-000000000001";
    // The shape of docs/Assets/azure/spike-fixtures/getEntities.json
    const fixture = {
        count: 3,
        value: [
            { id: ROOT, name: "00000000-0000-0000-0000-000000000001", type: "Microsoft.Management/managementGroups", properties: { displayName: "Tenant Root Group", parent: {}, parentNameChain: [], tenantId: "00000000-0000-0000-0000-000000000001" } },
            { id: "/subscriptions/00000000-0000-0000-0000-000000000002", name: "00000000-0000-0000-0000-000000000002", type: "/subscriptions", properties: { displayName: "Sub 2", parent: { id: ROOT }, parentNameChain: ["00000000-0000-0000-0000-000000000001"], tenantId: "00000000-0000-0000-0000-000000000001" } },
        ],
    };

    it("sends POST getEntities at 2020-05-01 and follows a nextLink with POST", async () => {
        const arm = createRecordingArmClient([{
            match: (r) => r.path === GET_ENTITIES,
            respond: (r) => r.query.$skiptoken
                ? { body: { value: [fixture.value[1]] } }
                : { body: { value: [fixture.value[0]], nextLink: `${ARM}${GET_ENTITIES}?api-version=2020-05-01&$skiptoken=abc` } },
        }]);
        const entities = await listEntities(arm.client);
        expect(arm.requests.map((r) => [r.method, r.url])).toEqual([
            ["POST", `${ARM}${GET_ENTITIES}?api-version=2020-05-01`],
            ["POST", `${ARM}${GET_ENTITIES}?api-version=2020-05-01&$skiptoken=abc`],
        ]);
        expect(entities.map((e) => e.properties.displayName)).toEqual(["Tenant Root Group", "Sub 2"]);
    });

    it("maps the fixture and returns an empty list for the empty Reader answer", async () => {
        const arm = createRecordingArmClient([{ match: (r) => r.path === GET_ENTITIES, respond: () => ({ body: fixture }) }]);
        const entities = await listEntities(arm.client);
        expect(entities).toHaveLength(2);
        expect(entities[1].properties.parent?.id).toBe(ROOT);
        const empty = createRecordingArmClient([{ match: (r) => r.path === GET_ENTITIES, respond: () => ({ body: { count: 0, value: [] } }) }]);
        await expect(listEntities(empty.client)).resolves.toEqual([]);
    });

    it("throws on a failed read", async () => {
        const arm = createRecordingArmClient([{ match: (r) => r.path === GET_ENTITIES, respond: () => armError(403, "AuthorizationFailed") }]);
        await expect(listEntities(arm.client)).rejects.toBeInstanceOf(ArmError);
    });
});
