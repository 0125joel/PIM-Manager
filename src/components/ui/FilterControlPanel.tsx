"use client";

import { useId, type ReactNode } from "react";
import type { FilterControlBase, FilterControlOption } from "@/utils/filterControls";

/** The select of a filter control, so every panel looks the same */
export const FILTER_SELECT_CLASS = "h-8 w-[150px] min-w-0 rounded border border-line bg-surface px-2 text-[13px] leading-[18px] text-ink disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11 max-sm:w-[160px]";

/** A control that cannot be used now, and why. `isShown` puts the reason under the select and takes the accent off; else it goes to its title and to screen readers */
export interface FilterControlOff {
    reason: string;
    isShown?: boolean;
}

interface FilterControlPanelProps<C extends FilterControlBase> {
    groups: readonly { group: string; controls: C[] }[];
    valueOf: (control: C) => string;
    onChange: (control: C, value: string) => void;
    /** The options of a control, when they are more than its own: from the data, or a value of an old link */
    optionsOf?: (control: C) => FilterControlOption[];
    offOf?: (control: C) => FilterControlOff | undefined;
    /** A line under the heading of a group */
    noteOf?: (group: string, controls: C[]) => ReactNode;
    id?: string;
    /** Added to the grid */
    className?: string;
}

/** The groups of controls of a filter panel: each control is one select that writes one key of the page's filter; the accent marks a choice that filters. */
export function FilterControlPanel<C extends FilterControlBase>({ groups, valueOf, onChange, optionsOf, offOf, noteOf, id, className = "" }: FilterControlPanelProps<C>) {
    const baseId = useId();
    return (
        <div id={id} className={`grid gap-x-12 gap-y-5 md:grid-cols-3 ${className}`}>
            {groups.map(({ group, controls }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-${group}`}>
                    <h2 id={`${baseId}-${group}`} className="mb-3 text-[13px] leading-5 font-semibold text-ink">{group}</h2>
                    {noteOf?.(group, controls)}
                    <div className="flex flex-col gap-1.5">
                        {controls.map((control) => {
                            const controlId = `${baseId}-${control.key}`;
                            const value = valueOf(control);
                            const off = offOf?.(control);
                            const hasAccent = value !== control.neutral && !off?.isShown;
                            return (
                                <div key={control.key}>
                                    <div className="flex items-center justify-between gap-3">
                                        <label htmlFor={controlId} className="text-[13px] leading-[18px] text-body">{control.label}</label>
                                        <select
                                            id={controlId}
                                            value={value}
                                            disabled={off !== undefined}
                                            title={off && !off.isShown ? off.reason : undefined}
                                            aria-describedby={off ? `${controlId}-hint` : undefined}
                                            onChange={(event) => onChange(control, event.target.value)}
                                            className={`${FILTER_SELECT_CLASS} ${hasAccent ? "border-accent! bg-accent-tint!" : ""}`}
                                        >
                                            {(optionsOf?.(control) ?? control.options).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                        </select>
                                        {off && !off.isShown && <span id={`${controlId}-hint`} className="sr-only">{off.reason}</span>}
                                    </div>
                                    {off?.isShown && <p id={`${controlId}-hint`} className="mt-1 text-xs leading-[17px] text-muted">{off.reason}</p>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
