import { describe, it, expect } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { fetchUserTypes } from "@/services/directoryRoleService";

function mockClient(respond: (filter: string) => { id: string; userType?: string }[] | Error) {
    const calls: { path: string; version: string; filter: string; select: string }[] = [];
    const client = {
        api(path: string) {
            const call = { path, version: "", filter: "", select: "" };
            const chain = {
                version(v: string) { call.version = v; return chain; },
                filter(f: string) { call.filter = f; return chain; },
                select(s: string) { call.select = s; return chain; },
                async get() {
                    calls.push(call);
                    const result = respond(call.filter);
                    if (result instanceof Error) throw result;
                    return { value: result };
                },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, calls };
}

describe("fetchUserTypes", () => {
    it("reads at most 15 ids per request from v1.0 /users and merges the answers", async () => {
        const ids = Array.from({ length: 31 }, (_, i) => `u${i}`);
        const { client, calls } = mockClient((filter) => {
            const requested = filter.match(/'u\d+'/g)?.map((s) => s.slice(1, -1)) ?? [];
            return requested.map((id) => ({ id, userType: id === "u3" ? "Guest" : "Member" }));
        });

        const result = await fetchUserTypes(client, ids);

        expect(calls).toHaveLength(3);
        expect(calls.every((c) => c.path === "/users" && c.version === "v1.0" && c.select === "id,userType")).toBe(true);
        expect(calls.map((c) => (c.filter.match(/'/g) ?? []).length / 2)).toEqual([15, 15, 1]);
        expect(result.size).toBe(31);
        expect(result.get("u3")).toBe("Guest");
        expect(result.get("u4")).toBe("Member");
    });

    it("does not call Graph without ids", async () => {
        const { client, calls } = mockClient(() => []);
        expect((await fetchUserTypes(client, [])).size).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it("leaves the users of a failed request out instead of failing", async () => {
        const { client } = mockClient(() => Object.assign(new Error("boom"), { statusCode: 400 }));
        expect((await fetchUserTypes(client, ["a", "b"])).size).toBe(0);
    });
});
