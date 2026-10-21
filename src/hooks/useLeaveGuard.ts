"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export interface LeaveGuard {
    /** True while the leave dialog asks */
    isAsking: boolean;
    /** Runs `leave` now when nothing waits, otherwise asks first */
    request: (leave: () => void) => void;
    confirm: () => void;
    cancel: () => void;
}

/**
 * Leaving the Configure page or a mode with changes asks first (spec 10.1), with the page's own dialog instead of
 * `window.confirm`: a click on a same-origin link that leaves the current path or the open mode, and every `request()` (Leave {mode},
 * another mode). Closing or reloading the tab gets the browser's own question (`beforeunload`). The browser Back is
 * left to the router: the changes stay in the basket (sessionStorage) and the basket bar shows them.
 */
export function useLeaveGuard(changeCount: number): LeaveGuard {
    const router = useRouter();
    const pathname = usePathname();
    const pending = useRef<(() => void) | null>(null);
    const [isAsking, setIsAsking] = useState(false);
    const count = useRef(changeCount);
    useEffect(() => {
        count.current = changeCount;
    }, [changeCount]);

    const request = useCallback((leave: () => void) => {
        if (count.current === 0) {
            leave();
            return;
        }
        pending.current = leave;
        setIsAsking(true);
    }, []);

    const confirm = useCallback(() => {
        const leave = pending.current;
        pending.current = null;
        setIsAsking(false);
        leave?.();
    }, []);

    const cancel = useCallback(() => {
        pending.current = null;
        setIsAsking(false);
    }, []);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (count.current === 0 || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
            const url = new URL(anchor.href, window.location.href);
            if (url.origin !== window.location.origin) return;
            // The same page is left too when the link leaves the open mode (the navigation's "Configure" from a mode)
            const modeOf = (search: string) => new URLSearchParams(search).get("mode");
            if (url.pathname === pathname && modeOf(url.search) === modeOf(window.location.search)) return;
            event.preventDefault();
            event.stopPropagation();
            const href = `${url.pathname}${url.search}${url.hash}`;
            pending.current = () => router.push(href);
            setIsAsking(true);
        };
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (count.current === 0) return;
            event.preventDefault();
            event.returnValue = "";
        };
        document.addEventListener("click", onClick, true);
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => {
            document.removeEventListener("click", onClick, true);
            window.removeEventListener("beforeunload", onBeforeUnload);
        };
    }, [pathname, router]);

    return { isAsking, request, confirm, cancel };
}
