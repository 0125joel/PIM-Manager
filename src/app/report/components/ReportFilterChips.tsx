"use client";

import { Chip } from "@/components/ui/Chip";

/** One chip: the filter key it removes and its text; a key of the other view carries a muted suffix */
export interface FilterChip<K extends string> {
    key: K;
    label: string;
    suffix?: string;
}

interface ReportFilterChipsProps<K extends string> {
    chips: readonly FilterChip<K>[];
    onRemove: (key: K) => void;
    onClearAll: () => void;
    /** "7 of 146 roles" */
    resultText: string | null;
}

/** The active filter as removable chips with names, "Clear all" and the count on the right (spec 2.2). A key of the other view carries its suffix in muted text. Generic over the key, so the Azure Report uses the same chips. */
export function ReportFilterChips<K extends string>({ chips, onRemove, onClearAll, resultText }: ReportFilterChipsProps<K>) {
    if (chips.length === 0 && !resultText) return null;
    return (
        <div className="mt-3 flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
                <Chip key={chip.key} kind="filter" tone="accent" label={chip.suffix ? `${chip.label} ${chip.suffix}` : chip.label} onRemove={() => onRemove(chip.key)} className={chip.suffix ? "text-muted!" : ""} />
            ))}
            {chips.length > 0 && (
                <button type="button" onClick={onClearAll} className="inline-flex h-7 items-center px-1 text-xs text-accent hover:underline max-sm:min-h-11">
                    Clear all
                </button>
            )}
            {resultText && <span className="ml-auto text-[13px] text-muted">{resultText}</span>}
        </div>
    );
}
