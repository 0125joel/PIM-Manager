"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useMemo } from "react";
import { AlertTriangle, Clock, Shield, User } from "lucide-react";
import { formatDistanceToNow, differenceInDays } from "date-fns";

interface ExpiringSoonProps {
    rolesData: RoleDetailData[];
    loading: boolean;
}

export function ExpiringSoon({ rolesData, loading }: ExpiringSoonProps) {
    const expiringSoon = useMemo(() => {
        const now = new Date();
        const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const expiringItems = rolesData
            .flatMap(role => {
                const items: Array<{
                    roleId: string;
                    roleName: string;
                    isPrivileged: boolean;
                    principalName: string;
                    type: string;
                    expirationDate: Date;
                    daysUntilExpiry: number;
                }> = [];

                // Check eligible assignments
                role.assignments.eligible.forEach(assignment => {
                    const endDate = (assignment as any).scheduleInfo?.expiration?.endDateTime;
                    if (endDate) {
                        const expirationDate = new Date(endDate);
                        if (expirationDate > now && expirationDate < next7Days) {
                            items.push({
                                roleId: role.definition.id,
                                roleName: role.definition.displayName,
                                isPrivileged: role.definition.isPrivileged || false,
                                principalName: (assignment as any).principal?.displayName || "Unknown",
                                type: "Eligible",
                                expirationDate,
                                daysUntilExpiry: differenceInDays(expirationDate, now),
                            });
                        }
                    }
                });

                // Check active assignments
                role.assignments.active.forEach(assignment => {
                    const endDate = (assignment as any).scheduleInfo?.expiration?.endDateTime;
                    if (endDate) {
                        const expirationDate = new Date(endDate);
                        if (expirationDate > now && expirationDate < next7Days) {
                            items.push({
                                roleId: role.definition.id,
                                roleName: role.definition.displayName,
                                isPrivileged: role.definition.isPrivileged || false,
                                principalName: (assignment as any).principal?.displayName || "Unknown",
                                type: "Active",
                                expirationDate,
                                daysUntilExpiry: differenceInDays(expirationDate, now),
                            });
                        }
                    }
                });

                return items;
            })
            .sort((a, b) => a.expirationDate.getTime() - b.expirationDate.getTime())
            .slice(0, 10); // Show top 10 soonest expiring

        return expiringItems;
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

    if (expiringSoon.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    Expiring Soon
                </h3>
                <div className="text-center py-8 text-zinc-500">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No assignments expiring in the next 7 days</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    Expiring Soon
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Assignments expiring within 7 days
                </p>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {expiringSoon.map((item, index) => {
                    const urgencyColor = item.daysUntilExpiry <= 1
                        ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'
                        : item.daysUntilExpiry <= 3
                            ? 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20'
                            : 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20';

                    return (
                        <div key={`${item.roleId}-${index}`} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${item.isPrivileged
                                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400'
                                            }`}>
                                            <Shield className="h-3 w-3" />
                                            {item.roleName}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded-full ${item.type === "Active"
                                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                            }`}>
                                            {item.type}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400 mb-1">
                                        <User className="h-3.5 w-3.5" />
                                        <span className="truncate">{item.principalName}</span>
                                    </div>

                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Expires {formatDistanceToNow(item.expirationDate, { addSuffix: true })}
                                    </div>
                                </div>

                                <div className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold ${urgencyColor}`}>
                                    {item.daysUntilExpiry === 0 ? 'Today' :
                                        item.daysUntilExpiry === 1 ? 'Tomorrow' :
                                            `${item.daysUntilExpiry}d`}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
