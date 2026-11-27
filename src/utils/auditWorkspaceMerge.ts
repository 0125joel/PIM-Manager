/**
 * Combining the reads of several Log Analytics workspaces (implementation spec section 7): one query per workspace, merged
 * in the browser. Pure. Duplicates are removed on the event id, rows of another tenant are left out, the total stops at the
 * audit limit, and what could not be read is told in one sentence for the banner and the export. A part never looks like the
 * whole.
 */
import type { RawDirectoryAudit } from "@/types/audit.types";
import { AUDIT_ROW_LIMIT, AuditTooManyEventsError } from "@/utils/auditErrors";
import type { WorkspaceRow } from "@/utils/auditWorkspaceRows";
import { WORKSPACE_MAX_DAYS } from "@/utils/auditWorkspaceKql";

/** The longest period the Audit page offers without a workspace */
const GRAPH_MAX_DAYS = 30;

/** The workspace a read belongs to */
export interface WorkspaceRef {
    customerId: string;
    /** The name shown; the customer id when the name is not known */
    name: string;
}

/** The read of one workspace: its rows, or the reason it failed. `noTable`: the workspace holds no AuditLogs table (it holds only the Azure activity log) */
export type WorkspaceRead =
    | { workspace: WorkspaceRef; ok: true; rows: WorkspaceRow[]; dropped: number; oldestAuditEvent?: string | null; limitedLogs?: LimitedLog[] }
    | { workspace: WorkspaceRef; ok: false; reason: string; noTable?: boolean };

/** The part of a read the summary counts: the Entra reads and the Azure reads of a workspace both fit */
export interface SummaryRead {
    workspace: WorkspaceRef;
    ok: boolean;
    reason?: string;
    noTable?: boolean;
    dropped?: number;
    /** The logs of this workspace the reader sees only part of */
    limitedLogs?: readonly LimitedLog[];
}

/** A log the reader may see only part of, through a condition on its rows */
export type LimitedLog = "Entra audit log" | "Azure activity log";

export interface MergedRows {
    rows: RawDirectoryAudit[];
    /** The workspace name of each kept event id */
    workspaceOf: Map<string, string>;
    /** Rows left out because they were already there from another workspace */
    duplicates: number;
    /** Rows left out because their tenant is not the signed-in one, or they name none */
    otherTenant: number;
}

/**
 * The rows of every workspace that was read, once each: deduplicated on the event id (the first workspace wins), only those
 * of `tenantId`. Throws AuditTooManyEventsError when more than `limit` rows are left, as the Graph read does.
 */
export function mergeWorkspaceRows(reads: readonly WorkspaceRead[], tenantId: string, limit: number = AUDIT_ROW_LIMIT): MergedRows {
    const tenant = tenantId.trim().toLowerCase();
    const rows: RawDirectoryAudit[] = [];
    const workspaceOf = new Map<string, string>();
    let duplicates = 0;
    let otherTenant = 0;
    for (const read of reads) {
        if (!read.ok) continue;
        // A workspace that filled the query to its stop is too many, whatever the rest leaves out. The rows that could not be understood were in the answer too.
        if (read.rows.length + read.dropped > limit) throw new AuditTooManyEventsError(limit);
        for (const row of read.rows) {
            if (tenant === "" || row.tenantId !== tenant) {
                otherTenant++;
                continue;
            }
            if (workspaceOf.has(row.raw.id)) {
                duplicates++;
                continue;
            }
            workspaceOf.set(row.raw.id, read.workspace.name);
            rows.push(row.raw);
            if (rows.length > limit) throw new AuditTooManyEventsError(limit);
        }
    }
    return { rows, workspaceOf, duplicates, otherTenant };
}

/**
 * Adds the rows of the Entra audit log to the merged workspace rows, one row per id (a workspace row wins), because a
 * workspace holds what the diagnostic export delivered and can miss events (measured: 44 of 434 rows over 30 days). The
 * rows only Graph had are counted. One action can span rows of both sources, so the caller maps the result as a whole.
 * Throws AuditTooManyEventsError when the total passes `limit`.
 */
export interface CombinedRows extends MergedRows {
    /** Rows that only the Entra audit log had, and were added */
    graphOnly: number;
}

