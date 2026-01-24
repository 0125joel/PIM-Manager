"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { RoleFilterState, AvailableFilterOptions } from "@/types/roleFilters";
import { FilterGroup } from "@/components/FilterGroup";
import { MultiSelectDropdown, MultiSelectOption } from "@/components/MultiSelectDropdown";
import { Filter, ChevronDown, ChevronRight, Ban } from "lucide-react";
import { getAuthContextDisplayName } from "@/utils/authContextApi";
import { useMemo } from "react";

interface RoleFiltersProps {
    // Filter state
    filters: RoleFilterState;
    setSearchTerm: (value: string) => void;
    setFilterUser: (value: string) => void;
    setFilterRoleType: (value: RoleFilterState["filterRoleType"]) => void;
    setFilterAssignmentType: (value: RoleFilterState["filterAssignmentType"]) => void;
    setFilterMemberType: (value: RoleFilterState["filterMemberType"]) => void;
    setFilterDuration: (value: RoleFilterState["filterDuration"]) => void;
    setFilterPrivileged: (value: RoleFilterState["filterPrivileged"]) => void;
    setFilterPimConfigured: (value: RoleFilterState["filterPimConfigured"]) => void;
    setFilterHasAssignments: (value: RoleFilterState["filterHasAssignments"]) => void;
    setFilterAssignmentCount: (value: string[]) => void; // Multi-select array
    setFilterApprovalRequired: (value: RoleFilterState["filterApprovalRequired"]) => void;
    setFilterMfaRequired: (value: string[]) => void; // Multi-select array
    setFilterJustificationRequired: (value: RoleFilterState["filterJustificationRequired"]) => void;
    setFilterMaxDuration: (value: string[]) => void; // Multi-select array
    setFilterScopeType: (value: RoleFilterState["filterScopeType"]) => void;

    // Group states
    rolePropsExpanded: boolean;
    setRolePropsExpanded: (value: boolean) => void;
    assignmentsFilterExpanded: boolean;
    setAssignmentsFilterExpanded: (value: boolean) => void;
    pimConfigFilterExpanded: boolean;
    setPimConfigFilterExpanded: (value: boolean) => void;

    // Computed
    availableFilterOptions: AvailableFilterOptions;
    activeFilterCount: number;
    rolesData: RoleDetailData[];
    authenticationContexts: any[]; // Auth contexts with display names

    // Actions
    onReset: () => void;

    // UI state
    filtersExpanded: boolean;
    setFiltersExpanded: (value: boolean) => void;
    policiesLoading?: boolean;

    // Workload Visibility
    isDirectoryRolesVisible?: boolean;
    isPimGroupsVisible?: boolean;

    // Group-specific filter actions
    setFilterGroupType?: (value: RoleFilterState["filterGroupType"]) => void;
    setFilterAccessType?: (value: RoleFilterState["filterAccessType"]) => void;
    setFilterUnmanagedVisibility?: (value: RoleFilterState["filterUnmanagedVisibility"]) => void;
}

