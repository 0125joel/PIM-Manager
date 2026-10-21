"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { getNextIndex } from "@/utils/rovingFocus";
import { tooltipStore } from "@/utils/tooltipStore";

export interface SegmentedOption<T extends string> {
    value: T;
    label: string;
    icon?: IconName;
    /** A number after the label (muted); null shows a skeleton while it is unknown */
    count?: number | null;
    /** No consent yet: a dashed outline and the key icon; selecting it still selects (the view explains and asks) */
    isLocked?: boolean;
    /** An amber dot: this option needs attention (Member or Owner settings with a flagged tab) */
    hasDot?: boolean;
    /** Not available: `aria-disabled`, a dashed outline without the key, never selected; keyboard focus still reaches it */
    isDisabled?: boolean;
    /** Why it is disabled: a tooltip on hover, focus and tap (Escape closes), and the accessible description */
    disabledReason?: string;
}

interface SegmentedControlProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** tablist: Basic/Advanced style (squared, ink fill for the selected option). radiogroup: option groups in dialogs and menus (radius 8, equal widths). pill: the tablist shape with radiogroup semantics, for a setting that is not a view switch. menu: the radiogroup shape for use inside a role="menu" (a group of menuitemradio, which is what a menu may contain). onOff: the Off | On control of Configure (spec 5.5), squared with radiogroup semantics, On selected in the accent and Off selected on the track. */
    variant?: "tablist" | "radiogroup" | "pill" | "menu" | "onOff";
    ariaLabel: string;
    className?: string;
    /** false: a disabled option's reason is only its accessible description (the caller shows it as a line) */
    showReasonTooltip?: boolean;
}

/**
 * Segmented control with a roving tab stop: the selected option is the only tab stop,
 * arrow keys, Home and End move and select (spec 3.3 and 4.1).
 */
