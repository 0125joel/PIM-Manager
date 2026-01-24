"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useMemo } from "react";
import { UserCheck, Mail, Shield } from "lucide-react";

interface ApproversOverviewProps {
    rolesData: RoleDetailData[];
    loading: boolean;
}

export function ApproversOverview({ rolesData, loading }: ApproversOverviewProps) {
    const approverStats = useMemo(() => {
        const stats = new Map<string, {
            name: string;
            email: string;
            roleCount: number;
            roles: string[];
        }>();

        rolesData.forEach(role => {
            role.policy?.approvers?.forEach(approver => {
                const key = approver.id;
                if (!stats.has(key)) {
                    stats.set(key, {
                        name: approver.displayName || "Unknown Approver",
                        email: approver.userPrincipalName || "",
                        roleCount: 0,
                        roles: []
                    });
                }
                const approverStats = stats.get(key)!;
                approverStats.roleCount++;
                approverStats.roles.push(role.definition.displayName);
            });
        });

        return Array.from(stats.values())
            .sort((a, b) => b.roleCount - a.roleCount)
            .slice(0, 10);
    }, [rolesData]);

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-6 w-40 bg-zinc-100 dark:bg-zinc-800 rounded mb-4 animate-pulse" />
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (approverStats.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-purple-500" />
                    Approvers Overview
                </h3>
                <div className="text-center py-8 text-zinc-500">
                    <UserCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No approvers configured</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-purple-500" />
                    Approvers Overview
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Who approves role activations
                </p>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {approverStats.map((approver, index) => (
                    <div key={index} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <UserCheck className="h-4 w-4 text-purple-500" />
                                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                        {approver.name}
                                    </span>
                                </div>

                                {approver.email && (
                                    <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                                        <Mail className="h-3 w-3" />
                                        <span className="truncate">{approver.email}</span>
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <Shield className="h-3 w-3 text-zinc-400" />
                                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                        Approves {approver.roleCount} {approver.roleCount === 1 ? 'role' : 'roles'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex-shrink-0 px-3 py-1 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 rounded-full text-sm font-semibold">
                                {approver.roleCount}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
