/**
 * What the Azure Audit page decides on top of the shared Audit body: which events the scope bar leaves in, when the
 * account can read none of it, what is said about the reads that gave nothing, the coverage, the approver text and how
 * Privileged only judges an Azure role. Pure: no ARM, no state.
 */
import type { AuditEvent, AzureEntraLogState } from "@/types/audit.types";
import type { ArmRoleDefinition, AzureScope } from "@/types/azureResource.types";
import type { AuditPrivilege } from "@/utils/auditPrivilege";
import { AZURE_SCOPE_LEVEL_LABELS } from "@/utils/auditView";
import { AZURE_PRIVILEGED_ROLE_IDS, isAboveChosenScope, isPrivilegedRole, subscriptionScopeOf } from "@/utils/azureDashboard";
import { isAtOrBelow } from "@/utils/azureDashboardView";
import { isDelegatedScope } from "@/utils/azureScopes";
import type { AzureAuditNotRead, AzureAuditNotReadReason } from "@/utils/azureAuditRead";
import { graphFailureSentence, limitedSentence, reasonList, workspaceCoverageNotes, type WorkspaceSummary } from "@/utils/auditWorkspaceMerge";
import { workspaceSourceLabel } from "@/utils/auditView";
import { ACTIVITY_LOG_DAYS, type WorkspaceLogFailure } from "@/utils/azureWorkspaceActivity";
import type { PrincipalKind } from "@/utils/principalUtils";

const DAY_MS = 86_400_000;
/** The Entra audit log keeps 30 days, when no workspace holds it */
const ENTRA_LOG_DAYS = 30;

/** What the Entra audit log does in this read: a workspace reaches as far as it holds, which is not what it keeps */
const entraLogReach = (days: number): string => (days === ENTRA_LOG_DAYS ? `keeps ${days} days` : `reaches back ${days} days here`);

export interface AzureAuditScopeInput {
    scopes: readonly AzureScope[];
    /** null: All you can read */
    chosenScopeId: string | null;
    includeInherited: boolean;
    includeDelegated: boolean;
    homeTenantId?: string;
}

function scopesByLowerId(scopes: readonly AzureScope[]): Map<string, AzureScope> {
    return new Map(scopes.map((scope) => [scope.id.toLowerCase(), scope]));
}

/**
 * The events the scope bar leaves in. Delegated subscriptions go when they are off; with a chosen scope an event stays when
 * its scope is the chosen one or below it, or, with Include inherited, above it. An event without a scope of the tree goes
 * once a scope is chosen. A chosen id the tree does not hold counts as none chosen.
 */
export function filterAuditEventsByScope(events: readonly AuditEvent[], input: AzureAuditScopeInput): AuditEvent[] {
    const byId = scopesByLowerId(input.scopes);
    const chosen = input.chosenScopeId === null ? undefined : byId.get(input.chosenScopeId.toLowerCase());
    const chosenKey = chosen ? chosen.id.toLowerCase() : null;
    return events.filter((event) => {
        if (!input.includeDelegated && event.azure) {
            const subscription = subscriptionScopeOf(event.azure.scopeId, byId);
            if (subscription !== null && isDelegatedScope(subscription, input.homeTenantId)) return false;
        }
        if (chosenKey === null || chosen === undefined) return true;
        if (!event.azure) return false;
        if (isAtOrBelow(event.azure.scopeId, chosenKey, byId)) return true;
        return input.includeInherited && isAboveChosenScope({ scopeId: event.azure.scopeId }, chosen.id, byId);
    });
}

/** The assignments the scope bar leaves in, by the same rule as the events: delegated subscriptions, the chosen scope or below, and with Include inherited above it */
export function filterAzureAssignmentsByScope<T extends { scopeId: string }>(items: readonly T[], input: AzureAuditScopeInput): T[] {
    const byId = scopesByLowerId(input.scopes);
    const chosen = input.chosenScopeId === null ? undefined : byId.get(input.chosenScopeId.toLowerCase());
    return items.filter((item) => {
        if (!input.includeDelegated) {
            const subscription = subscriptionScopeOf(item.scopeId, byId);
            if (subscription !== null && isDelegatedScope(subscription, input.homeTenantId)) return false;
        }
        if (chosen === undefined) return true;
        if (isAtOrBelow(item.scopeId, chosen.id.toLowerCase(), byId)) return true;
        return input.includeInherited && isAboveChosenScope({ scopeId: item.scopeId }, chosen.id, byId);
    });
}

