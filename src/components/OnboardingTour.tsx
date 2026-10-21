"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { TourStep } from "@/config/onboarding";
import { findTourTarget } from "@/utils/tourTarget";

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

/**
 * Measurement for one step. Keyed by step id so a stale rect from the previous
 * step can never be shown while the next target is still being located.
 */
interface Measurement {
    stepId: string;
    rect: TargetRect;
    pos: TooltipPos;
}

const PADDING = 8;
const POLL_INTERVAL = 100;
const POLL_TIMEOUT = 3000;
const VIEWPORT_MARGIN = 16;

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

    // Flip vertically when the preferred side does not fit, so the tooltip never covers the spotlight
    if (position === "bottom" && top + tooltipHeight > window.innerHeight - VIEWPORT_MARGIN) {
        const flipped = targetRect.top - PADDING - gap - tooltipHeight;
        if (flipped >= VIEWPORT_MARGIN) top = flipped;
    } else if (position === "top" && top < VIEWPORT_MARGIN) {
        const flipped = targetRect.top + targetRect.height + PADDING + gap;
        if (flipped + tooltipHeight <= window.innerHeight - VIEWPORT_MARGIN) top = flipped;
    }

    // Clamp into the viewport. On viewports narrower than the tooltip the CSS width
    // (min(360px, 100vw - 32px)) already keeps it inside, so max(...) never goes negative.
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - tooltipWidth - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - tooltipHeight - VIEWPORT_MARGIN);
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop));

    return { top, left };
}

function isOutsideViewport(rect: DOMRect): boolean {
    return rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    return !!target.closest("button, a, input, textarea, select, [role='button']");
}

