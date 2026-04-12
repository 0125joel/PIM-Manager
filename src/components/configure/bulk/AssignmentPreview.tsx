"use client";

import React, { useMemo } from "react";
import { Check, X, AlertTriangle, AlertCircle, Info, Trash2 } from "lucide-react";
import {
    ParsedRoleAssignmentRow,
    ParsedGroupAssignmentRow,
    ParsedRoleAssignmentRemovalRow,
    ParsedGroupAssignmentRemovalRow,
    ValidationError
} from "@/types/csvParser.types";

export type RowStatus =
    | "new"               // assignment doesn't exist yet — will be created
    | "exists"            // assignment already exists — will be skipped
    | "not-found"         // role/group not found in loaded data
    | "will-remove"       // assignment found — will be removed
    | "already-removed"   // assignment not found — nothing to remove
    | "permanent-blocked"; // permanent requested but policy doesn't allow it

type AnyRow = ParsedRoleAssignmentRow | ParsedGroupAssignmentRow | ParsedRoleAssignmentRemovalRow | ParsedGroupAssignmentRemovalRow;

interface AssignmentPreviewProps {
    csvType: "roleAssignments" | "groupAssignments" | "roleAssignmentRemovals" | "groupAssignmentRemovals";
    parsedRows: AnyRow[];
    errors: ValidationError[];
    warnings: ValidationError[];
    selectedRows: Set<number>;
    onSelectionChange: (rowNumber: number, selected: boolean) => void;
    onSetSelectedRows: (rows: Set<number>) => void;
    rowStatuses?: Map<number, RowStatus>;
}

function StatusBadge({ status }: { status: RowStatus | undefined }) {
    if (!status || status === "new") {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                New
            </span>
        );
    }
    if (status === "exists") {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                Already exists
            </span>
        );
    }
    if (status === "not-found") {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                Not found
            </span>
        );
    }
    if (status === "will-remove") {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                Will remove
            </span>
        );
    }
    if (status === "permanent-blocked") {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                Permanent not allowed
            </span>
        );
    }
    // already-removed
    return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400">
            Already removed
        </span>
    );
}

