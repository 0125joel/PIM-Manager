"use client";

import { useId, type Ref } from "react";
import { Button } from "@/components/ui/Button";
import { DemoLock } from "@/components/ui/DemoLock";

interface ReviewBarProps {
    /** null before the first checks are in: "Apply changes" */
    changeCount: number | null;
    hasRemovals: boolean;
    canApply: boolean;
    /** Why Apply cannot be used now; shown under the bar */
    blockedReason: string | null;
    onBack: () => void;
    /** Apply, or with removals the confirmation by name first */
    onApply: () => void;
    /** "Apply {n} changes", which takes the focus back when the confirmation closes */
    ref?: Ref<HTMLButtonElement>;
}

/**
 * The review bar (spec 12.3): it replaces the basket bar in the review, at the same place. "Back to changes" left, the
 * removal note in the middle (from 640 up), "Apply {n} changes" right, inside `DemoLock`.
 */
export function ReviewBar({ changeCount, hasRemovals, canApply, blockedReason, onBack, onApply, ref }: ReviewBarProps) {
    const reasonId = useId();
    return (
        <div
            role="region"
            aria-label="Review"
            className="sticky bottom-0 z-20 -mx-4 mt-auto border-t border-change bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 max-sm:bottom-[calc(72px+env(safe-area-inset-bottom))]"
        >
            {/* Below 640 Apply takes its own full-width row (render review-390); the note goes (spec 12.3) */}
            <div className="flex flex-wrap items-center gap-3">
                <Button onClick={onBack}>Back to changes</Button>
                {hasRemovals && <p className="min-w-0 text-xs text-body max-sm:hidden">Removals are confirmed by name in the next step.</p>}
                <div className="ml-auto shrink-0 max-sm:ml-0 max-sm:w-full">
                    <DemoLock className="inline-flex max-sm:flex max-sm:w-full">
                        {(locked) => (
                            <Button ref={ref} variant="primary" className="max-sm:w-full max-sm:justify-center" disabled={locked || !canApply || !!blockedReason} aria-describedby={blockedReason ? reasonId : undefined} onClick={onApply}>
                                {changeCount === null ? "Apply changes" : `Apply ${changeCount} ${changeCount === 1 ? "change" : "changes"}`}
                            </Button>
                        )}
                    </DemoLock>
                </div>
            </div>
            {blockedReason && <p id={reasonId} className="mt-1.5 text-right text-xs text-body">{blockedReason}</p>}
        </div>
    );
}
