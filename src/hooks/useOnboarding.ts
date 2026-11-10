/** In-tab event that asks the mounted OnboardingWrapper to open the choice of Start the tour (tour spec 4.4) */
export const TOUR_CHOICE_EVENT = "pim-tour-choice";

/** Start the tour, from the help panel or the guide: opens the choice of tours without a page reload */
export function requestTourChoice(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(TOUR_CHOICE_EVENT));
}
