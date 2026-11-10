/**
 * The content of the Azure dashboard export (NG-104b) as the same plain data the Entra dashboard export uses (`ExportReport`),
 * so `ReportDocument` renders it unchanged, and the rows of the CSV (the columns of the Azure Report's assignments file).
 * The same functions as the dashboard produce every number, so the document says what the screen says. Pure logic, no React, no service.
 */
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { isAboveChosenScope } from "@/utils/azureDashboard";
import {
    computeAzureAccounts,
    computeAzureActivation,
    computeAzureApprovers,
    computeAzureCards,
    computeAzureEasyToMiss,
    computeAzureHasAccess,
    computeAzureRightNow,
    countAzureFailedPairs,
    type AzureCardId,
    type AzureDashboardInput,
    type AzureEasyToMissId,
    type AzureSettingsOutcome,
} from "@/utils/azureDashboardStats";
import { EASY_TO_MISS_PATCHES } from "@/utils/azureDashboardFilterLink";
import { summarizeAzureAlerts, type AzureAlertsOutcome } from "@/utils/azureDashboardView";
import { anonymiseAzure, AZURE_WORKLOAD, buildAzureAssignmentRows, rolePairsOf, SCOPE_LEVEL_LABELS, type AzurePolicyOutcome } from "@/utils/azureExportRows";
import { AZURE_PRIVILEGED_ROLE_IDS, EMPTY_AZURE_FILTERS, eligiblePairsOf, endTextFor, flattenScopeTree, matchesAzureFilters, principalKindLabel, type AzureAssignmentRow, type AzureFilterContext } from "@/utils/azureReport";
import { azurePolicyKey, isDelegatedScope } from "@/utils/azureScopes";
import { daysUntil, formatEndsIn } from "@/utils/dashboardAdvanced";
import type { ChartItem } from "@/utils/exportChartData";
import type { ChartStyle, ExportAudience, ExportDetail, ExportReport, ReportAttention, ReportChart, ReportTable } from "@/utils/exportReport";
import type { AssignmentExportRow } from "@/utils/exportRows";
import type { ExportRow } from "@/utils/exportSchema";

export type AzureExportBlockKey = "numbers" | "attention" | "alerts" | "posture" | "findings" | "emergency" | "accounts" | "rightNow" | "glossary";

export const AZURE_EXPORT_BLOCKS: { key: AzureExportBlockKey; label: string; hint: string }[] = [
    { key: "numbers", label: "Key numbers", hint: "The eight cards of the dashboard" },
    { key: "attention", label: "What needs attention", hint: "Easy to miss, with the details" },
    { key: "alerts", label: "Alerts", hint: "From Microsoft, per subscription (preview)" },
    { key: "posture", label: "Posture charts", hint: "Assignments, level, MFA, approval, justification, duration" },
    { key: "findings", label: "Findings", hint: "The accounts and scopes behind each item" },
    { key: "emergency", label: "Emergency access accounts", hint: "Marked accounts and the roles they hold" },
    { key: "accounts", label: "Accounts and approvers", hint: "Most privileged accounts, who approves" },
    { key: "rightNow", label: "Right now", hint: "Activated now, eligibility ending within 7 days" },
    { key: "glossary", label: "How the numbers are counted", hint: "One line per number" },
];

const SUMMARY_BLOCKS: AzureExportBlockKey[] = ["numbers", "attention", "alerts", "posture"];

export function defaultAzureBlocks(detail: ExportDetail): Record<AzureExportBlockKey, boolean> {
    const result = {} as Record<AzureExportBlockKey, boolean>;
    for (const { key } of AZURE_EXPORT_BLOCKS) result[key] = detail !== "summary" || SUMMARY_BLOCKS.includes(key);
    return result;
}

