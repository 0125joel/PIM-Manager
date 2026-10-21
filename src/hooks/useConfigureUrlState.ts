"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LiveValue } from "@/utils/liveValue";
import { buildConfigureSearch, enterMode, parseConfigureUrlState, type ConfigureMode, type ConfigureStep, type ConfigureUrlState } from "@/utils/configureUrlState";

export interface ConfigureUrlActions {
    state: ConfigureUrlState;
    /** Enters a mode (or the start page with null): a history entry; everything of the previous mode goes. Guided may start at a step */
    setMode: (mode: ConfigureMode | null, gstep?: number) => void;
    /** Review or result inside the mode (a history entry), or back to the mode (null) */
    setStep: (step: ConfigureStep | null) => void;
    /**
     * "Review and apply" of the basket bar: the review of the mode that is open; from the start page or the access model
     * (no review of their own) the review of Edit, which every change can be seen in
     */
    openReview: () => void;
    /** Changes inside a view (selection, tab, select several): replaces the entry */
    update: (change: (current: ConfigureUrlState) => ConfigureUrlState) => void;
}

/**
 * The URL state of the Configure page (`utils/configureUrlState.ts`), as `useReportUrlState`: read with
 * `useSearchParams`, written with the router `{ scroll: false }`, always from the URL as it is at write time. The
 * consumer sits inside `<Suspense>` (static export).
 */
export function useConfigureUrlState(): ConfigureUrlActions {
    const router = useRouter();
    const pathname = usePathname() ?? "/configure";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const state = useMemo(() => parseConfigureUrlState(search), [search]);

    const [live] = useState(() => new LiveValue({ search, pathname }));
    useEffect(() => {
        live.set({ search, pathname });
    }, [live, search, pathname]);

    const go = useCallback((change: (current: ConfigureUrlState) => ConfigureUrlState, mode: "push" | "replace") => {
        const now = live.get();
        const query = buildConfigureSearch(change(parseConfigureUrlState(now.search)), now.search);
        const href = query ? `${now.pathname}?${query}` : now.pathname;
        if (mode === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
        live.set({ search: query, pathname: now.pathname });
    }, [live, router]);

    const setMode = useCallback((mode: ConfigureMode | null, gstep?: number) => go(() => ({ ...enterMode(mode), ...(mode === "guided" && gstep ? { gstep } : {}) }), "push"), [go]);
    const setStep = useCallback((step: ConfigureStep | null) => go((s) => ({ ...s, step }), "push"), [go]);
    const update = useCallback((change: (current: ConfigureUrlState) => ConfigureUrlState) => go(change, "replace"), [go]);
    const openReview = useCallback(() => go((s) => (s.mode && s.mode !== "model" ? { ...s, step: "review" } : { ...enterMode("edit"), step: "review" }), "push"), [go]);

    return { state, setMode, setStep, openReview, update };
}
