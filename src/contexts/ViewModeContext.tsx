"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { VIEW_MODE_STORAGE_KEY } from "@/utils/viewModePreference";

export type ViewMode = "basic" | "advanced";

interface ViewModeContextType {
    viewMode: ViewMode;
    setViewMode: (mode: ViewMode) => void;
    isBasic: boolean;
    isAdvanced: boolean;
}

const ViewModeContext = createContext<ViewModeContextType | undefined>(undefined);

const STORAGE_KEY = VIEW_MODE_STORAGE_KEY;

interface ViewModeProviderProps {
    children: ReactNode;
}

export function ViewModeProvider({ children }: ViewModeProviderProps) {
    // Default to 'basic' mode
    const [viewMode, setViewModeState] = useState<ViewMode>("basic");
    const [isHydrated, setIsHydrated] = useState(false);

    // Load from localStorage on mount (after hydration, so the pre-rendered HTML matches)
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === "basic" || stored === "advanced") {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe one-time read of localStorage
            setViewModeState(stored);
        }
        setIsHydrated(true);
    }, []);

    // Persist to localStorage on change
    const setViewMode = (mode: ViewMode) => {
        setViewModeState(mode);
        localStorage.setItem(STORAGE_KEY, mode);
    };

    // Convenience booleans
    const isBasic = viewMode === "basic";
    const isAdvanced = viewMode === "advanced";

    // Prevent flash of wrong content during hydration
    if (!isHydrated) {
        return null;
    }

    return (
        <ViewModeContext.Provider value={{ viewMode, setViewMode, isBasic, isAdvanced }}>
            {children}
        </ViewModeContext.Provider>
    );
}

export function useViewMode() {
    const context = useContext(ViewModeContext);
    if (context === undefined) {
        throw new Error('useViewMode must be used within a ViewModeProvider');
    }
    return context;
}
