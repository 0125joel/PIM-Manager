import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContosoAzure } from "@/demo/contoso/azure";
import { CONTOSO_TENANT_ID } from "@/demo/contoso/ids";
import { DEMO_ACTIVITY_SUBSCRIPTIONS, DEMO_WORKSPACES } from "@/demo/contoso/workspaces";
import { createFakeArm, type ArmRequest } from "@/demo/arm/server";
import { createFakeLogAnalytics, type LogAnalyticsRequest } from "@/demo/loganalytics/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { checkWorkspaceLogs, listActivityLogWorkspaceIds, listAuditLogWorkspaceIds, listWorkspaces, queryWorkspace, readWorkspaces } from "@/services/auditWorkspaceService";
import { mapAuditEvents } from "@/utils/auditEvents";
import { mergeWorkspaceRows, summarizeWorkspaceReads, workspaceNotice } from "@/utils/auditWorkspaceMerge";
import { AZURE_CHECK_QUERY, buildAuditQuery, CHECK_QUERY } from "@/utils/auditWorkspaceKql";
import { azureActivityCoverage } from "@/utils/auditWorkspaceRows";
import { TABLE_NOT_FOUND } from "@/utils/auditWorkspaceStatus";
import { type ArmClient, createArmClient } from "@/utils/armClient";
import { RateLimiter } from "@/utils/rateLimiter";

/**
 * The demo answers the workspace reads (AU-9) in the tab: the ARM list and diagnostic settings, and the Log Analytics query.
 * The real service makes them through the demo `fetch`; no request may reach the network or go unanswered.
 */

const azure = buildContosoAzure(new Date());
const unhandledArm: ArmRequest[] = [];
const unhandledLaw: LogAnalyticsRequest[] = [];
const arm = createFakeArm(azure, { onUnhandled: (r) => unhandledArm.push(r) });
const law = createFakeLogAnalytics(() => new Date(), { onUnhandled: (r) => unhandledLaw.push(r) });
const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));
const client = createArmClient(() => Promise.resolve("demo-token"), { limiter: new RateLimiter(1000, 1000) });
const token = () => Promise.resolve("demo-token");
const [ENTRA, SEC, APPS, ACTIVITY] = DEMO_WORKSPACES;

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph")), arm: async () => arm, logAnalytics: async () => law, realFetch }));
});
afterAll(() => {
    vi.unstubAllGlobals();
    expect(realFetch).not.toHaveBeenCalled();
    expect(unhandledArm).toEqual([]);
    expect(unhandledLaw).toEqual([]);
});

describe("the workspace list against the fake ARM", () => {
    it("lists the workspaces of all subscriptions and names the subscription that failed", async () => {
        const listing = await listWorkspaces(client, CONTOSO_TENANT_ID);
        expect(listing.workspaces.map((w) => w.name).sort()).toEqual(DEMO_WORKSPACES.map((w) => w.name).sort());
        expect(listing.workspaces.find((w) => w.name === ENTRA.name)).toMatchObject({ customerId: ENTRA.customerId, retentionDays: 180 });
        expect(listing.failedSubscriptions).toHaveLength(1);
        expect(listing.failedSubscriptions[0]).toMatchObject({ name: "Contoso Corp Apps", reason: "403" });
    });

    it("marks the workspace that receives the Entra audit log", async () => {
        const ids = await listAuditLogWorkspaceIds(client);
        const listing = await listWorkspaces(client, CONTOSO_TENANT_ID);
        expect(listing.workspaces.filter((w) => ids.has(w.id.toLowerCase())).map((w) => w.name)).toEqual([ENTRA.name]);
    });

    it("marks the workspace that receives the Azure activity log from the subscriptions that send it, and leaves out the one that 403s", async () => {
        const listing = await listWorkspaces(client, CONTOSO_TENANT_ID);
        const ids = await listActivityLogWorkspaceIds(client, azure.subscriptions.map((s) => s.subscriptionId));
        expect(ids).not.toBeNull();
        expect(ids?.size).toBe(1);
        expect(listing.workspaces.filter((w) => ids?.has(w.id.toLowerCase())).map((w) => w.name)).toEqual([ACTIVITY.name]);
    });
});

