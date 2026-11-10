import { afterEach, describe, expect, it, vi } from "vitest";
import { listRoleDefinitions } from "@/services/azureRoleDefinitionService";
import { ALERTS_API_VERSION, listRoleManagementAlerts } from "@/services/azureAlertService";
import { readExistingDirectoryIds, readServicePrincipalTypes } from "@/services/servicePrincipalTypeService";
import { Logger } from "@/utils/logger";
import { createRecordingArmClient } from "../support/recordingArmClient";
import { createRecordingClient, graphError } from "../support/recordingGraphClient";

/** The three new reads of the Azure dashboard, with recording clients: nothing here reaches ARM or Graph. */

const SUB = "aaaaaaaa-0000-0000-0000-000000000001";

describe("listRoleDefinitions", () => {
    it("lists the built-in roles at the tenant with the type filter", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions$/, respond: () => ({ body: { value: [{ id: "x", name: "r1", type: "t", properties: { roleName: "R1" } }] } }) }]);
        const roles = await listRoleDefinitions(arm.client, "/", "BuiltInRole");
        expect(roles.map((r) => r.name)).toEqual(["r1"]);
        expect(arm.requests).toHaveLength(1);
        expect(arm.requests[0]).toMatchObject({ method: "GET", path: "/providers/Microsoft.Authorization/roleDefinitions", apiVersion: "2022-04-01", query: { $filter: "type eq 'BuiltInRole'" } });
    });

    it("starts the path with the subscription when asked at a subscription", async () => {
        const arm = createRecordingArmClient([{ match: /roleDefinitions$/, respond: () => ({ body: { value: [] } }) }]);
        await listRoleDefinitions(arm.client, `/subscriptions/${SUB}`, "CustomRole");
        expect(arm.requests[0].path).toBe(`/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions`);
        expect(arm.requests[0].query).toEqual({ $filter: "type eq 'CustomRole'" });
    });
});

describe("listRoleManagementAlerts", () => {
    it("reads the alerts of a subscription at the preview version, without a filter", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementAlerts$/, respond: () => ({ body: { value: [{ id: "a", name: "A", properties: { isActive: true } }] } }) }]);
        const alerts = await listRoleManagementAlerts(arm.client, SUB);
        expect(alerts).toHaveLength(1);
        expect(arm.requests[0]).toMatchObject({ method: "GET", path: `/subscriptions/${SUB}/providers/Microsoft.Authorization/roleManagementAlerts`, apiVersion: "2022-08-01-preview", query: {} });
        expect(ALERTS_API_VERSION).toBe("2022-08-01-preview");
    });

    it("encodes the subscription id, so it cannot change the path or add a query", async () => {
        const arm = createRecordingArmClient([{ match: /roleManagementAlerts$/, respond: () => ({ body: { value: [] } }) }]);
        await listRoleManagementAlerts(arm.client, "../x?y");
        expect(arm.requests[0].url).toBe("https://management.azure.com/subscriptions/..%2Fx%3Fy/providers/Microsoft.Authorization/roleManagementAlerts?api-version=2022-08-01-preview");
    });
});

