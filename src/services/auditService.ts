import type { Client } from "@microsoft/microsoft-graph-client";
import type { RawDirectoryAudit } from "@/types/audit.types";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import { getErrorCode, getErrorStatusCode } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { withRetry } from "@/utils/retryUtils";

export { AuditTooManyEventsError } from "@/utils/auditErrors";

const AUDIT_PATH = "/auditLogs/directoryAudits";
/** The most one page holds: 1001 is a 400 (measured) */
const PAGE_SIZE = 1000;
const PAGE_DELAY_MS = 100;
const SELECT = "id,category,correlationId,result,resultReason,activityDisplayName,activityDateTime,loggedByService,initiatedBy,targetResources,additionalDetails";
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface AuditReadOptions {
    signal?: AbortSignal;
    /** The running count of rows read so far, across both reads */
    onProgress?: (loaded: number) => void;
}

interface AuditPage {
    value?: RawDirectoryAudit[];
    "@odata.nextLink"?: string;
}

/**
 * The two filters of the audit read (implementation spec section 1), in the order they are read. The start is an
 * unquoted ISO 8601 value; it is percent-encoded so the colons cannot be taken for anything else.
 */
export function auditFilters(startIso: string): string[] {
    const since = encodeURIComponent(startIso);
    return [
        `loggedByService eq 'PIM' and activityDateTime ge ${since}`,
        `loggedByService eq 'Core Directory' and category eq 'RoleManagement' and activityDateTime ge ${since}`,
    ];
}

function abortError(): DOMException {
    return new DOMException("The audit read was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw abortError();
}

/** Reads one page, retrying only 429 and 5xx (withRetry). A failure is logged by its status and code only. */
async function readPage(request: () => Promise<AuditPage>, name: string): Promise<AuditPage> {
    try {
        return await withRetry(request, 3, 1000, name);
    } catch (error: unknown) {
        Logger.warn("auditService", `${name} failed (status ${getErrorStatusCode(error) ?? "none"}, code ${getErrorCode(error) ?? "none"})`);
        throw error;
    }
}

/** Follows the nextLink of one filter, one page after the other, 100 ms apart. Appends to `rows`; never returns a part. */
async function readFilter(client: Client, filter: string, rows: RawDirectoryAudit[], options: AuditReadOptions): Promise<void> {
    throwIfAborted(options.signal);
    let page = await readPage(
        () => client.api(AUDIT_PATH).version("v1.0").top(PAGE_SIZE).select(SELECT).filter(filter).get(),
        "audit read",
    );
    for (;;) {
        if (!Array.isArray(page.value)) throw new Error("The audit read answered without a list of events.");
        for (const row of page.value) rows.push(row);
        options.onProgress?.(rows.length);
        if (rows.length > AUDIT_ROW_LIMIT) {
            Logger.warn("auditService", `The audit read stopped: more than ${AUDIT_ROW_LIMIT} events in this period.`);
            throw new AuditTooManyEventsError(AUDIT_ROW_LIMIT);
        }
        const next = page["@odata.nextLink"];
        if (!next) return;
        await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
        throwIfAborted(options.signal);
        const link = next;
        page = await readPage(() => client.api(link).get(), "audit next page");
    }
}

/**
 * Reads the audit events of the period since `startIso`: the PIM rows, then the Core Directory role changes, one read
 * after the other. Throws on any failed read (no partial list), on more than AUDIT_ROW_LIMIT rows, and on an abort.
 */
export async function fetchAuditRows(client: Client, startIso: string, options: AuditReadOptions = {}): Promise<RawDirectoryAudit[]> {
    if (!ISO_UTC.test(startIso)) throw new Error("fetchAuditRows: the start must be an ISO 8601 UTC time.");
    const rows: RawDirectoryAudit[] = [];
    for (const filter of auditFilters(startIso)) {
        await readFilter(client, filter, rows, options);
    }
    return rows;
}
