"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight, ChevronLeft, X, CheckCircle2 } from "lucide-react";
import { TourStep } from "@/config/onboarding";

interface OnboardingTourProps {
    steps: TourStep[];
    onClose: () => void;
    onComplete: () => void;
}

interface TargetRect {
    top: number;
    left: number;
    width: number;
    height: number;
}

interface TooltipPos {
    top: number;
    left: number;
}

const PADDING = 8;
const POLL_INTERVAL = 100;
const POLL_TIMEOUT = 3000;

function computeTooltipPosition(
    targetRect: TargetRect,
    position: "top" | "bottom" | "left" | "right",
    tooltipWidth: number,
    tooltipHeight: number,
): TooltipPos {
    const gap = 12;
    let top = 0;
    let left = 0;

    switch (position) {
        case "bottom":
            top = targetRect.top + targetRect.height + PADDING + gap;
            left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
            break;
        case "top":
            top = targetRect.top - PADDING - gap - tooltipHeight;
            left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
            break;
        case "right":
            top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
            left = targetRect.left + targetRect.width + PADDING + gap;
            break;
        case "left":
            top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
            left = targetRect.left - PADDING - gap - tooltipWidth;
            break;
    }

    const maxLeft = window.innerWidth - tooltipWidth - 16;
    const maxTop = window.innerHeight - tooltipHeight - 16;
    left = Math.max(16, Math.min(left, maxLeft));
    top = Math.max(16, Math.min(top, maxTop));

    return { top, left };
}

export function OnboardingTour({ steps, onClose, onComplete }: OnboardingTourProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [currentStep, setCurrentStep] = useState(0);
    const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
    const [tooltipPos, setTooltipPos] = useState<TooltipPos>({ top: 0, left: 0 });
    const tooltipRef = useRef<HTMLDivElement>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const step = steps[currentStep];
    const totalSteps = steps.length;
    const isLastStep = currentStep === totalSteps - 1;
    const isFirstStep = currentStep === 0;

    // Measure and position
    const measureAndPosition = useCallback(() => {
        if (!step) return;
        const el = document.querySelector(`[data-tour="${step.target}"]`);
        if (!el) {
            setTargetRect(null);
            return;
        }

        const rect = el.getBoundingClientRect();
        const newRect: TargetRect = {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        };
        setTargetRect(newRect);

        const tooltip = tooltipRef.current;
        if (tooltip) {
            const tooltipRect = tooltip.getBoundingClientRect();
            setTooltipPos(computeTooltipPosition(
                newRect,
                step.tooltipPosition ?? "bottom",
                tooltipRect.width,
                tooltipRect.height,
            ));
        }
    }, [step]);

    // Handle navigation and element polling
    useEffect(() => {
        if (!step) return;

        // Clean up any existing poll
        if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
        }

        const needsNavigation = step.page !== pathname;
        if (needsNavigation) {
            router.push(step.page);
        }

        // Poll for element (needed after navigation or if element is loading)
        const el = !needsNavigation ? document.querySelector(`[data-tour="${step.target}"]`) : null;
        if (el) {
            // Element already exists — measure immediately
            requestAnimationFrame(() => {
                measureAndPosition();
                requestAnimationFrame(measureAndPosition);
            });
        } else {
            // Wait for element to appear
            const startTime = Date.now();
            pollTimerRef.current = setInterval(() => {
                const found = document.querySelector(`[data-tour="${step.target}"]`);
                if (found) {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    requestAnimationFrame(() => {
                        measureAndPosition();
                        requestAnimationFrame(measureAndPosition);
                    });
                } else if (Date.now() - startTime > POLL_TIMEOUT) {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                }
            }, POLL_INTERVAL);
        }

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [step, pathname, router, measureAndPosition]);

    // Reposition on resize/scroll
    useEffect(() => {
        if (!step) return;

        const handleReposition = () => requestAnimationFrame(measureAndPosition);
        window.addEventListener("resize", handleReposition);
        window.addEventListener("scroll", handleReposition, true);

        const el = document.querySelector(`[data-tour="${step.target}"]`);
        if (el) {
            observerRef.current = new ResizeObserver(handleReposition);
            observerRef.current.observe(el);
        }

        return () => {
            window.removeEventListener("resize", handleReposition);
            window.removeEventListener("scroll", handleReposition, true);
            observerRef.current?.disconnect();
        };
    }, [step, measureAndPosition]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            } else if (e.key === "ArrowRight" || e.key === "Enter") {
                if (isLastStep) {
                    onComplete();
                } else {
                    setCurrentStep(prev => prev + 1);
                }
            } else if (e.key === "ArrowLeft") {
                setCurrentStep(prev => Math.max(prev - 1, 0));
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLastStep, onClose, onComplete]);

    if (!step) return null;

    const Icon = step.icon;

    return (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Onboarding tour">
            {/* Click catcher / backdrop */}
            <div className="absolute inset-0" onClick={onClose} />

            {/* Spotlight cutout */}
            {targetRect ? (
                <div
                    className="fixed rounded-lg pointer-events-none"
                    style={{
                        top: targetRect.top - PADDING,
                        left: targetRect.left - PADDING,
                        width: targetRect.width + PADDING * 2,
                        height: targetRect.height + PADDING * 2,
                        boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.5)",
                        transition: "top 300ms ease, left 300ms ease, width 300ms ease, height 300ms ease",
                    }}
                />
            ) : (
                <div className="fixed inset-0 bg-black/50 pointer-events-none" />
            )}

            {/* Tooltip */}
            <div
                ref={tooltipRef}
                className="fixed w-[360px] bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
                style={{
                    top: targetRect ? tooltipPos.top : "50%",
                    left: targetRect ? tooltipPos.left : "50%",
                    transform: targetRect ? "none" : "translate(-50%, -50%)",
                    transition: "top 300ms ease, left 300ms ease",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-5 pt-5 pb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                            <Icon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                                {step.title}
                            </h3>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                                {step.description}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1"
                        aria-label="Close tour"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Guidance items */}
                <div className="px-5 pb-4 space-y-2">
                    {step.guides.map((guide, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400 mt-0.5 shrink-0" />
                            <span className="text-sm text-zinc-700 dark:text-zinc-300">
                                {guide.text}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-800/50">
                    <button
                        onClick={onClose}
                        className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                    >
                        Skip tour
                    </button>

                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {currentStep + 1} of {totalSteps}
                    </span>

                    <div className="flex items-center gap-2">
                        {!isFirstStep && (
                            <button
                                onClick={() => setCurrentStep(prev => prev - 1)}
                                className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                Back
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (isLastStep) {
                                    onComplete();
                                } else {
                                    setCurrentStep(prev => prev + 1);
                                }
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                        >
                            {isLastStep ? "Get Started" : "Next"}
                            {!isLastStep && <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
