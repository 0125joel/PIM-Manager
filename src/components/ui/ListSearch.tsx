"use client";

interface ListSearchProps {
    value: string;
    onChange: (value: string) => void;
    /** Names what is searched, for the screen reader: "Search role-assignable groups" */
    label: string;
    className?: string;
}

/** The search field above a long folded list: squared, one line, filters as you type. */
export function ListSearch({ value, onChange, label, className = "" }: ListSearchProps) {
    return (
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            placeholder="Search by name"
            className={`h-8 w-full rounded border border-line bg-surface px-2.5 text-[13px] leading-[18px] text-ink placeholder:text-muted sm:max-w-xs max-sm:h-11 ${className}`}
        />
    );
}

/** Case-insensitive match of the query on a name; an empty query matches everything. */
export function matchesQuery(name: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    return q === "" || name.toLowerCase().includes(q);
}
