import { PimGroupData } from "@/types/pimGroup.types";

/**
 * Get aggregated stats across all PIM groups.
 * Pure utility function — no Graph API calls.
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
