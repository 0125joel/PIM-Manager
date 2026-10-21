/**
 * Pure helpers for keyboard navigation in tab lists, radio groups and menus.
 * The components own the DOM; these functions only decide the next index.
 */

export type RovingKey = "ArrowRight" | "ArrowLeft" | "ArrowDown" | "ArrowUp" | "Home" | "End";

export type RovingOrientation = "horizontal" | "vertical";

/** Returns the index that a key press moves to, or null when the key does not navigate. */
export function getNextIndex(
    key: string,
    current: number,
    count: number,
    orientation: RovingOrientation = "horizontal",
): number | null {
    if (count <= 0) return null;
    const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    // current < 0 means focus is not on an item: forward goes to the first, backward to the last
    if (key === forward) return current < 0 ? 0 : (current + 1) % count;
    if (key === backward) return current < 0 ? count - 1 : (current - 1 + count) % count;
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    return null;
}

/** Menus move with the vertical arrows; a horizontal arrow does nothing. */
export function getNextMenuIndex(key: string, current: number, count: number): number | null {
    return getNextIndex(key, current, count, "vertical");
}
