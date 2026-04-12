"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { FEATURE_HIGHLIGHTS_VERSION, HIGHLIGHT_STEPS } from "@/config/onboarding";

const ONBOARDING_COMPLETED_KEY = "pim_onboarding_completed";
const HIGHLIGHTS_VERSION_KEY = "pim_highlights_seen_version";

/**
 * Detects if the current user has used PIM Manager before
 * by checking for existing localStorage keys that indicate prior usage.
 */
function isReturningUser(): boolean {
    const keys = Object.keys(localStorage);

    const indicatorPatterns = [
        "pim_workload_enabled_",
        "pim_feature_enabled_",
        "pim_visibility_",
        "pim_write_consent_",
    ];

    for (const key of keys) {
        for (const pattern of indicatorPatterns) {
            if (key.startsWith(pattern)) return true;
        }
    }

    if (keys.includes("dashboard-view-mode")) return true;

    const theme = localStorage.getItem("theme");
    if (theme && theme !== "system") return true;

    return false;
}

type OnboardingView = "tour" | "highlights" | "none";

function computeInitialView(): OnboardingView {
    const onboardingCompleted = localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
    const seenVersion = localStorage.getItem(HIGHLIGHTS_VERSION_KEY);
    const returning = isReturningUser();

    if (!onboardingCompleted && !returning) {
        return "tour";
    }
    if (seenVersion !== FEATURE_HIGHLIGHTS_VERSION && HIGHLIGHT_STEPS.length > 0) {
        return "highlights";
    }
    return "none";
}

// Subscribe/getSnapshot for hydration — once hydrated, stays true forever
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
