/**
 * The element a tour step points at. A target id can exist twice (top bar and bottom navigation, one of
 * them hidden by CSS), so the first match that is actually visible wins.
 */
export function findTourTarget(target: string): Element | null {
    const candidates = Array.from(document.querySelectorAll(`[data-tour="${target}"]`));
    return candidates.find((el) => el.getClientRects().length > 0) ?? null;
}
