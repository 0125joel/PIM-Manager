import React from 'react';

interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular';
    width?: string | number;
    height?: string | number;
    animation?: 'pulse' | 'wave' | 'none';
}

/**
 * Reusable skeleton loader component for loading states
 * Matches Tailwind design system
 */
export function Skeleton({
    className = '',
    variant = 'text',
    width,
    height,
    animation = 'pulse'
}: SkeletonProps) {
    const baseClasses = 'bg-zinc-200 dark:bg-zinc-700';

    const variantClasses = {
        text: 'rounded',
        circular: 'rounded-full',
        rectangular: 'rounded-md'
    };

    const animationClasses = {
        pulse: 'animate-pulse',
        wave: 'animate-shimmer',
        none: ''
    };

    const defaultDimensions = {
        text: { width: '100%', height: '1rem' },
        circular: { width: '2.5rem', height: '2.5rem' },
        rectangular: { width: '100%', height: '8rem' }
    };

    const dimensions = {
        width: width ?? defaultDimensions[variant].width,
        height: height ?? defaultDimensions[variant].height
    };

    return (
        <div
            className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
            style={{
                width: typeof dimensions.width === 'number' ? `${dimensions.width}px` : dimensions.width,
                height: typeof dimensions.height === 'number' ? `${dimensions.height}px` : dimensions.height
            }}
            aria-busy="true"
            aria-live="polite"
        />
    );
}

/**
 * Skeleton for table rows
 */
export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
    return (
        <tr className="border-b border-zinc-200 dark:border-zinc-700">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="px-4 py-3">
                    <Skeleton width="80%" />
                </td>
            ))}
        </tr>
    );
}

/**
 * Skeleton for card content
 */
export function CardSkeleton() {
    return (
        <div className="p-4 space-y-3">
            <Skeleton width="60%" height="1.25rem" />
            <Skeleton width="100%" />
            <Skeleton width="85%" />
            <div className="flex gap-2 mt-4">
                <Skeleton variant="rectangular" width="80px" height="32px" />
                <Skeleton variant="rectangular" width="80px" height="32px" />
            </div>
        </div>
    );
}

export default Skeleton;
