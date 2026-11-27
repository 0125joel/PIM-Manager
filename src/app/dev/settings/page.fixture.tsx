"use client";

import { Suspense, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import { FIXTURES_ENABLED } from "@/config/fixtures";
import { useTheme } from "@/components/ThemeProvider";
import { ShellFrame, type ShellMenu } from "@/components/shell/ShellFrame";
import { SettingsView } from "@/app/settings/components/SettingsView";
import type { SettingsViewProps, WorkspaceListItem, WorkspaceProps, WorkspaceStatusItem, WorkspaceStep } from "@/app/settings/components/settingsTypes";
import type { PermissionRow } from "@/hooks/useWorkloadPermissions";
import { keepsText, workspaceLogLines, workspaceSummaryText, type SubscriptionFact } from "@/utils/auditWorkspaceView";
import type { WorkspaceCheck, WorkspaceLogsCheck } from "@/utils/auditWorkspaceStatus";

/**
 * The Settings page with invented data and no sign-in, for the Log Analytics workspace section (AU-9, AU-18). The `.fixture.tsx`
 * extension keeps it out of a normal build (`NEXT_PUBLIC_FIXTURES=1`, as `npm run visual` builds it). Query parameter `ws` =
 * none | azure | list | nolist | manual | consent | checking | chosen | both | noactivity | subs | nologs | denied | failed.
 * `chosen` is the same as `both`.
 */
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;
const noop = () => undefined;

const ROWS: PermissionRow[] = [
    { id: "directoryRoles", label: "Entra roles", read: "granted", write: "granted", action: null },
    { id: "auditLog", label: "Audit log", read: "granted", write: "readOnly", action: null },
    { id: "logAnalytics", label: "Log Analytics", read: "notAsked", write: "readOnly", action: null, note: "Asked when you choose a workspace" },
];

const LIST: WorkspaceListItem[] = [
    { customerId: "w1", name: "law-contoso-entra", where: "Contoso-Security, West Europe. Keeps logs 180 days.", receivesEntraLogs: true, receivesActivityLogs: false, isSelected: true },
    { customerId: "w2", name: "law-contoso-activity", where: "Contoso-Security, West Europe. Keeps logs 365 days.", receivesEntraLogs: false, receivesActivityLogs: true, isSelected: true },
    { customerId: "w3", name: "law-contoso-apps", where: "Contoso-Apps, North Europe. Keeps logs 30 days.", receivesEntraLogs: false, receivesActivityLogs: false, isSelected: false },
];

/** The subscriptions the reader can see, invented; the activity log of the workspace below comes from the first two */
const SUBSCRIPTIONS: SubscriptionFact[] = [
    { id: "sub-production", name: "Contoso Production" },
    { id: "sub-test", name: "Contoso Test" },
    { id: "sub-labs", name: "Contoso Labs" },
];

const ENTRA_CONNECTED: WorkspaceCheck = { kind: "connected", oldest: "2026-05-12T10:00:00Z", newest: "2026-11-05T11:00:00Z" };
const AZURE_CONNECTED: WorkspaceCheck = { kind: "connected", oldest: "2025-11-09T10:00:00Z", newest: "2026-11-05T11:00:00Z" };
const NO_LOGS: WorkspaceCheck = { kind: "noLogs" };

interface FixtureRow {
    name: string;
    retentionDays?: number;
    logs: WorkspaceLogsCheck;
}

/** The status and summary of invented workspaces, built by the same functions as the app */
function statusesOf(rows: FixtureRow[], subscriptions: SubscriptionFact[] | null): { items: WorkspaceStatusItem[]; summary: WorkspaceProps["summary"] } {
    const items = rows.map((row, index): WorkspaceStatusItem => {
        const others = rows.filter((other) => other !== row).map((other) => ({ name: other.name, logs: other.logs, isListedBefore: rows.indexOf(other) < index }));
        const name = row.retentionDays === undefined ? row.name : `${row.name}. ${keepsText(row.retentionDays)}`;
        return { customerId: `s${index}`, name, lines: workspaceLogLines(row.logs, others, { subscriptions }, FORMAT) };
    });
    return { items, summary: workspaceSummaryText(rows.map((row) => row.logs), subscriptions?.map((s) => s.id) ?? null, FORMAT) };
}

function workspaceProps(ws: string): WorkspaceProps {
    const base: WorkspaceProps = {
        tenantLabel: "Contoso", step: "none", items: LIST, failedSubscriptions: [], listError: null, selectedCount: 2, manualDraft: "", manualError: null,
        consentMessage: null, isBusy: false, summary: null, statuses: [], checkedLine: null,
        onChoose: noop, onGrantAzure: noop, onToggle: noop, onShowManual: noop, onManualChange: noop, onUse: noop, onGrantLogAnalytics: noop,
        onCancel: noop, onRetryList: noop, onCheckAgain: noop, onRemoveAll: noop,
    };
    const checkedLine = "Checked 5 Nov 2026, 12:00 UTC. Access is your own: a colleague may see this differently. A workspace shows what it holds, also on scopes your Azure roles do not reach.";
    const step = (s: WorkspaceStep): WorkspaceProps => ({ ...base, step: s });
    const chosen = (rows: FixtureRow[], subscriptions: SubscriptionFact[] | null = SUBSCRIPTIONS): WorkspaceProps => {
        const s = statusesOf(rows, subscriptions);
        return { ...step("chosen"), statuses: s.items, summary: s.summary, checkedLine };
    };
    const ENTRA_WORKSPACE: FixtureRow = { name: "law-contoso-entra", retentionDays: 180, logs: { entra: ENTRA_CONNECTED, azure: NO_LOGS, subscriptionIds: [] } };
    switch (ws) {
        case "azure": return step("azure");
        case "list": return { ...step("list"), failedSubscriptions: ["Contoso Corp Apps"] };
        case "nolist": return { ...step("nolist"), items: [], failedSubscriptions: ["Contoso Corp Apps"] };
        case "manual": return { ...step("manual"), manualDraft: "not-an-id", manualError: "That is not a workspace ID. It is a GUID such as 00000000-0000-0000-0000-000000000000, shown on the Overview page of the workspace." };
        case "consent": return step("consent");
        case "checking": return step("checking");
        case "both":
        case "chosen":
            return chosen([
                { ...ENTRA_WORKSPACE, logs: { entra: ENTRA_CONNECTED, azure: NO_LOGS, subscriptionIds: [] } },
                { name: "law-contoso-activity", retentionDays: 365, logs: { entra: NO_LOGS, azure: AZURE_CONNECTED, subscriptionIds: ["sub-production", "sub-test", "sub-labs"] } },
            ]);
        case "noactivity":
            return chosen([ENTRA_WORKSPACE]);
        case "subs":
            return chosen([
                ENTRA_WORKSPACE,
                { name: "law-contoso-activity", retentionDays: 365, logs: { entra: NO_LOGS, azure: AZURE_CONNECTED, subscriptionIds: ["sub-production", "sub-test"] } },
            ]);
        case "nologs":
            return chosen([
                ENTRA_WORKSPACE,
                { name: "law-contoso-sec", retentionDays: 90, logs: { entra: NO_LOGS, azure: NO_LOGS, subscriptionIds: [] } },
            ]);
        case "denied":
            return chosen([
                ENTRA_WORKSPACE,
                { name: "law-contoso-activity", retentionDays: 365, logs: { entra: NO_LOGS, azure: { kind: "noAccess", status: 403 }, subscriptionIds: [] } },
            ]);
        case "failed":
            return chosen([
                { name: "law-contoso-entra", retentionDays: 180, logs: { entra: { kind: "failed", detail: "HTTP 400 BadArgumentError" }, azure: { kind: "failed", detail: "HTTP 400 BadArgumentError" }, subscriptionIds: [] } },
            ]);
        default: return base;
    }
}

function SettingsFixture() {
    const { theme, setTheme } = useTheme();
    const params = useSearchParams();
    const [openMenu, setOpenMenu] = useState<ShellMenu>(null);
    if (!FIXTURES_ENABLED) notFound();

    const props: SettingsViewProps = {
        permissions: { rows: ROWS, busyRow: null, message: null, onAction: noop, onDismissMessage: noop },
        workspace: workspaceProps(params.get("ws") ?? "none"),
        display: { theme, onThemeChange: setTheme, viewMode: "basic", onViewModeChange: noop, azureReportView: "roles", onAzureReportViewChange: noop, details: "fewer", onDetailsChange: noop, tours: "on", onToursChange: noop },
        emergency: {
            tenantLabel: "Contoso", accounts: [],
            search: { term: "", setTerm: noop, results: [], isSearching: false, error: null, minLength: 2 },
            status: null, onAdd: noop, onRemove: noop, onExport: noop, onImportFile: noop,
        },
        advanced: { logLevel: "INFO", logLevels: ["DEBUG", "INFO", "WARN", "ERROR"], onLogLevelChange: noop, onClearCache: noop, isClearing: false, clearStatus: null, version: "v3.2.0" },
    };

    return (
        <ShellFrame
            currentPath="/settings"
            account={{
                user: { displayName: "Alex Wilber", userPrincipalName: "alexw@contoso.com", initials: "AW" },
                tenantName: "Contoso",
                tenantId: "3f2a91c4-7d1e-4b6a-9e0f-5c8d2a1b7e63",
                theme,
                onThemeChange: setTheme,
                updateInfo: null,
                appVersion: "v3.2.0",
                hasUnseenWhatsNew: false,
                onOpenWhatsNew: noop,
                onOpenHelp: noop,
                onSignOut: noop,
            }}
            isRefreshing={false}
            onRefresh={noop}
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
        >
            <SettingsView {...props} />
        </ShellFrame>
    );
}

export default function SettingsFixturePage() {
    return (
        <Suspense fallback={null}>
            <SettingsFixture />
        </Suspense>
    );
}
