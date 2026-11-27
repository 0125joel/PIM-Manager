"use client";

import { FilterControlPanel } from "@/components/ui/FilterControlPanel";
import type { DashboardFilter, FilterView } from "@/types/dashboardFilter.types";
import type { FilterLabel } from "@/utils/dashboardFilter";
import { getFilterControls, groupControls, readControlValue, writeControlValue, type FilterControl, type FilterControlOption } from "@/utils/reportFilterControls";

const POLICIES_LOADING = "Available when settings are loaded";

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

/**
 * The three groups of controls per view (spec 6.2, `roles-filters-open.png`): each control is one select that writes one
 * key of `f`. The controls come from `utils/reportFilterControls.ts`; a selection that is not in the options (an extension that
 * left the tenant, a role template that is not loaded) is kept as an option so the control never lies about the filter.
 */
export function ReportFilterPanel({ view, filter, onChange, roleOptions, extensionOptions, chips, policiesLoading }: ReportFilterPanelProps) {
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
        <FilterControlPanel
            groups={groupControls(getFilterControls(view))}
            valueOf={(control) => readControlValue(control, filter)}
            onChange={(control, value) => onChange(writeControlValue(control, filter, value))}
            optionsOf={optionsOf}
            offOf={(control) => (control.needsPolicy === true && policiesLoading ? { reason: POLICIES_LOADING } : undefined)}
            noteOf={(_, controls) => policiesLoading && controls.some((c) => c.needsPolicy) && <p className="-mt-1 mb-2 text-xs text-muted">{POLICIES_LOADING}</p>}
        />
    );
}
