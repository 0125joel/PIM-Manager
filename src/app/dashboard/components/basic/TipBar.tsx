"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { Tip } from "@/utils/tipRules";

const ADVANCE_MS = 8000;

function subscribeToMotion(onChange: () => void) {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface TipBarProps {
    tips: Tip[];
    onSetFilter: (filter: DashboardFilter) => void;
}

/**
 * The tip bar (spec 4.8): tenant tips first, then general ones. Advances every 8 seconds, pauses while the pointer or
 * keyboard focus is inside and with the pause button, and never advances with reduced motion. The rotating text has no
 * `aria-live`, so a screen reader is not interrupted.
 */
export function TipBar({ tips, onSetFilter }: TipBarProps) {
    // null: the first tip (tenant tips lead as soon as they arrive). After a step the shown tip is remembered by id, so
    // tips arriving while someone reads do not swap it.
    const [shownId, setShownId] = useState<string | null>(null);
    const [isPausedByUser, setIsPausedByUser] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [hasFocus, setHasFocus] = useState(false);
    const isReducedMotion = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, () => false);

    const count = tips.length;
    const foundIndex = shownId === null ? 0 : tips.findIndex((t) => t.id === shownId);
    const current = foundIndex >= 0 ? foundIndex : 0;
    const go = (delta: number) => setShownId(tips[(((current + delta) % count) + count) % count].id);
    const isRunning = !isPausedByUser && !isHovered && !hasFocus && !isReducedMotion && count > 1;

    useEffect(() => {
        if (!isRunning) return;
        const timer = setInterval(() => go(1), ADVANCE_MS);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- go only reads current and tips, both covered by the deps
    }, [isRunning, current, tips]);

    if (count === 0) return null;
    const tip = tips[current];
    const isPaused = isPausedByUser || isReducedMotion;

    return (
        <section
            aria-label="Tips"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={(event) => setHasFocus(event.target.matches(":focus-visible"))}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
            }}
            className="flex min-h-[150px] flex-col justify-between gap-2 rounded-md bg-band px-4 py-2 sm:px-5 sm:min-h-[132px] lg:h-[92px] lg:min-h-0 lg:flex-row lg:items-center lg:gap-4 lg:py-4"
        >
            {/* From 1024 the eyebrow sits in the title line (basic-light.png), so the title and two lines of text fit the fixed 92 px */}
            <div className="min-w-0 flex-1">
                <p className="lg:flex lg:items-baseline lg:gap-3">
                    <span className="block shrink-0 font-mono text-xs leading-4 text-accent">
                        tip {current + 1}/{count} · {tip.source === "tenant" ? "this tenant" : "general"}
                    </span>
                    <span className="mt-1 block text-sm leading-5 font-semibold text-ink lg:mt-0 lg:truncate">{tip.title}</span>
                </p>
                <p className="mt-0.5 lg:line-clamp-2 text-[13px] leading-[18px] text-body">{tip.text}</p>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 lg:justify-end lg:gap-6">
                <TipAction tip={tip} onSetFilter={onSetFilter} />
                <div className="flex gap-1.5 sm:gap-2">
                    <Button iconOnly variant="secondary" icon="chevron-left" label="Previous tip" onClick={() => go(-1)} />
                    <Button iconOnly variant="secondary" icon={isPaused ? "play" : "pause"} label={isPaused ? "Resume tips" : "Pause tips"} onClick={() => setIsPausedByUser((p) => !p)} disabled={isReducedMotion} />
                    <Button iconOnly variant="secondary" icon="chevron-right" label="Next tip" onClick={() => go(1)} />
                </div>
            </div>
        </section>
    );
}

function TipAction({ tip, onSetFilter }: { tip: Tip; onSetFilter: (filter: DashboardFilter) => void }) {
    const className = "inline-flex min-h-6 items-center whitespace-nowrap text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11";
    const { action } = tip;
    if (action.kind === "filter") {
        return (
            <button
                type="button"
                className={className}
                onClick={() => {
                    onSetFilter(action.filter);
                    window.scrollTo({ top: 0 });
                }}
            >
                {action.label}
            </button>
        );
    }
    if (action.kind === "anchor") {
        return (
            <a href={action.href} className={className}>
                {action.label}
            </a>
        );
    }
    return (
        <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
            {action.label}
            <span className="sr-only"> (opens Microsoft Learn in a new tab)</span>
        </a>
    );
}