/** Invented answers by query text, so a test can give each log its own answer */
function answeringQueries(answer: (query: string) => Response): typeof fetch {
    return vi.fn<typeof fetch>(async (_input, init) => answer(String((JSON.parse(String(init?.body)) as { query?: unknown }).query)));
}
const entraTable = (oldest: string, newest: string) => new Response(JSON.stringify({ tables: [{ name: "PrimaryResult", columns: [{ name: "Oldest" }, { name: "Newest" }], rows: [[oldest, newest]] }] }), { status: 200 });
const azureTable = () => new Response(JSON.stringify({ tables: [{ name: "PrimaryResult", columns: [{ name: "SubscriptionId" }, { name: "Oldest" }, { name: "Newest" }], rows: [["sub-invented-a", "2025-11-09T00:00:00Z", "2026-11-05T00:00:00Z"]] }] }), { status: 200 });
const refused = () => new Response(JSON.stringify({ error: { code: "InsufficientAccessError", message: "invented" } }), { status: 403 });
const noTableAnswer = () => new Response(JSON.stringify({ error: { code: "BadArgumentError", message: "invented", innererror: { code: "SemanticError", innererror: { code: "SEM0100", message: "invented" } } } }), { status: 400 });
const INVENTED_WS = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("the check of each log of a workspace, judged on its own (AU-18)", () => {
    it("judges both logs connected when both queries answer", async () => {
        const fetchImpl = answeringQueries((query) => (query === AZURE_CHECK_QUERY ? azureTable() : entraTable("2026-05-12T00:00:00Z", "2026-11-05T00:00:00Z")));
        const checks = await checkWorkspaceLogs(token, [INVENTED_WS], { fetchImpl });
        // The times come back as ISO times with milliseconds (the adapter's form)
        expect(checks.get(INVENTED_WS)).toEqual({
            entra: { kind: "connected", oldest: "2026-05-12T00:00:00.000Z", newest: "2026-11-05T00:00:00.000Z" },
            azure: { kind: "connected", oldest: "2025-11-09T00:00:00.000Z", newest: "2026-11-05T00:00:00.000Z" },
            subscriptionIds: ["sub-invented-a"],
        });
    });

    it("judges a refused Azure log as refused, and the Entra log stays connected", async () => {
        const fetchImpl = answeringQueries((query) => (query === AZURE_CHECK_QUERY ? refused() : entraTable("2026-05-12T00:00:00Z", "2026-11-05T00:00:00Z")));
        const checks = await checkWorkspaceLogs(token, [INVENTED_WS], { fetchImpl });
        expect(checks.get(INVENTED_WS)).toMatchObject({ entra: { kind: "connected" }, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] });
    });

    it("judges a workspace without an AzureActivity table as no Azure logs yet", async () => {
        const fetchImpl = answeringQueries((query) => (query === AZURE_CHECK_QUERY ? noTableAnswer() : entraTable("2026-05-12T00:00:00Z", "2026-11-05T00:00:00Z")));
        const checks = await checkWorkspaceLogs(token, [INVENTED_WS], { fetchImpl });
        expect(checks.get(INVENTED_WS)).toMatchObject({ azure: { kind: "noLogs" }, subscriptionIds: [] });
    });

    it("judges an Entra query that fails on its own, and the Azure query still counts", async () => {
        const fetchImpl = answeringQueries((query) => (query === CHECK_QUERY ? new Response("{}", { status: 400 }) : azureTable()));
        const checks = await checkWorkspaceLogs(token, [INVENTED_WS], { fetchImpl });
        expect(checks.get(INVENTED_WS)?.entra.kind).toBe("failed");
        expect(checks.get(INVENTED_WS)?.azure.kind).toBe("connected");
    });

    it("gives an abort to the caller, never a check", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(checkWorkspaceLogs(token, [INVENTED_WS], { signal: controller.signal })).rejects.toThrow();
    });

    it("keeps the refusal of one workspace out of the check of another", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async (input) => (String(input).includes(INVENTED_WS) ? refused() : entraTable("2026-05-12T00:00:00Z", "2026-11-05T00:00:00Z")));
        const checks = await checkWorkspaceLogs(token, [INVENTED_WS, ENTRA.customerId], { fetchImpl });
        expect(checks.get(INVENTED_WS)).toMatchObject({ entra: { kind: "noAccess", status: 403 }, azure: { kind: "noAccess", status: 403 } });
        expect(checks.get(ENTRA.customerId)?.entra.kind).toBe("connected");
    });
});

