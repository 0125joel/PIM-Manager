import { useState, useEffect, useCallback } from 'react';
import { useUnifiedPimData } from '@/contexts/UnifiedPimContext';
import { useToastActions } from '@/contexts/ToastContext';
import { AdminUnit, ExistingAssignment, ScopeInfo } from './assignmentTypes';
import { withRetry } from '@/utils/retryUtils';
import { Logger } from '@/utils/logger';

export type { AdminUnit, ExistingAssignment, ScopeInfo };

interface UseAssignmentDataProps {
    workload: "directoryRoles" | "pimGroups";
    selectedIds: string[];
    skipScopeFetch?: boolean;
}

export function useAssignmentData({ workload, selectedIds, skipScopeFetch }: UseAssignmentDataProps) {
    const { getGraphClient } = useUnifiedPimData();
    const { error: toastError } = useToastActions();
    const isGroups = workload === "pimGroups";

    const [adminUnits, setAdminUnits] = useState<AdminUnit[]>([]);
    const [isLoadingAUs, setIsLoadingAUs] = useState(false);
    const [scopes, setScopes] = useState<ScopeInfo[]>([]);
    const [isLoadingScopes, setIsLoadingScopes] = useState(false);
    const [existingAssignments, setExistingAssignments] = useState<ExistingAssignment[]>([]);
    const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);

    // Fetch Administrative Units (Directory Roles only) — with pagination
    useEffect(() => {
        if (isGroups) return;
        let cancelled = false;

        const fetchAUs = async () => {
            setIsLoadingAUs(true);
            try {
                const client = await getGraphClient();
                const all: AdminUnit[] = [];
                let url: string | null =
                    '/directory/administrativeUnits?$select=id,displayName,description&$top=100';

                while (url) {
                    if (cancelled) return;
                    const endpoint: string = url;
                    const res = await withRetry(
                        () => client.api(endpoint).get(),
                        3, 1000, `useAssignmentData fetchAUs ${endpoint}`
                    );
                    all.push(...(res.value || []));
                    url = (res['@odata.nextLink'] as string | undefined) ?? null;
                }
                if (!cancelled) setAdminUnits(all);
            } catch (e) {
                Logger.error("useAssignmentData", "Failed to fetch AUs", e);
            } finally {
                if (!cancelled) setIsLoadingAUs(false);
            }
        };

        fetchAUs();
        return () => { cancelled = true; };
    }, [isGroups, getGraphClient]);

    // Fetch Scope Info (Role/Group Names) — skippable for contexts that don't need display names
    useEffect(() => {
        if (skipScopeFetch) return;
        if (selectedIds.length === 0) return;
        let cancelled = false;

        const fetchScopes = async () => {
            setIsLoadingScopes(true);
            try {
                const client = await getGraphClient();
                if (workload === "directoryRoles") {
                    const fetchedScopes = await Promise.all(
                        selectedIds.map(async (id) => {
                            try {
                                const roleReq = await withRetry(
                                    () => client.api(`/roleManagement/directory/roleDefinitions/${id}`).select('id,displayName').get(),
                                    3, 1000, `useAssignmentData fetchScope role ${id}`
                                );
                                return { roleId: roleReq.id, roleName: roleReq.displayName };
                            } catch {
                                return { roleId: id, roleName: "Unknown Role" };
                            }
                        })
                    );
                    if (!cancelled) setScopes(fetchedScopes);
                } else {
                    const fetchedScopes = await Promise.all(
                        selectedIds.map(async (id) => {
                            try {
                                const groupReq = await withRetry(
                                    () => client.api(`/groups/${id}`).select('id,displayName').get(),
                                    3, 1000, `useAssignmentData fetchScope group ${id}`
                                );
                                return { groupId: groupReq.id, groupName: groupReq.displayName };
                            } catch {
                                return { groupId: id, groupName: "Unknown Group" };
                            }
                        })
                    );
                    if (!cancelled) setScopes(fetchedScopes);
                }
            } catch (e) {
                Logger.error("useAssignmentData", "Failed to fetch scopes", e);
            } finally {
                if (!cancelled) setIsLoadingScopes(false);
            }
        };

        fetchScopes();
        return () => { cancelled = true; };
    }, [selectedIds, workload, getGraphClient, skipScopeFetch]);

    // Fetch Existing Assignments
    const fetchExistingAssignments = useCallback(async () => {
        if (selectedIds.length === 0) return;
        setIsLoadingAssignments(true);
        try {
            const client = await getGraphClient();
            let allAssignments: ExistingAssignment[] = [];
            const targetId = selectedIds[0];

            if (workload === "directoryRoles") {
                try {
                    const [eligibleReq, activeReq] = await Promise.all([
                        withRetry(
                            () => client.api(`/roleManagement/directory/roleEligibilitySchedules`)
                                .filter(`roleDefinitionId eq '${targetId}'`)
                                .expand('principal')
                                .get(),
                            3, 1000, `useAssignmentData eligibleSchedules ${targetId}`
                        ),
                        withRetry(
                            () => client.api(`/roleManagement/directory/roleAssignmentSchedules`)
                                .filter(`roleDefinitionId eq '${targetId}'`)
                                .expand('principal')
                                .get(),
                            3, 1000, `useAssignmentData activeSchedules ${targetId}`
                        ),
                    ]);

                    const now = new Date();
                    const mapRoleAssignment = (item: Record<string, unknown>, type: "eligible" | "active"): ExistingAssignment => {
                        const scheduleInfo = item.scheduleInfo as Record<string, unknown> | undefined;
                        const expiration = scheduleInfo?.expiration as Record<string, unknown> | undefined;
                        const end = (expiration?.endDateTime || item.endDateTime) as string | undefined;
                        const isExpired = end && new Date(end) < now;
                        const principal = item.principal as Record<string, unknown> | undefined;
                        return {
                            id: item.id as string,
                            principalId: item.principalId as string,
                            principalDisplayName: (principal?.displayName as string) || "Unknown User",
                            roleDefinitionId: item.roleDefinitionId as string,
                            assignmentType: type,
                            memberType: (item.memberType as "Direct" | "Group") ?? "Direct",
                            startDateTime: item.startDateTime as string | undefined,
                            endDateTime: end,
                            status: isExpired ? "Expired" : "Active",
                            directoryScopeId: (item.directoryScopeId as string) || "/"
                        };
                    };

                    const elig = (eligibleReq.value || []).map((i: Record<string, unknown>) => mapRoleAssignment(i, "eligible"));
                    const act = (activeReq.value || []).map((i: Record<string, unknown>) => mapRoleAssignment(i, "active"));
                    allAssignments = [...elig, ...act];
                } catch (e) {
                    Logger.error("useAssignmentData", "Failed to fetch directory role assignments", e);
                    toastError("Failed to load assignments", "Could not retrieve existing role assignments. You can still create new ones.");
                }
            } else {
                try {
                    const [eligibleReq, activeReq] = await Promise.all([
                        withRetry(
                            () => client.api(`/identityGovernance/privilegedAccess/group/eligibilityScheduleInstances`)
                                .filter(`groupId eq '${targetId}'`)
                                .expand('principal')
                                .get(),
                            3, 1000, `useAssignmentData groupEligibleInstances ${targetId}`
                        ),
                        withRetry(
                            () => client.api(`/identityGovernance/privilegedAccess/group/assignmentScheduleInstances`)
                                .filter(`groupId eq '${targetId}'`)
                                .expand('principal')
                                .get(),
                            3, 1000, `useAssignmentData groupActiveInstances ${targetId}`
                        ),
                    ]);

                    const now = new Date();
                    const mapGroupAssignment = (item: Record<string, unknown>, type: "eligible" | "active"): ExistingAssignment => {
                        const end = item.endDateTime as string | undefined;
                        const isExpired = end && new Date(end) < now;
                        const accessId = item.accessId as string;
                        const principal = item.principal as Record<string, unknown> | undefined;
                        return {
                            id: item.id as string,
                            principalId: item.principalId as string,
                            principalDisplayName: (principal?.displayName as string) || "Unknown User",
                            roleDefinitionId: accessId,
                            roleDisplayName: accessId === "member" ? "Member" : "Owner",
                            assignmentType: type,
                            memberType: (item.memberType as "Direct" | "Group") ?? "Direct",
                            startDateTime: item.startDateTime as string | undefined,
                            endDateTime: end,
                            status: isExpired ? "Expired" : "Active",
                            directoryScopeId: "/"
                        };
                    };

                    const elig = (eligibleReq.value || []).map((i: Record<string, unknown>) => mapGroupAssignment(i, "eligible"));
                    const act = (activeReq.value || []).map((i: Record<string, unknown>) => mapGroupAssignment(i, "active"));
                    allAssignments = [...elig, ...act];
                } catch (e) {
                    Logger.error("useAssignmentData", "Failed to fetch group assignments", e);
                    toastError("Failed to load assignments", "Could not retrieve existing group assignments. You can still create new ones.");
                }
            }

            setExistingAssignments(allAssignments);
        } catch (e) {
            Logger.error("useAssignmentData", "Failed to fetch existing assignments", e);
            toastError("Failed to load assignments", "An unexpected error occurred while loading existing assignments.");
        } finally {
            setIsLoadingAssignments(false);
        }
    }, [selectedIds, workload, getGraphClient, toastError]);

    return {
        adminUnits,
        isLoadingAUs,
        scopes,
        isLoadingScopes,
        scopeName: scopes[0]?.roleName || scopes[0]?.groupName || "",
        existingAssignments,
        isLoadingAssignments,
        fetchExistingAssignments,
    };
}
