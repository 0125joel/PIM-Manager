/**
 * A page asks the shell to open the help panel at a term (the Preview tag of the Report). The shell owns the panel, so the
 * request travels as a window event instead of a prop through every page.
 */
export const OPEN_HELP_EVENT = "pim:open-help";

export interface OpenHelpDetail {
    /** The term to scroll to and highlight, as the help lists it ("Preview") */
    term?: string;
}

export function requestOpenHelp(detail: OpenHelpDetail): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<OpenHelpDetail>(OPEN_HELP_EVENT, { detail }));
}
