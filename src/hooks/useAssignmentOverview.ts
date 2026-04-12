"use client";

import { useState, useEffect, useCallback } from "react";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import {
    fetchAssignmentOverviewData,
    fetchGroupMembers,
    AssignmentOverviewEntry,
    GroupMember,
} from "@/services/directoryRoleService";
import { Logger } from "@/utils/logger";

const FALLBACK_ASSIGNMENTS: AssignmentOverviewEntry[] = [
    {
        id: "1",
        roleDefinitionId: "role1",
        principalId: "group1",
        principalType: "Group",
        principalDisplayName: "IT Admins (Demo Data)",
        assignmentType: "Eligible",
        memberType: "Direct",
    },
    {
        id: "2",
        roleDefinitionId: "role2",
        principalId: "user1",
        principalType: "User",
        principalDisplayName: "John Doe (Demo Data)",
        assignmentType: "Active",
        memberType: "Direct",
    },
];

export interface AssignmentOverviewHook {
    assignments: AssignmentOverviewEntry[];
    loading: boolean;
    error: string | null;
    groupMembers: Map<string, GroupMember[]>;
    loadGroupMembers: (groupId: string) => Promise<void>;
}

export function useAssignmentOverview(
    onDataLoad?: (inPim: number, outsidePim: number) => void,
): AssignmentOverviewHook {
    const { getGraphClient } = useUnifiedPimData();
    const [assignments, setAssignments] = useState<AssignmentOverviewEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [groupMembers, setGroupMembers] = useState<Map<string, GroupMember[]>>(new Map());

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const client = await getGraphClient();
                const { assignments: fetched, totalRoleCount } = await fetchAssignmentOverviewData(client);
                if (cancelled) return;

                setAssignments(fetched);

                if (onDataLoad) {
                    const rolesWithPim = new Set(fetched.map(a => a.roleDefinitionId));
                    onDataLoad(rolesWithPim.size, totalRoleCount - rolesWithPim.size);
                }
            } catch (err: unknown) {
                if (cancelled) return;
                Logger.error("useAssignmentOverview", "Failed to fetch assignments", err);
                setError(`Failed to load assignments: ${err instanceof Error ? err.message : "Unknown error"}`);
                setAssignments(FALLBACK_ASSIGNMENTS);
                if (onDataLoad) onDataLoad(5, 15);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [getGraphClient, onDataLoad]);

    const loadGroupMembers = useCallback(async (groupId: string) => {
        if (groupMembers.has(groupId)) return;
        try {
            const client = await getGraphClient();
            const members = await fetchGroupMembers(client, groupId);
            setGroupMembers(prev => new Map(prev).set(groupId, members));
        } catch (err) {
            Logger.error("useAssignmentOverview", "Failed to fetch group members", err);
        }
    }, [getGraphClient, groupMembers]);

    return { assignments, loading, error, groupMembers, loadGroupMembers };
}
