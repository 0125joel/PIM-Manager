import { describe, expect, it } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { addGroupUserTypes } from "@/services/pimGroupService";
import { group, groupPrincipal, user } from "../fixtures/dashboardFilterFixtures";

function mockClient(types: Record<string, string>) {
    const filters: string[] = [];
    const client = {
        api() {
            let filter = "";
            const chain = {
                version() { return chain; },
                filter(f: string) { filter = f; return chain; },
                select() { return chain; },
                async get() {
                    filters.push(filter);
                    const ids = filter.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
                    return { value: ids.filter((id) => types[id]).map((id) => ({ id, userType: types[id] })) };
                },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, filters };
}

describe("addGroupUserTypes", () => {
    it("sets principalUserType on user principals, skips groups and apps, and looks up ids once", async () => {
        const data = [
            group("g1", [{ principalId: "u1", principal: user("u1") as never }, { principalId: "u2", principal: user("u2") as never }, { principalId: "g9", principal: groupPrincipal("g9") as never }]),
            group("g2", [{ principalId: "u1", principal: user("u1") as never }]),
        ];
        const { client, filters } = mockClient({ u1: "Guest", u2: "Member" });
        const result = await addGroupUserTypes(client, data);
        expect(result[0].assignments.map((a) => a.principalUserType)).toEqual(["Guest", "Member", undefined]);
        expect(result[1].assignments[0].principalUserType).toBe("Guest");
        expect(filters).toHaveLength(1);
        expect(filters[0]).not.toContain("g9");
    });

    it("reuses the types of the previous load and asks only for new ids", async () => {
        const previous = [group("g1", [{ principalId: "u1", principal: user("u1") as never, principalUserType: "Guest" }])];
        const data = [group("g1", [{ principalId: "u1", principal: user("u1") as never }, { principalId: "u3", principal: user("u3") as never }])];
        const { client, filters } = mockClient({ u3: "Member" });
        const result = await addGroupUserTypes(client, data, previous);
        expect(result[0].assignments.map((a) => a.principalUserType)).toEqual(["Guest", "Member"]);
        expect(filters).toHaveLength(1);
        expect(filters[0]).toContain("u3");
        expect(filters[0]).not.toContain("u1");
    });

    it("returns the groups unchanged when nothing is found", async () => {
        const data = [group("g1", [{ principalId: "u1", principal: user("u1") as never }])];
        const { client } = mockClient({});
        expect(await addGroupUserTypes(client, data)).toBe(data);
    });
});
