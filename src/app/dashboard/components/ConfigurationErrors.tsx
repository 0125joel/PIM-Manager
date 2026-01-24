"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useMemo } from "react";
import { AlertCircle, Shield, RefreshCw } from "lucide-react";

interface ConfigurationErrorsProps {
    rolesData: RoleDetailData[];
    loading: boolean;
    onRefresh?: () => void;
}

export function ConfigurationErrors({ rolesData, loading, onRefresh }: ConfigurationErrorsProps) {
    const errorStats = useMemo(() => {
        const rolesWithErrors = rolesData.filter(r => r.configError);

        const errorsByType = rolesWithErrors.reduce((acc, role) => {
            const errorType = role.configError?.includes("404") ? "Not Found" :
                role.configError?.includes("403") ? "Access Denied" :
                    role.configError?.includes("429") ? "Rate Limited" : "Other";

            if (!acc[errorType]) {
                acc[errorType] = [];
            }
            acc[errorType].push(role);
            return acc;
        }, {} as Record<string, RoleDetailData[]>);

        return { rolesWithErrors, errorsByType };
    }, [rolesData]);

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-6 w-48 bg-zinc-100 dark:bg-zinc-800 rounded mb-4 animate-pulse" />
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (errorStats.rolesWithErrors.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <AlertCircle className="h-5 w-5 text-red-500" />
                    Configuration Errors
                </h3>
                <div className="text-center py-8 text-zinc-500">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 dark:bg-green-900/20 mb-3">
                        <svg className="h-8 w-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <p className="text-sm font-medium">All roles configured successfully</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-red-500" />
                            Configuration Errors
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            {errorStats.rolesWithErrors.length} {errorStats.rolesWithErrors.length === 1 ? 'role' : 'roles'} with errors
                        </p>
                    </div>
                    {onRefresh && (
                        <button
                            onClick={onRefresh}
                            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                            title="Retry failed roles"
                        >
                            <RefreshCw className="h-4 w-4 text-zinc-500" />
                        </button>
                    )}
                </div>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {Object.entries(errorStats.errorsByType).map(([errorType, roles]) => (
                    <div key={errorType} className="p-4">
                        <div className="flex items-center gap-2 mb-3">
                            <div className={`px-2 py-1 rounded text-xs font-medium ${errorType === "Access Denied" ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                                    errorType === "Not Found" ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                                        errorType === "Rate Limited" ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' :
                                            'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400'
                                }`}>
                                {errorType}
                            </div>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                ({roles.length})
                            </span>
                        </div>

                        <div className="space-y-2">
                            {roles.slice(0, 3).map((role) => (
                                <div key={role.definition.id} className="flex items-start gap-2 text-sm">
                                    <Shield className="h-4 w-4 text-zinc-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                            {role.definition.displayName}
                                        </div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                            {role.configError}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {roles.length > 3 && (
                                <div className="text-xs text-zinc-500 dark:text-zinc-400 pl-6">
                                    +{roles.length - 3} more
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
