"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ReportFilterChips } from "@/app/report/components/ReportFilterChips";
import type { AzureFilterKey } from "@/utils/azureReport";
import type { AzureFilterChip } from "@/utils/azureReportFilter";
import type { AzureListView } from "@/utils/azureRoleView";
import { LiveValue } from "@/utils/liveValue";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LABEL = "Search principal or role";

interface AzureReportToolbarProps {
    /** Roles or Assignments: the view of the report */
    view: AzureListView;
    onViewChange: (view: AzureListView) => void;
    /** The roles of the scope under the chosen Origin (the switch count) */
    roleCount: number;
    /** The assignments of the scope under the chosen Origin (the switch count) */
    assignmentCount: number;
    /** The search term of the URL */
    query: string;
    onQueryChange: (query: string) => void;
    /** Number of active filters (the badge) */
    filterCount: number;
    isFiltersOpen: boolean;
    onFiltersToggle: () => void;
    /** The filter panel, rendered under the first row when open */
    panel: ReactNode;
    chips: AzureFilterChip[];
    onRemoveChip: (key: AzureFilterKey) => void;
    onClearAll: () => void;
    /** "7 of 146 assignments" */
    resultText: string | null;
}

/** One bordered box: the search, Filters, the chips of the active filters and the count. Same behaviour as the Entra Report toolbar. */
export function AzureReportToolbar({ view, onViewChange, roleCount, assignmentCount, query, onQueryChange, filterCount, isFiltersOpen, onFiltersToggle, panel, chips, onRemoveChip, onClearAll, resultText }: AzureReportToolbarProps) {
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
            <div className="flex flex-wrap items-center gap-3" data-tour="report-toolbar">
                <SegmentedControl
                    variant="tablist"
                    ariaLabel="Report view"
                    value={view}
                    onChange={onViewChange}
                    options={[
                        { value: "roles", label: "Roles", count: roleCount },
                        { value: "assignments", label: "Assignments", count: assignmentCount },
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
                    data-tour="report-filters"
                    onClick={onFiltersToggle}
                    aria-expanded={isFiltersOpen}
                    aria-controls={isFiltersOpen ? "azure-filter-panel" : undefined}
                    className={`max-sm:order-4 max-sm:ml-auto ${filterCount > 0 ? "border-accent! bg-accent-tint!" : ""}`}
                >
                    Filters
                    {filterCount > 0 && <span className="rounded bg-accent px-1.5 text-[11px] leading-4 text-accent-ink">{filterCount}</span>}
                </Button>
            </div>

            {isFiltersOpen && (
                <div
                    id="azure-filter-panel"
                    className="mt-3 border-t border-line pt-3"
                >
                    {panel}
                </div>
            )}

            <ReportFilterChips chips={chips} onRemove={onRemoveChip} onClearAll={onClearAll} resultText={resultText} />
        </div>
    );
}
