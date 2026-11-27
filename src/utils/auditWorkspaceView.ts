/**
 * The words of the Log Analytics workspace section of Settings (AU-18; the approved wording of `Settings.dc.html` and
 * implementation spec section 8): the lines of one workspace for each of its two logs, the summary above the list, and the
 * line of one workspace in the list. Pure. A status is icon plus text on the page, never colour alone.
 */
import { formatAuditDate, formatAuditTime, auditZoneLabel, type AuditFormat } from "@/utils/auditView";
import type { WorkspaceCheck, WorkspaceLogsCheck } from "@/utils/auditWorkspaceStatus";

export type WorkspaceLineTone = "ok" | "quiet" | "warn" | "error";

export interface WorkspaceLine {
    tone: WorkspaceLineTone;
    text: string;
}

/** A subscription the reader can see: its lower case id and its name, for "such as" */
export interface SubscriptionFact {
    id: string;
    name: string;
}

/** Another chosen workspace: its name, for "that is fine: {name} does", and its checks */
export interface OtherWorkspace {
    name: string;
    logs: WorkspaceLogsCheck;
    /** It is listed above this workspace: when both hold no such log, only the first one carries the warning */
    isListedBefore?: boolean;
}

/** The subscriptions the reader can see (Enabled, home tenant); null when they could not be listed */
export interface LogLinesFacts {
    subscriptions: readonly SubscriptionFact[] | null;
}

type LogKind = "entra" | "azure";
type Connected = Extract<WorkspaceCheck, { kind: "connected" }>;

const WORDS: Record<LogKind, { noun: string; owned: string; table: string; holds: string }> = {
    entra: { noun: "Entra audit logs", owned: "its Entra audit logs", table: "its AuditLogs table", holds: "Holds no Entra audit logs" },
    azure: { noun: "Azure activity logs", owned: "its Azure activity logs", table: "its AzureActivity table", holds: "Holds no Azure activity logs" },
};

/** "Keeps logs 180 days." or nothing when the retention is not known */
export function keepsText(retentionDays: number | undefined): string {
    return retentionDays === undefined ? "" : `Keeps logs ${retentionDays} ${retentionDays === 1 ? "day" : "days"}.`;
}

const subscriptionWord = (n: number) => (n === 1 ? "subscription" : "subscriptions");
const isProblem = (check: WorkspaceCheck) => check.kind === "noAccess" || check.kind === "failed";
const isConnected = (check: WorkspaceCheck): check is Connected => check.kind === "connected";

/** The list of subscriptions when it has any; none listed means the count is unknown, so it is left out */
function listedOf(subscriptions: readonly SubscriptionFact[] | null): readonly SubscriptionFact[] | null {
    return subscriptions && subscriptions.length > 0 ? subscriptions : null;
}

/** The name of a subscription; when another one has the same name, its first 8 characters of the id follow it */
function subscriptionLabel(subscription: SubscriptionFact, all: readonly SubscriptionFact[]): string {
    const shared = all.filter((s) => s.name === subscription.name).length > 1;
    return shared ? `${subscription.name} (${subscription.id.slice(0, 8)})` : subscription.name;
}

function connectedLine(kind: LogKind, check: Connected, ownIds: readonly string[], others: readonly OtherWorkspace[], subscriptions: readonly SubscriptionFact[] | null, format: AuditFormat): WorkspaceLine {
    const line = connectedLineOf(kind, check, ownIds, others, subscriptions, format);
    if (!check.isLimited) return line;
    // A condition on the rows: what the line says is true of the part the reader may see
    return { tone: "warn", text: `${line.text} Your access shows only part of ${WORDS[kind].table}, so events can be missing.` };
}

