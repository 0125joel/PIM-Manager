"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { FileText, LogOut, HelpCircle, LayoutDashboard, X, Settings } from "lucide-react";
import { HelpModal } from "./HelpModal";
import { SettingsModal } from "./SettingsModal";
import { usePimData } from "@/hooks/usePimData";
import { useMobileMenu } from "@/contexts/MobileMenuContext";
import { ThemeToggle } from "./ThemeToggle";

export function Sidebar() {
    const pathname = usePathname();
    const { instance } = useMsal();
    const { clearData } = usePimData();
    const { isOpen, close } = useMobileMenu();
    const [showHelp, setShowHelp] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const handleLogout = () => {
        // Clear all PIM related data from storage
        try {
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('pim_')) {
                    sessionStorage.removeItem(key);
                }
            });
        } catch (e) {
            console.warn("Failed to clear storage", e);
        }

        clearData();
        instance.logoutRedirect({
            postLogoutRedirectUri: window.location.origin,
        });
    };

    const navItems = [
        { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
        { name: "Report", path: "/report", icon: FileText },
    ];

    const handleNavClick = () => {
        close(); // Close mobile menu when navigating
    };

    return (
        <>
            {/* Desktop Sidebar */}
            <div className="hidden md:flex w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 fixed left-0 top-16 bottom-0 flex-col">
                <nav className="p-4 space-y-2 flex-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    }`}
                            >
                                <Icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                    <ThemeToggle />
                    <button
                        onClick={() => setShowSettings(true)}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <Settings className="h-5 w-5" />
                        Settings
                    </button>
                    <button
                        onClick={() => setShowHelp(true)}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                        <HelpCircle className="h-5 w-5" />
                        Help
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <LogOut className="h-5 w-5" />
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/50 z-40"
                    onClick={close}
                />
            )}

            {/* Mobile Sidebar */}
            <div className={`md:hidden fixed left-0 top-0 bottom-0 w-64 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
                    <span className="font-semibold text-zinc-900 dark:text-zinc-100">Menu</span>
                    <button onClick={close} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <X className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                    </button>
                </div>

                <nav className="p-4 space-y-2">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = pathname === item.path;
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                onClick={handleNavClick}
                                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium"
                                    : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    }`}
                            >
                                <Icon className="h-5 w-5" />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3 bg-white dark:bg-zinc-900">
                    <ThemeToggle />
                    <button
                        onClick={() => { setShowSettings(true); close(); }}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    >
                        <Settings className="h-5 w-5" />
                        Settings
                    </button>
                    <button
                        onClick={() => { setShowHelp(true); close(); }}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                        <HelpCircle className="h-5 w-5" />
                        Help
                    </button>
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                        <LogOut className="h-5 w-5" />
                        Sign Out
                    </button>
                </div>
            </div>

            <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </>
    );
}
