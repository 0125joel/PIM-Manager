"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface MultiSelectOption {
    value: string;
    label: string;
    indent?: boolean; // For nested options like specific CA contexts
}

interface MultiSelectDropdownProps {
    options: MultiSelectOption[];
    selectedValues: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    label?: string;
}

export function MultiSelectDropdown({
    options,
    selectedValues,
    onChange,
    placeholder = "All",
    label
}: MultiSelectDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleToggle = (value: string) => {
        if (selectedValues.includes(value)) {
            onChange(selectedValues.filter(v => v !== value));
        } else {
            onChange([...selectedValues, value]);
        }
    };

    // Generate display text
    const getDisplayText = () => {
        if (selectedValues.length === 0) return placeholder;
        if (selectedValues.length === 1) {
            const option = options.find(o => o.value === selectedValues[0]);
            return option?.label || selectedValues[0];
        }
        return `${selectedValues.length} selected`;
    };

    return (
        <div ref={dropdownRef} className="relative">
            {label && (
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {label}
                </label>
            )}
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-left flex items-center justify-between hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
            >
                <span className={selectedValues.length === 0 ? "text-zinc-500" : "text-zinc-900 dark:text-zinc-100"}>
                    {getDisplayText()}
                </span>
                <ChevronDown className={`h-4 w-4 text-zinc-500 transition-transform ${isOpen ? "rotate-180" : ""}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg max-h-60 overflow-auto">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => handleToggle(option.value)}
                            className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${option.indent ? "pl-6" : ""
                                }`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedValues.includes(option.value)
                                    ? "bg-blue-600 border-blue-600"
                                    : "border-zinc-300 dark:border-zinc-600"
                                }`}>
                                {selectedValues.includes(option.value) && (
                                    <Check className="h-3 w-3 text-white" />
                                )}
                            </div>
                            <span className="text-zinc-900 dark:text-zinc-100">{option.label}</span>
                        </button>
                    ))}
                    {options.length === 0 && (
                        <div className="px-3 py-2 text-sm text-zinc-500">No options available</div>
                    )}
                </div>
            )}
        </div>
    );
}
