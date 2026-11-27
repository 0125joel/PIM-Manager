"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { ReportFilterChips, type FilterChip } from "@/app/report/components/ReportFilterChips";
import { FilterControlPanel } from "@/components/ui/FilterControlPanel";
import type { AuditKind } from "@/types/audit.types";
import { PRIVILEGE_NOT_REPORTED_TEXT } from "@/utils/auditPrivilege";
import { getAuditFilterControls, readAuditFilter, type AuditFilterKey, type AuditFilterValues } from "@/utils/auditFilterControls";
import { AUDIT_KINDS } from "@/utils/auditUrlState";
import { groupFilterControls } from "@/utils/filterControls";
import { AUDIT_KIND_LABELS } from "@/utils/auditView";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LiveValue } from "@/utils/liveValue";
import { AuditKindIcon } from "./AuditEventList";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_LABEL = "Person, role or ticket";
const IDLE_SEARCH_LABEL = "Person, role or group";

/** A chip: off is no background and muted text with a dimmed icon, on is a light tint of its own colour and no border. */
const CHIP_BASE = "inline-flex h-[30px] items-center gap-1.5 rounded px-2 text-xs leading-[17px] max-sm:h-11";
const CHIP_ON = "bg-[color-mix(in_srgb,var(--kind,var(--muted))_11%,transparent)] text-ink hover:bg-[color-mix(in_srgb,var(--kind,var(--muted))_18%,transparent)]";
const CHIP_OFF = "text-muted hover:bg-band";

function Chip({ isOn, onClick, className = "", children }: { isOn: boolean; onClick: () => void; className?: string; children: ReactNode }) {
    return (
        <button type="button" aria-pressed={isOn} onClick={onClick} className={`${CHIP_BASE} ${isOn ? CHIP_ON : CHIP_OFF} ${className}`}>
            {children}
        </button>
    );
}

/** The count of a chip: muted on the bare off chip, body on the tinted on chip (muted on that tint is under 4.5:1) */
function Count({ value, isOn }: { value: number; isOn: boolean }) {
    return <span className={`font-mono ${isOn ? "text-body" : "text-muted"}`}>{value}</span>;
}

/** The search field: it keeps what is typed and the URL follows 200 ms after the last key (as the Report's) */
function SearchField({ query, onQueryChange, label, isWide = false }: { query: string; onQueryChange: (query: string) => void; label: string; isWide?: boolean }) {
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
    const [draftLive] = useState(() => new LiveValue(draft));
    useEffect(() => {
        draftLive.set(draft);
    }, [draftLive, draft]);
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
        <label className="relative block max-sm:w-full">
            <span className="pointer-events-none absolute top-[8px] left-[9px] text-muted max-sm:top-[15px]"><Icon name="search" size={14} /></span>
            <input
                type="search"
                value={draft}
                onChange={(event) => handleChange(event.target.value)}
                onKeyDown={(event) => {
                    // Escape clears the field and nothing else
                    if (event.key === "Escape" && draft !== "") {
                        event.stopPropagation();
                        handleChange("");
                    }
                }}
                aria-label={label}
                placeholder={label}
                className={`h-[30px] ${isWide ? "w-[216px]" : "w-[168px]"} rounded border border-line bg-surface pr-2 pl-[29px] text-xs text-ink placeholder:text-muted max-sm:h-11 max-sm:w-full`}
            />
        </label>
    );
}

interface AuditFilterBarProps {
    /** The view switch Events | No activation; in No activation the kinds, Result and the details toggle are left out */
    view: "events" | "idle";
    onViewChange: (view: "events" | "idle") => void;
    /** "Show more details", only when the viewer may toggle it */
    detailsToggle?: ReactNode;
    kinds: readonly AuditKind[];
    kindCounts: Record<AuditKind, number>;
    onKindsChange: (kinds: AuditKind[]) => void;
    /** What the panel shows: the state in the URL */
    filters: AuditFilterValues;
    onFilterChange: (key: AuditFilterKey, value: string) => void;
    /** Graph gave no privileged flag on any role, so the choice is off with this reason. False while that is not known yet */
    isPrivilegeUnavailable: boolean;
    failedCount: number;
    query: string;
    onQueryChange: (query: string) => void;
    /** The active choices of the panel, removable, with Clear all */
    chips: readonly FilterChip<AuditFilterKey>[];
    onRemoveChip: (key: AuditFilterKey) => void;
    onClearAll: () => void;
    /** The panel is open on first render (the fixture) */
    startFiltersOpen?: boolean;
    /** The Environment choice of the panel (Entra roles or PIM for Groups); Azure has none */
    hasEnvironment?: boolean;
    /** The Scope level choice of the panel, in the place of Environment; only Azure has it */
    hasScopeLevel?: boolean;
    /** The view switch Events | No activation */
    hasIdleView?: boolean;
    /** The label and placeholder of the search in the Events view */
    searchLabel?: string;
    /** The label and placeholder of the search in No activation */
    idleSearchLabel?: string;
}

