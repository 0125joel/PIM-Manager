"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { getNextMenuIndex } from "@/utils/rovingFocus";

interface MenuProps {
    isOpen: boolean;
    onClose: () => void;
    /** The button that opened the menu: Escape returns focus to it and a click on it is not "outside". */
    anchorRef: RefObject<HTMLElement | null>;
    ariaLabel: string;
    children: ReactNode;
    /** Placement classes, for example "right-0 top-full mt-2". The parent must be relative. */
    className?: string;
    /** Width in px above the compact breakpoint (default 320). Below 640 the menu is a bottom sheet. */
    width?: number;
}

// A segmented control inside the menu joins the arrow key order through its one tab stop (the selected option)
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="radio"][tabindex="0"]';

/** The focusable items that are visible (a row can be hidden by a breakpoint). */
function getItems(menu: HTMLElement | null): HTMLElement[] {
    return Array.from(menu?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []).filter((el) => el.getClientRects().length > 0);
}

/**
 * Popover menu, a bottom sheet on compact screens (spec 3.3). role="menu" with menuitem children,
 * arrow keys and Home/End move between items, Escape and a click outside close it.
 */
export function Menu({ isOpen, onClose, anchorRef, ariaLabel, children, className = "right-0 top-full mt-2", width = 320 }: MenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Callers often pass an inline onClose; keep it in a ref so the effects below run on isOpen only
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (isOpen) getItems(menuRef.current)[0]?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
            onCloseRef.current();
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [isOpen, anchorRef]);

    if (!isOpen) return null;

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
            anchorRef.current?.focus();
            return;
        }
        if (event.key === "Tab") {
            // Focus moves on naturally; the menu does not stay open behind it
            onClose();
            return;
        }
        // Home and End belong to a segmented control (radiogroup) inside the menu while it has focus
        if ((event.key === "Home" || event.key === "End") && (event.target as HTMLElement).closest('[role="radiogroup"]')) return;
        const items = getItems(menuRef.current);
        const next = getNextMenuIndex(event.key, items.indexOf(document.activeElement as HTMLElement), items.length);
        if (next === null) return;
        event.preventDefault();
        items[next]?.focus();
    };

    return (
        <>
            <div aria-hidden="true" className="fixed inset-0 z-40 bg-scrim sm:hidden" onClick={onClose} />
            <div
                ref={menuRef}
                role="menu"
                aria-label={ariaLabel}
                onKeyDown={handleKeyDown}
                style={{ width: `min(${width}px, calc(100vw - 32px))` }}
                className={`absolute z-50 rounded-[10px] border border-line bg-surface p-2 shadow-menu max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:mt-0 max-sm:!w-full max-sm:max-h-[calc(100dvh-4rem)] max-sm:overflow-y-auto max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:p-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] ${className}`}
            >
                {children}
            </div>
        </>
    );
}

interface MenuItemProps {
    label: string;
    icon?: IconName;
    /** Right aligned content such as a version or an external link icon. */
    trailing?: ReactNode;
    onSelect?: () => void;
    href?: string;
    isExternal?: boolean;
    /** menuitemradio rows (a choice among several, such as the theme) show their state with `isChecked`. */
    isChecked?: boolean;
    /** The page this row links to is the current one. */
    isCurrent?: boolean;
}

const ITEM_CLASS =
    "flex min-h-8 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] leading-[18px] text-ink hover:bg-page max-sm:min-h-11";

export function MenuItem({ label, icon, trailing, onSelect, href, isExternal = false, isChecked, isCurrent }: MenuItemProps) {
    const role = isChecked === undefined ? "menuitem" : "menuitemradio";
    const content = (
        <>
            {icon && <Icon name={icon} size={16} className="text-body" />}
            <span className="flex-1">{label}</span>
            {trailing}
        </>
    );

    // An internal path is a client side navigation (no reload, loaded data stays); anything else is a plain link
    if (href && href.startsWith("/")) {
        return (
            <Link role={role} aria-checked={isChecked} aria-current={isCurrent ? "page" : undefined} href={href} onClick={onSelect} className={ITEM_CLASS}>
                {content}
            </Link>
        );
    }

    if (href) {
        return (
            <a role={role} aria-checked={isChecked} href={href} onClick={onSelect} className={ITEM_CLASS} {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                {content}
            </a>
        );
    }
    return (
        <button type="button" role={role} aria-checked={isChecked} onClick={onSelect} className={`${ITEM_CLASS} ${isChecked ? "font-semibold" : ""}`}>
            {content}
        </button>
    );
}

export function MenuDivider() {
    return <hr role="separator" className="my-2 border-line" />;
}
