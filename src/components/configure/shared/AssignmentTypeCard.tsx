import React from 'react';
import { Shield } from 'lucide-react';
import { LocalAssignmentState } from './assignmentTypes';

interface AssignmentTypeCardProps {
    assignments: LocalAssignmentState;
    onUpdate: (updates: Partial<LocalAssignmentState>) => void;
}

export function AssignmentTypeCard({ assignments, onUpdate }: AssignmentTypeCardProps) {
    return (
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3">
                <Shield className="w-4 h-4 text-purple-500" />
                Assignment Type
            </h3>
            <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer">
                    <input
                        type="radio"
                        name="assignmentType"
                        value="eligible"
                        checked={assignments.type === "eligible"}
                        onChange={() => onUpdate({ type: "eligible" })}
                        className="mt-1"
                    />
                    <div>
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Eligible (Recommended)</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            User must activate the role when needed. Required for JIT access.
                        </div>
                    </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer">
                    <input
                        type="radio"
                        name="assignmentType"
                        value="active"
                        checked={assignments.type === "active"}
                        onChange={() => onUpdate({ type: "active" })}
                        className="mt-1"
                    />
                    <div>
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Active</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            User has the role permanently (or until expiry) without activation.
                        </div>
                    </div>
                </label>
            </div>
        </div>
    );
}
