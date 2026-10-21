import { describe, it, expect, vi } from "vitest";
import { graphRateLimiter } from "@/utils/rateLimiter";
import type { Client } from "@microsoft/microsoft-graph-client";
import { fetchGroupMembersAndOwners } from "@/services/groupMembershipService";

interface Call { path: string; version: string; select: string; top: number }

type Responder = (call: Call) => unknown;

function mockClient(respond: Responder) {
    const calls: Call[] = [];
    const client = {
        api(path: string) {
            const call: Call = { path, version: "", select: "", top: 0 };
            const chain = {
                version(v: string) { call.version = v; return chain; },
                select(s: string) { call.select = s; return chain; },
                top(n: number) { call.top = n; return chain; },
                async get() {
                    calls.push(call);
                    const result = respond(call);
                    if (result instanceof Error) throw result;
                    return result;
                },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, calls };
}

const user = (id: string, extra: Record<string, unknown> = {}) => ({ id, "@odata.type": "#microsoft.graph.user", displayName: `User ${id}`, userPrincipalName: `${id}@contoso.com`, userType: "Member", ...extra });

describe("fetchGroupMembersAndOwners", () => {
    it("reads members and owners from beta with $select and $top=999", async () => {
        const { client, calls } = mockClient((call) => ({ value: call.path.endsWith("members") ? [user("m1"), { id: "sp1", "@odata.type": "#microsoft.graph.servicePrincipal", displayName: "App" }] : [user("o1", { userType: "Guest" })] }));
        const result = await fetchGroupMembersAndOwners(client, "g1");
        expect(calls.map((c) => c.path)).toEqual(["/groups/g1/members", "/groups/g1/owners"]);
        expect(calls.every((c) => c.version === "beta" && c.select === "id,displayName,userPrincipalName,userType" && c.top === 999)).toBe(true);
        expect(result.members.map((m) => [m.id, m.kind, m.userType])).toEqual([["m1", "user", "Member"], ["sp1", "servicePrincipal", undefined]]);
        expect(result.owners).toEqual([{ id: "o1", displayName: "User o1", userPrincipalName: "o1@contoso.com", userType: "Guest", kind: "user" }]);
    });

    it("follows @odata.nextLink", async () => {
        const { client, calls } = mockClient((call) => {
            if (call.path === "/groups/g1/members") return { value: [user("m1")], "@odata.nextLink": "https://graph.microsoft.com/beta/groups/g1/members?$skiptoken=abc" };
            if (call.path.includes("skiptoken")) return { value: [user("m2")] };
            return { value: [] };
        });
        const result = await fetchGroupMembersAndOwners(client, "g1");
        expect(result.members.map((m) => m.id)).toEqual(["m1", "m2"]);
        expect(calls).toHaveLength(3);
    });

    it("returns an empty owners list as value []", async () => {
        const { client } = mockClient((call) => ({ value: call.path.endsWith("members") ? [user("m1")] : [] }));
        expect((await fetchGroupMembersAndOwners(client, "g1")).owners).toEqual([]);
    });

    it("falls back to the UPN or a short id when the display name is missing", async () => {
        const { client } = mockClient((call) => ({ value: call.path.endsWith("members") ? [{ id: "abcdef1234", "@odata.type": "#microsoft.graph.user" }, user("m2", { displayName: null })] : [] }));
        const result = await fetchGroupMembersAndOwners(client, "g1");
        expect(result.members.map((m) => m.displayName)).toEqual(["Unknown (abcdef12)", "m2@contoso.com"]);
    });

    it("passes a 403 through with its status code", async () => {
        const forbidden = Object.assign(new Error("Authorization_RequestDenied"), { statusCode: 403 });
        const { client } = mockClient(() => forbidden);
        await expect(fetchGroupMembersAndOwners(client, "g1")).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe("fetchGroupMembersAndOwners and the shared rate limiter", () => {
    it("pays 3 resource units per members page and 1 per owners page", async () => {
        const acquire = vi.spyOn(graphRateLimiter, "acquire");
        const { client } = mockClient(() => ({ value: [] }));
        await fetchGroupMembersAndOwners(client, "g1");
        expect(acquire.mock.calls.map((c) => c[0])).toEqual([3, 1]);
        acquire.mockRestore();
    });
});
