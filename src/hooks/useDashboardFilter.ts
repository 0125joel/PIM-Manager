"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardFilter, DashboardFilterKey } from "@/types/dashboardFilter.types";
import { buildSearchWithFilter, isEmptyDashboardFilter, parseDashboardFilter, removeFilterKey } from "@/utils/dashboardFilter";

/**
 * The dashboard filter `f` in the URL (spec 4.6). The consumer must sit inside a `<Suspense>` boundary:
 * `useSearchParams` needs one in the static export.
 */
export function useDashboardFilter() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const raw = searchParams?.get("f") ?? "";
    const filter = useMemo(() => parseDashboardFilter(raw), [raw]);
    const isActive = !isEmptyDashboardFilter(filter);

    const writeFilter = useCallback(
        (next: DashboardFilter) => {
            const search = buildSearchWithFilter(searchParams?.toString() ?? "", next);
            router.push(search ? `${pathname}?${search}` : pathname, { scroll: false });
        },
        [searchParams, router, pathname],
    );

    /** Replaces the whole filter (a click sets exactly one filter, which can be several keys); other parameters stay. */
    const setFilter = useCallback((next: DashboardFilter) => writeFilter(next), [writeFilter]);
    const clearFilter = useCallback(() => writeFilter({}), [writeFilter]);
    const removeKey = useCallback((key: DashboardFilterKey) => writeFilter(removeFilterKey(filter, key)), [writeFilter, filter]);

    return { filter, isActive, setFilter, clearFilter, removeKey };
}