function connectedLineOf(kind: LogKind, check: Connected, ownIds: readonly string[], others: readonly OtherWorkspace[], subscriptions: readonly SubscriptionFact[] | null, format: AuditFormat): WorkspaceLine {
    const range = `from ${formatAuditDate(check.oldest, format)} to ${formatAuditDate(check.newest, format)}`;
    if (kind === "entra") return { tone: "ok", text: `Entra audit logs ${range}.` };
    const listed = listedOf(subscriptions);
    if (!listed) return { tone: "ok", text: `Azure activity logs ${range}.` };
    const total = listed.length;
    const missing = listed.filter((s) => !ownIds.includes(s.id));
    if (missing.length === 0) return { tone: "ok", text: `Azure activity logs ${range}, from all ${total} ${subscriptionWord(total)} you can read.` };
    const sending = total - missing.length;
    const head = `Azure activity logs ${range}, from ${sending} of the ${total} ${subscriptionWord(total)} you can read.`;
    // History stops at 90 days only for a subscription that sends to no chosen workspace: one that sends to another chosen workspace is covered
    const elsewhere = new Set(others.flatMap((other) => other.logs.subscriptionIds));
    const nowhere = missing.filter((s) => !elsewhere.has(s.id));
    if (nowhere.length === 0) return { tone: "ok", text: `${head} ${missing.length === 1 ? "The other one sends" : `The other ${missing.length} send`} to another chosen workspace.` };
    // The sentence about subscriptions that send nowhere is told once: under the first workspace listed that holds Azure logs
    if (others.some((other) => other.isListedBefore && isConnected(other.logs.azure))) return { tone: "ok", text: head };
    const names = nowhere.slice(0, 2).map((s) => subscriptionLabel(s, listed)).join(" and ");
    let rest: string;
    if (nowhere.length < missing.length) rest = `${nowhere.length} of the others ${nowhere.length === 1 ? "sends" : "send"} to no chosen workspace, such as ${names}, so ${nowhere.length === 1 ? "its history stops" : "their history stops"} at 90 days.`;
    else if (missing.length === 1) rest = `${names} sends nothing here, so its history stops at 90 days.`;
    else rest = `The other ${missing.length} send nothing here, such as ${names}, so their history stops at 90 days.`;
    return { tone: "warn", text: `${head} ${rest}` };
}

/** A log with no event in this workspace: quiet when another chosen workspace holds it, quiet when another could not be read or already carries the warning, else a warning */
function noLogsLine(kind: LogKind, others: readonly OtherWorkspace[]): WorkspaceLine {
    const logOf = (other: OtherWorkspace): WorkspaceCheck => (kind === "entra" ? other.logs.entra : other.logs.azure);
    const holder = others.find((other) => isConnected(logOf(other)));
    if (holder) return { tone: "quiet", text: `${WORDS[kind].holds}. That is fine: ${holder.name} does.` };
    if (others.some((other) => isProblem(logOf(other)))) return { tone: "quiet", text: `${WORDS[kind].holds}.` };
    // The warning is told once: a workspace above this one that holds none either already carries it
    if (others.some((other) => other.isListedBefore && logOf(other).kind === "noLogs")) return { tone: "quiet", text: `${WORDS[kind].holds}, as the workspace listed above.` };
    if (kind === "entra") {
        return { tone: "warn", text: "Holds no Entra audit logs, so Entra stays at 30 days. Someone with access must send AuditLogs to it with a diagnostic setting in Entra; the first logs can take up to 3 days, and older logs are not added." };
    }
    return { tone: "warn", text: "Holds no Azure activity logs, so Azure stays at 90 days. Someone with access must send them with a diagnostic setting on each subscription. The first logs can take up to 90 minutes, and older logs are not added." };
}

/** " (403)", or nothing for a table that is denied without an error status */
const statusText = (status: number | null) => (status === null ? "" : ` (${status})`);

function problemLine(kind: LogKind, check: WorkspaceCheck): WorkspaceLine | null {
    if (check.kind === "noAccess") {
        return { tone: "error", text: `You cannot read ${WORDS[kind].owned}${statusText(check.status)}, so events stored only there are missing. You need read access to the workspace and ${WORDS[kind].table}, such as Log Analytics Reader.` };
    }
    if (check.kind === "failed") {
        return { tone: "error", text: `Its ${WORDS[kind].noun} could not be checked (${check.detail}), so events stored only there are missing. Check the workspace ID and your access, then check again.` };
    }
    return null;
}

/**
 * The lines of one workspace, Entra first, for its two logs (AU-18). `others` are the other chosen workspaces, so a log that
 * none of them holds is told as a warning only when no chosen workspace holds it. A log that is refused or failed shows its
 * problem; a log with no event beside that shows nothing.
 */
export function workspaceLogLines(check: WorkspaceLogsCheck, others: readonly OtherWorkspace[], facts: LogLinesFacts, format: AuditFormat = {}): WorkspaceLine[] {
    const { entra, azure } = check;
    if (entra.kind === "noAccess" && azure.kind === "noAccess" && entra.status === azure.status) {
        return [{ tone: "error", text: `You cannot read its logs${statusText(entra.status)}, so events stored only there are missing. You need read access to the workspace${entra.status === null ? " and its tables" : ""}, such as Log Analytics Reader.` }];
    }
    if (entra.kind === "failed" && azure.kind === "failed" && entra.detail === azure.detail) {
        return [{ tone: "error", text: `It could not be checked (${entra.detail}), so events stored only there are missing. Check the workspace ID and your access, then check again.` }];
    }
    const lines: WorkspaceLine[] = [];
    const entraLine = logLine("entra", entra, azure, others, check, facts, format);
    const azureLine = logLine("azure", azure, entra, others, check, facts, format);
    // What it holds comes first, then what it does not
    const first = entra.kind === "noLogs" && isConnected(azure) ? [azureLine, entraLine] : [entraLine, azureLine];
    for (const line of first) if (line) lines.push(line);
    return lines;
}

