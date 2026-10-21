import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContosoTenant } from "@/demo/contoso/tenant";
import { createFakeGraph, type GraphRequest } from "@/demo/graph/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { createGraphClient } from "@/utils/graphClient";
import { fetchAllPimGroupData } from "@/services/pimGroupService";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";

/**
 * FIX-11: a user without a directory role that may read PIM settings gets 403 on the policy of some groups. The load
 * must keep every group, mark the refused one and not fail, and the refused read must not be retried.
 */

const now = new Date();
const tenant = buildContosoTenant(now);
const managed = tenant.groups.filter((g) => g.isPimManaged);
const denied = managed[0];
const reads: GraphRequest[] = [];
const served = createFakeGraph(tenant, {
    now: () => now,
    policyReadDenied: ({ scopeType, scopeId }) => scopeType === "Group" && scopeId === denied.id,
});
const counting = { handle: (request: GraphRequest) => { reads.push(request); return served.handle(request); } };

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: async () => counting, realFetch: () => Promise.reject(new Error("network")), latency: () => 0 }));
});
afterAll(() => {
    vi.unstubAllGlobals();
});

describe("PIM for Groups without the right to read group policies", () => {
    it("loads every group, marks the refused one and keeps its assignments", async () => {
        const data = await fetchAllPimGroupData(createGraphClient("demo-token"));
        const byId = new Map(data.map((d) => [d.group.id, d]));

        const refused = byId.get(denied.id);
        expect(refused).toMatchObject({ isManaged: true, policiesForbidden: true });
        expect(refused?.policies).toBeUndefined();
        expect(refused?.settings).toBeUndefined();

        const others = managed.filter((g) => g.id !== denied.id);
        expect(others.length).toBeGreaterThan(0);
        for (const g of others) {
            expect(byId.get(g.id)?.policiesForbidden).toBeUndefined();
        }
        expect(data.filter((d) => d.isManaged !== false).length).toBe(managed.length);
    }, 60000);

    it("asks Graph once for the refused group's policies: a 403 is never retried", () => {
        const refusedReads = reads.filter((r) => r.url.includes("roleManagementPolicyAssignments") && r.url.includes(denied.id));
        expect(refusedReads).toHaveLength(1);
    });

    it("says the same words wherever the sentence is shown", () => {
        expect(POLICY_NOT_READABLE).toBe("Settings not readable with your current access. Activate a role that may read PIM settings, then Refresh.");
    });
});

describe("the directory role policies without the right to read them (FIX-12)", () => {
    it("answers the one-call role policy read with 403, as Graph does, and the per-role read the same", () => {
        const roleServer = createFakeGraph(tenant, { now: () => now, policyReadDenied: ({ scopeType }) => scopeType === "Directory" });
        const bulk = roleServer.handle({ method: "GET", url: "/policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'Directory'" });
        expect(bulk.status).toBe(403);
        const single = roleServer.handle({ method: "GET", url: "/policies/roleManagementPolicyAssignments?$filter=scopeId eq '/' and scopeType eq 'Directory' and roleDefinitionId eq 'x'" });
        expect(single.status).toBe(403);
        const groupPolicy = roleServer.handle({ method: "GET", url: `/policies/roleManagementPolicyAssignments?$filter=scopeId eq '${denied.id}' and scopeType eq 'Group'` });
        expect(groupPolicy.status).toBe(200);
    });
});
