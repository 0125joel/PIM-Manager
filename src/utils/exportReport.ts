import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { SecurityAlert } from "@/types/securityAlerts.types";
import type { AuthenticationContext } from "@/utils/authContextApi";
import { buildKindById, buildNameById, buildFilterNames, buildRoleAssignmentFacts, getFilterLabels } from "@/utils/dashboardFilter";
import { buildStatsView, type CountingState } from "@/utils/dashboardView";
import { computeCards, computeEasyToMiss, computeTerms, GLOBAL_ADMINISTRATOR_TEMPLATE_ID, getEffectiveDashboardFilter, type CardId } from "@/utils/dashboardStats";
import { computeApprovers, computeCustomExtensionRows, computeGroupsSection, computeRightNow, computeTopAccounts, daysUntil, formatEndsIn } from "@/utils/dashboardAdvanced";
import { buildExportChartData, type ChartItem } from "@/utils/exportChartData";
import { anonymisePeople } from "@/utils/exportAnonymise";
import { buildAssignmentRows, type AssignmentExportRow } from "@/utils/exportRows";
import { getGroupsOutsidePim } from "@/utils/groupsOutsidePim";
import { summarizeAlerts } from "@/utils/alertSummary";
import { formatDuration } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";
import { getPrincipalKindLabel } from "@/utils/principalUtils";

/**
 * The content of the PDF export as plain data (spec 3.5). The same functions as the dashboard produce every number,
 * so the document says what the screen says. The renderer in `components/pdf` only draws this model.
 */

export type ExportDetail = "summary" | "full" | "appendix";
export type ExportAudience = "management" | "admin";
export type ChartStyle = "bars" | "donuts" | "tables";

export type ExportBlockKey = "numbers" | "attention" | "alerts" | "posture" | "findings" | "groups" | "emergency" | "extensions" | "accounts" | "rightNow" | "glossary";

export const EXPORT_BLOCKS: { key: ExportBlockKey; label: string; hint: string }[] = [
    { key: "numbers", label: "Key numbers", hint: "The eight cards of the dashboard" },
    { key: "attention", label: "What needs attention", hint: "Easy to miss, with the details" },
    { key: "alerts", label: "Security alerts", hint: "From Microsoft" },
    { key: "posture", label: "Posture charts", hint: "Assignments, method, MFA, approval, duration, authentication contexts, groups" },
    { key: "findings", label: "Findings", hint: "The roles, groups and accounts behind each item" },
    { key: "groups", label: "PIM for Groups", hint: "Groups outside PIM and the busiest managed groups" },
    { key: "emergency", label: "Emergency access accounts", hint: "Marked accounts and the roles they hold" },
    { key: "extensions", label: "Custom extensions", hint: "Preview: callouts linked to activation" },
    { key: "accounts", label: "Accounts and approvers", hint: "Most privileged accounts, who approves" },
    { key: "rightNow", label: "Right now", hint: "Activated now, eligibility ending within 7 days" },
    { key: "glossary", label: "How the numbers are counted", hint: "One line per number" },
];

const SUMMARY_BLOCKS: ExportBlockKey[] = ["numbers", "attention", "alerts", "posture"];

export function defaultBlocks(detail: ExportDetail): Record<ExportBlockKey, boolean> {
    const result = {} as Record<ExportBlockKey, boolean>;
    for (const { key } of EXPORT_BLOCKS) result[key] = detail !== "summary" || SUMMARY_BLOCKS.includes(key);
    return result;
}

export interface ExportOptions {
    detail: ExportDetail;
    audience: ExportAudience;
    chartStyle: ChartStyle;
    /** Replace the names of people by "Person n". Always on for the management audience */
    anonymise: boolean;
    applyFilter: boolean;
    counting: CountingState & { securityAlerts: boolean };
    blocks: Record<ExportBlockKey, boolean>;
}

export interface ExportInput {
    rolesData: RoleDetailData[];
    /** Onboarded and unmanaged groups */
    groupsData: PimGroupData[];
    filter: DashboardFilter;
    emergencyAccountIds: ReadonlySet<string>;
    authenticationContexts?: AuthenticationContext[];
    /** null: the alerts could not be read (no consent or a failure) */
    alerts: SecurityAlert[] | null;
    dismissedAlertIds?: ReadonlySet<string>;
    tenantExtensionIds: ReadonlySet<string> | null;
    policiesLoading: boolean;
    meta: { tenantName: string | null; tenantId?: string; exporter: string; version: string; dataReadAt?: Date; exportedAt: Date };
}

