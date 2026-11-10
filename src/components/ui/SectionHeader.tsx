"use client";

import type { ReactNode } from "react";

interface SectionHeaderProps {
    /** Mono word above the title, for example "who" or "gaps". */
    eyebrow: string;
    title: string;
    /** A number next to the title, for example the count of groups outside PIM. */
    count?: number;
    countTone?: "warn" | "muted";
    subline?: ReactNode;
    headingLevel?: 2 | 3;
    /** Id of the heading, for `aria-labelledby` on the section */
    headingId?: string;
    isDimmed?: boolean;
    className?: string;
}

/** The h1 of a page (spec 1.2): 28/34 from 1024, 26 on medium, 24 on compact, 600 with -0.015em. */
export const PAGE_TITLE_CLASS = "text-2xl leading-[30px] font-semibold tracking-[-0.015em] text-ink sm:text-[26px] sm:leading-8 lg:text-[28px] lg:leading-[34px]";

/** The box of a dashboard block: a 1px border, radius 4, a 3px accent edge on top and no shadow (spec 1.3, changed after the first tenant test: without a box the blocks ran together). */
export const PANEL_CLASS = "rounded border border-line border-t-[3px] border-t-accent bg-surface p-4 sm:px-5 sm:pb-5";

/**
 * A block the active dashboard filter cannot answer (spec 4.6): its border and background dim and all its text turns muted,
 * so the text still reads at 4.5:1 on both themes (STYLEGUIDE.md, Color). Never opacity on text. Controls inside keep working.
 * The rules live in `.pim-dimmed` in `src/app/globals.css`; put this class on the block, next to `PANEL_CLASS`.
 */
export const DIMMED_CLASS = "pim-dimmed";

/** Text only, without the box: for a header that is dimmed outside a dimmed block. */
export const DIMMED_TEXT_CLASS = "pim-dimmed-text";

/** The header of a block: a mono eyebrow, then the title. The box comes from `PANEL_CLASS` on the section. */
export function SectionHeader({ eyebrow, title, count, countTone = "warn", subline, headingLevel = 2, headingId, isDimmed = false, className = "" }: SectionHeaderProps) {
    const Heading = headingLevel === 2 ? "h2" : "h3";
    return (
        <header className={`${isDimmed ? DIMMED_TEXT_CLASS : ""} ${className}`}>
            <p aria-hidden="true" className="font-mono text-xs text-accent">{eyebrow}</p>
            <Heading id={headingId} className={headingLevel === 2 ? "text-lg leading-6 font-semibold text-ink sm:text-xl sm:leading-[26px]" : "text-[13px] leading-5 font-semibold text-body"}>
                {title}
                {count !== undefined && <span className={`ml-2 ${countTone === "warn" ? "text-warn-text" : "text-muted"}`}>{count}</span>}
            </Heading>
            {subline && <p className="mt-1 text-[13px] leading-[18px] text-muted">{subline}</p>}
        </header>
    );
}
