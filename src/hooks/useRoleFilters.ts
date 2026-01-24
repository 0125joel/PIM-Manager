import { useState, useMemo, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { RoleFilterState, AvailableFilterOptions, FilterGroupStates } from "@/types/roleFilters";

// Helper to get memberType from assignment
// Permanent assignments don't have memberType, so we derive it from principal type
function getMemberType(assignment: any): "Direct" | "Group" | null {
    // First check if memberType is directly available
    if (assignment.memberType) {
        return assignment.memberType === "Group" ? "Group" : "Direct";
    }
    // Fall back to checking principal type
    if (assignment.principal) {
        const principalType = assignment.principal["@odata.type"] || "";
        if (principalType.includes("group")) {
            return "Group";
        }
        if (principalType.includes("user")) {
            return "Direct";
        }
    }
    return null;
}

export function useRoleFilters(rolesData: RoleDetailData[], groupsData: PimGroupData[] = [], isManagedGroupsVisible: boolean = true, isUnmanagedGroupsVisible: boolean = true) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // Read filter state from URL parameters (source of truth)
    const searchTerm = searchParams?.get('search') || '';
    const filterUser = searchParams?.get('user') || '';
    const filterRoleType = (searchParams?.get('roleType') as RoleFilterState['filterRoleType']) || 'all';
    const filterAssignmentType = (searchParams?.get('assignmentType') as RoleFilterState['filterAssignmentType']) || 'all';
    const filterMemberType = (searchParams?.get('memberType') as RoleFilterState['filterMemberType']) || 'all';
    const filterDuration = (searchParams?.get('duration') as RoleFilterState['filterDuration']) || 'all';
    const filterPrivileged = (searchParams?.get('privileged') as RoleFilterState['filterPrivileged']) || 'all';
    const filterPimConfigured = (searchParams?.get('pimConfigured') as RoleFilterState['filterPimConfigured']) || 'all';
    // DEFAULT CHANGED: filterHasAssignments defaults to 'yes' (tester feedback)
    const filterHasAssignments = (searchParams?.get('hasAssignments') as RoleFilterState['filterHasAssignments']) || 'yes';
    // Multi-select filters: parse comma-separated values, empty array = show all
    const filterAssignmentCount: string[] = searchParams?.get('assignmentCount')?.split(',').filter(Boolean) || [];
    const filterApprovalRequired = (searchParams?.get('approval') as RoleFilterState['filterApprovalRequired']) || 'all';
    const filterMfaRequired: string[] = searchParams?.get('mfaType')?.split(',').filter(Boolean) || [];
    const filterJustificationRequired = (searchParams?.get('justification') as RoleFilterState['filterJustificationRequired']) || 'all';
    const filterMaxDuration: string[] = searchParams?.get('maxDuration')?.split(',').filter(Boolean) || [];
    const filterScopeType = (searchParams?.get('scopeType') as RoleFilterState['filterScopeType']) || 'all';

    // Group-specific filters (only apply when PIM Groups is visible)
    const filterGroupType = (searchParams?.get('groupType') as RoleFilterState['filterGroupType']) || 'all';
    const filterAccessType = (searchParams?.get('accessType') as RoleFilterState['filterAccessType']) || 'all';
    // Removed: filterUnmanagedVisibility (now handled by WorkloadChips logic passed as arg)

    // Filter group collapse states (keep as local state - UI only)
    const [rolePropsExpanded, setRolePropsExpanded] = useState(true);
    const [assignmentsFilterExpanded, setAssignmentsFilterExpanded] = useState(false);
    const [pimConfigFilterExpanded, setPimConfigFilterExpanded] = useState(false);

    // Analyze available filter options based on actual data
    const availableFilterOptions = useMemo<AvailableFilterOptions>(() => {
        const options: AvailableFilterOptions = {
            hasAssignmentTypes: { permanent: false, eligible: false, active: false },
            hasMemberTypes: { direct: false, group: false },
            hasDurations: { permanent: false, timebound: false },
            hasPrivileged: { yes: false, no: false },
            hasPimConfigured: { yes: false, no: false },
            hasAssignments: { yes: false, no: false },
            assignmentCountRanges: new Set<string>(),
            hasApproval: { yes: false, no: false, na: false },
            mfaTypes: new Set<string>(),
            authContexts: new Set<string>(),
            hasJustification: { yes: false, no: false, na: false },
            maxDurations: new Set<string>(),
            hasScopeTypes: { tenantWide: false, application: false, administrativeUnit: false, rmau: false },
            // Group-specific (will be populated when groups data is passed)
            hasGroupTypes: { security: false, m365: false, mailEnabled: false },
            hasAccessTypes: { member: false, owner: false }
        };

        rolesData.forEach(roleData => {
            const { definition, assignments, policy } = roleData;

            // Assignment types
            if (assignments.permanent.length > 0) options.hasAssignmentTypes.permanent = true;
            if (assignments.eligible.length > 0) options.hasAssignmentTypes.eligible = true;
            if (assignments.active.length > 0) options.hasAssignmentTypes.active = true;

            // Member types (from all assignments including permanent)
            // Use helper function to get memberType (permanent assignments don't have it natively)
            const hasDirectEligible = assignments.eligible.some((s: any) => getMemberType(s) === "Direct");
            const hasGroupEligible = assignments.eligible.some((s: any) => getMemberType(s) === "Group");
            const hasDirectActive = assignments.active.some((s: any) => getMemberType(s) === "Direct");
            const hasGroupActive = assignments.active.some((s: any) => getMemberType(s) === "Group");
            const hasDirectPermanent = assignments.permanent.some((s: any) => getMemberType(s) === "Direct");
            const hasGroupPermanent = assignments.permanent.some((s: any) => getMemberType(s) === "Group");
            if (hasDirectEligible || hasDirectActive || hasDirectPermanent) options.hasMemberTypes.direct = true;
            if (hasGroupEligible || hasGroupActive || hasGroupPermanent) options.hasMemberTypes.group = true;

            // Durations
            const hasPermanentDuration = assignments.eligible.some((s: any) => s.scheduleInfo?.expiration?.type === "noExpiration") ||
                assignments.active.some((s: any) => s.scheduleInfo?.expiration?.type === "noExpiration");
            const hasTimeboundDuration = assignments.eligible.some((s: any) => s.scheduleInfo?.expiration?.type !== "noExpiration") ||
                assignments.active.some((s: any) => s.scheduleInfo?.expiration?.type !== "noExpiration");
            if (hasPermanentDuration) options.hasDurations.permanent = true;
            if (hasTimeboundDuration) options.hasDurations.timebound = true;

            // Privileged status
            if (definition.isPrivileged) options.hasPrivileged.yes = true;
            if (!definition.isPrivileged) options.hasPrivileged.no = true;

            // PIM configured
            const isPimConfigured = !!policy && policy.details.rules && policy.details.rules.length > 0;
            if (isPimConfigured) options.hasPimConfigured.yes = true;
            if (!isPimConfigured) options.hasPimConfigured.no = true;

            // Has assignments
            const totalAssignments = assignments.permanent.length + assignments.eligible.length + assignments.active.length;
            if (totalAssignments > 0) options.hasAssignments.yes = true;
            if (totalAssignments === 0) options.hasAssignments.no = true;

            // Assignment count ranges
            if (totalAssignments === 0) options.assignmentCountRanges.add("none");
            if (totalAssignments >= 1 && totalAssignments <= 5) options.assignmentCountRanges.add("1-5");
            if (totalAssignments >= 6 && totalAssignments <= 20) options.assignmentCountRanges.add("6-20");
            if (totalAssignments >= 21) options.assignmentCountRanges.add("21+");

            // PIM Configuration filters
            if (policy && policy.details.rules) {
                // Approval
                const approvalRule = policy.details.rules.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule" &&
                    r.target?.caller === "EndUser"
                );
                if (approvalRule?.setting?.isApprovalRequired) options.hasApproval.yes = true;
                if (approvalRule && !approvalRule.setting?.isApprovalRequired) options.hasApproval.no = true;

                // MFA & CA Detection - Match Azure's 3-option model
                const enablementRule = policy.details.rules.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule" &&
                    r.target?.caller === "EndUser"
                );
                const authContextRule = policy.details.rules.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule" &&
                    r.target?.caller === "EndUser"
                );

                const hasPimMfa = enablementRule?.enabledRules?.includes("MultiFactorAuthentication");
                const hasAuthContext = authContextRule?.isEnabled && authContextRule?.claimValue;

                if (hasPimMfa) {
                    options.mfaTypes.add("azure-mfa");
                } else if (hasAuthContext) {
                    options.mfaTypes.add(`ca:${authContextRule.claimValue}`);
                    options.authContexts.add(authContextRule.claimValue);
                } else {
                    options.mfaTypes.add("none");
                }

                // Justification
                if (enablementRule?.enabledRules?.includes("Justification")) options.hasJustification.yes = true;
                if (enablementRule && !enablementRule.enabledRules?.includes("Justification")) options.hasJustification.no = true;

                // Max Duration
                const expirationRule = policy.details.rules.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule" &&
                    r.target?.caller === "EndUser"
                );
                if (expirationRule?.maximumDuration) {
                    const maxDuration = expirationRule.maximumDuration;
                    const hours = maxDuration.includes("H") ? parseInt(maxDuration.match(/(\d+)H/)?.[1] || "0") : 0;
                    const days = maxDuration.includes("D") ? parseInt(maxDuration.match(/(\d+)D/)?.[1] || "0") : 0;
                    const totalHours = hours + (days * 24);

                    if (totalHours <= 1) options.maxDurations.add("<1h");
                    else if (totalHours >= 2 && totalHours <= 4) options.maxDurations.add("2-4h");
                    else if (totalHours >= 5 && totalHours <= 8) options.maxDurations.add("5-8h");
                    else if (totalHours >= 9 && totalHours <= 12) options.maxDurations.add("9-12h");
                    else if (totalHours > 12) options.maxDurations.add(">12h");
                }
            } else {
                // No PIM policy - mark as N/A
                options.hasApproval.na = true;
                options.mfaTypes.add("none");
                options.hasJustification.na = true;
                options.maxDurations.add("na");
            }

            // Scope type detection (check all assignments)
            const allAssignments = [...assignments.permanent, ...assignments.eligible, ...assignments.active];
            allAssignments.forEach((a: any) => {
                if (a.scopeInfo?.type === "tenant-wide") options.hasScopeTypes.tenantWide = true;
                else if (a.scopeInfo?.type === "application") options.hasScopeTypes.application = true;
                else if (a.scopeInfo?.type === "administrative-unit") options.hasScopeTypes.administrativeUnit = true;
                else if (a.scopeInfo?.type === "rmau") options.hasScopeTypes.rmau = true;
            });
        });

        // Process PIM Groups data for group-specific filters
        groupsData.forEach(group => {
            const groupType = group.group?.groupType;
            if (groupType === "security") options.hasGroupTypes.security = true;
            if (groupType === "m365") options.hasGroupTypes.m365 = true;
            if (groupType === "mailEnabled") options.hasGroupTypes.mailEnabled = true;

            // Check access types from assignments
            group.assignments.forEach(assignment => {
                if (assignment.accessType === "member") options.hasAccessTypes.member = true;
                if (assignment.accessType === "owner") options.hasAccessTypes.owner = true;
            });
        });

        return options;
    }, [rolesData, groupsData]);

    // Filtered roles based on all filters
    const filteredRoles = useMemo(() => {
        return rolesData.filter(roleData => {
            const { definition, assignments, policy } = roleData;

            // Search filter
            if (searchTerm && !definition.displayName.toLowerCase().includes(searchTerm.toLowerCase())) {
                return false;
            }

            // Role Type filter (Built-in vs Custom)
            if (filterRoleType !== "all") {
                if (filterRoleType === "builtin" && !definition.isBuiltIn) return false;
                if (filterRoleType === "custom" && definition.isBuiltIn) return false;
            }

            // User filter - check if user is in any assignment
            if (filterUser) {
                const userLower = filterUser.toLowerCase();
                const hasUserInPermanent = assignments.permanent.some((a: any) =>
                    a.principal?.displayName?.toLowerCase().includes(userLower) ||
                    a.principal?.userPrincipalName?.toLowerCase().includes(userLower)
                );
                const hasUserInEligible = assignments.eligible.some((s: any) =>
                    s.principal?.displayName?.toLowerCase().includes(userLower) ||
                    s.principal?.userPrincipalName?.toLowerCase().includes(userLower)
                );
                const hasUserInActive = assignments.active.some((s: any) =>
                    s.principal?.displayName?.toLowerCase().includes(userLower) ||
                    s.principal?.userPrincipalName?.toLowerCase().includes(userLower)
                );

                if (!hasUserInPermanent && !hasUserInEligible && !hasUserInActive) {
                    return false;
                }
            }

            // Assignment type filter
            if (filterAssignmentType !== "all") {
                const hasPermanent = assignments.permanent.length > 0;
                const hasEligible = assignments.eligible.length > 0;
                const hasActive = assignments.active.length > 0;

                if (filterAssignmentType === "permanent" && !hasPermanent) return false;
                if (filterAssignmentType === "eligible" && !hasEligible) return false;
                if (filterAssignmentType === "active" && !hasActive) return false;
            }

            // MemberType filter (Direct vs Group) - applies to all assignments
            // Use helper function to get memberType (permanent assignments derive it from principal type)
            if (filterMemberType !== "all") {
                const hasDirectEligible = assignments.eligible.some((s: any) => getMemberType(s) === "Direct");
                const hasGroupEligible = assignments.eligible.some((s: any) => getMemberType(s) === "Group");
                const hasDirectActive = assignments.active.some((s: any) => getMemberType(s) === "Direct");
                const hasGroupActive = assignments.active.some((s: any) => getMemberType(s) === "Group");
                const hasDirectPermanent = assignments.permanent.some((s: any) => getMemberType(s) === "Direct");
                const hasGroupPermanent = assignments.permanent.some((s: any) => getMemberType(s) === "Group");

                const hasDirect = hasDirectEligible || hasDirectActive || hasDirectPermanent;
                const hasGroup = hasGroupEligible || hasGroupActive || hasGroupPermanent;

                if (filterMemberType === "direct" && !hasDirect) return false;
                if (filterMemberType === "group" && !hasGroup) return false;
            }

            // Duration filter (for PIM assignments)
            if (filterDuration !== "all") {
                const eligiblePermanent = assignments.eligible.some((s: any) => s.scheduleInfo?.expiration?.type === "noExpiration");
                const activePermanent = assignments.active.some((s: any) => s.scheduleInfo?.expiration?.type === "noExpiration");
                const hasTimebound = assignments.eligible.some((s: any) => s.scheduleInfo?.expiration?.type !== "noExpiration") ||
                    assignments.active.some((s: any) => s.scheduleInfo?.expiration?.type !== "noExpiration");

                if (filterDuration === "permanent" && !eligiblePermanent && !activePermanent) return false;
                if (filterDuration === "timebound" && !hasTimebound) return false;
            }

            // Privileged filter
            if (filterPrivileged !== "all") {
                if (filterPrivileged === "privileged" && !definition.isPrivileged) return false;
                if (filterPrivileged === "non-privileged" && definition.isPrivileged) return false;
            }

            // PIM configured filter
            if (filterPimConfigured !== "all") {
                const isPimConfigured = !!policy && policy.details.rules && policy.details.rules.length > 0;
                if (filterPimConfigured === "configured" && !isPimConfigured) return false;
                if (filterPimConfigured === "not-configured" && isPimConfigured) return false;
            }

            // Has Assignments filter
            if (filterHasAssignments !== "all") {
                const totalAssignments = assignments.permanent.length + assignments.eligible.length + assignments.active.length;
                if (filterHasAssignments === "yes" && totalAssignments === 0) return false;
                if (filterHasAssignments === "no" && totalAssignments > 0) return false;
            }

            // Assignment Count filter (multi-select: empty array = show all)
            if (filterAssignmentCount.length > 0) {
                const totalAssignments = assignments.permanent.length + assignments.eligible.length + assignments.active.length;
                let matchesAny = false;
                if (filterAssignmentCount.includes("none") && totalAssignments === 0) matchesAny = true;
                if (filterAssignmentCount.includes("1-5") && totalAssignments >= 1 && totalAssignments <= 5) matchesAny = true;
                if (filterAssignmentCount.includes("6-20") && totalAssignments >= 6 && totalAssignments <= 20) matchesAny = true;
                if (filterAssignmentCount.includes("21+") && totalAssignments >= 21) matchesAny = true;
                if (!matchesAny) return false;
            }

            // Approval Required filter
            if (filterApprovalRequired !== "all") {
                const approvalRule = policy?.details.rules?.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule" &&
                    r.target?.caller === "EndUser"
                );
                const isApprovalRequired = approvalRule?.setting?.isApprovalRequired;

                if (filterApprovalRequired === "yes" && !isApprovalRequired) return false;
                if (filterApprovalRequired === "no" && isApprovalRequired) return false;
                if (filterApprovalRequired === "na" && policy) return false;
            }

            // MFA Required filter (multi-select: empty array = show all)
            if (filterMfaRequired.length > 0) {
                const enablementRule = policy?.details.rules?.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule" &&
                    r.target?.caller === "EndUser"
                );
                const authContextRule = policy?.details.rules?.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule" &&
                    r.target?.caller === "EndUser"
                );

                const hasPimMfa = enablementRule?.enabledRules?.includes("MultiFactorAuthentication");
                const hasAuthContext = authContextRule?.isEnabled && authContextRule?.claimValue;
                const contextId = authContextRule?.claimValue;

                let matchesAny = false;
                // Check if role matches ANY of the selected MFA types
                if (filterMfaRequired.includes("none") && !hasPimMfa && !hasAuthContext) matchesAny = true;
                if (filterMfaRequired.includes("azure-mfa") && hasPimMfa) matchesAny = true;
                if (filterMfaRequired.includes("ca-any") && hasAuthContext) matchesAny = true;
                // Check for specific CA context matches (e.g., "ca:c1")
                if (hasAuthContext && filterMfaRequired.some(f => f === `ca:${contextId}`)) matchesAny = true;
                if (!matchesAny) return false;
            }

            // Justification Required filter
            if (filterJustificationRequired !== "all") {
                const enablementRule = policy?.details.rules?.find((r: any) => r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule");
                const isJustificationRequired = enablementRule?.enabledRules?.includes("Justification");

                if (filterJustificationRequired === "yes" && !isJustificationRequired) return false;
                if (filterJustificationRequired === "no" && isJustificationRequired) return false;
                if (filterJustificationRequired === "na" && policy) return false;
            }

            // Max Duration filter (multi-select: empty array = show all)
            if (filterMaxDuration.length > 0) {
                const expirationRule = policy?.details.rules?.find((r: any) =>
                    r["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule" &&
                    r.target?.caller === "EndUser"
                );
                const maxDuration = expirationRule?.maximumDuration;

                let matchesAny = false;

                if (filterMaxDuration.includes("na") && !policy) matchesAny = true;

                if (policy && maxDuration) {
                    // Parse ISO 8601 duration (e.g., "PT8H", "PT1H", "P1D")
                    const hours = maxDuration.includes("H") ? parseInt(maxDuration.match(/(\d+)H/)?.[1] || "0") : 0;
                    const days = maxDuration.includes("D") ? parseInt(maxDuration.match(/(\d+)D/)?.[1] || "0") : 0;
                    const totalHours = hours + (days * 24);

                    if (filterMaxDuration.includes("<1h") && totalHours <= 1) matchesAny = true;
                    if (filterMaxDuration.includes("2-4h") && totalHours >= 2 && totalHours <= 4) matchesAny = true;
                    if (filterMaxDuration.includes("5-8h") && totalHours >= 5 && totalHours <= 8) matchesAny = true;
                    if (filterMaxDuration.includes("9-12h") && totalHours >= 9 && totalHours <= 12) matchesAny = true;
                    if (filterMaxDuration.includes(">12h") && totalHours > 12) matchesAny = true;
                }
                if (!matchesAny) return false;
            }

            // Scope Type filter
            if (filterScopeType !== "all") {
                const allAssignments = [...assignments.permanent, ...assignments.eligible, ...assignments.active];

                if (filterScopeType === "scoped") {
                    // "Scoped" means any non-tenant-wide scope
                    const hasScoped = allAssignments.some((a: any) =>
                        a.scopeInfo?.type && a.scopeInfo.type !== "tenant-wide"
                    );
                    if (!hasScoped) return false;
                } else {
                    // Specific scope type
                    const hasSpecificScope = allAssignments.some((a: any) =>
                        a.scopeInfo?.type === filterScopeType
                    );
                    if (!hasSpecificScope) return false;
                }
            }

            return true;
        }).sort((a, b) => a.definition.displayName.localeCompare(b.definition.displayName));
    }, [rolesData, searchTerm, filterUser, filterRoleType, filterAssignmentType, filterMemberType, filterDuration, filterPrivileged, filterPimConfigured, filterHasAssignments, filterAssignmentCount, filterApprovalRequired, filterMfaRequired, filterJustificationRequired, filterMaxDuration, filterScopeType]);

    // Check if any PIM-specific filters are active
    const hasPimFilters = useMemo(() => {
        return filterPimConfigured !== 'all' ||
            filterApprovalRequired !== 'all' ||
            filterMfaRequired.length > 0 ||
            filterJustificationRequired !== 'all' ||
            filterMaxDuration.length > 0;
    }, [filterPimConfigured, filterApprovalRequired, filterMfaRequired, filterJustificationRequired, filterMaxDuration]);

    // Computed: Filtered Groups
    const filteredGroups = useMemo(() => {
        return groupsData.filter(groupData => {
            const { group, assignments } = groupData;

            // Search filter
            if (searchTerm && !group.displayName.toLowerCase().includes(searchTerm.toLowerCase())) {
                return false;
            }

            // Group Type filter
            if (filterGroupType !== 'all') {
                if (filterGroupType === 'security' && group.groupType !== 'security') return false;
                if (filterGroupType === 'm365' && group.groupType !== 'm365') return false;
                if (filterGroupType === 'mail-enabled' && group.groupType !== 'mailEnabled') return false;
            }

            // Access Type Filter (Member vs Owner)
            if (filterAccessType !== 'all') {
                const hasAccess = assignments.some(a => a.accessType === filterAccessType);
                if (!hasAccess) return false;
            }

            // Visibility Filters (Managed vs Unmanaged driven by WorkloadChips)
            if (groupData.isManaged !== false) {
                // MANAGED GROUP
                if (!isManagedGroupsVisible) return false;
            } else {
                // UNMANAGED GROUP
                if (!isUnmanagedGroupsVisible) return false;
                // Hide unmanaged groups when PIM-specific filters are active
                // (unmanaged groups have no PIM policies, so they can't match PIM filters)
                if (hasPimFilters) return false;
            }

            return true;
        }).sort((a, b) => {
            // Unmanaged first if shown
            if (a.isManaged === false && b.isManaged !== false) return -1;
            if (a.isManaged !== false && b.isManaged === false) return 1;
            return a.group.displayName.localeCompare(b.group.displayName);
        });
    }, [groupsData, searchTerm, filterGroupType, filterAccessType, isManagedGroupsVisible, isUnmanagedGroupsVisible, hasPimFilters]);

    // Active filter count
    const activeFilterCount = useMemo(() => {
        return [
            searchTerm && "Search",
            filterUser && "User",
            filterRoleType !== "all" && "Role Type",
            filterPrivileged !== "all" && "Privileged",
            // Has Assignments: defaults to 'yes', only count as active if explicitly 'no' or 'all'
            (filterHasAssignments !== "yes") && "Has Assignments",
            filterAssignmentType !== "all" && "Type",
            filterMemberType !== "all" && "Method",
            filterDuration !== "all" && "Duration",
            // Multi-select filters: count if array has items
            filterAssignmentCount.length > 0 && "Count",
            filterPimConfigured !== "all" && "PIM",
            filterApprovalRequired !== "all" && "Approval",
            filterMfaRequired.length > 0 && "MFA",
            filterJustificationRequired !== "all" && "Justification",
            filterMaxDuration.length > 0 && "Max Duration",
            filterScopeType !== "all" && "Scope",
            // Group filters
            filterGroupType !== "all" && "Group Type",
            filterAccessType !== "all" && "Access Type"
        ].filter(Boolean).length;
    }, [searchTerm, filterUser, filterRoleType, filterPrivileged, filterHasAssignments, filterAssignmentType, filterMemberType, filterDuration, filterAssignmentCount, filterPimConfigured, filterApprovalRequired, filterMfaRequired, filterJustificationRequired, filterMaxDuration, filterScopeType, filterGroupType, filterAccessType]);

    // Helper to update URL parameter (single value)
    const updateURLParam = useCallback((paramName: string, value: string) => {
        if (!searchParams) return;
        const params = new URLSearchParams(searchParams.toString());
        if (value === 'all' || !value || (paramName === 'unmanaged' && value === 'show')) {
            params.delete(paramName);
        } else {
            params.set(paramName, value);
        }
        const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
        router.push(newUrl, { scroll: false });
    }, [searchParams, router, pathname]);

    // Helper to update URL parameter (array value - for multi-select)
    const updateURLParamArray = useCallback((paramName: string, values: string[]) => {
        if (!searchParams) return;
        const params = new URLSearchParams(searchParams.toString());
        if (values.length === 0) {
            params.delete(paramName);
        } else {
            params.set(paramName, values.join(','));
        }
        const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
        router.push(newUrl, { scroll: false });
    }, [searchParams, router, pathname]);

    // URL-based setters
    const setSearchTerm = useCallback((value: string) => updateURLParam('search', value), [updateURLParam]);
    const setFilterUser = useCallback((value: string) => updateURLParam('user', value), [updateURLParam]);
    const setFilterRoleType = useCallback((value: RoleFilterState['filterRoleType']) => updateURLParam('roleType', value), [updateURLParam]);
    const setFilterAssignmentType = useCallback((value: RoleFilterState['filterAssignmentType']) => updateURLParam('assignmentType', value), [updateURLParam]);
    const setFilterMemberType = useCallback((value: RoleFilterState['filterMemberType']) => updateURLParam('memberType', value), [updateURLParam]);
    const setFilterDuration = useCallback((value: RoleFilterState['filterDuration']) => updateURLParam('duration', value), [updateURLParam]);
    const setFilterPrivileged = useCallback((value: RoleFilterState['filterPrivileged']) => updateURLParam('privileged', value), [updateURLParam]);
    const setFilterPimConfigured = useCallback((value: RoleFilterState['filterPimConfigured']) => updateURLParam('pimConfigured', value), [updateURLParam]);
    const setFilterHasAssignments = useCallback((value: RoleFilterState['filterHasAssignments']) => updateURLParam('hasAssignments', value), [updateURLParam]);
    // Multi-select setters (array-based)
    const setFilterAssignmentCount = useCallback((value: string[]) => updateURLParamArray('assignmentCount', value), [updateURLParamArray]);
    const setFilterApprovalRequired = useCallback((value: RoleFilterState['filterApprovalRequired']) => updateURLParam('approval', value), [updateURLParam]);
    const setFilterMfaRequired = useCallback((value: string[]) => updateURLParamArray('mfaType', value), [updateURLParamArray]);
    const setFilterJustificationRequired = useCallback((value: RoleFilterState['filterJustificationRequired']) => updateURLParam('justification', value), [updateURLParam]);
    const setFilterMaxDuration = useCallback((value: string[]) => updateURLParamArray('maxDuration', value), [updateURLParamArray]);
    const setFilterScopeType = useCallback((value: RoleFilterState['filterScopeType']) => updateURLParam('scopeType', value), [updateURLParam]);

    // Group-specific filter setters
    const setFilterGroupType = useCallback((value: RoleFilterState['filterGroupType']) => updateURLParam('groupType', value), [updateURLParam]);
    const setFilterAccessType = useCallback((value: RoleFilterState['filterAccessType']) => updateURLParam('accessType', value), [updateURLParam]);

    // Reset all filters
    const resetFilters = useCallback(() => {
        router.push(pathname, { scroll: false });
    }, [router, pathname]);

    // Toggle filter (turn off if already active)
    const toggleFilter = useCallback((paramName: string, value: string) => {
        if (!searchParams) return;
        const currentValue = searchParams.get(paramName);
        if (currentValue === value) {
            updateURLParam(paramName, 'all');
        } else {
            updateURLParam(paramName, value);
        }
    }, [searchParams, updateURLParam]);

    // Check if any filters are active
    const hasActiveFilters = useMemo(() => {
        if (!searchParams) return false;
        return Array.from(searchParams.keys()).length > 0;
    }, [searchParams]);

    return {
        // Filter state
        filters: {
            searchTerm,
            filterUser,
            filterRoleType,
            filterAssignmentType,
            filterMemberType,
            filterDuration,
            filterPrivileged,
            filterPimConfigured,
            filterHasAssignments,
            filterAssignmentCount,
            filterApprovalRequired,
            filterMfaRequired,
            filterJustificationRequired,
            filterMaxDuration,
            filterScopeType,
            filterGroupType,
            filterAccessType,
            filterUnmanagedVisibility: 'all' as RoleFilterState['filterUnmanagedVisibility']
        },
        // Filter setters
        setSearchTerm,
        setFilterUser,
        setFilterRoleType,
        setFilterAssignmentType,
        setFilterMemberType,
        setFilterDuration,
        setFilterPrivileged,
        setFilterPimConfigured,
        setFilterHasAssignments,
        setFilterAssignmentCount,
        setFilterApprovalRequired,
        setFilterMfaRequired,
        setFilterJustificationRequired,
        setFilterMaxDuration,
        setFilterScopeType,
        setFilterGroupType,
        setFilterAccessType,
        // Group collapse states
        groupStates: {
            rolePropsExpanded,
            assignmentsFilterExpanded,
            pimConfigFilterExpanded
        },
        setRolePropsExpanded,
        setAssignmentsFilterExpanded,
        setPimConfigFilterExpanded,
        // Computed values
        availableFilterOptions,
        filteredRoles,
        filteredGroups,
        activeFilterCount,
        hasActiveFilters,
        // Actions
        resetFilters,
        toggleFilter,
        // URL helper for dashboard
        updateURLParam
    };
}
