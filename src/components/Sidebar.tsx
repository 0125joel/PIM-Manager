"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { FileText, LogOut, HelpCircle, LayoutDashboard, X, Settings, RefreshCw, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { HelpModal } from "./HelpModal";
import { SettingsModal } from "./SettingsModal";
import { usePimData } from "@/hooks/usePimData";
import { useMobileMenu } from "@/contexts/MobileMenuContext";
import { ThemeToggle } from "./ThemeToggle";
import { Logger } from "@/utils/logger";

export function Sidebar() {
    const pathname = usePathname();
    const { instance } = useMsal();
    const { clearData } = usePimData();
    const { isOpen, close } = useMobileMenu();
    const [showHelp, setShowHelp] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const updateInfo = useUpdateCheck();

    const handleLogout = () => {
        // Clear all PIM related data from storage
        try {
            Object.keys(sessionStorage).forEach(key => {
                if (key.startsWith('pim_')) {
                    sessionStorage.removeItem(key);
                }
            });
        } catch (e) {
            Logger.warn("Sidebar", "Failed to clear storage", e);
        }

        clearData();
        instance.logoutRedirect({
            postLogoutRedirectUri: window.location.origin,
        });
    };

    const navItems = [
        { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard, tourId: "nav-dashboard" },
        { name: "Report", path: "/report", icon: FileText, tourId: "nav-report" },
        { name: "Configure", path: "/configure", icon: Settings, tourId: "nav-configure" },
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
                                data-tour={item.tourId}
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
                    {updateInfo?.hasUpdate && (
                        <a
                            href={updateInfo.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Update available</span>
                                <ExternalLink className="h-3 w-3 text-amber-500 dark:text-amber-400 ml-auto" />
                            </div>
                            <div className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                                <div>Current: {updateInfo.currentVersion} · {updateInfo.currentReleaseDate ? format(new Date(updateInfo.currentReleaseDate), "MMM d, yyyy") : "unknown"}</div>
                                <div>Latest:&nbsp;&nbsp;{updateInfo.latestVersion} · {format(new Date(updateInfo.latestReleaseDate), "MMM d, yyyy")}</div>
                            </div>
                        </a>
                    )}

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
                    {updateInfo?.hasUpdate && (
                        <a
                            href={updateInfo.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                <span className="text-xs font-medium text-amber-800 dark:text-amber-300">Update available</span>
                                <ExternalLink className="h-3 w-3 text-amber-500 dark:text-amber-400 ml-auto" />
                            </div>
                            <div className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                                <div>Current: {updateInfo.currentVersion} · {updateInfo.currentReleaseDate ? format(new Date(updateInfo.currentReleaseDate), "MMM d, yyyy") : "unknown"}</div>
                                <div>Latest:&nbsp;&nbsp;{updateInfo.latestVersion} · {format(new Date(updateInfo.latestReleaseDate), "MMM d, yyyy")}</div>
                            </div>
                        </a>
                    )}

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
