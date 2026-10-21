"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Module-level so effects and handlers share one stable implementation
// (mirrors public/theme-init.js, which runs before hydration)
function applyTheme(newTheme: Theme) {
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    if (newTheme === "system") {
        const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
        root.classList.add(systemTheme);
    } else {
        root.classList.add(newTheme);
    }
}

function readSavedTheme(): Theme {
    try {
        const saved = localStorage.getItem("theme");
        return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    } catch {
        return "system";
    }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>("system");

    useEffect(() => {
        // Load theme from localStorage (theme-init.js already applied the class before hydration)
        const savedTheme = readSavedTheme();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of a browser-only preference
        setThemeState(savedTheme);
        applyTheme(savedTheme);
    }, []);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        localStorage.setItem("theme", newTheme);
        applyTheme(newTheme);
    };

    // Listen for system theme changes
    useEffect(() => {
        if (theme !== "system") return;

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleChange = () => applyTheme("system");

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, [theme]);

    return (
        <ThemeContext.Provider value={{ theme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider");
    }
    return context;
}
