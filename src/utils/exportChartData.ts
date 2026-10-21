import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { getAuthContextDisplayName, type AuthenticationContext } from "@/utils/authContextApi";
import { parseTotalHours } from "@/utils/durationUtils";
import { getAssignmentMemberType } from "@/utils/principalUtils";

/**
 * The seven datasets of the PDF export (tables and chart images), moved unchanged in meaning from the old
 * Recharts based dashboard charts so the export keeps working until NG-21 replaces it. The page passes what the chips count.
 */

export interface ChartItem {
    name: string;
    value: number;
    color: string;
}

export interface ExportChartData {
    assignmentData: ChartItem[];
    assignmentMethodData: ChartItem[];
    mfaData: ChartItem[];
    approvalData: ChartItem[];
    durationData: ChartItem[];
    managedData: ChartItem[];
    authContextData: ChartItem[];
    /** Groups whose policies Graph answered 403 on: left out of the MFA, approval and duration datasets, never counted as "None" */
    groupSettingsNotReadable: number;
    /** Roles whose policy Graph answered 403 on (FIX-12): left out of the same three datasets */
    roleSettingsNotReadable: number;
}

export interface ExportChartInput {
    rolesData: RoleDetailData[];
    groupsData: PimGroupData[];
    isDirectoryRolesCounted: boolean;
    isPimGroupsCounted: boolean;
    authenticationContexts?: AuthenticationContext[];
}

const RULE = "#microsoft.graph.unifiedRoleManagementPolicy";
const AUTH_CONTEXT_COLORS = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#6366f1", "#f43f5e"];

function sumGroups(groups: PimGroupData[], type: "eligible" | "active" | "permanent"): number {
    return groups.reduce((sum, g) => sum + g.assignments.filter((a) => a.assignmentType === type).length, 0);
}

