"use client";

import type { ReactNode } from "react";
import { useDemoMode } from "@/contexts/DemoModeContext";

interface PortalLinkProps {
    /** null when the object has no portal page: the text is shown as it is */
    href: string | null;
    children: ReactNode;
    /** Named in the text for screen readers: the link opens in a new tab */
    portal: "Entra admin center" | "Azure portal";
    className?: string;
    /** A dimmed row: the link stays grey, as the text around it */
    isMuted?: boolean;
    /** The link stands inside a sentence: underlined at rest too, so it is not told by colour alone */
    isInline?: boolean;
}

/**
 * The look of every link to the Entra admin center or the Azure portal: the accent colour, underlined on hover and focus,
 * and an inset focus outline so a parent with overflow hidden (`truncate`) does not cut it off. Grey in a dimmed row.
 * Inside a sentence it is underlined at rest too, because colour alone does not set it apart from the text next to it.
 */
export function portalLinkClass(isMuted = false, isInline = false): string {
    return `${isMuted ? "text-muted" : "text-accent"} underline-offset-2 ${isInline ? "underline" : "hover:underline focus-visible:underline"} focus-visible:[outline-offset:-2px]`;
}

/** A name that opens its object in an admin portal in a new tab. The demo has no tenant, so it never links. */
export function PortalLink({ href, children, portal, className, isMuted = false, isInline = false }: PortalLinkProps) {
    const isDemo = useDemoMode();
    if (!href || isDemo) return <span className={className}>{children}</span>;
    return (
        // The colour comes from portalLinkClass, not from the caller's className: in the built CSS text-ink and text-muted
        // come after text-accent, so the class order in a string would not decide it
        <a href={href} target="_blank" rel="noopener noreferrer" className={portalLinkClass(isMuted, isInline)}>
            {children}
            <span className="sr-only"> (opens in the {portal} in a new tab)</span>
        </a>
    );
}
