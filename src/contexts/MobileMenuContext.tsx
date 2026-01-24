"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface SidebarContextType {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function MobileMenuProvider({ children }: { children: ReactNode }) {
    // Default to true (open) - will adjust on mount for mobile
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        // On mobile, default to closed
        if (window.innerWidth < 768) {
            setIsOpen(false);
        }
    }, []);

    const toggle = () => setIsOpen(prev => !prev);
    const close = () => setIsOpen(false);

    return (
        <SidebarContext.Provider value={{ isOpen, toggle, close }}>
            {children}
        </SidebarContext.Provider>
    );
}

export function useMobileMenu() {
    const context = useContext(SidebarContext);
    if (context === undefined) {
        throw new Error("useMobileMenu must be used within a MobileMenuProvider");
    }
    return context;
}
