"use client";

import { useState, useEffect, Suspense, useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { InteractionRequiredAuthError } from "@azure/msal-browser";
import { loadApproversForRole } from "@/services/directoryRoleService";
import { RoleDetailData } from "@/types/directoryRole.types";
import { usePimData } from "@/hooks/usePimData";
import { useRoleFilters } from "@/hooks/useRoleFilters";
import {
    Shield,
    Users,
    Clock,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronRight,
    Loader2,
    Info,
    AlertCircle,
    Settings,
    Check,
    X,
    Minus,
    RefreshCw,
    Download,
    FileSpreadsheet,
    Table
} from "lucide-react";
import { HelpModal } from "@/components/HelpModal";
import { LoadingStatus } from "@/components/LoadingStatus";
import { SyncStatus } from "@/components/SyncStatus";
import { DataWarningBanner, RoleConfigWarning } from "@/components/DataWarningBanner";
import { RoleCardSkeletonList } from "@/components/RoleCardSkeleton";
import { RoleFilters } from "@/components/RoleFilters";
import { ScopeBadge } from "@/components/ScopeBadge";
import { GroupCard } from "./components/GroupCard";
import { RoleCard } from "./components/RoleCard";
import { ReportExportModal } from "./components/ReportExportModal";
import { SettingsModal } from "@/components/SettingsModal";
import { useUnifiedPimData } from "@/contexts/UnifiedPimContext";
import { WorkloadChips, useWorkloadVisibility } from "@/components/WorkloadChips";
import { PimGroupData } from "@/types/pimGroup.types";

function ReportPageContent() {
    const { instance, accounts } = useMsal();
    const { rolesData, loading, error, loadingProgress, loadingMessage, policiesLoading, policyProgress, refreshData, fetchPolicyForRole, failedRoleIds, authenticationContexts } = usePimData();
    const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
    const [privilegedWarning, setPrivilegedWarning] = useState(false);
    const [loadingApprovers, setLoadingApprovers] = useState<Set<string>>(new Set());
    const [approversCache, setApproversCache] = useState<Map<string, any[]>>(new Map());

    // PIM Groups data from UnifiedPimContext
    const { workloads, refreshWorkload, refreshAllWorkloads } = useUnifiedPimData();
    const pimGroupsData = workloads.pimGroups.data;
    const pimGroupsLoading = workloads.pimGroups.loading.phase === "fetching" ||
        workloads.pimGroups.loading.phase === "processing" ||
        workloads.pimGroups.loading.phase === "consent";

    // Workload visibility toggles
    const isDirectoryRolesVisible = useWorkloadVisibility("directoryRoles");
    const isPimGroupsVisible = useWorkloadVisibility("pimGroups");
    const isUnmanagedGroupsVisible = useWorkloadVisibility("unmanagedGroups");


    // Expanded groups state
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // UI State
    const [filtersExpanded, setFiltersExpanded] = useState(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    // Filter Logic
    const {
        filters,
        resetFilters,
        // activeFiltersCount, // Not returned by hook
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
        groupStates,
        setRolePropsExpanded,
        setAssignmentsFilterExpanded,
        setPimConfigFilterExpanded,
        availableFilterOptions,
        filteredRoles,
        filteredGroups,
        activeFilterCount
    } = useRoleFilters(rolesData, pimGroupsData, isPimGroupsVisible, isUnmanagedGroupsVisible);

    // Use filtered data directly (no sync filter anymore)
    const finalFilteredRoles = filteredRoles;
    const finalFilteredGroups = filteredGroups;

    // Initial load effect
    useEffect(() => {
        // If no data and not loading, fetch automatically
        if (rolesData.length === 0 && !loading && !error) {
            refreshData();
        }
    }, []); // Run once on mount (dependency analysis handled inside hooks usually but empty array ensures mount only check)
    const getGraphClient = async () => {
        const request = {
            scopes: [
                "RoleManagement.Read.Directory",
                "RoleAssignmentSchedule.Read.Directory",
                "RoleEligibilitySchedule.Read.Directory",
                "RoleManagementPolicy.Read.Directory",
                "Policy.Read.ConditionalAccess",
                "User.Read.All",
                "Group.Read.All",
                "AdministrativeUnit.Read.All",
                "Application.Read.All"
            ],
            account: accounts[0],
        };

        try {
            const response = await instance.acquireTokenSilent(request);
            return Client.init({
                authProvider: (done) => done(null, response.accessToken),
            });
        } catch (error) {
            if (error instanceof InteractionRequiredAuthError) {
                const response = await instance.acquireTokenPopup(request);
                return Client.init({
                    authProvider: (done) => done(null, response.accessToken),
                });
            }
            throw error;
        }
    };

    const handleGenerateReport = async () => {
        // Clear expanded roles for better UX
        setExpandedRoles(new Set());
        setPrivilegedWarning(false);

        // Use unified refresh for ALL workloads (modular)
        await refreshAllWorkloads();

        // Check if any role is missing isPrivileged
        const hasUndefinedPrivileged = rolesData.some((r: RoleDetailData) => r.definition.isPrivileged === undefined);
        if (hasUndefinedPrivileged) {
            setPrivilegedWarning(true);
        }
    };

    const toggleRole = async (roleId: string) => {
        const newExpanded = new Set(expandedRoles);
        const isExpanding = !newExpanded.has(roleId);

        if (isExpanding) {
            newExpanded.add(roleId);

            // Lazy load approvers if not already loaded
            const roleData = rolesData.find((r: RoleDetailData) => r.definition.id === roleId);

            // Debug logging only in development (prevents sensitive data exposure in production)
            if (process.env.NODE_ENV === 'development') {
                console.log("[handleRoleToggle] Role expansion:", {
                    hasRoleData: !!roleData,
                    hasPolicy: !!roleData?.policy,
                    hasPolicyDetails: !!roleData?.policy?.details,
                    hasRules: !!roleData?.policy?.details?.rules,
                    rulesCount: roleData?.policy?.details?.rules?.length,
                    alreadyInCache: approversCache.has(roleId)
                });
            }

            if (roleData?.policy && !approversCache.has(roleId) && roleData.policy.details.rules) {
                setLoadingApprovers(prev => new Set(prev).add(roleId));

                try {
                    const client = await getGraphClient();
                    const approvers = await loadApproversForRole(client, roleData.policy.details.rules);

                    // Store approvers in cache
                    setApproversCache(prev => new Map(prev).set(roleId, approvers));
                } catch (error) {
                    console.error("Failed to load approvers", error);
                } finally {
                    setLoadingApprovers(prev => {
                        const next = new Set(prev);
                        next.delete(roleId);
                        return next;
                    });
                }
            }
        } else {
            newExpanded.delete(roleId);
        }
        setExpandedRoles(newExpanded);
    };


    return (
        <div className="max-w-7xl mx-auto p-6 space-y-6">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                            PIM roles report
                        </h1>
                        <div className="flex items-center gap-3 mt-1">
                            <p className="text-sm text-zinc-500">
                                Comprehensive overview of all Entra ID roles, assignments, and PIM policies
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col items-start gap-2">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleGenerateReport}
                                className="px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center gap-2 shadow-sm text-zinc-700 dark:text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={loading || policiesLoading || pimGroupsLoading}
                            >
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                Refresh data
                            </button>
                            <button
                                onClick={() => setIsExportModalOpen(true)}
                                disabled={rolesData.length === 0}
                                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                            >
                                <Download className="h-4 w-4" />
                                Export data
                            </button>
                            <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
                        </div>
                        <LoadingStatus />
                        <SyncStatus />
                    </div>
                </div>

                {/* Workload Toggles */}
                <div className="mb-6">
                    <div className="flex items-center justify-between gap-4">
                        <WorkloadChips
                            excludedChips={["securityAlerts"]}
                            onOpenSettings={() => setShowSettingsModal(true)}
                            allowIndependentChildToggles={true}
                        />
                    </div>
                </div>


                {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800 mb-4">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                        </div>
                    </div>
                )}

                {privilegedWarning && (
                    <div className="bg-orange-50 dark:bg-orange-900/20 p-4 rounded-lg border border-orange-200 dark:border-orange-800 mb-4">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                            <p className="text-sm text-orange-700 dark:text-orange-300">
                                Warning: Could not fetch 'Privileged' status for some roles from Azure API. Roles without this property will not show the privileged badge.
                            </p>
                        </div>
                    </div>
                )}

                {/* Data incomplete warning banner */}
                <DataWarningBanner
                    failedCount={failedRoleIds.length}
                    totalCount={rolesData.length}
                    onRefresh={handleGenerateReport}
                />


                {/* Show skeleton immediately when loading with no data (improves LCP) */}
                {loading && rolesData.length === 0 && (
                    <div className="mt-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-zinc-500">Loading roles...</div>
                        </div>
                        <RoleCardSkeletonList count={8} />
                    </div>
                )}

                {rolesData.length > 0 && (
                    <>
                        {/* Filters - Using Modular Component */}
                        <RoleFilters
                            filters={filters}
                            setSearchTerm={setSearchTerm}
                            setFilterUser={setFilterUser}
                            setFilterRoleType={setFilterRoleType}
                            setFilterAssignmentType={setFilterAssignmentType}
                            setFilterMemberType={setFilterMemberType}
                            setFilterDuration={setFilterDuration}
                            setFilterPrivileged={setFilterPrivileged}
                            setFilterPimConfigured={setFilterPimConfigured}
                            setFilterHasAssignments={setFilterHasAssignments}
                            setFilterAssignmentCount={setFilterAssignmentCount}
                            setFilterApprovalRequired={setFilterApprovalRequired}
                            setFilterMfaRequired={setFilterMfaRequired}
                            setFilterJustificationRequired={setFilterJustificationRequired}
                            setFilterMaxDuration={setFilterMaxDuration}
                            setFilterScopeType={setFilterScopeType}
                            rolePropsExpanded={groupStates.rolePropsExpanded}
                            setRolePropsExpanded={setRolePropsExpanded}
                            assignmentsFilterExpanded={groupStates.assignmentsFilterExpanded}
                            setAssignmentsFilterExpanded={setAssignmentsFilterExpanded}
                            pimConfigFilterExpanded={groupStates.pimConfigFilterExpanded}
                            setPimConfigFilterExpanded={setPimConfigFilterExpanded}
                            availableFilterOptions={availableFilterOptions}
                            activeFilterCount={activeFilterCount}
                            rolesData={rolesData}
                            authenticationContexts={authenticationContexts}
                            onReset={resetFilters}
                            filtersExpanded={filtersExpanded}
                            setFiltersExpanded={setFiltersExpanded}
                            policiesLoading={policiesLoading}
                            isDirectoryRolesVisible={isDirectoryRolesVisible}
                            isPimGroupsVisible={isPimGroupsVisible}
                            setFilterGroupType={setFilterGroupType}
                            setFilterAccessType={setFilterAccessType}
                        />

                        <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-zinc-600 dark:text-zinc-400">
                                {isDirectoryRolesVisible && (isPimGroupsVisible || isUnmanagedGroupsVisible) ? (
                                    <>Showing {finalFilteredRoles.length} roles and {finalFilteredGroups.length} groups</>
                                ) : isDirectoryRolesVisible ? (
                                    <>Showing {finalFilteredRoles.length} of {rolesData.length} roles</>
                                ) : (isPimGroupsVisible || isUnmanagedGroupsVisible) ? (
                                    <>Showing {finalFilteredGroups.length} groups</>
                                ) : (
                                    <>No workloads selected</>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            {isDirectoryRolesVisible && finalFilteredRoles.map((roleData) => (
                                <RoleCard
                                    key={roleData.definition.id}
                                    roleData={roleData}
                                    isExpanded={expandedRoles.has(roleData.definition.id)}
                                    onToggle={() => {
                                        toggleRole(roleData.definition.id);
                                        // Priority fetch policy if missing
                                        if (!roleData.policy) {
                                            fetchPolicyForRole(roleData.definition.id);
                                        }
                                    }}
                                    loadingApprovers={loadingApprovers.has(roleData.definition.id)}
                                    approversCache={approversCache}
                                    authenticationContexts={authenticationContexts}
                                />
                            ))}

                            {/* Groups Section (Managed & Unmanaged) */}
                            {finalFilteredGroups.map((groupData) => (
                                <GroupCard
                                    key={groupData.group.id}
                                    groupData={groupData}
                                    isExpanded={expandedGroups.has(groupData.group.id)}
                                    onToggle={() => {
                                        setExpandedGroups(prev => {
                                            const next = new Set(prev);
                                            if (next.has(groupData.group.id)) {
                                                next.delete(groupData.group.id);
                                            } else {
                                                next.add(groupData.group.id);
                                            }
                                            return next;
                                        });
                                    }}
                                    authenticationContexts={authenticationContexts}
                                />
                            ))}
                        </div>
                    </>
                )}

                {!loading && rolesData.length === 0 && !error && (
                    <div className="text-center py-12 text-zinc-500">
                        Click "Refresh Data" to fetch all roles data
                    </div>
                )}
            </div>
            {/* Export Modal */}
            <ReportExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                filteredRoles={filteredRoles}
                pimGroupsData={pimGroupsData}
                isPimGroupsVisible={isPimGroupsVisible}
                authenticationContexts={authenticationContexts}
            />

            {/* Settings Modal - Added for workload configuration */}
            <SettingsModal isOpen={showSettingsModal} onClose={() => setShowSettingsModal(false)} />
        </div>
    );
}

export default function ReportPage() {
    return (
        <Suspense fallback={
            <div className="container mx-auto px-4 py-8 max-w-7xl">
                <div className="animate-pulse">
                    <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded mb-2" />
                    <div className="h-4 w-96 bg-zinc-200 dark:bg-zinc-800 rounded mb-8" />
                </div>
            </div>
        }>
            <ReportPageContent />
        </Suspense>
    );
}
