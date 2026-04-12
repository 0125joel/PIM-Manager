"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { parseHours, hoursToIso } from '@/utils/durationUtils';

interface DurationSliderProps {
    value: string; // ISO 8601 duration (e.g., "PT8H")
    onChange: (value: string) => void;
    min?: number; // Min hours (default 0.5)
    max?: number; // Max hours (default 24)
    step?: number; // Step in hours (default 0.5)
    label?: string;
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
    min = 0.5,
    max = 24,
    step = 0.5,
    label = "Activation maximum duration (hours)"
}: DurationSliderProps) {
    const [hours, setHours] = useState(() => parseHours(value));
    const [inputValue, setInputValue] = useState(() => formatHours(parseHours(value)));

    // Sync with external value changes
    useEffect(() => {
        const newHours = parseHours(value);
        setHours(newHours);
        setInputValue(formatHours(newHours));
    }, [value]);

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

    // Calculate slider background gradient for visual feedback
    const percentage = ((hours - min) / (max - min)) * 100;

    return (
        <div className="space-y-2">
            {label && (
                <label className="text-sm text-zinc-600 dark:text-zinc-400">
                    {label}
                </label>
            )}
            <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                    <input
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={hours}
                        onChange={handleSliderChange}
                        className="w-full h-2 rounded-full appearance-none cursor-pointer
                            bg-zinc-200 dark:bg-zinc-700
                            [&::-webkit-slider-thumb]:appearance-none
                            [&::-webkit-slider-thumb]:w-4
                            [&::-webkit-slider-thumb]:h-4
                            [&::-webkit-slider-thumb]:rounded-full
                            [&::-webkit-slider-thumb]:bg-blue-500
                            [&::-webkit-slider-thumb]:cursor-pointer
                            [&::-webkit-slider-thumb]:shadow-md
                            [&::-webkit-slider-thumb]:transition-transform
                            [&::-webkit-slider-thumb]:hover:scale-110
                            [&::-moz-range-thumb]:w-4
                            [&::-moz-range-thumb]:h-4
                            [&::-moz-range-thumb]:rounded-full
                            [&::-moz-range-thumb]:bg-blue-500
                            [&::-moz-range-thumb]:border-0
                            [&::-moz-range-thumb]:cursor-pointer"
                        style={{
                            background: `linear-gradient(to right,
                                rgb(59, 130, 246) 0%,
                                rgb(59, 130, 246) ${percentage}%,
                                rgb(228, 228, 231) ${percentage}%,
                                rgb(228, 228, 231) 100%)`
                        }}
                    />
                </div>
                <div className="flex items-center gap-1">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onBlur={handleInputBlur}
                        onKeyDown={handleInputKeyDown}
                        className="w-16 px-2 py-1 text-sm text-center
                            bg-white dark:bg-zinc-700
                            border border-zinc-300 dark:border-zinc-600
                            rounded-md
                            focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">hours</span>
                </div>
            </div>
        </div>
    );
}

export default DurationSlider;
