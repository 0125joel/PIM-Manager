"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useMsal } from "@azure/msal-react";
import { Client } from "@microsoft/microsoft-graph-client";
import { RoleAssignment } from "@/types";
import { Users, User, ChevronDown, ChevronRight } from "lucide-react";

interface AssignmentOverviewProps {
    onDataLoad?: (inPim: number, outsidePim: number) => void;
}

export function AssignmentOverview({ onDataLoad }: AssignmentOverviewProps) {
    const { instance, accounts } = useMsal();
    const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<"all" | "group" | "individual">("all");
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [groupMembers, setGroupMembers] = useState<Map<string, any[]>>(new Map());

    useEffect(() => {
        const fetchAssignments = async () => {
            if (accounts.length === 0) return;

            setLoading(true);
            try {
                const request = {
                    scopes: ["RoleAssignmentSchedule.Read.Directory", "RoleEligibilitySchedule.Read.Directory", "User.Read.All", "Group.Read.All"],
                    account: accounts[0],
                };

                const response = await instance.acquireTokenSilent(request).catch(async () => {
                    return await instance.acquireTokenPopup(request);
                });
                const graphClient = Client.init({
                    authProvider: (done) => done(null, response.accessToken),
                });

                // Fetch both eligible and active assignments
                const [eligibleRes, activeRes, rolesRes] = await Promise.all([
                    graphClient.api("/roleManagement/directory/roleEligibilitySchedules").expand("principal,roleDefinition").get(),
                    graphClient.api("/roleManagement/directory/roleAssignmentSchedules").expand("principal,roleDefinition").get(),
                    graphClient.api("/roleManagement/directory/roleDefinitions").get(),
                ]);

                const rolesMap = new Map(rolesRes.value.map((r: any) => [r.id, r.displayName]));

                const parseAssignments = (items: any[], type: "Eligible" | "Active") => {
                    return items.map((item: any) => ({
                        id: item.id,
                        roleDefinitionId: item.roleDefinitionId,
                        principalId: item.principalId,
                        principalType: (item.principal?.["@odata.type"]?.includes("group") ? "Group" : "User") as "User" | "Group",
                        principalDisplayName: item.principal?.displayName || "Unknown",
                        assignmentType: type,
                        startDateTime: item.startDateTime,
                        endDateTime: item.endDateTime,
                        memberType: (item.memberType || "Direct") as "Direct" | "Group",
                    }));
                };

                const allAssignments = [
                    ...parseAssignments(eligibleRes.value, "Eligible"),
                    ...parseAssignments(activeRes.value, "Active"),
                ];

                setAssignments(allAssignments);

                // Calculate PIM coverage
                const rolesWithPim = new Set(allAssignments.map(a => a.roleDefinitionId));
                const totalRoles = rolesRes.value.length;
                const inPim = rolesWithPim.size;
                const outsidePim = totalRoles - inPim;

                if (onDataLoad) {
                    onDataLoad(inPim, outsidePim);
                }
            } catch (error: any) {
                if (process.env.NODE_ENV === 'development') {
                    console.error("Failed to fetch assignments:", error);
                }
                setError(`Failed to load assignments: ${error.message || 'Unknown error'}`);
                // Fallback data
                setAssignments([
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
                ]);
                if (onDataLoad) onDataLoad(5, 15);
            } finally {
                setLoading(false);
            }
        };

        fetchAssignments();
    }, [instance, accounts, onDataLoad]);

    const toggleGroup = async (groupId: string) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(groupId)) {
            newExpanded.delete(groupId);
        } else {
            newExpanded.add(groupId);
            // Fetch group members if not already loaded
            if (!groupMembers.has(groupId)) {
                try {
                    const request = {
                        scopes: ["Group.Read.All"],
                        account: accounts[0],
                    };
                    const response = await instance.acquireTokenSilent(request);
                    const graphClient = Client.init({
                        authProvider: (done) => done(null, response.accessToken),
                    });

                    const members = await graphClient.api(`/groups/${groupId}/members`).get();
                    setGroupMembers(new Map(groupMembers.set(groupId, members.value)));
                } catch (error) {
                    console.error("Failed to fetch group members", error);
                }
            }
        }
        setExpandedGroups(newExpanded);
    };

    const filteredAssignments = useMemo(() => {
        return assignments.filter((a) => {
            if (filter === "all") return true;
            if (filter === "group") return a.principalType === "Group";
            if (filter === "individual") return a.principalType === "User";
            return true;
        });
    }, [assignments, filter]);

    return (
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-md border border-zinc-200 dark:border-zinc-800">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
                <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Role Assignments</h2>

                {/* Filters */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setFilter("all")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${filter === "all"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                    >
                        All Assignments
                    </button>
                    <button
                        onClick={() => setFilter("group")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${filter === "group"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                    >
                        Group Assignments
                    </button>
                    <button
                        onClick={() => setFilter("individual")}
                        className={`px-4 py-2 text-sm rounded-lg transition-colors ${filter === "individual"
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                    >
                        Individual Assignments
                    </button>
                </div>
            </div>

            {error && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg mx-6 mt-4">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">{error}</p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Showing demo data. Check console for details.</p>
                </div>
            )}

            {loading ? (
                <div className="p-6 text-center text-zinc-500">Loading assignments...</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Principal
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Type
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Assignment
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                                    Duration
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                            {filteredAssignments.map((assignment) => (
                                <React.Fragment key={assignment.id}>
                                    <tr key={assignment.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                {assignment.principalType === "Group" ? (
                                                    <>
                                                        <button
                                                            onClick={() => toggleGroup(assignment.principalId)}
                                                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                                        >
                                                            {expandedGroups.has(assignment.principalId) ? (
                                                                <ChevronDown className="h-4 w-4" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4" />
                                                            )}
                                                        </button>
                                                        <Users className="h-4 w-4 text-green-500" />
                                                    </>
                                                ) : (
                                                    <User className="h-4 w-4 text-blue-500 ml-6" />
                                                )}
                                                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                    {assignment.principalDisplayName}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs rounded-full ${assignment.principalType === "Group"
                                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                                }`}>
                                                {assignment.principalType}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 text-xs rounded-full ${assignment.assignmentType === "Eligible"
                                                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
                                                }`}>
                                                {assignment.assignmentType}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                                            {assignment.endDateTime ? (
                                                <span>Until {new Date(assignment.endDateTime).toLocaleDateString()}</span>
                                            ) : (
                                                <span>Permanent</span>
                                            )}
                                        </td>
                                    </tr>
                                    {/* Group members expansion */}
                                    {assignment.principalType === "Group" && expandedGroups.has(assignment.principalId) && (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-2 bg-zinc-50 dark:bg-zinc-800/50">
                                                <div className="pl-12 space-y-1">
                                                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">Group Members:</p>
                                                    {groupMembers.get(assignment.principalId)?.map((member: any) => (
                                                        <div key={member.id} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                                            <User className="h-3 w-3" />
                                                            {member.displayName} ({member.userPrincipalName || member.mail})
                                                        </div>
                                                    )) || <p className="text-xs text-zinc-500">Loading members...</p>}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                    {filteredAssignments.length === 0 && (
                        <div className="p-6 text-center text-zinc-500">No assignments found</div>
                    )}
                </div>
            )}
        </div>
    );
}
