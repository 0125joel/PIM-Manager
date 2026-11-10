"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";

interface ReportLayoutProps {
    list: ReactNode;
    detail: ReactNode;
    /** A selection is in the URL: below 1024 the detail is the page, from 1024 up both columns show */
    hasSelection: boolean;
    /** "All roles" or "All groups" */
    backLabel: string;
    onBack: () => void;
    /**
     * From which width list and detail sit side by side: `lg` (1024, the Entra Report) or `xl` (1280, the Azure Report,
     * whose scope tree takes 272 px of the row). Below it the list is the page.
     */
    wideFrom?: "lg" | "xl";
}

/** Literal classes per breakpoint, so Tailwind finds them */
const WIDE = {
    lg: { query: "(min-width: 1024px)", grid: "lg:grid-cols-[400px_minmax(0,1fr)]", hideNarrow: "max-lg:hidden", hideWide: "lg:hidden" },
    xl: { query: "(min-width: 1280px)", grid: "xl:grid-cols-[400px_minmax(0,1fr)]", hideNarrow: "max-xl:hidden", hideWide: "xl:hidden" },
} as const;

/**
 * Master and detail (spec 2.3): the list 400 wide and the detail beside it from 1024 up; below 1024 the list is the page
 * and a selected item replaces it with a back button. Switching is CSS and the URL, no second route. The list scroll
 * position is kept and restored on the way back.
 */
export function ReportLayout({ list, detail, hasSelection, backLabel, onBack, wideFrom = "lg" }: ReportLayoutProps) {
    const wide = WIDE[wideFrom];
    const listScroll = useRef(0);
    const wasSelected = useRef(hasSelection);
    const backButton = useRef<HTMLButtonElement>(null);
    const listSection = useRef<HTMLElement>(null);

    useEffect(() => {
        // Remember where the page was scrolled while the list is the page
        const remember = () => {
            // A hidden list (the detail is the page) must not record the clamped position the browser jumps to
            if (!wasSelected.current && listSection.current?.offsetParent !== null) listScroll.current = window.scrollY;
        };
        window.addEventListener("scroll", remember, { passive: true });
        return () => window.removeEventListener("scroll", remember);
    }, []);

    useEffect(() => {
        if (wasSelected.current === hasSelection) return;
        wasSelected.current = hasSelection;
        if (window.matchMedia(wide.query).matches) return;
        // The detail starts at its top; the list comes back where it was. The element that had focus is hidden now:
        // focus moves to the back button, and back to the selected row of the list.
        window.scrollTo(0, hasSelection ? 0 : listScroll.current);
        if (hasSelection) backButton.current?.focus({ preventScroll: true });
        else listSection.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
    }, [hasSelection, wide.query]);

    return (
        <div className={`grid items-start gap-4 ${wide.grid}`}>
            <section ref={listSection} data-tour="report-list" aria-label="List" className={hasSelection ? wide.hideNarrow : ""}>
                {list}
            </section>
            <section aria-label="Detail" data-tour="report-detail" className={`min-w-0 ${hasSelection ? "" : wide.hideNarrow}`}>
                <button ref={backButton} type="button" onClick={onBack} className={`mb-3 inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline ${wide.hideWide} max-sm:min-h-11`}>
                    <Icon name="chevron-left" size={16} />
                    {backLabel}
                </button>
                {detail}
            </section>
        </div>
    );
}
