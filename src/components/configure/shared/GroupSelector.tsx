"use client";

import React, { useState, useMemo } from 'react';
import { Users, Check } from 'lucide-react';
import { PimGroupData } from '@/types/pimGroup.types';

interface GroupSelectorProps {
    groupsData: PimGroupData[];
    loading: boolean;
    onSelectionChange: (ids: string[]) => void;
}

export function GroupSelector({ groupsData, loading, onSelectionChange }: GroupSelectorProps) {
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState("");
    const [filterGroupType, setFilterGroupType] = useState<"all" | "security" | "m365" | "mail-enabled">("all");

    const filteredGroups = useMemo(() => {
        if (!groupsData) return [];
        return groupsData
            .filter(g => g.isManaged !== false)
            .filter(g => g.group.displayName.toLowerCase().includes(searchTerm.toLowerCase()))
            .filter(g => {
                if (filterGroupType === "security") return g.group.groupType === "security";
                if (filterGroupType === "m365") return g.group.groupType === "m365";
                if (filterGroupType === "mail-enabled") return g.group.groupType === "mailEnabled";
                return true;
            });
    }, [groupsData, searchTerm, filterGroupType]);

    const handleToggle = (groupId: string) => {
        const wasSelected = selectedGroups.has(groupId);
        const nextIds = wasSelected
            ? Array.from(selectedGroups).filter(id => id !== groupId)
            : [...Array.from(selectedGroups), groupId];
        setSelectedGroups(new Set(nextIds));
        onSelectionChange(nextIds);
    };

    if (loading) {
        return (
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-8 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
                <p className="text-zinc-500">Loading groups...</p>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-500" />
                    PIM Groups
                </h3>
                <input
                    type="text"
                    placeholder="Search groups..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="mt-3 w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
                />
                <div className="flex flex-col gap-1 mt-3">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Group type</span>
                    <div className="flex gap-1.5 flex-wrap">
                        {(["all", "security", "m365", "mail-enabled"] as const).map(v => (
                            <button
                                key={v}
                                onClick={() => setFilterGroupType(v)}
                                className={`px-3 py-1 text-xs rounded-full transition-colors ${filterGroupType === v
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                    }`}
                            >
                                {v === "all" ? "All" : v === "security" ? "Security" : v === "m365" ? "M365" : "Mail-enabled"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto p-2">
                {filteredGroups.length === 0 ? (
                    <div className="p-4 text-center text-zinc-500">No groups found</div>
                ) : (
                    filteredGroups.map(g => (
                        <button
                            key={g.group.id}
                            onClick={() => handleToggle(g.group.id)}
                            className={`
                                w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors
                                ${selectedGroups.has(g.group.id)
                                    ? "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                                    : "hover:bg-zinc-50 dark:hover:bg-zinc-700/50 border border-transparent"
                                }
                            `}
                        >
                            <div className={`
                                w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0
                                ${selectedGroups.has(g.group.id)
                                    ? "border-blue-500 bg-blue-500"
                                    : "border-zinc-300 dark:border-zinc-600"
                                }
                            `}>
                                {selectedGroups.has(g.group.id) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                    {g.group.displayName}
                                </div>
                                <div className="text-xs text-zinc-500 truncate">
                                    {g.assignments?.length || 0} assignments
                                </div>
                            </div>
                        </button>
                    ))
                )}
            </div>
            <div className="p-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-500 text-center">
                {selectedGroups.size} of {filteredGroups.length} selected
            </div>
        </div>
    );
}