export interface ReportHeader {
    title: string;
    tenant: string;
    exportedAt: string;
    dataReadAt: string | null;
    counted: string[];
    filter: string | null;
    exporter: string;
    version: string;
    detail: ExportDetail;
    audience: ExportAudience;
    isAnonymised: boolean;
}

export interface ReportNumber {
    label: string;
    value: string;
    note: string;
    isWarning: boolean;
}

export interface ReportAttention {
    label: string;
    count: number;
    detail: string;
}

export interface ReportChart {
    id: string;
    title: string;
    items: ChartItem[];
    total: number;
}

export interface ReportTable {
    id: string;
    block: ExportBlockKey | "appendix";
    title: string;
    /** Rows in the whole set; `rows` holds the first part of it */
    count: number;
    columns: { label: string; align?: "right" }[];
    rows: string[][];
    note?: string;
    fix?: { text: string; url?: string };
}

export interface ReportAlerts {
    openCount: number;
    passedCount: number;
    rows: { title: string; severity: string; affected: number }[];
}

export interface ExportReport {
    header: ReportHeader;
    numbers: ReportNumber[] | null;
    attention: ReportAttention[] | null;
    alerts: ReportAlerts | null;
    charts: ReportChart[] | null;
    tables: ReportTable[];
    appendix: AssignmentExportRow[] | null;
    glossary: { term: string; text: string }[] | null;
    /** Sentences about what is missing from the document and why */
    notes: string[];
}

const FINDING_ROWS = 10;
const CARD_LABELS: Record<CardId, string> = {
    rolesAndGroups: "Roles and groups",
    activeNow: "Active now",
    permanent: "Permanent",
    eligible: "Eligible",
    privileged: "Privileged roles",
    requireApproval: "Require approval",
    customRoles: "Custom roles",
    groupsUnderPim: "Groups under PIM",
};
const CARD_ORDER: CardId[] = ["rolesAndGroups", "activeNow", "permanent", "eligible", "privileged", "requireApproval", "customRoles", "groupsUnderPim"];