export interface AzureDashboardExportInput {
    /** The input the page computes its numbers from (filter applied) */
    stats: AzureDashboardInput;
    /** The same with the filter left out, for "Apply the current filter" off */
    statsWithoutFilter: AzureDashboardInput;
    /** The alerts per subscription (lowercase subscription id); `AzureDashboardReads` fits */
    reads: { alerts: ReadonlyMap<string, AzureAlertsOutcome> };
    /** "All you can read" or the path of the chosen scope */
    scopeLine: string;
    includeInherited: boolean;
    includeDelegated: boolean;
    /** "" when no filter */
    filterSentence: string;
    subscriptionName: (id: string) => string;
    meta: { tenantName: string | null; tenantId?: string; exporter: string; version: string; dataReadAt?: Date; exportedAt: Date };
}

export interface AzureExportOptions {
    detail: ExportDetail;
    audience: ExportAudience;
    chartStyle: ChartStyle;
    /** Replace the names of people by "Person n". Always on for the management audience */
    anonymise: boolean;
    applyFilter: boolean;
    blocks: Record<AzureExportBlockKey, boolean>;
}

const FINDING_ROWS = 10;

/** The first four colours of `AUTH_CONTEXT_COLORS` in `exportChartData.ts`, the ordered palette of that file: no new colours */
const LEVEL_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"] as const;

const CARD_LABELS: Record<AzureCardId, string> = {
    roleScope: "Role × scope",
    activeNow: "Active now",
    permanent: "Permanent",
    eligible: "Eligible",
    privileged: "Privileged roles",
    requireApproval: "Require approval",
    customRoles: "Custom roles",
    inherited: "Inherited",
};
const CARD_ORDER: AzureCardId[] = ["roleScope", "activeNow", "permanent", "eligible", "privileged", "requireApproval", "customRoles", "inherited"];

export const AZURE_GLOSSARY: { term: string; text: string }[] = [
    { term: "Role × scope", text: "A role at one scope. Several people can hold the same role × scope: it is counted once." },
    { term: "Permanent", text: "Active assignments without an end date. Marked emergency access accounts are counted apart." },
    { term: "Eligible", text: "Eligible assignments: access that needs an activation first." },
    { term: "Active now", text: "Active assignments that have not ended: activated from an eligibility, or assigned as active." },
    { term: "Privileged roles", text: "The five roles Microsoft marks privileged and every role whose actions let it change access." },
    { term: "Inherited", text: "Assignments made above the chosen scope. Without a chosen scope: assignments made on a management group." },
    { term: "No MFA on activation", text: "Privileged role × scope whose settings ask for neither Entra MFA nor an authentication context on activation. Settings that are not loaded or not readable are not counted." },
    { term: "Nobody notified", text: "Privileged role × scope whose activation notification has no default recipients and no extra recipients." },
    { term: "Filter", text: "A filter changes every number and table it is about. The header names the filter that was active at export." },
];

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

function scopesById(scopes: readonly AzureScope[]): Map<string, AzureScope> {
    return new Map(scopes.map((s) => [s.id.toLowerCase(), s]));
}

/** The assignments on a scope of the tree as Report rows, in the order of the Report: tree position, role, name */
function toRows(assignments: readonly AzureAssignment[], input: AzureDashboardInput): AzureAssignmentRow[] {
    const byId = scopesById(input.scopes);
    const position = new Map<string, number>();
    flattenScopeTree(input.scopes).forEach((row, index) => position.set(row.scope.id.toLowerCase(), index));
    const rows: AzureAssignmentRow[] = [];
    for (const assignment of assignments) {
        const scope = byId.get(assignment.scopeId.toLowerCase());
        if (!scope) continue;
        const isInherited = isAboveChosenScope(assignment, input.chosenScopeId, byId);
        rows.push({
            assignment,
            scope,
            isInherited,
            originText: isInherited ? `Inherited from ${scope.name}` : "This scope",
            endText: endTextFor(assignment.endDateTime),
            principalTypeLabel: principalKindLabel(assignment, input.spTypes),
        });
    }
    const at = (row: AzureAssignmentRow) => position.get(row.scope.id.toLowerCase()) ?? 0;
    return rows.sort(
        (x, y) =>
            at(x) - at(y) ||
            x.assignment.roleName.localeCompare(y.assignment.roleName, "en") ||
            x.assignment.principalName.localeCompare(y.assignment.principalName, "en"),
    );
}

