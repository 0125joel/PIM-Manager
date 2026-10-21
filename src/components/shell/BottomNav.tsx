"use client";

import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { NAV_ITEMS, isNavActive } from "@/utils/shellNavigation";
import { AccountMenu, type AccountMenuContent } from "./AccountMenu";

interface BottomNavProps {
    currentPath: string;
    account: AccountMenuContent;
    isMenuOpen: boolean;
    onMenuOpenChange: (isOpen: boolean) => void;
}

const ITEM = "flex min-h-11 flex-col items-center justify-center gap-0.5 text-[11px] leading-[14px]";

/**
 * Bottom navigation below 640 (spec 3.2), 72 high plus the safe area. It is the last element of the page so that
 * the account sheet and its scrim, which live inside its stacking context, cover the compact header.
 */
export function BottomNav({ currentPath, account, isMenuOpen, onMenuOpenChange }: BottomNavProps) {
    const { user } = account;
    const accountRef = useRef<HTMLButtonElement>(null);

    return (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden">
            <nav aria-label="Main" className="grid h-[72px] grid-cols-4">
                {NAV_ITEMS.map((item) => {
                    const isActive = isNavActive(currentPath, item.path);
                    return (
                        <Link
                            key={item.path}
                            href={item.path}
                            data-tour={item.tourId}
                            aria-current={isActive ? "page" : undefined}
                            className={`${ITEM} ${isActive ? "font-semibold text-accent" : "text-body"}`}
                        >
                            <Icon name={item.icon} size={24} className="h-[22px] w-[22px]" />
                            {item.name}
                        </Link>
                    );
                })}
                <div className="relative">
                    <button
                        ref={accountRef}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        onClick={() => onMenuOpenChange(!isMenuOpen)}
                        className={`${ITEM} h-full w-full ${isMenuOpen ? "font-semibold text-accent" : "text-body"}`}
                    >
                        <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-band text-[10px] font-semibold text-accent">{user.initials}</span>
                        Account
                    </button>
                    <AccountMenu {...account} isOpen={isMenuOpen} onClose={() => onMenuOpenChange(false)} anchorRef={accountRef} />
                </div>
            </nav>
        </div>
    );
}
