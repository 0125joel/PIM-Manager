"use client";

import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { getHelpForPath } from "@/config/help";
import { WHATS_NEW, WHATS_NEW_TITLE } from "@/config/whatsNew";

export type HelpView = "help" | "whatsNew";

interface HelpPanelProps {
    pathname: string;
    view: HelpView;
    onViewChange: (view: HelpView) => void;
    onClose: () => void;
    onOpenGuide: () => void;
    onStartTour: () => void;
    appVersion?: string;
    /** A term to scroll to and highlight (the Report's Preview tag asks for it) */
    term?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Below 1280 the panel covers the page with a scrim: then it is a modal dialog, from 1280 a complementary region beside it.
// Layout still switches with CSS; only the semantics follow the width, which CSS cannot set.
const SHEET_QUERY = "(max-width: 1279px)";
function subscribeToSheet(onChange: () => void) {
    const query = window.matchMedia(SHEET_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
}
const isSheetNow = () => window.matchMedia(SHEET_QUERY).matches;

/**
 * The help panel (spec 3.4), rendered in the shell's dock. From 1280 up it sits beside the page and narrows it;
 * below that it is a sheet over the page with a scrim and a focus trap. It follows the page you are on.
 */
export function HelpPanel({ pathname, view, onViewChange, onClose, onOpenGuide, onStartTour, appVersion, term }: HelpPanelProps) {
    const panelRef = useRef<HTMLElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const page = getHelpForPath(pathname);
    const isSheet = useSyncExternalStore(subscribeToSheet, isSheetNow, () => false);

    // Focus moves in on open and returns to the opener on close
    useEffect(() => {
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        headingRef.current?.focus();
        return () => {
            if (opener?.isConnected) opener.focus();
        };
    }, []);

    // Open at a term: scroll to it, the highlight comes from `data-active`
    useEffect(() => {
        if (!term || view !== "help") return;
        panelRef.current?.querySelector<HTMLElement>(`[data-term="${CSS.escape(term)}"]`)?.scrollIntoView({ block: "center" });
    }, [term, view, pathname]);

    const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            return;
        }
        // The sheet below 1280 traps focus; the docked panel leaves the page reachable
        if (event.key !== "Tab" || !isSheet) return;
        const items = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!items || items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return (
        <div className="contents">
            <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-scrim xl:hidden" />
            <aside
                ref={panelRef}
                aria-label="Help"
                role={isSheet ? "dialog" : undefined}
                aria-modal={isSheet || undefined}
                onKeyDown={handleKeyDown}
                className="fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-full flex-col border-l border-line bg-surface shadow-menu xl:sticky xl:inset-y-auto xl:top-14 xl:z-auto xl:h-[calc(100dvh-56px)] xl:shrink-0 xl:shadow-none"
            >
                <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-5">
                    <div className="min-w-0">
                        <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="text-lg leading-6 font-semibold text-ink">
                            {view === "help" ? `Help · ${page.title}` : "What's new"}
                        </h2>
                        {view === "whatsNew" && appVersion && <p className="font-mono text-xs text-muted">{appVersion}</p>}
                    </div>
                    <Button iconOnly icon="close" label="Close help" variant="secondary" size="sm" onClick={onClose} />
                </div>
                <div className="px-6 pb-3">
                    <SegmentedControl<HelpView> variant="pill" ariaLabel="Help or what's new" value={view} onChange={onViewChange} options={[{ value: "help", label: "Help" }, { value: "whatsNew", label: "What's new" }]} />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4" tabIndex={0} aria-label={view === "help" ? `Help for ${page.title}` : "What's new"}>
                    {view === "help" ? (
                        <>
                            <p className="mt-2 text-[13px] leading-5 text-body">{page.intro}</p>
                            <ul className="mt-5">
                                {page.blocks.map((block) => (
                                    <li key={block.title} className="border-t border-line py-3">
                                        <h3 className="text-[13px] leading-5 font-semibold text-ink">{block.title}</h3>
                                        <p className="text-[13px] leading-5 text-body">{block.text}</p>
                                    </li>
                                ))}
                            </ul>
                            {page.terms.length > 0 && (
                                <div className="border-t border-line pt-4">
                                    <h3 className="text-xs leading-4 text-muted">Terms</h3>
                                    <dl className="mt-2 flex flex-col gap-2">
                                        {page.terms.map((t) => (
                                            <div key={t.term} data-term={t.term} className={`text-[13px] leading-5 text-body ${term === t.term ? "-mx-2 rounded bg-accent-tint px-2 py-1" : ""}`}>
                                                <dt className="inline font-semibold text-ink">{t.term} </dt>
                                                <dd className="inline">{t.text}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="mt-2 text-[13px] leading-5 text-body">{WHATS_NEW_TITLE}.</p>
                            <ul className="mt-5">
                                {WHATS_NEW.map((entry) => (
                                    <li key={entry.title} className="border-t border-line py-3">
                                        <h3 className="text-[13px] leading-5 font-semibold text-ink">{entry.title}</h3>
                                        <p className="text-[13px] leading-5 text-body">{entry.text}</p>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-line px-6 py-4">
                    <Button onClick={onOpenGuide}>Open the full guide</Button>
                    <Button onClick={onStartTour}>Start the tour</Button>
                </div>
            </aside>
        </div>
    );
}
