"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
    onClose: (id: string) => void;
}

// Tokens only (spec 1.1): the icon carries the status colour through its accent element, the box is tinted for problems
const toastStyles: Record<ToastType, { box: string; icon: IconName; accent: string }> = {
    success: { box: "bg-surface border-line", icon: "success", accent: "var(--success-text)" },
    error: { box: "bg-danger-tint border-transparent", icon: "error", accent: "var(--danger-text)" },
    warning: { box: "bg-warn-tint border-transparent", icon: "alert", accent: "var(--warn-fill)" },
    info: { box: "bg-surface border-line", icon: "info", accent: "var(--accent)" },
};

/** Errors stay until dismissed; the others close after `duration` and wait while the pointer or focus is on them. */
export function toastAutoCloses(type: ToastType, duration: number): boolean {
    return type !== "error" && duration > 0;
}

export function Toast({ id, type, title, message, duration = 5000, onClose }: ToastProps) {
    const style = toastStyles[type];
    const [isPaused, setIsPaused] = useState(false);

    useEffect(() => {
        if (!toastAutoCloses(type, duration) || isPaused) return;
        const timer = setTimeout(() => onClose(id), duration);
        return () => clearTimeout(timer);
    }, [id, type, duration, isPaused, onClose]);

    return (
        <div
            className={`flex items-start gap-3 rounded border p-4 shadow-menu ${style.box}`}
            style={{ "--pim-icon-accent": style.accent } as CSSProperties}
            role={type === "error" ? "alert" : "status"}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            onFocus={() => setIsPaused(true)}
            onBlur={() => setIsPaused(false)}
        >
            <Icon name={style.icon} size={20} className="mt-0.5 shrink-0 text-ink" />
            <div className="min-w-0 flex-1">
                <p className={`text-sm leading-5 font-medium ${type === "error" ? "text-danger-text" : "text-ink"}`}>{title}</p>
                {message && <p className="mt-1 text-[13px] leading-[18px] text-body">{message}</p>}
            </div>
            <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onClose(id)}
                className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-body transition-colors duration-150 hover:text-ink max-sm:h-11 max-sm:w-11"
            >
                <Icon name="close" size={16} />
            </button>
        </div>
    );
}

export interface ToastContainerProps {
    toasts: Array<Omit<ToastProps, "onClose">>;
    onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full max-sm:left-4 max-sm:max-w-none max-sm:w-auto max-sm:bottom-[calc(72px+1rem+env(safe-area-inset-bottom))]">
            {toasts.map((toast) => (
                <Toast key={toast.id} {...toast} onClose={onClose} />
            ))}
        </div>
    );
}
