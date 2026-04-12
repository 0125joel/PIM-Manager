"use client";

import React, { createContext, useContext, useCallback, useState, useMemo } from "react";
import { ToastContainer, ToastType } from "@/components/ui/Toast";

interface ToastData {
    id: string;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number;
}

interface ToastContextType {
    addToast: (toast: Omit<ToastData, "id">) => string;
    removeToast: (id: string) => void;
    toasts: ToastData[];
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastData[]>([]);

    const addToast = useCallback((toast: Omit<ToastData, "id">) => {
        const id = `toast-${++toastId}`;
        setToasts((prev) => [...prev, { ...toast, id }]);
        return id;
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const contextValue = useMemo(() => ({
        addToast,
        removeToast,
        toasts
    }), [addToast, removeToast, toasts]);

    return (
        <ToastContext.Provider value={contextValue}>
            {children}
            <ToastContainer toasts={toasts} onClose={removeToast} />
        </ToastContext.Provider>
    );
}

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error("useToast must be used within a ToastProvider");
    }
    return context;
}

// Convenience hooks for common toast patterns
export function useToastActions() {
    const { addToast } = useToast();

    return useMemo(() => ({
        success: (title: string, message?: string) =>
            addToast({ type: "success", title, message }),
        error: (title: string, message?: string) =>
            addToast({ type: "error", title, message, duration: 8000 }),
        warning: (title: string, message?: string) =>
            addToast({ type: "warning", title, message }),
        info: (title: string, message?: string) =>
            addToast({ type: "info", title, message })
    }), [addToast]);
}