export const GLOSSARY: { term: string; text: string }[] = [
    { term: "Roles and groups", text: "Directory roles plus the groups onboarded to PIM that are counted." },
    { term: "Permanent", text: "Active assignments an administrator made without an end date. Marked emergency access accounts are counted apart." },
    { term: "Eligible", text: "Eligibility schedules: access that needs an activation first." },
    { term: "Active now", text: "Assignments that exist because someone activated an eligibility and that have not ended." },
    { term: "Privileged roles", text: "Roles Microsoft marks as privileged. With the All roles scope every role counts." },
    { term: "No MFA on activation", text: "Privileged roles whose policy asks for neither Entra MFA nor an authentication context on activation. Roles whose policy is not loaded are not counted." },
    { term: "Nobody notified", text: "Privileged roles whose activation notification has no default recipients and no extra recipients." },
    { term: "Groups outside PIM", text: "Role-assignable groups that PIM for Groups does not manage. Their members hold the group's roles without activation." },
    { term: "Filter", text: "A filter changes every number and table it is about. The header names the filter that was active at export." },
];

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/** Builds the report. Pure: same input and options, same report. */
export function buildExportReport(input: ExportInput, options: ExportOptions): ExportReport {
    const isAnonymised = options.anonymise || options.audience === "management";
    const anonymised = isAnonymised ? anonymisePeople(input.rolesData, input.groupsData) : null;
    const rolesData = anonymised?.roles ?? input.rolesData;
    const groupsData = anonymised?.groups ?? input.groupsData;
    const effective = options.applyFilter ? getEffectiveDashboardFilter(input.filter) : {};
    const counting = options.counting;
    const view = buildStatsView({ rolesData, groupsData, counting, effective, policiesLoading: input.policiesLoading, emergencyAccountIds: input.emergencyAccountIds, scope: "privileged" });
    const notes: string[] = [];
    const blocks = options.blocks;

    const counted = [counting.directoryRoles && "Directory roles", counting.pimGroups && "PIM for Groups", counting.pimGroups && counting.unmanagedGroups && "Groups outside PIM", counting.securityAlerts && "Security alerts"].filter((x): x is string => !!x);
    const filterText = view.isFiltered ? getFilterLabels(effective, buildFilterNames(rolesData)).map((l) => l.label).join(", ") : null;
    const header: ReportHeader = {
        title: "Privileged access report",
        tenant: input.meta.tenantName ?? input.meta.tenantId ?? "Unknown tenant",
        exportedAt: input.meta.exportedAt.toISOString(),
        dataReadAt: input.meta.dataReadAt ? input.meta.dataReadAt.toISOString() : null,
        counted,
        filter: filterText,
        exporter: input.meta.exporter,
        version: input.meta.version,
        detail: options.detail,
        audience: options.audience,
        isAnonymised,
    };
    if (isAnonymised) notes.push("Names of people are replaced by Person 1, Person 2 and so on. Groups, apps and roles keep their names.");
    if (input.policiesLoading) notes.push("Policies were still loading at export: the numbers about policies are partial.");
    // FIX-11, FIX-12: a role or group whose policy Graph would not show is named, not counted as "no MFA" or "no approval"
    // A policy filter has already taken them out of the view: then the view's own count says how many it left out
    const rolesNotReadable = view.notReadableRoleCount + view.roles.filter((r) => r.policiesForbidden).length;
    const groupsNotReadable = view.notReadableGroupCount + view.groups.filter((g) => g.policiesForbidden).length;
    if (rolesNotReadable + groupsNotReadable > 0) {
        const parts = [rolesNotReadable > 0 && `${rolesNotReadable} ${rolesNotReadable === 1 ? "role" : "roles"}`, groupsNotReadable > 0 && `${groupsNotReadable} ${groupsNotReadable === 1 ? "group" : "groups"}`].filter(Boolean).join(" and ");
        notes.push(`${parts} ${rolesNotReadable + groupsNotReadable === 1 ? "has" : "have"} settings that are not readable with the current access: they say "Not readable" in the settings rows and are left out of the settings charts.`);
    }

    // Key numbers
    let numbers: ReportNumber[] | null = null;
    if (blocks.numbers) {
        const cards = computeCards(view.input);
        numbers = CARD_ORDER.map((id) => ({ label: CARD_LABELS[id], value: cards[id].value ?? "not loaded", note: cards[id].breakdown, isWarning: cards[id].isWarning }));
    }

    // Findings tables come from one pass; the attention list and the findings share it
    const roleInput = view.roleLevelInput;
    const easy = computeEasyToMiss(roleInput);
    const terms = counting.directoryRoles ? computeTerms(roleInput) : null;
    const outside = counting.pimGroups && counting.unmanagedGroups ? getGroupsOutsidePim(groupsData, rolesData) : [];
    const kindById = buildKindById(view.roles);
    const nameById = buildNameById(rolesData);

    const attention: ReportAttention[] = [];
    for (const row of easy) {
        if (row.count === null || row.count <= 0) continue;
        // The management report names no one, so the list of names gives way to its own sentence
        const emergencySentence = row.detail.match(/The \d+ emergency access accounts? (?:is|are) not counted\./)?.[0];
        const detail = options.audience === "management" && row.id === "permanentGlobalAdmins" ? ["Names are left out of this report.", emergencySentence].filter(Boolean).join(" ") : row.detail;
        attention.push({ label: row.label, count: row.count, detail });
    }
    if (terms && !terms.isPending && terms.neither > 0) attention.push({ label: "Privileged roles activate without MFA", count: terms.neither, detail: "A password alone is enough. Require Entra MFA or an authentication context." });
    if (outside.length > 0) attention.push({ label: "Role-assignable groups outside PIM", count: outside.length, detail: "Members hold the group's roles permanently." });

    const tables: ReportTable[] = [];
    const cap = (rows: string[][]) => rows.slice(0, FINDING_ROWS);
    const more = (total: number) => (total > FINDING_ROWS ? `${total - FINDING_ROWS} more. ${options.detail === "appendix" ? "All assignments are in the appendix." : "Export with the appendix or as CSV to see all."}` : undefined);

    if (blocks.findings && options.detail !== "summary") {
        const privileged = view.roles.filter((r) => r.definition.isPrivileged === true);
        const globalAdmin: string[][] = [];
        const eligibleNoEnd: string[][] = [];
        const apps = new Map<string, { name: string; roles: Set<string> }>();
        const guests = new Map<string, { name: string; roles: Set<string> }>();
        for (const role of view.roles) {
            const isGlobalAdmin = role.definition.templateId?.toLowerCase() === GLOBAL_ADMINISTRATOR_TEMPLATE_ID;
            for (const fact of buildRoleAssignmentFacts(role, kindById, nameById)) {
                const id = fact.principalId.toLowerCase();
                const name = fact.displayName ?? `Unknown (${fact.principalId.slice(0, 8)})`;
                if (isGlobalAdmin && fact.isPermanent && !input.emergencyAccountIds.has(id)) globalAdmin.push([name, role.definition.displayName, getPrincipalKindLabel(fact.kind)]);
                if (fact.isEligibleWithoutEnd) eligibleNoEnd.push([name, role.definition.displayName]);
                const collect = (map: Map<string, { name: string; roles: Set<string> }>) => {
                    const entry = map.get(id) ?? { name, roles: new Set<string>() };
                    entry.roles.add(role.definition.displayName);
                    map.set(id, entry);
                };
                if (role.definition.isPrivileged === true && fact.kind === "servicePrincipal") collect(apps);
                if (fact.isGuest) collect(guests);
            }
        }
        for (const data of view.groups) {
            for (const a of data.assignments) {
                if (a.assignmentType === "eligible" && !a.endDateTime) eligibleNoEnd.push([a.principal?.displayName ?? nameById.get(a.principalId.toLowerCase()) ?? `Unknown (${a.principalId.slice(0, 8)})`, `${data.group.displayName}, ${a.accessType}`]);
            }
        }
        const people = (map: Map<string, { name: string; roles: Set<string> }>) => [...map.values()].map((e) => [e.name, [...e.roles].sort().join(", ")]).sort((a, b) => a[0].localeCompare(b[0]));
        const add = (table: Omit<ReportTable, "block" | "count" | "rows"> & { rows: string[][] }) => {
            if (table.rows.length === 0) return;
            tables.push({ ...table, block: "findings", count: table.rows.length, rows: cap(table.rows), note: more(table.rows.length) });
        };
        add({ id: "permanentGlobalAdmins", title: "Permanent Global Administrators", columns: [{ label: "Who" }, { label: "Role" }, { label: "Kind" }], rows: globalAdmin.sort((a, b) => a[0].localeCompare(b[0])), fix: { text: "Make the assignment eligible so it needs an activation, and keep two emergency access accounts apart.", url: "https://learn.microsoft.com/entra/id-governance/privileged-identity-management/pim-configure" } });
        add({ id: "eligibleWithoutEnd", title: "Eligible without an end date", columns: [{ label: "Who" }, { label: "Role or group" }], rows: eligibleNoEnd.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])) });
        add({ id: "apps", title: "Apps with a privileged role", columns: [{ label: "App" }, { label: "Roles" }], rows: people(apps) });
        add({ id: "guests", title: "Guests with a role", columns: [{ label: "Who" }, { label: "Roles" }], rows: people(guests) });
        const noMfa = privileged.filter((r) => {
            const s = summarizePolicyRules(r.policy?.details?.rules);
            return s.isLoaded && !s.hasPimMfa && !s.hasAuthContext;
        });
        add({
            id: "noMfa",
            title: "Privileged roles that activate without MFA",
            columns: [{ label: "Role" }, { label: "Eligible", align: "right" }, { label: "Approval" }, { label: "Max duration", align: "right" }],
            rows: noMfa.map((r) => {
                const s = summarizePolicyRules(r.policy?.details?.rules);
                return [r.definition.displayName, String(r.assignments.eligible.length), s.isApprovalRequired ? "yes" : "no", s.maxDuration ? formatDuration(s.maxDuration) : "unknown"];
            }).sort((a, b) => a[0].localeCompare(b[0])),
            fix: { text: "Require Entra MFA on activation, or link an authentication context so Conditional Access decides.", url: "https://learn.microsoft.com/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings" },
        });
        const silent = privileged.filter((r) => {
            const rule = summarizePolicyRules(r.policy?.details?.rules).activationNotification;
            return rule !== undefined && !rule.isDefaultRecipientsEnabled && rule.notificationRecipients.length === 0;
        });
        add({ id: "nobodyNotified", title: "Privileged roles where nobody is notified", columns: [{ label: "Role" }, { label: "Eligible", align: "right" }], rows: silent.map((r) => [r.definition.displayName, String(r.assignments.eligible.length)]).sort((a, b) => a[0].localeCompare(b[0])), fix: { text: "Turn on the default recipients or add a mailbox that someone reads." } });
        const onlyPermanent = privileged.filter((r) => r.assignments.eligible.length === 0 && buildRoleAssignmentFacts(r, kindById, nameById).some((f) => f.isPermanent));
        add({ id: "onlyPermanent", title: "Privileged roles with only permanent members", columns: [{ label: "Role" }], rows: onlyPermanent.map((r) => [r.definition.displayName]).sort((a, b) => a[0].localeCompare(b[0])) });
    }

    if (blocks.groups && options.detail !== "summary" && counting.pimGroups) {
        if (counting.unmanagedGroups) {
            const rows = outside.map((g) => [g.name, g.holds.length > 0 ? g.holds.join(", ") : "none", g.memberCount === undefined ? "not read" : String(g.memberCount)]);
            if (rows.length > 0) tables.push({ id: "groupsOutside", block: "groups", title: "Role-assignable groups outside PIM", count: rows.length, columns: [{ label: "Group" }, { label: "Holds roles" }, { label: "Members", align: "right" }], rows: cap(rows), note: more(rows.length), fix: { text: "Bring the group under PIM so its members activate the roles they need." } });
        }
        const section = computeGroupsSection(groupsData, 8);
        if (section.topManaged.length > 0) {
            tables.push({ id: "topGroups", block: "groups", title: "Busiest groups under PIM", count: section.managedCount, columns: [{ label: "Group" }, { label: "Members eligible", align: "right" }, { label: "Members active", align: "right" }, { label: "Owners eligible", align: "right" }, { label: "Permanent", align: "right" }], rows: section.topManaged.map((g) => [g.name, String(g.membersEligible), String(g.membersActive), String(g.ownersEligible), String(g.permanent)]) });
        }
    }

    if (blocks.emergency && options.detail !== "summary" && input.emergencyAccountIds.size > 0) {
        const byAccount = new Map<string, { name: string; roles: Set<string>; kinds: Set<string> }>();
        for (const role of rolesData) {
            for (const fact of buildRoleAssignmentFacts(role, buildKindById(rolesData), nameById)) {
                const id = fact.principalId.toLowerCase();
                if (!input.emergencyAccountIds.has(id)) continue;
                const entry = byAccount.get(id) ?? { name: fact.displayName ?? `Unknown (${fact.principalId.slice(0, 8)})`, roles: new Set<string>(), kinds: new Set<string>() };
                entry.roles.add(role.definition.displayName);
                entry.kinds.add(fact.isPermanent ? "permanent" : fact.isEligible ? "eligible" : "active");
                byAccount.set(id, entry);
            }
        }
        const rows = [...byAccount.values()].map((e) => [e.name, [...e.kinds].sort().join(", "), [...e.roles].sort().join(", ")]).sort((a, b) => a[0].localeCompare(b[0]));
        tables.push({ id: "emergency", block: "emergency", title: "Emergency access accounts", count: input.emergencyAccountIds.size, columns: [{ label: "Account" }, { label: "Access" }, { label: "Roles" }], rows, note: `${plural(input.emergencyAccountIds.size, "account is", "accounts are")} marked in PIM Manager and counted apart from permanent access.` });
    }

    if (blocks.extensions && options.detail !== "summary" && counting.directoryRoles) {
        const rows = computeCustomExtensionRows(view.roles, input.tenantExtensionIds).map((r) => [r.name, r.stage, String(r.roleCount), r.isNotFound ? `Not found in the tenant${r.blockedRoles.length > 0 ? `, blocks ${plural(r.blockedRoles.length, "role", "roles")}` : ""}` : "ok"]);
        if (rows.length > 0) tables.push({ id: "extensions", block: "extensions", title: "Custom extensions (Preview)", count: rows.length, columns: [{ label: "Extension" }, { label: "Stage" }, { label: "Roles", align: "right" }, { label: "Status" }], rows });
    }

    if (blocks.accounts && options.detail !== "summary" && counting.directoryRoles) {
        const accounts = computeTopAccounts(view.roles, "privileged", input.emergencyAccountIds, 8);
        if (accounts.length > 0) tables.push({ id: "accounts", block: "accounts", title: "Most privileged accounts", count: accounts.length, columns: [{ label: "Account" }, { label: "Kind" }, { label: "Privileged roles", align: "right" }, { label: "Permanent", align: "right" }, { label: "Eligible", align: "right" }], rows: accounts.map((a) => [a.isEmergency ? `${a.name} (emergency)` : a.name, getPrincipalKindLabel(a.kind), String(a.privilegedRoles), String(a.permanent), String(a.eligible)]) });
        const approvers = computeApprovers(view.roles, "privileged", 8);
        if (approvers.approvers.length > 0) tables.push({ id: "approvers", block: "accounts", title: "Who approves", count: approvers.requiringApproval, columns: [{ label: "Approver" }, { label: "Kind" }, { label: "Roles", align: "right" }], rows: approvers.approvers.map((a) => [a.name, a.isGroup ? "group" : "user", String(a.roleCount)]), note: approvers.singleApproverRoles.length > 0 ? `${plural(approvers.singleApproverRoles.length, "role has", "roles have")} a single approver.` : undefined });
    }

    if (blocks.rightNow && options.detail !== "summary") {
        const now = computeRightNow(view.roles, view.groups, input.meta.exportedAt, 10);
        if (now.activatedCount > 0) tables.push({ id: "activatedNow", block: "rightNow", title: "Activated now", count: now.activatedCount, columns: [{ label: "Who" }, { label: "Role or group" }, { label: "Ends in", align: "right" }], rows: now.activated.map((r) => [r.who, r.what, formatEndsIn(r.msLeft)]), note: more(now.activatedCount) });
        if (now.endingCount > 0) tables.push({ id: "endingSoon", block: "rightNow", title: "Eligibility ending within 7 days", count: now.endingCount, columns: [{ label: "Who" }, { label: "Role or group" }, { label: "Ends in", align: "right" }], rows: now.ending.map((r) => [r.who, r.what, `${daysUntil(r.msLeft)} ${daysUntil(r.msLeft) === 1 ? "day" : "days"}`]), note: more(now.endingCount) });
    }

    // Alerts
    let alerts: ReportAlerts | null = null;
    if (blocks.alerts && counting.securityAlerts) {
        if (input.alerts === null) notes.push("Security alerts could not be read, so they are not in this report.");
        else {
            const summary = summarizeAlerts(input.alerts, input.dismissedAlertIds ?? new Set());
            alerts = { openCount: summary.openCount, passedCount: summary.passedCount, rows: summary.rows.map((r) => ({ title: r.title, severity: r.severity, affected: r.affected })) };
        }
    }

    // Charts
    let charts: ReportChart[] | null = null;
    if (blocks.posture) {
        const data = buildExportChartData({ rolesData: view.roles, groupsData: view.groups, isDirectoryRolesCounted: counting.directoryRoles, isPimGroupsCounted: counting.pimGroups, authenticationContexts: input.authenticationContexts });
        const defs: [string, string, ChartItem[]][] = [
            ["assignment", "Assignment distribution", data.assignmentData],
            ["memberType", "Assignment method", data.assignmentMethodData],
            ["mfa", "MFA and Conditional Access on activation", data.mfaData],
            ["approval", "Approval requirements", data.approvalData],
            ["duration", "Maximum activation duration", data.durationData],
            ["authContexts", "Authentication contexts", data.authContextData],
            ["managedGroups", "PIM for Groups coverage", [
                { name: "Managed", value: groupsData.filter((g) => g.isManaged !== false).length, color: "#10b981" },
                { name: "Unmanaged", value: groupsData.filter((g) => g.isManaged === false).length, color: "#ef4444" },
            ]],
        ];
        charts = defs
            .map(([id, title, items]) => ({ id, title, items: items.filter((i) => i.value > 0), total: items.reduce((s, i) => s + i.value, 0) }))
            .filter((c) => c.total > 0 && !(c.id === "managedGroups" && !(counting.pimGroups && counting.unmanagedGroups)));
    }

    const appendix = options.detail === "appendix" && options.audience === "admin" ? buildAssignmentRows(view.roles, view.groups, { anonymisedIds: anonymised?.ids }) : null;

    return { header, numbers, attention: blocks.attention ? attention : null, alerts, charts, tables, appendix, glossary: blocks.glossary ? GLOSSARY : null, notes };
}

/** Rows for the CSV export: the same selection (filter, workloads, names) as the PDF would use. */
export function buildExportRows(input: ExportInput, options: ExportOptions): AssignmentExportRow[] {
    const isAnonymised = options.anonymise || options.audience === "management";
    const anonymised = isAnonymised ? anonymisePeople(input.rolesData, input.groupsData) : null;
    const rolesData = anonymised?.roles ?? input.rolesData;
    const groupsData = anonymised?.groups ?? input.groupsData;
    const effective = options.applyFilter ? getEffectiveDashboardFilter(input.filter) : {};
    const view = buildStatsView({ rolesData, groupsData, counting: options.counting, effective, policiesLoading: input.policiesLoading, emergencyAccountIds: input.emergencyAccountIds, scope: "privileged" });
    return buildAssignmentRows(view.roles, view.groups, { anonymisedIds: anonymised?.ids, emergencyIds: input.emergencyAccountIds });
}
