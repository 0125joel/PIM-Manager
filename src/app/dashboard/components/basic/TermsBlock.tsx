"use client";

import { Donut, type DonutSegment } from "@/components/charts/Donut";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { getAskForMfaCount, isSameFilter, type TermsStats } from "@/utils/dashboardStats";

interface TermsBlockProps {
    /** null: policies are still arriving, or no directory roles are counted */
    terms: TermsStats | null;
    /** Replaces the body: nothing to show, said in words instead of a skeleton */
    notice?: string;
    /** Said under the body when some roles are left out of the counts (their settings are not readable) */
    caveat?: string;
    /** The roles are in and their settings are still arriving: the ring says so; before that it stays an empty ring */
    isWaitingForSettings?: boolean;
    filter: DashboardFilter;
    onSetFilter: (filter: DashboardFilter) => void;
}

interface TermRow {
    label: string;
    key: "entraMfa" | "authContext" | "neither";
    color: string;
    isWarning?: boolean;
}

const ROWS: TermRow[] = [
    { label: "Entra MFA", key: "entraMfa", color: "var(--accent)" },
    { label: "Auth context", key: "authContext", color: "var(--bar-light)" },
    { label: "Neither", key: "neither", color: "var(--warn-fill)", isWarning: true },
];

interface MiniFigure {
    label: string;
    value: (terms: TermsStats) => number;
    /** The filter a click sets */
    target?: DashboardFilter;
    isWarningWhenAboveZero?: boolean;
}

const FIGURES: MiniFigure[] = [
    { label: "approval", value: (t) => t.approval, target: { approval: "required" } },
    { label: "justification", value: (t) => t.justification, target: { justification: "required" } },
    { label: "over 8 h", value: (t) => t.overEightHours, target: { maxDuration: "over8h" }, isWarningWhenAboveZero: true },
];

/** "On activation": how privileged roles are protected when someone activates them (spec 4.2 item 2). */
export function TermsBlock({ terms, notice, caveat, isWaitingForSettings = false, filter, onSetFilter }: TermsBlockProps) {
    const segments: DonutSegment[] = terms ? ROWS.map((row) => ({ label: row.label, value: terms[row.key], color: row.color })) : [];
    const ariaLabel = terms
        ? `On activation, ${terms.roleCount} roles: ${ROWS.map((row) => `${terms[row.key]} ${row.label}`).join(", ")}`
        : "On activation, loading";

    return (
        <section aria-labelledby="terms-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="terms" title="On activation" headingId="terms-heading" />
            {notice ? (
                <p className="mt-5 text-[13px] leading-[18px] text-muted">{notice}</p>
            ) : (
            <div className="mt-5 flex items-center gap-4 sm:gap-6">
                <Donut segments={segments} ariaLabel={ariaLabel} isEmpty={!terms}>
                    {terms ? (
                        <>
                            <span className="font-mono text-xl leading-6 sm:text-[32px] sm:leading-9 font-medium text-ink">{getAskForMfaCount(terms)}</span>
                            <span className="text-xs leading-4 text-body">ask for MFA</span>
                            <span className="text-xs leading-4 text-muted">of {terms.roleCount}<span className="max-sm:hidden"> privileged</span></span>
                        </>
                    ) : (
                        isWaitingForSettings ? <span className="px-3 text-xs leading-4 text-muted">waiting for settings</span> : null
                    )}
                </Donut>
                <div className="min-w-0 flex-1 self-stretch">
                    {!terms && (
                        <div aria-hidden="true" className="flex flex-col gap-3">
                            <Skeleton className="block" width="85%" height={12} />
                            <Skeleton className="block" width="65%" height={12} />
                            <Skeleton className="block" width="70%" height={12} />
                        </div>
                    )}
                    {terms && <ul className="flex flex-col">
                        {ROWS.map((row) => {
                            const target: DashboardFilter = { mfa: row.key };
                            const isPressed = isSameFilter(filter, target);
                            return (
                                <li key={row.key} className="border-b border-line last:border-b-0">
                                    <button
                                        type="button"
                                        aria-pressed={isPressed}
                                        disabled={!terms}
                                        onClick={() => onSetFilter(isPressed ? {} : target)}
                                        className={`flex min-h-[35px] w-[calc(100%+1rem)] items-center gap-2 py-2 text-left -mx-2 rounded px-2 transition-colors duration-150 hover:bg-page text-[13px] leading-[18px] max-sm:min-h-11 ${isPressed ? "font-medium text-accent" : row.isWarning ? "text-warn-text" : "text-ink"}`}
                                    >
                                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                                        <span className="flex-1">{row.label}</span>
                                        {terms ? <span className="font-mono">{terms[row.key]}</span> : <Skeleton width={28} height={14} />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>}
                    {terms && <ul className="mt-4 grid grid-cols-3 gap-4">
                        {FIGURES.map((figure) => {
                            const value = terms ? figure.value(terms) : null;
                            const isPressed = figure.target !== undefined && isSameFilter(filter, figure.target);
                            const tone = value !== null && value > 0 && figure.isWarningWhenAboveZero ? "text-warn-text" : "text-ink";
                            const content = (
                                <>
                                    <span className={`block font-mono text-[15px] leading-5 ${tone}`}>
                                        {value === null || !terms ? <Skeleton width={36} height={16} /> : `${value}/${terms.roleCount}`}
                                    </span>
                                    <span className="block text-[13px] leading-[18px] text-body">{figure.label}</span>
                                </>
                            );
                            return (
                                <li key={figure.label}>
                                    {figure.target && terms ? (
                                        <button type="button" aria-pressed={isPressed} onClick={() => onSetFilter(isPressed ? {} : figure.target!)} className={`-mx-2 -my-1 rounded px-2 py-1 text-left transition-colors duration-150 hover:bg-page max-sm:min-h-11 ${isPressed ? "bg-accent-tint" : ""}`}>
                                            {content}
                                        </button>
                                    ) : (
                                        <div>{content}</div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>}
                </div>
            </div>
            )}
            {!notice && caveat && <p className="mt-4 text-[13px] leading-[18px] text-muted">{caveat}</p>}
        </section>
    );
}
