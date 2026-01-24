"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

interface FilterGroupProps {
    title: string;
    isExpanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}

export function FilterGroup({ title, isExpanded, onToggle, children }: FilterGroupProps) {
    return (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
                <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{title}</span>
                {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-zinc-500" />
                ) : (
                    <ChevronRight className="h-4 w-4 text-zinc-500" />
                )}
            </button>
            {isExpanded && (
                <div className="p-4 space-y-3 bg-white dark:bg-zinc-900">
                    {children}
                </div>
            )}
        </div>
    );
}
