import { describe, expect, it } from "vitest";
import type { RawActivityEvent } from "@/types/audit.types";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import type { WorkspaceRef } from "@/utils/auditWorkspaceMerge";
import type { WorkspaceTable } from "@/utils/auditWorkspaceRows";
import {
    AZURE_ACTIVITY_COLUMNS,
    AZURE_WORKSPACE_MAX_DAYS,
    azureActivityTableToRows,
    azureWorkspaceReach,
    buildAzureActivityQuery,
    combineWorkspaceReads,
    mergeAzureActivity,
    normalizeStatusWord,
    sendingSubscriptions,
    type AzureWorkspaceRead,
} from "@/utils/azureWorkspaceActivity";

const WS_A: WorkspaceRef = { customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "law-a" };
const WS_B: WorkspaceRef = { customerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "law-b" };
const CORR = "c0ffee00-0000-4000-8000-000000000001";
const OP = "Microsoft.Authorization/roleAssignments/write";
const AT = "2026-10-01T10:00:00.000Z";

/** An Activity Log row as the native read gives it (only the fields the merge reads) */
function native(id: string, status: string, time = AT, correlation = CORR, operation = OP): RawActivityEvent {
    return { eventDataId: id, correlationId: correlation, eventTimestamp: time, operationName: { value: operation }, status: { value: status } };
}

/** A row as the workspace gives it, after the adapter: capitals and `Start` and `Success`, a different event id */
function workspaceRow(id: string, status: string, time = AT, correlation = CORR, operation = OP.toUpperCase()): RawActivityEvent {
    return { eventDataId: id, correlationId: correlation, eventTimestamp: time, operationName: { value: operation }, status: { value: normalizeStatusWord(status) } };
}

function read(workspace: WorkspaceRef, rows: RawActivityEvent[]): AzureWorkspaceRead {
    return { workspace, ok: true, rows, dropped: 0, subscriptionIds: null, oldest: null };
}

describe("the query of the workspace's Activity Log", () => {
    it("is built from fixed text and a whole number of days, with the explicit column list", () => {
        const query = buildAzureActivityQuery(180);
        expect(query).toBe([
            "AzureActivity",
            "| where TimeGenerated >= ago(180d)",
            "| where OperationNameValue startswith 'MICROSOFT.AUTHORIZATION/'",
            "| project EventDataId, CorrelationId, TimeGenerated, Caller, ResourceId = coalesce(ResourceId, _ResourceId), SubscriptionId, OperationNameValue, ActivityStatusValue, AppId = tostring(Claims_d.appid), RequestBody = tostring(Properties_d.requestbody), ResponseBody = tostring(Properties_d.responseBody), StatusMessage = tostring(Properties_d.statusMessage)",
            `| take ${AUDIT_ROW_LIMIT + 1}`,
        ].join("\n"));
    });

    it("never reads the caller's address, the request, the authorization or the rest of the claims and properties", () => {
        const query = buildAzureActivityQuery(30);
        for (const forbidden of ["CallerIpAddress", "HTTPRequest", "Authorization", "Properties_d)", "Claims_d)", "Properties_d,", "Claims_d,"]) {
            expect(query).not.toContain(forbidden);
        }
        expect(query).toContain("Properties_d.requestbody");
        expect(query).toContain("Claims_d.appid");
    });

    it("refuses anything that is not a whole number of days from 1 to the maximum", () => {
        for (const days of [0, -1, 1.5, Number.NaN, AZURE_WORKSPACE_MAX_DAYS + 1]) {
            expect(() => buildAzureActivityQuery(days)).toThrow();
        }
        expect(buildAzureActivityQuery(1)).toContain("ago(1d)");
        expect(buildAzureActivityQuery(AZURE_WORKSPACE_MAX_DAYS)).toContain(`ago(${AZURE_WORKSPACE_MAX_DAYS}d)`);
    });
});

