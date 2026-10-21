export interface BarListItem {
    label: string;
    value: number;
    color?: string;
}

interface BarListProps {
    items: BarListItem[];
    ariaLabel: string;
    className?: string;
}

/** Own bar list (spec 4.9): label, a bar scaled to the largest value and the number itself next to it. */
export function BarList({ items, ariaLabel, className = "" }: BarListProps) {
    const max = Math.max(0, ...items.map((i) => i.value));
    return (
        <ul aria-label={ariaLabel} className={`flex flex-col gap-2 ${className}`}>
            {items.map((item) => (
                <li key={item.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[13px] leading-[18px] text-ink">
                    <span className="truncate">{item.label}</span>
                    <span aria-hidden="true" className="h-2 rounded-full bg-track">
                        <span className="block h-full rounded-full" style={{ width: max > 0 ? `${(item.value / max) * 100}%` : 0, backgroundColor: item.color ?? "var(--accent)" }} />
                    </span>
                    <span className="font-mono text-body">{item.value}</span>
                </li>
            ))}
        </ul>
    );
}
