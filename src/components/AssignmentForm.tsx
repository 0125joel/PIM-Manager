"use client";

import { useState } from "react";
import { AssignmentSettings, Principal } from "@/types";
import { UserGroupSearch } from "./UserGroupSearch";
import { X } from "lucide-react";

interface AssignmentFormProps {
    selectedRoleCount: number;
    onApply: (settings: AssignmentSettings) => void;
    onClose?: () => void;
}

export function AssignmentForm({ selectedRoleCount, onApply, onClose }: AssignmentFormProps) {
    const [assignmentType, setAssignmentType] = useState<"Eligible" | "Active">("Eligible");
    const [duration, setDuration] = useState<"Permanent" | "Specified">("Permanent");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [justification, setJustification] = useState("");
    const [principals, setPrincipals] = useState<Principal[]>([]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onApply({
            type: assignmentType,
            duration,
            startDate: duration === "Specified" ? startDate : undefined,
            endDate: duration === "Specified" ? endDate : undefined,
            justification,
            principals,
        });
        if (onClose) onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-lg shadow-xl mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Configure Assignments</h2>
                        <p className="text-sm text-zinc-500 mt-1">Assign {selectedRoleCount} selected roles</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="p-6 space-y-6">
                        {/* Assignment Type */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                Assignment Type
                            </label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setAssignmentType("Eligible")}
                                    className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${assignmentType === "Eligible"
                                        ? "bg-blue-600 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    Eligible
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAssignmentType("Active")}
                                    className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${assignmentType === "Active"
                                        ? "bg-blue-600 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    Active
                                </button>
                            </div>
                        </div>

                        {/* Duration */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                Duration
                            </label>
                            <div className="flex gap-2 mb-3">
                                <button
                                    type="button"
                                    onClick={() => setDuration("Permanent")}
                                    className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${duration === "Permanent"
                                        ? "bg-blue-600 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    Permanent
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setDuration("Specified")}
                                    className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors ${duration === "Specified"
                                        ? "bg-blue-600 text-white"
                                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    Time-bound
                                </button>
                            </div>

                            {duration === "Specified" && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1">Start Date</label>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => setStartDate(e.target.value)}
                                            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-zinc-500 mb-1">End Date</label>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => setEndDate(e.target.value)}
                                            className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Justification */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                                Justification
                            </label>
                            <textarea
                                value={justification}
                                onChange={(e) => setJustification(e.target.value)}
                                placeholder="Reason for this assignment..."
                                rows={2}
                                className="w-full px-3 py-2 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>

                        {/* User/Group Selection */}
                        <div>
                            <UserGroupSearch onSelectionChange={setPrincipals} />
                        </div>

                        <button
                            type="submit"
                            disabled={selectedRoleCount === 0 || principals.length === 0}
                            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Create Assignments
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
