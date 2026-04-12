"use client";

import React, { useState, useMemo } from "react";
import {
    ChevronDown,
    ChevronRight,
    Check,
    X,
    AlertTriangle,
    ArrowRight,
    Shield,
    Clock,
    Key,
    MessageSquare,
    Info,
    HelpCircle
} from "lucide-react";
import { ParsedRolePolicyRow, ParsedGroupPolicyRow, ValidationError } from "@/types/csvParser.types";

// Change item representing a difference between current and desired state
export interface ChangeItem {
    id: string;
    type: "role" | "group";
    name: string;
    field: string;
    fieldLabel: string;
    currentValue: unknown;
    desiredValue: unknown;
    displayCurrent: string;
    displayDesired: string;
}

interface CompareViewProps {
    csvType: "rolePolicies" | "groupPolicies";
    parsedRows: (ParsedRolePolicyRow | ParsedGroupPolicyRow)[];
    currentData: Map<string, Record<string, unknown>>;
    errors: ValidationError[];
    warnings: ValidationError[];
    selectedChanges: Set<string>;
    onSelectionChange: (changeId: string, selected: boolean) => void;
    onSelectAll: (selected: boolean) => void;
}

// Field configuration for display
interface FieldConfig {
    key: string;
    label: string;
    icon: React.ElementType;
    format: (value: unknown) => string;
}

const ROLE_FIELDS: FieldConfig[] = [
    { key: "maxActivationDuration", label: "Max Activation Duration", icon: Clock, format: v => String(v ?? "") || "Not set" },
    { key: "mfaRequired", label: "MFA Required", icon: Shield, format: v => v ? "Yes" : "No" },
    { key: "justificationRequired", label: "Justification Required", icon: MessageSquare, format: v => v ? "Yes" : "No" },
    { key: "approvalRequired", label: "Approval Required", icon: Key, format: v => v ? "Yes" : "No" },
];

const GROUP_FIELDS: FieldConfig[] = [
    { key: "memberMaxDuration", label: "Member Max Duration", icon: Clock, format: v => String(v ?? "") || "Not set" },
    { key: "memberMfa", label: "Member MFA", icon: Shield, format: v => v ? "Yes" : "No" },
    { key: "memberApproval", label: "Member Approval", icon: Key, format: v => v ? "Yes" : "No" },
    { key: "ownerMaxDuration", label: "Owner Max Duration", icon: Clock, format: v => String(v ?? "") || "Not set" },
    { key: "ownerMfa", label: "Owner MFA", icon: Shield, format: v => v ? "Yes" : "No" },
    { key: "ownerApproval", label: "Owner Approval", icon: Key, format: v => v ? "Yes" : "No" },
];

