"use client";

import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";

// ============================================================================
// PDF EXPORT CONFIGURATION
// ============================================================================
// Add new stats or sections here - they will automatically appear in:
// 1. The export modal checkbox list
// 2. The PDF document
// ============================================================================

export type WorkloadSelection = {
    directoryRoles: boolean;
    pimGroups: boolean;
};

/**
 * Overview stat definition
 * - key: Unique identifier (used for data lookup)
 * - label: Display name in PDF
 * - viewMode: 'basic' | 'advanced' | 'both' - controls visibility based on view mode
 * - calculate: Function to compute the stat value from rolesData
 */
export interface OverviewStatConfig {
    key: string;
    label: string;
    color?: string; // e.g. "blue", "green", "orange"
    description?: string; // Subtext description
    viewMode: "basic" | "advanced" | "both";
    calculate: (
        rolesData: RoleDetailData[],
        groupsData?: PimGroupData[],
        selectedWorkloads?: WorkloadSelection
    ) => string | number | { value: string | number; subtext: string };
}

/**
 * Chart section definition
 * - key: Unique identifier (used for selectedSections state)
 * - label: Display name in modal and PDF
 * - chartId: DOM element ID for html2canvas capture
 * - dataKey: Key in chartData object for table data
 */
export interface ChartSectionConfig {
    key: string;
    label: string;
    chartId: string;
    dataKey: string;
}

// ============================================================================
// OVERVIEW STATS CONFIGURATION
// ============================================================================
// To add a new stat: Add an entry here with calculate function
// It will automatically appear in the PDF export
// ============================================================================

export const OVERVIEW_STATS: OverviewStatConfig[] = [
    {
        key: "totalResources",
        label: "Total Items",
        color: "blue",
        description: "roles + groups",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let roleCount = 0;
            let groupCount = 0;
            if (selectedWorkloads?.directoryRoles !== false) roleCount = rolesData.length;
            if (selectedWorkloads?.pimGroups !== false) groupCount = groupsData.length;

            const total = roleCount + groupCount;
            if (roleCount > 0 && groupCount > 0) {
                return { value: total, subtext: `${roleCount} roles + ${groupCount} groups` };
            }
            return total;
        },
    },
    {
        key: "activeSessions",
        label: "Active Sessions",
        color: "emerald",
        description: "roles + group assignments",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let roleActive = 0;
            let groupActive = 0;

            if (selectedWorkloads?.directoryRoles !== false) {
                roleActive = rolesData.reduce((sum, role) => sum + (role.assignments?.active?.length || 0), 0);
            }
            if (selectedWorkloads?.pimGroups !== false) {
                groupActive = groupsData.reduce((sum, group) => sum + (group.assignments?.filter(a => a.assignmentType === "active").length || 0), 0);
            }

            const total = roleActive + groupActive;
            if (roleActive > 0 && groupActive > 0) {
                return { value: total, subtext: `${roleActive} roles + ${groupActive} group assignments` };
            }
            return total;
        },
    },
    {
        key: "permanentAssignments",
        label: "Permanent Assignments",
        color: "orange",
        description: "Always-on access",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let count = 0;
            if (selectedWorkloads?.directoryRoles !== false) {
                count += rolesData.reduce((sum, role) => sum + (role.assignments?.permanent?.length || 0), 0);
            }
            if (selectedWorkloads?.pimGroups !== false) {
                count += groupsData.reduce((sum, group) => sum + (group.assignments?.filter(a => a.assignmentType === "permanent").length || 0), 0);
            }
            return count;
        },
    },
    {
        key: "pimCoverage",
        label: "PIM Coverage",
        color: "purple",
        description: "Privileged roles with policy",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let privilegedResources = 0;
            let coveredResources = 0;

            // Directory Roles: Managed if defined policy exists (simplified proxy)
            if (selectedWorkloads?.directoryRoles !== false) {
                const privilegedRoles = rolesData.filter((r) => r.definition.isPrivileged);
                const rolesWithPolicy = privilegedRoles.filter((r) => r.policy);
                privilegedResources += privilegedRoles.length;
                coveredResources += rolesWithPolicy.length;
            }

            // PIM Groups: All PIM groups are by definition "managed", but check if policy loaded
            // For now, if they are in the list, they are PIM enabled.
            if (selectedWorkloads?.pimGroups !== false) {
                privilegedResources += groupsData.length;
                coveredResources += groupsData.length; // PIM Groups are always PIM-enabled
            }

            if (privilegedResources === 0) return "0%";
            return `${Math.round((coveredResources / privilegedResources) * 100)}%`;
        },
    },
    {
        key: "eligibleAssignments",
        label: "Eligible Assignments",
        color: "teal",
        description: "Users ready to activate",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let count = 0;
            if (selectedWorkloads?.directoryRoles !== false) {
                count += rolesData.reduce((sum, role) => sum + (role.assignments?.eligible?.length || 0), 0);
            }
            if (selectedWorkloads?.pimGroups !== false) {
                count += groupsData.reduce((sum, group) => sum + (group.assignments?.filter(a => a.assignmentType === "eligible").length || 0), 0);
            }
            return count;
        },
    },
    {
        key: "customRoles",
        label: "Custom Roles",
        color: "indigo",
        description: "Custom roles in use",
        viewMode: "both",
        calculate: (rolesData, groupsData, selectedWorkloads) => {
            // Only applicable to Directory Roles
            if (selectedWorkloads?.directoryRoles === false) return 0;
            return rolesData.filter((r) => !r.definition.isBuiltIn).length;
        },
    },
    {
        key: "rolesRequiringApproval",
        label: "Approval Required",
        color: "pink",
        description: "Roles with approval workflow",
        viewMode: "both",
        calculate: (rolesData, groupsData = [], selectedWorkloads) => {
            let count = 0;

            if (selectedWorkloads?.directoryRoles !== false) {
                count += rolesData.filter((r) => {
                    const approvalRule = r.policy?.details.rules?.find(
                        (rule: any) =>
                            rule["@odata.type"] === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule"
                    );
                    return approvalRule?.setting?.isApprovalRequired;
                }).length;
            }

            if (selectedWorkloads?.pimGroups !== false) {
                // Check settings if computed, or fallback to policy
                count += groupsData.filter(g => {
                    // Check if EITHER member OR owner requires approval
                    return g.settings?.memberRequiresApproval || g.settings?.ownerRequiresApproval;
                }).length;
            }

            return count;
        },
    },
];