/** An ARM client that answers only the paths it is given, with no network: a list, or an error for a subscription */
function fakeArmClient(answers: Record<string, unknown[] | Error>): ArmClient {
    const unused = (): never => {
        throw new Error("not used by these tests");
    };
    return {
        get: unused,
        getAll: (path: string) => {
            const answer = answers[path];
            if (answer instanceof Error) return Promise.reject(answer);
            return Promise.resolve((answer ?? []) as never[]);
        },
        postAll: unused,
        postRead: unused,
    };
}

describe("the mark of the Azure activity log, from the diagnostic settings of each subscription (AU-18)", () => {
    const SUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const SUB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const SUB_C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const WS_MIXED = `/subscriptions/${SUB_A}/resourceGroups/RG-Logs/providers/Microsoft.OperationalInsights/workspaces/LAW-Invented`;
    const WS_OTHER = `/subscriptions/${SUB_C}/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/law-other`;
    const settingsOf = (subscription: string) => `/subscriptions/${subscription}/providers/Microsoft.Insights/diagnosticSettings`;
    const setting = (workspaceId: string, category: string, enabled: boolean) => ({ properties: { workspaceId, logs: [{ category, enabled }] } });

    it("counts an enabled Administrative setting, in lower case, and not one that is off or another category", async () => {
        const fake = fakeArmClient({
            [settingsOf(SUB_A)]: [setting(WS_MIXED, "Administrative", true)],
            [settingsOf(SUB_B)]: [setting(WS_MIXED, "Administrative", false)],
            [settingsOf(SUB_C)]: [setting(WS_OTHER, "Security", true)],
        });
        const ids = await listActivityLogWorkspaceIds(fake, [SUB_A, SUB_B, SUB_C]);
        expect([...(ids ?? [])]).toEqual([WS_MIXED.toLowerCase()]);
    });

    it("leaves out one subscription that fails and keeps the rest", async () => {
        const fake = fakeArmClient({
            [settingsOf(SUB_A)]: [setting(WS_MIXED, "Administrative", true)],
            [settingsOf(SUB_B)]: new Error("invented failure"),
        });
        const ids = await listActivityLogWorkspaceIds(fake, [SUB_A, SUB_B]);
        expect([...(ids ?? [])]).toEqual([WS_MIXED.toLowerCase()]);
    });

    it("gives no mark when every subscription fails, and when there is none to read", async () => {
        const failing = fakeArmClient({ [settingsOf(SUB_A)]: new Error("invented failure") });
        expect(await listActivityLogWorkspaceIds(failing, [SUB_A])).toBeNull();
        expect(await listActivityLogWorkspaceIds(fakeArmClient({}), [])).toBeNull();
    });
});

