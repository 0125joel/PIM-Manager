"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { TourId } from "@/config/onboarding";

type DashboardView = "basic" | "advanced";

/** What the open page tells the tours (tour spec 4.2): its tour, whether its data is in, and its dashboard view */
export interface TourPage {
    tour: TourId;
    isReady: boolean;
    view?: DashboardView;
    setView?: (view: DashboardView) => void;
}

let current: TourPage | null = null;
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** A page names its tour while it is open; `isReady` is true once its data is in and nothing is loading */
export function useTourPage(tour: TourId, isReady: boolean, view?: DashboardView, setView?: (view: DashboardView) => void): void {
    // The view setter of a provider changes on every render; the registration calls the latest one
    const setViewRef = useRef(setView);
    useEffect(() => {
        setViewRef.current = setView;
    });
    const hasSetView = setView !== undefined;

    useEffect(() => {
        const page: TourPage = { tour, isReady, view, setView: hasSetView ? (next) => setViewRef.current?.(next) : undefined };
        current = page;
        emit();
        return () => {
            if (current === page) {
                current = null;
                emit();
            }
        };
    }, [tour, isReady, view, hasSetView]);
}

/** The page that is open, for the tours */
export function useCurrentTourPage(): TourPage | null {
    return useSyncExternalStore(subscribe, () => current, () => null);
}

/** The same, outside render (in a timer) */
export function getCurrentTourPage(): TourPage | null {
    return current;
}
