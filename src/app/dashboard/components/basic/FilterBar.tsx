"use client";

import Link from "next/link";
import { Chip } from "@/components/ui/Chip";
import type { DashboardFilter, DashboardFilterKey } from "@/types/dashboardFilter.types";
import { getFilterLabels, serializeDashboardFilter, type FilterNames } from "@/utils/dashboardFilter";

interface FilterBarProps {
    /** The filter as it was set; one chip per key */
    filter: DashboardFilter;
    /** "7 of 33 privileged roles. Blocks about groups and alerts are not affected." */
    sentence: string;
    onRemoveKey: (key: DashboardFilterKey) => void;
    /** The filter the report link carries (the page's effective filter) */
    reportFilter: DashboardFilter;
    /** Role and custom extension names, so a chip reads "Role: Global Administrator" instead of an id */
    names?: FilterNames;
}

// Removing a chip unmounts the focused button: move focus to the first card instead of the page
function keepFocus() {
    requestAnimationFrame(() => {
        if (document.activeElement === document.body || !document.activeElement) document.querySelector<HTMLElement>('[aria-label="Key numbers"] button')?.focus();
    });
}

export interface FilterBarChip {
    key: string;
    label: string;
    onRemove: () => void;
}

/** Pure view of the "filtered" row: chips, a sentence and the report link. */
export function FilterBarView({ chips, sentence, reportHref }: { chips: FilterBarChip[]; sentence: string; reportHref: string }) {
    return (
        <div role="region" aria-label="Active filter" onClickCapture={keepFocus} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-accent-tint px-3 py-2.5">
            <span className="font-mono text-xs text-accent">filtered</span>
            {chips.map((chip) => (
                <Chip key={chip.key} kind="filter" label={chip.label} onRemove={chip.onRemove} />
            ))}
            <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">{sentence}</p>
            <Link href={reportHref} className="inline-flex min-h-6 items-center gap-1 text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11 max-sm:items-center">
                Open in report with this filter
            </Link>
        </div>
    );
}

/** The "filtered" row under the chips (spec 4.6): removable chip, a sentence with the count, a link to the report. */
export function FilterBar({ filter, sentence, onRemoveKey, reportFilter, names }: FilterBarProps) {
    const chips: FilterBarChip[] = getFilterLabels(filter, names).map(({ key, label }) => ({ key, label, onRemove: () => onRemoveKey(key) }));
    return <FilterBarView chips={chips} sentence={sentence} reportHref={`/report?f=${serializeDashboardFilter(reportFilter)}`} />;
}
