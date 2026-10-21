"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { LiveValue } from "@/utils/liveValue";
import { convertLegacyReportParams } from "@/utils/legacyReportParams";
import { buildReportSearch, parseReportUrlState, type ReportUrlState, type ReportView } from "@/utils/reportUrlState";

export interface ReportUrlActions {
    state: ReportUrlState;
    setView: (view: ReportView) => void;
    /** Writes `q` with `replace`: typing is not a history entry. Always merges into the URL as it is now, so a late write cannot undo a view or filter change. */
    setQuery: (q: string) => void;
    /** A filter change is a history entry, like the dashboard (`push`) */
    setFilter: (filter: DashboardFilter) => void;
    /** Selects a role or a group of the current view (a history entry) */
    select: (id: string) => void;
    /**
     * Back from the detail on a narrow screen. When the selection was the last push and came from exactly the list it
     * returns to, this is a history back (no second list entry); otherwise the selection is cleared in place
     * (`replace`), so a changed filter or a second selection is never undone.
     */
    clearSelection: () => void;
    /** A link from a group to a role: the roles view with that role selected, `q` and `f` kept */
    openRole: (roleId: string) => void;
    /** The URL for the state shown (a first-item default made explicit), for Copy link */
    getShareUrl: (shownId: string | undefined) => string;
}

/**
 * The URL state of the Report page (`utils/reportUrlState.ts`): reads it with `useSearchParams` and writes it with the
 * router, never scrolling (`scroll: false`, as the dashboard filter). Old Report links (`?privileged=yes&search=anna`) are
 * converted once on mount and the URL is replaced. The consumer sits inside `<Suspense>` (static export).
 */
export function useReportUrlState(): ReportUrlActions {
    const router = useRouter();
    const pathname = usePathname() ?? "/report";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const state = useMemo(() => parseReportUrlState(search), [search]);

    // Callbacks that run later (the search debounce) read the URL as it is then, not as it was when they were created
    const [live] = useState(() => new LiveValue({ search, pathname }));
    useEffect(() => {
        live.set({ search, pathname });
    }, [live, search, pathname]);

    useEffect(() => {
        const { search: converted, changed } = convertLegacyReportParams(search);
        if (changed) router.replace(converted ? `${pathname}?${converted}` : pathname, { scroll: false });
        // Once per mount: the converted URL has no legacy parameters left
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The last push of this page: where it came from and where it went, so "All roles" can step back instead of adding a second list entry
    const lastPush = useRef<{ from: string; to: string } | null>(null);

    const go = useCallback((change: (current: ReportUrlState) => ReportUrlState, mode: "push" | "replace" | "backIfFrom") => {
        const now = live.get();
        const next = change(parseReportUrlState(now.search));
        const query = buildReportSearch(next, now.search);
        const href = query ? `${now.pathname}?${query}` : now.pathname;
        const push = lastPush.current;
        if (mode === "backIfFrom" && push && push.to === now.search && push.from === query) {
            router.back();
            lastPush.current = null;
        } else if (mode === "push") {
            router.push(href, { scroll: false });
            lastPush.current = { from: now.search, to: query };
        } else {
            router.replace(href, { scroll: false });
            lastPush.current = null;
        }
        // Two writes in a row (a click, then the debounced search) must both see the first one
        live.set({ search: query, pathname: now.pathname });
    }, [live, router]);

    const setView = useCallback((view: ReportView) => go((s) => ({ view, q: s.q, filter: s.filter }), "push"), [go]);
    const setQuery = useCallback((q: string) => go((s) => ({ ...s, q }), "replace"), [go]);
    const setFilter = useCallback((filter: DashboardFilter) => go((s) => ({ ...s, filter }), "push"), [go]);
    const select = useCallback((id: string) => go((s) => (s.view === "roles" ? { ...s, roleId: id, groupId: undefined } : { ...s, groupId: id, roleId: undefined }), "push"), [go]);
    const clearSelection = useCallback(() => go((s) => ({ view: s.view, q: s.q, filter: s.filter }), "backIfFrom"), [go]);
    const openRole = useCallback((roleId: string) => go((s) => ({ view: "roles", q: s.q, filter: s.filter, roleId }), "push"), [go]);

    const getShareUrl = useCallback((shownId: string | undefined) => {
        const shown: ReportUrlState = state.view === "roles" ? { ...state, roleId: shownId } : { ...state, groupId: shownId };
        const query = buildReportSearch(shown, search);
        return `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    }, [state, search, pathname]);

    return { state, setView, setQuery, setFilter, select, clearSelection, openRole, getShareUrl };
}
