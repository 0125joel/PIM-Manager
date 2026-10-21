"use client";

import { useId } from "react";
import type { DashboardFilter, FilterView } from "@/types/dashboardFilter.types";
import type { FilterLabel } from "@/utils/dashboardFilter";
import { getFilterControls, groupControls, readControlValue, writeControlValue, type FilterControl, type FilterControlOption } from "@/utils/reportFilterControls";

interface ReportFilterPanelProps {
    view: FilterView;
    filter: DashboardFilter;
    onChange: (filter: DashboardFilter) => void;
    /** Options of the Role select: role template id and name */
    roleOptions: FilterControlOption[];
    /** Options of the Custom extension select: the tenant's extensions by name */
    extensionOptions: FilterControlOption[];
    /** The chips of the active filter: a value the panel has no option for (a dashboard link's `assignment:active`) is named like its chip */
    chips: readonly FilterLabel[];
    /** The settings of some roles or groups are still arriving: the policy controls are off (spec 7.2) */
    policiesLoading: boolean;
}

const SELECT_CLASS = "h-8 w-[150px] min-w-0 rounded border border-line bg-surface px-2 text-[13px] leading-[18px] text-ink disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11 max-sm:w-[160px]";

/**
 * The three groups of controls per view (spec 6.2, `roles-filters-open.png`): each control is one select that writes one
 * key of `f`. The controls come from `utils/reportFilterControls.ts`; a selection that is not in the options (an extension that
 * left the tenant, a role template that is not loaded) is kept as an option so the control never lies about the filter.
 */
export function ReportFilterPanel({ view, filter, onChange, roleOptions, extensionOptions, chips, policiesLoading }: ReportFilterPanelProps) {
    const baseId = useId();
    const groups = groupControls(getFilterControls(view));

    const optionsOf = (control: FilterControl): FilterControlOption[] => {
        const extra = control.dynamic === "roleTemplates" ? roleOptions : control.dynamic === "customExtensions" ? extensionOptions : [];
        const options = [...control.options, ...extra];
        const current = readControlValue(control, filter);
        if (options.some((o) => o.value === current)) return options;
        // A valid value from the dashboard or an old link that this panel does not offer reads as its chip, not as "unavailable"
        const chipLabel = chips.find((chip) => chip.key === control.key)?.label;
        return [...options, { value: current, label: chipLabel ?? `Unavailable (${current.slice(0, 8)})` }];
    };

    return (
        <div className="grid gap-x-12 gap-y-5 md:grid-cols-3">
            {groups.map(({ group, controls }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-${group}`}>
                    <h3 id={`${baseId}-${group}`} className="mb-3 text-[13px] leading-5 font-semibold text-ink">{group}</h3>
                    {policiesLoading && controls.some((c) => c.needsPolicy) && <p className="-mt-1 mb-2 text-xs text-muted">Available when settings are loaded</p>}
                    <div className="flex flex-col gap-1.5">
                        {controls.map((control) => {
                            const id = `${baseId}-${control.key}`;
                            const isDisabled = control.needsPolicy === true && policiesLoading;
                            const value = readControlValue(control, filter);
                            return (
                                <div key={control.key} className="flex items-center justify-between gap-3">
                                    <label htmlFor={id} className="text-[13px] leading-[18px] text-body">{control.label}</label>
                                    <select
                                        id={id}
                                        value={value}
                                        disabled={isDisabled}
                                        title={isDisabled ? "Available when settings are loaded" : undefined}
                                        aria-describedby={isDisabled ? `${id}-hint` : undefined}
                                        onChange={(event) => onChange(writeControlValue(control, filter, event.target.value))}
                                        className={`${SELECT_CLASS} ${value !== control.neutral ? "border-accent! bg-accent-tint!" : ""}`}
                                    >
                                        {optionsOf(control).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                    {isDisabled && <span id={`${id}-hint`} className="sr-only">Available when settings are loaded</span>}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
