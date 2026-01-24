"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { RoleFilterState } from "@/types/roleFilters";
import { Shield, Users, Clock, CheckCircle2, UserCheck, FileCheck, Loader2, FolderKanban } from "lucide-react";
import { useMemo } from "react";
import { InteractiveStatCard } from "@/components/InteractiveStatCard";
import { useAggregatedData } from "@/hooks/useAggregatedData";

interface OverviewCardsProps {
    rolesData: RoleDetailData[];
    loading: boolean;
    policiesLoading?: boolean;
    onFilterClick?: (key: keyof RoleFilterState, value: string) => void;
    viewMode?: "basic" | "advanced";
}

export function OverviewCards({ rolesData, loading, policiesLoading = false, onFilterClick, viewMode = "advanced" }: OverviewCardsProps) {
    const isBasic = viewMode === "basic";

    // Use aggregated data from all workloads
    const aggregated = useAggregatedData();

    const stats = useMemo(() => {
        // Role-specific stats
        const totalRoles = rolesData.length;
        const customRoles = rolesData.filter(r => !r.definition.isBuiltIn).length;

        // Policy-dependent stats
        const privilegedRoles = rolesData.filter(r => r.definition.isPrivileged);
        const rolesWithPolicy = privilegedRoles.filter(r => r.policy);
        const pimCoverage = privilegedRoles.length > 0
            ? Math.round((rolesWithPolicy.length / privilegedRoles.length) * 100)
            : 0;

        const rolesRequiringApproval = rolesData.filter(r => {
            const approvalRule = r.policy?.details.rules?.find(
                (rule: any) => rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule"
            );
            return approvalRule?.setting?.isApprovalRequired;
        }).length;

        return {
            totalRoles,
            customRoles,
            pimCoverage,
            rolesRequiringApproval,
        };
    }, [rolesData]);

    // Build description strings that show breakdown when groups are loaded
    const getBreakdownDescription = (roleCount: number, groupCount: number, groupLabel: string) => {
        if (!aggregated.hasGroupsData || groupCount === 0) {
            return undefined; // No breakdown needed
        }
        return `${roleCount} roles + ${groupCount} ${groupLabel}`;
    };

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 animate-pulse h-32" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* Total Items - Roles + Groups combined */}
            <InteractiveStatCard
                title={aggregated.hasGroupsData ? "Total Items" : "Total Roles"}
                value={aggregated.totalItems}
                icon={aggregated.hasGroupsData ? FolderKanban : Shield}
                color="blue"
                description={aggregated.hasGroupsData
                    ? `${aggregated.breakdown.roles.count} roles + ${aggregated.breakdown.groups.count} groups`
                    : "Total roles fetched"}
                onClick={onFilterClick ? () => onFilterClick('filterHasAssignments', 'all') : undefined}
            />

            {/* Active Sessions - Combined */}
            <InteractiveStatCard
                title="Active Sessions"
                value={aggregated.totalActive}
                icon={Clock}
                color="green"
                description={getBreakdownDescription(
                    aggregated.breakdown.roles.active,
                    aggregated.breakdown.groups.active,
                    "group assignments"
                ) || "Currently active assignments"}
            />

            {/* Permanent Assignments - Combined */}
            <InteractiveStatCard
                title="Permanent Assignments"
                value={aggregated.totalPermanent}
                icon={Users}
                color="amber"
                description={getBreakdownDescription(
                    aggregated.breakdown.roles.permanent,
                    aggregated.breakdown.groups.permanent,
                    "group assignments"
                ) || "Always-on access"}
                filterKey="assignmentType"
                filterValue="permanent"
                onClick={onFilterClick ? () => onFilterClick('filterAssignmentType', 'permanent') : undefined}
            />

            {/* PIM Coverage - Roles only (policies are role-specific) */}
            {policiesLoading ? (
                <StatCardLoading
                    title="PIM Coverage"
                    description="Loading policy data..."
                    color="purple"
                />
            ) : (
                <InteractiveStatCard
                    title="PIM Coverage"
                    value={`${stats.pimCoverage}%`}
                    icon={CheckCircle2}
                    color="purple"
                    description="Privileged roles with policy"
                    filterKey="pimConfigured"
                    filterValue="configured"
                    onClick={onFilterClick ? () => onFilterClick('filterPimConfigured', 'configured') : undefined}
                />
            )}

            {/* Advanced-only cards */}
            {!isBasic && (
                <>
                    {/* Eligible Assignments - Combined */}
                    <InteractiveStatCard
                        title="Eligible Assignments"
                        value={aggregated.totalEligible}
                        icon={UserCheck}
                        color="emerald"
                        description={getBreakdownDescription(
                            aggregated.breakdown.roles.eligible,
                            aggregated.breakdown.groups.eligible,
                            "group assignments"
                        ) || "Users ready to activate"}
                        filterKey="assignmentType"
                        filterValue="eligible"
                        onClick={onFilterClick ? () => onFilterClick('filterAssignmentType', 'eligible') : undefined}
                    />
                    <InteractiveStatCard
                        title="Custom Roles"
                        value={stats.customRoles}
                        icon={FileCheck}
                        color="indigo"
                        description="Custom roles in use"
                        filterKey="roleType"
                        filterValue="custom"
                        onClick={onFilterClick ? () => onFilterClick('filterRoleType', 'custom') : undefined}
                    />
                    {policiesLoading ? (
                        <StatCardLoading
                            title="Approval Required"
                            description="Loading policy data..."
                            color="pink"
                        />
                    ) : (
                        <InteractiveStatCard
                            title="Approval Required"
                            value={stats.rolesRequiringApproval}
                            icon={CheckCircle2}
                            color="pink"
                            description="Roles with approval workflow"
                            filterKey="approval"
                            filterValue="yes"
                            onClick={onFilterClick ? () => onFilterClick('filterApprovalRequired', 'yes') : undefined}
                        />
                    )}
                </>
            )}
        </div>
    );
}

function StatCardLoading({ title, description, color }: { title: string; description: string; color: string }) {
    const colors = {
        purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
        pink: "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400",
    };

    return (
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${colors[color as keyof typeof colors]}`}>
                    <Loader2 className="h-6 w-6 animate-spin" />
                </div>
            </div>
            <div className="h-8 w-16 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse mb-1" />
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1">
                {title}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {description}
            </p>
        </div>
    );
}
