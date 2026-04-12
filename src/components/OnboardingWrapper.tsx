"use client";

import { useMsal } from "@azure/msal-react";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingTour } from "@/components/OnboardingTour";
import { ONBOARDING_STEPS, HIGHLIGHT_STEPS } from "@/config/onboarding";

export function OnboardingWrapper() {
    const { accounts } = useMsal();
    const { showTour, showHighlights, dismissTour, completeTour, dismissHighlights } = useOnboarding();

    // Only show onboarding for authenticated users
    if (accounts.length === 0) return null;

    return (
        <>
            {showTour && (
                <OnboardingTour steps={ONBOARDING_STEPS} onClose={dismissTour} onComplete={completeTour} />
            )}
            {showHighlights && !showTour && (
                <OnboardingTour steps={HIGHLIGHT_STEPS} onClose={dismissHighlights} onComplete={dismissHighlights} />
            )}
        </>
    );
}
