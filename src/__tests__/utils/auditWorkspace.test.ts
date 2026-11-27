import { describe, expect, it, vi } from "vitest";
import { buildDemoAuditRows } from "@/demo/contoso/audit";
import { mapAuditEvents } from "@/utils/auditEvents";
import { buildCoverageLine, workspaceSourceLabel } from "@/utils/auditView";
import { listWorkspaces } from "@/services/auditWorkspaceService";
import type { ArmClient } from "@/utils/armClient";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import { buildAuditQuery, CHECK_QUERY, isWorkspaceId, normalizeWorkspaceId, WORKSPACE_COLUMNS } from "@/utils/auditWorkspaceKql";
import { checkTimes, primaryTable, workspaceTableToRows, type WorkspaceRow, type WorkspaceTable } from "@/utils/auditWorkspaceRows";
import { addGraphRows, graphAddedSentence, graphFailureSentence, mergeWorkspaceRows, summarizeWorkspaceReads, WORKSPACE_GAP_NOTE, workspaceCoverageNotes, workspaceNotRead, workspaceMissingText, workspaceNotice, workspacePeriodMax, workspaceReach, type WorkspaceRead } from "@/utils/auditWorkspaceMerge";
import { answerError, checkFromError, checkFromTimes, failureReason, isTableDenied, isTableLimited, LogAnalyticsError, logAnalyticsErrorCode, TABLE_ACCESS_DENIED, TABLE_NOT_FOUND } from "@/utils/auditWorkspaceStatus";
import { clearWorkspaceChoices, readWorkspaceChoice, writeWorkspaceChoice } from "@/utils/auditWorkspaceChoice";
import { checkedLine, workspaceLogLines, workspaceSummaryText, type OtherWorkspace, type SubscriptionFact } from "@/utils/auditWorkspaceView";
import type { WorkspaceLogsCheck } from "@/utils/auditWorkspaceStatus";

// Invented data only.
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WS_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function table(rows: unknown[][], columns: readonly string[] = WORKSPACE_COLUMNS): WorkspaceTable {
    return { name: "PrimaryResult", columns: columns.map((name) => ({ name })), rows };
}

function row(id: string, overrides: Record<string, unknown> = {}): unknown[] {
    const base: Record<string, unknown> = {
        Id: id, ActivityDateTime: "2026-11-01T10:00:00.1234567Z", Category: "RoleManagement", CorrelationId: `c-${id}`, Result: "success", ResultReason: "",
        ActivityDisplayName: "Add member to role completed (PIM activation)", LoggedByService: "PIM",
        InitiatedBy: JSON.stringify({ user: { id: "u1", displayName: "Megan Bowen" } }),
        TargetResources: JSON.stringify([{ type: "Role", id: "r1", displayName: "Global Administrator", modifiedProperties: [] }]),
        AdditionalDetails: JSON.stringify([{ key: "AuditType", value: "RoleManagement" }]), AADTenantId: TENANT,
        ...overrides,
    };
    return WORKSPACE_COLUMNS.map((name) => base[name]);
}

const wsRow = (id: string, tenantId = TENANT): WorkspaceRow => ({ tenantId, raw: { id, category: "", correlationId: "", result: "success", activityDisplayName: "x", activityDateTime: "2026-11-01T10:00:00.000Z", loggedByService: "PIM", initiatedBy: {}, targetResources: [], additionalDetails: [] } });
const read = (customerId: string, name: string, rows: WorkspaceRow[], extra: Partial<Extract<WorkspaceRead, { ok: true }>> = {}): WorkspaceRead => ({ workspace: { customerId, name }, ok: true, rows, dropped: 0, ...extra });
const failed = (customerId: string, name: string, reason: string): WorkspaceRead => ({ workspace: { customerId, name }, ok: false, reason });

describe("the workspace query", () => {
    it("is fixed text around a whole number of days, with an explicit column list and a stop one past the limit", () => {
        const query = buildAuditQuery(90);
        expect(query).toContain("TimeGenerated >= ago(90d)");
        expect(query).toContain("LoggedByService == 'PIM' or (LoggedByService == 'Core Directory' and Category == 'RoleManagement')");
        expect(query).toContain(`| project ${WORKSPACE_COLUMNS.join(", ")}`);
        expect(query).toContain(`| take ${AUDIT_ROW_LIMIT + 1}`);
        expect(WORKSPACE_COLUMNS.join(",")).toBe("Id,ActivityDateTime,Category,CorrelationId,Result,ResultReason,ActivityDisplayName,LoggedByService,InitiatedBy,TargetResources,AdditionalDetails,AADTenantId");
    });

    it("refuses anything but a whole number of days", () => {
        for (const bad of [0, -1, 1.5, Number.NaN, 731, "7); drop" as unknown as number]) expect(() => buildAuditQuery(bad), String(bad)).toThrow();
    });

    it("the check asks for the oldest and the newest event", () => {
        expect(CHECK_QUERY).toContain("min(TimeGenerated)");
        expect(CHECK_QUERY).toContain("max(TimeGenerated)");
    });

    it("lets only a GUID through as a workspace id, whatever was typed or pasted", () => {
        expect(normalizeWorkspaceId(`  ${WS_A.toUpperCase()}  `)).toBe(WS_A);
        for (const bad of ["", "law-contoso", `${WS_A}/../x`, `${WS_A}?a=1`, `/subscriptions/${WS_A}`, `${WS_A}'`, "https://evil.example/", `${WS_A}\n${WS_B}`]) {
            expect(normalizeWorkspaceId(bad), bad).toBeNull();
            expect(isWorkspaceId(bad), bad).toBe(false);
        }
    });
});

