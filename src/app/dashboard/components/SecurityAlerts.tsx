"use client";

import { useState } from "react";
import { Shield, Lock, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { useSecurityAlerts } from "@/app/dashboard/hooks/useSecurityAlerts";
import { AlertCard } from "@/app/dashboard/components/AlertCard";

interface SecurityAlertsProps { }

export function SecurityAlerts({ }: SecurityAlertsProps) {
    // Custom hook handles all data and state logic
    const {
        alerts,
        loading,
        error,
        hasPermission,
        requestingPermission,
        dismissedAlerts,
        loadAlerts,
        requestPermission,
        dismissAlert,
        restoreAll,
        ALERTS_PERMISSION
    } = useSecurityAlerts();

    // Local UI state
    const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());
    const [showDismissed, setShowDismissed] = useState(false);
    const [showPassed, setShowPassed] = useState(false);

    // Toggle alert expansion
    const toggleExpand = (alertId: string) => {
        setExpandedAlerts(prev => {
            const next = new Set(prev);
            if (next.has(alertId)) {
                next.delete(alertId);
            } else {
                next.add(alertId);
            }
            return next;
        });
    };

    // Filter alerts logic
    const activeAlerts = alerts.filter(a => a.isActive && a.incidentCount > 0);
    const passedAlerts = alerts.filter(a => !a.isActive || a.incidentCount === 0);

    const visibleActiveAlerts = showDismissed
        ? activeAlerts
        : activeAlerts.filter(a => !dismissedAlerts.has(a.id));

    const dismissedCount = activeAlerts.filter(a => dismissedAlerts.has(a.id)).length;
    const passedChecksCount = passedAlerts.length;

    // Render: Permission not granted
    if (hasPermission === false) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Security Alerts
                    </h3>
                </div>

                <div className="text-center py-6">
                    <Lock className="w-12 h-12 mx-auto mb-4 text-zinc-400" />
                    <h4 className="text-lg font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                        PIM Security Alerts
                    </h4>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4 max-w-sm mx-auto">
                        View Microsoft&apos;s security recommendations for your privileged roles.
                        Requires additional permission:
                    </p>
                    <code className="text-xs bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-zinc-700 dark:text-zinc-300">
                        {ALERTS_PERMISSION}
                    </code>

                    <button
                        onClick={requestPermission}
                        disabled={requestingPermission}
                        className="mt-6 flex items-center gap-2 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                    >
                        {requestingPermission ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Requesting...
                            </>
                        ) : (
                            <>
                                <Lock className="w-4 h-4" />
                                Enable Security Alerts
                            </>
                        )}
                    </button>

                    {error && (
                        <p className="mt-3 text-sm text-red-500">{error}</p>
                    )}
                </div>
            </div>
        );
    }

    // Render: Loading
    if (loading || hasPermission === null) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Security Alerts
                    </h3>
                </div>
                <div className="flex items-center justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-zinc-400" />
                    <span className="ml-2 text-zinc-500">Loading security alerts...</span>
                </div>
            </div>
        );
    }

    // Render: Error
    if (error) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Security Alerts
                    </h3>
                </div>
                <div className="flex items-center justify-center py-6 text-red-500">
                    <AlertTriangle className="w-5 h-5 mr-2" />
                    {error}
                </div>
                <button
                    onClick={loadAlerts}
                    className="mx-auto flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700"
                >
                    <RefreshCw className="w-4 h-4" />
                    Retry
                </button>
            </div>
        );
    }

    // Render: No active alerts (all clear or passed)
    if (activeAlerts.length === 0 && passedAlerts.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            Security Alerts
                        </h3>
                    </div>
                    <button
                        onClick={loadAlerts}
                        disabled={loading}
                        className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="Refresh alerts"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
                <div className="text-center py-6">
                    <p>No alerts definitions found.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        Security Alerts
                    </h3>
                </div>
                <button
                    onClick={loadAlerts}
                    disabled={loading}
                    className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                    title="Refresh alerts"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Active Alert cards */}
            {
                visibleActiveAlerts.length > 0 ? (
                    <div className="space-y-3">
                        {visibleActiveAlerts.map(alert => (
                            <AlertCard
                                key={alert.id}
                                alert={alert}
                                isExpanded={expandedAlerts.has(alert.id)}
                                onToggle={() => toggleExpand(alert.id)}
                                onDismiss={() => dismissAlert(alert.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-6 border rounded-lg border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                        <CheckCircle className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                        <h4 className="text-base font-medium text-zinc-900 dark:text-zinc-100">
                            All checks passed!
                        </h4>
                        <p className="text-xs text-zinc-500">
                            No active security recommendations.
                        </p>
                    </div>
                )
            }

            {/* Passed Checks Section */}
            {
                passedChecksCount > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                        <button
                            onClick={() => setShowPassed(!showPassed)}
                            className="flex items-center justify-between w-full text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 p-2 rounded-lg transition-colors"
                        >
                            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                                <CheckCircle className="w-4 h-4" />
                                <span>{passedChecksCount} checks passed</span>
                            </div>
                            {showPassed ? (
                                <ChevronUp className="w-4 h-4 text-zinc-400" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-zinc-400" />
                            )}
                        </button>

                        {showPassed && (
                            <div className="mt-2 space-y-2 pl-2">
                                {passedAlerts.map(alert => (
                                    <div key={alert.id} className="flex items-center gap-3 p-2 rounded text-zinc-500 dark:text-zinc-400 text-sm">
                                        <CheckCircle className="w-4 h-4 text-emerald-500/50" />
                                        <span>{alert.alertDefinition?.displayName}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )
            }

            {/* Footer Actions */}
            <div className="mt-2 flex items-center justify-end gap-3 text-xs">
                {dismissedCount > 0 && !showDismissed && (
                    <button
                        onClick={() => setShowDismissed(true)}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    >
                        Show dismissed ({dismissedCount})
                    </button>
                )}

                {showDismissed && dismissedCount > 0 && (
                    <button
                        onClick={() => {
                            restoreAll();
                            setShowDismissed(false);
                        }}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                    >
                        Hide dismissed
                    </button>
                )}
            </div>
        </div >
    );
}
