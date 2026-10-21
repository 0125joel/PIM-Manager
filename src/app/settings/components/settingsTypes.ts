import type { PermissionRow, PermissionRowId } from "@/hooks/useWorkloadPermissions";
import type { FoundUser } from "@/hooks/useUserSearch";
import type { EmergencyAccount } from "@/utils/emergencyAccounts";
import type { ThemeChoice } from "@/components/shell/AccountMenu";
import type { ViewModePreference } from "@/utils/viewModePreference";

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

export interface SettingsViewProps {
    permissions: PermissionsProps;
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
