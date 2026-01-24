"use client";

import { usePimData } from "@/hooks/usePimData";

export function ProgressBar() {
    const { loading, loadingProgress, loadingMessage } = usePimData();

    if (!loading) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-50">
            <div className="h-1 w-full bg-blue-100 dark:bg-blue-900/30 overflow-hidden">
                <div
                    className="h-full bg-blue-600 transition-all duration-300 ease-out"
                    style={{ width: `${loadingProgress}%` }}
                />
            </div>
            <div className="absolute top-2 right-4 bg-white dark:bg-zinc-800 px-3 py-1 rounded-full shadow-md border border-zinc-200 dark:border-zinc-700 flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
                <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {loadingMessage} ({Math.round(loadingProgress)}%)
                </span>
            </div>
        </div>
    );
}
