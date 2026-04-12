"use client";

import React, { useEffect } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
    onClose: (id: string) => void;
}

const toastStyles: Record<ToastType, { bg: string; icon: React.ElementType; iconColor: string }> = {
    success: {
        bg: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800",
        icon: CheckCircle2,
        iconColor: "text-green-600 dark:text-green-400"
    },
    error: {
        bg: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800",
        icon: XCircle,
        iconColor: "text-red-600 dark:text-red-400"
    },
    warning: {
        bg: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
        icon: AlertTriangle,
        iconColor: "text-amber-600 dark:text-amber-400"
    },
    info: {
        bg: "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800",
        icon: Info,
        iconColor: "text-blue-600 dark:text-blue-400"
    }
};

export function Toast({ id, type, title, message, duration = 5000, onClose }: ToastProps) {
    const style = toastStyles[type];
    const Icon = style.icon;

    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => onClose(id), duration);
            return () => clearTimeout(timer);
        }
    }, [id, duration, onClose]);

    return (
        <div
            className={`
                flex items-start gap-3 p-4 rounded-lg border shadow-lg
                animate-in slide-in-from-right-full duration-300
                ${style.bg}
            `}
            role="alert"
        >
            <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${style.iconColor}`} />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {title}
                </p>
                {message && (
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                        {message}
                    </p>
                )}
            </div>
            <button
                onClick={() => onClose(id)}
                className="flex-shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            >
                <X className="h-4 w-4 text-zinc-400" />
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
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
            {toasts.map((toast) => (
                <Toast key={toast.id} {...toast} onClose={onClose} />
            ))}
        </div>
    );
}