/**
 * The filter bar, as the Report's toolbar works (variant A of the Azure canvas, Joël, 2026-11-06): on the first line the view,
 * the details toggle, the search and Filters with the number of active filters; the panel with Who, Role and Result under it;
 * then the kinds on their own line and the active filters as chips. Escape closes the panel and returns to Filters. The last
 * kind cannot be switched off: the URL cannot hold an empty choice.
 */
export function AuditFilterBar({ view, onViewChange, detailsToggle, kinds, kindCounts, onKindsChange, filters, onFilterChange, isPrivilegeUnavailable, failedCount, query, onQueryChange, chips, onRemoveChip, onClearAll, startFiltersOpen = false, hasEnvironment = true, hasScopeLevel = false, hasIdleView = true, searchLabel, idleSearchLabel }: AuditFilterBarProps) {
    const isIdle = view === "idle";
    const [isFiltersOpen, setIsFiltersOpen] = useState(startFiltersOpen);
    const filtersButton = useRef<HTMLButtonElement>(null);
    const panelId = useId();
    const toggleKind = (kind: AuditKind) => {
        const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
        if (next.length > 0) onKindsChange(next);
    };
    const filterCount = chips.length;

    return (
        <div
            data-tour="audit-filters"
            data-visual-section="audit-filters"
            className="flex flex-col gap-3"
            onKeyDown={(event) => {
                if (event.key !== "Escape" || !isFiltersOpen || event.defaultPrevented) return;
                event.stopPropagation();
                setIsFiltersOpen(false);
                filtersButton.current?.focus();
            }}
        >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 max-sm:gap-y-3">
                <div data-tour="audit-view" className="flex flex-wrap items-center gap-x-3 gap-y-2 max-sm:w-full max-sm:gap-y-3">
                    {hasIdleView && (
                        <div className="w-[260px] max-sm:w-full">
                            <SegmentedControl<"events" | "idle"> variant="radiogroup" ariaLabel="View" value={view} onChange={onViewChange} options={[{ value: "events", label: "Events" }, { value: "idle", label: "No activation" }]} />
                        </div>
                    )}
                    {!isIdle && detailsToggle}
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 max-lg:ml-0 max-lg:justify-start max-sm:w-full max-sm:gap-y-3">
                    <SearchField query={query} onQueryChange={onQueryChange} label={isIdle ? idleSearchLabel ?? IDLE_SEARCH_LABEL : searchLabel ?? SEARCH_LABEL} isWide={isIdle ? idleSearchLabel !== undefined : searchLabel !== undefined} />
                    <Button
                        ref={filtersButton}
                        size="sm"
                        onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                        aria-expanded={isFiltersOpen}
                        aria-controls={isFiltersOpen ? panelId : undefined}
                        className={`max-sm:ml-auto ${filterCount > 0 ? "border-accent! bg-accent-tint!" : ""}`}
                    >
                        Filters
                        {filterCount > 0 && <span className="rounded bg-accent px-1.5 text-[11px] leading-4 text-accent-ink">{filterCount}</span>}
                    </Button>
                </div>
            </div>
            {isFiltersOpen && (
                <FilterControlPanel
                    id={panelId}
                    className="rounded border border-line bg-surface p-4"
                    groups={groupFilterControls(getAuditFilterControls(isIdle, failedCount, hasEnvironment, hasScopeLevel))}
                    valueOf={(control) => readAuditFilter(control.key, filters)}
                    onChange={(control, value) => onFilterChange(control.key, value)}
                    offOf={(control) => (control.key === "privileged" && isPrivilegeUnavailable ? { reason: PRIVILEGE_NOT_REPORTED_TEXT, isShown: true } : undefined)}
                />
            )}
            {!isIdle && <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1">
                {AUDIT_KINDS.map((kind) => {
                    const isOn = kinds.includes(kind);
                    return (
                        <Chip key={kind} isOn={isOn} onClick={() => toggleKind(kind)} className={`audit-kind-${kind}`}>
                            <span className={isOn ? "" : "opacity-45"}><AuditKindIcon kind={kind} /></span>
                            {AUDIT_KIND_LABELS[kind]}
                            <Count value={kindCounts[kind]} isOn={isOn} />
                        </Chip>
                    );
                })}
            </div>}
            {filterCount > 0 && (
                // ReportFilterChips brings its own distance from the toolbar it was made for
                <div className="-mt-3">
                    <ReportFilterChips chips={chips} onRemove={onRemoveChip} onClearAll={onClearAll} resultText={null} />
                </div>
            )}
        </div>
    );
}
