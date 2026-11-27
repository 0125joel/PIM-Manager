import type { PermissionRow, PermissionRowId } from "@/hooks/useWorkloadPermissions";
import type { FoundUser } from "@/hooks/useUserSearch";
import type { EmergencyAccount } from "@/utils/emergencyAccounts";
import type { ThemeChoice } from "@/components/shell/AccountMenu";
import type { ViewModePreference } from "@/utils/viewModePreference";
import type { AzureReportViewPreference } from "@/utils/azureReportViewPreference";
import type { DetailsPreference } from "@/utils/detailsPreference";
import type { TourSetting } from "@/utils/tourProgress";

export interface StatusLine {
    kind: "success" | "error";
    text: string;
}

export interface PermissionsProps {
    rows: PermissionRow[];
    busyRow: PermissionRowId | null;
    message: StatusLine | null;
    onAction: (row: PermissionRow) => void;
    onDismissMessage: () => void;
}

export interface DisplayProps {
    theme: ThemeChoice;
    onThemeChange: (theme: ThemeChoice) => void;
    viewMode: ViewModePreference;
    onViewModeChange: (mode: ViewModePreference) => void;
    azureReportView: AzureReportViewPreference;
    onAzureReportViewChange: (view: AzureReportViewPreference) => void;
    details: DetailsPreference;
    onDetailsChange: (value: DetailsPreference) => void;
    tours: TourSetting;
    onToursChange: (value: TourSetting) => void;
}

export interface EmergencySearch {
    term: string;
    setTerm: (term: string) => void;
    results: FoundUser[];
    isSearching: boolean;
    error: string | null;
    minLength: number;
}

export interface EmergencyProps {
    tenantLabel: string | null;
    accounts: EmergencyAccount[];
    search: EmergencySearch;
    status: StatusLine | null;
    onAdd: (user: FoundUser) => void;
    onRemove: (account: EmergencyAccount) => void;
    onExport: () => void;
    onImportFile: (file: File) => void;
}

export interface AdvancedProps {
    logLevel: string;
    logLevels: readonly string[];
    onLogLevelChange: (level: string) => void;
    onClearCache: () => void;
    isClearing: boolean;
    clearStatus: StatusLine | null;
    version: string | undefined;
}

/** The steps of choosing Log Analytics workspaces (canvas `Settings.dc.html`): nothing chosen, Azure access, the list, no list, a typed id, the Log Analytics permission, the check, the chosen ones */
export type WorkspaceStep = "none" | "azure" | "listing" | "list" | "nolist" | "manual" | "consent" | "checking" | "chosen";

/** One workspace of the list (or one added by its id): where it is and how long it keeps logs */
export interface WorkspaceListItem {
    customerId: string;
    name: string;
    /** "Contoso-Security, West Europe. Keeps logs 180 days." Empty for a workspace added by its id */
    where: string;
    /** The Entra diagnostic settings send the audit log to it; absent when that could not be read */
    receivesEntraLogs?: boolean;
    /** A diagnostic setting of a subscription sends its Azure activity log to it; a convenience mark, absent when that could not be read */
    receivesActivityLogs?: boolean;
    isSelected: boolean;
}

/** One line under a workspace: its tone (icon and colour) and its text. `pending` before the check */
export interface WorkspaceStatusLine {
    tone: "ok" | "quiet" | "warn" | "error" | "pending";
    text: string;
}

/** The status of one chosen workspace after the check: its name, and one line per log that needs one */
export interface WorkspaceStatusItem {
    customerId: string;
    /** The name, and "Keeps logs 180 days." when the retention is known */
    name: string;
    lines: WorkspaceStatusLine[];
}

export interface WorkspaceProps {
    tenantLabel: string | null;
    step: WorkspaceStep;
    /** The workspaces of all subscriptions, in one list, and the ones added by id */
    items: WorkspaceListItem[];
    /** Subscriptions whose workspaces could not be listed: named, with the rest shown */
    failedSubscriptions: string[];
    /** The list itself could not be read */
    listError: string | null;
    selectedCount: number;
    manualDraft: string;
    manualError: string | null;
    /** A failed Azure or Log Analytics consent, as a sentence */
    consentMessage: string | null;
    isBusy: boolean;
    /** After the check: the summary above the statuses and the line under them */
    summary: { text: string; detail: string } | null;
    statuses: WorkspaceStatusItem[];
    checkedLine: string | null;
    onChoose: () => void;
    onGrantAzure: () => void;
    onToggle: (customerId: string) => void;
    onShowManual: () => void;
    onManualChange: (text: string) => void;
    onUse: () => void;
    onGrantLogAnalytics: () => void;
    onCancel: () => void;
    onRetryList: () => void;
    onCheckAgain: () => void;
    onRemoveAll: () => void;
}

export interface SettingsViewProps {
    permissions: PermissionsProps;
    workspace: WorkspaceProps;
    display: DisplayProps;
    emergency: EmergencyProps;
    /** Optional: the fixture route shows the page without it */
    accessModel?: AccessModelLabelsProps;
    advanced: AdvancedProps;
}

export interface AccessModelLabelsProps {
    tenantLabel: string | null;
    /** The catalog's labels with the admin's choice; `matchedByName` when a context's name already matches the slug */
    labels: { slug: string; name: string; contextId: string | null; matchedByName: string | null }[];
    contexts: { id: string; displayName: string }[];
    onChoose: (slug: string, contextId: string | null) => void;
}