describe("the adapter", () => {
    it("reads JSON strings and objects in the dynamic columns, whatever the casing of their keys", () => {
        const strings = workspaceTableToRows(table([row("e1")]));
        const objects = workspaceTableToRows(table([row("e1", {
            InitiatedBy: { User: { Id: "u1", DisplayName: "Megan Bowen" } },
            TargetResources: [{ Type: "Role", Id: "r1", DisplayName: "Global Administrator", ModifiedProperties: [] }],
            AdditionalDetails: [{ Key: "AuditType", Value: "RoleManagement" }],
        })]));
        expect(strings.dropped).toBe(0);
        expect(objects.rows[0].raw).toEqual(strings.rows[0].raw);
        expect(strings.rows[0].raw.initiatedBy.user?.displayName).toBe("Megan Bowen");
        expect(strings.rows[0].raw.additionalDetails).toEqual([{ key: "AuditType", value: "RoleManagement" }]);
        expect(strings.rows[0].raw.activityDateTime).toBe("2026-11-01T10:00:00.123Z");
        expect(strings.rows[0].tenantId).toBe(TENANT);
    });

    it("drops and counts a row that cannot be read, and never throws", () => {
        const result = workspaceTableToRows(table([row("ok"), row("", {}), row("bad-time", { ActivityDateTime: "yesterday" }), row("no-activity", { ActivityDisplayName: null }), row("junk", { InitiatedBy: "{not json", TargetResources: 5 })]));
        expect(result.rows.map((r) => r.raw.id)).toEqual(["ok", "junk"]);
        expect(result.dropped).toBe(3);
        expect(result.rows[1].raw.initiatedBy).toEqual({});
        expect(result.rows[1].raw.targetResources).toEqual([]);
    });

    it("drops every row when a required column is missing, and counts them", () => {
        const result = workspaceTableToRows(table([["e1", "2026-11-01T10:00:00Z"]], ["Id", "ActivityDateTime"]));
        expect(result.rows).toEqual([]);
        expect(result.dropped).toBe(1);
    });

    it("finds the primary table, and the times of the check", () => {
        expect(primaryTable({ tables: [] })).toBeNull();
        expect(primaryTable("x")).toBeNull();
        const found = primaryTable({ tables: [{ name: "Other", columns: [], rows: [] }, { name: "PrimaryResult", columns: [{ name: "Oldest" }, { name: "Newest" }], rows: [["2026-05-12T00:00:00Z", "2026-11-05T00:00:00Z"]] }] });
        expect(found && checkTimes(found)).toEqual({ oldest: "2026-05-12T00:00:00.000Z", newest: "2026-11-05T00:00:00.000Z" });
        expect(checkFromTimes({ oldest: null, newest: null })).toEqual({ kind: "noLogs" });
        expect(checkTimes(table([[null, null]], ["Oldest", "Newest"]))).toEqual({ oldest: null, newest: null });
    });

    it("sees a partial result as an error, never as a complete answer", () => {
        expect(answerError({ tables: [], error: { code: "PartialError", message: "x" } })).toEqual({ code: "PartialError", message: "x" });
        expect(answerError({ tables: [], error: {} })?.code).toBe("PartialError");
        expect(answerError({ tables: [] })).toBeNull();
    });
});

describe("the merge", () => {
    it("keeps an event once, from the first workspace, and counts the duplicates", () => {
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", [wsRow("e1"), wsRow("e2")]), read(WS_B, "law-b", [wsRow("e2"), wsRow("e3")])], TENANT);
        expect(merged.rows.map((r) => r.id)).toEqual(["e1", "e2", "e3"]);
        expect(merged.workspaceOf.get("e2")).toBe("law-a");
        expect(merged.workspaceOf.get("e3")).toBe("law-b");
        expect(merged.duplicates).toBe(1);
    });

    it("keeps only the rows of the signed-in tenant, and drops a row that names none", () => {
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", [wsRow("e1"), wsRow("e2", OTHER), wsRow("e3", "")])], TENANT.toUpperCase());
        expect(merged.rows.map((r) => r.id)).toEqual(["e1"]);
        expect(merged.otherTenant).toBe(2);
    });

    it("leaves a failed workspace out and keeps the rest", () => {
        const merged = mergeWorkspaceRows([failed(WS_A, "law-a", "403"), read(WS_B, "law-b", [wsRow("e1")])], TENANT);
        expect(merged.rows).toHaveLength(1);
    });

    it("stops at the limit with the too-many error, also when one workspace filled its query", () => {
        const many = Array.from({ length: 6 }, (_, i) => wsRow(`e${i}`));
        expect(() => mergeWorkspaceRows([read(WS_A, "a", many)], TENANT, 5)).toThrow(AuditTooManyEventsError);
        expect(mergeWorkspaceRows([read(WS_A, "a", many.slice(0, 5))], TENANT, 5).rows).toHaveLength(5);
        expect(() => mergeWorkspaceRows([read(WS_A, "a", many.slice(0, 3)), read(WS_B, "b", many.slice(3).concat(wsRow("x1"), wsRow("x2")))], TENANT, 5)).toThrow(AuditTooManyEventsError);
    });

    it("counts the rows it could not understand, so a full answer with one dropped row is still too many", () => {
        const many = Array.from({ length: 5 }, (_, i) => wsRow(`e${i}`));
        expect(() => mergeWorkspaceRows([read(WS_A, "a", many, { dropped: 1 })], TENANT, 5)).toThrow(AuditTooManyEventsError);
        expect(mergeWorkspaceRows([read(WS_A, "a", many.slice(0, 4), { dropped: 1 })], TENANT, 5).rows).toHaveLength(4);
    });

    it("says what is missing, once, for the banner and for an export", () => {
        const reads = [read(WS_A, "law-a", []), read(WS_B, "law-b", []), failed("c", "law-apps", "403")];
        const summary = summarizeWorkspaceReads(reads);
        expect(summary).toMatchObject({ total: 3, read: 2 });
        expect(workspaceNotice(summary, false)).toEqual({
            title: "1 of 3 workspaces could not be read",
            detail: "(403 on law-apps). Events stored only there are missing from this list and from an export.",
        });
        const all = summarizeWorkspaceReads([failed("a", "law-a", "403"), failed("b", "law-b", "403")]);
        expect(workspaceMissingText(all, true)).toBe("The workspaces could not be read (403 on all 2 workspaces). Showing 30 days from the Entra audit log instead.");
        expect(workspaceNotice(summarizeWorkspaceReads([read(WS_A, "a", [])]), false)).toBeNull();
        expect(workspaceNotice({ total: 1, read: 1, failed: [], dropped: 2, otherTenant: 0 }, false)?.title).toBe("2 rows could not be understood");
    });

    it("the period maximum is the longest retention, 730 when one is unknown, 30 without a workspace", () => {
        expect(workspacePeriodMax([])).toBe(30);
        expect(workspacePeriodMax([90, 180, 30])).toBe(180);
        expect(workspacePeriodMax([90, undefined])).toBe(730);
        expect(workspacePeriodMax([5000])).toBe(730);
    });

    it("the reach is the earliest event of the tables read, else of the rows read", () => {
        expect(workspaceReach([read(WS_A, "a", [wsRow("e1")], { oldestAuditEvent: "2026-01-03T00:00:00.000Z" }), read(WS_B, "b", [], { oldestAuditEvent: "2026-05-12T00:00:00.000Z" }), failed("c", "c", "403")])).toBe("2026-01-03T00:00:00.000Z");
        expect(workspaceReach([read(WS_A, "a", [wsRow("e1")])])).toBe("2026-11-01T10:00:00.000Z");
        expect(workspaceReach([failed("c", "c", "403")])).toBeNull();
    });
});

