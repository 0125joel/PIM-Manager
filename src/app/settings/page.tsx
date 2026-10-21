"use client";

import { useCallback, useMemo, useState } from "react";
import bundledCatalog from "@/config/accessModel/eam-catalog.json";
import { SettingsView } from "./components/SettingsView";
import type { StatusLine } from "./components/settingsTypes";
import { useTheme } from "@/components/ThemeProvider";
import { useUnifiedActions } from "@/contexts/UnifiedPimContext";
import { useRolesActions } from "@/hooks/usePimData";
import { clearCustomExtensionsCache } from "@/hooks/useCustomExtensions";
import { useEmergencyAccounts } from "@/hooks/useEmergencyAccounts";
import { useTenantName } from "@/hooks/useTenantName";
import { useUserSearch } from "@/hooks/useUserSearch";
import { useWorkloadPermissions } from "@/hooks/useWorkloadPermissions";
import type { FoundUser } from "@/hooks/useUserSearch";
import { clearPimSessionCaches } from "@/utils/cacheUtils";
import { parseEmergencyAccountsImport, serializeEmergencyAccounts, type EmergencyAccount } from "@/utils/emergencyAccounts";
import { readViewMode, writeViewMode, type ViewModePreference } from "@/utils/viewModePreference";
import { parseAccessModelCatalog } from "@/utils/accessModelCatalog";
import { labelName } from "@/utils/accessModelView";
import { matchContext, readContextChoices, writeContextChoice } from "@/utils/authContextSlug";
import { useRolesData } from "@/hooks/usePimData";

const LOG_LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
const DEFAULT_LOG_LEVEL = "INFO";

function readLogLevel(): string {
    try {
        const saved = localStorage.getItem("LOG_LEVEL");
        return saved && (LOG_LEVELS as readonly string[]).includes(saved) ? saved : DEFAULT_LOG_LEVEL;
    } catch {
        return DEFAULT_LOG_LEVEL;
    }
}