function logLine(kind: LogKind, own: WorkspaceCheck, other: WorkspaceCheck, others: readonly OtherWorkspace[], check: WorkspaceLogsCheck, facts: LogLinesFacts, format: AuditFormat): WorkspaceLine | null {
    if (isConnected(own)) return connectedLine(kind, own, check.subscriptionIds, others, facts.subscriptions, format);
    if (own.kind === "noLogs") return isProblem(other) ? null : noLogsLine(kind, others);
    return problemLine(kind, own);
}

export interface WorkspaceSummaryText {
    text: string;
    detail: string;
}

/**
 * "Audit reads 2 workspaces" and how far back the logs reach (AU-18). A workspace counts as read when one of its logs connected.
 * `subscriptions` are the ids of the subscriptions the reader can see, or null when they are not known.
 */
export function workspaceSummaryText(checks: readonly WorkspaceLogsCheck[], subscriptions: readonly string[] | null, format: AuditFormat = {}): WorkspaceSummaryText {
    const read = checks.filter((c) => isConnected(c.entra) || isConnected(c.azure)).length;
    const noun = (n: number) => (n === 1 ? "workspace" : "workspaces");
    // A workspace that can be read and holds nothing did not fail: "1 of 2" is for one that could not be read. With nothing read, all count, as on the Audit page.
    const counted = read === 0 ? checks.length : checks.filter((c) => !(c.entra.kind === "noLogs" && c.azure.kind === "noLogs")).length;
    const text = read === counted
        ? `Audit reads ${read} ${noun(read)}`
        : `Audit reads ${read} of ${counted} ${noun(counted)}`;
    if (read === 0) {
        return { text, detail: "Audit shows the 30 days of the Entra audit log and the 90 days of the Azure activity log until a workspace can be read." };
    }
    const entraReach = checks.map((c) => c.entra).filter(isConnected).map((c) => c.oldest);
    const azureReach = checks.map((c) => c.azure).filter(isConnected).map((c) => c.oldest);
    const earliest = (times: string[]) => times.reduce((min, time) => (Date.parse(time) < Date.parse(min) ? time : min));
    const listed = subscriptions && subscriptions.length > 0 ? new Set(subscriptions) : null;
    const sending = new Set(checks.flatMap((c) => c.subscriptionIds));
    const covered = listed ? [...sending].filter((id) => listed.has(id)).length : 0;
    const lessThanAll = listed !== null && covered < listed.size;
    const subs = `${covered} ${subscriptionWord(covered)}`;
    let detail: string;
    if (entraReach.length > 0 && azureReach.length > 0) {
        const e = formatAuditDate(earliest(entraReach), format);
        const a = formatAuditDate(earliest(azureReach), format);
        detail = lessThanAll ? `Entra reaches back to ${e}, Azure to ${a} for ${subs}.` : `Entra reaches back to ${e}, Azure to ${a}.`;
    } else if (entraReach.length > 0) {
        detail = `Entra reaches back to ${formatAuditDate(earliest(entraReach), format)}. Azure stays at 90 days.`;
    } else {
        const a = formatAuditDate(earliest(azureReach), format);
        detail = lessThanAll ? `Azure reaches back to ${a} for ${subs}. Entra stays at 30 days.` : `Azure reaches back to ${a}. Entra stays at 30 days.`;
    }
    return { text, detail };
}

/** "Checked 5 Nov 2026, 12:00 UTC+1. Access is your own: a colleague may see this differently. A workspace shows what it holds, also on scopes your Azure roles do not reach." */
export function checkedLine(checkedAt: string, format: AuditFormat = {}): string {
    return `Checked ${formatAuditDate(checkedAt, format)}, ${formatAuditTime(checkedAt, format)} ${auditZoneLabel(checkedAt, format)}. Access is your own: a colleague may see this differently. A workspace shows what it holds, also on scopes your Azure roles do not reach.`;
}

/** The second line of a workspace in the list: where it is, and how long it keeps logs */
export function workspaceWhereText(subscriptionName: string, location: string, retentionDays: number | undefined): string {
    const where = [subscriptionName, location].filter(Boolean).join(", ");
    return [where ? `${where}.` : "", keepsText(retentionDays)].filter(Boolean).join(" ");
}
