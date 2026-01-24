"use client";

import { useMsal } from "@azure/msal-react";
import { Menu } from "lucide-react";
import { useMobileMenu } from "@/contexts/MobileMenuContext";

export function ConditionalHeader() {
    const { accounts } = useMsal();
    const { toggle } = useMobileMenu();
    const isAuthenticated = accounts.length > 0;

    if (!isAuthenticated) {
        return null;
    }

    return (
        <header className="h-16 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 fixed top-0 left-0 right-0 z-10 flex items-center px-4 md:px-6">
            {/* Mobile hamburger menu */}
            <button
                onClick={toggle}
                className="md:hidden p-2 mr-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Toggle menu"
            >
                <Menu className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
            </button>

            <h1 className="text-lg md:text-xl font-bold text-zinc-900 dark:text-zinc-100">
                Entra ID PIM Manager
            </h1>
        </header>
    );
}