// ============================================================================
// CHART SECTIONS CONFIGURATION
// ============================================================================
// To add a new chart section:
// 1. Add an entry here
// 2. Ensure the chart component has the matching chartId as DOM id
// 3. Ensure chartData includes the dataKey
// ============================================================================

export const CHART_SECTIONS: ChartSectionConfig[] = [
    {
        key: "assignment",
        label: "Assignment Distribution",
        chartId: "chart-assignment",
        dataKey: "assignmentData",
    },
    {
        key: "memberType",
        label: "Assignment Method",
        chartId: "chart-member-type",
        dataKey: "assignmentMethodData",
    },
    {
        key: "mfa",
        label: "MFA & CA Enforcement",
        chartId: "chart-mfa",
        dataKey: "mfaData",
    },
    {
        key: "approval",
        label: "Approval Requirements",
        chartId: "chart-approval",
        dataKey: "approvalData",
    },
    {
        key: "duration",
        label: "Max Duration",
        chartId: "chart-duration",
        dataKey: "durationData",
    },
    {
        key: "authContexts",
        label: "Authentication Contexts",
        chartId: "chart-auth-contexts",
        dataKey: "authContextData",
    },
    {
        key: "managedGroups",
        label: "PIM Groups Coverage",
        chartId: "chart-managed-groups",
        dataKey: "managedData",
    },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate all overview stats from rolesData and groupsData
 */
export function calculateOverviewStats(
    rolesData: RoleDetailData[],
    groupsData: PimGroupData[] = [],
    selectedWorkloads?: WorkloadSelection,
    viewMode: "basic" | "advanced" = "advanced"
): { label: string; value: string | number; color?: string; description?: string; subtext?: string }[] {
    return OVERVIEW_STATS.filter(
        (stat) => stat.viewMode === "both" || stat.viewMode === viewMode
    ).map((stat) => {
        const result = stat.calculate(rolesData, groupsData, selectedWorkloads);
        let value: string | number;
        let subtext: string | undefined;

        if (typeof result === 'object' && result !== null) { // Check if it returned { value, subtext }
            value = result.value;
            subtext = result.subtext;
        } else {
            value = result;
        }

        return {
            label: stat.label,
            value: value,
            color: stat.color,
            description: stat.description,
            subtext: subtext
        };
    });
}

/**
 * Get all section keys for initializing selectedSections state
 */
export function getInitialSelectedSections(): Record<string, boolean> {
    const sections: Record<string, boolean> = {
        overview: true,
        securityAlerts: true, // Security Alerts section (if permissions granted)
    };
    CHART_SECTIONS.forEach((section) => {
        sections[section.key] = true;
    });
    return sections;
}

/**
 * Get all chart IDs that should be captured (based on selection)
 */
export function getChartIdsToCapture(selectedSections: Record<string, boolean>): string[] {
    return CHART_SECTIONS.filter((section) => selectedSections[section.key]).map(
        (section) => section.chartId
    );
}
