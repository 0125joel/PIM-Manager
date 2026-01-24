/**
 * useAggregatedData Hook
 *
 * Combines data from Directory Roles and PIM Groups into unified metrics
 * for dashboard cards and charts.
 *
 * Strategy (from implementation_plan.md):
 * - Combine members + owners for main totals
 * - Provide breakdown in separate object for tooltips/detail views
 * - Only include data from VISIBLE workloads (respects toggle state)
 * - Works with ANY combination of workloads (universal/modular)
 */

import { useMemo, useState, useEffect } from "react";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { usePimData } from "@/hooks/usePimData";
import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { isWorkloadVisible } from "@/components/SettingsModal";

// Aggregated data interface
export interface AggregatedData {
    // Combined totals (for cards)
    totalItems: number;           // roles + groups
    totalEligible: number;        // all eligible assignments
    totalActive: number;          // all active assignments
    totalPermanent: number;       // all permanent assignments
    totalAssignments: number;     // all assignments combined

    // Breakdown by workload (for tooltips)
    breakdown: {
        roles: {
            count: number;
            eligible: number;
            active: number;
            permanent: number;
        };
        groups: {
            count: number;
            eligible: number;        // members + owners combined
            active: number;
            permanent: number;
            // Detailed breakdown
            eligibleMembers: number;
            activeMembers: number;
            permanentMembers: number;
            eligibleOwners: number;
            activeOwners: number;
            permanentOwners: number;
        };
    };

    // Loading state
    isLoading: boolean;
    rolesLoading: boolean;
    groupsLoading: boolean;

    // Visibility flags - respects toggle state
    hasRolesData: boolean;   // true only if roles exist AND toggle is on
    hasGroupsData: boolean;  // true only if PIM-onboarded groups exist AND toggle is on
    rolesVisible: boolean;   // whether the roles toggle is on
    groupsVisible: boolean;  // whether the groups toggle is on

    // Additional counts for insights
    pimOnboardedGroupsCount: number;    // groups that are PIM-onboarded (from beta resources endpoint)
}

// Helper: Count role assignments by type
function countRoleAssignments(rolesData: RoleDetailData[]) {
    let eligible = 0;
    let active = 0;
    let permanent = 0;

    for (const role of rolesData) {
        eligible += role.assignments?.eligible?.length || 0;
        active += role.assignments?.active?.length || 0;
        permanent += role.assignments?.permanent?.length || 0;
    }

    return { eligible, active, permanent };
}

// Helper: Count group assignments by type and access
function countGroupAssignments(groupsData: PimGroupData[]) {
    const counts = {
        eligibleMembers: 0,
        activeMembers: 0,
        permanentMembers: 0,
        eligibleOwners: 0,
        activeOwners: 0,
        permanentOwners: 0,
    };

    for (const group of groupsData) {
        for (const assignment of group.assignments || []) {
            const isOwner = assignment.accessType === "owner";
            const type = assignment.assignmentType;

            if (type === "eligible") {
                if (isOwner) counts.eligibleOwners++;
                else counts.eligibleMembers++;
            } else if (type === "active") {
                if (isOwner) counts.activeOwners++;
                else counts.activeMembers++;
            } else if (type === "permanent") {
                if (isOwner) counts.permanentOwners++;
                else counts.permanentMembers++;
            }
        }
    }

    return counts;
}

/**
 * Hook to check visibility of multiple workloads
 * Reactive to localStorage changes
 */
function useWorkloadVisibility() {
    const [visibility, setVisibility] = useState(() => ({
        directoryRoles: typeof window !== "undefined" ? isWorkloadVisible("directoryRoles") : true,
        pimGroups: typeof window !== "undefined" ? isWorkloadVisible("pimGroups") : true,
    }));

    useEffect(() => {
        const checkVisibility = () => {
            setVisibility({
                directoryRoles: isWorkloadVisible("directoryRoles"),
                pimGroups: isWorkloadVisible("pimGroups"),
            });
        };

        // Check on mount
        checkVisibility();

        // Listen for cross-tab storage changes
        window.addEventListener("storage", checkVisibility);

        // Poll for same-tab changes (localStorage doesn't fire storage event in same tab)
        const interval = setInterval(checkVisibility, 500);

        return () => {
            window.removeEventListener("storage", checkVisibility);
            clearInterval(interval);
        };
    }, []);

    return visibility;
}

/**
 * Hook to get aggregated data from all VISIBLE workloads
 *
 * Respects workload toggle state for ALL workloads:
 * - If Directory Roles toggle is OFF, role data is excluded
 * - If PIM Groups toggle is OFF, group data is excluded
 * - Works with any combination (roles only, groups only, both, neither)
 */
export function useAggregatedData(): AggregatedData {
    // Get data from both contexts
    const { rolesData: allRolesData, loading: rolesLoading, policiesLoading } = usePimData();
    const { workloads } = useUnifiedPimData();

    const allGroupsData = workloads.pimGroups.data as PimGroupData[];
    const groupsLoading = workloads.pimGroups.loading.phase === "fetching";

    // Check visibility for ALL workloads (universal/modular)
    const { directoryRoles: rolesVisible, pimGroups: groupsVisible } = useWorkloadVisibility();

    // Only use data if toggle is ON
    const rolesData = rolesVisible ? allRolesData : [];
    const groupsData = groupsVisible ? allGroupsData : [];

    // Memoize aggregation to avoid recalculating on every render
    return useMemo(() => {
        // Count role assignments (only if visible)
        const roleCounts = countRoleAssignments(rolesData);

        // groupsData now comes from beta resources endpoint = already PIM-onboarded only
        // No client-side filtering needed - the service returns correct data
        const pimOnboardedCount = groupsData.length;

        // Count group assignments
        const groupCounts = countGroupAssignments(groupsData);

        // Combined group totals (members + owners)
        const groupEligible = groupCounts.eligibleMembers + groupCounts.eligibleOwners;
        const groupActive = groupCounts.activeMembers + groupCounts.activeOwners;
        const groupPermanent = groupCounts.permanentMembers + groupCounts.permanentOwners;

        // Grand totals - use pimOnboardedCount for "Total Items" card
        const totalEligible = roleCounts.eligible + groupEligible;
        const totalActive = roleCounts.active + groupActive;
        const totalPermanent = roleCounts.permanent + groupPermanent;

        return {
            // Combined totals - groups = only PIM-onboarded, not all role-assignable
            totalItems: rolesData.length + pimOnboardedCount,
            totalEligible,
            totalActive,
            totalPermanent,
            totalAssignments: totalEligible + totalActive + totalPermanent,

            // Breakdown - groups.count = PIM-onboarded only
            breakdown: {
                roles: {
                    count: rolesData.length,
                    ...roleCounts,
                },
                groups: {
                    count: pimOnboardedCount,  // Only PIM-onboarded, not all role-assignable
                    eligible: groupEligible,
                    active: groupActive,
                    permanent: groupPermanent,
                    ...groupCounts,
                },
            },

            // Loading state
            isLoading: rolesLoading || groupsLoading,
            rolesLoading: rolesLoading || policiesLoading,
            groupsLoading,

            // Data availability - hasGroupsData is false if toggle is off OR no onboarded groups
            hasRolesData: rolesData.length > 0 && rolesVisible,
            hasGroupsData: pimOnboardedCount > 0 && groupsVisible,
            rolesVisible,
            groupsVisible,

            // Additional counts for insights
            pimOnboardedGroupsCount: pimOnboardedCount,
        };
    }, [rolesData, groupsData, rolesLoading, policiesLoading, groupsLoading, rolesVisible, groupsVisible]);
}
