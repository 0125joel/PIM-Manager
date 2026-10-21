"use client";

import { useEffect, useState } from "react";

export const SETTINGS_SECTIONS = [
    { id: "permissions", label: "Workloads and permissions" },
    { id: "display", label: "Display" },
    { id: "emergency", label: "Emergency access accounts" },
    { id: "access-model", label: "Access model labels" },
    { id: "advanced", label: "Advanced" },
] as const;

/** Section index (spec 3.6): anchors, the section in view is marked with `aria-current="location"`. */
export function SettingsIndex() {
    const [activeId, setActiveId] = useState<string>(SETTINGS_SECTIONS[0].id);

    useEffect(() => {
        const sections = SETTINGS_SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => el !== null);
        if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (visible) setActiveId(visible.target.id);
            },
            { rootMargin: "-72px 0px -60% 0px" },
        );
        sections.forEach((section) => observer.observe(section));
        return () => observer.disconnect();
    }, []);

    return (
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 lg:flex-col lg:gap-0 lg:border-l lg:border-line">
                {SETTINGS_SECTIONS.map((section) => {
                    const isActive = activeId === section.id;
                    return (
                        <li key={section.id}>
                            <a
                                href={`#${section.id}`}
                                aria-current={isActive ? "location" : undefined}
                                className={`block py-2 text-[13px] leading-[18px] transition-colors duration-150 max-sm:min-h-11 max-sm:py-3 lg:-ml-px lg:border-l-2 lg:py-2.5 lg:pl-3.5 ${
                                    isActive ? "font-medium text-ink lg:border-accent" : "text-body hover:text-ink lg:border-transparent"
                                }`}
                            >
                                {section.label}
                            </a>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
