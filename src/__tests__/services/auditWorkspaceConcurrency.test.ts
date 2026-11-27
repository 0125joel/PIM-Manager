import { describe, expect, it } from "vitest";
import { readWorkspaces } from "@/services/auditWorkspaceService";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { AZURE_CHECK_QUERY, CHECK_QUERY } from "@/utils/auditWorkspaceKql";

/**
 * AU-22: the read and the check of a workspace run together, and the queries of the Entra and the Azure read together never
 * exceed the 5 that Log Analytics allows per user. `fetchImpl` replaces the network; nothing reaches a tenant.
 */

const WS = [
    { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "law-a" },
    { customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "law-b" },
    { customerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "law-c" },
];
const token = async () => "token";
const OLDEST = "2026-08-01T00:00:00.000Z";
const NEWEST = "2026-11-01T00:00:00.000Z";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const table = (columns: string[], rows: unknown[][]) => ({ tables: [{ name: "PrimaryResult", columns: columns.map((name) => ({ name, type: "string" })), rows }] });

/** What the workspace answers for each of the four queries, by the query text */
function answer(query: string, subscription = "s-1") {
    if (query === CHECK_QUERY) return table(["Oldest", "Newest"], [[OLDEST, NEWEST]]);
    if (query === AZURE_CHECK_QUERY) return table(["SubscriptionId", "Oldest", "Newest"], [[subscription, OLDEST, NEWEST]]);
    return table([], []);
}

function recorder(respond: (query: string) => Response | Promise<Response> = (query) => json(answer(query)), delayMs = 15) {
    const state = { inFlight: 0, peak: 0, started: [] as string[], total: 0 };
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
        const query = (JSON.parse(String(init?.body)) as { query: string }).query;
        state.started.push(query === CHECK_QUERY || query === AZURE_CHECK_QUERY ? "check" : "read");
        state.total++;
        state.inFlight++;
        state.peak = Math.max(state.peak, state.inFlight);
        try {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return await respond(query);
        } finally {
            state.inFlight--;
        }
    }) as typeof fetch;
    return { state, fetchImpl };
}

describe("the Log Analytics queries", () => {
    it("holds at most 5 in flight with 3 workspaces read for both logs together", async () => {
        const { state, fetchImpl } = recorder();
        const [entra, azure] = await Promise.all([
            readWorkspaces(token, WS, 30, { fetchImpl }),
            readAzureWorkspaces(token, WS, 30, { fetchImpl }),
        ]);
        expect(state.total).toBe(12);
        expect(state.peak).toBe(5);
        expect(entra.map((read) => read.workspace.name)).toEqual(["law-a", "law-b", "law-c"]);
        expect(azure.every((read) => read.ok)).toBe(true);
    });

    it("sends the read and the check of a workspace at the same time", async () => {
        // Neither answers before both were sent: one after the other would never finish
        let sent = 0;
        let bothSent!: () => void;
        const both = new Promise<void>((resolve) => (bothSent = resolve));
        const { fetchImpl } = recorder(async (query) => {
            await both;
            return json(answer(query));
        }, 0);
        const counting = (async (url: unknown, init?: RequestInit) => {
            const pending = fetchImpl(url as RequestInfo, init);
            if (++sent === 2) bothSent();
            return pending;
        }) as typeof fetch;
        const [read] = await readWorkspaces(token, [WS[0]], 30, { fetchImpl: counting });
        expect(read.ok).toBe(true);
        sent = 0;
        const [azure] = await readAzureWorkspaces(token, [WS[0]], 30, { fetchImpl: counting });
        expect(azure.ok).toBe(true);
    }, 5000);

    it("keeps a failed check a refinement, and ignores the check when the read fails", async () => {
        const checkRefused = recorder((query) => (query === CHECK_QUERY || query === AZURE_CHECK_QUERY ? json({ error: { code: "AuthorizationFailed", message: "no" } }, 403) : json(answer(query))));
        const [entra] = await readWorkspaces(token, [WS[0]], 30, { fetchImpl: checkRefused.fetchImpl });
        const [azure] = await readAzureWorkspaces(token, [WS[0]], 30, { fetchImpl: checkRefused.fetchImpl });
        // Rows read, no reach from the check: still read
        expect(entra).toMatchObject({ ok: true, oldestAuditEvent: undefined });
        expect(azure).toMatchObject({ ok: true, subscriptionIds: null, oldest: null });

        const readRefused = recorder((query) => (query === CHECK_QUERY || query === AZURE_CHECK_QUERY ? json(answer(query)) : json({ error: { code: "AuthorizationFailed", message: "no" } }, 403)));
        const [entraFailed] = await readWorkspaces(token, [WS[0]], 30, { fetchImpl: readRefused.fetchImpl });
        const [azureFailed] = await readAzureWorkspaces(token, [WS[0]], 30, { fetchImpl: readRefused.fetchImpl });
        expect(entraFailed.ok).toBe(false);
        expect(azureFailed.ok).toBe(false);
    });

    it("takes the reach of the check when it is there", async () => {
        const { fetchImpl } = recorder();
        const [entra] = await readWorkspaces(token, [WS[0]], 30, { fetchImpl });
        const [azure] = await readAzureWorkspaces(token, [WS[0]], 30, { fetchImpl });
        expect(entra).toMatchObject({ ok: true, oldestAuditEvent: OLDEST });
        expect(azure).toMatchObject({ ok: true, subscriptionIds: ["s-1"], oldest: OLDEST });
    });

    it("an abort while a query waits for a slot ends the read with an AbortError", async () => {
        const { fetchImpl } = recorder(undefined, 50);
        const controller = new AbortController();
        const reading = readAzureWorkspaces(token, WS, 30, { fetchImpl, signal: controller.signal });
        const outcome = expect(reading).rejects.toMatchObject({ name: "AbortError" });
        setTimeout(() => controller.abort(), 5);
        await outcome;
    });
});
