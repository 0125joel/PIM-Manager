"use client";

import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { getNextIndex } from "@/utils/rovingFocus";
import { REPORT_SORT_OPTIONS, isReportSort, type ReportSort } from "@/utils/reportList";

interface ListFrameProps {
    /** "Role" or "Group" */
    label: string;
    sort: ReportSort;
    onSortChange: (sort: ReportSort) => void;
    children: ReactNode;
}

/** The arrow keys move focus between the rows (one tab stop for the whole list, so the detail is not 146 tabs away); Enter or Space selects. */
function moveBetweenRows(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-list-row]"));
    const current = rows.findIndex((row) => row === document.activeElement);
    if (current < 0) return;
    const next = getNextIndex(event.key, current, rows.length, "vertical");
    if (next === null) return;
    event.preventDefault();
    // No wrap around at the ends of a long list
    const isWrap = (event.key === "ArrowDown" && next < current) || (event.key === "ArrowUp" && next > current);
    if (!isWrap) rows[next].focus();
}

/**
 * Roving tab stop (WAI-ARIA APG): the row that has focus, by arrow key or click, becomes the one row Tab reaches, so Tab
 * out to the detail and Shift+Tab back returns to it instead of to the selected or first row.
 */
function keepFocusedRowAsTabStop(event: FocusEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.hasAttribute("data-list-row")) return;
    for (const row of event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-list-row]")) {
        row.tabIndex = row === target ? 0 : -1;
    }
}

/** The box around the list: a header with the column name and the sort select, then the rows; from 1024 up the list scrolls inside its column (spec 2.4). */
export function ListFrame({ label, sort, onSortChange, children }: ListFrameProps) {
    return (
        <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-xs text-muted">
                <span>{label}</span>
                <label className="flex items-center gap-2">
                    Sort
                    <select
                        value={sort}
                        onChange={(event) => {
                            if (isReportSort(event.target.value)) onSortChange(event.target.value);
                        }}
                        className="h-[26px] rounded border border-line bg-surface px-1 text-xs text-ink max-sm:h-11"
                    >
                        {REPORT_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
            </div>
            <div onKeyDown={moveBetweenRows} onFocus={keepFocusedRowAsTabStop} className="lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">{children}</div>
        </div>
    );
}

interface ListRowButtonProps {
    isCurrent: boolean;
    /** The one row the Tab key reaches: the selected one, else the first */
    isTabStop: boolean;
    onSelect: () => void;
    children: ReactNode;
}

/** A row of the list: a button, `aria-current` on the selected one, a 2px accent edge and the accent tint as rendered. */
export function ListRowButton({ isCurrent, isTabStop, onSelect, children }: ListRowButtonProps) {
    return (
        <button
            type="button"
            onClick={onSelect}
            data-list-row=""
            tabIndex={isTabStop ? 0 : -1}
            aria-current={isCurrent ? "true" : undefined}
            className={`relative block w-full border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-page max-sm:min-h-11 ${isCurrent ? "bg-accent-tint before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-accent" : ""}`}
        >
            {children}
        </button>
    );
}
