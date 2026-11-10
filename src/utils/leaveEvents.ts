/**
 * A navigation from outside a page (the shell's environment switcher) asks the page first. A page with unsaved changes
 * (Configure with a basket, `useLeaveGuard`) cancels the event and asks the admin with its own dialog; the caller
 * navigates only when nobody cancelled. A link click needs none of this: the guard sees it in the document.
 */
export const LEAVE_REQUEST_EVENT = "pim:leave-request";

export interface LeaveRequestDetail {
    href: string;
}

/** True when the caller may navigate now; false when a page guard took the navigation over */
export function requestLeave(href: string, target: EventTarget | undefined = typeof window === "undefined" ? undefined : window): boolean {
    if (!target) return true;
    return target.dispatchEvent(new CustomEvent<LeaveRequestDetail>(LEAVE_REQUEST_EVENT, { detail: { href }, cancelable: true }));
}

/** Navigates to `href` unless a page guard asks first; the guard then navigates itself when the admin leaves */
export function navigateGuarded(href: string, navigate: (href: string) => void, target?: EventTarget): void {
    if (requestLeave(href, target)) navigate(href);
}

/** The listener of a page guard: while there are changes it cancels the request and hands the target to `ask` */
export function createLeaveRequestListener(hasChanges: () => boolean, ask: (href: string) => void): (event: Event) => void {
    return (event: Event) => {
        if (!hasChanges()) return;
        const href = (event as CustomEvent<LeaveRequestDetail>).detail?.href;
        if (!href) return;
        event.preventDefault();
        ask(href);
    };
}
