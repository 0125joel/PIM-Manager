"use client";

import type { ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

interface KeepOnOffProps {
    label: string;
    /** undefined is Keep */
    value: boolean | undefined;
    /** Why the control cannot be used; null when it can */
    disabledReason: string | null;
    onChange: (value: boolean | undefined) => void;
}

/** Keep | Off | On for a switch of several targets (spec 5.6): Keep is the default and writes nothing */
export function KeepOnOff({ label, value, disabledReason, onChange }: KeepOnOffProps) {
    const disabled = disabledReason !== null;
    const reason = disabledReason ?? undefined;
    return (
        <SegmentedControl<"keep" | "off" | "on">
            variant="onOff"
            ariaLabel={label}
            value={value === undefined ? "keep" : value ? "on" : "off"}
            onChange={(next) => { if (next === "keep" || !disabled) onChange(next === "keep" ? undefined : next === "on"); }}
            options={[
                // Keep writes nothing, so it is never disabled
                { value: "keep", label: "Keep" },
                { value: "off", label: "Off", isDisabled: disabled, disabledReason: reason },
                { value: "on", label: "On", isDisabled: disabled, disabledReason: reason },
            ]}
        />
    );
}

interface KeepSetProps {
    label: string;
    isSet: boolean;
    /** Set to cannot be chosen: no selected target has this setting read, or its choices cannot be read */
    setDisabledReason: string | null;
    onKeep: () => void;
    onSet: () => void;
    /** The single-target control, shown under Keep | Set to while Set to is chosen */
    children: ReactNode;
}

/** Keep | Set to for every other control (spec 5.6): Set to reveals the control of one target */
export function KeepSet({ label, isSet, setDisabledReason, onKeep, onSet, children }: KeepSetProps) {
    return (
        <div className="flex flex-col gap-2">
            <SegmentedControl<"keep" | "set">
                variant="onOff"
                ariaLabel={label}
                value={isSet ? "set" : "keep"}
                onChange={(next) => (next === "keep" ? onKeep() : onSet())}
                className="w-fit"
                options={[
                    { value: "keep", label: "Keep" },
                    { value: "set", label: "Set to", isDisabled: setDisabledReason !== null, disabledReason: setDisabledReason ?? undefined },
                ]}
            />
            {isSet && children}
        </div>
    );
}