interface Prepared {
    /** The input the numbers come from: filter on or off, names replaced when asked */
    stats: AzureDashboardInput;
    /** Lowercase principal ids whose name was replaced */
    anonymisedIds: ReadonlySet<string> | undefined;
}

/**
 * Applies "Apply the current filter" and "Replace names" to the input. Names are numbered over everything in view, so a
 * person has the same label with the filter on and off. Users and guests become "Person n"; apps, managed identities,
 * agents and groups keep their names, and so do the approvers that are groups.
 */
function prepare(input: AzureDashboardExportInput, options: AzureExportOptions): Prepared {
    const base = options.applyFilter ? input.stats : input.statsWithoutFilter;
    const isAnonymised = options.anonymise || options.audience === "management";
    if (!isAnonymised) return { stats: base, anonymisedIds: undefined };

    const source = input.statsWithoutFilter;
    const outcomeOf = (pair: { scopeId: string; roleDefinitionId: string }): AzurePolicyOutcome | undefined => {
        const outcome = source.settings.get(azurePolicyKey(pair.scopeId, pair.roleDefinitionId));
        if (!outcome) return undefined;
        return outcome.status === "loaded" ? { status: "loaded", rules: outcome.rules, lastModified: null } : { status: outcome.status };
    };
    const rows = toRows(source.assignments, source);
    const anonymised = anonymiseAzure(rows, outcomeOf);

    const labels = new Map<string, string>();
    for (const row of anonymised.rows) {
        if (row.assignment.principalType === "User") labels.set(row.assignment.principalId.toLowerCase(), row.assignment.principalName);
    }
    const swap = (a: AzureAssignment): AzureAssignment => {
        const label = labels.get(a.principalId.toLowerCase());
        return label !== undefined && a.principalType === "User" ? { ...a, principalName: label, principalUpn: undefined } : a;
    };

    // The rules of the settings name approvers and extra recipients: they are scrubbed too
    const settings = new Map<string, AzureSettingsOutcome>(base.settings);
    for (const pair of rolePairsOf(rows, source.scopes)) {
        const key = azurePolicyKey(pair.scopeId, pair.roleDefinitionId);
        const scrubbed = anonymised.outcomeOf(pair);
        if (scrubbed?.status === "loaded") settings.set(key, { status: "loaded", rules: scrubbed.rules });
    }
    return { stats: { ...base, assignments: base.assignments.map(swap), settings }, anonymisedIds: anonymised.ids };
}

/** The assignments behind an Easy to miss row: the Report rows of its patch, so the table and the count agree */
function matchingAssignments(stats: AzureDashboardInput, id: AzureEasyToMissId): { assignment: AzureAssignment; scope: AzureScope }[] {
    const byId = scopesById(stats.scopes);
    const isAbove = (a: AzureAssignment) => isAboveChosenScope(a, stats.chosenScopeId, byId);
    // The pairs of the dashboard are made from own assignments only, so the eligible pairs are too
    const context: AzureFilterContext = {
        definitions: stats.definitions,
        spTypes: stats.spTypes,
        settings: stats.settings,
        emergencyIds: stats.emergencyIds,
        eligiblePairs: eligiblePairsOf(stats.assignments.filter((a) => !isAbove(a))),
    };
    const filters = { ...EMPTY_AZURE_FILTERS, ...EASY_TO_MISS_PATCHES[id] };
    const nowMs = stats.now.getTime();
    const found: { assignment: AzureAssignment; scope: AzureScope }[] = [];
    for (const assignment of stats.assignments) {
        const scope = byId.get(assignment.scopeId.toLowerCase());
        if (!scope) continue;
        if (!matchesAzureFilters(assignment, scope, isAbove(assignment), filters, context, nowMs)) continue;
        found.push({ assignment, scope });
    }
    return found;
}

const byText = (x: string[], y: string[]): number => {
    for (let i = 0; i < x.length; i++) {
        const c = x[i].localeCompare(y[i], "en");
        if (c !== 0) return c;
    }
    return 0;
};

const ROLES_SHOWN = 3;

