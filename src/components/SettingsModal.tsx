"use client";

import { useState, useEffect } from "react";
import { X, Settings, Lock, Check, Loader2, AlertCircle, Shield, Users, AlertTriangle, ChevronDown, ChevronRight, Info, EyeOff, Bug } from "lucide-react";
import { WorkloadType } from "@/types/workload";
import { useIncrementalConsent, setWorkloadEnabled, WORKLOAD_SCOPES } from "@/hooks/useIncrementalConsent";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { useMsal } from "@azure/msal-react";
import { HELP_CONTENT } from "@/config/locales/en";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface WorkloadConfig {
    id: WorkloadType;
    name: string;
    description: string;
    icon: React.ReactNode;
    locked?: boolean;
    subFeatures?: SubFeatureConfig[];
}

interface SubFeatureConfig {
    id: string;
    name: string;
    description: string;
    scope: string;
}

// Feature persistence helpers
const FEATURE_STORAGE_PREFIX = "pim_feature_enabled_";
const VISIBILITY_STORAGE_PREFIX = "pim_visibility_";

function isFeatureEnabled(featureId: string): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(`${FEATURE_STORAGE_PREFIX}${featureId}`) === "true";
}

function setFeatureEnabled(featureId: string, enabled: boolean): void {
    if (typeof window === "undefined") return;
    if (enabled) {
        localStorage.setItem(`${FEATURE_STORAGE_PREFIX}${featureId}`, "true");
    } else {
        localStorage.removeItem(`${FEATURE_STORAGE_PREFIX}${featureId}`);
    }
}

// Visibility helpers (for hide/show, separate from consent)
export function isWorkloadVisible(workloadId: string): boolean {
    if (typeof window === "undefined") return true;
    // Default to visible unless explicitly hidden
    return localStorage.getItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`) !== "false";
}

export function setWorkloadVisible(workloadId: string, visible: boolean): void {
    if (typeof window === "undefined") return;
    if (visible) {
        localStorage.removeItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`);
    } else {
        localStorage.setItem(`${VISIBILITY_STORAGE_PREFIX}${workloadId}`, "false");
    }
}

