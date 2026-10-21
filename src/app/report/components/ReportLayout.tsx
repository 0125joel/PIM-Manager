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
}

const WIDE_QUERY = "(min-width: 1024px)";

/**
 * Master and detail (spec 2.3): the list 400 wide and the detail beside it from 1024 up; below 1024 the list is the page
 * and a selected item replaces it with a back button. Switching is CSS and the URL, no second route. The list scroll
 * position is kept and restored on the way back.
 */
export function ReportLayout({ list, detail, hasSelection, backLabel, onBack }: ReportLayoutProps) {
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
        if (window.matchMedia(WIDE_QUERY).matches) return;
        // The detail starts at its top; the list comes back where it was. The element that had focus is hidden now:
        // focus moves to the back button, and back to the selected row of the list.
        window.scrollTo(0, hasSelection ? 0 : listScroll.current);
        if (hasSelection) backButton.current?.focus({ preventScroll: true });
        else listSection.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
    }, [hasSelection]);

    return (
        <div className="grid items-start gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
            <section ref={listSection} aria-label="List" className={hasSelection ? "max-lg:hidden" : ""}>
                {list}
            </section>
            <section aria-label="Detail" className={`min-w-0 ${hasSelection ? "" : "max-lg:hidden"}`}>
                <button ref={backButton} type="button" onClick={onBack} className="mb-3 inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline lg:hidden max-sm:min-h-11">
                    <Icon name="chevron-left" size={16} />
                    {backLabel}
                </button>
                {detail}
            </section>
        </div>
    );
}