describe("the adapter from a workspace answer", () => {
    const columns = AZURE_ACTIVITY_COLUMNS.map((name) => ({ name }));
    const full = ["ev-1", CORR, AT, "admin@contoso.example", "/subscriptions/s-1/providers/Microsoft.Authorization/roleAssignments/x", "s-1", OP.toUpperCase(), "Start", "app-1", "{\"a\":1}", "", "stat"];

    it("reads the named columns and turns the status words into the words of the native read", () => {
        const table: WorkspaceTable = { columns, rows: [full] };
        const { rows, dropped } = azureActivityTableToRows(table);
        expect(dropped).toBe(0);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            eventDataId: "ev-1",
            correlationId: CORR,
            eventTimestamp: AT,
            caller: "admin@contoso.example",
            operationName: { value: OP.toUpperCase() },
            status: { value: "Started" },
            claims: { appid: "app-1" },
            properties: { requestbody: "{\"a\":1}", responseBody: undefined, statusMessage: "stat" },
        });
    });

    it("drops and counts a row without an event id, a valid time or an operation", () => {
        const table: WorkspaceTable = {
            columns,
            rows: [
                ["", CORR, AT, "", "", "", OP, "Success", "", "", "", ""],
                ["ev-2", CORR, "not a time", "", "", "", OP, "Success", "", "", "", ""],
                ["ev-3", CORR, AT, "", "", "", "", "Success", "", "", "", ""],
                ["ev-4", CORR, AT, "", "", "", OP, "Success", "", "", "", ""],
            ],
        };
        const { rows, dropped } = azureActivityTableToRows(table);
        expect(dropped).toBe(3);
        expect(rows.map((row) => row.eventDataId)).toEqual(["ev-4"]);
    });

    it("leaves a column it does not have out, and makes an empty text nothing", () => {
        const table: WorkspaceTable = { columns: [{ name: "EventDataId" }, { name: "TimeGenerated" }, { name: "OperationNameValue" }], rows: [["ev-1", AT, OP]] };
        const { rows } = azureActivityTableToRows(table);
        expect(rows[0].status).toBeUndefined();
        expect(rows[0].correlationId).toBe("");
        expect(rows[0].claims?.appid).toBeUndefined();
    });

    it("keeps the status words it does not know as they are, and maps the four it does", () => {
        expect(normalizeStatusWord("start")).toBe("Started");
        expect(normalizeStatusWord("Success")).toBe("Succeeded");
        expect(normalizeStatusWord("FAILURE")).toBe("Failed");
        expect(normalizeStatusWord("accept")).toBe("Accepted");
        expect(normalizeStatusWord("Canceled")).toBe("Canceled");
    });
});