export function CompareView({
    csvType,
    parsedRows,
    currentData,
    errors,
    warnings,
    selectedChanges,
    onSelectionChange,
    onSelectAll
}: CompareViewProps) {
    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    const fields = csvType === "rolePolicies" ? ROLE_FIELDS : GROUP_FIELDS;

    // Calculate changes and detect rows not found in current data.
    // NOTE: selectedChanges is intentionally NOT in deps — the `selected` property
    // was removed from ChangeItem; checkboxes read selectedChanges directly.
    const { changes, notFoundNames } = useMemo(() => {
        const allChanges: ChangeItem[] = [];
        const missing: string[] = [];

        parsedRows.forEach((row) => {
            const isRole = csvType === "rolePolicies";
            const name = isRole
                ? (row as ParsedRolePolicyRow).roleName
                : (row as ParsedGroupPolicyRow).groupName;
            const id = isRole
                ? (row as ParsedRolePolicyRow).roleId
                : (row as ParsedGroupPolicyRow).groupId;

            // ID-first lookup (stable UUID), name fallback for backward compat
            const current = (id && currentData.get(id)) || currentData.get(name.toLowerCase());

            if (current === undefined) {
                // Role/group name from CSV not found in loaded data
                missing.push(name);
                return;
            }

            const rowRecord = row as unknown as Record<string, unknown>;

            fields.forEach((field) => {
                const desiredValue = rowRecord[field.key];
                const currentValue = current[field.key];

                if (currentValue !== undefined && currentValue !== desiredValue) {
                    allChanges.push({
                        id: `${name}-${field.key}`,
                        type: csvType === "rolePolicies" ? "role" : "group",
                        name,
                        field: field.key,
                        fieldLabel: field.label,
                        currentValue,
                        desiredValue,
                        displayCurrent: field.format(currentValue),
                        displayDesired: field.format(desiredValue),
                    });
                }
            });
        });

        return { changes: allChanges, notFoundNames: missing };
    }, [parsedRows, currentData, fields, csvType]);

    // Group changes by role/group name
    const groupedChanges = useMemo(() => {
        const groups = new Map<string, ChangeItem[]>();
        changes.forEach(change => {
            const existing = groups.get(change.name) || [];
            existing.push(change);
            groups.set(change.name, existing);
        });
        return groups;
    }, [changes]);

    const toggleExpand = (name: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    const selectedCount = changes.filter(c => selectedChanges.has(c.id)).length;
    const totalCount = changes.length;

    // No changes and no unresolvable rows
    if (changes.length === 0 && notFoundNames.length === 0 && errors.length === 0) {
        return (
            <div className="p-8 text-center">
                <div className="w-16 h-16 mx-auto bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center mb-4">
                    <Check className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
                    No Changes Detected
                </h3>
                <p className="text-zinc-500 dark:text-zinc-400">
                    Your CSV configuration matches the current settings.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Limitations callout — role policies */}
            {csvType === "rolePolicies" && totalCount > 0 && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                        <p><strong>Not configurable via CSV:</strong> Approvers and Authentication Context (Conditional Access) cannot be set via CSV — use Wizard mode for these settings.</p>
                    </div>
                </div>
            )}

            {/* Limitations callout — group policies */}
            {csvType === "groupPolicies" && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <Info className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                        <strong>Limited scope:</strong> CSV only configures activation duration, MFA requirement, and approval requirement (for member and owner). Other settings such as justification, ticket info, notifications, and assignment expiration are only configurable via Wizard or Manual mode.
                    </p>
                </div>
            )}

            {/* Summary Header */}
            {totalCount > 0 && (
                <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                {totalCount} change{totalCount !== 1 ? 's' : ''} detected
                            </span>
                            {errors.length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded">
                                    <X className="h-3 w-3" />
                                    {errors.length} error{errors.length !== 1 ? 's' : ''}
                                </span>
                            )}
                            {warnings.length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
                                    <AlertTriangle className="h-3 w-3" />
                                    {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                            {selectedCount} of {totalCount} selected
                        </span>
                        <button
                            onClick={() => onSelectAll(selectedCount < totalCount)}
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                        >
                            {selectedCount === totalCount ? "Deselect All" : "Select All"}
                        </button>
                    </div>
                </div>
            )}

            {/* Errors Section */}
            {errors.length > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <h4 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2 flex items-center gap-2">
                        <X className="h-4 w-4" />
                        Validation Errors
                    </h4>
                    <ul className="space-y-1">
                        {errors.map((error, idx) => (
                            <li key={idx} className="text-sm text-red-700 dark:text-red-400">
                                Row {error.rowNumber}: {error.field} - {error.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Warnings Section */}
            {warnings.length > 0 && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Warnings
                    </h4>
                    <ul className="space-y-1">
                        {warnings.map((warning, idx) => (
                            <li key={idx} className="text-sm text-amber-700 dark:text-amber-400">
                                Row {warning.rowNumber}: {warning.field} - {warning.message}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Not-found rows — names in CSV that don't exist in loaded data */}
            {notFoundNames.length > 0 && (
                <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                        <HelpCircle className="h-4 w-4 text-zinc-500" />
                        {notFoundNames.length} {csvType === "rolePolicies" ? "role" : "group"}{notFoundNames.length !== 1 ? 's' : ''} not found in loaded data
                    </h4>
                    <ul className="space-y-0.5 mb-3">
                        {notFoundNames.map((name, idx) => (
                            <li key={idx} className="text-sm text-zinc-600 dark:text-zinc-400 font-mono">
                                {name}
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        These names don&apos;t match any {csvType === "rolePolicies" ? "role" : "group"} in the loaded data.
                        Check spelling and make sure the data has finished loading. Names must match exactly as shown in the Report page.
                    </p>
                </div>
            )}

            {/* Changes List */}
            {totalCount > 0 && (
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-4 px-4 py-3 bg-zinc-100 dark:bg-zinc-800 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        <div className="w-6"></div>
                        <div>{csvType === "rolePolicies" ? "Role" : "Group"} / Setting</div>
                        <div>Current Value</div>
                        <div>Desired Value</div>
                    </div>

                    {/* Grouped Changes */}
                    {Array.from(groupedChanges.entries()).map(([name, itemChanges]) => {
                        const isExpanded = expandedItems.has(name);
                        const allSelected = itemChanges.every(c => selectedChanges.has(c.id));
                        const someSelected = itemChanges.some(c => selectedChanges.has(c.id)) && !allSelected;

                        return (
                            <div key={name} className="border-b border-zinc-200 dark:border-zinc-700 last:border-b-0">
                                {/* Group Header */}
                                <div
                                    className="grid grid-cols-[auto_1fr_1fr_1fr] gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                                    onClick={() => toggleExpand(name)}
                                >
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={allSelected}
                                            ref={el => {
                                                if (el) el.indeterminate = someSelected;
                                            }}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                itemChanges.forEach(c => onSelectionChange(c.id, !allSelected));
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                        />
                                        {isExpanded ? (
                                            <ChevronDown className="h-4 w-4 text-zinc-400" />
                                        ) : (
                                            <ChevronRight className="h-4 w-4 text-zinc-400" />
                                        )}
                                    </div>
                                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                        {name}
                                        <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400 font-normal">
                                            ({itemChanges.length} change{itemChanges.length !== 1 ? 's' : ''})
                                        </span>
                                    </div>
                                    <div></div>
                                    <div></div>
                                </div>

                                {/* Expanded Changes */}
                                {isExpanded && (
                                    <div className="bg-zinc-50/50 dark:bg-zinc-900/30">
                                        {itemChanges.map((change) => {
                                            const FieldIcon = fields.find(f => f.key === change.field)?.icon || Shield;
                                            return (
                                                <div
                                                    key={change.id}
                                                    className="grid grid-cols-[auto_1fr_1fr_1fr] gap-4 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800"
                                                >
                                                    <div className="pl-6">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedChanges.has(change.id)}
                                                            onChange={(e) => onSelectionChange(change.id, e.target.checked)}
                                                            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                                                        <FieldIcon className="h-4 w-4" />
                                                        {change.fieldLabel}
                                                    </div>
                                                    <div className="text-sm">
                                                        <span className="inline-flex items-center px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded">
                                                            {change.displayCurrent}
                                                        </span>
                                                    </div>
                                                    <div className="text-sm flex items-center gap-2">
                                                        <ArrowRight className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                                                        <span className="inline-flex items-center px-2 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded">
                                                            {change.displayDesired}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

        </div>
    );
}
