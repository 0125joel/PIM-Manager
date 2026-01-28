"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { useState, useMemo } from "react";
import { Search, Filter, ChevronRight, Shield, CheckCircle2, AlertTriangle, Users, UserCheck, Clock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

interface DashboardRoleOverviewProps {
    rolesData: RoleDetailData[];
    loading: boolean;
    viewMode?: "basic" | "advanced";
    hasUnmanagedGroups?: boolean;
}

export function DashboardRoleOverview({ rolesData, loading, viewMode = "advanced", hasUnmanagedGroups = false }: DashboardRoleOverviewProps) {
    const isBasic = viewMode === "basic";
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState<"all" | "privileged" | "pim">("all");

    // Calculate item count based on scenario
    const itemCount = isBasic
        ? (hasUnmanagedGroups ? 8 : 5)  // Basic: 8 with toggle, 5 without
        : 6;                              // Advanced: always 6

    const filteredRoles = rolesData.filter(role => {
        const matchesSearch = role.definition.displayName.toLowerCase().includes(searchTerm.toLowerCase());

        if (!matchesSearch) return false;

        if (filterType === "privileged") return role.definition.isPrivileged;
        if (filterType === "pim") return !!role.policy;

        return true;
    }).slice(0, itemCount);

    // Helper function to get policy requirements
    const getPolicyBadges = (role: RoleDetailData) => {
        if (!role.policy?.details.rules) return null;

        const approvalRule = role.policy.details.rules.find(
            (r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule"
        );
        const enablementRule = role.policy.details.rules.find(
            (r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule" &&
                r.target?.caller === "EndUser" // Fixed: was level === "Member"
        );
        const expirationRule = role.policy.details.rules.find(
            (r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule" &&
                r.target?.caller === "EndUser"
        );

        const hasApproval = approvalRule?.setting?.isApprovalRequired;
        const hasMfa = enablementRule?.enabledRules?.includes("MultiFactorAuthentication"); // Fixed: was "Mfa"
        const hasJustification = enablementRule?.enabledRules?.includes("Justification");

        let maxDuration = "N/A";
        if (expirationRule?.maximumDuration) {
            const duration = expirationRule.maximumDuration;
            const hours = duration.includes("H") ? parseInt(duration.match(/(\d+)H/)?.[1] || "0") : 0;
            const days = duration.includes("D") ? parseInt(duration.match(/(\d+)D/)?.[1] || "0") : 0;
            const totalHours = hours + (days * 24);

            if (totalHours < 1) maxDuration = "<1h";
            else if (totalHours <= 8) maxDuration = `${totalHours}h`;
            else if (totalHours <= 24) maxDuration = `${totalHours}h`;
            else maxDuration = `${Math.round(totalHours / 24)}d`;
        }

        return { hasApproval, hasMfa, hasJustification, maxDuration };
    };

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-8 w-48 bg-zinc-100 dark:bg-zinc-800 rounded mb-6 animate-pulse" />
                <div className="space-y-4">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    // Card should be large (h-full) except for basic view without toggle
    const isLargeCard = !isBasic || hasUnmanagedGroups;

    return (
        <div className={`bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col ${isLargeCard ? "h-full" : "h-[580px]"}`}>
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                    Role overview
                </h3>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                        <input
                            type="text"
                            placeholder="Search roles..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value as any)}
                        className="px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="all">All roles</option>
                        <option value="privileged">Privileged only</option>
                        <option value="pim">PIM configured</option>
                    </select>
                </div>
            </div>

            <div className={`divide-y divide-zinc-200 dark:divide-zinc-800 flex-1 min-h-0 ${isLargeCard ? "overflow-y-auto" : ""}`}>
                    {filteredRoles.map((role) => {
                    const policyBadges = getPolicyBadges(role);
                    const totalAssignments = role.assignments.permanent.length + role.assignments.eligible.length + role.assignments.active.length;

                    return (
                        <Link
                            key={role.definition.id}
                            href={`/report?search=${encodeURIComponent(role.definition.displayName)}`}
                            className="block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group"
                        >
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4 flex-1">
                                    <div className={`p-2 rounded-lg ${role.definition.isPrivileged ? 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                                        <Shield className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100 mb-2">
                                            {role.definition.displayName}
                                        </h4>

                                        {/* Basic mode: simplified badges */}
                                        {isBasic ? (
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {role.policy && (
                                                    <Badge
                                                        icon={<CheckCircle2 className="h-3 w-3" />}
                                                        label="PIM configured"
                                                        variant="success"
                                                    />
                                                )}
                                                {totalAssignments > 0 ? (
                                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                                        {totalAssignments} assignment{totalAssignments !== 1 ? 's' : ''}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-zinc-400">No assignments</span>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                {/* Advanced mode: detailed assignment counts */}
                                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                                    {role.assignments.permanent.length > 0 && (
                                                        <Badge
                                                            icon={<Users className="h-3 w-3" />}
                                                            label={`${role.assignments.permanent.length} Permanent`}
                                                            variant="amber"
                                                        />
                                                    )}
                                                    {role.assignments.eligible.length > 0 && (
                                                        <Badge
                                                            icon={<UserCheck className="h-3 w-3" />}
                                                            label={`${role.assignments.eligible.length} Eligible`}
                                                            variant="green"
                                                        />
                                                    )}
                                                    {role.assignments.active.length > 0 && (
                                                        <Badge
                                                            icon={<Clock className="h-3 w-3" />}
                                                            label={`${role.assignments.active.length} Active`}
                                                            variant="blue"
                                                        />
                                                    )}
                                                    {totalAssignments === 0 && (
                                                        <span className="text-xs text-zinc-500">No assignments</span>
                                                    )}
                                                </div>

                                                {/* Advanced mode: policy badges */}
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {role.policy ? (
                                                        <>
                                                            <Badge
                                                                icon={<CheckCircle2 className="h-3 w-3" />}
                                                                label="PIM"
                                                                variant="success"
                                                            />
                                                            {policyBadges?.hasApproval && (
                                                                <Badge label="Approval" variant="purple" />
                                                            )}
                                                            {policyBadges?.hasMfa && (
                                                                <Badge label="MFA" variant="blue" />
                                                            )}
                                                            {policyBadges?.hasJustification && (
                                                                <Badge label="Justification" variant="indigo" />
                                                            )}
                                                            {policyBadges?.maxDuration && policyBadges.maxDuration !== "N/A" && (
                                                                <Badge label={`Max: ${policyBadges.maxDuration}`} variant="orange" />
                                                            )}
                                                        </>
                                                    ) : (
                                                        <Badge label="No policy" variant="neutral" />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <ChevronRight className="h-5 w-5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors flex-shrink-0" />
                            </div>
                        </Link>
                    );
                })}

                {filteredRoles.length === 0 && (
                    <div className="p-8 text-center text-zinc-500">
                        No roles found matching your filters.
                    </div>
                )}
            </div>

            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800 text-center">
                <Link href="/report?workload=directoryRoles" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                    View full report &rarr;
                </Link>
            </div>
        </div>
    );
}
