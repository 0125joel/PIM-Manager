"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AuditKind } from "@/types/audit.types";
import { clearAuditFilter, writeAuditFilter, type AuditFilterKey } from "@/utils/auditFilterControls";
import { buildAuditSearch, normalizeKinds, parseAuditUrlState, AUDIT_DEFAULT_KINDS, AUDIT_MAX_DAYS, auditDefaultDays, type AuditUrlState } from "@/utils/auditUrlState";
import { LiveValue } from "@/utils/liveValue";

export interface AuditUrlActions {
    state: AuditUrlState;
    /** The period in days (a history entry); it clears the selection of the timeline, which belonged to the old window */
    setDays: (days: number) => void;
    /** The kinds that show (a history entry); an empty list is ignored, the URL cannot hold it */
    setKinds: (kinds: readonly AuditKind[]) => void;
    /** One choice of the Filters panel (a history entry); the neutral value of its control removes it */
    setFilter: (key: AuditFilterKey, value: string) => void;
    /** A chip removed: its key back to neutral (a history entry) */
    removeFilter: (key: AuditFilterKey) => void;
    /** What the Filters panel holds back to its defaults: Who, environment, Privileged only and Failed or denied. The kinds and the search stay */
    clearPanelFilters: () => void;
    /** Writes `q` with `replace`: typing is not a history entry. Merges into the URL as it is now, so a late write cannot undo a filter change. */
    setQuery: (q: string) => void;
    /** The selection of the timeline, ISO times, or null for the whole period. Written with `replace`: a drag is not a stack of history entries. */
    setRange: (range: { from: string; to: string } | null) => void;
    /** Kinds, the Filters panel and search back to their defaults; the period and the selection stay */
    clearFilters: () => void;
    /** Switches between Events and No activation (a history entry); the selection of the timeline and the event stay in the URL */
    setView: (view: "events" | "idle") => void;
    /** Selects an event (a history entry) */
    select: (id: string) => void;
    /** Back from the detail on a narrow screen: a history back when the selection was the last push, else the selection is cleared in place */
    clearSelection: () => void;
    /** The URL for the state shown (a first-row default made explicit), for Copy link */
    getShareUrl: (shownId: string | undefined) => string;
}

/**
 * The URL state of the Audit page (`utils/auditUrlState.ts`), written as the Report writes its own: filters push, typing
 * replaces, never scrolling. The consumer sits inside `<Suspense>` (static export).
 */
export function useAuditUrlState(maxDays: number = AUDIT_MAX_DAYS, defaultDays: number = auditDefaultDays(maxDays)): AuditUrlActions {
    const router = useRouter();
    const pathname = usePathname() ?? "/audit";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const state = useMemo(() => parseAuditUrlState(search, maxDays, defaultDays), [search, maxDays, defaultDays]);

    // Callbacks that run later (the search debounce) read the URL as it is then, not as it was when they were created
    const [live] = useState(() => new LiveValue({ search, pathname }));
    useEffect(() => {
        live.set({ search, pathname });
    }, [live, search, pathname]);

    // Callbacks read the longest period as it is now
    const maxDaysRef = useRef(maxDays);
    const defaultDaysRef = useRef(defaultDays);
    useEffect(() => {
        maxDaysRef.current = maxDays;
        defaultDaysRef.current = defaultDays;
    }, [maxDays, defaultDays]);

    // The last push of this page: where it came from and where it went, so the back button can step back
    const lastPush = useRef<{ from: string; to: string } | null>(null);

    const go = useCallback((change: (current: AuditUrlState) => AuditUrlState, mode: "push" | "replace" | "backIfFrom") => {
        const now = live.get();
        const next = change(parseAuditUrlState(now.search, maxDaysRef.current, defaultDaysRef.current));
        const query = buildAuditSearch(next, now.search, maxDaysRef.current, defaultDaysRef.current);
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
        // Two writes in a row must both see the first one
        live.set({ search: query, pathname: now.pathname });
    }, [live, router]);

    // The selection stays when a filter changes, as in the Report: the detail says when the list no longer shows it
    const setDays = useCallback((days: number) => go((s) => ({ ...s, days, from: undefined, to: undefined }), "push"), [go]);
    const setKinds = useCallback((kinds: readonly AuditKind[]) => {
        const next = normalizeKinds(kinds);
        if (next.length === 0) return;
        go((s) => ({ ...s, kinds: next }), "push");
    }, [go]);
    const setRange = useCallback((range: { from: string; to: string } | null) => go((s) => ({ ...s, from: range?.from, to: range?.to }), "replace"), [go]);
    const setFilter = useCallback((key: AuditFilterKey, value: string) => go((s) => writeAuditFilter(s, key, value), "push"), [go]);
    const removeFilter = useCallback((key: AuditFilterKey) => go((s) => clearAuditFilter(s, key), "push"), [go]);
    const setQuery = useCallback((q: string) => go((s) => ({ ...s, q }), "replace"), [go]);
    const clearPanelFilters = useCallback(() => go((s) => ({ ...s, env: "both", level: undefined, who: undefined, privileged: undefined, failed: false }), "push"), [go]);
    const clearFilters = useCallback(() => go((s) => ({ ...s, kinds: [...AUDIT_DEFAULT_KINDS], env: "both", level: undefined, who: undefined, privileged: undefined, failed: false, q: "" }), "push"), [go]);
    const setView = useCallback((view: "events" | "idle") => go((s) => ({ ...s, view: view === "idle" ? "idle" : undefined }), "push"), [go]);
    const select = useCallback((id: string) => go((s) => ({ ...s, event: id }), "push"), [go]);
    const clearSelection = useCallback(() => go((s) => ({ ...s, event: undefined }), "backIfFrom"), [go]);

    const getShareUrl = useCallback((shownId: string | undefined) => {
        const query = buildAuditSearch({ ...state, event: shownId }, search, maxDaysRef.current, defaultDaysRef.current);
        return `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    }, [state, search, pathname]);

    return { state, setDays, setKinds, setFilter, removeFilter, clearPanelFilters, setQuery, setRange, clearFilters, setView, select, clearSelection, getShareUrl };
}
