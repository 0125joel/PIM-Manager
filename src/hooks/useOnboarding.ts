"use client";

import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { FEATURE_HIGHLIGHTS_VERSION } from "@/config/onboarding";

// Exported so other components (the help panel and the guide) never duplicate the key strings
export const ONBOARDING_COMPLETED_KEY = "pim_onboarding_completed";
export const HIGHLIGHTS_VERSION_KEY = "pim_highlights_seen_version";

/** In-tab event that tells the mounted OnboardingWrapper to restart the tour. */
export const ONBOARDING_RESTART_EVENT = "pim-onboarding-restart";

/**
 * Restart the onboarding tour from anywhere (for example the Help modal) without
 * a full page reload. The mounted `useOnboarding` instance picks up the event.
 */
export function requestTourRestart(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(ONBOARDING_RESTART_EVENT));
}

type OnboardingView = "tour" | "highlights" | "none";

/** Nothing starts by itself (NG-20): the tour is started from the help panel or the guide. */
function computeInitialView(): OnboardingView {
    return "none";
}

// Subscribe/getSnapshot for hydration, once hydrated, stays true forever
let hydrated = false;
function subscribeToHydration(callback: () => void) {
    if (!hydrated) {
        hydrated = true;
        // Schedule a re-render after hydration
        setTimeout(callback, 0);
    }
    return () => {};
}
function getHydratedSnapshot() { return hydrated; }
function getServerSnapshot() { return false; }

export interface OnboardingState {
    showTour: boolean;
    showHighlights: boolean;
    dismissTour: () => void;
    completeTour: () => void;
    dismissHighlights: () => void;
    restartTour: () => void;
}

export function useOnboarding(): OnboardingState {
    const isHydrated = useSyncExternalStore(subscribeToHydration, getHydratedSnapshot, getServerSnapshot);

    const [view, setView] = useState<OnboardingView>(() => {
        if (typeof window === "undefined") return "none";
        return computeInitialView();
    });

    const completeTour = useCallback(() => {
        localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
        localStorage.setItem(HIGHLIGHTS_VERSION_KEY, FEATURE_HIGHLIGHTS_VERSION);
        setView("none");
    }, []);

    const dismissTour = useCallback(() => {
        completeTour();
    }, [completeTour]);

    const dismissHighlights = useCallback(() => {
        localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
        localStorage.setItem(HIGHLIGHTS_VERSION_KEY, FEATURE_HIGHLIGHTS_VERSION);
        setView("none");
    }, []);

    const restartTour = useCallback(() => {
        localStorage.removeItem(ONBOARDING_COMPLETED_KEY);
        localStorage.removeItem(HIGHLIGHTS_VERSION_KEY);
        setView("tour");
    }, []);

    // Restart requests from other components (the help panel and the guide) arrive as an in-tab event
    useEffect(() => {
        window.addEventListener(ONBOARDING_RESTART_EVENT, restartTour);
        return () => window.removeEventListener(ONBOARDING_RESTART_EVENT, restartTour);
    }, [restartTour]);

    if (!isHydrated) {
        return {
            showTour: false,
            showHighlights: false,
            dismissTour: () => {},
            completeTour: () => {},
            dismissHighlights: () => {},
            restartTour: () => {},
        };
    }

    return {
        showTour: view === "tour",
        showHighlights: view === "highlights",
        dismissTour,
        completeTour,
        dismissHighlights,
        restartTour,
    };
}
