import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContosoAzure } from "@/demo/contoso/azure";
import { CONTOSO_TENANT_ID, demoGuid } from "@/demo/contoso/ids";
import { DEMO_WORKSPACE_FAILING_SUBSCRIPTION, DEMO_WORKSPACES } from "@/demo/contoso/workspaces";
import { ARM_API_VERSIONS, createFakeArm, type ArmRequest, type ArmResponse } from "@/demo/arm/server";
import { DEMO_WRITE_ERROR_CODE } from "@/demo/graph/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { listWorkspaces } from "@/services/auditWorkspaceService";
import { createArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";

/**
 * The Resource Graph read of the workspace list (`auditWorkspaceService`, after a subscription failed) is a POST that only
 * reads. The demo answers it as a read, from its workspace list; every other POST stays a refused write (403 DemoEnvironment),
 * which is not reported as a gap.
 */

const azure = buildContosoAzure(new Date());
const RESOURCE_GRAPH = "/providers/Microsoft.ResourceGraph/resources";
const WORKSPACE_QUERY = "Resources | where type =~ 'microsoft.operationalinsights/workspaces' | project id, name, location, subscriptionId, customerId=properties.customerId, retention=properties.retentionInDays";
const subscriptionId = (key: "production" | "test" | "labs" | typeof DEMO_WORKSPACE_FAILING_SUBSCRIPTION) => demoGuid(`azure:sub:${key}`);
const PRODUCTION = subscriptionId("production");
const FAILING = subscriptionId(DEMO_WORKSPACE_FAILING_SUBSCRIPTION);

const unhandled: ArmRequest[] = [];
const arm = createFakeArm(azure, { onUnhandled: (r) => unhandled.push(r) });
const posts: Array<{ url: string; status: number }> = [];
const recording = {
    handle(request: ArmRequest): ArmResponse {
        const response = arm.handle(request);
        if (request.method.toUpperCase() === "POST") posts.push({ url: request.url, status: response.status });
        return response;
    },
};
const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));
const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });

const resourceGraphUrl = (apiVersion: string = ARM_API_VERSIONS.resourceGraph) => `https://management.azure.com${RESOURCE_GRAPH}?api-version=${apiVersion}`;
const body = (subscriptions: string[], query: string = WORKSPACE_QUERY) => ({ query, subscriptions });

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph in this test")), arm: async () => recording, realFetch }));
});
afterAll(() => {
    vi.unstubAllGlobals();
    expect(realFetch).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
});

describe("the Resource Graph workspace read against the fake ARM", () => {
    it("answers the read as a read: the workspaces of the subscriptions asked for, in the shape the service reads", () => {
        const response = arm.handle({ method: "POST", url: resourceGraphUrl(), body: body([PRODUCTION, FAILING]) });
        expect(response.status).toBe(200);
        const rows = (response.body as { data: Array<{ name: string; subscriptionId: string; customerId: string; retention: number; id: string }> }).data;
        expect(rows.map((r) => r.name).sort()).toEqual(DEMO_WORKSPACES.filter((w) => w.subscription === "production").map((w) => w.name).sort());
        const entra = DEMO_WORKSPACES.find((w) => w.behavior === "entra");
        expect(rows.find((r) => r.name === entra?.name)).toMatchObject({ customerId: entra?.customerId, retention: 180, subscriptionId: PRODUCTION });
        expect(rows.every((r) => r.id.toLowerCase().startsWith(`/subscriptions/${r.subscriptionId}/`))).toBe(true);
    });

    it("answers no row for the failing subscription, so it stays failed", () => {
        const response = arm.handle({ method: "POST", url: resourceGraphUrl(), body: body([FAILING]) });
        expect(response.status).toBe(200);
        expect((response.body as { data: unknown[] }).data).toEqual([]);
    });

    it("refuses every other POST with 403 DemoEnvironment, without reporting it as a gap", () => {
        const seen: ArmRequest[] = [];
        const fake = createFakeArm(azure, { onUnhandled: (r) => seen.push(r) });
        const refused = [
            { method: "POST", url: resourceGraphUrl("2021-04-01"), body: body([PRODUCTION]) },
            { method: "POST", url: resourceGraphUrl(), body: body([PRODUCTION], "Resources | where type =~ 'microsoft.compute/virtualmachines'") },
            { method: "POST", url: resourceGraphUrl(), body: { query: WORKSPACE_QUERY } },
            { method: "POST", url: resourceGraphUrl(), body: "not an object" },
            { method: "POST", url: `https://management.azure.com/providers/Microsoft.ResourceGraph/resources/x?api-version=${ARM_API_VERSIONS.resourceGraph}`, body: body([PRODUCTION]) },
            { method: "POST", url: `https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=${ARM_API_VERSIONS.resourceGraph}&$top=1`, body: body([PRODUCTION]) },
        ];
        for (const request of refused) {
            const response = fake.handle(request);
            expect(response.status).toBe(403);
            expect((response.body as { error: { code: string } }).error.code).toBe(DEMO_WRITE_ERROR_CODE);
        }
        expect(seen).toEqual([]);
    });

    it("is reached by the workspace list as a read, and the failing subscription stays failed", async () => {
        posts.length = 0;
        const listing = await listWorkspaces(client, CONTOSO_TENANT_ID);
        expect(posts.filter((p) => p.url.includes(RESOURCE_GRAPH))).toHaveLength(1);
        expect(posts.filter((p) => p.url.includes(RESOURCE_GRAPH)).every((p) => p.status === 200)).toBe(true);
        expect(listing.failedSubscriptions).toHaveLength(1);
        expect(listing.failedSubscriptions[0]).toMatchObject({ name: "Contoso Corp Apps", reason: "403" });
        expect(listing.workspaces.map((w) => w.name).sort()).toEqual(DEMO_WORKSPACES.map((w) => w.name).sort());
    });
});