export function AssignmentPreview({
    csvType,
    parsedRows,
    errors,
    warnings,
    selectedRows,
    onSelectionChange,
    onSetSelectedRows,
    rowStatuses,
}: AssignmentPreviewProps) {
    const isRemoval = csvType === "roleAssignmentRemovals" || csvType === "groupAssignmentRemovals";
    const isGroup = csvType === "groupAssignments" || csvType === "groupAssignmentRemovals";

    // Rows that can be (de)selected — exclude "exists" and "already-removed"
    const selectableRows = useMemo(() => {
        if (!rowStatuses) return parsedRows;
        return parsedRows.filter(r => {
            const s = rowStatuses.get(r.rowNumber);
            return s !== "exists" && s !== "already-removed";
        });
    }, [parsedRows, rowStatuses]);

    const allSelected = useMemo(
        () => selectableRows.length > 0 && selectableRows.every(r => selectedRows.has(r.rowNumber)),
        [selectableRows, selectedRows]
    );

    const selectedCount = parsedRows.filter(r => selectedRows.has(r.rowNumber)).length;

    const handleSelectAll = () => {
        if (allSelected) {
            // Deselect only selectable rows (non-selectable remain untouched)
            const next = new Set(selectedRows);
            selectableRows.forEach(r => next.delete(r.rowNumber));
            onSetSelectedRows(next);
        } else {
            const next = new Set(selectedRows);
            selectableRows.forEach(r => next.add(r.rowNumber));
            onSetSelectedRows(next);
        }
    };

    const hasMixedActions = !isRemoval && parsedRows.some(r => (r as ParsedRoleAssignmentRow).action === "remove");

    // Grid column configs
    const headerCols = isRemoval
        ? (isGroup ? "grid-cols-[auto_1fr_1fr_auto_auto_auto]" : "grid-cols-[auto_1fr_1fr_auto_auto]")
        : (isGroup
            ? (hasMixedActions ? "grid-cols-[auto_1fr_1fr_auto_auto_auto_auto_auto]" : "grid-cols-[auto_1fr_1fr_auto_auto_auto_auto]")
            : (hasMixedActions ? "grid-cols-[auto_1fr_1fr_auto_auto_auto_auto]" : "grid-cols-[auto_1fr_1fr_auto_auto_auto]"));

    return (
        <div className="space-y-4">
            {/* Errors */}
            {errors.length > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <h4 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {errors.length} validation error{errors.length !== 1 ? "s" : ""}
                    </h4>
                    <ul className="space-y-1">
                        {errors.map((error, idx) => (
                            <li key={idx} className="text-sm text-red-700 dark:text-red-400 flex items-start gap-1.5">
                                <X className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                <span>
                                    {error.rowNumber > 0 && <strong>Row {error.rowNumber} — </strong>}
                                    {error.field}: {error.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                        {warnings.length} warning{warnings.length !== 1 ? "s" : ""}
                    </h4>
                    <ul className="space-y-1">
                        {warnings.map((warning, idx) => (
                            <li key={idx} className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                                <span>
                                    {warning.rowNumber > 0 && <strong>Row {warning.rowNumber} — </strong>}
                                    {warning.field}: {warning.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Summary + Select All */}
            <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{parsedRows.length}</span>{" "}
                    {isRemoval ? "removal" : "assignment"}{parsedRows.length !== 1 ? "s" : ""}{" "}
                    {isRemoval ? "queued" : "to create"} —{" "}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{selectedCount}</span> selected
                </p>
                <button
                    onClick={handleSelectAll}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                    {allSelected ? "Deselect All" : "Select All"}
                </button>
            </div>

            {/* Table */}
            <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                <div className={`grid gap-3 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider ${headerCols}`}>
                    <div className="w-4" />
                    <div>{isGroup ? "Group" : "Role"}</div>
                    <div>Principal</div>
                    {isGroup && <div>Access</div>}
                    <div>Type</div>
                    {!isRemoval && <div>Duration</div>}
                    {hasMixedActions && <div>Action</div>}
                    <div>Status</div>
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-700">
                    {parsedRows.length === 0 && (
                        <div className="px-4 py-6 text-center text-sm text-zinc-400">
                            No rows parsed
                        </div>
                    )}

                    {parsedRows.map((r) => {
                        const rowStatus = rowStatuses?.get(r.rowNumber);
                        const isSelected = selectedRows.has(r.rowNumber);
                        const isSelectable = rowStatus !== "exists" && rowStatus !== "already-removed";
                        const isRoleRow = "roleName" in r || "roleId" in r;
                        const isGroupRow = "groupName" in r || "groupId" in r;
                        const rowAction = (r as ParsedRoleAssignmentRow).action;

                        const resourceName = isRoleRow && !isGroupRow
                            ? ((r as ParsedRoleAssignmentRow).roleName || (r as ParsedRoleAssignmentRow).roleId || "—")
                            : ((r as ParsedGroupAssignmentRow).groupName || (r as ParsedGroupAssignmentRow).groupId || "—");
                        const principalLabel = r.principalUPN || r.principalId || "—";
                        const assignmentType = (r as ParsedRoleAssignmentRow).assignmentType;
                        const accessType = (r as ParsedGroupAssignmentRow).accessType;
                        const durationDays = !isRemoval ? (r as ParsedRoleAssignmentRow).durationDays : undefined;

                        return (
                            <label
                                key={r.rowNumber}
                                className={`grid gap-3 px-4 py-3 items-center transition-colors ${headerCols} ${
                                    isSelectable ? "cursor-pointer" : "cursor-default opacity-60"
                                } ${
                                    isSelected
                                        ? "bg-blue-50 dark:bg-blue-900/10"
                                        : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                }`}
                            >
                                <div
                                    className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                                        isSelected
                                            ? "bg-blue-600 text-white"
                                            : isSelectable
                                                ? "border-2 border-zinc-300 dark:border-zinc-600"
                                                : "border-2 border-zinc-200 dark:border-zinc-700 opacity-40"
                                    }`}
                                >
                                    {isSelected && <Check className="h-2.5 w-2.5" />}
                                </div>
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    disabled={!isSelectable}
                                    onChange={e => isSelectable && onSelectionChange(r.rowNumber, e.target.checked)}
                                    className="sr-only"
                                />
                                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                                    {resourceName}
                                </div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-400 truncate">
                                    {principalLabel}
                                </div>
                                {isGroup && (
                                    <div>
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                            accessType === "owner"
                                                ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                                                : "bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300"
                                        }`}>
                                            {accessType}
                                        </span>
                                    </div>
                                )}
                                <div>
                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                        assignmentType === "eligible"
                                            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"
                                            : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                                    }`}>
                                        {assignmentType}
                                    </span>
                                </div>
                                {!isRemoval && (
                                    <div className="text-sm text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                        {durationDays === "permanent" ? "Permanent" : durationDays ? `${durationDays}d` : "Policy default"}
                                    </div>
                                )}
                                {hasMixedActions && (
                                    <div>
                                        {rowAction === "remove" ? (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                                                Remove
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                                                Add
                                            </span>
                                        )}
                                    </div>
                                )}
                                <div>
                                    <StatusBadge status={rowStatus} />
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>

            {/* Contextual note */}
            {isRemoval ? (
                <div className="flex items-start gap-2 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-lg">
                    <Trash2 className="h-4 w-4 text-orange-500 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-700 dark:text-orange-300">
                        <strong>Bulk removal:</strong> only assignments visible in the current data show a status.
                        Assignments marked <em>Already removed</em> are skipped automatically.
                        The API resolves active schedules from the principal and role/group identity.
                    </p>
                </div>
            ) : (
                <div className="flex items-start gap-2 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <Info className="h-4 w-4 text-zinc-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {hasMixedActions
                            ? <><strong>Combined import:</strong> rows with <em>Action = add</em> create assignments (skipping <em>Already exists</em>); rows with <em>Action = remove</em> delete assignments (skipping <em>Already removed</em>).</>
                            : <><strong>Add-only import:</strong> rows marked <em>Already exists</em> are skipped automatically.</>
                        }
                        {" "}<strong>UPN lookup:</strong> only works for users — groups and service principals require a Principal ID.
                    </p>
                </div>
            )}
        </div>
    );
}
