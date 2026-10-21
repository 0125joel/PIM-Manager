"use client";

import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { NAV_ITEMS, isNavActive } from "@/utils/shellNavigation";
import { AccountMenu, type AccountMenuContent } from "./AccountMenu";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher";

interface TopBarProps {
    currentPath: string;
    account: AccountMenuContent;
    isMenuOpen: boolean;
    onMenuOpenChange: (isOpen: boolean) => void;
}

const BAR_BUTTON = "inline-flex h-8 w-8 items-center justify-center rounded text-body transition-colors duration-150 hover:bg-page hover:text-ink";

/** Top bar from 640 up (spec 3.1): wordmark, the environment switcher (Configure spec 17), navigation, actions; tighter below 768 so 640 fits. */
export function TopBar({ currentPath, account, isMenuOpen, onMenuOpenChange }: TopBarProps) {
    const { user, tenantName } = account;
    const accountRef = useRef<HTMLButtonElement>(null);

    return (
        <header className="sticky top-0 z-30 hidden h-14 items-center border-b border-line bg-surface px-4 sm:flex md:px-6 lg:px-8">
            <Link href="/dashboard" data-tour="app-title" className="text-base font-semibold text-ink">
                PIM Manager
            </Link>
            <div className="ml-2 md:ml-4">
                <EnvironmentSwitcher variant="bar" />
            </div>
            <span className="mx-2 h-6 w-px bg-line md:mx-4" aria-hidden="true" />
            <nav aria-label="Main" className="flex h-full items-stretch gap-4 md:gap-6">
                {NAV_ITEMS.map((item) => {
                    const isActive = isNavActive(currentPath, item.path);
                    return (
                        <Link
                            key={item.path}
                            href={item.path}
                            data-tour={item.tourId}
                            aria-current={isActive ? "page" : undefined}
                            className={`relative flex items-center text-sm transition-colors duration-150 ${isActive ? "font-medium text-ink" : "text-body hover:text-ink"}`}
                        >
                            {item.name}
                            {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" aria-hidden="true" />}
                        </Link>
                    );
                })}
            </nav>

            <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={account.onOpenHelp} data-tour="sidebar-help" aria-label="Help" className={BAR_BUTTON}>
                    <Icon name="help" size={20} />
                </button>
                <Link href="/settings" aria-label="Settings" aria-current={isNavActive(currentPath, "/settings") ? "page" : undefined} className={`${BAR_BUTTON} ${isNavActive(currentPath, "/settings") ? "bg-page text-ink" : ""}`}>
                    <Icon name="settings" size={20} />
                </Link>
                <div className="relative ml-2">
                    <button
                        ref={accountRef}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        aria-label={`Account menu, ${user.displayName}${tenantName ? `, ${tenantName}` : ""}`}
                        onClick={() => onMenuOpenChange(!isMenuOpen)}
                        className="inline-flex h-9 items-center gap-2 rounded border border-line bg-surface pl-1.5 pr-3 text-[13px] text-ink transition-colors duration-150 hover:bg-page"
                    >
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-band text-[11px] font-semibold text-accent">{user.initials}</span>
                        {tenantName && <span className="hidden max-w-[160px] truncate font-medium lg:inline">{tenantName}</span>}
                        <Icon name="chevron-down" size={16} className="text-body" />
                    </button>
                    <AccountMenu {...account} isOpen={isMenuOpen} onClose={() => onMenuOpenChange(false)} anchorRef={accountRef} />
                </div>
            </div>
        </header>
    );
}
