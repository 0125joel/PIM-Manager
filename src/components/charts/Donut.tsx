import type { ReactNode } from "react";

export interface DonutSegment {
    label: string;
    value: number;
    /** A colour token such as `var(--accent)` */
    color: string;
}

interface DonutProps {
    segments: DonutSegment[];
    /** States every segment with its number; the donut is an image, its legend is the real control (spec 4.10) */
    ariaLabel: string;
    /** Centre text, for example the permanent count and two caption lines */
    children?: ReactNode;
    /** Draws a plain empty ring: values still loading */
    isEmpty?: boolean;
    className?: string;
}

const RADIUS = 52;
const STROKE = 14;
const GAP = 3;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Offsets and lengths of the arcs along the circle, a 3 unit gap between segments when more than one has a value. */
export function getDonutArcs(values: number[]): { start: number; length: number }[] {
    const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
    const nonZero = values.filter((v) => v > 0).length;
    if (total <= 0) return values.map(() => ({ start: 0, length: 0 }));
    const gap = nonZero > 1 ? GAP : 0;
    let offset = 0;
    return values.map((v) => {
        const share = (Math.max(0, v) / total) * CIRCUMFERENCE;
        const arc = { start: offset, length: v > 0 ? Math.max(0, share - gap) : 0 };
        offset += share;
        return arc;
    });
}

/** Own SVG donut (spec 4.9): r=52 in a 120 viewBox, stroke 14, empty ring in `track`. */
export function Donut({ segments, ariaLabel, children, isEmpty = false, className = "" }: DonutProps) {
    const arcs = getDonutArcs(segments.map((s) => s.value));
    const hasValue = !isEmpty && arcs.some((a) => a.length > 0);

    return (
        <div role="img" aria-label={ariaLabel} className={`relative h-[100px] w-[100px] sm:h-[150px] sm:w-[150px] shrink-0 ${className}`}>
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
                <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--track)" strokeWidth={STROKE} />
                {hasValue &&
                    segments.map((segment, i) =>
                        arcs[i].length > 0 ? (
                            <circle
                                key={segment.label}
                                cx="60"
                                cy="60"
                                r={RADIUS}
                                fill="none"
                                stroke={segment.color}
                                strokeWidth={STROKE}
                                strokeDasharray={`${arcs[i].length} ${CIRCUMFERENCE - arcs[i].length}`}
                                strokeDashoffset={-arcs[i].start}
                            />
                        ) : null,
                    )}
            </svg>
            {children && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>}
        </div>
    );
}
