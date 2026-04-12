
import React from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';

interface WizardStepProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    onNext?: () => void;
    onBack?: () => void;
    nextLabel?: string;
    backLabel?: string;
    isNextDisabled?: boolean;
    isBackDisabled?: boolean;
    isLoading?: boolean;
    showButtons?: boolean;
    customButtons?: React.ReactNode;
}

export function WizardStep({
    title,
    description,
    children,
    onNext,
    onBack,
    nextLabel = "Next",
    backLabel = "Back",
    isNextDisabled = false,
    isBackDisabled = false,
    isLoading = false,
    showButtons = true,
    customButtons
}: WizardStepProps) {
    return (
        <div className="flex flex-col h-full">
            {/* Header - fixed at top */}
            <div className="flex-shrink-0 px-8 pt-8 pb-4">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
                    {description && (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
                    )}
                </div>
            </div>

            {/* Content - scrollable middle section */}
            <div className="flex-1 overflow-y-auto px-8 min-h-0">
                <div className="max-w-5xl mx-auto pb-4">
                    {children}
                </div>
            </div>

            {/* Buttons - fixed at bottom */}
            {showButtons && (
                <div className="flex-shrink-0 px-8 py-6 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700">
                    <div className="flex items-center justify-between max-w-5xl mx-auto">
                        <div>
                            {onBack && (
                                <button
                                    onClick={onBack}
                                    disabled={isBackDisabled || isLoading}
                                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                                >
                                    <ArrowLeft className="w-4 h-4" />
                                    {backLabel}
                                </button>
                            )}
                        </div>

                        <div className="flex gap-3">
                            {customButtons}

                            {onNext && (
                                <button
                                    onClick={onNext}
                                    disabled={isNextDisabled || isLoading}
                                    className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                                >
                                    {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                    {nextLabel}
                                    {!isLoading && <ArrowRight className="w-4 h-4" />}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
