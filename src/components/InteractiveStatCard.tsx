"use client";

import { LucideIcon, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

interface InteractiveStatCardProps {
    title: string;
    value: number | string;
    icon: LucideIcon;
    color: string;
    description: string;
    filterKey?: string;
    filterValue?: string;
    onClick?: () => void;
}

export function InteractiveStatCard({
    title,
    value,
    icon: Icon,
    color,
    description,
    filterKey,
    filterValue,
    onClick
}: InteractiveStatCardProps) {
    const searchParams = useSearchParams();

    // Check if this card's filter is active
    const isActive = useMemo(() => {
        if (!filterKey || !filterValue || !searchParams) return false;
        return searchParams.get(filterKey) === filterValue;
    }, [filterKey, filterValue, searchParams]);

    const isClickable = !!onClick;

    const colors: Record<string, string> = {
        blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
        green: "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400",
        amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
        purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
        emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
        indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
        pink: "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400",
        red: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
    };

    const borderColors: Record<string, string> = {
        blue: "border-blue-400 dark:border-blue-500",
        green: "border-green-400 dark:border-green-500",
        amber: "border-amber-400 dark:border-amber-500",
        purple: "border-purple-400 dark:border-purple-500",
        emerald: "border-emerald-400 dark:border-emerald-500",
        indigo: "border-indigo-400 dark:border-indigo-500",
        pink: "border-pink-400 dark:border-pink-500",
        red: "border-red-400 dark:border-red-500",
    };

    const shadowColors: Record<string, string> = {
        blue: "shadow-blue-200/50 dark:shadow-blue-900/50",
        green: "shadow-green-200/50 dark:shadow-green-900/50",
        amber: "shadow-amber-200/50 dark:shadow-amber-900/50",
        purple: "shadow-purple-200/50 dark:shadow-purple-900/50",
        emerald: "shadow-emerald-200/50 dark:shadow-emerald-900/50",
        indigo: "shadow-indigo-200/50 dark:shadow-indigo-900/50",
        pink: "shadow-pink-200/50 dark:shadow-pink-900/50",
        red: "shadow-red-200/50 dark:shadow-red-900/50",
    };

    return (
        <div
            onClick={isClickable ? onClick : undefined}
            className={`
                bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border
                ${isActive
                    ? `border-2 ${borderColors[color]} shadow-lg ${shadowColors[color]}`
                    : 'border-zinc-200 dark:border-zinc-800'
                }
                ${isClickable
                    ? 'cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]'
                    : ''
                }
                relative group
            `}
            title={isClickable ? `Click to filter by ${title}` : undefined}
        >
            {/* Active indicator */}
            {isActive && (
                <div className="absolute top-3 right-3">
                    <div className={`${colors[color]} rounded-full p-1`}>
                        <Check className="h-3 w-3" />
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-lg ${colors[color]}`}>
                    <Icon className="h-6 w-6" />
                </div>
            </div>

            <div className="space-y-1">
                <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {value}
                </p>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {title}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {description}
                </p>
            </div>

            {/* Hover tooltip */}
            {isClickable && !isActive && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs px-2 py-1 rounded whitespace-nowrap">
                        Click to filter
                    </div>
                </div>
            )}

            {/* Active badge */}
            {isActive && (
                <div className="mt-2">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${colors[color]}`}>
                        <Check className="h-3 w-3" />
                        Active filter
                    </span>
                </div>
            )}
        </div>
    );
}
