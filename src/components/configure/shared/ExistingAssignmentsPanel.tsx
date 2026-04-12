import React, { useState, useMemo, useCallback } from 'react';
import { Users, RefreshCw, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { ExistingAssignment, AdminUnit } from './assignmentTypes';
import { AssignmentRemoval } from '@/hooks/useWizardState';

interface ExistingAssignmentsPanelProps {
    isGroups: boolean;
    existingAssignments: ExistingAssignment[];
    isLoading: boolean;
    removals: AssignmentRemoval[];
    adminUnits: AdminUnit[];
    selectedCount: number;
    onFetchAssignments: () => void;
    onRemoveAssignment: (assignment: ExistingAssignment) => void;
    onCancelRemoval: (assignmentId: string) => void;
}

export function ExistingAssignmentsPanel({
    isGroups,
    existingAssignments,
    isLoading,
    removals,
    adminUnits,
    selectedCount,
    onFetchAssignments,
    onRemoveAssignment,
    onCancelRemoval
}: ExistingAssignmentsPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [assignmentTab, setAssignmentTab] = useState<"eligible" | "active" | "expired">("eligible");

    const filteredAssignments = useMemo(() => {
        return existingAssignments.filter(a => {
            const now = new Date();
            const isExpired = a.endDateTime && new Date(a.endDateTime) < now;
            if (assignmentTab === "expired") return isExpired;
            if (isExpired) return false;
            if (assignmentTab === "eligible") return a.assignmentType === "eligible";
            if (assignmentTab === "active") return a.assignmentType === "active";
            return false;
        });
    }, [existingAssignments, assignmentTab]);

    // Memoized by adminUnits identity — when AUs finish loading getScopeName gets a new
    // stable ref, which the AssignmentItem memo comparator picks up to force a re-render
    // with the correct AU display names instead of raw scope IDs.
    const getScopeName = useCallback((scopeId: string) => {
        if (scopeId === "/" || !scopeId) return "Directory";
        const auId = scopeId.replace("/administrativeUnits/", "");
        const au = adminUnits.find(a => a.id === auId);
        return au?.displayName || scopeId;
    }, [adminUnits]);

    return (
        <div className="w-80 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 flex flex-col overflow-hidden flex-shrink-0 self-stretch">
            {/* Header */}
            <div
                className="p-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
                onClick={() => {
                    if (!isExpanded) onFetchAssignments();
                    setIsExpanded(!isExpanded);
                }}
            >
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-500" />
                    Existing Assignments
                </h3>
                <ChevronRight className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </div>

            {selectedCount > 1 && (
                <div className="px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                        Showing assignments for first selected {isGroups ? "group" : "role"} only.
                        Combined results shown after apply.
                    </span>
                </div>
            )}

            {removals.length > 0 && (
                <div className="px-3 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900 flex items-center gap-2">
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-xs text-red-700 dark:text-red-400 font-medium">
                        {removals.length} assignment{removals.length !== 1 ? "s" : ""} staged for removal
                    </span>
                </div>
            )}

            {isExpanded && (
                <>
                    <div className="flex border-b border-zinc-200 dark:border-zinc-700">
                        <button
                            onClick={() => setAssignmentTab("eligible")}
                            className={`flex-1 py-2 text-xs font-medium text-center border-b-2 transition-colors ${assignmentTab === "eligible"
                                ? "border-blue-500 text-blue-600 bg-blue-50/50"
                                : "border-transparent text-zinc-500 hover:text-zinc-700"
                                }`}
                        >
                            Eligible
                        </button>
                        <button
                            onClick={() => setAssignmentTab("active")}
                            className={`flex-1 py-2 text-xs font-medium text-center border-b-2 transition-colors ${assignmentTab === "active"
                                ? "border-green-500 text-green-600 bg-green-50/50"
                                : "border-transparent text-zinc-500 hover:text-zinc-700"
                                }`}
                        >
                            Active
                        </button>
                        <button
                            onClick={() => setAssignmentTab("expired")}
                            className={`flex-1 py-2 text-xs font-medium text-center border-b-2 transition-colors ${assignmentTab === "expired"
                                ? "border-zinc-400 text-zinc-600 bg-zinc-100"
                                : "border-transparent text-zinc-500 hover:text-zinc-700"
                                }`}
                        >
                            Expired
                        </button>
                    </div>

                    <div className="overflow-y-auto p-2 space-y-2 h-full max-h-[400px] bg-zinc-50/50 dark:bg-zinc-900/30">
                        {isLoading ? (
                            <div className="flex justify-center p-4">
                                <RefreshCw className="w-4 h-4 animate-spin text-zinc-400" />
                            </div>
                        ) : filteredAssignments.length === 0 ? (
                            <div className="text-center p-4 text-xs text-zinc-400">
                                No {assignmentTab} assignments found.
                            </div>
                        ) : (
                            filteredAssignments.map((assign, idx) => {
                                const isRemoved = removals.some(r => r.assignmentId === assign.id);
                                return (
                                    <AssignmentItem
                                        key={idx}
                                        assignment={assign}
                                        isRemoved={isRemoved}
                                        getScopeName={getScopeName}
                                        onRemove={() => onRemoveAssignment(assign)}
                                        onCancelRemoval={() => onCancelRemoval(assign.id)}
                                    />
                                );
                            })
                        )}
                    </div>

                    <div className="p-2 border-t border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-[10px] text-zinc-400 text-center">
                        {filteredAssignments.length} results • Hover to manage
                    </div>
                </>
            )}
        </div>
    );
}

interface AssignmentItemProps {
    assignment: ExistingAssignment;
    isRemoved: boolean;
    getScopeName: (scopeId: string) => string;
    onRemove: () => void;
    onCancelRemoval: () => void;
}

const AssignmentItem = React.memo(
    function AssignmentItem({ assignment, isRemoved, getScopeName, onRemove, onCancelRemoval }: AssignmentItemProps) {
        const isIndirect = assignment.memberType === "Group";
        return (
            <div className={`p-2 bg-white dark:bg-zinc-700/50 rounded border text-xs shadow-sm relative group ${isRemoved
                ? 'border-red-200 bg-red-50 dark:bg-red-900/10 opacity-75'
                : 'border-zinc-200 dark:border-zinc-600'
                }`}>
                <div className="flex justify-between items-start">
                    <div className={`font-medium ${isRemoved ? 'text-red-800 line-through' : 'text-zinc-900 dark:text-zinc-100'}`}>
                        {assignment.principalDisplayName}
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isRemoved ? (
                            <button
                                onClick={onCancelRemoval}
                                className="text-xs text-blue-600 hover:underline bg-white px-1 rounded shadow-sm"
                            >
                                Undo
                            </button>
                        ) : isIndirect ? (
                            <span
                                title="Cannot remove group-inherited assignment directly"
                                className="text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </span>
                        ) : (
                            <button
                                onClick={onRemove}
                                className="text-zinc-400 hover:text-red-500 transition-colors"
                                title="Remove Assignment"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                <div className="text-zinc-500 mt-1 space-y-0.5">
                    <div className="flex items-center justify-between">
                        <span>{getScopeName(assignment.directoryScopeId)}</span>
                        <div className="flex items-center gap-1">
                            {isIndirect && (
                                <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700">
                                    via Group
                                </span>
                            )}
                            <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 px-1 rounded border border-zinc-200 dark:border-zinc-700">
                                {assignment.assignmentType === 'active' ? 'Direct' : 'Eligible'}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        {assignment.endDateTime ? (
                            <span className={new Date(assignment.endDateTime) < new Date() ? "text-red-500" : "text-green-600"}>
                                {new Date(assignment.endDateTime) < new Date() ? "Exp: " : "Ends: "}
                                {new Date(assignment.endDateTime).toLocaleDateString()}
                            </span>
                        ) : (
                            <span className="text-blue-500">Permanent</span>
                        )}
                    </div>
                    {isRemoved && (
                        <div className="text-red-600 text-[10px] font-medium mt-1 flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Marked for removal
                        </div>
                    )}
                </div>
            </div>
        );
    },
    (prevProps, nextProps) => {
        return (
            prevProps.assignment.id === nextProps.assignment.id &&
            prevProps.isRemoved === nextProps.isRemoved &&
            // getScopeName ref changes only when adminUnits finish loading — include it so
            // items re-render with correct AU display names instead of raw scope IDs.
            prevProps.getScopeName === nextProps.getScopeName
        );
    }
);
