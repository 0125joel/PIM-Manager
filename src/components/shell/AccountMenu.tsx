"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@/components/icons/Icon";
import { Menu, MenuDivider, MenuItem } from "@/components/ui/Menu";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EnvironmentSwitcher } from "./EnvironmentSwitcher";
import { isNavActive } from "@/utils/shellNavigation";
import { DOCUMENTATION_URL } from "@/config/constants";
import type { UpdateInfo } from "@/hooks/useUpdateCheck";

export type ThemeChoice = "light" | "dark" | "system";

export interface ShellUser {
    displayName: string;
    userPrincipalName: string;
    initials: string;
}

/** Everything the account menu shows and does; the bars pass it through. */
export interface AccountMenuContent {
    user: ShellUser;
    tenantName: string | null;
    tenantId: string;
    theme: ThemeChoice;
    onThemeChange: (theme: ThemeChoice) => void;
    updateInfo: UpdateInfo | null;
    appVersion: string | undefined;
    hasUnseenWhatsNew: boolean;
    onOpenWhatsNew: () => void;
    onOpenHelp: () => void;
    onSignOut: () => void;
    /** "Exit demo" in the demo; "Sign out" otherwise */
    signOutLabel?: string;
}

interface AccountMenuProps extends AccountMenuContent {
    isOpen: boolean;
    onClose: () => void;
    anchorRef: RefObject<HTMLElement | null>;
}

const THEME_OPTIONS = [
    { value: "light" as const, label: "Light" },
    { value: "dark" as const, label: "Dark" },
    { value: "system" as const, label: "System" },
];

/** The account menu of spec 3.3: a 320 wide menu under the account button, a bottom sheet below 640. */
export function AccountMenu({ isOpen, onClose, anchorRef, user, tenantName, tenantId, theme, onThemeChange, updateInfo, appVersion, hasUnseenWhatsNew, onOpenWhatsNew, onOpenHelp, onSignOut, signOutLabel = "Sign out" }: AccountMenuProps) {
    const pathname = usePathname();
    const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
    const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
    }, []);

    // Choosing an item closes the menu and puts focus back on the account button before the action runs
    // (a modal opened by the action then takes focus itself)
    const select = (action: () => void) => () => {
        onClose();
        anchorRef.current?.focus();
        action();
    };

    const copyTenantId = async () => {
        let next: "copied" | "failed" = "copied";
        try {
            await navigator.clipboard.writeText(tenantId);
        } catch {
            next = "failed";
        }
        setCopyState(next);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopyState("idle"), 1500);
    };

    return (
        <>
        <Menu isOpen={isOpen} onClose={onClose} anchorRef={anchorRef} ariaLabel="Account">
            <div className="flex items-center gap-3 px-3 pb-3 pt-2">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-band text-[13px] font-semibold text-accent" aria-hidden="true">
                    {user.initials}
                </span>
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{user.displayName}</p>
                    <p className="truncate text-xs text-muted">{user.userPrincipalName}</p>
                </div>
            </div>

            <div className="mx-1 rounded-lg bg-page px-3 py-2.5">
                <p className="text-xs text-muted">Tenant</p>
                {tenantName && <p className="text-sm font-semibold text-ink">{tenantName}</p>}
                <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="font-mono text-[11px] leading-4 break-all text-body">{tenantId}</p>
                    <button
                        type="button"
                        role="menuitem"
                        onClick={copyTenantId}
                        aria-label="Copy tenant ID"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-body transition-colors duration-150 hover:text-ink max-sm:h-11 max-sm:w-11"
                    >
                        <Icon name={copyState === "copied" ? "check" : "copy"} size={16} />
                    </button>
                </div>
            </div>

            {/* Below 640 the top bar and its switcher are not there, so the sheet carries it (Configure spec 17) */}
            <div className="px-1 pt-3 sm:hidden">
                <p className="px-2 pb-1.5 text-xs text-muted">Environment</p>
                <EnvironmentSwitcher variant="menu" />
            </div>

            <div className="px-1 pb-1 pt-3">
                <p className="px-2 pb-1.5 text-xs text-muted">Theme</p>
                <SegmentedControl variant="menu" ariaLabel="Theme" options={THEME_OPTIONS} value={theme} onChange={onThemeChange} />
            </div>

            <MenuDivider />
            <MenuItem label="Settings" href="/settings" isCurrent={isNavActive(pathname, "/settings")} onSelect={select(() => undefined)} />
            {/* Below 640 the top bar's Help button is not there, so the menu carries it (spec 3.2) */}
            <div className="sm:hidden">
                <MenuItem label="Help" onSelect={select(onOpenHelp)} />
            </div>
            <MenuItem
                label="What's new"
                onSelect={select(onOpenWhatsNew)}
                trailing={
                    <span className="flex items-center gap-2">
                        {appVersion && <span className="font-mono text-xs text-accent">{appVersion}</span>}
                        {hasUnseenWhatsNew && (
                            <>
                                <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                                <span className="sr-only">new</span>
                            </>
                        )}
                    </span>
                }
            />
            <MenuItem label="Documentation" href={DOCUMENTATION_URL} isExternal onSelect={select(() => undefined)} trailing={<Icon name="external-link" size={16} className="text-body" />} />
            {updateInfo?.hasUpdate && (
                <MenuItem
                    label="Update available"
                    href={updateInfo.releaseUrl}
                    isExternal
                    onSelect={select(() => undefined)}
                    trailing={
                        <span className="font-mono text-xs text-muted">
                            {updateInfo.currentVersion} to {updateInfo.latestVersion}
                        </span>
                    }
                />
            )}

            <MenuDivider />
            <MenuItem label={signOutLabel} onSelect={select(onSignOut)} />
            {appVersion && <p className="px-3 pb-1 pt-2 font-mono text-[11px] text-muted">PIM Manager {appVersion.replace(/^v/, "")}</p>}
        </Menu>
        {/* Outside role="menu" so that assistive technology announces it */}
        <span role="status" className="sr-only">
            {copyState === "copied" ? "Tenant ID copied" : copyState === "failed" ? "Could not copy the tenant ID" : ""}
        </span>
        </>
    );
}
