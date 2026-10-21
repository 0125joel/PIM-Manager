"use client";

import { Icon } from "@/components/icons/Icon";

interface ToggleChipProps {
    kind: "toggle";
    label: string;
    isOn: boolean;
    onToggle: () => void;
    /** The last counted workload cannot be switched off */
    isDisabled?: boolean;
    /** Said on hover and to screen readers when the chip is disabled */
    disabledReason?: string;
    className?: string;
}

interface LockedChipProps {
    kind: "locked";
    label: string;
    /** Selecting a locked chip starts consent. */
    onSelect: () => void;
    className?: string;
}

interface FilterChipProps {
    kind: "filter";
    label: string;
    onRemove: () => void;
    /** The Report's chips are tinted with the accent; the dashboard filter bar keeps the plain look */
    tone?: "accent";
    className?: string;
}

export type ChipProps = ToggleChipProps | LockedChipProps | FilterChipProps;

const BASE = "inline-flex h-7 items-center gap-2 rounded border px-2.5 text-[12px] leading-4 transition-colors duration-150 max-sm:min-h-11";

export function Chip(props: ChipProps) {
    const extra = props.className ?? "";

    if (props.kind === "toggle") {
        return (
            <button
                type="button"
                aria-pressed={props.isOn}
                aria-disabled={props.isDisabled || undefined}
                title={props.isDisabled ? props.disabledReason : undefined}
                onClick={props.isDisabled ? undefined : props.onToggle}
                className={`${BASE} border-line ${props.isOn ? "bg-surface text-ink" : "bg-transparent text-muted"} ${props.isDisabled ? "cursor-default" : ""} ${extra}`}
            >
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-[2px] ${props.isOn ? "bg-accent" : "border-[1.5px] border-muted"}`} />
                {props.label}
                {props.isDisabled && props.disabledReason && <span className="sr-only">, {props.disabledReason}</span>}
            </button>
        );
    }

    if (props.kind === "locked") {
        return (
            <button
                type="button"
                onClick={props.onSelect}
                className={`${BASE} border-dashed border-neutral-fill bg-transparent text-muted hover:text-ink ${extra}`}
            >
                <Icon name="key" size={16} />
                {props.label}
                <span className="sr-only"> (not granted, select to grant access)</span>
            </button>
        );
    }

    return (
        <span className={`${BASE} pr-1 text-ink ${props.tone === "accent" ? "border-accent bg-accent-tint" : "border-line bg-surface"} ${extra}`}>
            {props.label}
            <button
                type="button"
                onClick={props.onRemove}
                aria-label={`Remove filter: ${props.label}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-body hover:text-ink max-sm:h-11 max-sm:w-11"
            >
                <Icon name="close" size={16} />
            </button>
        </span>
    );
}
