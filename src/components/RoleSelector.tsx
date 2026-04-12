"use client";

import { useState, useMemo, useCallback } from "react";
import { RoleDefinition } from "@/types/shared.types";
import { RoleDetailData } from "@/types/directoryRole.types";
import { Check, Search, Shield, Users, AlertCircle, AlertTriangle } from "lucide-react";

interface RoleSelectorProps {
    onSelectionChange: (selectedRoleIds: string[]) => void;
    /** Optional pre-loaded roles data from PimDataContext */
    rolesData?: RoleDetailData[];
    /** Optional loading state from parent */
    loading?: boolean;
}

export function RoleSelector({ onSelectionChange, rolesData, loading }: RoleSelectorProps) {
    const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState<"all" | "builtin" | "custom">("all");
    const [filterPrivileged, setFilterPrivileged] = useState<"all" | "privileged">("all");
    const [filterHasAssignments, setFilterHasAssignments] = useState<"all" | "yes" | "no">("all");

    // Convert RoleDetailData[] to RoleDefinition[]
    const roles = useMemo(() => {
        if (rolesData) {
            return rolesData.map(rd => ({
                ...rd.definition,
                assignmentCount: rd.assignments.permanent.length + rd.assignments.eligible.length + rd.assignments.active.length
            })) as RoleDefinition[];
        }
        return [];
    }, [rolesData]);

    const toggleRole = (roleId: string) => {
        const newSelected = new Set(selectedRoles);
        if (newSelected.has(roleId)) {
            newSelected.delete(roleId);
        } else {
            newSelected.add(roleId);
        }
        setSelectedRoles(newSelected);
        onSelectionChange(Array.from(newSelected));
    };

    const filteredRoles = useMemo(() => {
        return roles.filter(role => {
            if (!role.displayName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (filterType === "builtin" && !role.isBuiltIn) return false;
            if (filterType === "custom" && role.isBuiltIn) return false;
            if (filterPrivileged === "privileged" && !role.isPrivileged) return false;
            if (filterHasAssignments !== "all") {
                const count = role.assignmentCount ?? 0;
                if (filterHasAssignments === "yes" && count === 0) return false;
                if (filterHasAssignments === "no" && count > 0) return false;
            }
            return true;
        });
    }, [roles, searchTerm, filterType, filterPrivileged, filterHasAssignments]);

    const handleSelectAll = useCallback(() => {
        const newSelected = new Set(selectedRoles);
        const allSelected = filteredRoles.length > 0 && filteredRoles.every(role => selectedRoles.has(role.id));

        if (allSelected) {
            filteredRoles.forEach(role => newSelected.delete(role.id));
        } else {
            filteredRoles.forEach(role => newSelected.add(role.id));
        }
        setSelectedRoles(newSelected);
        onSelectionChange(Array.from(newSelected));
    }, [filteredRoles, selectedRoles, onSelectionChange]);

    return (
        <div className="w-full bg-white dark:bg-zinc-900 rounded-lg shadow-md p-4 border border-zinc-200 dark:border-zinc-800 h-fit">
            <h2 className="text-xl font-semibold mb-4 text-zinc-900 dark:text-zinc-100">Select Roles</h2>

            <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-zinc-400 h-4 w-4" />
                <input
                    type="text"
                    placeholder="Search roles..."
                    className="w-full pl-10 pr-4 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Type</span>
                    <div className="flex gap-1.5">
                        {(["all", "builtin", "custom"] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setFilterType(v)}
                                className={`px-3 py-1 text-xs rounded-full transition-colors ${filterType === v
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                    }`}
                            >
                                {v === "all" ? "All" : v === "builtin" ? "Built-in" : "Custom"}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Privilege</span>
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => setFilterPrivileged("all")}
                            className={`px-3 py-1 text-xs rounded-full transition-colors ${filterPrivileged === "all"
                                ? "bg-blue-600 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                }`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilterPrivileged("privileged")}
                            className={`px-3 py-1 text-xs rounded-full transition-colors ${filterPrivileged === "privileged"
                                ? "bg-blue-600 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                }`}
                        >
                            Privileged
                        </button>
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Assignments</span>
                    <div className="flex gap-1.5">
                        {(["all", "yes", "no"] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setFilterHasAssignments(v)}
                                className={`px-3 py-1 text-xs rounded-full transition-colors ${filterHasAssignments === v
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                    }`}
                            >
                                {v === "all" ? "All" : v === "yes" ? "With" : "Without"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Select All Button */}
            <div className="flex justify-end mb-2">
                <button
                    onClick={handleSelectAll}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline focus:outline-none"
                >
                    {filteredRoles.length > 0 && filteredRoles.every(role => selectedRoles.has(role.id))
                        ? "Deselect All"
                        : "Select All Visible"}
                </button>
            </div>

            {loading && (
                <div className="flex justify-center items-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            )}

            {!loading && (
                <div className="max-h-96 overflow-y-auto space-y-2">
                    {filteredRoles.map((role) => (
                        <div
                            key={role.id}
                            onClick={() => toggleRole(role.id)}
                            className={`flex items-start p-3 rounded-md cursor-pointer transition-colors border ${selectedRoles.has(role.id)
                                ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                                : "hover:bg-zinc-100 dark:hover:bg-zinc-800 border-transparent"
                                }`}
                        >
                            <div className={`flex-shrink-0 h-5 w-5 rounded border flex items-center justify-center mr-3 mt-0.5 ${selectedRoles.has(role.id)
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "border-zinc-300 dark:border-zinc-600"
                                }`}>
                                {selectedRoles.has(role.id) && <Check className="h-3.5 w-3.5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{role.displayName}</h3>
                                    {role.isPrivileged && (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                            <Shield className="h-3 w-3" />
                                            Privileged
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-1">{role.description}</p>
                                {role.assignmentCount !== undefined && role.assignmentCount > 0 && (
                                    <div className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                                        <Users className="h-3 w-3" />
                                        <span>{role.assignmentCount} assignment{role.assignmentCount !== 1 ? 's' : ''}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                <span className="text-sm text-zinc-500">{selectedRoles.size} selected</span>
            </div>
        </div>
    );
}
