import { describe, it, expect } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { escapeSearchTerm, searchUsers } from "@/services/userSearchService";

interface Call {
    path: string;
    headers: Record<string, string>;
    search?: string;
    filter?: string;
    select?: string;
    top?: number;
}

function stubClient(handler: (call: Call) => unknown) {
    const calls: Call[] = [];
    const client = {
        api(path: string) {
            const call: Call = { path, headers: {} };
            const chain = {
                header(k: string, v: string) { call.headers[k] = v; return chain; },
                search(s: string) { call.search = s; return chain; },
                filter(f: string) { call.filter = f; return chain; },
                select(s: string) { call.select = s; return chain; },
                top(n: number) { call.top = n; return chain; },
                async get() { calls.push(call); return handler(call); },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, calls };
}

describe("escapeSearchTerm", () => {
    it("removes quotes and backslashes that would end the quoted search string", () => {
        expect(escapeSearchTerm('bob "the" \\ builder')).toBe("bob  the    builder");
        expect(escapeSearchTerm('  "  ')).toBe("");
    });
});

describe("searchUsers", () => {
    it("sends $search with ConsistencyLevel eventual, a select and top 5", async () => {
        const { client, calls } = stubClient(() => ({ value: [{ id: "1", displayName: "Break Glass 01", userPrincipalName: "bg01@contoso.com" }] }));
        const users = await searchUsers(client, "break");
        expect(users).toEqual([{ id: "1", displayName: "Break Glass 01", userPrincipalName: "bg01@contoso.com" }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ path: "/users", select: "id,displayName,userPrincipalName", top: 5, headers: { ConsistencyLevel: "eventual" } });
        expect(calls[0].search).toBe('"displayName:break" OR "userPrincipalName:break"');
    });

    it("keeps a quote out of the $search expression", async () => {
        const { client, calls } = stubClient(() => ({ value: [] }));
        await searchUsers(client, 'o"brien');
        expect(calls[0].search).toBe('"displayName:o%20brien" OR "userPrincipalName:o%20brien"');
    });

    it("encodes & # and % in the term so they cannot end the URL query", async () => {
        const { client, calls } = stubClient(() => ({ value: [] }));
        await searchUsers(client, "a&b#c%d");
        expect(calls[0].search).toBe('"displayName:a%26b%23c%25d" OR "userPrincipalName:a%26b%23c%25d"');
    });

    it("falls back to startswith filters with doubled single quotes when $search is rejected", async () => {
        const { client, calls } = stubClient((call) => {
            if (call.search) throw Object.assign(new Error("bad request"), { statusCode: 400 });
            return { value: [{ id: "2", userPrincipalName: "o'brien@contoso.com" }] };
        });
        const users = await searchUsers(client, "o'brien");
        expect(calls).toHaveLength(2);
        expect(calls[1].filter).toBe("startswith(displayName,'o''brien') or startswith(userPrincipalName,'o''brien')");
        expect(users).toEqual([{ id: "2", displayName: "o'brien@contoso.com", userPrincipalName: "o'brien@contoso.com" }]);
    });

    it("does not call Graph for an empty term", async () => {
        const { client, calls } = stubClient(() => ({ value: [] }));
        expect(await searchUsers(client, '  "  ')).toEqual([]);
        expect(calls).toHaveLength(0);
    });
});
