import { describe, expect, it } from "vitest";
import { checkWorkspaceLogs, readWorkspaces } from "@/services/auditWorkspaceService";
import { readAzureWorkspaces } from "@/services/azureAuditWorkspaceService";
import { allWorkspacesFailed, summarizeWorkspaceReads, workspaceNotice } from "@/utils/auditWorkspaceMerge";
import { combineWorkspaceReads, workspaceLogFailures } from "@/utils/azureWorkspaceActivity";

/**
 * Log Analytics answers a query on a table the reader may not read with 200 and no data (measured 2026-11-25). Only the
 * permission block, asked for with `Prefer: include-permissions=true`, tells it from an empty table. `fetchImpl` replaces the
 * network; nothing reaches a tenant.
 */

const A = { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "law-a" };
const B = { customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "law-b" };
const token = async () => "token";
const OLDEST = "2026-08-01T00:00:00.000Z";
const NEWEST = "2026-11-01T00:00:00.000Z";

const table = (columns: string[], rows: unknown[][]) => ({ tables: [{ name: "PrimaryResult", columns: columns.map((name) => ({ name, type: "string" })), rows }] });
const tableOf = (query: string) => query.split("\n")[0];
const isCheck = (query: string) => query.includes("summarize");

/** A workspace that denies `denied`, limits `limited` to some rows, and holds no event in the rest, or one event per table with `full` */
function workspace(denied: string[], full = false, limited: string[] = []) {
    const seen: (string | null)[] = [];
    const answer = (query: string) => {
        const name = tableOf(query);
        const has = full && !denied.includes(name);
        const data = !isCheck(query) ? table([], [])
            : name === "AuditLogs" ? table(["Oldest", "Newest"], [has ? [OLDEST, NEWEST] : [null, null]])
            : table(["SubscriptionId", "Oldest", "Newest"], has ? [["s-1", OLDEST, NEWEST]] : []);
        // Measured 2026-11-26: a table with a row condition is in `conditionalTables`, not in `allowTables`
        const dataSource = denied.includes(name) ? { resourceId: "ws", allowTables: ["SigninLogs"], denyTables: denied }
            : limited.includes(name) ? { resourceId: "ws", allowTables: [], denyTables: ["SigninLogs"], conditionalTables: limited } : { resourceId: "ws", allowTables: [name] };
        return { ...data, permissions: { dataSources: [dataSource] } };
    };
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        seen.push(headers.get("Prefer"));
        const { query } = JSON.parse(String(init?.body)) as { query: string };
        return new Response(JSON.stringify(answer(query)), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    return { fetchImpl, seen };
}

/** A denies, B holds both logs */
function twoWorkspaces(denied: string[]) {
    const first = workspace(denied);
    const second = workspace([], true);
    return ((url: unknown, init?: RequestInit) => (String(url).includes(A.customerId) ? first : second).fetchImpl(url as string, init)) as typeof fetch;
}

describe("a table the reader may not read", () => {
    it("asks for the permissions with every query", async () => {
        const { fetchImpl, seen } = workspace([], true);
        await readWorkspaces(token, [A], 30, { fetchImpl });
        await readAzureWorkspaces(token, [A], 30, { fetchImpl });
        await checkWorkspaceLogs(token, [A.customerId], { fetchImpl });
        expect(seen).toHaveLength(6);
        expect(new Set(seen)).toEqual(new Set(["include-permissions=true"]));
    });

    it("is a failed read that the notice names, not a workspace without Entra logs", async () => {
        const reads = await readWorkspaces(token, [A, B], 30, { fetchImpl: twoWorkspaces(["AuditLogs"]) });
        expect(reads[0]).toEqual({ workspace: A, ok: false, reason: "no access to the table" });
        const summary = summarizeWorkspaceReads(reads);
        expect(summary).toMatchObject({ total: 2, read: 1, failed: [{ name: "law-a", reason: "no access to the table" }] });
        expect(JSON.stringify(workspaceNotice(summary, false))).toContain("law-a");
    });

    it("with one workspace falls back with that reason", async () => {
        const reads = await readWorkspaces(token, [A], 30, { fetchImpl: workspace(["AuditLogs"]).fetchImpl });
        const summary = summarizeWorkspaceReads(reads);
        expect(allWorkspacesFailed(summary)).toBe(true);
        expect(summary.failed).toEqual([{ name: "law-a", reason: "no access to the table" }]);
    });

    it("is a failed Azure read, named next to a readable Entra log", async () => {
        const fetchImpl = workspace(["AzureActivity"], true).fetchImpl;
        const azure = await readAzureWorkspaces(token, [A], 30, { fetchImpl });
        expect(azure).toEqual([{ workspace: A, ok: false, reason: "no access to the table" }]);
        const entra = await readWorkspaces(token, [A], 30, { fetchImpl });
        expect(entra[0].ok).toBe(true);
        expect(workspaceLogFailures(entra, azure)).toEqual([{ name: "law-a", log: "Azure activity log", reason: "no access to the table" }]);
        expect(summarizeWorkspaceReads(combineWorkspaceReads(entra, azure)).read).toBe(1);
    });

    it("is no access in the check of that log only", async () => {
        const checks = await checkWorkspaceLogs(token, [A.customerId], { fetchImpl: workspace(["AuditLogs"], true).fetchImpl });
        expect(checks.get(A.customerId)).toEqual({ entra: { kind: "noAccess", status: null }, azure: { kind: "connected", oldest: OLDEST, newest: NEWEST }, subscriptionIds: ["s-1"] });
    });

    it("an empty table stays a table without logs", async () => {
        const { fetchImpl } = workspace([]);
        expect(await readWorkspaces(token, [A], 30, { fetchImpl })).toEqual([{ workspace: A, ok: false, reason: "holds no Entra audit logs", noTable: true }]);
        expect((await checkWorkspaceLogs(token, [A.customerId], { fetchImpl })).get(A.customerId)).toMatchObject({ entra: { kind: "noLogs" }, azure: { kind: "noLogs" } });
    });

    it("a table with a row condition is read and named as only part, on both pages and in Settings", async () => {
        const entraOnly = workspace([], true, ["AuditLogs"]).fetchImpl;
        const entra = await readWorkspaces(token, [A], 30, { fetchImpl: entraOnly });
        expect(entra[0]).toMatchObject({ ok: true, limitedLogs: ["Entra audit log"] });
        const summary = summarizeWorkspaceReads(entra);
        expect(summary.limited).toEqual([{ name: "law-a", logs: ["Entra audit log"] }]);
        expect(JSON.stringify(workspaceNotice(summary, false))).toContain("only part of the Entra audit log of law-a");
        const azureOnly = workspace([], true, ["AzureActivity"]).fetchImpl;
        const azure = await readAzureWorkspaces(token, [A], 30, { fetchImpl: azureOnly });
        expect(azure[0]).toMatchObject({ ok: true, limitedLogs: ["Azure activity log"] });
        const combined = summarizeWorkspaceReads(combineWorkspaceReads(await readWorkspaces(token, [A], 30, { fetchImpl: azureOnly }), azure));
        expect(combined.limited).toEqual([{ name: "law-a", logs: ["Azure activity log"] }]);
        const checks = await checkWorkspaceLogs(token, [A.customerId], { fetchImpl: entraOnly });
        expect(checks.get(A.customerId)?.entra).toMatchObject({ kind: "connected", isLimited: true });
        expect(checks.get(A.customerId)?.azure).not.toHaveProperty("isLimited");
    });

    it("a table with a row condition and no row you may see is no access, not a table without logs", async () => {
        const fetchImpl = workspace([], false, ["AuditLogs"]).fetchImpl;
        expect(await readWorkspaces(token, [A], 30, { fetchImpl })).toEqual([{ workspace: A, ok: false, reason: "no access to the rows" }]);
        expect((await checkWorkspaceLogs(token, [A.customerId], { fetchImpl })).get(A.customerId)?.entra).toEqual({ kind: "noAccess", status: null });
    });

    it("without the permission block nothing is called limited", async () => {
        const reads = await readWorkspaces(token, [A], 30, { fetchImpl: workspace([], true).fetchImpl });
        expect(reads[0]).not.toHaveProperty("limitedLogs");
        expect(summarizeWorkspaceReads(reads).limited ?? []).toEqual([]);
    });
});