describe("the status of a workspace", () => {
    it("tells 401 and 403 as no access, and any other failure by status and code, never as no logs", () => {
        expect(checkFromError(new LogAnalyticsError(403, "InsufficientAccessError", "x"))).toEqual({ kind: "noAccess", status: 403 });
        expect(checkFromError(new LogAnalyticsError(400, "BadArgumentError", "x"))).toEqual({ kind: "failed", detail: "HTTP 400 BadArgumentError" });
        expect(checkFromError(new Error("offline"))).toEqual({ kind: "failed", detail: "no answer" });
    });

    it("tells a denied table as no access, without a status that never came", () => {
        const denied = new LogAnalyticsError(200, TABLE_ACCESS_DENIED, "x");
        expect(checkFromError(denied)).toEqual({ kind: "noAccess", status: null });
        expect(failureReason(denied)).toBe("no access to the table");
        const connected = { kind: "connected" as const, oldest: "2026-05-12T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const noAccess = { kind: "noAccess" as const, status: null };
        const lines = (check: WorkspaceLogsCheck) => workspaceLogLines(check, [], { subscriptions: null }, { timeZone: "UTC", locale: "en-GB" });
        expect(lines({ entra: noAccess, azure: connected, subscriptionIds: [] })[0]).toEqual({ tone: "error", text: "You cannot read its Entra audit logs, so events stored only there are missing. You need read access to the workspace and its AuditLogs table, such as Log Analytics Reader." });
        expect(lines({ entra: noAccess, azure: noAccess, subscriptionIds: [] })).toEqual([{ tone: "error", text: "You cannot read its logs, so events stored only there are missing. You need read access to the workspace and its tables, such as Log Analytics Reader." }]);
    });

    it("reads a table with a row condition from the permission block, and words it in Settings", () => {
        const body = (permissions: unknown) => ({ tables: [], permissions });
        expect(isTableLimited(body({ dataSources: [{ resourceId: "ws", allowTables: [], conditionalTables: ["auditlogs"] }] }), "AuditLogs")).toBe(true);
        expect(isTableLimited(body({ dataSources: [{ resourceId: "ws", allowTables: ["AuditLogs"] }] }), "AuditLogs")).toBe(false);
        for (const odd of [undefined, null, {}, { dataSources: [{ conditionalTables: "AuditLogs" }] }]) expect(isTableLimited(body(odd), "AuditLogs")).toBe(false);
        const limited = { kind: "connected" as const, oldest: "2026-05-12T00:00:00Z", newest: "2026-11-05T00:00:00Z", isLimited: true as const };
        expect(workspaceLogLines({ entra: limited, azure: { kind: "noLogs" }, subscriptionIds: [] }, [], { subscriptions: null }, { timeZone: "UTC", locale: "en-GB" })[0]).toEqual({
            tone: "warn", text: "Entra audit logs from 12 May 2026 to 5 Nov 2026. Your access shows only part of its AuditLogs table, so events can be missing.",
        });
    });

    it("reads a denied table from the permission block of an answer, whatever the capitals", () => {
        const body = (permissions: unknown) => ({ tables: [], permissions });
        expect(isTableDenied(body({ dataSources: [{ resourceId: "ws", allowTables: ["SigninLogs"], denyTables: ["AzureActivity", "auditlogs"] }] }), "AuditLogs")).toBe(true);
        expect(isTableDenied(body({ dataSources: [{ resourceId: "ws", denyTables: ["AzureActivity"] }] }), "AuditLogs")).toBe(false);
        // Measured: with full access the block has allowTables only, also when the table holds no event
        expect(isTableDenied(body({ dataSources: [{ resourceId: "ws", allowTables: ["AuditLogs"] }] }), "AuditLogs")).toBe(false);
        for (const odd of [undefined, null, "x", {}, { dataSources: "x" }, { dataSources: [null, 1, { denyTables: "AuditLogs" }, { denyTables: [null, 3] }] }]) {
            expect(isTableDenied(body(odd), "AuditLogs"), JSON.stringify(odd)).toBe(false);
        }
        expect(isTableDenied(null, "AuditLogs")).toBe(false);
    });

    it("words the status of each log of a workspace as the approved wording does (AU-18)", () => {
        const format = { timeZone: "UTC", locale: "en-GB" };
        const connected = { kind: "connected" as const, oldest: "2026-05-12T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const azureConnected = { kind: "connected" as const, oldest: "2025-11-09T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const three: SubscriptionFact[] = [{ id: "sub-a", name: "Contoso Production" }, { id: "sub-b", name: "Contoso Test" }, { id: "sub-c", name: "Contoso Labs" }];
        const lines = (check: WorkspaceLogsCheck, others: OtherWorkspace[] = [], subscriptions: SubscriptionFact[] | null = three) =>
            workspaceLogLines(check, others, { subscriptions }, format);
        const entraOnly: WorkspaceLogsCheck = { entra: connected, azure: { kind: "noLogs" }, subscriptionIds: [] };
        // Entra connected
        expect(lines(entraOnly)[0]).toEqual({ tone: "ok", text: "Entra audit logs from 12 May 2026 to 5 Nov 2026." });
        // Azure connected from all subscriptions, and with the count unknown
        // The Azure line only: the Entra line of a workspace without Entra logs is tested below
        const azureLine = (check: WorkspaceLogsCheck, subscriptions: SubscriptionFact[] | null = three) =>
            lines(check, [], subscriptions).find((l) => l.text.startsWith("Azure activity logs"));
        const all: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: azureConnected, subscriptionIds: ["sub-a", "sub-b", "sub-c"] };
        expect(azureLine(all)).toEqual({ tone: "ok", text: "Azure activity logs from 9 Nov 2025 to 5 Nov 2026, from all 3 subscriptions you can read." });
        expect(azureLine(all, null)).toEqual({ tone: "ok", text: "Azure activity logs from 9 Nov 2025 to 5 Nov 2026." });
        // Azure connected from 2 of 3: one other, named
        const two: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: azureConnected, subscriptionIds: ["sub-a", "sub-b"] };
        expect(azureLine(two)).toEqual({ tone: "warn", text: "Azure activity logs from 9 Nov 2025 to 5 Nov 2026, from 2 of the 3 subscriptions you can read. Contoso Labs sends nothing here, so its history stops at 90 days." });
        // Azure connected from 1 of 4: three others, at most two named
        const four = [...three, { id: "sub-d", name: "Contoso Sandbox" }];
        const one: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: azureConnected, subscriptionIds: ["sub-a"] };
        expect(azureLine(one, four)?.text).toBe("Azure activity logs from 9 Nov 2025 to 5 Nov 2026, from 1 of the 4 subscriptions you can read. The other 3 send nothing here, such as Contoso Test and Contoso Labs, so their history stops at 90 days.");
        // Entra has no logs and another chosen workspace holds them
        const noEntra: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: { kind: "noLogs" }, subscriptionIds: [] };
        expect(lines(noEntra, [{ name: "law-contoso-entra", logs: entraOnly }]).find((l) => l.text.startsWith("Holds no Entra"))).toEqual({ tone: "quiet", text: "Holds no Entra audit logs. That is fine: law-contoso-entra does." });
        // Azure has no logs, and another chosen workspace was refused for it
        const denied: WorkspaceLogsCheck = { entra: connected, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] };
        expect(lines(entraOnly, [{ name: "law-contoso-activity", logs: denied }])).toEqual([
            { tone: "ok", text: "Entra audit logs from 12 May 2026 to 5 Nov 2026." },
            { tone: "quiet", text: "Holds no Azure activity logs." },
        ]);
        // No Azure logs anywhere, and no Entra logs anywhere
        expect(lines(entraOnly)[1]).toEqual({ tone: "warn", text: "Holds no Azure activity logs, so Azure stays at 90 days. Someone with access must send them with a diagnostic setting on each subscription. The first logs can take up to 90 minutes, and older logs are not added." });
        expect(lines(noEntra, [], null)).toEqual([
            { tone: "warn", text: "Holds no Entra audit logs, so Entra stays at 30 days. Someone with access must send AuditLogs to it with a diagnostic setting in Entra; the first logs can take up to 3 days, and older logs are not added." },
            { tone: "warn", text: "Holds no Azure activity logs, so Azure stays at 90 days. Someone with access must send them with a diagnostic setting on each subscription. The first logs can take up to 90 minutes, and older logs are not added." },
        ]);
    });

    it("tells a refusal and a failure of one log by that log, and both the same way when they are the same", () => {
        const format = { timeZone: "UTC", locale: "en-GB" };
        const azureConnected = { kind: "connected" as const, oldest: "2025-11-09T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const refusedEntra: WorkspaceLogsCheck = { entra: { kind: "noAccess", status: 403 }, azure: azureConnected, subscriptionIds: ["sub-a"] };
        expect(workspaceLogLines(refusedEntra, [], { subscriptions: null }, format)).toEqual([
            { tone: "error", text: "You cannot read its Entra audit logs (403), so events stored only there are missing. You need read access to the workspace and its AuditLogs table, such as Log Analytics Reader." },
            { tone: "ok", text: "Azure activity logs from 9 Nov 2025 to 5 Nov 2026." },
        ]);
        const failedAzure: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: { kind: "failed", detail: "HTTP 400 BadArgumentError" }, subscriptionIds: [] };
        expect(workspaceLogLines(failedAzure, [], { subscriptions: null }, format)).toEqual([
            { tone: "error", text: "Its Azure activity logs could not be checked (HTTP 400 BadArgumentError), so events stored only there are missing. Check the workspace ID and your access, then check again." },
        ]);
        const refusedBoth: WorkspaceLogsCheck = { entra: { kind: "noAccess", status: 403 }, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] };
        expect(workspaceLogLines(refusedBoth, [], { subscriptions: null }, format)).toEqual([
            { tone: "error", text: "You cannot read its logs (403), so events stored only there are missing. You need read access to the workspace, such as Log Analytics Reader." },
        ]);
        const refusedDifferent: WorkspaceLogsCheck = { entra: { kind: "noAccess", status: 403 }, azure: { kind: "noAccess", status: 401 }, subscriptionIds: [] };
        expect(workspaceLogLines(refusedDifferent, [], { subscriptions: null }, format)).toHaveLength(2);
        const failedBoth: WorkspaceLogsCheck = { entra: { kind: "failed", detail: "no answer" }, azure: { kind: "failed", detail: "no answer" }, subscriptionIds: [] };
        expect(workspaceLogLines(failedBoth, [], { subscriptions: null }, format)).toEqual([
            { tone: "error", text: "It could not be checked (no answer), so events stored only there are missing. Check the workspace ID and your access, then check again." },
        ]);
        // A refused log beside a log with no event: only the problem shows
        const refusedAndEmpty: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] };
        expect(workspaceLogLines(refusedAndEmpty, [], { subscriptions: null }, format).map((l) => l.tone)).toEqual(["error"]);
    });

    it("words the summary: how many are read, how far back, and for how many subscriptions (AU-18)", () => {
        const format = { timeZone: "UTC", locale: "en-GB" };
        const entra = { kind: "connected" as const, oldest: "2026-05-12T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const azure = { kind: "connected" as const, oldest: "2025-11-09T00:00:00Z", newest: "2026-11-05T00:00:00Z" };
        const both: WorkspaceLogsCheck = { entra, azure: { kind: "noLogs" }, subscriptionIds: [] };
        const activity: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure, subscriptionIds: ["sub-a", "sub-b"] };
        const denied: WorkspaceLogsCheck = { entra: { kind: "noAccess", status: 403 }, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] };
        const three = ["sub-a", "sub-b", "sub-c"];
        expect(workspaceSummaryText([both, { entra: { kind: "noLogs" }, azure, subscriptionIds: three }], three, format)).toEqual({ text: "Audit reads 2 workspaces", detail: "Entra reaches back to 12 May 2026, Azure to 9 Nov 2025." });
        expect(workspaceSummaryText([both, activity], three, format)).toEqual({ text: "Audit reads 2 workspaces", detail: "Entra reaches back to 12 May 2026, Azure to 9 Nov 2025 for 2 subscriptions." });
        expect(workspaceSummaryText([both, activity], null, format).detail).toBe("Entra reaches back to 12 May 2026, Azure to 9 Nov 2025.");
        expect(workspaceSummaryText([both], three, format)).toEqual({ text: "Audit reads 1 workspace", detail: "Entra reaches back to 12 May 2026. Azure stays at 90 days." });
        expect(workspaceSummaryText([activity], three, format)).toEqual({ text: "Audit reads 1 workspace", detail: "Azure reaches back to 9 Nov 2025 for 2 subscriptions. Entra stays at 30 days." });
        expect(workspaceSummaryText([activity], ["sub-a", "sub-b"], format).detail).toBe("Azure reaches back to 9 Nov 2025. Entra stays at 30 days.");
        expect(workspaceSummaryText([both, denied], three, format)).toEqual({ text: "Audit reads 1 of 2 workspaces", detail: "Entra reaches back to 12 May 2026. Azure stays at 90 days." });
        expect(workspaceSummaryText([denied], three, format)).toEqual({ text: "Audit reads 0 of 1 workspace", detail: "Audit shows the 30 days of the Entra audit log and the 90 days of the Azure activity log until a workspace can be read." });
    });

    it("adds the sentence about what a workspace shows to the checked line", () => {
        expect(checkedLine("2026-11-05T11:00:00Z", { timeZone: "UTC", locale: "en-GB" })).toBe("Checked 5 Nov 2026, 11:00 UTC. Access is your own: a colleague may see this differently. A workspace shows what it holds, also on scopes your Azure roles do not reach.");
    });
});

