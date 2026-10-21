"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { LiveValue } from "@/utils/liveValue";
import { ReportFilterChips } from "./ReportFilterChips";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { DashboardFilterKey } from "@/types/dashboardFilter.types";
import type { FilterLabel } from "@/utils/dashboardFilter";
import type { ReportView } from "@/utils/reportUrlState";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LABEL = "Search a role, a group or a person";

interface ReportToolbarProps {
    view: ReportView;
    onViewChange: (view: ReportView) => void;
    /** null while the count is unknown (a skeleton) */
    roleCount: number | null;
    /** undefined: no count (the Groups segment is locked) */
    groupCount: number | null | undefined;
    /** PIM for Groups has no consent: the Groups segment is dashed with a lock */
    isGroupsLocked: boolean;
    /** The search term of the URL */
    query: string;
    onQueryChange: (query: string) => void;
    /** Number of active keys of this view (the badge) */
    filterCount: number;
    isFiltersOpen: boolean;
    onFiltersToggle: () => void;
    /** The filter panel, rendered under the first row when open */
    panel: ReactNode;
    chips: FilterLabel[];
    onRemoveChip: (key: DashboardFilterKey) => void;
    onClearAll: () => void;
    /** "7 of 146 roles" */
    resultText: string | null;
}

/** One bordered box: Roles or Groups, the search, Filters, the chips of the active filter and the count (spec 2.2). */
export function ReportToolbar({ view, onViewChange, roleCount, groupCount, isGroupsLocked, query, onQueryChange, filterCount, isFiltersOpen, onFiltersToggle, panel, chips, onRemoveChip, onClearAll, resultText }: ReportToolbarProps) {
    // The field keeps what is typed; the URL follows 200 ms after the last key. An outside change of `q` (Clear filters, a link)
    // replaces the draft; the echo of what this field wrote itself does not.
    const [draft, setDraft] = useState(query);
    const [flushed, setFlushed] = useState(query);
    const [seenQuery, setSeenQuery] = useState(query);
    if (query !== seenQuery) {
        setSeenQuery(query);
        if (query !== flushed && query !== draft) {
            setDraft(query);
            setFlushed(query);
        }
    }

    // The timer writes the draft as it is when it fires, so an outside change that replaced the draft in between wins
    const [draftLive] = useState(() => new LiveValue(draft));
    useEffect(() => {
        draftLive.set(draft);
    }, [draftLive, draft]);

    const filtersButton = useRef<HTMLButtonElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current);
    }, []);

    const handleChange = (value: string) => {
        setDraft(value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            const latest = draftLive.get();
            setFlushed(latest);
            onQueryChange(latest);
        }, SEARCH_DEBOUNCE_MS);
    };

    return (
        <div
            className="rounded border border-line bg-surface p-3 sm:p-3.5"
            onKeyDown={(event) => {
                // Escape closes the panel from anywhere in the toolbar and gives the focus back to the Filters button
                if (event.key !== "Escape" || !isFiltersOpen || event.defaultPrevented) return;
                event.stopPropagation();
                onFiltersToggle();
                filtersButton.current?.focus();
            }}
        >
            <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                    variant="tablist"
                    ariaLabel="Report view"
                    value={view}
                    onChange={onViewChange}
                    options={[
                        { value: "roles", label: "Roles", count: roleCount },
                        { value: "groups", label: "Groups", count: groupCount, isLocked: isGroupsLocked },
                    ]}
                />
                <div className="flex h-8 min-w-0 flex-[1_1_16rem] items-center gap-2 rounded border border-line bg-surface px-2.5 text-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus) max-sm:order-3 max-sm:h-11 max-sm:basis-full">
                    <Icon name="search" size={16} />
                    <input
                        type="search"
                        value={draft}
                        onChange={(event) => handleChange(event.target.value)}
                        onKeyDown={(event) => {
                            // Escape clears the field and nothing else (a filter is cleared with its chip)
                            if (event.key === "Escape" && draft !== "") {
                                event.stopPropagation();
                                handleChange("");
                            }
                        }}
                        aria-label={SEARCH_LABEL}
                        placeholder={SEARCH_LABEL}
                        className="min-w-0 flex-1 bg-transparent text-sm leading-5 text-ink outline-none placeholder:text-muted"
                    />
                </div>
                <Button
                    ref={filtersButton}
                    onClick={onFiltersToggle}
                    aria-expanded={isFiltersOpen}
                    aria-controls={isFiltersOpen ? "report-filter-panel" : undefined}
                    className={`max-sm:order-4 max-sm:ml-auto ${filterCount > 0 ? "border-accent! bg-accent-tint!" : ""}`}
                    data-tour="report-filters"
                >
                    Filters
                    {filterCount > 0 && <span className="rounded bg-accent px-1.5 text-[11px] leading-4 text-accent-ink">{filterCount}</span>}
                </Button>
            </div>

            {isFiltersOpen && (
                <div
                    id="report-filter-panel"
                    className="mt-3 border-t border-line pt-3"
                >
                    {panel}
                </div>
            )}

            <ReportFilterChips chips={chips} onRemove={onRemoveChip} onClearAll={onClearAll} resultText={resultText} />
        </div>
    );
}