/**
 * The rows of a findings table, in the unit of its count: an assignment (permanent Owners, eligible without an end), a
 * principal (apps, managed identities, agents, guests) or a role × scope (nobody notified, only permanent).
 */
function findingTable(stats: AzureDashboardInput, id: AzureEasyToMissId): { columns: { label: string }[]; rows: string[][] } {
    const found = matchingAssignments(stats, id);
    if (id === "permanentOwners" || id === "eligibleWithoutEnd") {
        return { columns: [{ label: "Who" }, { label: "Role" }, { label: "Scope" }], rows: found.map((f) => [f.assignment.principalName, f.assignment.roleName, f.scope.name]).sort(byText) };
    }
    if (id === "nobodyNotified" || id === "onlyPermanent") {
        const pairs = new Map<string, string[]>();
        for (const f of found) pairs.set(azurePolicyKey(f.assignment.scopeId, f.assignment.roleDefinitionId), [f.assignment.roleName, f.scope.name]);
        return { columns: [{ label: "Role" }, { label: "Scope" }], rows: [...pairs.values()].sort(byText) };
    }
    const principals = new Map<string, { name: string; roles: Set<string> }>();
    for (const f of found) {
        const key = f.assignment.principalId.toLowerCase();
        const entry = principals.get(key) ?? { name: f.assignment.principalName, roles: new Set<string>() };
        entry.roles.add(`${f.assignment.roleName} \u00b7 ${f.scope.name}`);
        principals.set(key, entry);
    }
    const rows = [...principals.values()].map((e) => {
        const roles = [...e.roles].sort();
        const shown = roles.slice(0, ROLES_SHOWN).join(", ");
        return [e.name, roles.length > ROLES_SHOWN ? `${shown}, +${roles.length - ROLES_SHOWN}` : shown];
    });
    return { columns: [{ label: "Who" }, { label: "Roles" }], rows: rows.sort(byText) };
}

const KIND_TAGS_TO_SKIP = new Set(["emergency", "delegated"]);