export function addGraphRows(merged: MergedRows, graphRows: readonly RawDirectoryAudit[], limit: number = AUDIT_ROW_LIMIT): CombinedRows {
    const rows = [...merged.rows];
    const seen = new Set(merged.workspaceOf.keys());
    let graphOnly = 0;
    let duplicates = merged.duplicates;
    for (const row of graphRows) {
        if (seen.has(row.id)) {
            // Already there from a workspace, or delivered twice by Graph
            if (merged.workspaceOf.has(row.id)) continue;
            duplicates++;
            continue;
        }
        seen.add(row.id);
        rows.push(row);
        graphOnly++;
        if (rows.length > limit) throw new AuditTooManyEventsError(limit);
    }
    // The mapper merges rows of one action in the order it reads them: oldest first, ties by id, so the result does not depend on which source delivered a row
    rows.sort((a, b) => Date.parse(a.activityDateTime) - Date.parse(b.activityDateTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ...merged, rows, duplicates, graphOnly };
}

/** What the page says about a set of reads */
export interface WorkspaceSummary {
    total: number;
    /** Workspaces that were read */
    read: number;
    failed: { name: string; reason: string }[];
    /** Rows that could not be read, over all workspaces */
    dropped: number;
    /** Rows left out because they belong to another tenant or name none */
    otherTenant: number;
    /** Rows that only the Entra audit log had and were added (the last 30 days) */
    graphOnly?: number;
    /** Why the last 30 days could not be checked against the Entra audit log: `no permission`, `no reader role`, or status and code */
    graphFailure?: string | null;
    /** Workspaces that were read, with the logs the reader sees only part of */
    limited?: { name: string; logs: LimitedLog[] }[];
}

/** How the check against the Entra audit log went */
export interface GraphCheck {
    graphOnly: number;
    failure: string | null;
}

/**
 * What the page says about a set of reads. A workspace without the table of one log is not a failure when another workspace
 * was read: it is counted in neither `failed` nor `total`. When no workspace was read, such reads count as they do otherwise.
 */
export function summarizeWorkspaceReads(reads: readonly SummaryRead[], otherTenant = 0, graph: GraphCheck = { graphOnly: 0, failure: null }): WorkspaceSummary {
    const failed: WorkspaceSummary["failed"] = [];
    const anyRead = reads.some((item) => item.ok);
    let read = 0;
    let dropped = 0;
    let total = 0;
    const limited: { name: string; logs: LimitedLog[] }[] = [];
    for (const item of reads) {
        if (item.ok) {
            read++;
            total++;
            dropped += item.dropped ?? 0;
            if (item.limitedLogs && item.limitedLogs.length > 0) limited.push({ name: item.workspace.name, logs: [...item.limitedLogs] });
        } else if (anyRead && item.noTable === true) {
            continue;
        } else {
            total++;
            failed.push({ name: item.workspace.name, reason: item.reason ?? "no answer" });
        }
    }
    return { total, read, failed, dropped, otherTenant, graphOnly: graph.graphOnly, graphFailure: graph.failure, ...(limited.length > 0 ? { limited } : {}) };
}

/** Whether no workspace could be read: the page falls back to the 30 days of the Entra audit log, visibly */
export function allWorkspacesFailed(summary: WorkspaceSummary): boolean {
    return summary.total > 0 && summary.read === 0;
}

export function reasonList(failed: WorkspaceSummary["failed"], total: number): string {
    // "403 on all 2 workspaces" when every workspace failed for one reason; "403 on law-a" for one reason that repeats; else each with its own
    const reasons = [...new Set(failed.map((f) => f.reason))];
    if (reasons.length === 1) {
        if (failed.length === total && total > 1) return `${reasons[0]} on all ${total} workspaces`;
        return `${reasons[0]} on ${failed.map((f) => f.name).join(", ")}`;
    }
    return failed.map((f) => `${f.reason} on ${f.name}`).join(", ");
}

/** The banner of the Audit page and the `Not read` line of every export, in two parts: a title and the rest */
export interface WorkspaceNotice {
    title: string;
    detail: string;
}

/**
 * What is missing, or null when nothing is. `fellBack`: no workspace could be read and the 30 days of the Entra audit log
 * show instead. Rows that could not be understood are told too: they are events the list lacks.
 */
export function workspaceNotice(summary: WorkspaceSummary, fellBack: boolean): WorkspaceNotice | null {
    const withOthers = noticeWithOthers(summary, fellBack);
    if (!summary.graphFailure || fellBack) return withOthers;
    const sentence = graphFailureSentence(summary.graphFailure);
    // Graph could not check the last 30 days: told as the banner, or after what else is missing
    if (!withOthers) return { title: "The last 30 days could not be checked against the Entra audit log", detail: `(${summary.graphFailure}), so events the workspace missed are not shown.` };
    return { title: withOthers.title, detail: `${withOthers.detail} ${sentence}` };
}

/** Said when the Entra audit log could not be read next to the workspaces (the text of the plan) */
export function graphFailureSentence(reason: string): string {
    return `The last 30 days could not be checked against the Entra audit log (${reason}), so events the workspace missed are not shown.`;
}

/** Always said with a workspace source: what a workspace is */
export const WORKSPACE_GAP_NOTE = "A workspace holds what the diagnostic export delivered and can miss events.";

/** Said when the Entra audit log filled gaps in the workspaces */
export function graphAddedSentence(count: number): string {
    return `${count.toLocaleString("en-US")} ${count === 1 ? "row was" : "rows were"} only in the Entra audit log and ${count === 1 ? "was" : "were"} added.`;
}

/** The notes of the coverage line of a workspace source: what a workspace is, and what the Entra audit log added */
export function workspaceCoverageNotes(summary: WorkspaceSummary): string[] {
    return [WORKSPACE_GAP_NOTE, ...((summary.graphOnly ?? 0) > 0 ? [graphAddedSentence(summary.graphOnly ?? 0)] : [])];
}

/**
 * The `Not read` line of every export of a workspace source: what is missing, always what a workspace is, and what the
 * Entra audit log added. After a fall-back to the Entra audit log the source is Graph, so only what is missing is told.
 */
export function workspaceNotRead(summary: WorkspaceSummary, fellBack: boolean): string {
    const missing = workspaceMissingText(summary, fellBack);
    if (fellBack) return missing;
    return [missing, ...workspaceCoverageNotes(summary)].filter(Boolean).join(" ");
}

/** What a condition on the rows hides: one sentence for every workspace and log the reader sees only part of, or "" */
export function limitedSentence(summary: Pick<WorkspaceSummary, "limited">): string {
    const parts = (summary.limited ?? []).flatMap((item) => item.logs.map((log) => `the ${log} of ${item.name}`));
    if (parts.length === 0) return "";
    return `Your access shows only part of ${parts.join(" and ")}, so events can be missing.`;
}

function noticeWithOthers(summary: WorkspaceSummary, fellBack: boolean): WorkspaceNotice | null {
    // Rows of another tenant are never shown, and a list without them must say so: it could otherwise read as complete.
    // A log the reader sees only part of is told the same way
    const otherText = [summary.otherTenant > 0
        ? `${summary.otherTenant.toLocaleString("en-US")} ${summary.otherTenant === 1 ? "row belongs" : "rows belong"} to another tenant or name none, and ${summary.otherTenant === 1 ? "is" : "are"} left out.`
        : "", fellBack ? "" : limitedSentence(summary)].filter(Boolean).join(" ");
    const notice = baseNotice(summary, fellBack);
    if (!otherText) return notice;
    const title = summary.otherTenant > 0 ? "Not all rows are shown" : "Your access shows only part of a log";
    return notice ? { title: notice.title, detail: `${notice.detail} ${otherText}` } : { title, detail: otherText };
}

function baseNotice(summary: WorkspaceSummary, fellBack: boolean): WorkspaceNotice | null {
    const rowsText = summary.dropped > 0
        ? `${summary.dropped.toLocaleString("en-US")} ${summary.dropped === 1 ? "row" : "rows"} of the workspaces could not be understood and ${summary.dropped === 1 ? "is" : "are"} missing.`
        : "";
    if (summary.failed.length === 0) {
        return summary.dropped > 0 ? { title: `${summary.dropped.toLocaleString("en-US")} ${summary.dropped === 1 ? "row" : "rows"} could not be understood`, detail: "They are missing from this list and from an export." } : null;
    }
    const reasons = reasonList(summary.failed, summary.total);
    if (fellBack) {
        return {
            title: summary.total === 1 ? "The workspace could not be read" : "The workspaces could not be read",
            detail: `(${reasons}). Showing 30 days from the Entra audit log instead.`,
        };
    }
    return {
        title: `${summary.failed.length} of ${summary.total} workspaces could not be read`,
        detail: [`(${reasons}). Events stored only there are missing from this list and from an export.`, rowsText].filter(Boolean).join(" "),
    };
}

/** The notice as one sentence, for the `Not read` line of an export; empty when nothing is missing */
export function workspaceMissingText(summary: WorkspaceSummary, fellBack: boolean): string {
    const notice = workspaceNotice(summary, fellBack);
    return notice ? `${notice.title} ${notice.detail}` : "";
}

/**
 * The longest period to offer: the longest retention among the workspaces that were read. A workspace whose retention is
 * not known (a manual id, or an Azure list that could not be read) counts as the longest a workspace keeps, so the read is
 * never shorter than what the workspace holds. No workspace: the 30 days of the Entra audit log.
 */
export function workspacePeriodMax(retentionDays: readonly (number | undefined)[]): number {
    if (retentionDays.length === 0) return GRAPH_MAX_DAYS;
    const days = retentionDays.map((d) => (typeof d === "number" && Number.isFinite(d) && d >= 1 ? Math.floor(d) : WORKSPACE_MAX_DAYS));
    return Math.min(Math.max(...days), WORKSPACE_MAX_DAYS);
}

/**
 * How far back the workspaces that were read reach: the earliest oldest event of their audit table, else the earliest event
 * read. Never earlier than what was read could prove, so a workspace that started receiving logs recently does not claim
 * the whole period.
 */
export function workspaceReach(reads: readonly WorkspaceRead[]): string | null {
    let earliest: number | null = null;
    for (const read of reads) {
        if (!read.ok) continue;
        let candidate: number | null = null;
        const table = read.oldestAuditEvent ? Date.parse(read.oldestAuditEvent) : NaN;
        if (Number.isFinite(table)) candidate = table;
        else {
            for (const row of read.rows) {
                const ms = Date.parse(row.raw.activityDateTime);
                if (Number.isFinite(ms) && (candidate === null || ms < candidate)) candidate = ms;
            }
        }
        if (candidate !== null && (earliest === null || candidate < earliest)) earliest = candidate;
    }
    return earliest === null ? null : new Date(earliest).toISOString();
}
