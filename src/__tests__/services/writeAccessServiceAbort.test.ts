import { describe, expect, it, vi } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import { fetchMyGroupInstances } from "@/services/writeAccessService";

/** The own PIM group read stops when its reader is gone: no request with an aborted signal, no next page after an abort */

function pagedClient(pages: Array<{ value: unknown[]; "@odata.nextLink"?: string }>) {
    const get = vi.fn(async () => pages.shift() ?? { value: [] });
    const request = { version: () => request, get };
    const client = { api: vi.fn(() => request) } as unknown as Client;
    return { client, get };
}

describe("fetchMyGroupInstances and its signal", () => {
    it("sends nothing when the signal is already aborted", async () => {
        const { client, get } = pagedClient([{ value: [] }]);
        const controller = new AbortController();
        controller.abort();
        await expect(fetchMyGroupInstances(client, "eligibility", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(get).not.toHaveBeenCalled();
    });

    it("asks no next page after an abort", async () => {
        const controller = new AbortController();
        const { client, get } = pagedClient([{ value: [{ groupId: "g1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }, { value: [{ groupId: "g2" }] }]);
        get.mockImplementationOnce(async () => { controller.abort(); return { value: [{ groupId: "g1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }; });
        await expect(fetchMyGroupInstances(client, "assignment", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        expect(get).toHaveBeenCalledTimes(1);
    });

    it("reads every page without a signal, as before", async () => {
        const { client } = pagedClient([{ value: [{ groupId: "g1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next" }, { value: [{ groupId: "g2" }] }]);
        await expect(fetchMyGroupInstances(client, "eligibility")).resolves.toEqual([{ groupId: "g1" }, { groupId: "g2" }]);
    });
});