function subscriptionKeyOf(scopeId: string): string | null {
    const segments = scopeId.split("/").filter((part) => part !== "");
    if (segments.length < 2 || segments[0].toLowerCase() !== "subscriptions") return null;
    return `/${segments[0]}/${segments[1]}`.toLowerCase();
}

/**
 * True when the account can read none of it: there are no subscriptions, or there is no event and every subscription was
 * refused or forbidden on its requests. Never true from an empty log alone. Ids compare without case.
 */
export function isAzureAuditUnreadable(input: { subscriptionIds: readonly string[]; notRead: readonly AzureAuditNotRead[]; eventCount: number }): boolean {
    // Events win: a user with only a management group can have events from the tenant log
    if (input.eventCount > 0) return false;
    if (input.subscriptionIds.length === 0) return true;
    const refused = new Set<string>();
    for (const entry of input.notRead) {
        if (entry.part !== "requests" || (entry.reason !== "refused" && entry.reason !== "forbidden")) continue;
        const key = subscriptionKeyOf(entry.scopeId);
        if (key !== null) refused.add(key);
    }
    return input.subscriptionIds.every((id) => refused.has(`/subscriptions/${id}`.toLowerCase()));
}

const REASON_TEXT: Record<AzureAuditNotReadReason, string> = {
    refused: "your role does not allow this",
    forbidden: "no access",
    gone: "no longer there",
    budget: "not reached in this read",
};

/**
 * Whether the page shows the state of an account that can read none of it now: a read that finished, or one that ended
 * failed because every read was refused (a failed read with an empty `notRead` stays a failed read).
 */
export function isAzureAuditUnreadableNow(status: string, input: { subscriptionIds: readonly string[]; notRead: readonly AzureAuditNotRead[]; eventCount: number }): boolean {
    if (status !== "ready" && !(status === "failed" && input.notRead.length > 0)) return false;
    return isAzureAuditUnreadable(input);
}

const REASON_ORDER: readonly AzureAuditNotReadReason[] = ["forbidden", "refused", "gone", "budget"];

/** The notice about subscriptions that could not be read, or null when every subscription was */
export function azureAuditNotice(notRead: readonly AzureAuditNotRead[], scopes: readonly AzureScope[]): { title: string; detail: string } | null {
    const byId = scopesByLowerId(scopes);
    const reasons = new Map<string, Set<AzureAuditNotReadReason>>();
    for (const entry of notRead) {
        const key = subscriptionKeyOf(entry.scopeId);
        if (key === null) continue;
        const found = reasons.get(key) ?? new Set<AzureAuditNotReadReason>();
        found.add(entry.reason);
        reasons.set(key, found);
    }
    if (reasons.size === 0) return null;
    const total = scopes.filter((scope) => scope.level === "subscription").length;
    // One reason per subscription: the first of this order that it has
    const parts = [...reasons.entries()].map(([key, found]) => {
        const reason = REASON_ORDER.find((candidate) => found.has(candidate)) ?? "forbidden";
        return `${byId.get(key)?.name || key.slice("/subscriptions/".length)}: ${REASON_TEXT[reason]}`;
    });
    return {
        title: `${reasons.size} of ${total} subscriptions could not be read`,
        detail: `(${parts.join("; ")}). Events from them are missing from this list.`,
    };
}

function isAboveSubscriptions(scopeId: string): boolean {
    return scopeId === "/" || /\/providers\/microsoft\.management\/managementgroups\//i.test(scopeId);
}

