import React from 'react';
import { Shield, Briefcase, PlusCircle } from 'lucide-react';
import { ScopeDetail } from './assignmentTypes';

interface ScopeHeaderProps {
    isGroups: boolean;
    isLoading: boolean;
    scopeDetails: ScopeDetail[];
    selectedCount: number;
}

export function ScopeHeader({ isGroups, isLoading, scopeDetails, selectedCount }: ScopeHeaderProps) {
    return (
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg text-blue-600 dark:text-blue-400">
                    {isGroups ? <Briefcase className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
                </div>
                <div className="flex-1">
                    <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {isLoading ? "Loading..." : (scopeDetails[0]?.displayName || "Selected Role")}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">
                        {isLoading ? "..." : (scopeDetails[0]?.description || (isGroups ? "Group" : `ID: ${scopeDetails[0]?.id}`))}
                    </p>

                    {selectedCount > 1 && (
                        <div className="mt-2 text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1 bg-blue-50 dark:bg-blue-900/10 px-2 py-1 rounded w-fit">
                            <PlusCircle className="w-3 h-3" /> +{selectedCount - 1} others selected
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