export function RoleFilters({
    filters,
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
    rolePropsExpanded,
    setRolePropsExpanded,
    assignmentsFilterExpanded,
    setAssignmentsFilterExpanded,
    pimConfigFilterExpanded,
    setPimConfigFilterExpanded,
    availableFilterOptions,
    activeFilterCount,
    rolesData,
    authenticationContexts,
    onReset,
    filtersExpanded,
    setFiltersExpanded,
    policiesLoading = false,
    isDirectoryRolesVisible = true, // Default to true for backward compatibility
    isPimGroupsVisible = false,
    setFilterGroupType,
    setFilterAccessType,
    setFilterUnmanagedVisibility
}: RoleFiltersProps) {

    // Helper to render disabled state note
    const renderDisabledNote = (text: string) => (
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-1 italic">
            ({text})
        </span>
    );

    return (
        <div className="mb-6 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            {/* Filter Header */}
            <div
                className="p-4 flex items-center justify-between cursor-pointer bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                onClick={() => setFiltersExpanded(!filtersExpanded)}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white dark:bg-zinc-700 rounded-md shadow-sm border border-zinc-200 dark:border-zinc-600">
                        <Filter className="h-4 w-4 text-zinc-600 dark:text-zinc-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Filter roles
                        </h3>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {activeFilterCount > 0
                                ? `${activeFilterCount} active filters`
                                : "Refine your view"}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {activeFilterCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-medium">
                            {activeFilterCount}
                        </span>
                    )}
                    {filtersExpanded ? (
                        <ChevronDown className="h-5 w-5 text-zinc-400" />
                    ) : (
                        <ChevronRight className="h-5 w-5 text-zinc-400" />
                    )}
                </div>
            </div>

            {/* Filter Content - Collapsable */}
            {filtersExpanded && (
                <div className="p-4 pt-0 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
                    {/* Search Bar */}
                    <div className="pt-4">
                        <input
                            type="text"
                            placeholder="Search roles by name or description..."
                            value={filters.searchTerm || ""}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Group 1: Role Properties */}
                        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden flex flex-col">
                            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                                <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Role properties</h4>
                            </div>
                            <div className={`p-4 bg-white dark:bg-zinc-900 flex-1`}>
                                <div className="space-y-3">
                                    {/* Role Type - Disabled if Directory Roles hidden */}
                                    <div className={!isDirectoryRolesVisible ? "opacity-50 pointer-events-none" : ""}>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Role type {!isDirectoryRolesVisible && renderDisabledNote("Directory roles only")}
                                        </label>
                                        <select
                                            value={filters.filterRoleType}
                                            onChange={(e) => setFilterRoleType(e.target.value as any)}
                                            disabled={!isDirectoryRolesVisible}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:bg-zinc-100 dark:disabled:bg-zinc-800"
                                        >
                                            <option value="all">All roles</option>
                                            <option value="builtin">Built-in</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                    </div>

                                    {/* Privileged Status - Disabled if Directory Roles hidden */}
                                    <div className={!isDirectoryRolesVisible ? "opacity-50 pointer-events-none" : ""}>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Privileged status {!isDirectoryRolesVisible && renderDisabledNote("Directory roles only")}
                                        </label>
                                        <select
                                            value={filters.filterPrivileged}
                                            onChange={(e) => setFilterPrivileged(e.target.value as any)}
                                            disabled={!isDirectoryRolesVisible}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:bg-zinc-100 dark:disabled:bg-zinc-800"
                                        >
                                            <option value="all">All</option>
                                            {availableFilterOptions.hasPrivileged.yes && <option value="privileged">Privileged</option>}
                                            {availableFilterOptions.hasPrivileged.no && <option value="non-privileged">Non-privileged</option>}
                                        </select>
                                    </div>

                                    {/* Specific User Filter */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Assigned to user
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Search user..."
                                            value={filters.filterUser || ""}
                                            onChange={(e) => setFilterUser(e.target.value)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Group 2: Assignments */}
                        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden flex flex-col">
                            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                                <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Assignments</h4>
                            </div>
                            <div className="p-4 bg-white dark:bg-zinc-900 flex-1">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-3">
                                    {/* Assignment Type */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Assignment type
                                        </label>
                                        <select
                                            value={filters.filterAssignmentType}
                                            onChange={(e) => setFilterAssignmentType(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">All types</option>
                                            {availableFilterOptions.hasAssignmentTypes.permanent && <option value="permanent">Permanent</option>}
                                            {availableFilterOptions.hasAssignmentTypes.eligible && <option value="eligible">Eligible</option>}
                                            {availableFilterOptions.hasAssignmentTypes.active && <option value="active">Active</option>}
                                        </select>
                                    </div>

                                    {/* Member Type - Disabled if Directory Roles hidden */}
                                    <div className={!isDirectoryRolesVisible ? "opacity-50 pointer-events-none" : ""}>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Member type {!isDirectoryRolesVisible && renderDisabledNote("Directory roles only")}
                                        </label>
                                        <select
                                            value={filters.filterMemberType}
                                            onChange={(e) => setFilterMemberType(e.target.value as any)}
                                            disabled={!isDirectoryRolesVisible}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:bg-zinc-100 dark:disabled:bg-zinc-800"
                                        >
                                            <option value="all">All members</option>
                                            {availableFilterOptions.hasMemberTypes.direct && <option value="direct">Direct assignment</option>}
                                            {availableFilterOptions.hasMemberTypes.group && <option value="group">Group assignment</option>}
                                        </select>
                                    </div>

                                    {/* Duration Type */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Duration
                                        </label>
                                        <select
                                            value={filters.filterDuration}
                                            onChange={(e) => setFilterDuration(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">Any duration</option>
                                            {availableFilterOptions.hasDurations.permanent && <option value="permanent">Permanent</option>}
                                            {availableFilterOptions.hasDurations.timebound && <option value="timebound">Time-bound</option>}
                                        </select>
                                    </div>

                                    {/* Has Assignments */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Has assignments
                                        </label>
                                        <select
                                            value={filters.filterHasAssignments}
                                            onChange={(e) => setFilterHasAssignments(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">All</option>
                                            {availableFilterOptions.hasAssignments.yes && <option value="yes">Yes</option>}
                                            {availableFilterOptions.hasAssignments.no && <option value="no">No</option>}
                                        </select>
                                    </div>

                                    {/* Assignment Count - Multi-select dropdown */}
                                    <MultiSelectDropdown
                                        label="Assignment count"
                                        placeholder="Any count"
                                        selectedValues={filters.filterAssignmentCount}
                                        onChange={setFilterAssignmentCount}
                                        options={[
                                            ...(availableFilterOptions.assignmentCountRanges.has("none") ? [{ value: "none", label: "0 (None)" }] : []),
                                            ...(availableFilterOptions.assignmentCountRanges.has("1-5") ? [{ value: "1-5", label: "1-5" }] : []),
                                            ...(availableFilterOptions.assignmentCountRanges.has("6-20") ? [{ value: "6-20", label: "6-20" }] : []),
                                            ...(availableFilterOptions.assignmentCountRanges.has("21+") ? [{ value: "21+", label: "21+" }] : []),
                                        ]}
                                    />

                                    {/* Scope Type - Disabled if Directory Roles hidden */}
                                    <div className={!isDirectoryRolesVisible ? "opacity-50 pointer-events-none" : ""}>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Scope {!isDirectoryRolesVisible && renderDisabledNote("Directory roles only")}
                                        </label>
                                        <select
                                            value={filters.filterScopeType}
                                            onChange={(e) => setFilterScopeType(e.target.value as any)}
                                            disabled={!isDirectoryRolesVisible}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 disabled:bg-zinc-100 dark:disabled:bg-zinc-800"
                                        >
                                            <option value="all">All scopes</option>
                                            {availableFilterOptions.hasScopeTypes?.tenantWide && <option value="tenant-wide">Tenant-wide</option>}
                                            {(availableFilterOptions.hasScopeTypes?.application || availableFilterOptions.hasScopeTypes?.administrativeUnit || availableFilterOptions.hasScopeTypes?.rmau) && <option value="scoped">Scoped (Any)</option>}
                                            {availableFilterOptions.hasScopeTypes?.application && <option value="application">Application</option>}
                                            {availableFilterOptions.hasScopeTypes?.administrativeUnit && <option value="administrative-unit">Admin unit</option>}
                                            {availableFilterOptions.hasScopeTypes?.rmau && <option value="rmau">RMAU (Restricted)</option>}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Group 3: Role Configuration */}
                        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden flex flex-col relative">
                            {/* Loading Overlay within the group */}
                            {policiesLoading && (
                                <div className="absolute inset-0 bg-white/50 dark:bg-zinc-900/50 z-20 flex items-center justify-center backdrop-blur-[1px]">
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-zinc-800 rounded-full shadow-sm border border-zinc-200 dark:border-zinc-700">
                                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-zinc-500 border-t-transparent"></div>
                                        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Loading Policies...</span>
                                    </div>
                                </div>
                            )}

                            <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
                                <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                                    {policiesLoading ? "Role configuration (Loading...)" : "Role configuration"}
                                </h4>
                            </div>
                            <div className="p-4 bg-white dark:bg-zinc-900 flex-1">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-3">
                                    {/* PIM Configured */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            PIM configured
                                        </label>
                                        <select
                                            value={filters.filterPimConfigured}
                                            onChange={(e) => setFilterPimConfigured(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">All roles</option>
                                            {availableFilterOptions.hasPimConfigured.yes && <option value="configured">PIM configured</option>}
                                            {availableFilterOptions.hasPimConfigured.no && <option value="not-configured">Not configured</option>}
                                        </select>
                                    </div>

                                    {/* Approval Required */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Approval required
                                        </label>
                                        <select
                                            value={filters.filterApprovalRequired}
                                            onChange={(e) => setFilterApprovalRequired(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">All</option>
                                            {availableFilterOptions.hasApproval.yes && <option value="yes">Required</option>}
                                            {availableFilterOptions.hasApproval.no && <option value="no">Not required</option>}
                                            {availableFilterOptions.hasApproval.na && <option value="na">N/A (No PIM)</option>}
                                        </select>
                                    </div>

                                    {/* MFA Required - Multi-select dropdown */}
                                    <MultiSelectDropdown
                                        label="MFA / Conditional Access"
                                        placeholder="All"
                                        selectedValues={filters.filterMfaRequired}
                                        onChange={setFilterMfaRequired}
                                        options={[
                                            ...(availableFilterOptions.mfaTypes.has("none") ? [{ value: "none", label: "None" }] : []),
                                            ...(availableFilterOptions.mfaTypes.has("azure-mfa") ? [{ value: "azure-mfa", label: "Azure MFA" }] : []),
                                            ...(availableFilterOptions.authContexts.size > 0 ? [{ value: "ca-any", label: "Any CA context" }] : []),
                                            ...Array.from(availableFilterOptions.authContexts).map(contextId => ({
                                                value: `ca:${contextId}`,
                                                label: getAuthContextDisplayName(authenticationContexts, contextId) || `CA: ${contextId}`,
                                                indent: true
                                            }))
                                        ]}
                                    />

                                    {/* Justification Required */}
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                            Justification required
                                        </label>
                                        <select
                                            value={filters.filterJustificationRequired}
                                            onChange={(e) => setFilterJustificationRequired(e.target.value as any)}
                                            className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                        >
                                            <option value="all">All</option>
                                            {availableFilterOptions.hasJustification.yes && <option value="yes">Required</option>}
                                            {availableFilterOptions.hasJustification.no && <option value="no">Not required</option>}
                                            {availableFilterOptions.hasJustification.na && <option value="na">N/A (No PIM)</option>}
                                        </select>
                                    </div>

                                    {/* Max Activation Duration - Multi-select dropdown */}
                                    <MultiSelectDropdown
                                        label="Max activation duration"
                                        placeholder="All"
                                        selectedValues={filters.filterMaxDuration}
                                        onChange={setFilterMaxDuration}
                                        options={[
                                            ...(availableFilterOptions.maxDurations.has("<1h") ? [{ value: "<1h", label: "< 1 hour" }] : []),
                                            ...(availableFilterOptions.maxDurations.has("2-4h") ? [{ value: "2-4h", label: "2-4 hours" }] : []),
                                            ...(availableFilterOptions.maxDurations.has("5-8h") ? [{ value: "5-8h", label: "5-8 hours" }] : []),
                                            ...(availableFilterOptions.maxDurations.has("9-12h") ? [{ value: "9-12h", label: "9-12 hours" }] : []),
                                            ...(availableFilterOptions.maxDurations.has(">12h") ? [{ value: ">12h", label: "> 12 hours" }] : []),
                                            ...(availableFilterOptions.maxDurations.has("na") ? [{ value: "na", label: "N/A (No PIM)" }] : []),
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Group 4: PIM Groups Filters (only shown when visible) */}
                        {isPimGroupsVisible && (
                            <div className="border border-purple-200 dark:border-purple-800/50 rounded-lg overflow-hidden flex flex-col lg:col-span-3">
                                <div className="px-4 py-3 bg-purple-50 dark:bg-purple-900/20 border-b border-purple-200 dark:border-purple-800/50">
                                    <h4 className="font-medium text-sm text-purple-900 dark:text-purple-100">PIM groups</h4>
                                </div>
                                <div className="p-4 bg-white dark:bg-zinc-900 flex-1">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {/* Group Type */}
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                                Group type
                                            </label>
                                            <select
                                                value={filters.filterGroupType}
                                                onChange={(e) => setFilterGroupType?.(e.target.value as any)}
                                                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                            >
                                                <option value="all">All types</option>
                                                {availableFilterOptions.hasGroupTypes?.security && <option value="security">Security</option>}
                                                {availableFilterOptions.hasGroupTypes?.m365 && <option value="m365">Microsoft 365</option>}
                                                {availableFilterOptions.hasGroupTypes?.mailEnabled && <option value="mail-enabled">Mail-enabled</option>}
                                            </select>
                                        </div>

                                        {/* Access Type */}
                                        <div>
                                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                                Access type
                                            </label>
                                            <select
                                                value={filters.filterAccessType}
                                                onChange={(e) => setFilterAccessType?.(e.target.value as any)}
                                                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                                            >
                                                <option value="all">All access</option>
                                                {availableFilterOptions.hasAccessTypes?.member && <option value="member">Member</option>}
                                                {availableFilterOptions.hasAccessTypes?.owner && <option value="owner">Owner</option>}
                                            </select>
                                        </div>

                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={onReset}
                            className="text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 underline"
                        >
                            Reset all filters
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
