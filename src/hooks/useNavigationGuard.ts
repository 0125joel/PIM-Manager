"use client";

import { useEffect, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

/**
 * Hook that prevents navigation when there are unsaved changes.
 * Works with Next.js App Router by intercepting link clicks and popstate events.
 *
 * Note: Browser back/forward and external navigation are handled by beforeunload.
 * This hook handles internal Next.js Link navigation.
 */
export function useNavigationGuard(
    isDirty: boolean,
    message: string = "You have unsaved changes. Are you sure you want to leave?"
) {
    const router = useRouter();
    const pathname = usePathname();
    const isDirtyRef = useRef(isDirty);

    // Keep ref in sync
    useEffect(() => {
        isDirtyRef.current = isDirty;
    }, [isDirty]);

    // Handle browser back/forward buttons (popstate)
    useEffect(() => {
        const handlePopState = (e: PopStateEvent) => {
            if (isDirtyRef.current) {
                const confirmed = window.confirm(message);
                if (!confirmed) {
                    // Push current URL back to prevent navigation
                    window.history.pushState(null, '', pathname);
                }
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [pathname, message]);

    // Intercept clicks on anchor elements (Link components render as <a>)
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (!isDirtyRef.current) return;

            const target = e.target as HTMLElement;
            const anchor = target.closest('a');

            if (!anchor) return;

            const href = anchor.getAttribute('href');

            // Only intercept internal navigation (starts with / and not current page)
            if (href && href.startsWith('/') && href !== pathname) {
                const confirmed = window.confirm(message);
                if (!confirmed) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };

        // Use capture phase to intercept before Next.js handles it
        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [pathname, message]);

    // Return a function to perform safe navigation (after user confirms)
    const safeNavigate = useCallback((url: string) => {
        if (isDirtyRef.current) {
            const confirmed = window.confirm(message);
            if (!confirmed) return false;
        }
        router.push(url);
        return true;
    }, [router, message]);

    return { safeNavigate };
}
