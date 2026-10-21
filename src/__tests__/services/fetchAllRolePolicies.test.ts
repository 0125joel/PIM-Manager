import { describe, it, expect } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { fetchAllRolePolicies, type BulkPolicyRead } from "@/services/directoryRoleService";

/** The policies of a read that answered, or null when it did not */
const readPolicies = (result: BulkPolicyRead) => (result.kind === "read" ? result.policies : null);

type Page = { value?: unknown[]; "@odata.nextLink"?: string } | Error;

function mockClient(pages: Page[]) {
    const requests: string[] = [];
    let i = 0;
    const client = {
        api(path: string) {
            const chain = {
                version() { return chain; },
                filter() { return chain; },
                expand() { return chain; },
                header() { return chain; },
                async get() {
                    requests.push(path);
                    const page = pages[i++];
                    if (page instanceof Error) throw page;
                    return page;
                },
            };
            return chain;
        },
    } as unknown as Client;
    return { client, requests };
}

const item = (id: string) => ({ id: `p_${id}`, roleDefinitionId: id, policy: { id: `p_${id}`, rules: [] } });

describe("fetchAllRolePolicies", () => {
    it("maps the policies by role id", async () => {
        const { client } = mockClient([{ value: [item("a"), item("b")] }]);
        const result = await fetchAllRolePolicies(client);
        expect([...readPolicies(result)!.keys()]).toEqual(["a", "b"]);
    });

    it("follows @odata.nextLink", async () => {
        const { client, requests } = mockClient([
            { value: [item("a")], "@odata.nextLink": "https://graph.microsoft.com/next" },
            { value: [item("b")] },
        ]);
        const result = await fetchAllRolePolicies(client);
        expect(readPolicies(result)!.size).toBe(2);
        expect(requests[1]).toBe("https://graph.microsoft.com/next");
    });

    it("ignores entries without a policy", async () => {
        const { client } = mockClient([{ value: [{ roleDefinitionId: "x" }, item("a")] }]);
        expect([...readPolicies(await fetchAllRolePolicies(client))!.keys()]).toEqual(["a"]);
    });

    it("tells a 403 on the first page apart from any other failure (FIX-12)", async () => {
        const forbidden = mockClient([Object.assign(new Error("denied"), { statusCode: 403 })]);
        expect(await fetchAllRolePolicies(forbidden.client)).toEqual({ kind: "forbidden" });
        const failing = mockClient([Object.assign(new Error("boom"), { statusCode: 500 })]);
        expect(await fetchAllRolePolicies(failing.client)).toEqual({ kind: "failed" });
    });

    it("keeps the part that arrived when a later page fails", async () => {
        const { client } = mockClient([
            { value: [item("a")], "@odata.nextLink": "https://graph.microsoft.com/next" },
            Object.assign(new Error("denied"), { statusCode: 403 }),
        ]);
        expect([...readPolicies(await fetchAllRolePolicies(client))!.keys()]).toEqual(["a"]);
    });
});
