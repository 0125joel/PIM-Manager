"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { DEMO_DISABLED_REASON, useDemoMode } from "@/contexts/DemoModeContext";
import { tooltipStore } from "@/utils/tooltipStore";

const TOOLTIP_WIDTH = 280;

interface DemoLockProps {
    /** Renders the action; `locked` is true in the demo, the action must then be disabled */
    children: (locked: boolean) => ReactNode;
    /** Layout of the wrapper in the demo, so it takes the place of the button (for example `flex-1` or `w-full`) */
    className?: string;
}

/**
 * Wraps an action that writes to a tenant. Outside the demo it renders the action as it is. In the demo the action is
 * disabled and the wrapper explains why on hover, on keyboard focus and on tap (Escape closes), with the same one-open
 * tooltip as `ui/Tag`. A disabled button gets no pointer or focus events, so the wrapper takes them.
 */
export function DemoLock({ children, className = "inline-flex" }: DemoLockProps) {
    const isDemo = useDemoMode();
    const id = useId();
    const ref = useRef<HTMLSpanElement>(null);
    const isOpen = useSyncExternalStore(tooltipStore.subscribe, () => tooltipStore.getOpenId() === id, () => false);
    const [position, setPosition] = useState({ top: 0, left: 0, isAbove: false });

    const open = useCallback(() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) {
            const isAbove = window.innerHeight - rect.bottom < 120 && rect.top > 120;
            setPosition({ top: isAbove ? rect.top - 6 : rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8)), isAbove });
        }
        tooltipStore.open(id);
    }, [id]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
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

    useEffect(() => () => tooltipStore.close(id), [id]);

    if (!isDemo) return <>{children(false)}</>;

    return (
        <span
            ref={ref}
            tabIndex={0}
            aria-describedby={`${id}-reason`}
            data-demo-lock=""
            onMouseEnter={open}
            onMouseLeave={() => tooltipStore.close(id)}
            onFocus={open}
            onBlur={() => tooltipStore.close(id)}
            onClick={() => (isOpen ? tooltipStore.close(id) : open())}
            className={`${className} cursor-not-allowed rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&>*]:pointer-events-none`}
        >
            {children(true)}
            <span id={`${id}-reason`} className="sr-only">{DEMO_DISABLED_REASON}</span>
            {isOpen && (
                <span
                    aria-hidden="true"
                    style={{ top: position.top, left: position.left, maxWidth: TOOLTIP_WIDTH, transform: position.isAbove ? "translateY(-100%)" : undefined }}
                    className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded border border-line bg-surface px-3 py-2 text-left text-[12px] leading-[18px] font-normal whitespace-normal text-ink shadow-menu"
                >
                    {DEMO_DISABLED_REASON}
                </span>
            )}
        </span>
    );
}
