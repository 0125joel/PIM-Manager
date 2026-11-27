import { describe, expect, it, vi } from "vitest";
import { readExistingDirectoryIds, readServicePrincipalInfo, readServicePrincipalTypes } from "@/services/servicePrincipalTypeService";
import { Logger } from "@/utils/logger";
import { createRecordingClient, graphError } from "../support/recordingGraphClient";

// No waits between retries: the outcome is the same, only faster
vi.mock("@/utils/retryUtils", () => ({ withRetry: <T>(fn: () => Promise<T>) => fn() }));

const A = "00000000-0000-0000-0000-00000000aaaa";
const B = "00000000-0000-0000-0000-00000000bbbb";
const notFound = () => { throw graphError(404, "Request_ResourceNotFound"); };

describe("readByIds through its exported reads", () => {
    it("gives an empty set for one unknown id (404 on a chunk of one), without throwing", async () => {
        vi.spyOn(Logger, "warn").mockImplementation(() => {});
        const graph = createRecordingClient([{ match: /^\/users$/, respond: notFound }]);
        expect((await readExistingDirectoryIds(graph.client, "/users", [A])).size).toBe(0);
    });

    it("gives an empty map for one unknown service principal id", async () => {
        const graph = createRecordingClient([{ match: /^\/servicePrincipals$/, respond: notFound }]);
        expect((await readServicePrincipalTypes(graph.client, [A])).size).toBe(0);
    });

    it("still throws on a 404 for a chunk of two ids", async () => {
        vi.spyOn(Logger, "warn").mockImplementation(() => {});
        const graph = createRecordingClient([{ match: /^\/users$/, respond: notFound }]);
        await expect(readExistingDirectoryIds(graph.client, "/users", [A, B])).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("readServicePrincipalInfo", () => {
    it("gives the type and the appId per object id from one read, keyed by lowercase id", async () => {
        const graph = createRecordingClient([{
            match: /^\/servicePrincipals$/,
            respond: () => ({ value: [{ id: A.toUpperCase(), servicePrincipalType: "Application", appId: "11111111-1111-1111-1111-111111111111" }] }),
        }]);
        const info = await readServicePrincipalInfo(graph.client, [A]);
        expect(info.types.get(A)).toBe("Application");
        expect(info.appIds.get(A)).toBe("11111111-1111-1111-1111-111111111111");
    });
});
