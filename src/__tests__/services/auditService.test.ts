import { describe, expect, it } from "vitest";
import type { Client } from "@microsoft/microsoft-graph-client";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import { auditFilters, fetchAuditRows } from "@/services/auditService";

/**
 * The audit read against a stub Graph client: every call is recorded with the query the service set, and each answer is
 * chosen by the test. Only invented rows; nothing reaches a tenant.
 */

const START = "2026-11-01T00:00:00.000Z";
const PATH = "/auditLogs/directoryAudits";
const NEXT = "https://graph.microsoft.com/v1.0/auditLogs/directoryAudits?$skiptoken=page-2";

interface Call {
    path: string;
    version?: string;
    top?: number;
    select?: string;
    filter?: string;
}

interface Page {
    value?: RawDirectoryAudit[];
    "@odata.nextLink"?: string;
}

function row(id: string): RawDirectoryAudit {
    return { id } as unknown as RawDirectoryAudit;
}

function rows(prefix: string, count: number): RawDirectoryAudit[] {
    return Array.from({ length: count }, (_, i) => row(`${prefix}-${i}`));
}

/** A stub client: `respond` answers each call, and a thrown error is a failed request */
function stubClient(respond: (call: Call) => Page | Promise<Page>) {
    const calls: Call[] = [];
    const client = {
        api(path: string) {
            const call: Call = { path };
            calls.push(call);
            const builder = {
                version(value: string) {
                    call.version = value;
                    return builder;
                },
                top(value: number) {
                    call.top = value;
                    return builder;
                },
                select(value: string) {
                    call.select = value;
                    return builder;
                },
                filter(value: string) {
                    call.filter = value;
                    return builder;
                },
                get: () => Promise.resolve().then(() => respond(call)),
            };
            return builder;
        },
    };
    return { client: client as unknown as Client, calls };
}

const isPim = (call: Call) => call.filter?.startsWith("loggedByService eq 'PIM'") ?? false;

describe("auditFilters", () => {
    it("builds the PIM read, then the Core Directory role read, with the start unquoted and percent-encoded", () => {
        expect(auditFilters(START)).toEqual([
            "loggedByService eq 'PIM' and activityDateTime ge 2026-11-01T00%3A00%3A00.000Z",
            "loggedByService eq 'Core Directory' and category eq 'RoleManagement' and activityDateTime ge 2026-11-01T00%3A00%3A00.000Z",
        ]);
    });
});

describe("fetchAuditRows", () => {
    it("reads both filters in order on v1.0 with $top 1000 and the fixed $select, following nextLink", async () => {
        const { client, calls } = stubClient((call) => {
            if (call.path === NEXT) return { value: [row("pim-3")] };
            if (isPim(call)) return { value: [row("pim-1"), row("pim-2")], "@odata.nextLink": NEXT };
            return { value: [row("core-1")] };
        });
        const result = await fetchAuditRows(client, START);
        expect(result.map((r) => r.id)).toEqual(["pim-1", "pim-2", "pim-3", "core-1"]);
        expect(calls.map((c) => c.path)).toEqual([PATH, NEXT, PATH]);
        expect(calls[0].filter).toBe(auditFilters(START)[0]);
        expect(calls[2].filter).toBe(auditFilters(START)[1]);
        for (const call of [calls[0], calls[2]]) {
            expect(call.version).toBe("v1.0");
            expect(call.top).toBe(1000);
            expect(call.select?.split(",")).toEqual(
                ["id", "category", "correlationId", "result", "resultReason", "activityDisplayName", "activityDateTime", "loggedByService", "initiatedBy", "targetResources", "additionalDetails"],
            );
        }
    });

    it("waits 100 ms between pages", async () => {
        const { client } = stubClient((call) => (isPim(call) && call.path === PATH ? { value: [row("a")], "@odata.nextLink": NEXT } : { value: [] }));
        const started = Date.now();
        const rowsRead = await fetchAuditRows(client, START);
        expect(rowsRead.length).toBe(1);
        expect(Date.now() - started).toBeGreaterThanOrEqual(90);
    });

    it("reports the running count after each page", async () => {
        const counts: number[] = [];
        const { client } = stubClient((call) => {
            if (call.path === NEXT) return { value: [row("c")] };
            if (isPim(call)) return { value: [row("a"), row("b")], "@odata.nextLink": NEXT };
            return { value: [row("d")] };
        });
        await fetchAuditRows(client, START, { onProgress: (n) => counts.push(n) });
        expect(counts).toEqual([2, 3, 4]);
    });

    it("throws when the second read fails, and gives no partial list", async () => {
        const { client } = stubClient((call) => {
            if (isPim(call)) return { value: [row("a")] };
            throw { statusCode: 403, code: "Authorization_RequestDenied" };
        });
        await expect(fetchAuditRows(client, START)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("throws when a later page fails, and gives no partial list", async () => {
        const { client } = stubClient((call) => {
            if (call.path === NEXT) throw { statusCode: 403, code: "Authentication_RequestFromUnsupportedUserRole" };
            return { value: [row("a")], "@odata.nextLink": NEXT };
        });
        await expect(fetchAuditRows(client, START)).rejects.toMatchObject({ statusCode: 403 });
    });

    it("throws when an answer has no list of events", async () => {
        const { client } = stubClient(() => ({}));
        await expect(fetchAuditRows(client, START)).rejects.toThrow("without a list of events");
    });

    it("stops past the limit with AuditTooManyEventsError, after the page that crossed it", async () => {
        let pages = 0;
        const { client, calls } = stubClient(() => {
            pages++;
            return { value: rows(`p${pages}`, 1000), "@odata.nextLink": NEXT };
        });
        const error = await fetchAuditRows(client, START).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(AuditTooManyEventsError);
        expect((error as AuditTooManyEventsError).limit).toBe(AUDIT_ROW_LIMIT);
        // 51 pages of 1000 hold 51,000 rows: the first page past 50,000 ends the read, and no 52nd page is asked
        expect(calls.length).toBe(51);
    }, 20_000);

    it("honours an abort between pages and asks for no further page", async () => {
        const controller = new AbortController();
        const { client, calls } = stubClient((call) => {
            if (call.path === NEXT) return { value: [row("never")] };
            setTimeout(() => controller.abort(), 10);
            return { value: [row("a")], "@odata.nextLink": NEXT };
        });
        const error = await fetchAuditRows(client, START, { signal: controller.signal }).catch((e: unknown) => e);
        expect((error as { name?: string }).name).toBe("AbortError");
        expect(calls.map((c) => c.path)).toEqual([PATH]);
    });

    it("refuses a start that is not an ISO 8601 UTC time, before any call", async () => {
        const { client, calls } = stubClient(() => ({ value: [] }));
        await expect(fetchAuditRows(client, "yesterday")).rejects.toThrow("ISO 8601 UTC");
        expect(calls).toHaveLength(0);
    });
});
