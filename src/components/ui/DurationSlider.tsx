"use client";

import React, { useCallback, useId, useState } from 'react';
import { parseHours, hoursToIso } from '@/utils/durationUtils';

interface DurationSliderProps {
    value: string; // ISO 8601 duration (e.g., "PT8H")
    onChange: (value: string) => void;
    min?: number; // Min hours (default 0.5)
    max?: number; // Max hours (default 24)
    step?: number; // Step in hours (default 0.5)
    label?: string;
    /** The accessible name when no visible label is shown (`label=""`) */
    ariaLabel?: string;
    disabled?: boolean;
}

/**
 * Format hours for display
 * E.g., 8 -> "8", 1.5 -> "1.5", 0.5 -> "0.5"
 */
function formatHours(hours: number): string {
    return hours % 1 === 0 ? hours.toString() : hours.toFixed(1);
}

export function DurationSlider({
    value,
    onChange,
    min = 1,
    max = 24,
    step = 0.5,
    label = "Activation maximum duration (hours)",
    ariaLabel = "Maximum activation duration",
    disabled = false,
}: DurationSliderProps) {
    const [hours, setHours] = useState(() => parseHours(value));
    const [inputValue, setInputValue] = useState(() => formatHours(parseHours(value)));

    // Sync with external value changes (state adjustment during render)
    const [syncedValue, setSyncedValue] = useState(value);
    if (value !== syncedValue) {
        setSyncedValue(value);
        const newHours = parseHours(value);
        setHours(newHours);
        setInputValue(formatHours(newHours));
    }

    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const newHours = parseFloat(e.target.value);
        setHours(newHours);
        setInputValue(formatHours(newHours));
        onChange(hoursToIso(newHours));
    }, [onChange]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    }, []);

    const handleInputBlur = useCallback(() => {
        // Leaving the field without typing keeps the value as it is (a value below the minimum read from a tenant too)
        if (inputValue === formatHours(hours)) return;
        let newHours = parseFloat(inputValue);

        // Validate and clamp
        if (isNaN(newHours)) {
            newHours = hours; // Revert to current
        } else {
            newHours = Math.max(min, Math.min(max, newHours));
            // Snap to nearest step
            newHours = Math.round(newHours / step) * step;
        }

        setHours(newHours);
        setInputValue(formatHours(newHours));
        onChange(hoursToIso(newHours));
    }, [inputValue, hours, min, max, step, onChange]);

    const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleInputBlur();
        }
    }, [handleInputBlur]);

    // The filled part of the track; a value below the minimum (PT30M read from a tenant) shows an empty track
    const percentage = Math.max(0, Math.min(100, ((hours - min) / (max - min)) * 100));
    const labelId = useId();

    return (
        <div className="space-y-2">
            {label && (
                <label id={labelId} className="text-sm text-body">
                    {label}
                </label>
            )}
            <div className="flex items-center gap-3">
                <div className="relative min-w-0 flex-1">
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={hours}
                        disabled={disabled}
                        aria-labelledby={label ? labelId : undefined}
                        aria-label={label ? undefined : ariaLabel}
                        aria-valuetext={`${formatHours(hours)} hours`}
                        onChange={handleSliderChange}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-track disabled:cursor-not-allowed disabled:opacity-50
                            [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:shadow-thumb
                            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2
                            [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-accent"
                        style={{ background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percentage}%, var(--track) ${percentage}%, var(--track) 100%)` }}
                    />
                </div>
                <div className="flex items-center gap-1.5">
                    <input
                        type="text"
                        inputMode="decimal"
                        value={inputValue}
                        disabled={disabled}
                        aria-label={`${label || ariaLabel}, hours`}
                        onChange={handleInputChange}
                        onBlur={handleInputBlur}
                        onKeyDown={handleInputKeyDown}
                        className="h-[34px] w-14 rounded border border-line bg-surface px-2 text-center text-sm text-ink disabled:opacity-50 max-sm:h-11"
                    />
                    <span className="text-[13px] text-body">hours</span>
                </div>
            </div>
        </div>
    );
}