// Workload configuration with sub-features
const WORKLOAD_CONFIG: WorkloadConfig[] = [
    {
        id: "directoryRoles",
        name: HELP_CONTENT.settings.modal.items.directoryRoles.name,
        description: HELP_CONTENT.settings.modal.items.directoryRoles.description,
        icon: <Shield className="h-5 w-5" />,
        locked: true,
        subFeatures: [
            {
                id: "securityAlerts",
                name: HELP_CONTENT.settings.modal.items.directoryRoles.securityAlerts.name,
                description: HELP_CONTENT.settings.modal.items.directoryRoles.securityAlerts.description,
                scope: "RoleManagementAlert.Read.Directory"
            }
        ]
    },
    {
        id: "pimGroups",
        name: HELP_CONTENT.settings.modal.items.pimGroups.name,
        description: HELP_CONTENT.settings.modal.items.pimGroups.description,
        icon: <Users className="h-5 w-5" />
    }
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { requestConsent, revokeConsent } = useIncrementalConsent();
    const unifiedContext = useUnifiedPimData();
    const { instance, accounts } = useMsal();
    const [loadingWorkload, setLoadingWorkload] = useState<WorkloadType | null>(null);
    const [loadingFeature, setLoadingFeature] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [featureStates, setFeatureStates] = useState<Record<string, boolean>>({});
    const [visibilityStates, setVisibilityStates] = useState<Record<string, boolean>>({});
    const [expandedWorkloads, setExpandedWorkloads] = useState<Set<WorkloadType>>(new Set(["directoryRoles"]));
    const [logLevel, setLogLevel] = useState<string>("INFO");
    const [activeTab, setActiveTab] = useState<"workloads" | "developer">("workloads");

    // Load initial log level
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('LOG_LEVEL');
            if (saved) setLogLevel(saved);
        }
    }, []);

    const handleLogLevelChange = (level: string) => {
        setLogLevel(level);
        if (typeof window !== 'undefined') {
            localStorage.setItem('LOG_LEVEL', level);
            // Logger reads directly from localStorage, so no need to notify service
        }
    };
    useEffect(() => {
        const checkStates = async () => {
            const featureStatuses: Record<string, boolean> = {};
            const visibilityStatuses: Record<string, boolean> = {};

            for (const workload of WORKLOAD_CONFIG) {
                // Check workload visibility
                visibilityStatuses[workload.id] = isWorkloadVisible(workload.id);

                if (workload.subFeatures) {
                    for (const feature of workload.subFeatures) {
                        // Check feature visibility
                        visibilityStatuses[feature.id] = isWorkloadVisible(feature.id);

                        // Check feature consent
                        try {
                            await instance.acquireTokenSilent({
                                scopes: [feature.scope],
                                account: accounts[0]
                            });
                            featureStatuses[feature.id] = true;
                            setFeatureEnabled(feature.id, true);
                        } catch {
                            featureStatuses[feature.id] = isFeatureEnabled(feature.id);
                        }
                    }
                }
            }
            setFeatureStates(featureStatuses);
            setVisibilityStates(visibilityStatuses);
        };

        if (isOpen && accounts.length > 0) {
            checkStates();
        }
    }, [isOpen, instance, accounts]);

    const toggleExpanded = (workloadId: WorkloadType) => {
        setExpandedWorkloads(prev => {
            const next = new Set(prev);
            if (next.has(workloadId)) {
                next.delete(workloadId);
            } else {
                next.add(workloadId);
            }
            return next;
        });
    };

    const handleEnableWorkload = async (workload: WorkloadType) => {
        setError(null);
        setLoadingWorkload(workload);

        try {
            const success = await requestConsent(workload);
            if (success) {
                unifiedContext.enableWorkload(workload);
                setVisibilityStates(prev => ({ ...prev, [workload]: true }));
                setWorkloadVisible(workload, true);
            } else {
                setError(`Failed to enable ${workload}. Please try again.`);
            }
        } catch (err) {
            setError(`Error enabling ${workload}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setLoadingWorkload(null);
        }
    };

    const handleHideWorkload = (workload: WorkloadType) => {
        setVisibilityStates(prev => ({ ...prev, [workload]: false }));
        setWorkloadVisible(workload, false);
    };

    const handleShowWorkload = async (workload: WorkloadType) => {
        setError(null);
        setLoadingWorkload(workload);

        try {
            // First try silent token acquisition to check if consent exists
            const scopes = WORKLOAD_SCOPES[workload];
            if (scopes && scopes.length > 0) {
                try {
                    await instance.acquireTokenSilent({
                        scopes,
                        account: accounts[0]
                    });
                    // Consent exists, just show
                } catch {
                    // Consent missing, trigger popup
                    console.log(`[Settings] Consent missing for ${workload}, triggering popup`);
                    await instance.acquireTokenPopup({
                        scopes,
                        account: accounts[0]
                    });
                }
            }

            // Now show and enable the workload
            setVisibilityStates(prev => ({ ...prev, [workload]: true }));
            setWorkloadVisible(workload, true);
            unifiedContext.enableWorkload(workload);
        } catch (err) {
            setError(`Failed to show ${workload}. Consent may have been cancelled.`);
            console.error(`Show workload error:`, err);
        } finally {
            setLoadingWorkload(null);
        }
    };

    const handleEnableFeature = async (feature: SubFeatureConfig) => {
        setError(null);
        setLoadingFeature(feature.id);

        try {
            await instance.acquireTokenPopup({
                scopes: [feature.scope],
                account: accounts[0]
            });
            setFeatureStates(prev => ({ ...prev, [feature.id]: true }));
            setFeatureEnabled(feature.id, true);
            setVisibilityStates(prev => ({ ...prev, [feature.id]: true }));
            setWorkloadVisible(feature.id, true);
        } catch (err) {
            setError(`Failed to enable ${feature.name}. Please try again.`);
            console.error(`Feature consent error:`, err);
        } finally {
            setLoadingFeature(null);
        }
    };

    const handleHideFeature = (feature: SubFeatureConfig) => {
        setVisibilityStates(prev => ({ ...prev, [feature.id]: false }));
        setWorkloadVisible(feature.id, false);
    };

    const handleShowFeature = async (feature: SubFeatureConfig) => {
        setError(null);
        setLoadingFeature(feature.id);

        try {
            // First try silent token acquisition to check if consent exists
            try {
                await instance.acquireTokenSilent({
                    scopes: [feature.scope],
                    account: accounts[0]
                });
                // Consent exists, just show
            } catch {
                // Consent missing, trigger popup
                console.log(`[Settings] Consent missing for ${feature.id}, triggering popup`);
                await instance.acquireTokenPopup({
                    scopes: [feature.scope],
                    account: accounts[0]
                });
            }

            // Now show and enable the feature
            setVisibilityStates(prev => ({ ...prev, [feature.id]: true }));
            setWorkloadVisible(feature.id, true);
            setFeatureStates(prev => ({ ...prev, [feature.id]: true }));
            setFeatureEnabled(feature.id, true);
        } catch (err) {
            setError(`Failed to show ${feature.name}. Consent may have been cancelled.`);
            console.error(`Show feature error:`, err);
        } finally {
            setLoadingFeature(null);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Settings className="h-6 w-6 text-blue-600" />
                        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{HELP_CONTENT.settings.modal.title}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="border-b border-zinc-200 dark:border-zinc-800 px-6">
                    <div className="flex gap-1 overflow-x-auto">
                        <button
                            onClick={() => setActiveTab("workloads")}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === "workloads"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            <Shield className="h-4 w-4" />
                            Workloads
                        </button>
                        <button
                            onClick={() => setActiveTab("developer")}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === "developer"
                                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                                }`}
                        >
                            <Bug className="h-4 w-4" />
                            Developer
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 p-6 overflow-y-auto">
                    <div className="space-y-4">
                        {/* Error banner */}
                        {error && (
                            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                {error}
                            </div>
                        )}

                        {activeTab === "workloads" && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div>
                                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                                        {HELP_CONTENT.settings.modal.workloads.title}
                                    </h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        {HELP_CONTENT.settings.modal.workloads.description}
                                    </p>
                                </div>

                                {/* Workload cards */}
                                <div className="space-y-3">
                                    {WORKLOAD_CONFIG.map((workload) => {
                                        // Use actual consent state from context, not localStorage
                                        const isEnabled = unifiedContext.workloads[workload.id]?.consent?.consented ?? false;
                                        const isVisible = visibilityStates[workload.id] !== false;
                                        const isLoading = loadingWorkload === workload.id;
                                        const isExpanded = expandedWorkloads.has(workload.id);
                                        const hasSubFeatures = workload.subFeatures && workload.subFeatures.length > 0;

                                        return (
                                            <div
                                                key={workload.id}
                                                className={`rounded-lg border ${isEnabled && isVisible
                                                    ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10"
                                                    : isEnabled && !isVisible
                                                        ? "border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800"
                                                        : "border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50"
                                                    }`}
                                            >
                                                {/* Main workload row */}
                                                <div className="p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            {hasSubFeatures ? (
                                                                <button
                                                                    onClick={() => toggleExpanded(workload.id)}
                                                                    className={`p-2 rounded-lg transition-colors ${isEnabled && isVisible
                                                                        ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
                                                                        : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600"
                                                                        }`}
                                                                >
                                                                    {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                                                </button>
                                                            ) : (
                                                                <div className={`p-2 rounded-lg ${isEnabled && isVisible
                                                                    ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                                                                    : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                                                                    }`}>
                                                                    {workload.icon}
                                                                </div>
                                                            )}
                                                            <div>
                                                                <div className="flex items-center gap-2">
                                                                    <h4 className="font-medium text-zinc-900 dark:text-zinc-100">
                                                                        {workload.name}
                                                                    </h4>
                                                                    {workload.locked && (
                                                                        <span className="flex items-center gap-1 px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 text-xs rounded">
                                                                            <Lock className="h-3 w-3" />
                                                                            Core
                                                                        </span>
                                                                    )}
                                                                    {isEnabled && isVisible && !workload.locked && (
                                                                        <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded">
                                                                            <Check className="h-3 w-3" />
                                                                            Enabled
                                                                        </span>
                                                                    )}
                                                                    {isEnabled && !isVisible && (
                                                                        <span className="flex items-center gap-1 px-2 py-0.5 bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300 text-xs rounded">
                                                                            <EyeOff className="h-3 w-3" />
                                                                            Hidden
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                                    {workload.description}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        <div className="ml-4">
                                                            {workload.locked ? (
                                                                <div className="px-4 py-2 text-sm text-zinc-400 dark:text-zinc-500">
                                                                    Always on
                                                                </div>
                                                            ) : isEnabled && isVisible ? (
                                                                <div className="relative group">
                                                                    <button
                                                                        onClick={() => handleHideWorkload(workload.id)}
                                                                        className="px-4 py-2 text-sm bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors flex items-center gap-2"
                                                                    >
                                                                        <EyeOff className="h-4 w-4" />
                                                                        {HELP_CONTENT.settings.modal.actions.hide.label}
                                                                    </button>
                                                                    <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-64 p-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs rounded shadow-lg z-10">
                                                                        <div className="flex items-start gap-2">
                                                                            <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                                                            <span>{HELP_CONTENT.settings.modal.actions.hide.tooltip}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ) : isEnabled && !isVisible ? (
                                                                <button
                                                                    onClick={() => handleShowWorkload(workload.id)}
                                                                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                                                >
                                                                    Show
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleEnableWorkload(workload.id)}
                                                                    disabled={isLoading}
                                                                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                                                >
                                                                    {isLoading ? (
                                                                        <>
                                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                                            Enabling...
                                                                        </>
                                                                    ) : (
                                                                        HELP_CONTENT.settings.modal.actions.enable
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Sub-features (collapsible) */}
                                                {hasSubFeatures && isExpanded && (
                                                    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900/50">
                                                        {workload.subFeatures!.map((feature) => {
                                                            const featureEnabled = featureStates[feature.id] || false;
                                                            const featureVisible = visibilityStates[feature.id] !== false;
                                                            const featureLoading = loadingFeature === feature.id;

                                                            return (
                                                                <div
                                                                    key={feature.id}
                                                                    className="p-4 pl-16 flex items-center justify-between border-b last:border-b-0 border-zinc-100 dark:border-zinc-800"
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className={`p-1.5 rounded ${featureEnabled && featureVisible
                                                                            ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                                                                            : "bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400"
                                                                            }`}>
                                                                            <AlertTriangle className="h-4 w-4" />
                                                                        </div>
                                                                        <div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                                                                                    {feature.name}
                                                                                </span>
                                                                                {featureEnabled && featureVisible && (
                                                                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs rounded">
                                                                                        <Check className="h-3 w-3" />
                                                                                    </span>
                                                                                )}
                                                                                {featureEnabled && !featureVisible && (
                                                                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-300 text-xs rounded">
                                                                                        <EyeOff className="h-3 w-3" />
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                                                {feature.description}
                                                                            </p>
                                                                        </div>
                                                                    </div>

                                                                    <div className="ml-4">
                                                                        {featureEnabled && featureVisible ? (
                                                                            <div className="relative group">
                                                                                <button
                                                                                    onClick={() => handleHideFeature(feature)}
                                                                                    className="px-3 py-1.5 text-xs bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors flex items-center gap-1"
                                                                                >
                                                                                    <EyeOff className="h-3 w-3" />
                                                                                    Hide
                                                                                </button>
                                                                                <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block w-56 p-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs rounded shadow-lg z-10">
                                                                                    <div className="flex items-start gap-2">
                                                                                        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                                                                        <span>{HELP_CONTENT.settings.modal.actions.hide.tooltip}</span>
                                                                                    </div>
                                                                                </div>
                                                                            </div>
                                                                        ) : featureEnabled && !featureVisible ? (
                                                                            <button
                                                                                onClick={() => handleShowFeature(feature)}
                                                                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                                                                            >
                                                                                {HELP_CONTENT.settings.modal.actions.show}
                                                                            </button>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => handleEnableFeature(feature)}
                                                                                disabled={featureLoading}
                                                                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                                                            >
                                                                                {featureLoading ? (
                                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                                ) : (
                                                                                    "Enable"
                                                                                )}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Info note */}
                                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                    <p className="text-sm text-blue-800 dark:text-blue-300">
                                        <strong>{HELP_CONTENT.settings.modal.note.title}</strong> {HELP_CONTENT.settings.modal.note.text}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === "developer" && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div>
                                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-2">
                                        <Bug className="h-5 w-5" />
                                        Developer Settings
                                    </h3>
                                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                                        Advanced configuration for debugging and troubleshooting.
                                    </p>
                                </div>

                                <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Log Level</h4>
                                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                                                Control verbosity of browser console logs
                                            </p>
                                        </div>
                                        <div className="flex bg-zinc-200 dark:bg-zinc-700 rounded-lg p-1">
                                            <button
                                                onClick={() => handleLogLevelChange('INFO')}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${logLevel === 'INFO'
                                                        ? 'bg-white dark:bg-zinc-600 shadow text-zinc-900 dark:text-zinc-100'
                                                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                                                    }`}
                                            >
                                                INFO
                                            </button>
                                            <button
                                                onClick={() => handleLogLevelChange('DEBUG')}
                                                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${logLevel === 'DEBUG'
                                                        ? 'bg-white dark:bg-zinc-600 shadow text-zinc-900 dark:text-zinc-100'
                                                        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                                                    }`}
                                            >
                                                DEBUG
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Console Instructions Note */}
                                <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg">
                                    <p className="text-sm text-amber-800 dark:text-amber-200 flex gap-2">
                                        <Info className="h-5 w-5 flex-shrink-0" />
                                        <span>
                                            <strong>Console Usage:</strong> To view debug logs, open your browser's Developer Tools (F12) and go to the Console tab. Ensure "Verbose" or "Debug" levels are checked in the console filter settings.
                                        </span>
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
