"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { DemoLock } from "@/components/ui/DemoLock";
import { Tag } from "@/components/ui/Tag";
import type { ResultData } from "@/utils/configureResult";

export type { ResultData };
import { ResultRows } from "./ResultRows";


/**
 * The result of an apply (spec 14.1, render `result-*`): a box with the counts and the actions (Try the failed ones
 * again, Results as CSV, Open in the Report, Undo this apply), one row per change, and the footer about the snapshot.
 * The head ("Applied", "Applied with {n} problems", "Nothing was written") is drawn by the page head. It only shows
 * a result: nothing here writes except Try again and Undo, which go through the review first.
 */
export function ResultPage({ data }: { data: ResultData }) {
    const { view } = data;
    // The progress list went away under the focus: the result takes it
    const boxRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (!document.activeElement || document.activeElement === document.body) boxRef.current?.focus();
    }, []);
    if (!view) {
        return (
            <div className="rounded border border-line bg-surface px-4 py-6">
                <p className="text-sm text-body">There is no apply to show here any more. The result stays only until you leave it.</p>
                <Button className="mt-3" onClick={data.onBack}>Back to Configure</Button>
            </div>
        );
    }
    const failed = view.failedCount;
    const stopped = view.stoppedCount;
    return (
        <>
            {view.differs.length > 0 && (
                <div role="note" className="mb-4 rounded border border-line border-l-2 border-l-warn-fill bg-surface px-4 py-3">
                    <p className="text-sm font-semibold text-ink">{view.differs.length === 1 ? "1 value differs" : `${view.differs.length} values differ`} from what you wanted</p>
                    <p className="mt-0.5 text-xs text-body">Someone else may have changed it meanwhile, or Microsoft stored it differently.</p>
                    <ul className="mt-1.5 list-disc pl-4 text-xs leading-5 text-body">
                        {view.differs.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </div>
            )}
            <section ref={boxRef} tabIndex={-1} aria-label="Result" className="rounded border border-line bg-surface focus:outline-none focus-visible:outline-2 focus-visible:outline-accent">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {failed > 0 && <Tag variant="danger" icon="error">{failed} failed</Tag>}
                        {stopped > 0 && <Tag variant="warn" icon="clock">{stopped} not written (stopped)</Tag>}
                        <Tag>{view.appliedCount} applied</Tag>
                    </div>
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        {failed + stopped > 0 && (
                            <DemoLock>
                                {(locked) => <Button variant="primary" disabled={locked} onClick={data.onRetry}>{view.retryLabel}</Button>}
                            </DemoLock>
                        )}
                        <Button onClick={data.onDownloadCsv}>Results as CSV</Button>
                        <Link href={data.reportHref} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">Open in the Report</Link>
                        {view.canUndo && (
                            <DemoLock>
                                {(locked) => (
                                    <Button disabled={locked || !!data.undoBlockedReason} title={data.undoBlockedReason ?? undefined} onClick={data.onUndo}>
                                        Undo this apply{data.undoBlockedReason && <span className="sr-only">: {data.undoBlockedReason}</span>}
                                    </Button>
                                )}
                            </DemoLock>
                        )}
                    </div>
                </div>
                {data.notice && <p role="alert" className="border-b border-line bg-warn-tint px-4 py-2 text-xs text-ink">{data.notice}</p>}
                {view.canUndo && data.undoBlockedReason && <p className="border-b border-line px-4 py-2 text-right text-xs text-body">Undo: {data.undoBlockedReason}</p>}
                <ResultRows rows={view.rows} label="Changes" />
            </section>
            <p className="mt-6 text-xs text-body">{view.footer}</p>
        </>
    );
}
