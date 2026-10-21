import type { ReactNode } from "react";
import type { AccountMenuContent } from "./AccountMenu";
import { TopBar } from "./TopBar";
import { CompactHeader } from "./CompactHeader";
import { BottomNav } from "./BottomNav";

export type ShellMenu = "top" | "bottom" | null;

export interface ShellFrameProps {
    currentPath: string;
    account: AccountMenuContent;
    isRefreshing: boolean;
    onRefresh: () => void;
    openMenu: ShellMenu;
    onOpenMenuChange: (menu: ShellMenu) => void;
    /** Right-hand dock beside the content (the help panel of NG-19 narrows the page instead of covering it). */
    dock?: ReactNode;
    /** A strip above the bars that scrolls away (the demo banner) */
    banner?: ReactNode;
    children: ReactNode;
}

/**
 * The visual shell, driven entirely by props (no MSAL, no contexts) so the fixture page can render every state.
 * Which bar shows is decided by CSS at 640, never by JavaScript. Stack: bars z-30, menu scrim z-40, menu and
 * toasts z-50, progress line z-100. The bottom navigation comes last in the DOM on purpose.
 */
export function ShellFrame({ currentPath, account, isRefreshing, onRefresh, openMenu, onOpenMenuChange, dock, banner, children }: ShellFrameProps) {
    return (
        <div className="min-h-dvh bg-page text-ink">
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[110] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:text-ink focus:shadow-menu"
            >
                Skip to main content
            </a>
            {banner}
            <TopBar currentPath={currentPath} account={account} isMenuOpen={openMenu === "top"} onMenuOpenChange={(isOpen) => onOpenMenuChange(isOpen ? "top" : null)} />
            <CompactHeader tenantName={account.tenantName} isRefreshing={isRefreshing} onRefresh={onRefresh} />
            <div className="flex">
                <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 max-sm:pb-[calc(72px+env(safe-area-inset-bottom)+1rem)]">
                    {children}
                </main>
                {dock}
            </div>
            <BottomNav currentPath={currentPath} account={account} isMenuOpen={openMenu === "bottom"} onMenuOpenChange={(isOpen) => onOpenMenuChange(isOpen ? "bottom" : null)} />
        </div>
    );
}
