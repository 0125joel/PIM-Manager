"use client";

import { Donut, type DonutSegment } from "@/components/charts/Donut";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { buildWhoAnnotation, isSameFilter, type WhoStats } from "@/utils/dashboardStats";

interface WhoBlockProps {
    /** null: still loading */
    who: WhoStats | null;
    filter: DashboardFilter;
    isFiltered: boolean;
    /** Replaces the body: the data is not available */
    notice?: string;
    onSetFilter: (filter: DashboardFilter) => void;
}

interface LegendRow {
    label: string;
    key: "permanent" | "eligible" | "activeTimeBound";
    color: string;
    isWarning?: boolean;
}

const ROWS: LegendRow[] = [
    { label: "Permanent", key: "permanent", color: "var(--warn-fill)", isWarning: true },
    { label: "Eligible", key: "eligible", color: "var(--accent)" },
    { label: "Active, time-bound", key: "activeTimeBound", color: "var(--bar-light)" },
];

/** "Has access": who holds what, as a donut with a legend that filters (spec 4.2 item 2). */
export function WhoBlock({ who, filter, isFiltered, notice, onSetFilter }: WhoBlockProps) {
    const segments: DonutSegment[] = who ? ROWS.map((row) => ({ label: row.label, value: who[row.key], color: row.color })) : [];
    const ariaLabel = who ? `Has access: ${ROWS.map((row) => `${who[row.key]} ${row.label.toLowerCase()}`).join(", ")}, ${who.total} in total` : "Has access, loading";

    return (
        <section aria-labelledby="who-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="who" title="Has access" headingId="who-heading" />
            {notice ? (
                <p className="mt-5 text-[13px] leading-[18px] text-muted">{notice}</p>
            ) : (
            <div className="mt-5 flex items-center gap-4 sm:gap-6">
                <Donut segments={segments} ariaLabel={ariaLabel} isEmpty={!who}>
                    {who ? (
                        <>
                            <span className="font-mono text-xl leading-6 sm:text-[32px] sm:leading-9 font-medium text-warn-text">{who.permanent}</span>
                            <span className="text-xs leading-4 text-body">permanent</span>
                            <span className="text-xs leading-4 text-muted">of {who.total}</span>
                        </>
                    ) : null}
                </Donut>
                <div className="min-w-0 flex-1 self-stretch">
                    <ul className="flex flex-col">
                        {ROWS.map((row) => {
                            const target: DashboardFilter = { assignment: row.key };
                            const isPressed = isSameFilter(filter, target);
                            return (
                                <li key={row.key} className="border-b border-line last:border-b-0">
                                    <button
                                        type="button"
                                        aria-pressed={isPressed}
                                        disabled={!who}
                                        onClick={() => onSetFilter(isPressed ? {} : target)}
                                        className={`flex min-h-[35px] w-[calc(100%+1rem)] items-center gap-2 py-2 text-left -mx-2 rounded px-2 transition-colors duration-150 hover:bg-page text-[13px] leading-[18px] max-sm:min-h-11 ${isPressed ? "font-medium text-accent" : row.isWarning ? "text-warn-text" : "text-ink"}`}
                                    >
                                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                                        <span className="flex-1">{row.label}</span>
                                        {who ? <span className="font-mono">{who[row.key]}</span> : <Skeleton width={28} height={14} />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {who && (
                        <p className="mt-3 font-mono text-xs leading-[18px] text-accent">{buildWhoAnnotation(who, isFiltered)}</p>
                    )}
                </div>
            </div>
            )}
        </section>
    );
}
