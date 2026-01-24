"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { RoleFilterState } from "@/types/roleFilters";
import { useMemo, useState, useEffect, useRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Loader2 } from "lucide-react";
import { useWorkloadVisibility } from "@/components/WorkloadChips";
import { getAuthContextDisplayName, AuthenticationContext } from "@/utils/authContextApi";

// Helper to get memberType from assignment
// Permanent assignments don't have memberType, so we derive it from principal type
function getMemberType(assignment: any): "Direct" | "Group" | null {
    // PIM schedules have memberType directly
    if (assignment.memberType) {
        return assignment.memberType;
    }
    // Permanent assignments: derive from principal @odata.type
    if (assignment.principal?.["@odata.type"]) {
        const odataType = assignment.principal["@odata.type"].toLowerCase();
        if (odataType.includes("group")) {
            return "Group";
        }
        return "Direct";
    }
    return null;
}

interface SecurityChartsProps {
    rolesData: RoleDetailData[];
    groupsData?: PimGroupData[];  // NEW: Combined with rolesData for charts
    loading: boolean;
    policiesLoading?: boolean;
    onFilterClick?: (key: keyof RoleFilterState, value: string) => void;
    viewMode?: "basic" | "advanced";
    activeFilters?: {
        assignmentType?: string;
        memberType?: string;
    };
    onChartsDataReady?: (data: ChartsData) => void;
    authenticationContexts?: AuthenticationContext[]; // NEW: For friendly names in Auth Context chart
}

// Export type for PDF generation
export interface ChartsData {
    assignmentData: { name: string; value: number; color: string }[];
    assignmentMethodData: { name: string; value: number; color: string }[];
    mfaData: { name: string; value: number; color: string }[];
    approvalData: { name: string; value: number; color: string }[];
    durationData: { name: string; value: number; color: string }[];
    managedData: { name: string; value: number; color: string }[];
    authContextData: { name: string; value: number; color: string }[]; // NEW: Auth Context distribution
}

