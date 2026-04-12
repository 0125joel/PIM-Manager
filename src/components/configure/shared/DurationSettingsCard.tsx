import React from 'react';
import { Calendar, Info, Loader2 } from 'lucide-react';
import { Toggle } from '@/components/ui/Toggle';
import { LocalAssignmentState } from './assignmentTypes';
import { PolicySettings } from '@/hooks/useWizardState';

interface DurationSettingsCardProps {
    assignments: LocalAssignmentState;
    currentPolicies: PolicySettings | undefined;
    isLoadingPolicies?: boolean;
    /** When true, the justification field is hidden (e.g., wizard's assignment-only mode) */
    skipJustification?: boolean;
    onUpdate: (updates: Partial<LocalAssignmentState>) => void;
}

export function DurationSettingsCard({
    assignments,
    currentPolicies,
    isLoadingPolicies,
    skipJustification = false,
    onUpdate
}: DurationSettingsCardProps) {
    const isPermanentAllowed = () => {
        if (!currentPolicies) return true;
        if (assignments.type === "active") return currentPolicies.allowPermanentActive;
        return currentPolicies.allowPermanentEligible;
    };

    const isJustificationRequired = () => {
        if (skipJustification) return false;
        if (!currentPolicies) return false;
        if (assignments.type === "active") return currentPolicies.requireJustificationOnActiveAssignment;
        return false;
    };

    return (
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3">
                <Calendar className="w-4 h-4 text-orange-500" />
                Duration & Settings
            </h3>

            <div className="space-y-4">
                {/* Permanent Checkbox */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-700 dark:text-zinc-300">Permanent Assignment</span>
                        {isLoadingPolicies && !currentPolicies && (
                            <span className="text-xs text-zinc-400 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" /> Checking policy...
                            </span>
                        )}
                        {!isPermanentAllowed() && (
                            <span className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded border border-red-100 dark:border-red-900">
                                Blocked by Policy
                            </span>
                        )}
                    </div>
                    <Toggle
                        checked={assignments.duration === "permanent"}
                        onChange={(checked) => onUpdate({ duration: checked ? "permanent" : "bounded" })}
                        disabled={!isPermanentAllowed()}
                    />
                </div>

                {/* Date Pickers */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                            Assignment Start
                        </label>
                        <input
                            type="datetime-local"
                            className="w-full px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark]"
                            value={assignments.startDate}
                            onChange={(e) => onUpdate({ startDate: e.target.value })}
                        />
                    </div>

                    {assignments.duration === "bounded" && (
                        <div className="p-3 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                Assignment End
                            </label>
                            <input
                                type="datetime-local"
                                className="w-full px-2 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none dark:[color-scheme:dark]"
                                value={assignments.endDate}
                                onChange={(e) => onUpdate({ endDate: e.target.value })}
                                min={assignments.startDate || new Date().toISOString().slice(0, 16)}
                            />
                        </div>
                    )}
                </div>

                {assignments.duration === "bounded" && (
                    <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        If no end date is selected, a default duration will apply.
                    </div>
                )}

                {isJustificationRequired() && (
                    <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
                        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            Justification <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            className="w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                            rows={2}
                            placeholder="Provide a reason for this assignment..."
                            value={assignments.justification}
                            onChange={(e) => onUpdate({ justification: e.target.value })}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
