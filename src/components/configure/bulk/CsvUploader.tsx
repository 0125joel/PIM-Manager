"use client";

import React, { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, X, Download, AlertCircle, CheckCircle, BookOpen, ChevronDown } from "lucide-react";
import { CsvParserService } from "@/services/csvParserService";
import { CSV_TEMPLATE_FIELDS, CsvTemplateType } from "@/utils/csvFieldOptions";

interface CsvUploaderProps {
    onFileLoaded: (content: string, filename: string) => void;
    onClear: () => void;
    isLoading?: boolean;
    currentFile?: { name: string; rowCount: number } | null;
}

export function CsvUploader({ onFileLoaded, onClear, isLoading, currentFile }: CsvUploaderProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [templateType, setTemplateType] = useState<CsvTemplateType>("rolePolicies");
    const [showFieldRef, setShowFieldRef] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const processFile = useCallback((file: File) => {
        setError(null);

        // Validate file type
        if (!file.name.endsWith('.csv')) {
            setError("Please upload a CSV file (.csv extension)");
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            setError("File too large. Maximum size is 5MB.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (content) {
                onFileLoaded(content, file.name);
            }
        };
        reader.onerror = () => {
            setError("Failed to read file. Please try again.");
        };
        reader.readAsText(file, 'utf-8');
    }, [onFileLoaded]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    }, [processFile]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            processFile(files[0]);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    }, [processFile]);

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    const downloadTemplate = (type: CsvTemplateType) => {
        const contentMap = {
            rolePolicies: () => CsvParserService.generateRolePoliciesTemplate(),
            groupPolicies: () => CsvParserService.generateGroupPoliciesTemplate(),
            roleAssignments: () => CsvParserService.generateRoleAssignmentsTemplate(),
            groupAssignments: () => CsvParserService.generateGroupAssignmentsTemplate(),
            roleAssignmentRemovals: () => CsvParserService.generateRoleAssignmentRemovalsTemplate(),
            groupAssignmentRemovals: () => CsvParserService.generateGroupAssignmentRemovalsTemplate(),
        };
        const filenameMap = {
            rolePolicies: "pim-bulk-roles-template.csv",
            groupPolicies: "pim-bulk-groups-template.csv",
            roleAssignments: "pim-bulk-role-assignments-template.csv",
            groupAssignments: "pim-bulk-group-assignments-template.csv",
            roleAssignmentRemovals: "pim-bulk-role-removals-template.csv",
            groupAssignmentRemovals: "pim-bulk-group-removals-template.csv",
        };
        const content = contentMap[type]();
        const filename = filenameMap[type];

        const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Show uploaded file state
    if (currentFile) {
        return (
            <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-6">
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-100 dark:bg-emerald-800/50 rounded-xl">
                            <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                                {currentFile.name}
                            </h3>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {currentFile.rowCount} configuration row{currentFile.rowCount !== 1 ? 's' : ''} loaded
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClear}
                        className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Remove file"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Drop Zone */}
            <div
                onClick={handleClick}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`
                    relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                    ${isDragging
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-zinc-300 dark:border-zinc-700 hover:border-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }
                    ${isLoading ? 'opacity-50 pointer-events-none' : ''}
                `}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                />

                <div className="flex flex-col items-center gap-4">
                    <div className={`p-4 rounded-xl ${isDragging ? 'bg-blue-100 dark:bg-blue-800/50' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
                        {isDragging ? (
                            <FileSpreadsheet className="h-8 w-8 text-blue-500" />
                        ) : (
                            <Upload className="h-8 w-8 text-zinc-400" />
                        )}
                    </div>

                    <div>
                        <p className="text-zinc-700 dark:text-zinc-300 font-medium">
                            {isDragging ? 'Drop your CSV file here' : 'Drag & drop your CSV file here'}
                        </p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            or <span className="text-blue-600 dark:text-blue-400 hover:underline">browse files</span>
                        </p>
                    </div>

                    <p className="text-xs text-zinc-400 dark:text-zinc-500">
                        Supports CSV files up to 5MB
                    </p>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                    <span className="text-sm text-red-700 dark:text-red-400">{error}</span>
                </div>
            )}

            {/* Template Download */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-3">
                <div>
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Need a template?
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        Download a sample CSV file with the correct format
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">Type:</span>
                    {([
                        { value: "rolePolicies", label: "Role Policies" },
                        { value: "groupPolicies", label: "Group Policies" },
                        { value: "roleAssignments", label: "Role Assignments" },
                        { value: "groupAssignments", label: "Group Assignments" },
                    ] as const).map(t => (
                        <button
                            key={t.value}
                            onClick={() => { setTemplateType(t.value); setShowFieldRef(false); }}
                            className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                templateType === t.value
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                    <button
                        onClick={() => downloadTemplate(templateType)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors ml-auto"
                    >
                        <Download className="h-3.5 w-3.5" />
                        Download
                    </button>
                </div>
                {/* Field Reference panel */}
                <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                    <button
                        onClick={() => setShowFieldRef(v => !v)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors"
                    >
                        <span className="flex items-center gap-1.5">
                            <BookOpen className="h-3.5 w-3.5" />
                            Field reference — {([
                                { value: "rolePolicies", label: "Role Policies" },
                                { value: "groupPolicies", label: "Group Policies" },
                                { value: "roleAssignments", label: "Role Assignments" },
                                { value: "groupAssignments", label: "Group Assignments" },
                            ].find(t => t.value === templateType)?.label ?? templateType)}
                        </span>
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFieldRef ? "rotate-180" : ""}`} />
                    </button>
                    {showFieldRef && (
                        <div className="overflow-x-auto border-t border-zinc-200 dark:border-zinc-700">
                            <table className="w-full text-xs">
                                <thead className="bg-zinc-100 dark:bg-zinc-800 sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400 whitespace-nowrap">Column</th>
                                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Valid values</th>
                                        <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Notes</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                    {CSV_TEMPLATE_FIELDS[templateType].map(field => (
                                        <tr key={field.column} className={field.readOnly ? "opacity-50" : ""}>
                                            <td className="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300">
                                                {field.readOnly
                                                    ? field.column.split(" / ").map((part, i, arr) => (
                                                        <span key={i}>{part}{i < arr.length - 1 && <span className="text-zinc-400"> /</span>}<br />
                                                        </span>
                                                    ))
                                                    : field.column}
                                            </td>
                                            <td className="px-3 py-2">
                                                {field.readOnly || field.validValues.length === 0 ? (
                                                    <span className="text-zinc-400 dark:text-zinc-500 italic">—</span>
                                                ) : (
                                                    <span className="flex flex-wrap gap-1">
                                                        {field.validValues.map(v => (
                                                            <span
                                                                key={v}
                                                                className="inline-block px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded font-mono text-[10px]"
                                                            >
                                                                {v}
                                                            </span>
                                                        ))}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-zinc-500 dark:text-zinc-400">
                                                {field.required && !field.readOnly && (
                                                    <span className="inline-block mr-1.5 px-1 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-[10px] font-medium">
                                                        Required
                                                    </span>
                                                )}
                                                {field.description}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Instructions */}
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg space-y-2">
                <h4 className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Recommended workflow
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                    Export your configuration from the <strong>Report</strong> page, edit it in Excel or Google Sheets, then upload it here.
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-400">
                    <strong>Excel tip:</strong> save as <em>CSV UTF-8 (with BOM)</em> via File → Save As — not plain &quot;CSV&quot;.
                    Semicolon-delimited files (European Excel) are automatically detected.
                </p>
            </div>
        </div>
    );
}
