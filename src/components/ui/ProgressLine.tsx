"use client";

interface ProgressLineProps {
    /** 0 to 100, or null when the total is not known. */
    value: number | null;
    /** Accessible name, for example "Loading role settings". */
    label: string;
    className?: string;
}

/** The 3px line under the top bar while data loads in the background (spec 4.7). */
export function ProgressLine({ value, label, className = "" }: ProgressLineProps) {
    const clamped = value === null ? null : Math.min(100, Math.max(0, value));
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clamped === null ? undefined : Math.round(clamped)}
            className={`h-[3px] w-full bg-track ${className}`}
        >
            <div
                className={`h-full bg-accent motion-safe:transition-[width] motion-safe:duration-150 motion-safe:ease-out ${clamped === null ? "w-1/3 motion-safe:animate-pulse" : ""}`}
                style={clamped === null ? undefined : { width: `${clamped}%` }}
            />
        </div>
    );
}
