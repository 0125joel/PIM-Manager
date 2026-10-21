"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Skeleton } from "@/components/ui/Skeleton";

/** The "label ... number" row under a chart; a button when it sets a filter (spec 4.6 and 4.9). */
export function CountRow({ label, value, tone = "ink", isPressed = false, onSelect, isPending = false }: { label: string; value: number | null; tone?: "ink" | "warn"; isPressed?: boolean; onSelect?: () => void; isPending?: boolean }) {
    const content = (
        <>
            <span className={`flex-1 text-left ${tone === "warn" ? "text-warn-text" : "text-ink"} ${isPressed ? "underline underline-offset-2" : ""}`}>{label}</span>
            {isPending || value === null ? <Skeleton width={24} height={14} /> : <span className="font-mono text-ink">{value}</span>}
        </>
    );
    const className = "flex w-full items-center gap-3 py-1 text-[13px] leading-[18px] max-sm:min-h-11";
    if (!onSelect || isPending) return <li className={className}>{content}</li>;
    return (
        <li>
            <button type="button" aria-pressed={isPressed} onClick={onSelect} className={`${className} -mx-2 w-[calc(100%+1rem)] rounded px-2 transition-colors duration-150 hover:bg-page ${isPressed ? "bg-accent-tint" : ""}`}>
                {content}
            </button>
        </li>
    );
}

/** A small heading inside a section: h3 (spec 4.10). */
export function SubHeading({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <h3 className={`text-sm leading-5 font-semibold text-ink ${className}`}>{children}</h3>;
}

/** The tag next to a marked emergency access account; the data decides, so it needs no hook. */
export function EmergencyBadge() {
    return (
        <span className="ml-2 inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] leading-4 text-body">
            <Icon name="emergency-access" size={16} className="h-3 w-3" />
            emergency
        </span>
    );
}

export function KindTag({ label }: { label: string }) {
    return <span className="ml-2 text-xs text-muted">{label}</span>;
}

/** The sentence that replaces a section body: not counted, not loaded, nothing to show. */
export function SectionNotice({ children }: { children: ReactNode }) {
    return <p className="mt-5 text-[13px] leading-[18px] text-muted">{children}</p>;
}

/** The two blocks of a split section: a vertical rule between them from lg up, a horizontal one when stacked */
export const SPLIT_START = "min-w-0 lg:pr-12";
export const SPLIT_END = "min-w-0 max-lg:mt-8 max-lg:border-t max-lg:border-line max-lg:pt-8 lg:border-l lg:border-line lg:pl-12";