/** Builds the report. Pure: same input and options, same report. */
export function buildAzureDashboardExportReport(input: AzureDashboardExportInput, options: AzureExportOptions): ExportReport {
    const isAnonymised = options.anonymise || options.audience === "management";
    const { stats, anonymisedIds } = prepare(input, options);
    const blocks = options.blocks;
    const notes: string[] = [];
    const byId = scopesById(stats.scopes);

    const header = {
        title: "PIM Manager Azure dashboard",
        tenant: input.meta.tenantName ?? input.meta.tenantId ?? "Unknown tenant",
        exportedAt: input.meta.exportedAt.toISOString(),
        dataReadAt: input.meta.dataReadAt ? input.meta.dataReadAt.toISOString() : null,
        counted: [
            input.scopeLine,
            input.includeInherited ? "Including inherited assignments" : "Without inherited assignments",
            input.includeDelegated ? "Delegated subscriptions counted" : "Delegated subscriptions left out",
        ],
        filter: options.applyFilter && input.filterSentence !== "" ? input.filterSentence : null,
        exporter: input.meta.exporter,
        version: input.meta.version,
        detail: options.detail,
        audience: options.audience,
        isAnonymised,
        environment: "Azure resources",
    };

    if (isAnonymised) notes.push("Names of people are replaced by Person 1, Person 2 and so on. Groups, apps, managed identities and agents keep their names.");

    // Settings that are not loaded or not readable: named, never counted as "no MFA" or "no approval"
    const activation = computeAzureActivation(stats);
    if (activation.notReadable > 0) {
        notes.push(`${plural(activation.notReadable, "role × scope has", "role × scope have")} settings that are not readable with the current access: they are left out of the settings numbers and charts.`);
    }
    // A failed read is in `unloaded` of the charts but is not loading: it is named on its own
    const failedPairs = countAzureFailedPairs(stats);
    if (failedPairs > 0) {
        notes.push(`${plural(failedPairs, "role × scope has", "role × scope have")} settings that could not be read: they are left out of the settings numbers and charts. Refresh the dashboard and export again.`);
    }
    if (activation.unloaded - failedPairs > 0) notes.push("Role settings were still loading at export: the numbers about settings are partial.");
    if (stats.spTypes === null) notes.push("The kinds of service principal could not be read: apps and managed identities are not told apart.");
    if (stats.scope === "privileged") notes.push("The settings numbers and the posture charts count privileged role × scope only.");

    // Key numbers
    let numbers: ExportReport["numbers"] = null;
    if (blocks.numbers) {
        const cards = computeAzureCards(stats);
        numbers = CARD_ORDER.map((id) => ({ label: CARD_LABELS[id], value: cards[id].value ?? "not loaded", note: cards[id].breakdown, isWarning: cards[id].isWarning }));
    }

    // Easy to miss
    const easy = computeAzureEasyToMiss(stats);
    const attention: ReportAttention[] = easy.filter((row) => row.count !== null && row.count > 0).map((row) => ({ label: row.label, count: row.count ?? 0, detail: row.detail }));

    const tables: ReportTable[] = [];
    const cap = (rows: string[][]) => rows.slice(0, FINDING_ROWS);
    const more = (total: number) => (total > FINDING_ROWS ? `${total - FINDING_ROWS} more. ${options.detail === "appendix" ? "All assignments are in the appendix." : "Export as CSV to see all."}` : undefined);

    if (blocks.findings && options.detail !== "summary") {
        for (const row of easy) {
            if (row.count === null || row.count <= 0) continue;
            const { columns, rows } = findingTable(stats, row.id);
            if (rows.length === 0) continue;
            tables.push({ id: row.id, block: "findings", title: row.label, count: rows.length, columns, rows: cap(rows), note: more(rows.length) });
        }
    }

    if (blocks.emergency && options.detail !== "summary" && stats.emergencyIds.size > 0) {
        const byAccount = new Map<string, { name: string; roles: Set<string>; kinds: Set<string> }>();
        for (const a of stats.assignments) {
            const id = a.principalId.toLowerCase();
            if (!stats.emergencyIds.has(id)) continue;
            const entry = byAccount.get(id) ?? { name: a.principalName, roles: new Set<string>(), kinds: new Set<string>() };
            entry.roles.add(`${a.roleName} · ${byId.get(a.scopeId.toLowerCase())?.name ?? a.scopeId}`);
            entry.kinds.add(a.state === "eligible" ? "eligible" : a.endDateTime === null ? "permanent" : "active");
            byAccount.set(id, entry);
        }
        const rows = [...byAccount.values()].map((e) => [e.name, [...e.kinds].sort().join(", "), [...e.roles].sort().join(", ")]).sort((x, y) => x[0].localeCompare(y[0], "en"));
        tables.push({ id: "emergency", block: "emergency", title: "Emergency access accounts", count: stats.emergencyIds.size, columns: [{ label: "Account" }, { label: "Access" }, { label: "Role × scope" }], rows, note: `${plural(stats.emergencyIds.size, "account is", "accounts are")} marked in PIM Manager and counted apart from permanent access.` });
    }

    if (blocks.accounts && options.detail !== "summary") {
        const accounts = computeAzureAccounts(stats, 8);
        if (accounts.length > 0) {
            tables.push({
                id: "accounts",
                block: "accounts",
                title: "Most privileged accounts",
                count: accounts.length,
                columns: [{ label: "Account" }, { label: "Kind" }, { label: stats.scope === "privileged" ? "Privileged roles" : "Roles", align: "right" }, { label: "Permanent", align: "right" }, { label: "Eligible", align: "right" }],
                rows: accounts.map((a) => [a.isEmergency ? `${a.name} (emergency)` : a.name, (a.tags ?? []).find((t) => !KIND_TAGS_TO_SKIP.has(t)) ?? "user", String(a.privilegedRoles), String(a.permanent), String(a.eligible)]),
            });
        }
        const approvers = computeAzureApprovers(stats, 8);
        if (approvers.approvers.length > 0) {
            tables.push({
                id: "approvers",
                block: "accounts",
                title: "Who approves",
                count: approvers.requiringApproval,
                columns: [{ label: "Approver" }, { label: "Kind" }, { label: "Role × scope", align: "right" }],
                rows: approvers.approvers.map((a) => [a.name, a.isGroup ? "group" : "user", String(a.roleCount)]),
                note: approvers.singleApproverRoles.length > 0 ? `${plural(approvers.singleApproverRoles.length, "role × scope has", "role × scope have")} a single approver.` : undefined,
            });
        }
    }

    if (blocks.rightNow && options.detail !== "summary") {
        const now = computeAzureRightNow({ ...stats, now: input.meta.exportedAt }, FINDING_ROWS);
        if (now.activatedCount > 0) {
            tables.push({ id: "activatedNow", block: "rightNow", title: "Activated now", count: now.activatedCount, columns: [{ label: "Who" }, { label: "Role × scope" }, { label: "Ends in", align: "right" }], rows: now.activated.map((r) => [r.who, r.what, formatEndsIn(r.msLeft)]), note: more(now.activatedCount) });
        }
        if (now.endingCount > 0) {
            tables.push({ id: "endingSoon", block: "rightNow", title: "Eligibility ending within 7 days", count: now.endingCount, columns: [{ label: "Who" }, { label: "Role × scope" }, { label: "Ends in", align: "right" }], rows: now.ending.map((r) => [r.who, r.what, `${daysUntil(r.msLeft)} ${daysUntil(r.msLeft) === 1 ? "day" : "days"}`]), note: more(now.endingCount) });
        }
    }

    // Alerts
    let alerts: ExportReport["alerts"] = null;
    if (blocks.alerts) {
        const subscriptionOf = (id: string) => byId.get(`/subscriptions/${id}`.toLowerCase());
        const isDelegated = (id: string) => {
            const scope = subscriptionOf(id);
            return scope !== undefined && isDelegatedScope(scope, stats.homeTenantId);
        };
        const shown = input.includeDelegated ? input.reads.alerts : new Map([...input.reads.alerts].filter(([id]) => !isDelegated(id)));
        const summary = summarizeAzureAlerts(shown, input.subscriptionName, isDelegated);
        alerts = { openCount: summary.rows.length, passedCount: summary.clear, rows: summary.rows.map((r) => ({ title: `${r.name} (${r.subscriptionName})`, severity: r.severity, affected: r.incidentCount })) };
        if (summary.notScanned > 0) notes.push(`${plural(summary.notScanned, "subscription has", "subscriptions have")} not been scanned by Microsoft yet, so no alerts are known there.`);
        if (summary.notReadable > 0) notes.push(`The alerts of ${plural(summary.notReadable, "subscription", "subscriptions")} could not be read, so they are not in this report.`);
    }

    // Charts: the same colours as the Entra export (`exportChartData.ts`)
    let charts: ReportChart[] | null = null;
    if (blocks.posture) {
        const access = computeAzureHasAccess(stats);
        const sum = (pick: (row: (typeof access.rows)[number]) => number) => access.rows.reduce((s, row) => s + pick(row), 0);
        const d = activation.durations;
        const defs: [string, string, ChartItem[]][] = [
            ["access", "Has access", [
                { name: "Permanent", value: sum((r) => r.permanent), color: "#f59e0b" },
                { name: "Eligible", value: sum((r) => r.eligible), color: "#10b981" },
                { name: "Active time-bound", value: sum((r) => r.activeTimeBound), color: "#3b82f6" },
            ]],
            ["level", "By level", [
                { name: "Management group", value: access.rows[0]?.total ?? 0, color: LEVEL_COLORS[0] },
                { name: "Subscription", value: access.rows[1]?.total ?? 0, color: LEVEL_COLORS[1] },
                { name: "Resource group", value: access.rows[2]?.total ?? 0, color: LEVEL_COLORS[2] },
                { name: "Resource", value: access.rows[3]?.total ?? 0, color: LEVEL_COLORS[3] },
            ]],
            ["mfa", "MFA and Conditional Access on activation", [
                { name: "Entra MFA", value: activation.entraMfa, color: "#3b82f6" },
                { name: "Authentication context", value: activation.authContext, color: "#8b5cf6" },
                { name: "Neither", value: activation.neither, color: "#6b7280" },
            ]],
            ["approval", "Approval requirements", [
                { name: "Approval required", value: activation.approvalRequired, color: "#8b5cf6" },
                { name: "No approval", value: activation.approvalNotRequired, color: "#6b7280" },
            ]],
            ["justification", "Justification requirements", [
                { name: "Justification required", value: activation.justificationRequired, color: "#3b82f6" },
                { name: "No justification", value: activation.justificationNotRequired, color: "#6b7280" },
            ]],
            ["duration", "Maximum activation duration", [
                { name: "<1h", value: d.upTo1h, color: "#10b981" },
                { name: "2-4h", value: d.upTo4h, color: "#22c55e" },
                { name: "5-8h", value: d.upTo8h, color: "#3b82f6" },
                { name: "9-12h", value: d.upTo12h, color: "#f59e0b" },
                { name: ">12h", value: d.over12h, color: "#ef4444" },
            ]],
        ];
        charts = defs
            .map(([id, title, items]) => ({ id, title, items: items.filter((i) => i.value > 0), total: items.reduce((s, i) => s + i.value, 0) }))
            .filter((c) => c.total > 0);
    }

    const appendix = options.detail === "appendix" && options.audience === "admin" ? buildAzureAppendixRows(toRows(stats.assignments, stats), stats.emergencyIds, anonymisedIds) : null;

    return { header, numbers, attention: blocks.attention ? attention : null, alerts, charts, tables, appendix, glossary: blocks.glossary ? AZURE_GLOSSARY : null, notes };
}