describe("what a workspace holds and what it does not", () => {
    const connected = { kind: "connected", oldest: "2026-01-01T00:00:00Z", newest: "2026-11-01T00:00:00Z" } as const;
    const azureOnly: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: connected, subscriptionIds: [] };
    const empty: WorkspaceLogsCheck = { entra: { kind: "noLogs" }, azure: { kind: "noLogs" }, subscriptionIds: [] };

    it("shows what it holds first", () => {
        const others = [{ name: "law-entra", logs: { entra: connected, azure: { kind: "noLogs" as const }, subscriptionIds: [] } }];
        expect(workspaceLogLines(azureOnly, others, { subscriptions: null }).map((line) => line.tone)).toEqual(["ok", "quiet"]);
    });

    it("tells the warning about a log no workspace holds once, on the first workspace listed", () => {
        const first = workspaceLogLines(empty, [{ name: "law-b", logs: empty, isListedBefore: false }], { subscriptions: null });
        const second = workspaceLogLines(empty, [{ name: "law-a", logs: empty, isListedBefore: true }], { subscriptions: null });
        expect(first.map((line) => line.tone)).toEqual(["warn", "warn"]);
        expect(second.map((line) => line.tone)).toEqual(["quiet", "quiet"]);
        expect(second[0].text).toBe("Holds no Entra audit logs, as the workspace listed above.");
    });

    it("does not count a workspace that can be read and holds nothing as one that could not be read", () => {
        expect(workspaceSummaryText([azureOnly, empty], null).text).toBe("Audit reads 1 workspace");
        expect(workspaceSummaryText([azureOnly, { ...empty, azure: { kind: "noAccess", status: 403 } }], null).text).toBe("Audit reads 1 of 2 workspaces");
        expect(workspaceSummaryText([empty, empty], null).text).toBe("Audit reads 0 of 2 workspaces");
    });
});

