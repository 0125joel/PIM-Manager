import React from 'react';

interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    className?: string;
    size?: "sm" | "md";
}

export function Toggle({ checked, onChange, disabled, className = "", size = "md" }: ToggleProps) {
    const baseWidth = size === "sm" ? "w-8" : "w-11";
    const baseHeight = size === "sm" ? "h-5" : "h-6";
    const translate = size === "sm" ? "translate-x-3.5" : "translate-x-5";
    const dotSize = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
    const dotTop = size === "sm" ? "top-[3px] left-[3px]" : "top-[2px] left-[2px]";

    return (
        <button
            type="button"
            onClick={() => {
                if (!disabled) {
                    onChange(!checked);
                }
            }}
            disabled={disabled}
            className={`
                relative ${baseWidth} ${baseHeight} rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
                ${checked ? 'bg-blue-600' : 'bg-zinc-200 dark:bg-zinc-700'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                ${className}
            `}
        >
            <span
                className={`
                    absolute ${dotTop} bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out
                    ${dotSize}
                    ${checked ? translate : 'translate-x-0'}
                `}
            />
        </button>
    );
}
