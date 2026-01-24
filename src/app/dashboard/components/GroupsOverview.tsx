"use client";

import { useState, useMemo } from "react";
import { Users, UserCheck, Clock, ChevronRight, Search, Shield } from "lucide-react";
import Link from "next/link";
import { PimGroupData, GroupType } from "@/types/pimGroup.types";
import { getAggregatedGroupStats } from "@/services/pimGroupService";

interface GroupsOverviewProps {
    groupsData: PimGroupData[];
    loading: boolean;
}

// ... types and imports remain ...
import { AlertTriangle } from "lucide-react"; // Import AlertIcon

// ... GroupsOverviewProps remain ...

import { useWorkloadVisibility } from "@/components/WorkloadChips";

// ... GroupsOverviewProps remain ...

export function GroupsOverview({ groupsData, loading }: GroupsOverviewProps) {
    const [searchTerm, setSearchTerm] = useState("");

    // Check visibility toggle from WorkloadChips
    const isUnmanagedVisible = useWorkloadVisibility("unmanagedGroups");
    const isManagedVisible = useWorkloadVisibility("pimGroups");

    // Calculate Unmanaged Groups
    const unmanagedGroups = useMemo(() =>
        groupsData.filter(g => g.isManaged === false),
        [groupsData]
    );

    const unmanagedCount = unmanagedGroups.length;
    const managedCount = groupsData.length - unmanagedCount;

    // Aggregate stats across ONLY MANAGED groups (Unmanaged have 0 assignments by definition)
    const stats = useMemo(() => getAggregatedGroupStats(groupsData.filter(g => g.isManaged !== false)), [groupsData]);

    // Filter groups by search term AND visibility
    const filteredGroups = useMemo(() => {
        let data = [...groupsData];

        // Filter based on visibility chips
        data = data.filter(g => {
            if (g.isManaged !== false) {
                // Managed Group
                return isManagedVisible;
            } else {
                // Unmanaged Group
                return isUnmanagedVisible;
            }
        });

        // Sort: Unmanaged first (if visible), then Managed
        const sorted = data.sort((a, b) => {
            if (a.isManaged === false && b.isManaged !== false) return -1;
            if (a.isManaged !== false && b.isManaged === false) return 1;
            return a.group.displayName.localeCompare(b.group.displayName);
        });

        return sorted
            .filter(g => g.group.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
            .slice(0, 5); // Limit to 5 for compact dashboard
    }, [groupsData, searchTerm, isUnmanagedVisible]);

    if (loading) {
        // ... loading skeleton ...
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-8 w-48 bg-zinc-100 dark:bg-zinc-800 rounded mb-6 animate-pulse" />
                <div className="space-y-4">
                    {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-14 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (groupsData.length === 0) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                    PIM groups overview
                </h3>
                <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
                    <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No Role-Assignable groups found</p>
                    <p className="text-sm mt-1">
                        Create groups with "IsAssignableToRole" enabled to manage them here.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden h-full flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            PIM groups overview
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                            {isManagedVisible && (
                                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                                    {managedCount} Managed
                                </span>
                            )}
                            {/* Only show unmanaged count if visible */}
                            {isUnmanagedVisible && unmanagedCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    <AlertTriangle className="h-3 w-3" />
                                    {unmanagedCount} Unmanaged
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Search Input */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Search groups..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                        />
                    </div>
                </div>

                {/* Unmanaged Alert Banner - Hide if filtered out */}
                {isUnmanagedVisible && unmanagedCount > 0 && (
                    <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-lg flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="text-sm font-medium text-red-900 dark:text-red-200">
                                Security Gap Detected
                            </h4>
                            <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                                {unmanagedCount} role-assignable groups are NOT managed by PIM. They may have permanent assignments bypassing your policies.
                            </p>
                        </div>
                    </div>
                )}

                {/* Stats Row - 2x2 compact grid - Hidden if ONLY unmanaged groups exist? No, show zeros. */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                    <StatCard
                        label="Eligible members"
                        value={stats.totalEligibleMembers}
                        icon={<UserCheck className="h-4 w-4" />}
                        color="blue"
                    />
                    <StatCard
                        label="Active members"
                        value={stats.totalActiveMembers}
                        icon={<Clock className="h-4 w-4" />}
                        color="green"
                    />
                    <StatCard
                        label="Eligible owners"
                        value={stats.totalEligibleOwners}
                        icon={<UserCheck className="h-4 w-4" />}
                        color="purple"
                    />
                    <StatCard
                        label="Active owners"
                        value={stats.totalActiveOwners}
                        icon={<Clock className="h-4 w-4" />}
                        color="amber"
                    />
                </div>
            </div>

            {/* Group List */}
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800 flex-1">
                {filteredGroups.map((groupData) => (
                    <GroupRow key={groupData.group.id} groupData={groupData} />
                ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-center">
                <Link
                    href="/report?workload=pimGroups"
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                    View full report &rarr;
                </Link>
            </div>
        </div>
    );
}

// ... StatCard remains ...

// Updated GroupRow
function GroupRow({ groupData }: { groupData: PimGroupData }) {
    const { group, stats, isManaged } = groupData; // Read isManaged

    // ... label logic remains ...
    const groupTypeLabels: Record<GroupType, string> = {
        security: "Security",
        m365: "M365",
        mailEnabled: "Mail-enabled",
        unknown: "Group"
    };
    const groupTypeLabel = groupTypeLabels[group.groupType];

    const totalEligible = (stats?.eligibleMembers || 0) + (stats?.eligibleOwners || 0);
    const totalActive = (stats?.activeMembers || 0) + (stats?.activeOwners || 0);

    return (
        <Link
            href={`/report?search=${encodeURIComponent(group.displayName)}`}
            className={`block px-6 py-4 transition-colors cursor-pointer ${isManaged === false
                ? "bg-red-50/50 hover:bg-red-50 dark:bg-red-900/5 dark:hover:bg-red-900/10"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-lg flex-shrink-0 ${isManaged === false
                        ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                        }`}>
                        {isManaged === false ? <AlertTriangle className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                        <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {group.displayName}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800">
                                {groupTypeLabel}
                            </span>
                            {/* Role Assignable Badge */}
                            {group.isAssignableToRole && (
                                <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400">
                                    <Shield className="h-3 w-3" />
                                    Role-assignable
                                </span>
                            )}
                            {/* NOT CONFIGURED Badge */}
                            {isManaged === false && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                                    Not Configured
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                    {/* Hide stats for unmanaged groups, or show "Unknown"? Logic says 0 but technically we didn't fetch them.
                        Better to show "-" or "N/A" to indicate we don't know the members?
                        Plan says "Do NOT fetch assignments". So showing 0 suggests it's empty, which is WRONG.
                        It could be full of permanent members.
                    */}
                    {isManaged === false ? (
                        <div className="text-zinc-400 text-xs italic">
                            Unmanaged
                        </div>
                    ) : (
                        <>
                            <div className="text-center">
                                <div className="text-zinc-900 dark:text-zinc-100 font-medium">{totalEligible}</div>
                                <div className="text-xs text-zinc-500">Eligible</div>
                            </div>
                            <div className="text-center">
                                <div className="text-zinc-900 dark:text-zinc-100 font-medium">{totalActive}</div>
                                <div className="text-xs text-zinc-500">Active</div>
                            </div>
                        </>
                    )}
                    <ChevronRight className="h-5 w-5 text-zinc-400" />
                </div>
            </div>
        </Link>
    );
}


// Stats card component
function StatCard({
    label,
    value,
    icon,
    color
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: "blue" | "green" | "purple" | "amber";
}) {
    const colorClasses = {
        blue: "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400",
        green: "bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400",
        purple: "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400",
        amber: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400"
    };

    return (
        <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
            <div className="flex items-center gap-2 mb-1">
                {icon}
                <span className="text-xs font-medium">{label}</span>
            </div>
            <div className="text-xl font-bold">{value}</div>
        </div>
    );
}

// Individual group row
