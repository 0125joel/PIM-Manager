"use client";

import React from "react";
import { Wand2, Settings, FileSpreadsheet, ArrowRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export type ConfigMode = "wizard" | "manual" | "bulk";

interface ModeColorConfig {
    iconStyle: React.CSSProperties;
    stripeStyle: React.CSSProperties;
    buttonStyle: React.CSSProperties;
    titleClass: string;
}

const modeColors: Record<ConfigMode, ModeColorConfig> = {
    wizard: {
        iconStyle: { background: "linear-gradient(135deg, #a855f7, #9333ea)" },
        stripeStyle: { background: "linear-gradient(to bottom, #a855f7, #6366f1)" },
        buttonStyle: { background: "linear-gradient(to right, #a855f7, #9333ea)" },
        titleClass: "text-purple-600 dark:text-purple-400",
    },
    manual: {
        iconStyle: { background: "linear-gradient(135deg, #3b82f6, #2563eb)" },
        stripeStyle: { background: "linear-gradient(to bottom, #3b82f6, #2563eb)" },
        buttonStyle: { background: "linear-gradient(to right, #3b82f6, #2563eb)" },
        titleClass: "text-blue-600 dark:text-blue-400",
    },
    bulk: {
        iconStyle: { background: "linear-gradient(135deg, #f59e0b, #d97706)" },
        stripeStyle: { background: "linear-gradient(to bottom, #f59e0b, #d97706)" },
        buttonStyle: { background: "linear-gradient(to right, #f59e0b, #d97706)" },
        titleClass: "text-amber-600 dark:text-amber-400",
    },
};

export interface ModeConfig {
    id: ConfigMode;
    title: string;
    description: string;
    icon: React.ElementType;
    recommendedWhen: string;
    status: "stable" | "coming-soon";
}

const modeConfigs: ModeConfig[] = [
    {
        id: "wizard",
        title: "Wizard",
        description: "Step-by-step guided configuration with validation and preview at each stage.",
        icon: Wand2,
        recommendedWhen: "New to PIM configuration, or making changes across multiple roles or groups at once.",
        status: "stable",
    },
    {
        id: "manual",
        title: "Manual",
        description: "Full control over individual role and group settings with auto-load of current configuration.",
        icon: Settings,
        recommendedWhen: "You know what you want to change and want direct access without a guided flow.",
        status: "stable",
    },
    {
        id: "bulk",
        title: "Bulk",
        description: "Upload a CSV to configure multiple roles and groups at once with comparison view.",
        icon: FileSpreadsheet,
        recommendedWhen: "You have an existing export and want to apply changes from a spreadsheet.",
        status: "stable",
    },
];

function WizardStepFlow({ isSelected }: { isSelected: boolean }) {
    const steps = 8;
    return (
        <div className="flex items-center gap-1">
            {Array.from({ length: steps }).map((_, i) => (
                <React.Fragment key={i}>
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isSelected ? "bg-purple-400" : "bg-zinc-300 dark:bg-zinc-600"}`} />
                    {i < steps - 1 && (
                        <div className={`w-3 h-px transition-colors ${isSelected ? "bg-purple-300 dark:bg-purple-700" : "bg-zinc-200 dark:bg-zinc-700"}`} />
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}

interface ModeRowProps {
    config: ModeConfig;
    isSelected: boolean;
    onSelect: () => void;
    disabled?: boolean;
}

function ModeRow({ config, isSelected, onSelect, disabled }: ModeRowProps) {
    const Icon = config.icon;
    const isDisabled = disabled || config.status === "coming-soon";
    const colors = modeColors[config.id];

    return (
        <button
            onClick={onSelect}
            disabled={isDisabled}
            data-tour={`configure-mode-${config.id}`}
            className={`
                relative w-full flex items-start gap-5 p-5 rounded-xl text-left
                transition-all duration-200 overflow-hidden
                border border-zinc-200 dark:border-zinc-700
                ${isSelected
                    ? "bg-zinc-50 dark:bg-zinc-800/80 shadow-md"
                    : "bg-white dark:bg-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:shadow-sm"
                }
                ${isDisabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
            `}
        >
            {/* Gradient left stripe on selection */}
            {isSelected && (
                <div
                    className="absolute inset-y-0 left-0 w-1 rounded-l-xl"
                    style={colors.stripeStyle}
                />
            )}

            {/* Gradient icon */}
            <div
                className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm"
                style={colors.iconStyle}
            >
                <Icon className="h-5 w-5" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1.5">
                    <h3 className={`text-base font-semibold transition-colors ${isSelected ? colors.titleClass : "text-zinc-900 dark:text-zinc-100"}`}>
                        {config.title}
                    </h3>
                    {config.id === "wizard" && <WizardStepFlow isSelected={isSelected} />}
                    {config.status === "coming-soon" && <Badge label="Coming Soon" variant="neutral" />}
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                    {config.description}
                </p>
                <div>
                    <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">
                        Recommended when
                    </span>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-0.5">
                        {config.recommendedWhen}
                    </p>
                </div>
            </div>
        </button>
    );
}

interface ModeSelectorProps {
    selectedMode: ConfigMode | null;
    onModeSelect: (mode: ConfigMode) => void;
    onContinue: () => void;
    disabled?: boolean;
}

export function ModeSelector({ selectedMode, onModeSelect, onContinue, disabled }: ModeSelectorProps) {
    const selectedConfig = modeConfigs.find(m => m.id === selectedMode);
    const canContinue = !!selectedMode && !disabled && selectedConfig?.status !== "coming-soon";

    return (
        <div className="max-w-2xl mx-auto" data-tour="configure-modes">
            {/* Info banner */}
            <div className="flex items-start gap-3 p-4 mb-6 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400">
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-zinc-400" />
                <span>
                    Write permissions are only requested when you continue, not on login.
                    Your own admin account also needs the right PIM roles to make changes (e.g.{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Privileged Role Administrator</span>).
                </span>
            </div>

            {/* Mode rows */}
            <div className="space-y-3 mb-6">
                {modeConfigs.map((config) => (
                    <ModeRow
                        key={config.id}
                        config={config}
                        isSelected={selectedMode === config.id}
                        onSelect={() => onModeSelect(config.id)}
                        disabled={disabled}
                    />
                ))}
            </div>

            {/* Continue button */}
            <div className="flex justify-end">
                <button
                    onClick={onContinue}
                    disabled={!canContinue}
                    className="flex items-center gap-2 px-6 py-3 rounded-lg font-medium text-white transition-all duration-200 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 hover:shadow-xl"
                    style={canContinue && selectedConfig ? selectedConfig && modeColors[selectedConfig.id].buttonStyle : { background: "#a1a1aa" }}
                >
                    <span>Continue with {selectedConfig?.title ?? "Selected Mode"}</span>
                    <ArrowRight className="h-5 w-5" />
                </button>
            </div>
        </div>
    );
}
