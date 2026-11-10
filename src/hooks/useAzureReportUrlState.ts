"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AzureReportFilters } from "@/utils/azureReport";
import { buildAzureReportSearch, parseAzureReportUrlState, type AzureReportUrlState } from "@/utils/azureReportFilter";
import { LiveValue } from "@/utils/liveValue";
import type { AzureListView } from "@/utils/azureRoleView";

export interface AzureReportUrlActions {
    state: AzureReportUrlState;
    /** Writes `q` with `replace`: typing is not a history entry. Merges into the URL as it is now. */
    setQuery: (q: string) => void;
    /** A filter change is a history entry (`push`); the search is kept as it is in the URL now */
    setFilters: (filters: AzureReportFilters) => void;
    /** Selects a scope (a history entry); the role stays, and shows when the new scope has it */
    selectScope: (id: string) => void;
    /** Switches the view (a history entry, always written, so the preference no longer decides); the role is cleared */
    setView: (view: AzureListView) => void;
    /** Selects a role of the role view (a history entry) */
    selectRole: (id: string) => void;
    /**
     * Back from the detail on a narrow screen, as the Entra Report: a history back when the selection was the last push
     * and came from exactly the list it returns to, otherwise the role is cleared in place (`replace`).
     */
    clearRole: () => void;
    /** The absolute URL of the state shown, with the view, the scope and the role made explicit, for Copy link */
    getShareUrl: (shown: { view: AzureListView; scopeId: string | null; roleId: string | null }) => string;
}

/**
 * The URL state of the Azure Report (`utils/azureReportFilter.ts`): reads it with `useSearchParams` and writes it with the
 * router, never scrolling. The consumer sits inside `<Suspense>` (static export).
 */
export function useAzureReportUrlState(): AzureReportUrlActions {
    const router = useRouter();
    const pathname = usePathname() ?? "/azure/report";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const state = useMemo(() => parseAzureReportUrlState(search), [search]);

    // Callbacks that run later (the search debounce) read the URL as it is then, not as it was when they were created
    const [live] = useState(() => new LiveValue({ search, pathname }));
    useEffect(() => {
        live.set({ search, pathname });
    }, [live, search, pathname]);

    // The last push of this page: where it came from and where it went, so "All roles" can step back instead of adding a second list entry
    const lastPush = useRef<{ from: string; to: string } | null>(null);

    const go = useCallback((change: (current: AzureReportUrlState) => AzureReportUrlState, mode: "push" | "replace" | "backIfFrom") => {
        const now = live.get();
        const next = change(parseAzureReportUrlState(now.search));
        const query = buildAzureReportSearch(next, now.search);
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

    const setQuery = useCallback((q: string) => go((s) => ({ ...s, filters: { ...s.filters, query: q } }), "replace"), [go]);
    const setFilters = useCallback((filters: AzureReportFilters) => go((s) => ({ ...s, filters: { ...filters, query: s.filters.query } }), "push"), [go]);
    const selectScope = useCallback((id: string) => go((s) => ({ ...s, scopeId: id }), "push"), [go]);
    const setView = useCallback((view: AzureListView) => go((s) => ({ ...s, view, roleId: null }), "push"), [go]);
    const selectRole = useCallback((id: string) => go((s) => ({ ...s, roleId: id }), "push"), [go]);
    const clearRole = useCallback(() => go((s) => ({ ...s, roleId: null }), "backIfFrom"), [go]);

    const getShareUrl = useCallback((shown: { view: AzureListView; scopeId: string | null; roleId: string | null }) => {
        const query = buildAzureReportSearch({ ...state, view: shown.view, scopeId: shown.scopeId, roleId: shown.view === "roles" ? shown.roleId : null }, search);
        return `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    }, [state, search, pathname]);

    return { state, setQuery, setFilters, selectScope, setView, selectRole, clearRole, getShareUrl };
}
