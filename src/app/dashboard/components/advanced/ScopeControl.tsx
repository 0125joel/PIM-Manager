"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { DashboardScope } from "@/utils/dashboardAdvanced";

const OPTIONS = [
    { value: "privileged" as const, label: "Privileged roles" },
    { value: "all" as const, label: "All roles" },
];

/** Advanced only: which roles every role number of the page counts, privileged or all (spec 4.1). A setting, not a view switch. */
export function ScopeControl({ scope, onChange }: { scope: DashboardScope; onChange: (scope: DashboardScope) => void }) {
    return <SegmentedControl variant="pill" ariaLabel="Roles counted" options={OPTIONS} value={scope} onChange={onChange} />;
}