export function OnboardingTour({ steps, onClose, onComplete }: OnboardingTourProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [currentStep, setCurrentStep] = useState(0);
    const [measurement, setMeasurement] = useState<Measurement | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Scroll the target into view once per step, never from the scroll listener itself
    const scrolledStepRef = useRef<string | null>(null);

    const step = steps[currentStep];
    const totalSteps = steps.length;
    const isLastStep = currentStep === totalSteps - 1;
    const isFirstStep = currentStep === 0;

    // Only trust a measurement that belongs to the current step
    const targetRect = step && measurement?.stepId === step.id ? measurement.rect : null;
    const tooltipPos = step && measurement?.stepId === step.id ? measurement.pos : null;
    const hasTarget = targetRect !== null;

    // Measure and position
    const measureAndPosition = useCallback(() => {
        if (!step) return;
        const el = findTourTarget(step.target);
        if (!el) {
            setMeasurement(null);
            return;
        }

        let rect = el.getBoundingClientRect();
        // An element that is in the DOM but not rendered (display: none, for example the
        // desktop sidebar on a phone) has a zero-size rect: treat it as not found so the
        // tooltip centers instead of spotlighting the top-left corner
        if (rect.width === 0 && rect.height === 0) {
            setMeasurement(null);
            return;
        }
        if (scrolledStepRef.current !== step.id && isOutsideViewport(rect)) {
            scrolledStepRef.current = step.id;
            el.scrollIntoView({ block: "center", inline: "nearest" });
            rect = el.getBoundingClientRect();
        }

        const newRect: TargetRect = {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
        };

        const tooltip = tooltipRef.current;
        const tooltipRect = tooltip?.getBoundingClientRect();
        const pos = computeTooltipPosition(
            newRect,
            step.tooltipPosition ?? "bottom",
            tooltipRect?.width ?? 360,
            tooltipRect?.height ?? 240,
        );
        setMeasurement({ stepId: step.id, rect: newRect, pos });
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
        const el = !needsNavigation ? findTourTarget(step.target) : null;
        if (el) {
            // Element already exists: measure immediately
            requestAnimationFrame(() => {
                measureAndPosition();
                requestAnimationFrame(measureAndPosition);
            });
        } else {
            // Wait for element to appear. While waiting, `targetRect` is null for this
            // step (measurement is keyed by step id), so the tooltip is centered instead
            // of pointing at the previous step's element.
            const startTime = Date.now();
            pollTimerRef.current = setInterval(() => {
                const found = findTourTarget(step.target);
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

    // Reposition on resize/scroll. Re-attach the ResizeObserver once the target
    // exists (it may only appear after navigation or data load).
    useEffect(() => {
        if (!step) return;

        const handleReposition = () => requestAnimationFrame(measureAndPosition);
        window.addEventListener("resize", handleReposition);
        window.addEventListener("scroll", handleReposition, true);

        const el = findTourTarget(step.target);
        if (el) {
            observerRef.current = new ResizeObserver(handleReposition);
            observerRef.current.observe(el);
        }

        return () => {
            window.removeEventListener("resize", handleReposition);
            window.removeEventListener("scroll", handleReposition, true);
            observerRef.current?.disconnect();
        };
    }, [step, measureAndPosition, hasTarget]);

    // Keyboard navigation. Enter is ignored when focus sits on an interactive element,
    // otherwise the focused Next/Skip button fires its own click as well and a step is skipped.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
                return;
            }
            if (isInteractiveTarget(e.target)) return;
            if (e.key === "ArrowRight" || e.key === "Enter") {
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

    // Each step moves focus to its title, so a screen reader announces it and the keys keep working
    useEffect(() => {
        headingRef.current?.focus();
    }, [currentStep]);

    if (!step) return null;

    return (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Tour">
            {/* Click catcher / backdrop. Clicking it does not end the tour: only
                "Skip tour", the close button and Escape do, so a stray click never marks
                the tour as completed. */}
            <div className="absolute inset-0" aria-hidden="true" />

            {/* Spotlight cutout: the scrim token around a 2px accent outline, radius 4 like every control */}
            {targetRect ? (
                <div
                    className="pointer-events-none fixed rounded outline-2 outline-accent"
                    style={{
                        top: targetRect.top - PADDING,
                        left: targetRect.left - PADDING,
                        width: targetRect.width + PADDING * 2,
                        height: targetRect.height + PADDING * 2,
                        boxShadow: "0 0 0 9999px var(--scrim)",
                        transition: "top 300ms ease, left 300ms ease, width 300ms ease, height 300ms ease",
                    }}
                />
            ) : (
                <div className="pointer-events-none fixed inset-0 bg-scrim" />
            )}

            {/* Tooltip: a panel (border, accent edge on top), capped to the viewport on small screens, scrolls internally when tall */}
            <div
                ref={tooltipRef}
                className="fixed max-h-[calc(100vh-32px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded border border-line border-t-[3px] border-t-accent bg-surface shadow-menu"
                style={{
                    top: targetRect && tooltipPos ? tooltipPos.top : "50%",
                    left: targetRect && tooltipPos ? tooltipPos.left : "50%",
                    transform: targetRect && tooltipPos ? "none" : "translate(-50%, -50%)",
                    transition: "top 300ms ease, left 300ms ease",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 px-5 pt-4">
                    <div className="min-w-0">
                        <p aria-hidden="true" className="font-mono text-xs text-accent">tour {currentStep + 1} of {totalSteps}</p>
                        <h3 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="text-[15px] leading-6 font-semibold text-ink">{step.title}</h3>
                        <p className="text-[13px] leading-[18px] text-muted">{step.description}</p>
                    </div>
                    <Button iconOnly icon="close" label="Close tour" size="sm" onClick={onClose} />
                </div>

                <ul className="flex flex-col gap-2 px-5 pb-4 pt-3">
                    {step.guides.map((guide, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm leading-5 text-body">
                            <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-[1px] bg-accent" />
                            {guide.text}
                        </li>
                    ))}
                </ul>

                <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
                    <button type="button" onClick={onClose} className="text-[13px] text-muted underline hover:text-ink">Skip tour</button>
                    <div className="flex items-center gap-2">
                        {!isFirstStep && <Button size="sm" onClick={() => setCurrentStep((prev) => prev - 1)}>Back</Button>}
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                                if (isLastStep) onComplete();
                                else setCurrentStep((prev) => prev + 1);
                            }}
                        >
                            {isLastStep ? "Get started" : "Next"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
