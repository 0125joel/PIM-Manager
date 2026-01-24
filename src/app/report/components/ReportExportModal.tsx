import { useState, useEffect } from "react";
import { Download, FileSpreadsheet, FileJson, Check, X, Loader2, Shield, Users, Layers, AlertCircle } from "lucide-react";
import { RoleDetailData } from "@/types/directoryRole.types";
import { PimGroupData } from "@/types/pimGroup.types";
import { getAuthContextDisplayName } from "@/utils/authContextApi";

interface ReportExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    filteredRoles: RoleDetailData[];
    pimGroupsData: PimGroupData[];
    isPimGroupsVisible: boolean;
    authenticationContexts: any[];
}

type ExportFormat = "csv" | "json";

export function ReportExportModal({
    isOpen,
    onClose,
    filteredRoles,
    pimGroupsData,
    isPimGroupsVisible,
    authenticationContexts
}: ReportExportModalProps) {
    const [format, setFormat] = useState<ExportFormat>("csv");
    const [isExporting, setIsExporting] = useState(false);

    const [selectedSections, setSelectedSections] = useState({
        rolePolicies: true,
        accessRights: true,
        groupPolicies: isPimGroupsVisible
    });

    // Update group policies selection if visibility changes
    useEffect(() => {
        if (!isPimGroupsVisible) {
            setSelectedSections(prev => ({ ...prev, groupPolicies: false }));
        }
    }, [isPimGroupsVisible]);

    if (!isOpen) return null;

    const sections = [
        {
            key: "rolePolicies",
            label: "Role Policies",
            description: "Configuration & Security Settings (MFA, Expiration)",
            icon: Shield,
            hasData: filteredRoles.length > 0
        },
        {
            key: "accessRights",
            label: "Access Rights",
            description: "User & Group Assignments (Who has what access)",
            icon: Users,
            hasData: filteredRoles.length > 0
        },
        {
            key: "groupPolicies",
            label: "Group Policies",
            description: "Configuration & Security Settings (Member & Owner policies)",
            icon: Layers,
            hasData: isPimGroupsVisible && pimGroupsData.length > 0
        }
    ];

    const toggleSection = (key: keyof typeof selectedSections) => {
        setSelectedSections(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleExport = async () => {
        setIsExporting(true);

        // Small delay to show loading state
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            if (format === "json") {
                // JSON Export - Combined File
                const exportData: any = {};
                if (selectedSections.rolePolicies || selectedSections.accessRights) {
                    exportData.roles = filteredRoles; // Contains both policy and assignment data
                }
                if (selectedSections.groupPolicies) {
                    exportData.groups = pimGroupsData;
                }

                const dataStr = JSON.stringify(exportData, null, 2);
                downloadFile(dataStr, `pim-data-export-${new Date().toISOString()}.json`, "application/json");
            } else {
                // CSV Exports - Multiple Files
                if (selectedSections.rolePolicies) {
                    const content = generateRoleSummaryCsv();
                    downloadFile(content, `pim-role-policies-${getDateStr()}.csv`, "text/csv;charset=utf-8;");
                }

                if (selectedSections.accessRights) {
                    const content = generateAssignmentDetailCsv();
                    downloadFile(content, `pim-access-rights-${getDateStr()}.csv`, "text/csv;charset=utf-8;");
                }

                if (selectedSections.groupPolicies) {
                    const content = generateGroupSummaryCsv();
                    downloadFile(content, `pim-group-policies-${getDateStr()}.csv`, "text/csv;charset=utf-8;");
                }
            }
            onClose();
        } catch (error) {
            console.error("Export failed", error);
            // In a real app, user toast notification here
        } finally {
            setIsExporting(false);
        }
    };

    // --- Helper Functions ---

    const getDateStr = () => new Date().toISOString().split('T')[0];

    const downloadFile = (content: string, filename: string, type: string) => {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // --- CSV Generators (Logic from ReportExportMenu) ---

    const generateRoleSummaryCsv = () => {
        const headers = [
            "Role Name", "Description", "Built-in", "Privileged", "PIM Configured",
            "Max Activation Duration", "MFA Required", "Justification Required",
            "Approval Required", "Approvers", "Auth Context",
            "Permanent Count", "Eligible Count", "Active Count", "Total Assignments"
        ];

        const rows = filteredRoles.map(roleData => {
            const { definition, assignments, policy } = roleData;
            const isPimConfigured = !!policy && policy.details.rules && policy.details.rules.length > 0;

            let maxDuration = "", mfaRequired = "", justificationRequired = "", approvalRequired = "", approvers = "", authContext = "";

            if (policy?.details?.rules) {
                for (const rule of policy.details.rules) {
                    const ruleType = rule["@odata.type"];
                    const target = rule.target;
                    const isTarget = (c: string, l: string) => target?.caller === c && target?.level === l;

                    if (isTarget("EndUser", "Assignment")) {
                        if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule") {
                            maxDuration = rule.maximumDuration || ""; // Raw ISO
                        }
                        if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyEnablementRule") {
                            const enabledRules = rule.enabledRules || [];
                            if (enabledRules.includes("MultiFactorAuthentication")) mfaRequired = "Yes";
                            if (enabledRules.includes("Justification")) justificationRequired = "Yes";
                        }
                        if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule") {
                            approvalRequired = rule.setting?.isApprovalRequired ? "Yes" : "No";
                            const stages = rule.setting?.approvalStages || [];
                            const approverNames = stages.flatMap((s: any) => s.primaryApprovers || [])
                                .map((a: any) => a.displayName || a.description || a.id).filter(Boolean);
                            approvers = approverNames.join("; ");
                        }
                        if (ruleType === "#microsoft.graph.unifiedRoleManagementPolicyAuthenticationContextRule") {
                            if (rule.isEnabled) {
                                authContext = rule.claimValue ? (getAuthContextDisplayName(authenticationContexts, rule.claimValue) || rule.claimValue) : "";
                            }
                        }
                    }
                }
            }

            return [
                `"${definition.displayName.replace(/"/g, '""')}"`,
                `"${(definition.description || '').replace(/"/g, '""')}"`,
                definition.isBuiltIn ? "Yes" : "No", definition.isPrivileged ? "Yes" : "No", isPimConfigured ? "Yes" : "No",
                maxDuration, mfaRequired || "No", justificationRequired || "No", approvalRequired || "",
                `"${approvers}"`, `"${authContext}"`,
                assignments.permanent.length, assignments.eligible.length, assignments.active.length,
                assignments.permanent.length + assignments.eligible.length + assignments.active.length
            ].join(",");
        });

        return [headers.join(","), ...rows].join("\n");
    };

    const generateAssignmentDetailCsv = () => {
        const headers = [
            "Resource Name", "Principal Name", "Principal Type", "Principal Email",
            "Assignment Type", "Member Type", "Scope Type", "Scope ID",
            "Start Date", "Expiry Date", "Status"
        ];
        const rows: string[] = [];

        // Helper to push row
        const pushRow = (resourceName: string, item: any, type: string, dates: any) => {
            const principal = item.principal;
            const principalType = principal?.["@odata.type"]?.includes("group") ? "Group" : "User";
            const memberType = item.memberType || "Direct";

            rows.push([
                `"${resourceName.replace(/"/g, '""')}"`,
                `"${(principal?.displayName || item.principalId).replace(/"/g, '""')}"`,
                principalType,
                `"${principal?.mail || principal?.userPrincipalName || ''}"`,
                type,
                memberType,
                item.scopeInfo?.type || "tenant-wide",
                item.directoryScopeId || "/",
                dates.start || "",
                dates.end || (dates.noExp ? "No Expiration" : ""),
                item.status || "Provisioned"
            ].join(","));
        };

        // 1. Directory Roles
        filteredRoles.forEach(roleData => {
            const { definition, assignments } = roleData;

            assignments.permanent.forEach((a: any) => pushRow(definition.displayName, a, "Permanent", { start: a.createdDateTime, end: "" }));
            assignments.eligible.forEach((s: any) => pushRow(definition.displayName, s, "Eligible", {
                start: s.scheduleInfo?.startDateTime,
                end: s.scheduleInfo?.expiration?.endDateTime,
                noExp: s.scheduleInfo?.expiration?.type === "noExpiration"
            }));
            assignments.active.forEach((s: any) => pushRow(definition.displayName, s, "Active (PIM)", {
                start: s.scheduleInfo?.startDateTime,
                end: s.scheduleInfo?.expiration?.endDateTime
            }));
        });

        // 2. PIM Groups (if visible)
        if (isPimGroupsVisible) {
            pimGroupsData.forEach(groupData => {
                const { group, assignments } = groupData;

                // PIM Group assignments don't have "active vs eligible" arrays separated quite the same way
                // in the `assignments` array they are mixed but tagged with `assignmentType`

                assignments.forEach(assignment => {
                    const typeLabel = assignment.assignmentType === 'eligible'
                        ? 'Eligible'
                        : assignment.assignmentType === 'active'
                            ? 'Active (PIM)'
                            : 'Permanent';

                    // Determine Member vs Owner based on roleId?
                    // Usually "Member" or "Owner" is in the roleDefinitionId, but we might have mapped it.
                    // The `assignment` object in `PimGroupData` has `memberType` ("Direct" | "Group")
                    // but we need to verify the role. `accessType` provides "member" or "owner".

                    const roleName = assignment.accessType
                        ? assignment.accessType.charAt(0).toUpperCase() + assignment.accessType.slice(1) // "Member" or "Owner"
                        : "Member";
                    const resourceLabel = `${group.displayName} (${roleName})`;

                    pushRow(resourceLabel, assignment, typeLabel, {
                        start: assignment.startDateTime,
                        end: assignment.endDateTime,
                        noExp: assignment.endDateTime === "No Expiration" || !assignment.endDateTime
                    });
                });
            });
        }

        return [headers.join(","), ...rows].join("\n");
    };

    const generateGroupSummaryCsv = () => {
        const headers = [
            "Group Name", "Group Type", "Role-Assignable",
            "Eligible Members", "Eligible Owners", "Active Members", "Active Owners",
            "Member Max Duration", "Member MFA", "Member Approval",
            "Owner Max Duration", "Owner MFA", "Owner Approval"
        ];
        const rows = pimGroupsData.map(g => {
            const { group, stats, settings } = g;
            return [
                `"${group.displayName.replace(/"/g, '""')}"`,
                group.groupType, group.isAssignableToRole ? "Yes" : "No",
                stats?.eligibleMembers || 0, stats?.eligibleOwners || 0, stats?.activeMembers || 0, stats?.activeOwners || 0,
                settings?.memberMaxDuration || "", settings?.memberRequiresMfa ? "Yes" : "No", settings?.memberRequiresApproval ? "Yes" : "No",
                settings?.ownerMaxDuration || "", settings?.ownerRequiresMfa ? "Yes" : "No", settings?.ownerRequiresApproval ? "Yes" : "No"
            ].join(",");
        });
        return [headers.join(","), ...rows].join("\n");
    };

    const selectedCount = Object.values(selectedSections).filter(Boolean).length;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                            <Download className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Export Data</h2>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">Choose format and content</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors">
                        <X className="h-5 w-5 text-zinc-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-6 overflow-y-auto">
                    {/* Format Selection */}
                    <div>
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Export Format</h3>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setFormat("csv")}
                                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${format === "csv"
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                    }`}
                            >
                                <FileSpreadsheet className="h-4 w-4" />
                                <span className="font-medium">CSV (Excel)</span>
                            </button>
                            <button
                                onClick={() => setFormat("json")}
                                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${format === "json"
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500"
                                    : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                    }`}
                            >
                                <FileJson className="h-4 w-4" />
                                <span className="font-medium">JSON (Raw)</span>
                            </button>
                        </div>
                    </div>

                    {/* Section Selection */}
                    <div>
                        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Include Data</h3>
                        <div className="space-y-2">
                            {sections.map((section) => (
                                <label
                                    key={section.key}
                                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedSections[section.key as keyof typeof selectedSections]
                                        ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10"
                                        : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                        } ${!section.hasData ? "opacity-50 cursor-not-allowed" : ""}`}
                                >
                                    <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${selectedSections[section.key as keyof typeof selectedSections]
                                        ? "bg-emerald-500 text-white"
                                        : "border-2 border-zinc-300 dark:border-zinc-600"
                                        }`}>
                                        {selectedSections[section.key as keyof typeof selectedSections] && <Check className="h-3 w-3" />}
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={selectedSections[section.key as keyof typeof selectedSections]}
                                        onChange={() => section.hasData && toggleSection(section.key as keyof typeof selectedSections)}
                                        disabled={!section.hasData}
                                        className="sr-only"
                                    />
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <section.icon className={`h-4 w-4 ${selectedSections[section.key as keyof typeof selectedSections] ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400"}`} />
                                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{section.label}</span>
                                        </div>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                            {section.description}
                                        </p>
                                    </div>
                                    {!section.hasData && (
                                        <span className="text-xs text-zinc-400 flex-shrink-0">No data</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
                    <p className="text-sm text-zinc-500">
                        {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={isExporting || selectedCount === 0}
                            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                        >
                            {isExporting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <Download className="h-4 w-4" />
                                    Export {format.toUpperCase()}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
