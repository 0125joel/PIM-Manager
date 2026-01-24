"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useMemo } from "react";
import { Trophy, User, Users, UserCheck, Clock } from "lucide-react";

interface TopUsersProps {
    rolesData: RoleDetailData[];
    loading: boolean;
}

export function TopUsers({ rolesData, loading }: TopUsersProps) {
    const topUsers = useMemo(() => {
        const userStats = new Map<string, {
            name: string;
            permanentCount: number;
            eligibleCount: number;
            activeCount: number;
            roles: string[];
        }>();

        rolesData.forEach(role => {
            // Process permanent assignments
            role.assignments.permanent.forEach(assignment => {
                const key = assignment.principalId;
                if (!userStats.has(key)) {
                    userStats.set(key, {
                        name: (assignment as any).principal?.displayName || "Unknown User",
                        permanentCount: 0,
                        eligibleCount: 0,
                        activeCount: 0,
                        roles: []
                    });
                }
                const stats = userStats.get(key)!;
                stats.permanentCount++;
                if (!stats.roles.includes(role.definition.displayName)) {
                    stats.roles.push(role.definition.displayName);
                }
            });

            // Process eligible assignments
            role.assignments.eligible.forEach(assignment => {
                const key = (assignment as any).principalId;
                if (!userStats.has(key)) {
                    userStats.set(key, {
                        name: (assignment as any).principal?.displayName || "Unknown User",
                        permanentCount: 0,
                        eligibleCount: 0,
                        activeCount: 0,
                        roles: []
                    });
                }
                const stats = userStats.get(key)!;
                stats.eligibleCount++;
                if (!stats.roles.includes(role.definition.displayName)) {
                    stats.roles.push(role.definition.displayName);
                }
            });

            // Process active assignments
            role.assignments.active.forEach(assignment => {
                const key = (assignment as any).principalId;
                if (!userStats.has(key)) {
                    userStats.set(key, {
                        name: (assignment as any).principal?.displayName || "Unknown User",
                        permanentCount: 0,
                        eligibleCount: 0,
                        activeCount: 0,
                        roles: []
                    });
                }
                const stats = userStats.get(key)!;
                stats.activeCount++;
            });
        });

        return Array.from(userStats.values())
            .sort((a, b) => {
                const totalA = a.permanentCount + a.eligibleCount + a.activeCount;
                const totalB = b.permanentCount + b.eligibleCount + b.activeCount;
                return totalB - totalA;
            })
            .slice(0, 10);
    }, [rolesData]);

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-6 w-32 bg-zinc-100 dark:bg-zinc-800 rounded mb-4 animate-pulse" />
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-14 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (topUsers.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    Top Users
                </h3>
                <div className="text-center py-8 text-zinc-500">
                    <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No user assignments found</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" />
                    Top Users
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Users with most role assignments
                </p>
            </div>

            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {topUsers.map((user, index) => {
                    const total = user.permanentCount + user.eligibleCount + user.activeCount;
                    const rankColor = index === 0 ? 'text-yellow-600 dark:text-yellow-400' :
                        index === 1 ? 'text-zinc-400 dark:text-zinc-500' :
                            index === 2 ? 'text-orange-600 dark:text-orange-400' :
                                'text-zinc-400 dark:text-zinc-500';

                    return (
                        <div key={index} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                            <div className="flex items-center gap-3">
                                {/* Rank */}
                                <div className={`flex-shrink-0 w-8 text-center font-bold ${rankColor}`}>
                                    {index + 1}
                                </div>

                                {/* User info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <User className="h-4 w-4 text-zinc-400" />
                                        <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                            {user.name}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-3 text-xs">
                                        {user.permanentCount > 0 && (
                                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                                <Users className="h-3 w-3" />
                                                {user.permanentCount} Permanent
                                            </span>
                                        )}
                                        {user.eligibleCount > 0 && (
                                            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                                                <UserCheck className="h-3 w-3" />
                                                {user.eligibleCount} Eligible
                                            </span>
                                        )}
                                        {user.activeCount > 0 && (
                                            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                                <Clock className="h-3 w-3" />
                                                {user.activeCount} Active
                                            </span>
                                        )}
                                    </div>

                                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                        {user.roles.length} unique {user.roles.length === 1 ? 'role' : 'roles'}
                                    </div>
                                </div>

                                {/* Total badge */}
                                <div className="flex-shrink-0 px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 rounded-full text-sm font-semibold">
                                    {total}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
