"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { getCurrentTourPage, useCurrentTourPage } from "@/hooks/useTourPage";
import { splitEmphasis } from "@/utils/emphasis";
import { findStepTarget } from "@/utils/tourTarget";
import { nextShownStep, shownPosition, type RunStep, type TourEnd } from "@/utils/tourProgress";

interface OnboardingTourProps {
    steps: RunStep[];
    /** Started by itself (tour spec 4.2): offers Turn off tours and never switches a view */
    isAuto: boolean;
    onEnd: (endedBy: TourEnd, shownKeys: ReadonlySet<string>) => void;
    onTurnOff: () => void;
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
 * Measurement for one step. Keyed by the step's key so a stale rect from the previous
 * step can never be shown while the next target is still being located.
 */
interface Measurement {
    stepKey: string;
    rect: TargetRect;
    pos: TooltipPos;
}

const PADDING = 8;
const POLL_INTERVAL = 100;
const VIEWPORT_MARGIN = 16;
/** How long a target may stay away once the page is ready, and in all (a page that never gets ready) (tour spec 4.5) */
const TARGET_TIMEOUT = 1500;
const MAX_WAIT = 15000;

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

    // Flip vertically when the preferred side does not fit, so the tooltip never covers the spotlight. When neither side
    // fits (a block taller than the screen, scrolled to its top), the tooltip goes to the bottom of the screen, clear of the heading
    const bottomOfScreen = window.innerHeight - VIEWPORT_MARGIN - tooltipHeight;
    if (position === "bottom" && top + tooltipHeight > window.innerHeight - VIEWPORT_MARGIN) {
        const flipped = targetRect.top - PADDING - gap - tooltipHeight;
        top = flipped >= VIEWPORT_MARGIN ? flipped : bottomOfScreen;
    } else if (position === "top" && top < VIEWPORT_MARGIN) {
        const flipped = targetRect.top + targetRect.height + PADDING + gap;
        top = flipped + tooltipHeight <= window.innerHeight - VIEWPORT_MARGIN ? flipped : bottomOfScreen;
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

/** A tour text with names of the UI in bold and values inside a block in italic, so a sentence reads at a glance */
function TourText({ text }: { text: string }) {
    return splitEmphasis(text).map((part, i) => {
        if (part.emphasis === "bold") return <span key={i} className="font-semibold text-ink">{part.text}</span>;
        if (part.emphasis === "italic") return <em key={i} className="text-ink">{part.text}</em>;
        return part.text;
    });
}

export function OnboardingTour({ steps, isAuto, onEnd, onTurnOff }: OnboardingTourProps) {
    const router = useRouter();
    const pathname = usePathname();
    const tourPage = useCurrentTourPage();
    const [currentStep, setCurrentStep] = useState(0);
    const [missing, setMissing] = useState<ReadonlySet<number>>(() => new Set());
    const [measurement, setMeasurement] = useState<Measurement | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);
    const observerRef = useRef<ResizeObserver | null>(null);
    const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Scroll the target into view once per step, never from the scroll listener itself
    const scrolledStepRef = useRef<string | null>(null);
    // The direction of the last move, so a step without a target is passed in the same direction
    const directionRef = useRef<1 | -1>(1);
    // The steps that were on screen, for what counts as seen at the end (tour spec 4.3)
    const shownKeysRef = useRef<Set<string>>(new Set());
    // A run started by hand may switch the dashboard view; the view it found is put back at the end (tour spec 4.4)
    const restoreViewRef = useRef<{ view: "basic" | "advanced"; setView: (view: "basic" | "advanced") => void } | null>(null);

    const step = steps[currentStep];
    const totalSteps = steps.length;
    const { position, total } = shownPosition(currentStep, missing, totalSteps);
    const previousStep = nextShownStep(currentStep, -1, missing, totalSteps);
    const isLastStep = nextShownStep(currentStep, 1, missing, totalSteps) === null;

    // Only trust a measurement that belongs to the current step
    const targetRect = step && measurement?.stepKey === step.key ? measurement.rect : null;
    const tooltipPos = step && measurement?.stepKey === step.key ? measurement.pos : null;
    const hasTarget = targetRect !== null;
    // While the next target is located, the spotlight stays on the last one, so it moves from there instead of the corner
    const spotlightRect = targetRect ?? measurement?.rect ?? null;
    const lastTooltipPos = tooltipPos ?? measurement?.pos ?? null;

    const restoreView = useCallback(() => {
        const restore = restoreViewRef.current;
        restoreViewRef.current = null;
        if (restore) restore.setView(restore.view);
    }, []);

    const end = useCallback((endedBy: TourEnd) => {
        restoreView();
        onEnd(endedBy, shownKeysRef.current);
    }, [onEnd, restoreView]);

    const turnOff = useCallback(() => {
        restoreView();
        onTurnOff();
    }, [onTurnOff, restoreView]);

    const go = useCallback((direction: 1 | -1) => {
        directionRef.current = direction;
        const next = nextShownStep(currentStep, direction, missing, totalSteps);
        if (next !== null) setCurrentStep(next);
        else if (direction === 1) end("complete");
    }, [currentStep, missing, totalSteps, end]);

    // Measure and position
    const measureAndPosition = useCallback(() => {
        if (!step) return;
        // Not found: the last measurement stays, so the spotlight waits where it was (tour spec 4.5 passes the step)
        const el = findStepTarget(step);
        if (!el) return;

        let rect = el.getBoundingClientRect();
        // An element that is in the DOM but not rendered (display: none, for example the
        // desktop sidebar on a phone) has a zero-size rect: treat it as not found
        if (rect.width === 0 && rect.height === 0) return;
        if (scrolledStepRef.current !== step.key && isOutsideViewport(rect)) {
            scrolledStepRef.current = step.key;
            // A block taller than half the screen scrolls to its top, so its heading stays in view; the tooltip then sits below it
            el.scrollIntoView({ block: rect.height > window.innerHeight / 2 ? "start" : "center", inline: "nearest" });
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
        shownKeysRef.current.add(step.key);
        setMeasurement({ stepKey: step.key, rect: newRect, pos });
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

        const el = !needsNavigation ? findStepTarget(step) : null;
        if (el) {
            // Element already exists: measure immediately
            requestAnimationFrame(() => {
                measureAndPosition();
                requestAnimationFrame(measureAndPosition);
            });
        } else {
            // Wait for the element. While waiting the tooltip is hidden over the scrim. A target that does not come once
            // the page is ready is passed in the direction of the last move (tour spec 4.5).
            const startedAt = Date.now();
            let readySince = startedAt;
            pollTimerRef.current = setInterval(() => {
                const found = findStepTarget(step);
                if (found) {
                    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                    pollTimerRef.current = null;
                    requestAnimationFrame(() => {
                        measureAndPosition();
                        requestAnimationFrame(measureAndPosition);
                    });
                    return;
                }
                const now = Date.now();
                const page = getCurrentTourPage();
                if (page !== null && !page.isReady) readySince = now;
                if (now - readySince <= TARGET_TIMEOUT && now - startedAt <= MAX_WAIT) return;
                if (pollTimerRef.current) clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
                const nextMissing = new Set(missing);
                nextMissing.add(currentStep);
                setMissing(nextMissing);
                const next = nextShownStep(currentStep, directionRef.current, nextMissing, totalSteps)
                    ?? (directionRef.current === -1 ? nextShownStep(currentStep, 1, nextMissing, totalSteps) : null);
                if (next !== null) setCurrentStep(next);
                else end("complete");
            }, POLL_INTERVAL);
        }

        return () => {
            if (pollTimerRef.current) {
                clearInterval(pollTimerRef.current);
                pollTimerRef.current = null;
            }
        };
    }, [step, pathname, router, measureAndPosition, missing, currentStep, totalSteps, end]);

    // A run started by hand shows the view its step explains, on the page that is open (tour spec 4.4)
    useEffect(() => {
        if (isAuto || !step?.view || !tourPage?.setView || step.page !== pathname || tourPage.view === step.view) return;
        if (restoreViewRef.current === null && tourPage.view) restoreViewRef.current = { view: tourPage.view, setView: tourPage.setView };
        tourPage.setView(step.view);
    }, [isAuto, step, pathname, tourPage]);

    // Reposition on resize/scroll. Re-attach the ResizeObserver once the target
    // exists (it may only appear after navigation or data load).
    useEffect(() => {
        if (!step) return;

        const handleReposition = () => requestAnimationFrame(measureAndPosition);
        window.addEventListener("resize", handleReposition);
        window.addEventListener("scroll", handleReposition, true);

        const el = findStepTarget(step);
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
                end("stop");
                return;
            }
            if (isInteractiveTarget(e.target)) return;
            if (e.key === "ArrowRight" || e.key === "Enter") go(1);
            else if (e.key === "ArrowLeft") go(-1);
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [end, go]);

    // Each step moves focus to its title once it is on screen, so a screen reader announces it and the keys keep working
    useEffect(() => {
        if (hasTarget) headingRef.current?.focus();
    }, [currentStep, hasTarget]);

    if (!step) return null;

    return (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Tour">
            {/* Click catcher / backdrop. Clicking it does not end the tour: only
                "Skip tour", the close button and Escape do, so a stray click never marks
                the tour as completed. */}
            <div className="absolute inset-0" aria-hidden="true" />

            {/* Spotlight cutout: the scrim token around a 2px accent outline, radius 4 like every control */}
            {/* Own keys, so the full scrim never turns into the spotlight and animates in from the top-left corner */}
            {spotlightRect ? (
                <div
                    key="spotlight"
                    className="pointer-events-none fixed rounded outline-2 outline-accent"
                    style={{
                        top: spotlightRect.top - PADDING,
                        left: spotlightRect.left - PADDING,
                        width: spotlightRect.width + PADDING * 2,
                        height: spotlightRect.height + PADDING * 2,
                        boxShadow: "0 0 0 9999px var(--scrim)",
                        transition: "top 300ms ease, left 300ms ease, width 300ms ease, height 300ms ease",
                    }}
                />
            ) : (
                <div key="scrim" className="pointer-events-none fixed inset-0 bg-scrim" />
            )}

            {/* Tooltip: a panel (border, accent edge on top), capped to the viewport on small screens, scrolls internally when tall */}
            <div
                ref={tooltipRef}
                className="fixed max-h-[calc(100vh-32px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded border border-line border-t-[3px] border-t-accent bg-surface shadow-menu"
                style={{
                    top: lastTooltipPos ? lastTooltipPos.top : "50%",
                    left: lastTooltipPos ? lastTooltipPos.left : "50%",
                    transform: lastTooltipPos ? "none" : "translate(-50%, -50%)",
                    transition: "top 300ms ease, left 300ms ease",
                    visibility: targetRect && tooltipPos ? "visible" : "hidden",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 px-5 pt-4">
                    <div className="min-w-0">
                        <p aria-hidden="true" className="font-mono text-xs text-accent">tour {position} of {total}</p>
                        <h3 ref={headingRef} tabIndex={-1} style={{ outline: "none" }} className="text-[15px] leading-6 font-semibold text-ink">{step.title}</h3>
                        <p className="text-[13px] leading-[18px] text-muted"><TourText text={step.description} /></p>
                    </div>
                    <Button iconOnly icon="close" label="Close tour" size="sm" onClick={() => end("stop")} />
                </div>

                <ul className="flex flex-col gap-2 px-5 pb-4 pt-3">
                    {step.guides.map((guide, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm leading-5 text-body">
                            <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-[1px] bg-accent" />
                            <span><TourText text={guide.text} /></span>
                        </li>
                    ))}
                </ul>

                <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
                    <div className="flex flex-col items-start gap-1">
                        <button type="button" onClick={() => end("stop")} className="text-[13px] text-muted underline hover:text-ink">Skip tour</button>
                        {isAuto && <button type="button" onClick={turnOff} className="text-[13px] text-muted underline hover:text-ink">Turn off tours</button>}
                    </div>
                    <div className="flex items-center gap-2">
                        {previousStep !== null && <Button size="sm" onClick={() => go(-1)}>Back</Button>}
                        <Button size="sm" variant="primary" onClick={() => go(1)}>
                            {isLastStep ? "Get started" : "Next"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
