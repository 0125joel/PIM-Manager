"use client";

import { useId, useMemo } from "react";
import { FILTER_SELECT_CLASS } from "@/app/report/components/ReportFilterPanel";
import type { AzureReportFilters } from "@/utils/azureReport";
import { getAzureFilterControls, groupAzureControls, readAzureControlValue, writeAzureControlValue, type AzureFilterControl } from "@/utils/azureReportFilter";
import { resourceIconFor } from "@/utils/azureResourceIcons";

interface AzureFilterPanelProps {
    filters: AzureReportFilters;
    onChange: (filters: AzureReportFilters) => void;
    /** The resource type of every scope that has one */
    resourceTypes: readonly string[];
}

/** The three groups of controls of the Azure Report: each control is one select that writes one field of the filters. */
export function AzureFilterPanel({ filters, onChange, resourceTypes }: AzureFilterPanelProps) {
    const baseId = useId();
    const groups = useMemo(() => groupAzureControls(getAzureFilterControls(resourceTypes)), [resourceTypes]);

    const optionsOf = (control: AzureFilterControl) => {
        const current = readAzureControlValue(control, filters);
        if (control.options.some((o) => o.value === current)) return control.options;
        // A type that is not among the scopes (an old link) stays an option, so the control never lies about the filter
        return [...control.options, { value: current, label: resourceIconFor(current).label }];
    };

    return (
        <div className="grid gap-x-12 gap-y-5 md:grid-cols-3">
            {groups.map(({ group, controls }) => (
                <div key={group} role="group" aria-labelledby={`${baseId}-${group}`}>
                    <h2 id={`${baseId}-${group}`} className="mb-3 text-[13px] leading-5 font-semibold text-ink">{group}</h2>
                    <div className="flex flex-col gap-1.5">
                        {controls.map((control) => {
                            const id = `${baseId}-${control.key}`;
                            const value = readAzureControlValue(control, filters);
                            return (
                                <div key={control.key} className="flex items-center justify-between gap-3">
                                    <label htmlFor={id} className="text-[13px] leading-[18px] text-body">{control.label}</label>
                                    <select
                                        id={id}
                                        value={value}
                                        onChange={(event) => onChange(writeAzureControlValue(control, filters, event.target.value))}
                                        className={`${FILTER_SELECT_CLASS} ${value !== control.neutral ? "border-accent! bg-accent-tint!" : ""}`}
                                    >
                                        {optionsOf(control).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                    </select>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
