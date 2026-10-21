"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import type { ResultRow } from "@/utils/configureResult";
import { ResultRows } from "./ResultRows";

interface ApplyProgressProps {
    rows: readonly ResultRow[];
    tenantName: string;
    isStopping: boolean;
    onStop: () => void;
}

/**
 * While the apply runs (spec 13.2): the review content is replaced by one row per change (Waiting, Writing, Done, Not
 * written) and one button, "Stop after this write". The write in flight finishes; the rest becomes "Not written".
 */
export function ApplyProgress({ rows, tenantName, isStopping, onStop }: ApplyProgressProps) {
    // The review went away under the focus (Apply or Remove and apply): the progress takes it
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (!document.activeElement || document.activeElement === document.body) headingRef.current?.focus();
    }, []);
    const finished = rows.filter((r) => r.tone !== "waiting" && r.tone !== "writing").length;
    return (
        <section aria-labelledby="apply-progress" className="rounded border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                <div className="min-w-0">
                    <h2 id="apply-progress" ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent">Writing to {tenantName}</h2>
                    <p role="status" aria-live="polite" className="text-xs text-body">
                        {isStopping ? `Stopping after the write in flight. ${finished} of ${rows.length} finished.` : `${finished} of ${rows.length} finished. Each step starts when the one before it is done.`}
                    </p>
                </div>
                <Button className="ml-auto" disabled={isStopping} onClick={onStop}>Stop after this write</Button>
            </div>
            <ResultRows rows={rows} label="Changes being written" />
        </section>
    );
}
