"use client";

import { memo, useState } from "react";
import { PimGroupData, GroupType } from "@/types/pimGroup.types";
import {
    Users,
    ChevronDown,
    ChevronRight,
    Settings,
    CheckCircle2,
    Shield,
    Clock,
    Check,
    X,
    UserCheck,
    Crown,
    AlertTriangle
} from "lucide-react";

const groupTypeLabels: Record<string, string> = {
    "security": "Security Group",
    "m365": "Microsoft 365",
    "mailEnabled": "Mail-enabled Security",
    "unknown": "Unknown Type"
};

interface GroupCardProps {
    groupData: PimGroupData;
    isExpanded: boolean;
    onToggle: () => void;
    authenticationContexts?: any[];
}

const GroupCard = memo(function GroupCard({ groupData, isExpanded, onToggle, authenticationContexts = [] }: GroupCardProps) {
    const { group, assignments, stats, settings, isManaged } = groupData;

    // Early return for UNMANAGED groups (Security Warning Style)
    if (isManaged === false) {
        return (
            <div className="border border-red-200 dark:border-red-800/50 rounded-lg overflow-hidden relative">
                <div className="p-4 bg-red-50 dark:bg-red-900/10 flex items-start sm:items-center justify-between gap-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                                {group.displayName}
                            </h3>
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                                Unmanaged Group
                            </span>
                        </div>
                        <p className="text-sm text-red-700 dark:text-red-300">
                            This role-assignable group is not managed by PIM. Assignments may be permanent and bypassing approval policies.
                        </p>
                    </div>
                    {/* Action Button (Placeholder for now) */}
                    {/* Action Button */}
                    <a
                        href={`https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Overview/groupId/${group.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-sm font-medium bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shadow-sm flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Review in Entra
                        <ChevronRight className="h-3 w-3" />
                    </a>
                </div>
                {/* Simplified Info Row */}
                <div className="px-4 py-3 bg-white dark:bg-zinc-900 flex items-center gap-4 text-xs text-zinc-500 border-t border-red-100 dark:border-red-900/30">
                    <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3" /> Role-assignable
                    </span>
                    <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {groupTypeLabels[group.groupType] || "Group"}
                    </span>
                </div>
            </div>
        );
    }

    // Normal Managed Group Logic
    // ...
    // Calculate totals
    const eligibleMembers = stats?.eligibleMembers || 0;
    const eligibleOwners = stats?.eligibleOwners || 0;
    const activeMembers = stats?.activeMembers || 0;
    const activeOwners = stats?.activeOwners || 0;
    const permanentMembers = assignments.filter(a => a.accessType === 'member' && a.assignmentType === 'permanent').length;
    const permanentOwners = assignments.filter(a => a.accessType === 'owner' && a.assignmentType === 'permanent').length;

    const totalAssignments = eligibleMembers + eligibleOwners + activeMembers + activeOwners + permanentMembers + permanentOwners;
    const hasPolicySettings = !!settings && (settings.memberMaxDuration || settings.ownerMaxDuration);

    // Independent state for each section
    const [assignmentsExpanded, setAssignmentsExpanded] = useState(false);
    const [configExpanded, setConfigExpanded] = useState(false);

    return (
        <div className="border border-purple-200 dark:border-purple-800/50 rounded-lg overflow-hidden">
            {/* Group Header */}
            <div className="p-4 bg-purple-50 dark:bg-purple-900/20">
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {group.displayName}
                            </h3>
                            <span className="px-2 py-0.5 text-xs rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400">
                                {groupTypeLabels[group.groupType]}
                            </span>
                            {group.isAssignableToRole && (
                                <span className="px-2 py-0.5 text-xs rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 flex items-center gap-1">
                                    <Shield className="h-3 w-3" />
                                    Role-assignable
                                </span>
                            )}
                        </div>
                        {group.description && (
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                                {group.description}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                        <div className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            <span>{totalAssignments} assignments</span>
                        </div>
                        {hasPolicySettings && (
                            <div className="flex items-center gap-1">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span>PIM Configured</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Assignments Section - Collapsible */}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
                <div
                    onClick={() => setAssignmentsExpanded(!assignmentsExpanded)}
                    className="p-4 bg-white dark:bg-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        {assignmentsExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                        <Users className="h-4 w-4 text-zinc-500" />
                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">Group Assignments</h4>
                        <span className="text-sm text-zinc-500">({totalAssignments})</span>
                    </div>
                </div>
                {assignmentsExpanded && (
                    <div className="px-6 pb-6 bg-white dark:bg-zinc-900">
                        <GroupAssignmentsSection assignments={assignments} stats={stats} />
                    </div>
                )}
            </div>

            {/* Policy Configuration Section - Collapsible */}
            <div className="border-t border-zinc-200 dark:border-zinc-800">
                <div
                    onClick={() => {
                        setConfigExpanded(!configExpanded);
                        if (!configExpanded) {
                            onToggle();
                        }
                    }}
                    className="p-4 bg-white dark:bg-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
                >
                    <div className="flex items-center gap-2">
                        {configExpanded ? (
                            <ChevronDown className="h-4 w-4 text-zinc-500" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-zinc-500" />
                        )}
                        <Settings className="h-4 w-4 text-zinc-500" />
                        <h4 className="font-medium text-zinc-900 dark:text-zinc-100">PIM Configuration</h4>
                    </div>
                    {hasPolicySettings ? (
                        <span className="text-sm text-green-600 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Configured
                        </span>
                    ) : (
                        <span className="text-sm text-zinc-500">Not Configured</span>
                    )}
                </div>
                {configExpanded && (
                    <div className="px-6 pb-6 bg-white dark:bg-zinc-900">
                        <GroupPolicySection
                            settings={settings}
                            policies={groupData.policies}
                            authenticationContexts={authenticationContexts}
                        />
                    </div>
                )}
            </div>
        </div>
    );
});

function GroupAssignmentsSection({ assignments, stats }: { assignments: PimGroupData['assignments'], stats?: PimGroupData['stats'] }) {
    // Group by accessType and assignmentType
    const eligibleMembers = assignments.filter(a => a.accessType === 'member' && a.assignmentType === 'eligible');
    const eligibleOwners = assignments.filter(a => a.accessType === 'owner' && a.assignmentType === 'eligible');
    const activeMembers = assignments.filter(a => a.accessType === 'member' && a.assignmentType === 'active');
    const activeOwners = assignments.filter(a => a.accessType === 'owner' && a.assignmentType === 'active');
    const permanentMembers = assignments.filter(a => a.accessType === 'member' && a.assignmentType === 'permanent');
    const permanentOwners = assignments.filter(a => a.accessType === 'owner' && a.assignmentType === 'permanent');

    const totalAssignments = assignments.length;

    if (totalAssignments === 0) {
        return <div className="text-sm text-zinc-500 italic">No assignments found</div>;
    }

    // Assignment row component - aligned with RoleCard's ScheduleRow
    const AssignmentRow = ({ assignment, type }: { assignment: PimGroupData['assignments'][0], type: string }) => {
        const principalType = assignment.principal?.["@odata.type"]?.includes("group") ? "group" : "user";
        const principalName = assignment.principal?.displayName || assignment.principalId;
        const principalEmail = assignment.principal?.mail || assignment.principal?.userPrincipalName;
        const memberType = assignment.memberType || "Direct";
        const isDirect = memberType === "Direct";

        return (
            <div className="text-sm bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded">
                {/* Row 1: Name and badges */}
                <div className="flex items-center justify-between mb-1">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {principalName}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                            {principalType}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${type === 'eligible' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
                            type === 'active' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' :
                                'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            }`}>
                            {type}
                        </span>
                    </div>
                </div>

                {/* Row 2: UPN/Email */}
                {principalEmail && (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                        {principalEmail}
                    </div>
                )}

                {/* Row 3: Member Type + Duration */}
                <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className={`px-2 py-0.5 rounded ${isDirect
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        }`}>
                        {isDirect ? "Direct" : "Via Group"}
                    </span>

                    {assignment.scheduleInfo && (
                        <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {assignment.scheduleInfo.expiration?.type === "noExpiration" ? (
                                <span>Permanent</span>
                            ) : assignment.scheduleInfo.expiration?.endDateTime ? (
                                <span>Expires: {new Date(assignment.scheduleInfo.expiration.endDateTime).toLocaleDateString()}</span>
                            ) : assignment.endDateTime ? (
                                <span>Expires: {new Date(assignment.endDateTime).toLocaleDateString()}</span>
                            ) : (
                                <span>Active</span>
                            )}
                        </div>
                    )}

                    {!assignment.scheduleInfo && type === 'permanent' && (
                        <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Permanent</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            {/* Members Section */}
            {(eligibleMembers.length > 0 || activeMembers.length > 0 || permanentMembers.length > 0) && (
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <UserCheck className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Members ({eligibleMembers.length + activeMembers.length + permanentMembers.length})
                        </span>
                    </div>
                    <div className="space-y-4">
                        {permanentMembers.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    Permanent Assignments ({permanentMembers.length})
                                </div>
                                <div className="space-y-2">
                                    {permanentMembers.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="permanent" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {eligibleMembers.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    PIM Eligible ({eligibleMembers.length})
                                </div>
                                <div className="space-y-2">
                                    {eligibleMembers.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="eligible" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {activeMembers.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    PIM Active ({activeMembers.length})
                                </div>
                                <div className="space-y-2">
                                    {activeMembers.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="active" />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Owners Section */}
            {(eligibleOwners.length > 0 || activeOwners.length > 0 || permanentOwners.length > 0) && (
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <Crown className="h-4 w-4 text-purple-500" />
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Owners ({eligibleOwners.length + activeOwners.length + permanentOwners.length})
                        </span>
                    </div>
                    <div className="space-y-4">
                        {permanentOwners.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    Permanent Assignments ({permanentOwners.length})
                                </div>
                                <div className="space-y-2">
                                    {permanentOwners.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="permanent" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {eligibleOwners.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    PIM Eligible ({eligibleOwners.length})
                                </div>
                                <div className="space-y-2">
                                    {eligibleOwners.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="eligible" />
                                    ))}
                                </div>
                            </div>
                        )}
                        {activeOwners.length > 0 && (
                            <div>
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
                                    PIM Active ({activeOwners.length})
                                </div>
                                <div className="space-y-2">
                                    {activeOwners.map(a => (
                                        <AssignmentRow key={a.id} assignment={a} type="active" />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}


import { GroupActivationTab } from "./GroupActivationTab";
import { GroupAssignmentTab } from "./GroupAssignmentTab";
import { GroupNotificationTab } from "./GroupNotificationTab";

function GroupPolicySection({ settings, policies, authenticationContexts }: {
    settings?: PimGroupData['settings'],
    policies?: PimGroupData['policies'],
    authenticationContexts?: any[]
}) {
    const [roleTab, setRoleTab] = useState<"member" | "owner">("member");
    const [settingTab, setSettingTab] = useState<"activation" | "assignment" | "notification">("activation");

    if (!settings && !policies) {
        return (
            <div className="text-sm text-zinc-500 italic">
                No PIM policy configured for this group.
            </div>
        );
    }

    // Get current policy based on roleTab
    const currentPolicy = roleTab === "member" ? policies?.member : policies?.owner;
    // Safely cast to GroupPolicyRule[] as we know the structure, even if potentially loose
    const rules = (currentPolicy?.rules || []) as unknown as import("@/types/pimGroup.types").GroupPolicyRule[];

    return (
        <div>
            {/* Role-level tabs (Member | Owner) */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setRoleTab("member")}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${roleTab === "member"
                        ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                >
                    <UserCheck className="h-4 w-4" />
                    Member
                </button>
                <button
                    onClick={() => setRoleTab("owner")}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-2 ${roleTab === "owner"
                        ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                        : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        }`}
                >
                    <Crown className="h-4 w-4" />
                    Owner
                </button>
            </div>

            {/* Settings-level tabs (Activation | Assignment | Notification) */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-4">
                <button
                    onClick={() => setSettingTab("activation")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${settingTab === "activation"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Activation
                </button>
                <button
                    onClick={() => setSettingTab("assignment")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${settingTab === "assignment"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Assignment
                </button>
                <button
                    onClick={() => setSettingTab("notification")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${settingTab === "notification"
                        ? "border-blue-500 text-blue-600 dark:text-blue-400"
                        : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                        }`}
                >
                    Notification
                </button>
            </div>

            {/* Tab Content */}
            <div className="min-h-[180px] animate-in fade-in duration-200">
                {settingTab === "activation" && <GroupActivationTab rules={rules} authenticationContexts={authenticationContexts} />}
                {settingTab === "assignment" && <GroupAssignmentTab rules={rules} />}
                {settingTab === "notification" && <GroupNotificationTab rules={rules} />}
            </div>
        </div>
    );
}

export { GroupCard };
