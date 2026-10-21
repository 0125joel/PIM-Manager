"use client";

import { useEffect } from "react";

/**
 * Escape clears the page filter (spec 4.6), unless something closer to the user handles it first: a menu, a dialog,
 * the help sheet, or a field (Escape in a search field clears that field).
 */
export function useEscapeClearsFilter(isActive: boolean, clear: () => void): void {
    useEffect(() => {
        if (!isActive) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
            if (document.querySelector('[role="dialog"], [role="menu"], dialog[open]')) return;
            clear();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isActive, clear]);
}
