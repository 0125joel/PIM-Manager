"use client";

import { useId, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getNextIndex } from "@/utils/rovingFocus";
import { GROUP_CHIPS, NOT_UNDER_PIM_LINE, ROLE_CHIPS, type TargetChip, type TargetList as TargetListData, type TargetRow as TargetRowData } from "@/utils/configureTargets";
import { TargetRow } from "./TargetRow";

interface TargetListProps {
    view: "roles" | "groups";
    onViewChange: (view: "roles" | "groups") => void;
    roleCount: number | null;
    /** null while the groups load; undefined without consent for PIM for Groups */
    groupCount: number | null | undefined;
    list: TargetListData;
    chips: ReadonlySet<TargetChip>;
    onToggleChip: (chip: TargetChip) => void;
    query: string;
    onQueryChange: (query: string) => void;
    currentId: string | undefined;
    onSelect: (row: TargetRowData) => void;
    /** Replaces the rows: loading, no consent for groups, nothing found */
    message?: ReactNode;
    /** "Select several to change together" (spec 5.2, 5.6): rows become checkboxes, a click ticks or unticks */
    isSeveral: boolean;
    onSeveralChange: (on: boolean) => void;
    checkedIds: ReadonlySet<string>;
    /** Guided: replaces the Roles | Groups segment ("Roles, chosen in Start · Change") */
    viewControl?: ReactNode;
    /** Guided: replaces the Select several switch ("{n} selected · Select all {m} shown") */
    severalControl?: ReactNode;
    /** Rows above the list that are not targets (the copy source of Guided) */
    pinned?: ReactNode;
}

/** The arrow keys move between the rows (one tab stop for the list), as the Report list */
function moveBetweenRows(event: KeyboardEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-list-row]"));
    const current = rows.findIndex((row) => row === document.activeElement);
    if (current < 0) return;
    const next = getNextIndex(event.key, current, rows.length, "vertical");
    if (next === null) return;
    event.preventDefault();
    const isWrap = (event.key === "ArrowDown" && next < current) || (event.key === "ArrowUp" && next > current);
    if (!isWrap) rows[next].focus();
}

function keepFocusedRowAsTabStop(event: FocusEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.hasAttribute("data-list-row")) return;
    for (const row of event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-list-row]")) row.tabIndex = row === target ? 0 : -1;
}

/**
 * The list of Edit (spec 5.2): Roles | Groups, the search, the filter chips (AND), the Select several switch, then the
 * rows; groups not under PIM in their own section when asked for.
 */
export function TargetList(props: TargetListProps) {
    const { view, list, chips, currentId } = props;
    const chipOptions = view === "roles" ? ROLE_CHIPS : GROUP_CHIPS;
    const all = [...list.rows, ...list.notUnderPim];
    const stopId = all.some((r) => r.id === currentId) ? currentId : all[0]?.id;
    const noun = view === "roles" ? "roles" : "groups";
    // One reason for every row (the whole area is closed): said once above the rows, each row keeps its lock icon
    const sharedLock = all.length > 1 && all.every((r) => r.lock !== null && r.lock === all[0].lock) ? all[0].lock : null;
    const sharedLockId = `${useId()}-shared-lock`;

    return (
        <div className="overflow-hidden rounded border border-line bg-surface">
            <div className="flex flex-col gap-3 border-b border-line p-3">
                {props.viewControl ?? <SegmentedControl
                    ariaLabel="Roles or groups"
                    value={view}
                    onChange={props.onViewChange}
                    className="w-full"
                    options={[
                        { value: "roles", label: "Roles", count: props.roleCount },
                        { value: "groups", label: "Groups", count: props.groupCount ?? undefined, isLocked: props.groupCount === undefined },
                    ]}
                />}
                <label className="relative block">
                    <span className="sr-only">{`Search ${noun}`}</span>
                    <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                    <input
                        type="search"
                        value={props.query}
                        onChange={(event) => props.onQueryChange(event.target.value)}
                        placeholder={`Search ${noun}`}
                        className="h-9 w-full rounded border border-line bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted max-sm:h-11"
                    />
                </label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
                    {chipOptions.map((chip) => {
                        const isOn = chips.has(chip.value);
                        return (
                            <button
                                key={chip.value}
                                type="button"
                                aria-pressed={isOn}
                                onClick={() => props.onToggleChip(chip.value)}
                                className={`inline-flex h-7 items-center rounded border px-2 text-[12px] leading-4 transition-colors duration-150 max-sm:min-h-11 ${isOn ? "border-accent bg-accent-tint font-medium text-accent" : "border-line bg-surface text-body hover:bg-page"}`}
                            >
                                {chip.label}
                            </button>
                        );
                    })}
                </div>
                {props.severalControl ?? <SelectSeveralSwitch on={props.isSeveral} onChange={props.onSeveralChange} />}
            </div>
            {props.message ?? (
                <div onKeyDown={moveBetweenRows} onFocus={keepFocusedRowAsTabStop} className={`lg:max-h-[calc(100dvh-20rem)] lg:overflow-y-auto ${props.isSeveral ? "max-lg:max-h-[50dvh] max-lg:overflow-y-auto" : ""}`}>
                    {props.pinned}
                    {sharedLock && (
                        <p id={sharedLockId} className="flex items-start gap-1.5 border-b border-line bg-page px-3 py-2.5 text-[13px] leading-[18px] text-body">
                            <Icon name="lock" size={16} className="mt-px shrink-0 text-muted" />
                            <span>{`You cannot change these ${noun}. ${sharedLock}`}</span>
                        </p>
                    )}
                    {list.rows.map((row) => <TargetRow key={row.id} row={row} isChecked={props.isSeveral ? props.checkedIds.has(row.id) : undefined} isCurrent={!props.isSeveral && row.id === currentId} isTabStop={row.id === stopId} onSelect={() => props.onSelect(row)} sharedReasonId={sharedLock ? sharedLockId : undefined} />)}
                    {list.notUnderPim.length > 0 && (
                        <>
                            <h2 className="sticky top-0 z-10 border-y border-line bg-page px-3 py-2 text-xs font-semibold text-muted">
                                Not under PIM yet
                                <span className="block font-normal">{NOT_UNDER_PIM_LINE}</span>
                            </h2>
                            {list.notUnderPim.map((row) => <TargetRow key={row.id} row={row} isChecked={props.isSeveral ? props.checkedIds.has(row.id) : undefined} isCurrent={!props.isSeveral && row.id === currentId} isTabStop={row.id === stopId} onSelect={() => props.onSelect(row)} sharedReasonId={sharedLock ? sharedLockId : undefined} />)}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/** "Select several to change together" (spec 5.2): switches the detail to several targets (spec 5.6); the text is part of the switch */
function SelectSeveralSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
    return (
        <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-fit items-center gap-2.5 text-left text-[13px] text-body max-sm:min-h-11">
            <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded border transition-colors duration-150 ${on ? "border-accent bg-accent" : "border-line bg-page"}`}>
                <span className={`inline-block h-3.5 w-3.5 rounded-sm border bg-surface transition-transform duration-150 ${on ? "translate-x-[18px] border-accent" : "translate-x-0.5 border-line"}`} />
            </span>
            Select several to change together
        </button>
    );
}
