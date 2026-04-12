import React, { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { RoleDetailData } from '@/types/directoryRole.types';
import { PimGroupData } from '@/types/pimGroup.types';

interface ScopeSelectorProps {
    activeTab: "roles" | "groups";
    searchTerm: string;
    showUnmanaged: boolean; // Only for groups
    rolesData: RoleDetailData[];
    groupsData: PimGroupData[];
    selectedRoleIds: string[]; // Keep for backwards compat / select all logic
    selectedGroupIds: string[]; // Keep for backwards compat / select all logic
    selectedRoleIdsSet: Set<string>; // O(1) lookup performance
    selectedGroupIdsSet: Set<string>; // O(1) lookup performance
    cloneSourceId?: string;
    configMode: "scratch" | "load" | "clone";
    onSearchChange: (term: string) => void;
    onToggleUnmanaged: (show: boolean) => void;
    onToggleRole: (id: string) => void;
    onToggleGroup: (id: string) => void;
    onSelectAllRoles: (roles: RoleDetailData[]) => void;
    onSelectAllGroups: (groups: PimGroupData[]) => void;
}

export function ScopeSelector({
    activeTab,
    searchTerm,
    showUnmanaged,
    rolesData,
    groupsData,
    selectedRoleIds,
    selectedGroupIds,
    selectedRoleIdsSet,
    selectedGroupIdsSet,
    cloneSourceId,
    configMode,
    onSearchChange,
    onToggleUnmanaged,
    onToggleRole,
    onToggleGroup,
    onSelectAllRoles,
    onSelectAllGroups
}: ScopeSelectorProps) {
    const [filterRoleType, setFilterRoleType] = useState<"all" | "builtin" | "custom">("all");
    const [filterPrivileged, setFilterPrivileged] = useState<"all" | "privileged">("all");
    const [filterHasAssignments, setFilterHasAssignments] = useState<"all" | "yes" | "no">("all");
    const [filterGroupType, setFilterGroupType] = useState<"all" | "security" | "m365" | "mail-enabled">("all");

    const pill = (active: boolean) =>
        `px-3 py-1 text-xs rounded-full transition-colors ${active
            ? "bg-blue-600 text-white"
            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        }`;

    // Filtered Data
    const filteredRoles = useMemo(() => {
        if (!rolesData) return [];
        return rolesData.filter(r => {
            if (!r.definition.displayName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (filterRoleType === "builtin" && !r.definition.isBuiltIn) return false;
            if (filterRoleType === "custom" && r.definition.isBuiltIn) return false;
            if (filterPrivileged === "privileged" && !r.definition.isPrivileged) return false;
            if (filterHasAssignments !== "all") {
                const total = r.assignments.permanent.length + r.assignments.eligible.length + r.assignments.active.length;
                if (filterHasAssignments === "yes" && total === 0) return false;
                if (filterHasAssignments === "no" && total > 0) return false;
            }
            return true;
        });
    }, [rolesData, searchTerm, filterRoleType, filterPrivileged, filterHasAssignments]);

    const filteredGroups = useMemo(() => {
        if (!groupsData) return [];
        let filtered = groupsData;

        // Filter by managed status
        if (!showUnmanaged) {
            filtered = filtered.filter(g => g.isManaged);
        }

        return filtered.filter(g => {
            if (!g.group.displayName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
            if (filterGroupType === "security" && g.group.groupType !== "security") return false;
            if (filterGroupType === "m365" && g.group.groupType !== "m365") return false;
            if (filterGroupType === "mail-enabled" && g.group.groupType !== "mailEnabled") return false;
            return true;
        });
    }, [groupsData, searchTerm, showUnmanaged, filterGroupType]);

    const handleSelectAll = () => {
        if (activeTab === 'roles') {
            onSelectAllRoles(filteredRoles);
        } else {
            onSelectAllGroups(filteredGroups);
        }
    };

    const currentFiltered = activeTab === 'roles' ? filteredRoles : filteredGroups;

    return (
        <>
            {/* Role Filters (Only for Roles tab) */}
            {activeTab === "roles" && (
                <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Type</span>
                        <div className="flex gap-1.5">
                            <button onClick={() => setFilterRoleType("all")} className={pill(filterRoleType === "all")}>All</button>
                            <button onClick={() => setFilterRoleType("builtin")} className={pill(filterRoleType === "builtin")}>Built-in</button>
                            <button onClick={() => setFilterRoleType("custom")} className={pill(filterRoleType === "custom")}>Custom</button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Privilege</span>
                        <div className="flex gap-1.5">
                            <button onClick={() => setFilterPrivileged("all")} className={pill(filterPrivileged === "all")}>All</button>
                            <button onClick={() => setFilterPrivileged("privileged")} className={pill(filterPrivileged === "privileged")}>Privileged</button>
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Assignments</span>
                        <div className="flex gap-1.5">
                            <button onClick={() => setFilterHasAssignments("all")} className={pill(filterHasAssignments === "all")}>All</button>
                            <button onClick={() => setFilterHasAssignments("yes")} className={pill(filterHasAssignments === "yes")}>With</button>
                            <button onClick={() => setFilterHasAssignments("no")} className={pill(filterHasAssignments === "no")}>Without</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Group Filters + Unmanaged Toggle (Only for Groups tab) */}
            {activeTab === "groups" && (
                <>
                    <div className="flex flex-col gap-1 mb-3">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Group type</span>
                        <div className="flex gap-1.5">
                            <button onClick={() => setFilterGroupType("all")} className={pill(filterGroupType === "all")}>All</button>
                            <button onClick={() => setFilterGroupType("security")} className={pill(filterGroupType === "security")}>Security</button>
                            <button onClick={() => setFilterGroupType("m365")} className={pill(filterGroupType === "m365")}>M365</button>
                            <button onClick={() => setFilterGroupType("mail-enabled")} className={pill(filterGroupType === "mail-enabled")}>Mail-enabled</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <input
                            type="checkbox"
                            id="showUnmanaged"
                            checked={showUnmanaged}
                            onChange={(e) => onToggleUnmanaged(e.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                        />
                        <label htmlFor="showUnmanaged" className="text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                            Show available groups (not yet in PIM)
                        </label>
                    </div>
                </>
            )}

            {/* Search Bar */}
            <div className="relative mb-4">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <input
                    type="text"
                    placeholder="Search scopes..."
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                />
            </div>

            {/* Selection List */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                {/* Header */}
                <div className="flex items-center p-3 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                    <button
                        onClick={handleSelectAll}
                        className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Select All Visible
                    </button>
                    <div className="ml-auto flex items-center gap-3">
                        {activeTab === 'groups' && !showUnmanaged && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                                Managed Only
                            </span>
                        )}
                        <span className="text-xs text-zinc-500">
                            {currentFiltered.length} items
                        </span>
                    </div>
                </div>

                {/* List Items */}
                <div className="max-h-[400px] overflow-y-auto bg-white dark:bg-zinc-900">
                    {activeTab === 'roles' ? (
                        <RolesList
                            roles={filteredRoles}
                            selectedRoleIdsSet={selectedRoleIdsSet}
                            cloneSourceId={cloneSourceId}
                            configMode={configMode}
                            onToggleRole={onToggleRole}
                        />
                    ) : (
                        <GroupsList
                            groups={filteredGroups}
                            selectedGroupIdsSet={selectedGroupIdsSet}
                            cloneSourceId={cloneSourceId}
                            configMode={configMode}
                            showUnmanaged={showUnmanaged}
                            onToggleGroup={onToggleGroup}
                        />
                    )}
                </div>
            </div>
        </>
    );
}

// Roles List Component (Memoized for performance)
interface RolesListProps {
    roles: RoleDetailData[];
    selectedRoleIdsSet: Set<string>; // O(1) lookup instead of O(n) array.includes
    cloneSourceId?: string;
    configMode: string;
    onToggleRole: (id: string) => void;
}

const RolesList = React.memo(function RolesList({ roles, selectedRoleIdsSet, cloneSourceId, configMode, onToggleRole }: RolesListProps) {
    if (roles.length === 0) {
        return (
            <div className="p-8 text-center text-zinc-500 text-sm">
                No roles found.
            </div>
        );
    }

    return (
        <>
            {roles.map(role => {
                const isCloneSource = configMode === 'clone' && cloneSourceId === role.definition.id;
                const isSelected = selectedRoleIdsSet.has(role.definition.id); // O(1) Set lookup

                return (
                    <label
                        key={role.definition.id}
                        className={`flex items-center gap-3 p-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 transition-colors
                            ${isCloneSource
                                ? 'opacity-50 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800/50'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer'
                            }`}
                        title={isCloneSource ? "This role is selected as the clone source" : undefined}
                    >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : isCloneSource
                                ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-700'
                                : 'border-zinc-300 dark:border-zinc-600'
                            } `}>
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={isSelected}
                            onChange={() => !isCloneSource && onToggleRole(role.definition.id)}
                            disabled={isCloneSource}
                        />
                        <div className="flex-1">
                            <div className={`text-sm font-medium ${isCloneSource ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                {role.definition.displayName}
                                {isCloneSource && (
                                    <span className="ml-2 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                        Source
                                    </span>
                                )}
                            </div>
                            {role.definition.description && (
                                <div className="text-xs text-zinc-500 truncate max-w-md">
                                    {role.definition.description}
                                </div>
                            )}
                        </div>
                    </label>
                );
            })}
        </>
    );
});

// Groups List Component (Memoized for performance)
interface GroupsListProps {
    groups: PimGroupData[];
    selectedGroupIdsSet: Set<string>; // O(1) lookup instead of O(n) array.includes
    cloneSourceId?: string;
    configMode: string;
    showUnmanaged: boolean;
    onToggleGroup: (id: string) => void;
}

const GroupsList = React.memo(function GroupsList({ groups, selectedGroupIdsSet, cloneSourceId, configMode, showUnmanaged, onToggleGroup }: GroupsListProps) {
    if (groups.length === 0) {
        return (
            <div className="p-8 text-center text-zinc-500 text-sm">
                {showUnmanaged ? "No groups found." : "No managed groups found. Try showing all groups."}
            </div>
        );
    }

    return (
        <>
            {groups.map(group => {
                const isCloneSource = configMode === 'clone' && cloneSourceId === group.group.id;
                const isSelected = selectedGroupIdsSet.has(group.group.id); // O(1) Set lookup

                return (
                    <label
                        key={group.group.id}
                        className={`flex items-center gap-3 p-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 transition-colors
                            ${isCloneSource
                                ? 'opacity-50 cursor-not-allowed bg-zinc-100 dark:bg-zinc-800/50'
                                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer'
                            }`}
                        title={isCloneSource ? "This group is selected as the clone source" : undefined}
                    >
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : isCloneSource
                                ? 'border-zinc-300 dark:border-zinc-600 bg-zinc-200 dark:bg-zinc-700'
                                : 'border-zinc-300 dark:border-zinc-600'
                            } `}>
                            {isSelected && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <input
                            type="checkbox"
                            className="hidden"
                            checked={isSelected}
                            onChange={() => !isCloneSource && onToggleGroup(group.group.id)}
                            disabled={isCloneSource}
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <div className={`text-sm font-medium ${isCloneSource ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                    {group.group.displayName}
                                </div>
                                {isCloneSource && (
                                    <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded">
                                        Source
                                    </span>
                                )}
                                {!group.isManaged && !isCloneSource && (
                                    <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                                        New
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-zinc-500">
                                {group.group.mail || "No email"}
                            </div>
                        </div>
                    </label>
                );
            })}
        </>
    );
});
