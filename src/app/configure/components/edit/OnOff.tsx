"use client";

import { SegmentedControl } from "@/components/ui/SegmentedControl";

interface OnOffProps {
    /** The accessible name: the setting the control changes */
    label: string;
    /** undefined while the value is not read: neither option is chosen (spec 15, never a default) */
    on: boolean | undefined;
    disabled: boolean;
    onChange: (on: boolean) => void;
}

/** The Off | On control of Configure (spec 5.5, 5.10): the `onOff` variant of `SegmentedControl` */
export function OnOff({ label, on, disabled, onChange }: OnOffProps) {
    return (
        <SegmentedControl<"off" | "on" | "">
            variant="onOff"
            ariaLabel={label}
            value={on === undefined ? "" : on ? "on" : "off"}
            onChange={(next) => { if (!disabled && next !== "") onChange(next === "on"); }}
            options={[{ value: "off", label: "Off", isDisabled: disabled }, { value: "on", label: "On", isDisabled: disabled }]}
            showReasonTooltip={false}
        />
    );
}
