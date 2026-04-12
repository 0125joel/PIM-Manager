
import React from 'react';
import { WizardStep } from '@/hooks/useWizardState';
import { Check, Circle, ArrowDown } from 'lucide-react';

interface WizardTimelineProps {
    steps: WizardStep[];
    currentStepIndex: number;
    onStepClick: (index: number) => void;
}

export function WizardTimeline({ steps, currentStepIndex, onStepClick }: WizardTimelineProps) {
    return (
        <div className="w-64 flex-shrink-0 hidden lg:block bg-zinc-50 dark:bg-zinc-800/50 border-r border-zinc-200 dark:border-zinc-700 p-6 h-full min-h-[600px]">
            <div className="relative">
                {/* Vertical line connector */}
                <div className="absolute left-3.5 top-4 bottom-4 w-0.5 bg-zinc-200 dark:bg-zinc-700" />

                <div className="space-y-8 relative">
                    {steps.map((step, index) => {
                        const isActive = index === currentStepIndex;
                        const isCompleted = step.isCompleted;
                        const isFuture = !isActive && !isCompleted;
                        const canClick = step.canNavigate;

                        return (
                            <div key={step.id} className="relative flex items-start gap-4">
                                <button
                                    onClick={() => canClick && onStepClick(index)}
                                    disabled={!canClick}
                                    className={`
                                        relative z-10 flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors
                                        ${isActive
                                            ? "bg-blue-600 border-blue-600 text-white"
                                            : isCompleted
                                                ? "bg-green-600 border-green-600 text-white"
                                                : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-400"
                                        }
                                        ${canClick ? "cursor-pointer hover:ring-2 hover:ring-offset-2 ring-blue-500" : "cursor-default"}
                                    `}
                                >
                                    {isCompleted ? (
                                        <Check className="w-4 h-4" />
                                    ) : (
                                        <span className="text-xs font-bold">{index + 1}</span>
                                    )}
                                </button>
                                <div className="pt-1">
                                    <h4 className={`text-sm font-medium leading-none ${isActive ? "text-blue-600 dark:text-blue-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                                        {step.title}
                                    </h4>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                        {step.description}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
