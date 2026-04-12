import React from 'react';
import { Search } from 'lucide-react';
import { RoleDetailData } from '@/types/directoryRole.types';
import { PimGroupData } from '@/types/pimGroup.types';

interface CloneSourceSelectorProps {
    activeTab: "roles" | "groups";
    cloneSourceId: string | undefined;
    selectedRoleIds: string[];
    selectedGroupIds: string[];
    rolesData: RoleDetailData[];
    groupsData: PimGroupData[];
    onSelectSource: (sourceId: string) => void;
}

export function CloneSourceSelector({
    activeTab,
    cloneSourceId,
    selectedRoleIds,
    selectedGroupIds,
    rolesData,
    groupsData,
    onSelectSource
}: CloneSourceSelectorProps) {
    return (
        <div className="mb-8 p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <h3 className="text-sm font-semibold mb-3 text-zinc-900 dark:text-zinc-100">
                Select Source {activeTab === 'roles' ? 'Role' : 'Group'} to Copy From:
            </h3>
            <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
                <select
                    className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg appearance-none cursor-pointer"
                    value={cloneSourceId || ""}
                    onChange={(e) => onSelectSource(e.target.value)}
                >
                    <option value="">Select a source...</option>
                    {activeTab === 'roles' && rolesData
                        .filter(r => !selectedRoleIds.includes(r.definition.id))
                        .map(r => (
                            <option key={r.definition.id} value={r.definition.id}>
                                {r.definition.displayName}
                            </option>
                        ))}
                    {activeTab === 'groups' && groupsData
                        .filter(g => g.isManaged) // Allow cloning ONLY from managed groups
                        .filter(g => !selectedGroupIds.includes(g.group.id))
                        .map(g => (
                            <option key={g.group.id} value={g.group.id}>
                                {g.group.displayName}
                            </option>
                        ))}
                </select>
            </div>
        </div>
    );
}