describe("subscriptions spread over chosen workspaces", () => {
    const subs: SubscriptionFact[] = [{ id: "a", name: "Sub A" }, { id: "b", name: "Sub B" }, { id: "c", name: "Sub C" }];
    const connected = { kind: "connected", oldest: "2026-01-01T00:00:00Z", newest: "2026-11-01T00:00:00Z" } as const;
    const holding = (subscriptionIds: string[]): WorkspaceLogsCheck => ({ entra: { kind: "noLogs" }, azure: connected, subscriptionIds });
    const azureLine = (own: string[], other: string[]) =>
        workspaceLogLines(holding(own), [{ name: "law-other", logs: holding(other) }], { subscriptions: subs }).find((line) => line.text.startsWith("Azure"));

    it("does not say the history stops when another chosen workspace receives the rest", () => {
        const line = azureLine(["a"], ["b", "c"]);
        expect(line?.tone).toBe("ok");
        expect(line?.text).toContain("from 1 of the 3 subscriptions you can read. The other 2 send to another chosen workspace.");
        expect(line?.text).not.toContain("90 days");
    });

    it("names only the subscription that sends to no chosen workspace", () => {
        const line = azureLine(["a"], ["b"]);
        expect(line?.tone).toBe("warn");
        expect(line?.text).toContain("1 of the others sends to no chosen workspace, such as Sub C, so its history stops at 90 days.");
        expect(line?.text).not.toContain("Sub B");
    });

    it("keeps the sentence of the board when no other workspace receives any", () => {
        expect(azureLine(["a"], [])?.text).toContain("The other 2 send nothing here, such as Sub B and Sub C, so their history stops at 90 days.");
    });
});

