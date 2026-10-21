"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { ConfigureTab } from "@/types/configure.types";
import { EDIT_TABS } from "@/utils/configureTargets";
import { getNextIndex } from "@/utils/rovingFocus";

interface EditTabsProps {
    tab: ConfigureTab;
    onTabChange: (tab: ConfigureTab) => void;
    /** Changes in the basket per tab for this target: a violet count badge */
    counts: Record<ConfigureTab, number>;
    children: ReactNode;
    /** Several targets call the fourth tab "Add people" (spec 5.6) */
    labels?: Partial<Record<ConfigureTab, string>>;
    /** The accessible name of the tab list */
    ariaLabel?: string;
    /** Only these tabs, in this order (Guided shows the parts chosen in Start); all four by default */
    tabs?: readonly ConfigureTab[];
}

/**
 * The four boxed tabs of a target (spec 5.4): `tablist` with a roving tab stop (arrows, Home, End move and select), a
 * violet badge with the number of changes, and under the content the previous tab left and "Next: {tab}" right.
 */
export function EditTabs({ tab, onTabChange, counts, children, labels, ariaLabel = "Settings of this target", tabs }: EditTabsProps) {
    const TABS = tabs ? EDIT_TABS.filter((t) => tabs.includes(t.value)) : EDIT_TABS;
    const labelOf = (value: ConfigureTab) => labels?.[value] ?? TABS.find((t) => t.value === value)?.label ?? "";
    const id = useId();
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const index = Math.max(0, TABS.findIndex((t) => t.value === tab));
    const previous = index > 0 ? TABS[index - 1] : null;
    const next = index < TABS.length - 1 ? TABS[index + 1] : null;

    // The previous or next button can disappear with the step (the first and last tab): focus goes to the tab chosen
    const goTo = (value: ConfigureTab) => {
        onTabChange(value);
        refs.current[TABS.findIndex((t) => t.value === value)]?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const to = getNextIndex(event.key, index, TABS.length, "horizontal");
        if (to === null) return;
        event.preventDefault();
        onTabChange(TABS[to].value);
        refs.current[to]?.focus();
    };

    return (
        <div>
            <div role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className="flex flex-wrap gap-2 border-b border-line p-4 sm:px-5">
                {TABS.map((t, i) => {
                    const isSelected = t.value === tab;
                    const count = counts[t.value];
                    return (
                        <button
                            key={t.value}
                            ref={(el) => { refs.current[i] = el; }}
                            type="button"
                            role="tab"
                            id={`${id}-tab-${t.value}`}
                            aria-selected={isSelected}
                            aria-controls={`${id}-panel`}
                            tabIndex={isSelected ? 0 : -1}
                            onClick={() => onTabChange(t.value)}
                            className={`inline-flex h-9 items-center gap-2 rounded border px-3 text-sm transition-colors duration-150 max-sm:min-h-11 ${isSelected ? "border-accent bg-accent-tint font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]" : "border-line bg-surface text-body hover:bg-page"}`}
                        >
                            {labelOf(t.value)}
                            {count > 0 && (
                                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-change px-1 text-[11px] leading-none font-semibold text-surface">
                                    {count}
                                    <span className="sr-only">{count === 1 ? " change" : " changes"}</span>
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} className="p-4 sm:p-5">
                {children}
                <div className="mt-5 flex items-center justify-between gap-3">
                    {previous ? (
                        <button type="button" onClick={() => goTo(previous.value)} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">
                            {labelOf(previous.value)}
                        </button>
                    ) : <span />}
                    {next && (
                        <button type="button" onClick={() => goTo(next.value)} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">
                            {`Next: ${labelOf(next.value)}`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