describe("the workspace reads against the fake Log Analytics", () => {
    it("reads the demo events through the adapter and the one mapper", async () => {
        const [result] = await readWorkspaces(token, [{ customerId: ENTRA.customerId, name: ENTRA.name }], 180);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.dropped).toBe(0);
        expect(result.oldestAuditEvent).toEqual(expect.any(String));
        const merged = mergeWorkspaceRows([result], CONTOSO_TENANT_ID);
        expect(mapAuditEvents(merged.rows).some((e) => e.kind === "usage")).toBe(true);
    });

    it("tells one workspace denied and one read, leaves the empty one out of the count, and the rest is shown", async () => {
        const refs = [ENTRA, SEC, APPS].map((w) => ({ customerId: w.customerId, name: w.name }));
        const reads = await readWorkspaces(token, refs, 90);
        // The empty one holds no Entra log at all: like a missing table it counts in neither read nor failed (AU-17, P18)
        expect(reads.map((r) => r.ok)).toEqual([true, false, false]);
        expect(reads[1]).toMatchObject({ noTable: true });
        const summary = summarizeWorkspaceReads(reads);
        expect(workspaceNotice(summary, false)?.title).toBe("1 of 2 workspaces could not be read");
        expect(workspaceNotice(summary, false)?.detail).toContain(`403 on ${APPS.name}`);
    });

    it("checks each log of each workspace: connected, no logs yet, no access", async () => {
        const checks = await checkWorkspaceLogs(token, DEMO_WORKSPACES.map((w) => w.customerId));
        expect(checks.get(ENTRA.customerId)).toMatchObject({ entra: { kind: "connected" }, azure: { kind: "noLogs" }, subscriptionIds: [] });
        expect(checks.get(SEC.customerId)).toEqual({ entra: { kind: "noLogs" }, azure: { kind: "noLogs" }, subscriptionIds: [] });
        expect(checks.get(APPS.customerId)).toEqual({ entra: { kind: "noAccess", status: 403 }, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] });
        // No AuditLogs table at all is the same as a table with no event
        expect(checks.get(ACTIVITY.customerId)).toMatchObject({ entra: { kind: "noLogs" }, azure: { kind: "connected" } });
        expect(checks.get(ACTIVITY.customerId)?.subscriptionIds).toHaveLength(DEMO_ACTIVITY_SUBSCRIPTIONS.length);
    });

    it("answers the check of the Azure activity log per subscription, and only the activity workspace holds it", async () => {
        const coverage = azureActivityCoverage(await queryWorkspace(token, ACTIVITY.customerId, AZURE_CHECK_QUERY));
        expect(coverage.subscriptionIds).toHaveLength(DEMO_ACTIVITY_SUBSCRIPTIONS.length);
        expect(coverage.oldest).toEqual(expect.any(String));
        await expect(queryWorkspace(token, ENTRA.customerId, AZURE_CHECK_QUERY)).rejects.toMatchObject({ code: TABLE_NOT_FOUND });
    });

    it("sends a typed or malformed id nowhere: it never reaches a URL", async () => {
        const fetchImpl = vi.fn<typeof fetch>();
        for (const bad of ["law-contoso", `${ENTRA.customerId}/../x`, `${ENTRA.customerId}?a=1`, "", "https://evil.example/"]) {
            await expect(queryWorkspace(token, bad, buildAuditQuery(7), { fetchImpl }), bad).rejects.toThrow("GUID");
        }
        expect(fetchImpl).not.toHaveBeenCalled();
        const reads = await readWorkspaces(token, [{ customerId: "not-a-guid", name: "x" }], 7);
        expect(reads[0].ok).toBe(false);
        expect(realFetch).not.toHaveBeenCalled();
    });

    it("counts a 200 with an error in its body as a failed workspace, never as complete", async () => {
        const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ tables: [{ name: "PrimaryResult", columns: [], rows: [] }], error: { code: "PartialError", message: "x" } }), { status: 200 }));
        await expect(queryWorkspace(token, ENTRA.customerId, buildAuditQuery(7), { fetchImpl })).rejects.toMatchObject({ code: "PartialError" });
    });

    it("runs at most 5 queries at a time", async () => {
        let running = 0;
        let peak = 0;
        const fetchImpl = vi.fn<typeof fetch>(async () => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 20));
            running--;
            return new Response(JSON.stringify({ tables: [{ name: "PrimaryResult", columns: [{ name: "Oldest" }, { name: "Newest" }], rows: [[null, null]] }] }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchImpl);
        const ids = Array.from({ length: 12 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
        await checkWorkspaceLogs(token, ids);
        expect(peak).toBeLessThanOrEqual(5);
        // Two queries per workspace: the Entra audit log and the Azure activity log
        expect(fetchImpl).toHaveBeenCalledTimes(24);
    });
});