describe("the sentences of several workspaces (AU-17)", () => {
    const format = { timeZone: "UTC", locale: "en-GB" };
    const connected = { kind: "connected", oldest: "2026-01-01T00:00:00Z", newest: "2026-11-01T00:00:00Z" } as const;
    const holding = (subscriptionIds: string[]): WorkspaceLogsCheck => ({ entra: { kind: "noLogs" }, azure: connected, subscriptionIds });
    const azureOf = (lines: { tone: string; text: string }[]) => lines.find((line) => line.text.startsWith("Azure"));

    it("names two subscriptions with the same name by the first 8 characters of their id", () => {
        const subs: SubscriptionFact[] = [{ id: "aaaaaaaa-1111-4111-8111-111111111111", name: "Contoso" }, { id: "bbbbbbbb-2222-4222-8222-222222222222", name: "Contoso" }];
        const line = azureOf(workspaceLogLines(holding(["aaaaaaaa-1111-4111-8111-111111111111"]), [], { subscriptions: subs }, format));
        expect(line).toEqual({ tone: "warn", text: "Azure activity logs from 1 Jan 2026 to 1 Nov 2026, from 1 of the 2 subscriptions you can read. Contoso (bbbbbbbb) sends nothing here, so its history stops at 90 days." });
    });

    it("tells the sentence about a subscription that sends nowhere once: under the first workspace listed", () => {
        const subs: SubscriptionFact[] = [{ id: "a", name: "Sub A" }, { id: "b", name: "Sub B" }];
        const first = azureOf(workspaceLogLines(holding(["a"]), [{ name: "law-2", logs: holding(["a"]), isListedBefore: false }], { subscriptions: subs }, format));
        expect(first).toEqual({ tone: "warn", text: "Azure activity logs from 1 Jan 2026 to 1 Nov 2026, from 1 of the 2 subscriptions you can read. Sub B sends nothing here, so its history stops at 90 days." });
        const second = azureOf(workspaceLogLines(holding(["a"]), [{ name: "law-1", logs: holding(["a"]), isListedBefore: true }], { subscriptions: subs }, format));
        expect(second).toEqual({ tone: "ok", text: "Azure activity logs from 1 Jan 2026 to 1 Nov 2026, from 1 of the 2 subscriptions you can read." });
    });

    it("labels the Entra source by the workspaces whose AuditLogs was read, not by the one with no such table (AU-17)", () => {
        const noTable: WorkspaceRead = { workspace: { customerId: WS_B, name: "law-b" }, ok: false, reason: "no audit logs yet", noTable: true };
        const summary = summarizeWorkspaceReads([read(WS_A, "law-a", []), noTable]);
        expect(workspaceSourceLabel(summary.read, summary.total)).toBe("1 workspace");
    });
});