describe("readServicePrincipalTypes", () => {
    const ids = Array.from({ length: 31 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`.toUpperCase());

    it("asks 15, 15 and 1 ids per request and maps the answers by lowercase id", async () => {
        const graph = createRecordingClient([
            {
                match: /^\/servicePrincipals$/,
                respond: (request) => {
                    const asked = [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
                    return { value: asked.map((id) => ({ id, servicePrincipalType: id.endsWith("0") ? "ManagedIdentity" : "Application" })) };
                },
            },
        ]);
        const types = await readServicePrincipalTypes(graph.client, [...ids, ids[0]]);
        expect(graph.requests).toHaveLength(3);
        const sizes = graph.requests.map((r) => (r.query.filter ?? "").match(/'/g)!.length / 2).sort((a, b) => b - a);
        expect(sizes).toEqual([15, 15, 1]);
        for (const request of graph.requests) {
            expect(request).toMatchObject({ method: "GET", version: "v1.0", path: "/servicePrincipals", query: { select: "id,servicePrincipalType" } });
        }
        expect(types.size).toBe(31);
        expect(types.get(ids[0].toLowerCase())).toBe("ManagedIdentity");
        expect(types.get(ids[1].toLowerCase())).toBe("Application");
    });

    it("throws when a chunk fails", async () => {
        const graph = createRecordingClient([{ match: /^\/servicePrincipals$/, respond: () => { throw graphError(400, "Request_BadRequest"); } }]);
        await expect(readServicePrincipalTypes(graph.client, ids.slice(0, 3))).rejects.toMatchObject({ statusCode: 400 });
    });

    it("asks only for GUIDs: anything else stays out of the filter and counts as not found", async () => {
        const graph = createRecordingClient([
            { match: /^\/servicePrincipals$/, respond: (request) => ({ value: [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => ({ id: m[1], servicePrincipalType: "Application" })) }) },
        ]);
        const types = await readServicePrincipalTypes(graph.client, [ids[0], "x') or (1 eq 1", "a&b=c", ""]);
        expect(graph.requests).toHaveLength(1);
        expect(graph.requests[0].query.filter).toBe(`id in ('${ids[0].toLowerCase()}')`);
        expect([...types.keys()]).toEqual([ids[0].toLowerCase()]);
    });

    it("sends no request when no id is a GUID", async () => {
        const graph = createRecordingClient([]);
        expect((await readServicePrincipalTypes(graph.client, ["not-a-guid"])).size).toBe(0);
        expect(graph.requests).toHaveLength(0);
    });
});

describe("readByIds logging", () => {
    afterEach(() => vi.restoreAllMocks());

    it("logs status and code only, never the message that repeats the ids", async () => {
        const id = "00000000-0000-0000-0000-00000000abcd";
        const lines: string[] = [];
        for (const level of ["error", "warn", "info", "debug"] as const) vi.spyOn(Logger, level).mockImplementation((_context: string, message: string, ...args: unknown[]) => { lines.push([message, ...args.map(String)].join(" ")); });
        const graph = createRecordingClient([{ match: /^\/users$/, respond: () => { throw graphError(400, "Request_BadRequest", `Invalid filter clause: id in ('${id}')`); } }]);
        await expect(readExistingDirectoryIds(graph.client, "/users", [id])).rejects.toMatchObject({ statusCode: 400 });
        expect(lines.some((line) => line.includes("status 400, code Request_BadRequest"))).toBe(true);
        expect(lines.filter((line) => line.includes(id))).toEqual([]);
    });
});

describe("readExistingDirectoryIds", () => {
    const ids = Array.from({ length: 16 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`.toUpperCase());

    it.each(["/users", "/groups"] as const)("asks %s for the ids only, in chunks of 15, and returns the ones found in lowercase", async (path) => {
        const graph = createRecordingClient([
            {
                match: path === "/users" ? /^\/users$/ : /^\/groups$/,
                // The first id is gone
                respond: (request) => ({ value: [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((id) => id !== ids[0].toLowerCase()).map((id) => ({ id })) }),
            },
        ]);
        const found = await readExistingDirectoryIds(graph.client, path, ids);
        expect(graph.requests).toHaveLength(2);
        for (const request of graph.requests) expect(request).toMatchObject({ method: "GET", version: "v1.0", path, query: { select: "id" } });
        expect(found.size).toBe(15);
        expect(found.has(ids[0].toLowerCase())).toBe(false);
        expect(found.has(ids[1].toLowerCase())).toBe(true);
    });

    it("throws when a chunk fails, so no existing account is called deleted", async () => {
        const graph = createRecordingClient([{ match: /^\/users$/, respond: () => { throw graphError(403, "Authorization_RequestDenied"); } }]);
        await expect(readExistingDirectoryIds(graph.client, "/users", ids.slice(0, 2))).rejects.toMatchObject({ statusCode: 403 });
    });
});
