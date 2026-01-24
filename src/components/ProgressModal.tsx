"use client";

import { Check, Loader2, XCircle, AlertCircle } from "lucide-react";

export type ProgressStatus = "pending" | "loading" | "success" | "error";

export interface ProgressStep {
    id: string;
    label: string;
    status: ProgressStatus;
    details?: string;
}

interface ProgressModalProps {
    isOpen: boolean;
    title: string;
    steps: ProgressStep[];
    onClose?: () => void;
    canClose?: boolean;
}

export function ProgressModal({ isOpen, title, steps, onClose, canClose = false }: ProgressModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-md w-full mx-4 p-6 border border-zinc-200 dark:border-zinc-800">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">{title}</h3>

                <div className="space-y-6">
                    {steps.map((step, index) => (
                        <div key={step.id} className="flex items-start gap-4">
                            <div className="flex-shrink-0 mt-0.5">
                                {step.status === "pending" && (
                                    <div className="h-5 w-5 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
                                )}
                                {step.status === "loading" && (
                                    <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                                )}
                                {step.status === "success" && (
                                    <div className="h-5 w-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                                        <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
                                    </div>
                                )}
                                {step.status === "error" && (
                                    <XCircle className="h-5 w-5 text-red-600" />
                                )}
                            </div>
                            <div className="flex-1">
                                <p className={`text-sm font-medium ${step.status === "pending"
                                        ? "text-zinc-500 dark:text-zinc-500"
                                        : "text-zinc-900 dark:text-zinc-100"
                                    }`}>
                                    {step.label}
                                </p>
                                {step.details && (
                                    <p className="text-xs text-zinc-500 mt-1">{step.details}</p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {canClose && onClose && (
                    <div className="mt-8 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 text-sm font-medium transition-colors"
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