export function SecurityCharts({ rolesData, groupsData = [], loading, policiesLoading = false, onFilterClick, viewMode = "advanced", activeFilters, onChartsDataReady, authenticationContexts = [] }: SecurityChartsProps) {
    const isBasic = viewMode === "basic";
    const [showAllRoles, setShowAllRoles] = useState(true);

    // Toggle states for "Only" vs "Has Any" mode
    const [assignmentChartMode, setAssignmentChartMode] = useState<'only' | 'hasAny'>('hasAny');
    const [memberChartMode, setMemberChartMode] = useState<'only' | 'hasAny'>('hasAny');

    // Workload visibility - charts should reflect enabled workloads
    const isDirectoryRolesVisible = useWorkloadVisibility("directoryRoles");
    const isPimGroupsVisible = useWorkloadVisibility("pimGroups");
    const isUnmanagedVisible = useWorkloadVisibility("unmanagedGroups");

    // Delay chart rendering until after mount to prevent ResponsiveContainer dimension errors
    const [isMounted, setIsMounted] = useState(false);
    useEffect(() => {
        setIsMounted(true);
    }, []);

    const chartsData = useMemo(() => {
        // Calculate group assignments for combined totals
        const groupStats = {
            eligible: isPimGroupsVisible ? groupsData.reduce((sum, g) =>
                sum + g.assignments.filter(a => a.assignmentType === "eligible").length, 0) : 0,
            active: isPimGroupsVisible ? groupsData.reduce((sum, g) =>
                sum + g.assignments.filter(a => a.assignmentType === "active").length, 0) : 0,
            permanent: isPimGroupsVisible ? groupsData.reduce((sum, g) =>
                sum + g.assignments.filter(a => a.assignmentType === "permanent").length, 0) : 0,
        };

        // Calculate role assignments (only if visible)
        const roleStats = {
            eligible: isDirectoryRolesVisible ? rolesData.reduce((sum, role) =>
                sum + (role.assignments?.eligible?.length || 0), 0) : 0,
            active: isDirectoryRolesVisible ? rolesData.reduce((sum, role) =>
                sum + (role.assignments?.active?.length || 0), 0) : 0,
            permanent: isDirectoryRolesVisible ? rolesData.reduce((sum, role) =>
                sum + (role.assignments?.permanent?.length || 0), 0) : 0,
        };

        // Chart 1: Permanent vs Eligible (COMBINED from all enabled workloads)
        let assignmentData: { name: string; value: number; color: string }[];


        if (assignmentChartMode === 'only' && activeFilters?.assignmentType) {
            // Only mode with active filter - show just that type (combined from all workloads)
            const filterType = activeFilters.assignmentType;
            let count = 0;
            let name = '';
            let color = '';

            if (filterType === 'permanent') {
                count = roleStats.permanent + groupStats.permanent;
                name = 'Permanent';
                color = '#f59e0b';
            } else if (filterType === 'eligible') {
                count = roleStats.eligible + groupStats.eligible;
                name = 'Eligible';
                color = '#10b981';
            } else if (filterType === 'active') {
                count = roleStats.active + groupStats.active;
                name = 'Active';
                color = '#3b82f6';
            }

            assignmentData = count > 0 ? [{ name, value: count, color }] : [];
        } else {
            // Has Any mode or no filter - show full mix (COMBINED from all enabled workloads)
            const totalPermanent = roleStats.permanent + groupStats.permanent;
            const totalEligible = roleStats.eligible + groupStats.eligible;

            assignmentData = [
                { name: "Permanent", value: totalPermanent, color: "#f59e0b" },
                { name: "Eligible", value: totalEligible, color: "#10b981" },
            ];
        }

        // Chart 2: Assignment Method - Direct vs Group (fast - no policy needed)
        // Only count from visible workloads
        let assignmentMethodData: { name: string; value: number; color: string }[];

        // Filtered roles based on visibility
        const visibleRoles = isDirectoryRolesVisible ? rolesData : [];

        if (memberChartMode === 'only' && activeFilters?.memberType) {
            const filterType = activeFilters.memberType;
            let count = 0;
            let name = '';
            let color = '';

            if (filterType === 'direct') {
                count = visibleRoles.reduce((sum, role) => {
                    return sum + [
                        ...role.assignments.eligible,
                        ...role.assignments.active,
                        ...role.assignments.permanent
                    ].filter((a: any) => getMemberType(a) === "Direct").length;
                }, 0);
                name = 'Direct';
                color = '#3b82f6';
            } else if (filterType === 'group') {
                count = visibleRoles.reduce((sum, role) => {
                    return sum + [
                        ...role.assignments.eligible,
                        ...role.assignments.active,
                        ...role.assignments.permanent
                    ].filter((a: any) => getMemberType(a) === "Group").length;
                }, 0);
                name = 'Group';
                color = '#8b5cf6';
            }

            assignmentMethodData = count > 0 ? [{ name, value: count, color }] : [];
        } else {
            // Has Any mode or no filter - show full mix (only from visible roles)
            const directAssignments = visibleRoles.reduce((sum, role) => {
                const direct = [
                    ...role.assignments.eligible,
                    ...role.assignments.active,
                    ...role.assignments.permanent
                ].filter((a: any) => getMemberType(a) === "Direct").length;
                return sum + direct;
            }, 0);

            const groupAssignments = visibleRoles.reduce((sum, role) => {
                const group = [
                    ...role.assignments.eligible,
                    ...role.assignments.active,
                    ...role.assignments.permanent
                ].filter((a: any) => getMemberType(a) === "Group").length;
                return sum + group;
            }, 0);

            assignmentMethodData = [
                { name: "Direct", value: directAssignments, color: "#3b82f6" },
                { name: "Group", value: groupAssignments, color: "#8b5cf6" },
            ];
        }

        // Chart 3: MFA & CA Enforcement (slow - requires policy)
        // Combine data from both Directory Roles and PIM Groups based on visibility
        const targetRoles = isDirectoryRolesVisible
            ? (showAllRoles ? rolesData : rolesData.filter(r => r.definition.isPrivileged))
            : [];

        let pimNativeMfa = 0;
        let conditionalAccess = 0;
        let noMfaOrCa = 0;

        // Count from Directory Roles
        targetRoles.forEach(role => {
            const enablementRule = role.policy?.details.rules?.find(
                (rule: any) =>
                    rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule" &&
                    rule.target?.caller === "EndUser"
            );

            const authContextRule = role.policy?.details.rules?.find(
                (rule: any) =>
                    rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule" &&
                    rule.target?.caller === "EndUser"
            );

            const hasPimMfa = enablementRule?.enabledRules?.includes("MultiFactorAuthentication");
            const hasConditionalAccess = authContextRule?.isEnabled && authContextRule?.claimValue;

            if (hasPimMfa) {
                pimNativeMfa++;
            } else if (hasConditionalAccess) {
                conditionalAccess++;
            } else {
                noMfaOrCa++;
            }
        });

        // Count from PIM Groups (if visible) - check member AND owner policies
        if (isPimGroupsVisible) {
            groupsData.forEach(group => {
                if (group.settings) {
                    // Count member policy MFA
                    if (group.settings.memberRequiresMfa) {
                        pimNativeMfa++;
                    } else {
                        noMfaOrCa++;
                    }
                    // Count owner policy MFA (separate count)
                    if (group.settings.ownerRequiresMfa) {
                        pimNativeMfa++;
                    } else {
                        noMfaOrCa++;
                    }
                } else if (group.policies) {
                    // Fallback: no settings yet, count as unknown
                    noMfaOrCa += 2; // member + owner
                }
            });
        }

        const mfaData = [
            { name: "Azure MFA", value: pimNativeMfa, color: "#3b82f6" },
            { name: "Conditional Access", value: conditionalAccess, color: "#8b5cf6" },
            { name: "None", value: noMfaOrCa, color: "#6b7280" },
        ];

        // Chart 4: Approval Requirements (slow - requires policy)
        // Combine data from both Directory Roles and PIM Groups
        const visibleRolesForPolicy = isDirectoryRolesVisible ? rolesData : [];

        let withApproval = 0;
        let withoutApproval = 0;

        // Count from Directory Roles
        visibleRolesForPolicy.forEach(r => {
            const approvalRule = r.policy?.details.rules?.find(
                (rule: any) => rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule"
            );
            if (approvalRule?.setting?.isApprovalRequired) {
                withApproval++;
            } else {
                withoutApproval++;
            }
        });

        // Count from PIM Groups (if visible) - check member AND owner policies
        if (isPimGroupsVisible) {
            groupsData.forEach(group => {
                if (group.settings) {
                    // Member policy
                    if (group.settings.memberRequiresApproval) withApproval++;
                    else withoutApproval++;
                    // Owner policy
                    if (group.settings.ownerRequiresApproval) withApproval++;
                    else withoutApproval++;
                } else {
                    withoutApproval += 2; // Fallback
                }
            });
        }

        const approvalData = [
            { name: "Approval Required", value: withApproval, color: "#8b5cf6" },
            { name: "No Approval", value: withoutApproval, color: "#6b7280" },
        ];

        // Chart 5: Max Duration Distribution (slow - requires policy)
        // Combine data from both Directory Roles and PIM Groups
        const durationBuckets = { "<1h": 0, "2-4h": 0, "5-8h": 0, "9-12h": 0, ">12h": 0, "N/A": 0 };

        // Helper to categorize duration
        const categorizeDuration = (isoDuration?: string) => {
            if (!isoDuration) {
                durationBuckets["N/A"]++;
                return;
            }
            const hours = isoDuration.includes("H") ? parseInt(isoDuration.match(/(\d+)H/)?.[1] || "0") : 0;
            const days = isoDuration.includes("D") ? parseInt(isoDuration.match(/(\d+)D/)?.[1] || "0") : 0;
            const totalHours = hours + (days * 24);

            if (totalHours <= 1) durationBuckets["<1h"]++;
            else if (totalHours >= 2 && totalHours <= 4) durationBuckets["2-4h"]++;
            else if (totalHours >= 5 && totalHours <= 8) durationBuckets["5-8h"]++;
            else if (totalHours >= 9 && totalHours <= 12) durationBuckets["9-12h"]++;
            else durationBuckets[">12h"]++;
        };

        // Count from Directory Roles
        visibleRolesForPolicy.forEach(role => {
            const expirationRule = role.policy?.details.rules?.find(
                (r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule" &&
                    r.target?.caller === "EndUser"
            );
            categorizeDuration(expirationRule?.maximumDuration);
        });

        // Count from PIM Groups (if visible) - check member AND owner policies
        if (isPimGroupsVisible) {
            groupsData.forEach(group => {
                if (group.settings) {
                    categorizeDuration(group.settings.memberMaxDuration);
                    categorizeDuration(group.settings.ownerMaxDuration);
                } else {
                    durationBuckets["N/A"] += 2; // Fallback
                }
            });
        }

        const durationData = Object.entries(durationBuckets).map(([name, value]) => ({
            name,
            value,
            color: name === "N/A" ? "#6b7280" :      // Gray
                name === "<1h" ? "#10b981" :          // Green (strict)
                    name === "2-4h" ? "#22c55e" :     // Light green
                        name === "5-8h" ? "#3b82f6" : // Blue (standard workday)
                            name === "9-12h" ? "#f59e0b" : // Amber (extended)
                                "#ef4444"                   // Red (permissive)
        }));

        // Chart 6: Managed vs Unmanaged Groups
        // Use groupsData directly
        const managedCount = groupsData.filter(g => g.isManaged !== false).length;
        const unmanagedCount = groupsData.filter(g => g.isManaged === false).length;

        const managedData = [
            { name: "Managed", value: managedCount, color: "#10b981" }, // Green
            { name: "Unmanaged", value: unmanagedCount, color: "#ef4444" } // Red
        ];

        // Chart 7: Auth Context Distribution (counts which CA contexts are in use)
        // Track distinct authentication contexts and how many roles use each
        const authContextCounts: Record<string, { count: number; contextId: string }> = {};

        // Only count from visible Directory Roles
        const rolesForAuthContext = isDirectoryRolesVisible ? rolesData : [];
        rolesForAuthContext.forEach(role => {
            const authContextRule = role.policy?.details.rules?.find(
                (r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule" &&
                    r.target?.caller === "EndUser"
            );
            const claimValue = authContextRule?.claimValue;
            if (authContextRule?.isEnabled && claimValue) {
                if (!authContextCounts[claimValue]) {
                    authContextCounts[claimValue] = { count: 0, contextId: claimValue };
                }
                authContextCounts[claimValue].count++;
            }
        });

        // Generate distinct colors for auth contexts using a color palette
        const authContextColors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#f43f5e"];
        const authContextData = Object.entries(authContextCounts).map(([contextId, data], index) => {
            // Use friendly name from authenticationContexts, fallback to contextId
            const friendlyName = getAuthContextDisplayName(authenticationContexts, contextId);
            return {
                name: friendlyName || contextId,
                value: data.count,
                color: authContextColors[index % authContextColors.length]
            };
        });

        return { assignmentData, assignmentMethodData, mfaData, approvalData, durationData, managedData, authContextData };
    }, [rolesData, groupsData, showAllRoles, assignmentChartMode, memberChartMode, activeFilters, isDirectoryRolesVisible, isPimGroupsVisible, isUnmanagedVisible, authenticationContexts]);

    // Expose charts data for PDF export - use ref to prevent infinite loops
    const lastDataHashRef = useRef<string>("");
    useEffect(() => {
        if (onChartsDataReady && chartsData) {
            // Create a simple hash of the data to detect actual changes
            const dataHash = JSON.stringify({
                a: chartsData.assignmentData.map(d => d.value),
                m: chartsData.mfaData.map(d => d.value),
                ap: chartsData.approvalData.map(d => d.value),
                d: chartsData.durationData.map(d => d.value),
                mg: chartsData.managedData.map(d => d.value),
            });
            if (dataHash !== lastDataHashRef.current) {
                lastDataHashRef.current = dataHash;
                onChartsDataReady(chartsData);
            }
        }
    }, [chartsData, onChartsDataReady]);

    // CRITICAL: Don't render ANY charts until after mount (prevents width/height console errors)
    // This must come FIRST because cached data can make rolesData.length > 0 before mount
    if (!isMounted) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {[1, 2].map((i) => (
                    <div key={i} className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 h-80 animate-pulse" />
                ))}
            </div>
        );
    }

    if (loading) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {[1, 2].map((i) => (
                    <div key={i} className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 h-80 animate-pulse" />
                ))}
            </div>
        );
    }

    // Don't render charts until data is available
    if (rolesData.length === 0) {
        return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {[1, 2].map((i) => (
                    <div key={i} className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 h-80 flex items-center justify-center">
                        <p className="text-zinc-500">No data available</p>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={`grid grid-cols-1 ${isBasic ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6 mb-8`}>
            {/* Chart 1: Assignment Distribution (fast) */}
            <div id="chart-assignment" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                            Assignment Distribution
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Permanent vs eligible role assignments
                        </p>
                    </div>
                    {activeFilters?.assignmentType && (
                        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                            <button
                                onClick={() => setAssignmentChartMode('only')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${assignmentChartMode === 'only'
                                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    }`}
                            >
                                Only
                            </button>
                            <button
                                onClick={() => setAssignmentChartMode('hasAny')}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${assignmentChartMode === 'hasAny'
                                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    }`}
                            >
                                Has Any
                            </button>
                        </div>
                    )}
                </div>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                        <PieChart>
                            <Pie
                                data={chartsData.assignmentData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                onClick={(data) => {
                                    if (onFilterClick && data.name) {
                                        const value = data.name.toLowerCase();
                                        onFilterClick('filterAssignmentType', value);
                                    }
                                }}
                                cursor="pointer"
                            >
                                {chartsData.assignmentData.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.color}
                                        stroke="#3b82f6"
                                        strokeWidth={0}
                                    />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                itemStyle={{ color: '#fff' }}
                            />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Chart 2: Assignment Method (fast) - Advanced only */}
            {!isBasic && (
                <div id="chart-member-type" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Assignment Method
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Direct user vs group-based assignments
                            </p>
                        </div>
                        {activeFilters?.memberType && (
                            <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                                <button
                                    onClick={() => setMemberChartMode('only')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${memberChartMode === 'only'
                                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                        }`}
                                >
                                    Only
                                </button>
                                <button
                                    onClick={() => setMemberChartMode('hasAny')}
                                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${memberChartMode === 'hasAny'
                                        ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                        }`}
                                >
                                    Has Any
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                            <PieChart>
                                <Pie
                                    data={chartsData.assignmentMethodData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    onClick={(data) => {
                                        if (onFilterClick && data.name) {
                                            const value = data.name.toLowerCase();
                                            onFilterClick('filterMemberType', value);
                                        }
                                    }}
                                    cursor="pointer"
                                >
                                    {chartsData.assignmentMethodData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.color}
                                            stroke="#3b82f6"
                                            strokeWidth={0}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Chart 3: MFA & CA Enforcement (slow - policy dependent) */}
            {policiesLoading ? (
                <ChartLoading title="MFA & CA Enforcement" />
            ) : (
                <div id="chart-mfa" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                MFA & CA Enforcement
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Authentication requirements for activation
                            </p>
                        </div>
                        <div className="flex items-center gap-2 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
                            <button
                                onClick={() => setShowAllRoles(false)}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${!showAllRoles
                                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    }`}
                            >
                                Privileged
                            </button>
                            <button
                                onClick={() => setShowAllRoles(true)}
                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${showAllRoles
                                    ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                                    : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                                    }`}
                            >
                                All Roles
                            </button>
                        </div>
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                            <PieChart>
                                <Pie
                                    data={chartsData.mfaData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    onClick={(data) => {
                                        if (onFilterClick && data.name) {
                                            // Map chart names to filter values
                                            let filterValue = 'all';
                                            if (data.name === 'Azure MFA') filterValue = 'azure-mfa';
                                            else if (data.name === 'Conditional Access') filterValue = 'ca-any';
                                            else if (data.name === 'None') filterValue = 'none';
                                            if (filterValue !== 'all') {
                                                onFilterClick('filterMfaRequired', filterValue);
                                            }
                                        }
                                    }}
                                    cursor="pointer"
                                >
                                    {chartsData.mfaData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.color}
                                            stroke="#3b82f6"
                                            strokeWidth={0}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* Chart 4: Approval Requirements (slow - policy dependent) - Advanced only */}
            {!isBasic && (
                <div id="chart-approval" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    {policiesLoading ? (
                        <div className="h-64 flex items-center justify-center">
                            <div className="text-center">
                                <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading Approval Data...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Approval Requirements
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                                Roles requiring manager approval
                            </p>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                                    <PieChart>
                                        <Pie
                                            data={chartsData.approvalData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            onClick={(data) => {
                                                if (onFilterClick && data.name) {
                                                    const value = data.name.toLowerCase();
                                                    onFilterClick('filterApprovalRequired', value);
                                                }
                                            }}
                                            cursor="pointer"
                                        >
                                            {chartsData.approvalData.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.color}
                                                    stroke="#3b82f6"
                                                    strokeWidth={0}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Chart 5: Max Duration Distribution (slow - policy dependent) - Advanced only */}
            {!isBasic && (
                <div id="chart-duration" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    {policiesLoading ? (
                        <div className="h-64 flex items-center justify-center">
                            <div className="text-center">
                                <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading Duration Data...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                                Max Activation Duration
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                                Maximum allowed time for activation
                            </p>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                                    <BarChart data={chartsData.durationData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                                        <XAxis dataKey="name" stroke="#9ca3af" />
                                        <YAxis stroke="#9ca3af" />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Bar
                                            dataKey="value"
                                            radius={[8, 8, 0, 0]}
                                            onClick={(data) => {
                                                if (onFilterClick && data.name && data.name !== 'N/A') {
                                                    onFilterClick('filterMaxDuration', data.name);
                                                }
                                            }}
                                            cursor="pointer"
                                        >
                                            {chartsData.durationData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Chart 6: Authentication Contexts Distribution (Advanced only) */}
            {!isBasic && chartsData.authContextData.length > 0 && (
                <div id="chart-auth-contexts" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    {policiesLoading ? (
                        <div className="h-64 flex items-center justify-center">
                            <div className="text-center">
                                <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
                                <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading Auth Context Data...</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                                Authentication Contexts
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                                Roles using CA Authentication Contexts ({chartsData.authContextData.reduce((sum, d) => sum + d.value, 0)} total)
                            </p>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                                    <PieChart>
                                        <Pie
                                            data={chartsData.authContextData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            onClick={(data) => {
                                                if (onFilterClick && data.name) {
                                                    // Filter by specific CA context
                                                    onFilterClick('filterMfaRequired', `ca:${data.name}`);
                                                }
                                            }}
                                            cursor="pointer"
                                        >
                                            {chartsData.authContextData.map((entry, index) => (
                                                <Cell
                                                    key={`cell-${index}`}
                                                    fill={entry.color}
                                                    stroke="#3b82f6"
                                                    strokeWidth={0}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                            itemStyle={{ color: '#fff' }}
                                            formatter={(value: number, name: string) => [`${value} roles`, name]}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Chart 7: Managed vs Unmanaged Groups (Advanced only) */}
            {!isBasic && isPimGroupsVisible && isUnmanagedVisible && (
                <div id="chart-managed-groups" className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
                    <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                        PIM Groups Coverage
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
                        Managed vs unmanaged groups
                    </p>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                            <PieChart>
                                <Pie
                                    data={chartsData.managedData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                    onClick={(data) => {
                                        // TODO: Add filtering hook if desired, though GroupsOverview handles this via chips
                                    }}
                                    cursor="pointer"
                                >
                                    {chartsData.managedData.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.color}
                                            stroke="#3b82f6"
                                            strokeWidth={0}
                                        />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', color: '#fff' }}
                                    itemStyle={{ color: '#fff' }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
}

function ChartLoading({ title }: { title: string }) {
    return (
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
                {title}
            </h3>
            <div className="h-64 flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading policy data...</p>
                </div>
            </div>
        </div>
    );
}
