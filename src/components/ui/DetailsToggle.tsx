"use client";

interface DetailsToggleProps {
    isChecked: boolean;
    onChange: (isChecked: boolean) => void;
}

/** "Show more details" in a page head (calm details spec 2.3): a native checkbox with a visible label, 44 px tall below 640 */
export function DetailsToggle({ isChecked, onChange }: DetailsToggleProps) {
    return (
        <label className="inline-flex cursor-pointer items-center gap-2 py-1.5 text-[13px] leading-5 text-ink max-sm:min-h-11 max-sm:w-full" data-tour="details-toggle">
            <input type="checkbox" checked={isChecked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 shrink-0 rounded-[3px] accent-[var(--accent)]" />
            Show more details
        </label>
    );
}
