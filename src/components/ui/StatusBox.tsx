"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";

type StatusVariant = "consent" | "error" | "success" | "warn";

interface StatusBoxProps {
    variant: StatusVariant;
    /** Replaces the icon of the variant */
    icon?: IconName;
    title?: string;
    children: ReactNode;
    /** The grant or retry button. */
    action?: ReactNode;
    /** A failed block stays until it is retried or dismissed; never a toast. */
    onDismiss?: () => void;
    /** Accessible name of the dismiss button when several blocks can show one */
    dismissLabel?: string;
    className?: string;
}

const ICONS: Record<StatusVariant, IconName> = { consent: "key", error: "error", success: "success", warn: "alert" };
const ACCENTS: Partial<Record<StatusVariant, string>> = { error: "var(--danger-text)", success: "var(--success-text)" };

/** The three block states of spec 4.7: no consent, failed, all clear. */
export function StatusBox({ variant, icon, title, children, action, onDismiss, dismissLabel = "Dismiss", className = "" }: StatusBoxProps) {
    const accent = ACCENTS[variant];
    const iconStyle = accent ? ({ "--pim-icon-accent": accent } as CSSProperties) : undefined;

    if (variant === "success") {
        return (
            <p className={`flex items-center gap-2 text-sm text-ink ${className}`} style={iconStyle}>
                <Icon name="success" size={20} />
                <span>{children}</span>
            </p>
        );
    }

    // The box unmounts when it is dismissed or retried: keep keyboard focus in the block it belonged to (a section or the page)
    const keepFocus = (event: MouseEvent<HTMLElement>) => {
        const fallback = (event.target as HTMLElement).closest("button") ? event.currentTarget.closest<HTMLElement>("section, [data-focus-fallback]") : null;
        if (!fallback) return;
        requestAnimationFrame(() => {
            if (document.activeElement === document.body || !document.activeElement) fallback.focus();
        });
    };

    const box = variant === "error" ? "bg-danger-tint border-transparent" : variant === "warn" ? "bg-warn-tint border-transparent" : "bg-surface border-line";
    return (
        <div role={variant === "error" ? "alert" : undefined} onClickCapture={keepFocus} className={`relative rounded border p-4 ${box} ${className}`} style={iconStyle}>
            <div className="flex items-start gap-3">
                <Icon name={icon ?? ICONS[variant]} size={20} className="mt-0.5 text-ink" />
                <div className="min-w-0 flex-1">
                    {title && <p className={`text-sm leading-5 font-medium ${variant === "error" ? "text-danger-text" : "text-ink"}`}>{title}</p>}
                    <div className="mt-1 text-[13px] leading-[18px] text-body">{children}</div>
                    {action && <div className="mt-3">{action}</div>}
                </div>
                {onDismiss && (
                    <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-body hover:text-ink max-sm:h-11 max-sm:w-11">
                        <Icon name="close" size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
