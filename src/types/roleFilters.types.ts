// Filter state types
export interface RoleFilterState {
    searchTerm: string;
    filterUser: string;
    filterRoleType: "all" | "builtin" | "custom";
    filterAssignmentType: "all" | "permanent" | "eligible" | "active";
    filterMemberType: "all" | "direct" | "group";
    filterDuration: "all" | "permanent" | "timebound";
    filterPrivileged: "all" | "privileged" | "non-privileged";
    filterPimConfigured: "all" | "configured" | "not-configured";
    filterHasAssignments: "all" | "yes" | "no";
    filterAssignmentCount: string[]; // Multi-select: empty = all, e.g. ["1-5", "21+"]
    filterApprovalRequired: "all" | "yes" | "no" | "na";
    filterMfaRequired: string[]; // Multi-select: empty = all, e.g. ["azure-mfa", "ca:c1"]
    filterJustificationRequired: "all" | "yes" | "no" | "na";
    filterMaxDuration: string[]; // Multi-select: empty = all, e.g. ["<1h", "5-8h"]
    filterScopeType: "all" | "tenant-wide" | "application" | "administrative-unit" | "rmau" | "scoped"; // NEW: Scope filtering

    // Group-specific filters (only apply when PIM Groups is visible)
    filterGroupType: "all" | "security" | "m365" | "mail-enabled";
    filterAccessType: "all" | "member" | "owner";
    filterUnmanagedVisibility: "all" | "managed" | "unmanaged";
}

// Available filter options based on data analysis
export interface AvailableFilterOptions {
    hasAssignmentTypes: {
        permanent: boolean;
        eligible: boolean;
        active: boolean;
    };
    hasMemberTypes: {
        direct: boolean;
        group: boolean;
    };
    hasDurations: {
        permanent: boolean;
        timebound: boolean;
    };
    hasPrivileged: {
        yes: boolean;
        no: boolean;
    };
    hasPimConfigured: {
        yes: boolean;
        no: boolean;
    };
    hasAssignments: {
        yes: boolean;
        no: boolean;
    };
    assignmentCountRanges: Set<string>;
    hasApproval: {
        yes: boolean;
        no: boolean;
        na: boolean;
    };
    mfaTypes: Set<string>; // "none", "azure-mfa", "ca:c1", "ca:c2", etc.
    authContexts: Set<string>; // CA context IDs: "c1", "c2", etc.
    hasJustification: {
        yes: boolean;
        no: boolean;
        na: boolean;
    };
    maxDurations: Set<string>;
    hasScopeTypes: { // NEW: Track which scope types exist in data
        tenantWide: boolean;
        application: boolean;
        administrativeUnit: boolean;
        rmau: boolean;
    };

    // Group-specific filter options (populated when PIM Groups visible)
    hasGroupTypes: {
        security: boolean;
        m365: boolean;
        mailEnabled: boolean;
    };
    hasAccessTypes: {
        member: boolean;
        owner: boolean;
    };
}

// Filter group collapse states
export interface FilterGroupStates {
    rolePropsExpanded: boolean;
    assignmentsFilterExpanded: boolean;
    pimConfigFilterExpanded: boolean;
}
