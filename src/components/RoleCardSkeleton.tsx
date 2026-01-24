"use client";

export function RoleCardSkeleton() {
    return (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden animate-pulse">
            {/* Header skeleton */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50">
                <div className="flex items-center gap-3">
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <div className="h-5 w-48 bg-zinc-200 dark:bg-zinc-700 rounded" />
                            <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
                        </div>
                        <div className="h-4 w-64 bg-zinc-200 dark:bg-zinc-700 rounded mt-2" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="h-6 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                        <div className="h-6 w-24 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export function RoleCardSkeletonList({ count = 5 }: { count?: number }) {
    return (
        <div className="space-y-4">
            {Array.from({ length: count }).map((_, i) => (
                <RoleCardSkeleton key={i} />
            ))}
        </div>
    );
}
