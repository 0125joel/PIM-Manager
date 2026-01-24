"use client";

import React from 'react';
import { useViewMode } from '@/contexts/ViewModeContext';
import { LayoutGrid, LayoutList } from 'lucide-react';

export function ViewModeToggle() {
    const { viewMode, setViewMode } = useViewMode();

    return (
        <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 gap-0.5">
            <button
                onClick={() => setViewMode("basic")}
                className={`
                    flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md
                    transition-all duration-200
                    ${viewMode === "basic"
                        ? "bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }
                `}
                aria-pressed={viewMode === "basic"}
                title="Basic view - simplified dashboard with key metrics"
            >
                <LayoutList className="w-4 h-4" />
                <span>Basic</span>
            </button>
            <button
                onClick={() => setViewMode("advanced")}
                className={`
                    flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md
                    transition-all duration-200
                    ${viewMode === "advanced"
                        ? "bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                    }
                `}
                aria-pressed={viewMode === "advanced"}
                title="Advanced view - full dashboard with all charts and details"
            >
                <LayoutGrid className="w-4 h-4" />
                <span>Advanced</span>
            </button>
        </div>
    );
}
