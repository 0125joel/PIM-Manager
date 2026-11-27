"use client";

import { useMemo } from "react";
import { FilterControlPanel } from "@/components/ui/FilterControlPanel";
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
    const groups = useMemo(() => groupAzureControls(getAzureFilterControls(resourceTypes)), [resourceTypes]);

    const optionsOf = (control: AzureFilterControl) => {
        const current = readAzureControlValue(control, filters);
        if (control.options.some((o) => o.value === current)) return control.options;
        // A type that is not among the scopes (an old link) stays an option, so the control never lies about the filter
        return [...control.options, { value: current, label: resourceIconFor(current).label }];
    };

    return (
        <FilterControlPanel
            groups={groups}
            valueOf={(control) => readAzureControlValue(control, filters)}
            onChange={(control, value) => onChange(writeAzureControlValue(control, filters, value))}
            optionsOf={optionsOf}
        />
    );
}
