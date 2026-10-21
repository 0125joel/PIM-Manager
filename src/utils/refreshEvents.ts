/**
 * The window event of the shell's Refresh. The shell refreshes every workload; a page with its own state on top of the
 * data (Configure: the access check and the basket's starting values) listens and reads that again too (spec 3.3).
 */
export const SHELL_REFRESH_EVENT = "pim:shell-refresh";

export function announceShellRefresh(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(SHELL_REFRESH_EVENT));
}