/** The `Not read` line of every export: the subscriptions that could not be read and what lies above them, in third person. Undefined when nothing is missing. */
export function azureAuditNotReadText(notRead: readonly AzureAuditNotRead[], scopes: readonly AzureScope[]): string | undefined {
    const notice = azureAuditNotice(notRead, scopes);
    const parts: string[] = [];
    if (notice) parts.push(`${notice.title} ${notice.detail}`);
    if (notRead.some((entry) => isAboveSubscriptions(entry.scopeId))) parts.push("Changes above the subscriptions are not in this export: the exporter's roles do not reach them.");
    return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The choices of the scope bar as one phrase for the filter sentence of an export: the chosen scope, Include inherited
 * (only meaningful with a chosen scope) and delegated subscriptions off. Empty for the defaults. A chosen id the tree does
 * not hold counts as none chosen, as in `filterAuditEventsByScope`.
 */
export function describeAzureAuditScopeBar(input: Pick<AzureAuditScopeInput, "scopes" | "chosenScopeId" | "includeInherited" | "includeDelegated">): string {
    const parts: string[] = [];
    const chosen = input.chosenScopeId === null ? undefined : scopesByLowerId(input.scopes).get(input.chosenScopeId.toLowerCase());
    if (chosen) {
        parts.push(`Scope: ${chosen.name} (${AZURE_SCOPE_LEVEL_LABELS[chosen.level]})`);
        if (input.includeInherited) parts.push("Include inherited");
    }
    if (!input.includeDelegated) parts.push("Delegated subscriptions off");
    return parts.join(", ");
}

/** What a chosen workspace adds to the coverage line: its summary, the subscriptions that send to it, and the readable ones to compare with */
export interface AzureWorkspaceCoverage {
    summary: WorkspaceSummary;
    /** The subscriptions that send their activity log to a workspace read (lower case); null when no workspace could say */
    sendingSubscriptionIds: ReadonlySet<string> | null;
    /** The subscriptions the account can list (lower case) */
    readableSubscriptionIds: readonly string[];
    /** The period asked for, in days */
    days: number;
}

/** The sentence that says where the older-than-90-days events come from, when the period is longer than the Activity Log keeps; "" otherwise */
function olderThanNinetyNote(input: AzureWorkspaceCoverage): string {
    if (input.days <= ACTIVITY_LOG_DAYS) return "";
    if (input.sendingSubscriptionIds === null) return "Older than 90 days only from the subscriptions that send to a workspace.";
    if (input.sendingSubscriptionIds.size === 0) return "The Azure activity log stops at 90 days: no chosen workspace holds it.";
    const readable = new Set(input.readableSubscriptionIds.map((id) => id.toLowerCase()));
    // Nothing to compare with: an account without a subscription cannot be told "every"
    if (readable.size === 0) return "Older than 90 days only from the subscriptions that send to a workspace.";
    const sending = [...input.sendingSubscriptionIds].filter((id) => readable.has(id)).length;
    if (sending >= readable.size) return "Older than 90 days from every subscription you can read.";
    return `Older than 90 days only from the ${sending} ${sending === 1 ? "subscription that sends" : "subscriptions that send"} to a workspace.`;
}

/**
 * What a period longer than 90 days cannot hold above the subscriptions (AU-17, measured): a subscription's diagnostic setting
 * does not send what happens at a management group or the tenant root. PIM activity there is still in the Entra audit log; a
 * direct change is not. "" when the period fits the Activity Log or no workspace was read.
 */
export function aboveSubscriptionsNote(days: number, hasWorkspace: boolean): string {
    if (!hasWorkspace || days <= ACTIVITY_LOG_DAYS) return "";
    return "Older than 90 days, above the subscriptions only PIM activity is known, from the Entra audit log: a direct change to a management group or the tenant root is not.";
}

/** The coverage note when the read added the user's own requests on scopes the user cannot read */
export const OWN_REQUESTS_NOTE = "Your own requests on scopes you cannot read are included.";

/**
 * The source label and the sentences of the coverage line. With a chosen workspace the label names the workspaces that were read
 * ("2 of 3 workspaces" when some failed), and the notes say what the workspace adds: the older events, what it shows beyond the
 * roles, and what a workspace can miss. "Azure leaves out what your roles cannot see." stays, as the native reads follow the roles.
 * `ownRequestCount`: the requests only the `asTarget()` read gave (`readAzureAudit`); any of them adds one note.
 */
export function azureAuditCoverage(notRead: readonly AzureAuditNotRead[], entraLog: AzureEntraLogState | null, workspace?: AzureWorkspaceCoverage, ownRequestCount = 0): { label: string; notes: string[] } {
    const notes: string[] = [];
    if (notRead.some((entry) => isAboveSubscriptions(entry.scopeId))) notes.push("Changes above the subscriptions are not in this list: your roles do not reach them.");
    if (workspace) {
        const older = olderThanNinetyNote(workspace);
        if (older) notes.push(older);
        const above = aboveSubscriptionsNote(workspace.days, true);
        if (above) notes.push(above);
        notes.push("A workspace shows what it holds, also on scopes your roles do not reach.");
        notes.push(...workspaceCoverageNotes(workspace.summary));
    }
    if (ownRequestCount > 0) notes.push(OWN_REQUESTS_NOTE);
    notes.push("Azure leaves out what your roles cannot see.");
    if (workspace) return { label: `Azure activity log, PIM requests and ${workspaceSourceLabel(workspace.summary.read, workspace.summary.total)}`, notes };
    return {
        label: entraLog === "read" ? "Azure activity log, PIM requests, Entra audit log" : "Azure activity log and PIM requests",
        notes,
    };
}

/**
 * The banner of the Azure page about what the workspaces could not give, or null when nothing is missing (or none was chosen).
 * Told like the Entra page: a workspace or a log not read, rows not understood, rows of another tenant, and a Graph check that failed.
 */
export function azureWorkspaceNotice(summary: WorkspaceSummary, fellBack: boolean, logFailures: readonly WorkspaceLogFailure[] = []): { title: string; detail: string } | null {
    const reasons = reasonList(summary.failed, summary.total);
    if (fellBack) {
        return {
            title: summary.total === 1 ? "The workspace could not be read" : "The workspaces could not be read",
            detail: `(${reasons}). Showing up to 90 days from the Azure activity log instead.`,
        };
    }
    const rowsText = summary.dropped > 0
        ? `${summary.dropped.toLocaleString("en-US")} ${summary.dropped === 1 ? "row" : "rows"} of the workspaces could not be understood and ${summary.dropped === 1 ? "is" : "are"} missing.`
        : "";
    const otherText = summary.otherTenant > 0
        ? `${summary.otherTenant.toLocaleString("en-US")} ${summary.otherTenant === 1 ? "row belongs" : "rows belong"} to another tenant or name none, and ${summary.otherTenant === 1 ? "is" : "are"} left out.`
        : "";
    const graphText = [summary.graphFailure ? graphFailureSentence(summary.graphFailure) : "", limitedSentence(summary)].filter(Boolean).join(" ");
    const logText = logFailures.map((failure) => `${failure.reason} on the ${failure.log} of ${failure.name}`).join(", ");
    const joined = (...parts: string[]) => parts.filter(Boolean).join(" ");
    const missing = "Events stored only there are missing from this list and from an export.";
    if (summary.failed.length > 0) {
        return {
            title: `${summary.failed.length} of ${summary.total} workspaces could not be read`,
            detail: joined(`(${[reasons, logText].filter(Boolean).join(", ")}). ${missing}`, rowsText, otherText, graphText),
        };
    }
    if (logFailures.length > 0) {
        return { title: logFailures.length === 1 ? "A log of a workspace could not be read" : "Logs of the workspaces could not be read", detail: joined(`(${logText}). ${missing}`, rowsText, otherText, graphText) };
    }
    if (rowsText) return { title: "Some rows could not be understood", detail: joined(rowsText, "They are missing from this list and from an export.", otherText, graphText) };
    if (otherText) return { title: "Not all rows are shown", detail: joined(otherText, graphText) };
    if (summary.graphFailure) return { title: "The last 30 days could not be checked against the Entra audit log", detail: joined(`(${summary.graphFailure}), so events the workspace missed are not shown.`, limitedSentence(summary)) };
    if (graphText) return { title: "Your access shows only part of a log", detail: graphText };
    return null;
}

/** One line per workspace or log that could not be read: an activation stored only there is not in the data (No activation) */
export function azureWorkspaceLimits(summary: WorkspaceSummary, fellBack: boolean, logFailures: readonly WorkspaceLogFailure[] = []): string[] {
    if (fellBack) return [];
    return [
        ...summary.failed.map((failure) => `${failure.name} could not be read, so an activation stored only there is not in the data.`),
        ...logFailures.map((failure) => `The ${failure.log} of ${failure.name} could not be read, so an activation stored only there is not in the data.`),
        ...(summary.limited ?? []).flatMap((item) => item.logs.map((log) => `Your access shows only part of the ${log} of ${item.name}, so an activation stored only there can be missing from the data.`)),
    ];
}

/**
 * What is missing for a group that holds a role: who activated it or was assigned to it is only in the Entra audit log, so without that log, or
 * beyond its reach (30 days, or more with a workspace that holds the log), they are not in the list while direct ones are. Never a silent gap.
 * Null when no group holds a role, or nothing is missing.
 */
export function azureGroupLogNotice(entraLog: AzureEntraLogState | null, days: number, hasGroupHoldings: boolean, entraLogDays: number = ENTRA_LOG_DAYS): { title: string; detail: string } | null {
    if (!hasGroupHoldings || entraLog === null) return null;
    if (entraLog === "read") {
        if (days <= entraLogDays) return null;
        return { title: `Activity through a group goes back ${entraLogDays} days.`, detail: `Who activated or was assigned to a group that holds a role comes from the Entra audit log, which ${entraLogReach(entraLogDays)}. Direct activity in this period goes back further.` };
    }
    const why = entraLog === "no permission" ? "the permission for that log has not been granted. You grant it on the Entra Audit page." : "that log could not be read.";
    return { title: "Activity through a group is missing.", detail: `Who activated or was assigned to a group that holds a role comes from the Entra audit log, and ${why}` };
}

/** Two notices as the one the page has room for */
export function joinAzureNotices(first: { title: string; detail: string } | null, second: { title: string; detail: string } | null): { title: string; detail: string } | null {
    if (!first || !second) return first ?? second;
    return { title: first.title, detail: `${first.detail} ${second.title} ${second.detail}` };
}

/** The note under a request that had an approval and names no approver, or null for any other event. `entraLogDays`: how far the Entra audit log reaches in this read */
export function azureApproverNote(event: AuditEvent, entraLog: AzureEntraLogState | null, now: Date, entraLogDays: number = ENTRA_LOG_DAYS): string | null {
    if (!event.hadApproval || event.approver) return null;
    // No decision yet
    if (event.requestOnly) return null;
    const time = Date.parse(event.time);
    if (Number.isFinite(time) && time < now.getTime() - entraLogDays * DAY_MS) return `The Entra audit log ${entraLogReach(entraLogDays)}, so the approver of this request is no longer there.`;
    // The log was read, or not asked yet: it did not fail
    if (entraLog === "read" || entraLog === null) return null;
    if (entraLog === "no permission") return "Azure does not say who decided. That is in the Entra audit log: grant its permission on the Entra Audit page to show it here.";
    return "Azure does not say who decided, and the Entra audit log could not be read.";
}

/**
 * What Privileged only knows of Azure roles: the built-in privileged roles, and with the role definitions every role by
 * its actions. Without them a role that is not a built-in privileged one cannot be judged (null), never "not privileged".
 */
export function buildAzureAuditPrivilege(definitions: ReadonlyMap<string, ArmRoleDefinition> | null, holderKinds: ReadonlyMap<string, PrincipalKind>): AuditPrivilege {
    const byRoleId = new Map<string, boolean | null>();
    for (const id of AZURE_PRIVILEGED_ROLE_IDS) byRoleId.set(id.toLowerCase(), true);
    if (definitions) for (const id of definitions.keys()) byRoleId.set(id.toLowerCase(), isPrivilegedRole(id, definitions));
    return { isReported: true, byRoleId, byRoleName: new Map(), holdersOfPrivileged: new Set(), holderKinds };
}
