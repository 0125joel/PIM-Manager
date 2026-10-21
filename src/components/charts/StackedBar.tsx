export interface StackedBarSegment {
    label: string;
    value: number;
    color: string;
}

interface StackedBarProps {
    segments: StackedBarSegment[];
    ariaLabel: string;
    className?: string;
}

/** Own SVG-free stacked horizontal bar (spec 4.9): widths from the values, empty bar in `track`. */
export function StackedBar({ segments, ariaLabel, className = "" }: StackedBarProps) {
    const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    return (
        <div role="img" aria-label={ariaLabel} className={`flex h-3 w-full overflow-hidden rounded-full bg-track ${className}`}>
            {total > 0 &&
                segments.map((s) =>
                    s.value > 0 ? <span key={s.label} className="h-full border-r-2 border-surface last:border-r-0" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} /> : null,
                )}
        </div>
    );
}