export function buildExportChartData({ rolesData, groupsData, isDirectoryRolesCounted, isPimGroupsCounted, authenticationContexts = [] }: ExportChartInput): ExportChartData {
    const roles = isDirectoryRolesCounted ? rolesData : [];
    const groups = isPimGroupsCounted ? groupsData : [];

    const permanent = roles.reduce((s, r) => s + (r.assignments?.permanent?.length || 0), 0) + sumGroups(groups, "permanent");
    const eligible = roles.reduce((s, r) => s + (r.assignments?.eligible?.length || 0), 0) + sumGroups(groups, "eligible");
    const assignmentData: ChartItem[] = [
        { name: "Permanent", value: permanent, color: "#f59e0b" },
        { name: "Eligible", value: eligible, color: "#10b981" },
    ];

    const everyAssignment = (role: RoleDetailData) => [...role.assignments.eligible, ...role.assignments.active, ...role.assignments.permanent];
    const countMemberType = (type: "Direct" | "Group") => roles.reduce((sum, role) => sum + everyAssignment(role).filter((a) => getAssignmentMemberType(a) === type).length, 0);
    const assignmentMethodData: ChartItem[] = [
        { name: "Direct", value: countMemberType("Direct"), color: "#3b82f6" },
        { name: "Group", value: countMemberType("Group"), color: "#8b5cf6" },
    ];

    // A role whose policy is not readable (FIX-12) is not "no MFA" or "no approval" either: the same as a group below
    const rolesWithSettings = roles.filter((r) => !r.policiesForbidden);
    const roleSettingsNotReadable = roles.length - rolesWithSettings.length;

    let pimNativeMfa = 0;
    let conditionalAccess = 0;
    let noMfaOrCa = 0;
    for (const role of rolesWithSettings) {
        const rules = role.policy?.details.rules;
        const enablement = rules?.find((r) => r["@odata.type"] === `${RULE}EnablementRule` && r.target?.caller === "EndUser");
        const authContext = rules?.find((r) => r["@odata.type"] === `${RULE}AuthenticationContextRule` && r.target?.caller === "EndUser");
        if (enablement?.enabledRules?.includes("MultiFactorAuthentication")) pimNativeMfa++;
        else if (authContext?.isEnabled && authContext?.claimValue) conditionalAccess++;
        else noMfaOrCa++;
    }
    // A group whose policies are not readable (FIX-11) is not "no MFA" or "no approval": it stays out of these three datasets
    const groupsWithSettings = groups.filter((g) => !g.policiesForbidden);
    const groupSettingsNotReadable = groups.length - groupsWithSettings.length;
    for (const group of groupsWithSettings) {
        if (group.settings) {
            if (group.settings.memberRequiresMfa) pimNativeMfa++;
            else noMfaOrCa++;
            if (group.settings.ownerRequiresMfa) pimNativeMfa++;
            else noMfaOrCa++;
        } else if (group.policies) {
            noMfaOrCa += 2;
        }
    }
    const mfaData: ChartItem[] = [
        { name: "Azure MFA", value: pimNativeMfa, color: "#3b82f6" },
        { name: "Conditional Access", value: conditionalAccess, color: "#8b5cf6" },
        { name: "None", value: noMfaOrCa, color: "#6b7280" },
    ];

    let withApproval = 0;
    let withoutApproval = 0;
    for (const role of rolesWithSettings) {
        const rule = role.policy?.details.rules?.find((r) => r["@odata.type"] === `${RULE}ApprovalRule`);
        if (rule?.setting?.isApprovalRequired) withApproval++;
        else withoutApproval++;
    }
    for (const group of groupsWithSettings) {
        if (group.settings) {
            if (group.settings.memberRequiresApproval) withApproval++;
            else withoutApproval++;
            if (group.settings.ownerRequiresApproval) withApproval++;
            else withoutApproval++;
        } else {
            withoutApproval += 2;
        }
    }
    const approvalData: ChartItem[] = [
        { name: "Approval Required", value: withApproval, color: "#8b5cf6" },
        { name: "No Approval", value: withoutApproval, color: "#6b7280" },
    ];

    const buckets: Record<string, number> = { "<1h": 0, "2-4h": 0, "5-8h": 0, "9-12h": 0, ">12h": 0, "N/A": 0 };
    const categorize = (iso?: string) => {
        if (!iso) {
            buckets["N/A"]++;
            return;
        }
        const hours = parseTotalHours(iso) ?? 0;
        if (hours <= 1) buckets["<1h"]++;
        else if (hours >= 2 && hours <= 4) buckets["2-4h"]++;
        else if (hours >= 5 && hours <= 8) buckets["5-8h"]++;
        else if (hours >= 9 && hours <= 12) buckets["9-12h"]++;
        else buckets[">12h"]++;
    };
    for (const role of rolesWithSettings) {
        const rule = role.policy?.details.rules?.find((r) => r["@odata.type"] === `${RULE}ExpirationRule` && r.target?.caller === "EndUser");
        categorize(rule?.maximumDuration);
    }
    for (const group of groupsWithSettings) {
        if (group.settings) {
            categorize(group.settings.memberMaxDuration);
            categorize(group.settings.ownerMaxDuration);
        } else {
            buckets["N/A"] += 2;
        }
    }
    const BUCKET_COLORS: Record<string, string> = { "N/A": "#6b7280", "<1h": "#10b981", "2-4h": "#22c55e", "5-8h": "#3b82f6", "9-12h": "#f59e0b", ">12h": "#ef4444" };
    const durationData: ChartItem[] = Object.entries(buckets).map(([name, value]) => ({ name, value, color: BUCKET_COLORS[name] }));

    const managedData: ChartItem[] = [
        { name: "Managed", value: groupsData.filter((g) => g.isManaged !== false).length, color: "#10b981" },
        { name: "Unmanaged", value: groupsData.filter((g) => g.isManaged === false).length, color: "#ef4444" },
    ];

    const counts = new Map<string, number>();
    for (const role of roles) {
        const rule = role.policy?.details.rules?.find((r) => r["@odata.type"] === `${RULE}AuthenticationContextRule` && r.target?.caller === "EndUser");
        if (rule?.isEnabled && rule.claimValue) counts.set(rule.claimValue, (counts.get(rule.claimValue) ?? 0) + 1);
    }
    const authContextData: ChartItem[] = [...counts.entries()].map(([contextId, value], index) => ({
        name: getAuthContextDisplayName(authenticationContexts, contextId) || contextId,
        value,
        color: AUTH_CONTEXT_COLORS[index % AUTH_CONTEXT_COLORS.length],
    }));

    return { assignmentData, assignmentMethodData, mfaData, approvalData, durationData, managedData, authContextData, groupSettingsNotReadable, roleSettingsNotReadable };
}
