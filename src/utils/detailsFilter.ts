import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { EASY_TO_MISS_FILTERS, isSameFilter } from "@/utils/dashboardStats";

/**
 * A dashboard filter that only a hidden block can set (calm details spec 4): the page then shows its details for this visit,
 * so the filtered rows are never out of sight. Basic: one of the Easy to miss filters. Advanced: a custom extension.
 */
export function filterNeedsDetails(filter: DashboardFilter, view: "basic" | "advanced"): boolean {
    if (view === "advanced") return filter.customExtension !== undefined;
    return Object.values(EASY_TO_MISS_FILTERS).some((f) => isSameFilter(filter, f as DashboardFilter));
}
