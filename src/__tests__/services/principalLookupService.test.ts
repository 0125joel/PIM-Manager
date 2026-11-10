import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupPrincipals } from "@/services/principalLookupService";
import { Logger } from "@/utils/logger";
import { createRecordingClient, graphError } from "../support/recordingGraphClient";

// No waits between retries: the outcome is the same, only faster
vi.mock("@/utils/retryUtils", () => ({ withRetry: <T>(fn: () => Promise<T>) => fn() }));

/** The people lookup of Import with a recording client: nothing here reaches Graph. */

const ID = "00000000-0000-0000-0000-00000000abcd";

const echoIds = (request: { query: { filter?: string } }) => ({ value: [...(request.query.filter ?? "").matchAll(/'([^']+)'/g)].map((m) => ({ id: m[1], displayName: `Name ${m[1]}` })) });

describe("lookupPrincipals by id", () => {
    afterEach(() => vi.restoreAllMocks());

    it("asks only for GUIDs: anything else stays out of the filter and is not found", async () => {
        const graph = createRecordingClient([{ match: /^\/users$/, respond: echoIds }]);
        const found = await lookupPrincipals(graph.client, { ids: [ID, "x') or (1 eq 1", "a&b=c"], upns: [] });
        expect(graph.requests).toHaveLength(1);
        expect(graph.requests[0]).toMatchObject({ method: "GET", version: "v1.0", path: "/users", query: { filter: `id in ('${ID}')` } });
        expect([...found.byId.keys()]).toEqual([ID]);
    });

    it("sends no id request when no id is a GUID", async () => {
        const graph = createRecordingClient([]);
        const found = await lookupPrincipals(graph.client, { ids: ["not-a-guid"], upns: [] });
        expect(graph.requests).toHaveLength(0);
        expect(found.byId.size).toBe(0);
    });

    it("logs status and code only when an id read fails, never the message that repeats the ids", async () => {
        const lines: string[] = [];
        for (const level of ["error", "warn", "info", "debug"] as const) vi.spyOn(Logger, level).mockImplementation((_context: string, message: string, ...args: unknown[]) => { lines.push([message, ...args.map(String)].join(" ")); });
        const graph = createRecordingClient([{ match: /^\/users$/, respond: () => { throw graphError(400, "Request_BadRequest", `Invalid filter clause: id in ('${ID}')`); } }]);
        await expect(lookupPrincipals(graph.client, { ids: [ID], upns: [] })).rejects.toThrow();
        expect(lines.some((line) => line.includes("status 400, code Request_BadRequest"))).toBe(true);
        expect(lines.filter((line) => line.includes(ID))).toEqual([]);
    });

    it("leaves people unknown when the groups read is refused (403), and does not throw", async () => {
        const group = "00000000-0000-0000-0000-00000000beef";
        vi.spyOn(Logger, "warn").mockImplementation(() => {});
        const graph = createRecordingClient([
            { match: /^\/users$/, respond: (request) => ({ value: echoIds(request).value.filter((o) => o.id === ID) }) },
            { match: /^\/groups$/, respond: () => { throw graphError(403, "Authorization_RequestDenied"); } },
            { match: /^\/servicePrincipals$/, respond: () => ({ value: [] }) },
        ]);
        const found = await lookupPrincipals(graph.client, { ids: [ID, group], upns: [] });
        expect(found.byId.get(ID)?.kind).toBe("user");
        expect(found.byId.has(group)).toBe(false);
        expect(graph.requests.map((r) => r.path)).toEqual(["/users", "/groups", "/servicePrincipals"]);
    });

    it("throws on a 500 with status and code, without the ids or UPNs of the Graph message", async () => {
        const upn = "adele@contoso.com";
        vi.spyOn(Logger, "warn").mockImplementation(() => {});
        vi.spyOn(Logger, "error").mockImplementation(() => {});
        const graph = createRecordingClient([
            { match: (r) => r.path === "/users" && (r.query.filter ?? "").startsWith("userPrincipalName"), respond: () => ({ value: [] }) },
            { match: (r) => r.path === "/users" && (r.query.filter ?? "").startsWith("id in"), respond: () => { throw graphError(500, "InternalServerError", `Failed for id in ('${ID}') and '${upn}'`); } },
        ]);
        const error: unknown = await lookupPrincipals(graph.client, { ids: [ID], upns: [upn] }).then(() => null, (e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({ statusCode: 500, code: "InternalServerError" });
        const message = (error as Error).message;
        expect(message).toBe("Looking up people failed: status 500, code InternalServerError");
        expect(message).not.toContain(ID);
        expect(message).not.toContain(upn);
    });
});