/** The appendix of the PDF: one row per assignment of the CSV rows, in the columns `ReportDocument` prints for Entra */
function buildAzureAppendixRows(rows: AzureAssignmentRow[], emergencyIds: ReadonlySet<string>, anonymisedIds: ReadonlySet<string> | undefined): AssignmentExportRow[] {
    const day = (value: string | null | undefined): string => (value ? value.slice(0, 10) : "");
    return rows.map((row) => {
        const a = row.assignment;
        const memberType = a.isViaGroup ? "Group" : row.isInherited ? "Inherited" : "Direct";
        return {
            workload: AZURE_WORKLOAD,
            resource: a.roleName,
            access: "",
            type: a.state === "eligible" ? "Eligible" : a.endDateTime === null && !a.isActivated ? "Permanent" : "Active",
            name: a.principalName,
            upn: a.principalUpn ?? "",
            objectId: anonymisedIds?.has(a.principalId.toLowerCase()) ? "" : a.principalId,
            kind: row.principalTypeLabel,
            memberType,
            start: day(a.startDateTime),
            end: day(a.endDateTime),
            scope: `${row.scope.name} (${SCOPE_LEVEL_LABELS[row.scope.level]})`,
            resourceId: a.roleDefinitionId,
            privileged: AZURE_PRIVILEGED_ROLE_IDS.has(a.roleDefinitionId.toLowerCase()),
            emergency: emergencyIds.has(a.principalId.toLowerCase()),
            origin: a.state === "eligible" ? "" : a.isActivated ? "Activated" : "Assigned",
        };
    });
}

/** Rows for the CSV export: the same selection (filter, names) as the PDF would use, in the columns of the Azure Report's assignments file */
export function buildAzureDashboardCsvRows(input: AzureDashboardExportInput, options: AzureExportOptions, homeTenantId?: string): ExportRow[] {
    const { stats, anonymisedIds } = prepare(input, options);
    const rows = toRows(stats.assignments, stats);
    return buildAzureAssignmentRows(rows, { scopes: stats.scopes, emergencyIds: stats.emergencyIds, homeTenantId: homeTenantId ?? stats.homeTenantId, anonymisedIds });
}

export function azureExportFileStem(tenant: string | null, date: Date): string {
    const slug = (tenant ?? "tenant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
    return `pim-azure-dashboard-${slug}-${date.toISOString().slice(0, 10)}`;
}