describe("the merge with the native read", () => {
    it("keeps two rows when the native read and the workspace hold two each", () => {
        const restRows = [native("n-1", "Started"), native("n-2", "Started")];
        const merged = mergeAzureActivity(restRows, [read(WS_A, [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start")])]);
        expect(merged.rows).toHaveLength(2);
        expect(merged.duplicates).toBe(2);
        expect(merged.rows.map((row) => row.eventDataId)).toEqual(["n-1", "n-2"]);
        expect(merged.workspaceOf.size).toBe(0);
    });

    it("keeps two rows when only the workspace holds them", () => {
        const merged = mergeAzureActivity([], [read(WS_A, [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start")])]);
        expect(merged.rows).toHaveLength(2);
        expect(merged.workspaceOf.get("w-1")).toBe("law-a");
        expect(merged.workspaceOf.get("w-2")).toBe("law-a");
    });

    it("keeps two rows when two workspaces hold the same two", () => {
        const merged = mergeAzureActivity([], [
            read(WS_A, [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start")]),
            read(WS_B, [workspaceRow("v-1", "Start"), workspaceRow("v-2", "Start")]),
        ]);
        expect(merged.rows).toHaveLength(2);
        expect(merged.duplicates).toBe(2);
        expect([...merged.workspaceOf.values()]).toEqual(["law-a", "law-a"]);
    });

    it("keeps two rows when the native read holds one and the workspace two", () => {
        const merged = mergeAzureActivity([native("n-1", "Started")], [read(WS_A, [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start")])]);
        expect(merged.rows).toHaveLength(2);
        expect(merged.rows[0].eventDataId).toBe("n-1");
        expect(merged.workspaceOf.get("w-2")).toBe("law-a");
        expect(merged.workspaceOf.has("w-1")).toBe(false);
    });

    it("matches operation, status, correlation id and time within a second without case, not the event id", () => {
        const merged = mergeAzureActivity([native("n-1", "Succeeded", "2026-10-01T10:00:00.000Z")], [read(WS_A, [workspaceRow("w-9", "Success", "2026-10-01T10:00:00.900Z", CORR.toUpperCase(), OP.toUpperCase())])]);
        expect(merged.rows).toHaveLength(1);
        expect(merged.duplicates).toBe(1);
    });

    it("merges one action that the two logs put on either side of a second boundary (measured up to 62.5 ms apart, AU-17)", () => {
        const merged = mergeAzureActivity([native("n-1", "Succeeded", "2026-10-01T10:00:00.990Z")], [read(WS_A, [workspaceRow("w-1", "Success", "2026-10-01T10:00:01.030Z")])]);
        expect(merged.rows).toHaveLength(1);
        expect(merged.duplicates).toBe(1);
    });

    it("does not merge the same action a second or more apart", () => {
        const merged = mergeAzureActivity([native("n-1", "Succeeded", "2026-10-01T10:00:00.000Z")], [read(WS_A, [workspaceRow("w-1", "Success", "2026-10-01T10:00:01.000Z")])]);
        expect(merged.rows).toHaveLength(2);
    });

    it("throws past the limit, and when one workspace alone passes it", () => {
        expect(() => mergeAzureActivity([], [], 0)).not.toThrow();
        expect(() => mergeAzureActivity([native("n-1", "Started"), native("n-2", "Started")], [], 1)).toThrow(AuditTooManyEventsError);
        const big = [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start"), workspaceRow("w-3", "Start")];
        expect(() => mergeAzureActivity([], [read(WS_A, big)], 2)).toThrow(AuditTooManyEventsError);
    });

    it("counts the rows it could not understand, so a full answer with one dropped row is still too many", () => {
        const two = [workspaceRow("w-1", "Start"), workspaceRow("w-2", "Start")];
        expect(() => mergeAzureActivity([], [{ ...read(WS_A, two), dropped: 1 } as AzureWorkspaceRead], 2)).toThrow(AuditTooManyEventsError);
        expect(mergeAzureActivity([], [{ ...read(WS_A, two.slice(0, 1)), dropped: 1 } as AzureWorkspaceRead], 2).rows).toHaveLength(1);
    });

    it("skips a workspace that did not read and keeps the others", () => {
        const failed: AzureWorkspaceRead = { workspace: WS_B, ok: false, reason: "403" };
        const merged = mergeAzureActivity([], [failed, read(WS_A, [workspaceRow("w-1", "Start")])]);
        expect(merged.rows).toHaveLength(1);
    });
});

describe("how the reads of both logs combine per workspace", () => {
    const bad = (workspace: WorkspaceRef, reason: string, noTable = false): AzureWorkspaceRead => ({ workspace, ok: false, reason, ...(noTable ? { noTable: true } : {}) });
    const entraOk = (workspace: WorkspaceRef) => ({ workspace, ok: true, dropped: 0 });
    const entraBad = (workspace: WorkspaceRef, reason: string, noTable = false) => ({ workspace, ok: false, reason, ...(noTable ? { noTable: true } : {}) });

    it("a workspace counts as read when either log was read", () => {
        const [first] = combineWorkspaceReads([entraBad(WS_A, "no audit logs yet", true)], [read(WS_A, [])]);
        expect(first.ok).toBe(true);
    });

    it("a workspace with only one of the logs is not a failure, and its missing table is not told", () => {
        const combined = combineWorkspaceReads([entraBad(WS_A, "no audit logs yet", true)], [bad(WS_A, "no activity log yet", true)]);
        expect(combined[0]).toMatchObject({ ok: false, noTable: true });
    });

    it("fails with the reason of the log that is not simply missing", () => {
        const combined = combineWorkspaceReads([entraBad(WS_A, "403")], [bad(WS_A, "no activity log yet", true)]);
        expect(combined[0]).toMatchObject({ ok: false, reason: "403", noTable: false });
        const other = combineWorkspaceReads([entraBad(WS_A, "no audit logs yet", true)], [bad(WS_A, "401")]);
        expect(other[0]).toMatchObject({ ok: false, reason: "401", noTable: false });
    });

    it("counts the dropped rows of the logs that were read", () => {
        const combined = combineWorkspaceReads([entraOk(WS_A)], [{ workspace: WS_A, ok: true, dropped: 2 }]);
        expect(combined[0]).toMatchObject({ ok: true, dropped: 2 });
    });
});

describe("the subscriptions that send, and the reach", () => {
    it("is unknown when no workspace could say, and the union of the answers otherwise", () => {
        expect(sendingSubscriptions([{ workspace: WS_A, ok: false, reason: "403" }])).toBeNull();
        const known: AzureWorkspaceRead[] = [
            { workspace: WS_A, ok: true, rows: [], dropped: 0, subscriptionIds: ["S-1", "s-2"], oldest: null },
            { workspace: WS_B, ok: true, rows: [], dropped: 0, subscriptionIds: null, oldest: null },
        ];
        expect([...(sendingSubscriptions(known) ?? [])].sort()).toEqual(["s-1", "s-2"]);
    });

    it("reaches as far back as the check of a workspace says, else the oldest row read", () => {
        expect(azureWorkspaceReach([{ workspace: WS_A, ok: true, rows: [], dropped: 0, subscriptionIds: null, oldest: "2026-01-02T00:00:00.000Z" }])).toBe("2026-01-02T00:00:00.000Z");
        const rows = [workspaceRow("w-1", "Start", "2026-03-01T00:00:00.000Z"), workspaceRow("w-2", "Start", "2026-02-01T00:00:00.000Z")];
        expect(azureWorkspaceReach([read(WS_A, rows)])).toBe("2026-02-01T00:00:00.000Z");
        expect(azureWorkspaceReach([])).toBeNull();
    });
});
