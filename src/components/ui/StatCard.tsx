"use client";

import { Icon } from "@/components/icons/Icon";
import { Skeleton } from "./Skeleton";

interface StatCardProps {
    label: string;
    /** null means unknown yet: a skeleton shows instead of a number. */
    value: string | number | null;
    /** For example "130 roles · 24 groups". */
    breakdown: string;
    isWarning?: boolean;
    isPressed?: boolean;
    /** Blocks the active filter does not apply to (spec 4.6). */
    isDimmed?: boolean;
    /** When set the card is a button that sets a filter. */
    onSelect?: () => void;
}

export function StatCard({ label, value, breakdown, isWarning = false, isPressed = false, isDimmed = false, onSelect }: StatCardProps) {
    const className = `flex w-full flex-col gap-2 rounded border px-[18px] py-[14px] text-left transition-colors duration-150 ${
        isPressed ? "border-accent bg-accent-tint" : "border-line bg-surface"
    } ${isDimmed ? "opacity-45" : ""} ${onSelect ? "cursor-pointer hover:border-accent" : ""}`;

    const content = (
        <>
            <span className="flex w-full items-center gap-2 text-[13px] leading-[18px] font-medium text-body">
                {label}
                {/* Signifier for touch, where there is no hover: this card filters the page */}
                {onSelect && <Icon name="filter" size={16} className={`ml-auto ${isPressed ? "text-accent" : "text-muted"}`} />}
            </span>
            <span className="flex flex-col items-start sm:flex-row sm:items-baseline sm:gap-3">
                {value === null ? (
                    <>
                        <span className="sr-only">{label} is loading</span>
                        <Skeleton width={56} height={28} />
                        <Skeleton width={112} height={12} className="mt-1 sm:mt-0" />
                    </>
                ) : (
                    <>
                        <span className={`font-mono text-2xl leading-7 font-medium sm:text-[28px] sm:leading-8 ${isWarning ? "text-warn-text" : "text-ink"}`}>{value}</span>
                        <span className="text-[13px] leading-[18px] text-muted">{breakdown}</span>
                    </>
                )}
            </span>
        </>
    );

    if (!onSelect) {
        return <div className={className}>{content}</div>;
    }

    return (
        <button type="button" aria-pressed={isPressed} onClick={onSelect} className={className}>
            {content}
        </button>
    );
}