describe("the choice", () => {
    function memory() {
        const data = new Map<string, string>();
        return {
            data,
            storage: {
                getItem: (key: string) => data.get(key) ?? null,
                setItem: (key: string, value: string) => void data.set(key, value),
                removeItem: (key: string) => void data.delete(key),
                key: (index: number) => [...data.keys()][index] ?? null,
                get length() { return data.size; },
            },
        };
    }

    it("is kept per tenant, as ids only", () => {
        const { storage, data } = memory();
        expect(writeWorkspaceChoice(TENANT, [WS_A, WS_B.toUpperCase()], storage)).toBe(true);
        expect(readWorkspaceChoice(TENANT, storage)).toEqual([WS_A, WS_B]);
        expect(readWorkspaceChoice(OTHER, storage)).toEqual([]);
        expect([...data.values()]).toEqual([JSON.stringify([WS_A, WS_B])]);
    });

    it("drops anything that is not a GUID, and duplicates, and survives a corrupt value", () => {
        const { storage, data } = memory();
        writeWorkspaceChoice(TENANT, [WS_A, WS_A, "law-a", `${WS_B}/x`], storage);
        expect(readWorkspaceChoice(TENANT, storage)).toEqual([WS_A]);
        for (const bad of ["{", "null", "\"x\"", "{\"a\":1}", "[1,2]"]) {
            data.set([...data.keys()][0], bad);
            expect(readWorkspaceChoice(TENANT, storage), bad).toEqual([]);
        }
    });

    it("an empty choice removes the key, and a sign-out clears every tenant", () => {
        const { storage, data } = memory();
        writeWorkspaceChoice(TENANT, [WS_A], storage);
        writeWorkspaceChoice(OTHER, [WS_B], storage);
        data.set("unrelated", "1");
        expect(clearWorkspaceChoices(storage)).toBe(2);
        expect([...data.keys()]).toEqual(["unrelated"]);
        writeWorkspaceChoice(TENANT, [WS_A], storage);
        writeWorkspaceChoice(TENANT, [], storage);
        expect(readWorkspaceChoice(TENANT, storage)).toEqual([]);
    });

    it("never throws when storage is missing or blocked", () => {
        const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); }, key: () => { throw new Error("blocked"); }, length: 1 };
        expect(readWorkspaceChoice(TENANT, blocked)).toEqual([]);
        expect(writeWorkspaceChoice(TENANT, [WS_A], blocked)).toBe(false);
        expect(clearWorkspaceChoices(blocked)).toBe(0);
        expect(writeWorkspaceChoice(TENANT, [WS_A], null)).toBe(false);
        expect(readWorkspaceChoice(undefined, null)).toEqual([]);
    });
});

// Shapes measured on a real workspace, 2026-11-05; ids invented
describe("what a real workspace answers", () => {
    it("takes the tenant from AADTenantId: TenantId holds the workspace, and would drop every row", () => {
        const columns = ["TenantId", ...WORKSPACE_COLUMNS];
        const values = ["workspace-guid", ...row("r1")];
        const { rows } = workspaceTableToRows(table([values], columns));
        expect(rows[0].tenantId).toBe(TENANT.toLowerCase());
        expect(buildAuditQuery(30)).toContain("AADTenantId");
        expect(buildAuditQuery(30)).not.toContain("| project Id, TimeGenerated");
    });

    it("uses when it happened, not when the record was made", () => {
        const { rows } = workspaceTableToRows(table([row("r1", { ActivityDateTime: "2026-11-01T10:00:00.1234567Z" })]));
        expect(rows[0].raw.activityDateTime).toBe("2026-11-01T10:00:00.123Z");
    });

    it("tells a missing table as no audit logs yet, a denial as no access, the rest by status and code", () => {
        const missing = { error: { message: "The request had some invalid properties", code: "BadArgumentError", innererror: { code: "SemanticError", innererror: { code: "SEM0100", message: "Failed to resolve table" } } } };
        expect(logAnalyticsErrorCode(missing)).toBe(TABLE_NOT_FOUND);
        expect(checkFromError(new LogAnalyticsError(400, TABLE_NOT_FOUND, "x"))).toEqual({ kind: "noLogs" });
        expect(failureReason(new LogAnalyticsError(400, TABLE_NOT_FOUND, "x"))).toBe("no audit logs yet");
        expect(checkFromError(new LogAnalyticsError(403, "InsufficientAccessError", "x"))).toEqual({ kind: "noAccess", status: 403 });
        expect(logAnalyticsErrorCode({ error: { code: "BadArgumentError", innererror: { code: "SyntaxError" } } })).toBe("BadArgumentError");
        expect(checkFromError(new LogAnalyticsError(400, "BadArgumentError", "x"))).toEqual({ kind: "failed", detail: "HTTP 400 BadArgumentError" });
    });

    it("says when rows of another tenant were left out, also when nothing else is wrong", () => {
        const summary = summarizeWorkspaceReads([], 3);
        expect(workspaceNotice({ ...summary, total: 1, read: 1 }, false)?.detail).toContain("3 rows belong to another tenant");
        expect(workspaceNotice({ ...summary, total: 1, read: 1, otherTenant: 0 }, false)).toBeNull();
    });

    it("finds the workspace of a subscription that fails on its own list through Resource Graph", async () => {
        const WS = "9be44c96-0000-4000-8000-000000000001";
        const client = {
            getAll: vi.fn(async (path: string) => {
                if (path === "/subscriptions") return [{ subscriptionId: "s-bad", displayName: "Broken", state: "Enabled" }, { subscriptionId: "s-empty", displayName: "Silent", state: "Enabled" }];
                throw Object.assign(new Error("not found"), { statusCode: 404, code: "SubscriptionNotFound" });
            }),
            postRead: vi.fn(async () => ({ data: [{ id: "/subscriptions/s-bad/x", name: "law-one", location: "westeurope", subscriptionId: "s-bad", customerId: WS, retention: 90 }] })),
        } as unknown as ArmClient;
        const listing = await listWorkspaces(client, undefined);
        expect(listing.workspaces).toEqual([expect.objectContaining({ customerId: WS, name: "law-one", subscriptionName: "Broken", retentionDays: 90 })]);
        // An empty answer does not prove a subscription holds none: it stays named
        expect(listing.failedSubscriptions.map((f) => f.name)).toEqual(["Silent"]);
    });
});

