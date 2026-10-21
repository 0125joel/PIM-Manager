"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FocusEvent, type ReactNode, type Ref } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { tooltipStore } from "@/utils/tooltipStore";

export type TagVariant = "default" | "warn" | "danger" | "accent" | "band";

interface TagProps {
    variant?: TagVariant;
    icon?: IconName;
    children: ReactNode;
    /** The explanation. With it the tag is focusable and shows a tooltip on hover and keyboard focus (Escape hides it). */
    tip?: string;
    /** Makes the tag a button (the Preview tag opens the help panel at its term) */
    onClick?: () => void;
    className?: string;
}

const VARIANTS: Record<TagVariant, string> = {
    default: "border-line bg-surface text-body",
    warn: "border-transparent bg-warn-tint text-warn-text",
    danger: "border-transparent bg-danger-tint text-danger-text",
    accent: "border-transparent bg-accent-tint text-accent",
    band: "border-transparent bg-band text-ink",
};

const BASE = "inline-flex h-[22px] max-w-full items-center gap-1 rounded border px-1.5 text-[12px] leading-4 font-medium whitespace-nowrap";
const TOOLTIP_WIDTH = 280;
const COMPACT_QUERY = "(max-width: 639px)";

interface TipPosition {
    top: number;
    left: number;
    /** Opens above the tag when there is no room below it */
    isAbove: boolean;
}

function subscribe(listener: () => void) {
    return tooltipStore.subscribe(listener);
}

/**
 * Squared tag (Report spec 9.1): optional icon, five variants, and an optional tooltip that opens on hover and on keyboard
 * focus, closes on Escape, and is the only one open (`utils/tooltipStore.ts`). Below 640 a tap toggles it. The tip is also
 * linked with `aria-describedby` through a text that is always in the DOM, so screen readers read it without the popup.
 */
export function Tag({ variant = "default", icon, children, tip, onClick, className = "" }: TagProps) {
    const id = useId();
    const ref = useRef<HTMLSpanElement>(null);
    // A boolean snapshot: only the tag whose tip opens or closes re-renders, not every tag on the page
    const isOpenSnapshot = useSyncExternalStore(subscribe, () => tooltipStore.getOpenId() === id, () => false);
    const isOpen = tip !== undefined && isOpenSnapshot;
    const [position, setPosition] = useState<TipPosition>({ top: 0, left: 0, isAbove: false });

    const place = useCallback(() => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8));
        const isAbove = window.innerHeight - rect.bottom < 120 && rect.top > 120;
        setPosition({ top: isAbove ? rect.top - 6 : rect.bottom + 6, left, isAbove });
    }, []);

    const open = useCallback(() => {
        place();
        tooltipStore.open(id);
    }, [id, place]);

    useEffect(() => {
        if (!isOpen) return;
        // Capture phase: Escape closes the tip first and does not also close the dialog, panel or menu around it
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            event.preventDefault();
            tooltipStore.close(id);
        };
        const onScroll = () => tooltipStore.close(id);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [isOpen, id]);

    // Do not leave a stale open id behind when the tag unmounts
    useEffect(() => () => tooltipStore.close(id), [id]);

    const content = (
        <>
            {icon && <Icon name={icon} size={16} className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">{children}</span>
        </>
    );

    const classes = `${BASE} ${VARIANTS[variant]} ${className}`;

    if (!tip) {
        return onClick
            ? <button type="button" onClick={onClick} className={classes}>{content}</button>
            : <span className={classes}>{content}</span>;
    }

    const tooltip = isOpen && (
        <span
            aria-hidden="true"
            style={{ top: position.top, left: position.left, maxWidth: TOOLTIP_WIDTH, transform: position.isAbove ? "translateY(-100%)" : undefined }}
            className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded border border-line bg-surface px-3 py-2 text-[12px] leading-[18px] font-normal whitespace-normal text-ink shadow-menu"
        >
            {tip}
        </span>
    );

    const handlers = {
        // A mouse or a finger opens through hover or tap; keyboard focus opens through :focus-visible, so a tap
        // (focus, then click) never opens and closes the tip in one go
        onMouseEnter: () => {
            if (!window.matchMedia(COMPACT_QUERY).matches) open();
        },
        onMouseLeave: () => tooltipStore.close(id),
        onFocus: (event: FocusEvent<HTMLElement>) => {
            if (event.currentTarget.matches(":focus-visible")) open();
        },
        onBlur: () => tooltipStore.close(id),
        onClick: () => {
            if (window.matchMedia(COMPACT_QUERY).matches) {
                place();
                tooltipStore.toggle(id);
            }
            onClick?.();
        },
    };

    return onClick ? (
        <button type="button" ref={ref as Ref<HTMLButtonElement>} aria-describedby={`${id}-tip`} {...handlers} className={`${classes} cursor-pointer`}>
            {content}
            <span id={`${id}-tip`} className="sr-only">{tip}</span>
            {tooltip}
        </button>
    ) : (
        <span ref={ref} tabIndex={0} aria-describedby={`${id}-tip`} {...handlers} className={`${classes} cursor-help`}>
            {content}
            <span id={`${id}-tip`} className="sr-only">{tip}</span>
            {tooltip}
        </span>
    );
}
