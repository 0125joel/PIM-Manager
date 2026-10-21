import { PimGroupData } from "@/types/pimGroup.types";

/**
 * Get aggregated stats across all PIM for Groups.
 * Pure utility function, no Graph API calls.
 */
export function getAggregatedGroupStats(groupData: PimGroupData[]): {
    totalGroups: number;
    totalEligibleMembers: number;
    totalActiveMembers: number;
    totalPermanentMembers: number;
    totalEligibleOwners: number;
    totalActiveOwners: number;
    totalPermanentOwners: number;
    totalAssignments: number;
} {
    let totalEligibleMembers = 0;
    let totalActiveMembers = 0;
    let totalPermanentMembers = 0;
    let totalEligibleOwners = 0;
    let totalActiveOwners = 0;
    let totalPermanentOwners = 0;
    let totalAssignments = 0;

    for (const data of groupData) {
        if (data.stats) {
            totalEligibleMembers += data.stats.eligibleMembers;
            totalActiveMembers += data.stats.activeMembers;
            totalPermanentMembers += data.stats.permanentMembers;
            totalEligibleOwners += data.stats.eligibleOwners;
            totalActiveOwners += data.stats.activeOwners;
            totalPermanentOwners += data.stats.permanentOwners;
            totalAssignments += data.stats.totalAssignments;
        }
    }

    return {
        totalGroups: groupData.length,
        totalEligibleMembers,
        totalActiveMembers,
        totalPermanentMembers,
        totalEligibleOwners,
        totalActiveOwners,
        totalPermanentOwners,
        totalAssignments
    };
}

/**
 * Role-assignable groups in the tenant and how many of them are onboarded to PIM
 * (the intersection). Card "Groups under PIM" divides the second by the first.
 * Every group in the data carries `isAssignableToRole` from the group details; unmanaged
 * groups come from the role-assignable inventory.
 */
export function getRoleAssignableCounts(groupData: PimGroupData[]): {
    roleAssignableCount: number;
    onboardedRoleAssignableCount: number;
} {
    let roleAssignableCount = 0;
    let onboardedRoleAssignableCount = 0;

    for (const data of groupData) {
        if (data.group.isAssignableToRole !== true) continue;
        roleAssignableCount++;
        if (data.isManaged !== false) onboardedRoleAssignableCount++;
    }

    return { roleAssignableCount, onboardedRoleAssignableCount };
}
