"use client";

import { useState, useEffect, useCallback } from "react";
import { Lightbulb, ExternalLink, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import Link from "next/link";

const tips = [
    {
        title: "Use Eligible Assignments",
        description: "Convert permanent assignments to eligible ones. Users activate access only when needed, reducing exposure.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure",
    },
    {
        title: "Enable Approval Workflows",
        description: "Require approval for high-risk role activations. This adds oversight for sensitive operations.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-require-approval-to-activate",
    },
    {
        title: "Set Maximum Activation Duration",
        description: "Limit how long users can keep roles active. Shorter durations reduce risk from compromised sessions.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings",
    },
    {
        title: "Review Access Regularly",
        description: "Set up access reviews to ensure only necessary users retain privileged access over time.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-create-roles-and-resource-roles-review",
    },
    {
        title: "Require MFA for Activations",
        description: "Enforce Azure MFA or Conditional Access for all privileged role activations to verify identity.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings#on-activation-require-azure-mfa",
    },
    {
        title: "Limit Global Administrators",
        description: "Keep fewer than 5 Global Administrators. Use more specific roles like User Administrator or Security Admin.",
        link: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/best-practices",
    },
    {
        title: "Monitor PIM Security Alerts",
        description: "Enable alerts to detect unused roles, excessive activations, and policy violations automatically.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-configure-security-alerts",
    },
    {
        title: "Require Justification",
        description: "Make users provide a reason when activating roles. Creates an audit trail for security investigations.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings",
    },
    {
        title: "Use Authentication Context",
        description: "Apply Conditional Access rules to require specific MFA methods or trusted devices for activation.",
        link: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-resource-roles-configure-role-settings",
    },
    {
        title: "Create Emergency Access Accounts",
        description: "Maintain cloud-only 'break glass' accounts for emergencies when normal admin access is unavailable.",
        link: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access",
    },
];

const ROTATION_INTERVAL = 8000; // 8 seconds
const TRANSITION_DURATION = 300; // 300ms fade

export function ProTip() {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPaused, setIsPaused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);

    const goToNext = useCallback(() => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev + 1) % tips.length);
            setIsTransitioning(false);
        }, TRANSITION_DURATION / 2);
    }, []);

    const goToPrev = useCallback(() => {
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex((prev) => (prev - 1 + tips.length) % tips.length);
            setIsTransitioning(false);
        }, TRANSITION_DURATION / 2);
    }, []);

    const goToIndex = useCallback((index: number) => {
        if (index === currentIndex) return;
        setIsTransitioning(true);
        setTimeout(() => {
            setCurrentIndex(index);
            setIsTransitioning(false);
        }, TRANSITION_DURATION / 2);
    }, [currentIndex]);

    // Auto-rotation
    useEffect(() => {
        if (isPaused || isHovered) return;

        const interval = setInterval(goToNext, ROTATION_INTERVAL);
        return () => clearInterval(interval);
    }, [isPaused, isHovered, goToNext]);

    const tip = tips[currentIndex];

    return (
        <div
            className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-xl px-4 py-3"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            role="region"
            aria-label="Pro Tips carousel"
            aria-live="polite"
        >
            {/* Desktop: single row | Mobile: stacked */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                {/* Row 1 on mobile / Left section on desktop */}
                <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                    {/* Icon + Tip counter */}
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                            <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="text-xs font-medium text-blue-500 dark:text-blue-400 whitespace-nowrap">
                            Tip {currentIndex + 1}/{tips.length}
                        </span>
                    </div>

                    {/* Tip content with fade transition */}
                    <div
                        className={`flex-1 min-w-0 transition-opacity duration-150 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
                    >
                        <p className="text-sm line-clamp-2 sm:min-h-[2.5rem]">
                            <span className="font-medium text-blue-900 dark:text-blue-100">
                                {tip.title}:
                            </span>
                            <span className="text-blue-700 dark:text-blue-300 ml-1.5">
                                {tip.description}
                            </span>
                        </p>
                    </div>
                </div>

                {/* Row 2 on mobile / Right section on desktop */}
                <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                    <Link
                        href={tip.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors whitespace-nowrap"
                    >
                        Learn more
                        <ExternalLink className="h-3 w-3" />
                    </Link>

                    <div className="flex items-center gap-1">
                        <div className="w-px h-4 bg-blue-200 dark:bg-blue-800 hidden sm:block" />
                        <button
                            onClick={goToPrev}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-blue-600 dark:text-blue-400"
                            aria-label="Previous tip"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>

                        {/* Compact dot indicators */}
                        <div className="flex items-center gap-1 mx-1">
                            {tips.map((_, index) => (
                                <button
                                    key={index}
                                    onClick={() => goToIndex(index)}
                                    className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${index === currentIndex
                                        ? 'bg-blue-600 dark:bg-blue-400 w-3'
                                        : 'bg-blue-300 dark:bg-blue-700 hover:bg-blue-400 dark:hover:bg-blue-600'
                                        }`}
                                    aria-label={`Go to tip ${index + 1}`}
                                    aria-current={index === currentIndex ? 'true' : 'false'}
                                />
                            ))}
                        </div>

                        <button
                            onClick={goToNext}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-blue-600 dark:text-blue-400"
                            aria-label="Next tip"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>

                        <button
                            onClick={() => setIsPaused(!isPaused)}
                            className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-blue-600 dark:text-blue-400 ml-1"
                            aria-label={isPaused ? "Start automatic rotation" : "Pause automatic rotation"}
                            aria-pressed={isPaused}
                            title={isPaused ? "Resume" : "Pause"}
                        >
                            {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
