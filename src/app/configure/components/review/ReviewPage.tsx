"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import type { ReviewData, ReviewView } from "@/utils/configureReview";
import { ApplyProgress } from "../result/ApplyProgress";
import { RemovalConfirm } from "./RemovalConfirm";
import { ReviewBar } from "./ReviewBar";
import { Verdict } from "./Verdict";
import { WritePlan } from "./WritePlan";

export type { ReviewData };

/**
 * The review page (spec 12.1 to 12.3, NG-68): the verdict with the checks, what will be written step by step, and the
 * review bar in place of the basket bar. With removals, Apply first asks for the confirmation by name. Draws
 * `describeReview` only; the container runs the checks. While the checks run again (a Leave out changes the dry run)
 * the last review stays on screen and Apply waits.
 */
export function ReviewPage({ data }: { data: ReviewData }) {
    const [isConfirming, setIsConfirming] = useState(data.startConfirming === true);
    const [shown, setShown] = useState<ReviewView | null>(data.view);
    const applyRef = useRef<HTMLButtonElement>(null);
    const planRef = useRef<HTMLHeadingElement>(null);
    // The last review stays while the checks run again (React's "adjust state while rendering")
    if (data.view && data.view !== shown) setShown(data.view);
    const view = data.view ?? shown;
    const isChecking = !data.view;
    const hasRemovals = !!view && view.removalNames.length > 0;
    const canApply = !!view && view.canApply && !isChecking;
    // The confirmation shows only while it fits: removals left out or a verdict that says fix first hide it
    const needsConfirm = hasRemovals || (view?.countPerSetting?.length ?? 0) > 0;
    const isConfirmShown = isConfirming && needsConfirm && canApply;

    // A confirmation that went away by itself had the focus: give it to Apply, or to the plan while Apply waits
    const wasConfirming = useRef(isConfirmShown);
    useEffect(() => {
        if (wasConfirming.current && !isConfirmShown && (!document.activeElement || document.activeElement === document.body)) {
            if (applyRef.current && !applyRef.current.disabled) applyRef.current.focus();
            else planRef.current?.focus();
        }
        wasConfirming.current = isConfirmShown;
    }, [isConfirmShown]);
    // The last change left out: the focus goes to "Back to changes" of the empty state
    const backRef = useRef<HTMLButtonElement>(null);
    const isEmpty = !!view?.isEmpty && !isChecking;
    useEffect(() => {
        if (isEmpty && (!document.activeElement || document.activeElement === document.body)) backRef.current?.focus();
    }, [isEmpty]);

    const closeConfirm = () => {
        setIsConfirming(false);
        applyRef.current?.focus();
    };
    const leaveOut = (ids: string[]) => {
        data.onLeaveOut(ids);
        // The row goes away; the reader continues at the plan
        planRef.current?.focus();
    };

    const bar = (
        <ReviewBar
            ref={applyRef}
            changeCount={view?.changeCount ?? null}
            hasRemovals={hasRemovals}
            canApply={canApply}
            blockedReason={isChecking ? null : data.applyBlockedReason}
            onBack={data.onBack}
            onApply={() => (needsConfirm ? setIsConfirming(true) : data.onApply())}
        />
    );

    // While the apply runs the progress list replaces the review (spec 13.2)
    if (data.progress) {
        return (
            <div className="mb-6">
                <ApplyProgress rows={data.progress.rows} tenantName={data.progress.tenantName} isStopping={data.progress.isStopping} onStop={data.progress.onStop} />
            </div>
        );
    }
    if (!view) {
        return (
            <>
                <div className="mb-6">
                    <p role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-line bg-surface px-4 py-4 text-sm text-body">
                        <Icon name="spinner" size={16} className="shrink-0 animate-spin" />
                        Checking your changes…
                    </p>
                </div>
                {bar}
            </>
        );
    }
    if (isEmpty) {
        return (
            <div className="mb-6 rounded border border-line bg-surface px-4 py-6">
                <p className="text-sm font-semibold text-ink">Nothing to apply</p>
                <p className="mt-1 text-[13px] text-body">{data.emptyReason ?? "Every change was left out. Nothing has been written."}</p>
                <Button ref={backRef} className="mt-3" onClick={data.onBack}>Back to changes</Button>
            </div>
        );
    }

    // The content and the bar are two children of the page column, so the bar sits at its bottom (as the basket bar)
    return (
        <>
            <div className="mb-6">
                {isChecking && (
                    <p role="status" aria-live="polite" className="mb-3 flex items-center gap-2 text-xs text-body">
                        <Icon name="spinner" size={16} className="shrink-0 animate-spin" />
                        Checking your changes again…
                    </p>
                )}
                <Verdict view={view} onFix={data.onFix} />
                <WritePlan steps={view.steps} onLeaveOut={leaveOut} headingRef={planRef} />
                {isConfirmShown && (
                    <RemovalConfirm
                        removalNames={view.removalNames}
                        countPerSetting={view.countPerSetting}
                        canConfirm={canApply}
                        onCancel={closeConfirm}
                        onConfirm={() => {
                            setIsConfirming(false);
                            data.onApply();
                        }}
                    />
                )}
            </div>
            {bar}
        </>
    );
}
