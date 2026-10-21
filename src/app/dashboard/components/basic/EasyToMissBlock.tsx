"use client";

import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { isSameFilter, type EasyToMissCategory, type EasyToMissRow } from "@/utils/dashboardStats";

interface EasyToMissBlockProps {
    /** null: the data is still loading */
    rows: EasyToMissRow[] | null;
    /** The Directory roles chip is off: most rows have nothing to count, said in words instead of rows of zeros */
    notice?: string;
    filter: DashboardFilter;
    onSetFilter: (filter: DashboardFilter) => void;
}

const CATEGORIES: EasyToMissCategory[] = ["Access without an end", "Accounts you may not expect", "Roles set up halfway"];

/** "Easy to miss": three categories of two rows, each row a button that filters (spec 4.5). */
export function EasyToMissBlock({ rows, notice, filter, onSetFilter }: EasyToMissBlockProps) {
    return (
        <section aria-labelledby="details-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="details" title="Easy to miss" headingId="details-heading" />
            {notice ? (
                <p className="mt-5 text-[13px] leading-[18px] text-muted">{notice}</p>
            ) : (
            <div className="mt-5 grid grid-cols-1 gap-x-12 gap-y-6 lg:grid-cols-2 xl:grid-cols-3">
                {CATEGORIES.map((category) => (
                    <div key={category}>
                        <h3 className="text-[13px] leading-5 font-semibold text-body">{category}</h3>
                        <ul className="mt-2 flex flex-col border-b border-line">
                            {(rows ?? [null, null]).filter((row) => row === null || row.category === category).map((row, i) => {
                                if (row === null) {
                                    return (
                                        <li key={i} className="border-t border-line py-3" aria-hidden="true">
                                            <Skeleton className="block" width="60%" height={16} />
                                        </li>
                                    );
                                }
                                const isPressed = isSameFilter(filter, row.filter);
                                const isZero = row.count === 0;
                                return (
                                    <li key={row.id} className="border-t border-line">
                                        <button
                                            type="button"
                                            aria-pressed={isPressed}
                                            disabled={row.count === null}
                                            onClick={() => onSetFilter(isPressed ? {} : row.filter)}
                                            className={`flex w-[calc(100%+1rem)] items-start gap-4 py-3 text-left max-sm:min-h-11 -mx-2 rounded px-2 transition-colors duration-150 hover:bg-page ${isPressed ? "bg-accent-tint text-accent" : ""}`}
                                        >
                                            <span className={`w-9 shrink-0 font-mono text-xl leading-6 ${isZero ? "text-muted" : "text-warn-text"}`}>
                                                {row.count === null ? <Skeleton width={28} height={20} /> : row.count}
                                            </span>
                                            <span className="min-w-0">
                                                <span className={`block text-[13px] leading-5 font-medium ${isZero ? "text-body" : "text-ink"} ${isPressed ? "underline underline-offset-2" : ""}`}>{row.label}</span>
                                                <span className="block text-xs leading-4 text-muted">{row.detail}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
            )}
        </section>
    );
}
