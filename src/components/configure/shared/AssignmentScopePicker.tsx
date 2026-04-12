import React from 'react';
import { MapPin, Shield, ChevronDown } from 'lucide-react';
import { AdminUnit, LocalAssignmentState } from './assignmentTypes';

interface AssignmentScopePickerProps {
    isGroups: boolean;
    assignments: LocalAssignmentState;
    adminUnits: AdminUnit[];
    onUpdate: (updates: Partial<LocalAssignmentState>) => void;
}

export function AssignmentScopePicker({ isGroups, assignments, adminUnits, onUpdate }: AssignmentScopePickerProps) {
    if (isGroups) {
        return (
            <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-blue-500" />
                    Group Role
                </h3>
                <div className="flex gap-4">
                    <label className={`flex-1 cursor-pointer border rounded-lg p-3 transition-colors ${assignments.groupRole === 'member'
                        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50 border-zinc-200 dark:border-zinc-700'
                        }`}>
                        <input
                            type="radio"
                            name="groupRole"
                            value="member"
                            checked={assignments.groupRole === 'member'}
                            onChange={() => onUpdate({ groupRole: 'member' })}
                            className="sr-only"
                        />
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Member</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            Access to resources assigned to group.
                        </div>
                    </label>

                    <label className={`flex-1 cursor-pointer border rounded-lg p-3 transition-colors ${assignments.groupRole === 'owner'
                        ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50 border-zinc-200 dark:border-zinc-700'
                        }`}>
                        <input
                            type="radio"
                            name="groupRole"
                            value="owner"
                            checked={assignments.groupRole === 'owner'}
                            onChange={() => onUpdate({ groupRole: 'owner' })}
                            className="sr-only"
                        />
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">Owner</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                            Manage group settings and membership.
                        </div>
                    </label>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-green-500" />
                Assignment Scope
            </h3>
            <div className="relative">
                <select
                    className="w-full p-2 pl-3 text-sm border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:ring-2 focus:ring-blue-500 outline-none appearance-none cursor-pointer"
                    value={assignments.scopeId}
                    onChange={(e) => onUpdate({ scopeId: e.target.value })}
                >
                    <option value="/">Directory (Entire Tenant)</option>
                    {adminUnits.length > 0 && (
                        <optgroup label="Administrative Units">
                            {adminUnits.map(au => (
                                <option key={au.id} value={`/administrativeUnits/${au.id}`}>
                                    {au.displayName}
                                </option>
                            ))}
                        </optgroup>
                    )}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-3 top-2.5 text-zinc-400 pointer-events-none" />
            </div>
            <p className="text-xs text-zinc-500 mt-2">
                Choose whether this assignment applies to the entire directory or a specific administrative unit.
            </p>
        </div>
    );
}