export function SegmentedControl<T extends string>({ options, value, onChange, variant = "tablist", ariaLabel, className = "", showReasonTooltip = true }: SegmentedControlProps<T>) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const isTablist = variant === "tablist";
    const isPill = variant === "pill";
    const isMenu = variant === "menu";
    const isOnOff = variant === "onOff";
    const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
    const hintId = useId();
    const hintHandlers = (optionValue: string) => {
        const id = `${hintId}-${optionValue}`;
        if (!showReasonTooltip) return { "aria-describedby": `${id}-reason` };
        return {
            "aria-describedby": `${id}-reason`,
            onMouseEnter: () => tooltipStore.open(id),
            onMouseLeave: () => tooltipStore.close(id),
            onFocus: () => tooltipStore.open(id),
            onBlur: () => tooltipStore.close(id),
            // A tap focuses and opens; it never toggles, or the focus that opened it would be undone at once
            onPointerUp: (event: { pointerType: string }) => {
                if (event.pointerType === "touch") tooltipStore.open(id);
            },
        };
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        // Inside a menu the Menu owns the arrow keys and Enter or Space selects (menuitemradio)
        if (isMenu) return;
        const next = getNextIndex(event.key, index, options.length, "horizontal");
        if (next === null) return;
        event.preventDefault();
        // A disabled option takes focus (so its reason is heard) but is never selected
        if (!options[next].isDisabled) onChange(options[next].value);
        refs.current[next]?.focus();
    };

    const isSquared = isTablist || isPill || isOnOff;
    const trackShape = isSquared ? "inline-flex rounded border border-line bg-surface" : "flex w-full rounded-lg bg-track p-[3px]";
    const itemShape = isSquared ? "rounded-[3px] px-4" : "flex-1 justify-center rounded px-3";

    return (
        <div role={isTablist ? "tablist" : isMenu ? "group" : "radiogroup"} aria-label={ariaLabel} className={`${trackShape} ${className}`}>
            {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                    <button
                        key={option.value}
                        ref={(el) => {
                            refs.current[index] = el;
                        }}
                        type="button"
                        role={isTablist ? "tab" : isMenu ? "menuitemradio" : "radio"}
                        aria-selected={isTablist ? isSelected : undefined}
                        aria-checked={isTablist ? undefined : isSelected}
                        aria-disabled={option.isDisabled || undefined}
                        tabIndex={isMenu || index !== selectedIndex ? -1 : 0}
                        onClick={() => {
                            if (!option.isDisabled) onChange(option.value);
                        }}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                        className={`inline-flex h-[30px] items-center gap-1.5 text-[13px] leading-[18px] transition-colors duration-150 max-sm:h-11 ${itemShape} ${
                            isSelected
                                ? isOnOff
                                    ? option.value === "on" ? "bg-accent font-semibold text-accent-ink" : "bg-track font-semibold text-ink"
                                    : isSquared ? "bg-ink font-semibold text-surface" : "bg-surface font-semibold text-ink shadow-thumb"
                                : "font-medium text-body hover:text-ink"
                        } ${(option.isLocked || option.isDisabled) && !isSelected ? "border! border-dashed! border-neutral-fill! text-muted!" : ""} ${option.isDisabled ? "cursor-not-allowed" : ""} ${isOnOff && option.isDisabled ? "opacity-60" : ""}`}
                        {...(option.isDisabled && option.disabledReason ? hintHandlers(option.value) : {})}
                    >
                        {(option.isLocked ? "key" : option.icon) && <Icon name={option.isLocked ? "key" : option.icon!} size={16} />}
                        {option.label}
                        {option.count === null && <span aria-hidden="true" className="ml-0.5 inline-block h-3 w-6 rounded bg-track" />}
                        {typeof option.count === "number" && <span className={`ml-0.5 font-normal tabular-nums ${isSelected && isSquared ? "text-surface/70" : "text-muted"}`}>{option.count}</span>}
                        {option.count === null && <span className="sr-only">, counting</span>}
                        {option.isLocked && <span className="sr-only">, not granted</span>}
                        {option.isDisabled && option.disabledReason && <DisabledReason id={`${hintId}-${option.value}`} reason={option.disabledReason} getAnchor={() => refs.current[index]} />}
                        {option.hasDot && (
                            <>
                                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn-fill" />
                                <span className="sr-only">, needs attention</span>
                            </>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

const HINT_WIDTH = 280;

/** The reason of a disabled option: always in the accessibility tree, shown as the app's one-open tooltip */
function DisabledReason({ id, reason, getAnchor }: { id: string; reason: string; getAnchor: () => HTMLElement | null }) {
    // A boolean snapshot, as `ui/Tag` does, so only this tip re-renders when any tooltip of the app opens or closes
    const isOpen = useSyncExternalStore(tooltipStore.subscribe, () => tooltipStore.getOpenId() === id, () => false);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    // The newest anchor getter, read when the tip opens (a new function every render must not re-run the effect)
    const anchorGetter = useRef(getAnchor);
    useEffect(() => {
        anchorGetter.current = getAnchor;
    });
    const place = useCallback(() => {
        const rect = anchorGetter.current()?.getBoundingClientRect();
        if (rect) setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - HINT_WIDTH - 8)) });
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the position is measured from the DOM when the tip opens
        place();
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            tooltipStore.close(id);
        };
        const onScroll = () => tooltipStore.close(id);
        // A tap elsewhere closes it (a tapped button does not always take focus, so blur cannot be relied on)
        const onPointerDown = (event: PointerEvent) => {
            if (!anchorGetter.current()?.contains(event.target as Node)) tooltipStore.close(id);
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [isOpen, id, place]);

    useEffect(() => () => tooltipStore.close(id), [id]);

    return (
        <>
            {/* hidden: not part of the option's name, still the target of its aria-describedby */}
            <span id={`${id}-reason`} hidden>{reason}</span>
            {isOpen && position && (
                <span
                    aria-hidden="true"
                    style={{ top: position.top, left: position.left, maxWidth: HINT_WIDTH }}
                    className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded border border-line bg-surface px-3 py-2 text-left text-[12px] leading-[18px] font-normal whitespace-normal text-ink shadow-menu"
                >
                    {reason}
                </span>
            )}
        </>
    );
}
