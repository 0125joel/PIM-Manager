import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildContosoAzure } from "@/demo/contoso/azure";
import { DEMO_ACTIVITY_SUBSCRIPTIONS, DEMO_WORKSPACES } from "@/demo/contoso/workspaces";
import { demoGuid } from "@/demo/contoso/ids";
import { createFakeLogAnalytics, type LogAnalyticsRequest } from "@/demo/loganalytics/server";
import { createDemoFetch } from "@/demo/runtime/fetch";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { toRawActivityEvent } from "@/utils/azureAuditEvents";
import { mergeAzureActivity, sendingSubscriptions } from "@/utils/azureWorkspaceActivity";

/**
 * The demo answers the Azure activity log of a workspace (AU-19): the rows are read through the real service and the adapter,
 * merged with the demo's native rows, so each event is shown once. No request may reach the network or go unanswered.
 */

const DAY = 86_400_000;
const NOW = new Date();
const azure = buildContosoAzure(NOW);
const unhandledLaw: LogAnalyticsRequest[] = [];
const law = createFakeLogAnalytics(() => NOW, { onUnhandled: (r) => unhandledLaw.push(r) });
const realFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("network")));
const token = () => Promise.resolve("demo-token");
const [ENTRA, , DENIED, ACTIVITY] = DEMO_WORKSPACES;

beforeAll(() => {
    vi.stubGlobal("fetch", createDemoFetch({ graph: () => Promise.reject(new Error("no Graph")), arm: () => Promise.reject(new Error("no ARM")), logAnalytics: async () => law, realFetch }));
});
afterAll(() => {
    vi.unstubAllGlobals();
    expect(realFetch).not.toHaveBeenCalled();
    expect(unhandledLaw).toEqual([]);
});

describe("the Azure activity log of a workspace, through the real service", () => {
    it("reads the rows of the workspace that holds them, with the two statuses the native read uses", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: ACTIVITY.customerId, name: ACTIVITY.name }], 180);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.rows.length).toBeGreaterThan(0);
        const statuses = new Set(read.rows.map((row) => row.status?.value));
        expect(statuses.has("Started")).toBe(true);
        expect(statuses.has("Start")).toBe(false);
        expect(read.rows.every((row) => (row.operationName?.value ?? "") === (row.operationName?.value ?? "").toUpperCase())).toBe(true);
        expect(read.rows.every((row) => row.eventDataId && row.eventTimestamp)).toBe(true);
    });

    it("holds rows older than 90 days, so a period of 180 days shows something the native log does not", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: ACTIVITY.customerId, name: ACTIVITY.name }], 180);
        if (!read.ok) throw new Error("the workspace should be read");
        const older = read.rows.filter((row) => Date.parse(row.eventTimestamp ?? "") < NOW.getTime() - 90 * DAY);
        expect(older.length).toBeGreaterThan(0);
    });

    it("tells which subscriptions send to it and how far back it reaches", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: ACTIVITY.customerId, name: ACTIVITY.name }], 30);
        if (!read.ok) throw new Error("the workspace should be read");
        const expected = DEMO_ACTIVITY_SUBSCRIPTIONS.map((key) => demoGuid(`azure:sub:${key}`).toLowerCase()).sort();
        expect([...(sendingSubscriptions([read]) ?? [])].sort()).toEqual(expected);
        expect(read.oldest).not.toBeNull();
    });

    it("shows each native event once: the copies of the last 90 days are the same actions, the older ones are only in the workspace", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: ACTIVITY.customerId, name: ACTIVITY.name }], 180);
        if (!read.ok) throw new Error("the workspace should be read");
        const sending = new Set(DEMO_ACTIVITY_SUBSCRIPTIONS.map((key) => demoGuid(`azure:sub:${key}`).toLowerCase()));
        const native = azure.audit.activity
            .filter((row) => sending.has(String(row.subscriptionId).toLowerCase()) && Date.parse(row.eventTimestamp) >= NOW.getTime() - 90 * DAY)
            .map((row) => toRawActivityEvent(row));
        const olderCount = read.rows.filter((row) => Date.parse(row.eventTimestamp ?? "") < NOW.getTime() - 90 * DAY).length;
        const merged = mergeAzureActivity(native, [read]);
        expect(merged.rows).toHaveLength(native.length + olderCount);
        expect(merged.duplicates).toBe(read.rows.length - olderCount);
        expect(merged.workspaceOf.size).toBe(olderCount);
    });

    it("names a workspace without the AzureActivity table as no table, not as a failure", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: ENTRA.customerId, name: ENTRA.name }], 30);
        expect(read).toMatchObject({ ok: false, noTable: true, reason: "no activity log yet" });
    });

    it("names a workspace that denies the query by its status", async () => {
        const [read] = await readAzureWorkspaces(token, [{ customerId: DENIED.customerId, name: DENIED.name }], 30);
        expect(read).toMatchObject({ ok: false, reason: "403" });
        expect(read).not.toHaveProperty("noTable", true);
    });

    it("keeps the other workspaces when one fails", async () => {
        const reads = await readAzureWorkspaces(token, [
            { customerId: DENIED.customerId, name: DENIED.name },
            { customerId: ACTIVITY.customerId, name: ACTIVITY.name },
        ], 30);
        expect(reads.map((read) => read.ok)).toEqual([false, true]);
    });

    it("refuses a day count outside the bounds before anything is sent", async () => {
        await expect(readAzureWorkspaces(token, [{ customerId: ACTIVITY.customerId, name: ACTIVITY.name }], 0)).rejects.toThrow();
    });
});