describe("the workspaces together with the Entra audit log", () => {
    const graph = (id: string) => wsRow(id).raw;

    it("keeps one row per id, counts the rows only Graph had, and lets a workspace row win", () => {
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", [wsRow("e1"), wsRow("e2")])], TENANT);
        const combined = addGraphRows(merged, [graph("e2"), graph("e3"), graph("e3"), graph("e4")]);
        expect(combined.rows.map((r) => r.id)).toEqual(["e1", "e2", "e3", "e4"]);
        expect(combined.graphOnly).toBe(2);
        expect(combined.workspaceOf.has("e3")).toBe(false);
        expect(combined.workspaceOf.get("e2")).toBe("law-a");
    });

    it("only in a workspace stays a workspace row, and nothing from Graph adds nothing", () => {
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", [wsRow("e1")])], TENANT);
        expect(addGraphRows(merged, []).graphOnly).toBe(0);
        expect(addGraphRows(merged, []).rows).toHaveLength(1);
    });

    it("stops at the limit with the too-many error", () => {
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", [wsRow("e1"), wsRow("e2")])], TENANT, 3);
        expect(() => addGraphRows(merged, [graph("g1"), graph("g2")], 3)).toThrow(AuditTooManyEventsError);
        expect(addGraphRows(merged, [graph("g1")], 3).rows).toHaveLength(3);
    });

    it("an action spread over rows of both sources becomes one event, as when all rows come from one", () => {
        const rows = buildDemoAuditRows(new Date("2026-11-05T12:00:00Z"));
        const whole = mapAuditEvents(addGraphRows(mergeWorkspaceRows([], TENANT), rows).rows);
        const fromWorkspace = rows.filter((_, index) => index % 2 === 0).map((raw) => ({ raw, tenantId: TENANT }));
        const merged = mergeWorkspaceRows([read(WS_A, "law-a", fromWorkspace)], TENANT);
        const combined = addGraphRows(merged, rows.filter((_, index) => index % 2 === 1));
        const split = mapAuditEvents(combined.rows);
        const facts = (list: typeof whole) => list.map((e) => [e.id, e.sentence, e.kind, e.result].join("|")).sort();
        expect(facts(split)).toEqual(facts(whole));
        expect(combined.graphOnly).toBe(new Set(rows.filter((_, index) => index % 2 === 1).map((r) => r.id)).size);
    });

    it("words the notes of the coverage line and the Not read line of every export", () => {
        const summary = summarizeWorkspaceReads([read(WS_A, "law-a", [])], 0, { graphOnly: 3, failure: null });
        expect(WORKSPACE_GAP_NOTE).toBe("A workspace holds what the diagnostic export delivered and can miss events.");
        expect(graphAddedSentence(3)).toBe("3 rows were only in the Entra audit log and were added.");
        expect(graphAddedSentence(1)).toBe("1 row was only in the Entra audit log and was added.");
        expect(workspaceCoverageNotes(summary)).toEqual([WORKSPACE_GAP_NOTE, "3 rows were only in the Entra audit log and were added."]);
        expect(workspaceNotRead(summary, false)).toBe(`${WORKSPACE_GAP_NOTE} 3 rows were only in the Entra audit log and were added.`);
        expect(workspaceCoverageNotes(summarizeWorkspaceReads([read(WS_A, "a", [])]))).toEqual([WORKSPACE_GAP_NOTE]);
        const line = buildCoverageLine({ windowStart: "2026-05-11T00:00:00Z", readAt: "2026-11-05T12:00:00Z", days: 180, now: new Date("2026-11-05T12:00:00Z"), timeZone: "UTC", locale: "en-GB", sourceLabel: "1 workspace", notes: workspaceCoverageNotes(summary) });
        expect(line).toContain("Source: 1 workspace. Oldest event available: 11 May 2026. Read");
        expect(line.endsWith(`New events can take a few minutes to appear. ${WORKSPACE_GAP_NOTE} 3 rows were only in the Entra audit log and were added.`)).toBe(true);
    });

    it("tells in the banner and in Not read that the last 30 days could not be checked, with each reason", () => {
        for (const reason of ["no permission", "no reader role", "500 generalException"]) {
            const summary = summarizeWorkspaceReads([read(WS_A, "law-a", [])], 0, { graphOnly: 0, failure: reason });
            const sentence = `The last 30 days could not be checked against the Entra audit log (${reason}), so events the workspace missed are not shown.`;
            expect(graphFailureSentence(reason)).toBe(sentence);
            const notice = workspaceNotice(summary, false);
            expect(`${notice?.title} ${notice?.detail}`).toBe(sentence);
            expect(workspaceNotRead(summary, false)).toBe(`${sentence} ${WORKSPACE_GAP_NOTE}`);
        }
        const both = summarizeWorkspaceReads([read(WS_A, "a", []), failed(WS_B, "b", "403")], 0, { graphOnly: 0, failure: "no permission" });
        expect(workspaceNotice(both, false)?.title).toBe("1 of 2 workspaces could not be read");
        expect(workspaceNotice(both, false)?.detail).toContain("The last 30 days could not be checked");
    });

    it("after a fall-back to Graph the export says what is missing and no workspace note", () => {
        const all = summarizeWorkspaceReads([failed(WS_A, "a", "403")]);
        expect(workspaceNotRead(all, true)).toBe("The workspace could not be read (403 on a). Showing 30 days from the Entra audit log instead.");
    });
});
