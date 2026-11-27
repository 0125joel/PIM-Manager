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
    /**
     * `fixed` (default): the list 400 wide, the detail the rest. `even`: two equal columns from the same width (the Audit
     * page, whose sentences are longer than role names).
     */
    columns?: "fixed" | "even";
    /** Names the two columns for the visual check: `<prefix>-list` and `<prefix>-detail`. Pages that name their own sections leave it out. */
    visualSection?: string;
}

/** Literal classes per breakpoint, so Tailwind finds them */
const WIDE = {
    lg: { query: "(min-width: 1024px)", grid: "lg:grid-cols-[400px_minmax(0,1fr)]", even: "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", hideNarrow: "max-lg:hidden", hideWide: "lg:hidden" },
    xl: { query: "(min-width: 1280px)", grid: "xl:grid-cols-[400px_minmax(0,1fr)]", even: "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", hideNarrow: "max-xl:hidden", hideWide: "xl:hidden" },
} as const;

/**
 * Master and detail (spec 2.3): the list 400 wide and the detail beside it from 1024 up; below 1024 the list is the page
 * and a selected item replaces it with a back button. Switching is CSS and the URL, no second route. The list scroll
 * position is kept and restored on the way back.
 */
export function ReportLayout({ list, detail, hasSelection, backLabel, onBack, wideFrom = "lg", columns = "fixed", visualSection }: ReportLayoutProps) {
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
        <div className={`grid gap-4 ${columns === "even" ? `${wide.even} items-start lg:items-stretch` : `${wide.grid} items-start`}`}>
            <section ref={listSection} data-tour="report-list" data-visual-section={visualSection && `${visualSection}-list`} aria-label="List" className={`${hasSelection ? wide.hideNarrow : ""} ${columns === "even" ? "lg:relative lg:min-h-80" : ""}`}>
                {list}
            </section>
            <section aria-label="Detail" data-tour="report-detail" data-visual-section={visualSection && `${visualSection}-detail`} className={`min-w-0 ${hasSelection ? "" : wide.hideNarrow}`}>
                <button ref={backButton} type="button" onClick={onBack} className={`mb-3 inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline ${wide.hideWide} max-sm:min-h-11`}>
                    <Icon name="chevron-left" size={16} />
                    {backLabel}
                </button>
                {detail}
            </section>
        </div>
    );
}
