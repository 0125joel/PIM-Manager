/**
 * The element a tour step points at. A target id can exist twice (top bar and bottom navigation, one of
 * them hidden by CSS), so the first match that is actually visible wins.
 */
export function findTourTarget(target: string): Element | null {
    const candidates = Array.from(document.querySelectorAll(`[data-tour="${target}"]`));
    return candidates.find((el) => el.getClientRects().length > 0) ?? null;
}

/** The element of a tour step: its target, or its fallback when the target is not on screen (a phone keeps some controls in a menu) */
export function findStepTarget(step: { target: string; fallbackTarget?: string }): Element | null {
    return findTourTarget(step.target) ?? (step.fallbackTarget ? findTourTarget(step.fallbackTarget) : null);
}
