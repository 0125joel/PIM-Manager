import React from 'react';

export type BadgeVariant =
    | 'success'
    | 'warning'
    | 'error'
    | 'info'
    | 'neutral'
    | 'amber'
    | 'green'
    | 'blue'
    | 'purple'
    | 'indigo'
    | 'orange';

export interface BadgeProps {
    /** Icon element to display before the label */
    icon?: React.ReactNode;
    /** Text content of the badge */
    label: string | number;
    /** Visual variant determining colors */
    variant?: BadgeVariant;
    /** Additional CSS classes */
    className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
    success: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    error: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    info: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    neutral: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400',
    amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    purple: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
    orange: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
};

/**
 * Reusable badge component for displaying status indicators, labels, and counts.
 *
 * Consolidates 50+ inline badge patterns across the codebase into a single,
 * consistent component with dark mode support.
 *
 * @example
 * ```tsx
 * <Badge icon={<CheckCircle2 className="h-3 w-3" />} label="PIM configured" variant="success" />
 * <Badge label="5 assignments" variant="amber" />
 * ```
 */
export function Badge({ icon, label, variant = 'info', className = '' }: BadgeProps) {
    return (
        <span
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${variantStyles[variant]} ${className}`}
        >
            {icon}
            {label}
        </span>
    );
}
