/**
 * Whether this browser tab runs the demo. The demo is a mode of the whole app, not a set of pages: `/demo` sets a flag
 * in the tab's sessionStorage and loads `/dashboard`; every page, link, help text and the tour then work as they do in
 * the real app, against the Contoso tenant. "Exit demo" removes the flag and everything the demo stored, and loads `/`.
 *
 * The flag is read with the browser's own Storage methods, captured before the demo's storage namespace is installed.
 */

export const DEMO_FLAG_KEY = "pim-demo";
/** Every key the demo writes to the real sessionStorage starts with this */
export const DEMO_STORAGE_PREFIX = "pim-demo:";
/** Pages the demo may open first; anything else opens the dashboard */
const DEMO_START_PAGES = ["/dashboard", "/report", "/configure", "/settings", "/help"];

/** A same-origin path to one of the demo's start pages, with an optional query or hash; `//host` and other pages are refused */
export function isDemoStartPath(to: string): boolean {
    if (!to.startsWith("/") || to.startsWith("//")) return false;
    const path = to.split(/[?#]/)[0];
    return DEMO_START_PAGES.some((page) => path === page || path.startsWith(`${page}/`));
}

const nativeGetItem = typeof Storage !== "undefined" ? Storage.prototype.getItem : null;
const nativeSetItem = typeof Storage !== "undefined" ? Storage.prototype.setItem : null;
const nativeRemoveItem = typeof Storage !== "undefined" ? Storage.prototype.removeItem : null;
const nativeKey = typeof Storage !== "undefined" ? Storage.prototype.key : null;
const nativeLength = typeof Storage !== "undefined" ? Object.getOwnPropertyDescriptor(Storage.prototype, "length")?.get ?? null : null;

export const nativeStorage = { getItem: nativeGetItem, setItem: nativeSetItem, removeItem: nativeRemoveItem, key: nativeKey, length: nativeLength };

/** The demo is only on the hosted version (pimmanager.com): a self-hosted build carries its client id in env-config.js */
export function isDemoAvailable(): boolean {
    if (typeof window === "undefined") return false;
    const runtime = (window as Window & { __PIM_CONFIG__?: { clientId?: string } }).__PIM_CONFIG__;
    return !runtime?.clientId;
}

export function isDemoSession(): boolean {
    if (typeof window === "undefined" || !nativeGetItem) return false;
    try {
        return isDemoAvailable() && nativeGetItem.call(window.sessionStorage, DEMO_FLAG_KEY) === "1";
    } catch {
        return false;
    }
}

function clearDemoKeys(): void {
    if (!nativeKey || !nativeLength || !nativeRemoveItem) return;
    const storage = window.sessionStorage;
    const keys: string[] = [];
    const count = nativeLength.call(storage) as number;
    for (let i = 0; i < count; i++) {
        const key = nativeKey.call(storage, i);
        if (key?.startsWith(DEMO_STORAGE_PREFIX)) keys.push(key);
    }
    for (const key of keys) nativeRemoveItem.call(storage, key);
}

/** Starts a fresh demo in this tab and opens `to` with a full page load (the demo runtime installs at page start) */
export function enterDemo(to: string = "/dashboard"): void {
    if (!isDemoAvailable() || !nativeSetItem) return;
    try {
        clearDemoKeys();
        nativeSetItem.call(window.sessionStorage, DEMO_FLAG_KEY, "1");
    } catch {
        return;
    }
    window.location.replace(isDemoStartPath(to) ? to : "/dashboard");
}

/** Leaves the demo: forgets everything it stored and opens `to` with a full page load */
export function exitDemo(to: string = "/"): void {
    try {
        clearDemoKeys();
        nativeRemoveItem?.call(window.sessionStorage, DEMO_FLAG_KEY);
    } catch {
        // Storage blocked: the full load below still leaves the demo when the flag could not be written either
    }
    window.location.assign(to);
}