function safeLocalStorage(): Storage | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export default function SettingsPage() {
    const { theme, setTheme } = useTheme();
    const permissions = useWorkloadPermissions();
    const emergency = useEmergencyAccounts();
    const tenantName = useTenantName(emergency.tenantId || undefined);

    // Access model labels (spec 9.3, C2-02): the label to context choices Configure keeps per tenant
    const { authenticationContexts } = useRolesData();
    const catalog = useMemo(() => { const parsed = parseAccessModelCatalog(bundledCatalog); return parsed.ok ? parsed.catalog : null; }, []);
    // The choices of the signed-in tenant; read again when the tenant becomes known (React's adjust-state-while-rendering)
    const [choices, setChoices] = useState(() => ({ tenantId: emergency.tenantId, map: readContextChoices(safeLocalStorage(), emergency.tenantId) }));
    if (choices.tenantId !== emergency.tenantId) setChoices({ tenantId: emergency.tenantId, map: readContextChoices(safeLocalStorage(), emergency.tenantId) });
    const contextChoices = choices.map;
    const contexts = useMemo(() => authenticationContexts.map((c) => ({ id: c.id, displayName: c.displayName })), [authenticationContexts]);
    const labels = useMemo(() => (catalog?.authContexts ?? []).map((label) => {
        const byName = matchContext(label.slug, contexts, {});
        return {
            slug: label.slug,
            name: labelName(label.slug, catalog!),
            contextId: contextChoices[label.slug] ?? null,
            matchedByName: byName.kind === "byName" ? contexts.find((c) => c.id === byName.contextId)?.displayName ?? null : null,
        };
    }), [catalog, contexts, contextChoices]);
    const chooseContext = useCallback((slug: string, contextId: string | null) => {
        writeContextChoice(safeLocalStorage(), emergency.tenantId, slug, contextId);
        setChoices({ tenantId: emergency.tenantId, map: readContextChoices(safeLocalStorage(), emergency.tenantId) });
    }, [emergency.tenantId]);
    const search = useUserSearch(emergency.ids);
    const { clearData } = useRolesActions();
    const { refreshAllWorkloads } = useUnifiedActions();

    const [viewMode, setViewMode] = useState<ViewModePreference>(() => (typeof window === "undefined" ? "basic" : (readViewMode() ?? "basic")));
    const [logLevel, setLogLevel] = useState<string>(() => (typeof window === "undefined" ? DEFAULT_LOG_LEVEL : readLogLevel()));
    const [emergencyStatus, setEmergencyStatus] = useState<StatusLine | null>(null);
    const [isClearing, setIsClearing] = useState(false);
    const [clearStatus, setClearStatus] = useState<StatusLine | null>(null);

    const handleAdd = useCallback(
        (user: FoundUser) => {
            const result = emergency.add({ id: user.id, displayName: user.displayName, userPrincipalName: user.userPrincipalName });
            setEmergencyStatus(result.ok ? { kind: "success", text: `${user.displayName} is marked as an emergency access account.` } : { kind: "error", text: result.reason });
            if (result.ok) search.reset();
        },
        [emergency, search],
    );

    const handleRemove = useCallback(
        (account: EmergencyAccount) => {
            const result = emergency.remove(account.id);
            setEmergencyStatus(result.ok ? { kind: "success", text: `${account.displayName} is no longer marked.` } : { kind: "error", text: result.reason });
        },
        [emergency],
    );

    const handleExport = useCallback(() => {
        const blob = new Blob([serializeEmergencyAccounts(emergency.accounts)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `emergency-access-accounts-${(emergency.tenantId || "tenant").slice(0, 8)}.json`;
        link.click();
        URL.revokeObjectURL(url);
    }, [emergency.accounts, emergency.tenantId]);

    const handleImportFile = useCallback(
        async (file: File) => {
            if (file.size > 256 * 1024) {
                setEmergencyStatus({ kind: "error", text: "The file is larger than 256 KB." });
                return;
            }
            const parsed = parseEmergencyAccountsImport(await file.text());
            if (!parsed.ok) {
                setEmergencyStatus({ kind: "error", text: parsed.reason });
                return;
            }
            const merged = emergency.merge(parsed.accounts);
            setEmergencyStatus(
                merged.ok
                    ? { kind: "success", text: `Added ${merged.added}, already marked ${merged.alreadyMarked}, skipped ${parsed.skipped}.` }
                    : { kind: "error", text: merged.reason },
            );
        },
        [emergency],
    );

    const handleLogLevelChange = useCallback((level: string) => {
        setLogLevel(level);
        try {
            localStorage.setItem("LOG_LEVEL", level);
        } catch {
            // the Logger reads the stored level; without storage the choice only lasts for this page
        }
    }, []);

    const handleViewModeChange = useCallback((mode: ViewModePreference) => {
        setViewMode(mode);
        writeViewMode(mode);
    }, []);

    const handleClearCache = useCallback(async () => {
        setIsClearing(true);
        setClearStatus(null);
        try {
            const removed = clearPimSessionCaches();
            clearCustomExtensionsCache();
            clearData();
            setClearStatus({ kind: "success", text: `Cached data cleared (${removed} entries). Everything reloads in the background.` });
            await refreshAllWorkloads(true);
        } catch {
            setClearStatus({ kind: "error", text: "Could not reload the data. Open a page to load it again." });
        } finally {
            setIsClearing(false);
        }
    }, [clearData, refreshAllWorkloads]);

    return (
        <SettingsView
            permissions={{ rows: permissions.rows, busyRow: permissions.busyRow, message: permissions.message, onAction: permissions.act, onDismissMessage: permissions.dismissMessage }}
            display={{ theme, onThemeChange: setTheme, viewMode, onViewModeChange: handleViewModeChange }}
            emergency={{
                tenantLabel: tenantName ?? (emergency.tenantId ? emergency.tenantId.slice(0, 8) : null),
                accounts: emergency.accounts,
                search,
                status: emergencyStatus,
                onAdd: handleAdd,
                onRemove: handleRemove,
                onExport: handleExport,
                onImportFile: (file) => void handleImportFile(file),
            }}
            accessModel={emergency.tenantId ? { tenantLabel: tenantName ?? emergency.tenantId.slice(0, 8), labels, contexts, onChoose: chooseContext } : undefined}
            advanced={{ logLevel, logLevels: LOG_LEVELS, onLogLevelChange: handleLogLevelChange, onClearCache: () => void handleClearCache(), isClearing, clearStatus, version: process.env.NEXT_PUBLIC_APP_VERSION }}
        />
    );
}
