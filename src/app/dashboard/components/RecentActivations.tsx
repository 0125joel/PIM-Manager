"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useMemo } from "react";
import { Clock, User, Shield } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface RecentActivationsProps {
    rolesData: RoleDetailData[];
    loading: boolean;
}

export function RecentActivations({ rolesData, loading }: RecentActivationsProps) {
    const recentActivations = useMemo(() => {
        const activations = rolesData
            .flatMap(role =>
                role.assignments.active.map(assignment => ({
                    roleId: role.definition.id,
                    roleName: role.definition.displayName,
                    isPrivileged: role.definition.isPrivileged,
                    principalName: (assignment as any).principal?.displayName || "Unknown User",
                    principalType: (assignment as any).principal?.["@odata.type"]?.includes("group") ? "Group" : "User",
                    startDateTime: (assignment as any).startDateTime,
                    endDateTime: (assignment as any).scheduleInfo?.expiration?.endDateTime,
                }))
            )
            .filter(a => a.startDateTime) // Only include activations with start time
            .sort((a, b) => new Date(b.startDateTime).getTime() - new Date(a.startDateTime).getTime())
            .slice(0, 10); // Last 10 activations

        return activations;
    }, [rolesData]);

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-6 w-48 bg-zinc-100 dark:bg-zinc-800 rounded mb-4 animate-pulse" />
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (recentActivations.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-500" />
                    Recent Activations
                </h3>
                <div className="text-center py-8 text-zinc-500">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No recent role activations</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-500" />
                    Recent Activations
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Last 10 role activations
                </p>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recentActivations.map((activation, index) => {
                    const startDate = new Date(activation.startDateTime);
                    const timeAgo = formatDistanceToNow(startDate, { addSuffix: true });
                    const endDate = activation.endDateTime ? new Date(activation.endDateTime) : null;
                    const isExpired = endDate && endDate < new Date();

                    return (
                        <div key={`${activation.roleId}-${index}`} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <div className="flex items-start gap-3">
                                {/* Timeline dot */}
                                <div className="flex flex-col items-center">
                                    <div className={`w-2 h-2 rounded-full mt-2 ${isExpired ? 'bg-zinc-400' : 'bg-blue-500'}`} />
                                    {index < recentActivations.length - 1 && (
                                        <div className="w-px h-12 bg-zinc-200 dark:bg-zinc-700 mt-1" />
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${activation.isPrivileged
                                                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400'
                                                }`}>
                                                <Shield className="h-3 w-3" />
                                                {activation.roleName}
                                            </span>
                                            {isExpired && (
                                                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                                    (Expired)
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                            {timeAgo}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                        <User className="h-3.5 w-3.5" />
                                        <span className="truncate">{activation.principalName}</span>
                                        <span className="text-xs text-zinc-400">
                                            ({activation.principalType})
                                        </span>
                                    </div>

                                    {endDate && !isExpired && (
                                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                            Expires {formatDistanceToNow(endDate, { addSuffix: true })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
