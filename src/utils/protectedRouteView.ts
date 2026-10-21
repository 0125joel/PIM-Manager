/**
 * What `ProtectedRoute` renders (NG-60, spec 20 bug 13). While an account is signed in the page stays, also during an
 * MSAL interaction: a consent or token popup (`acquireToken`) used to swap the page for the spinner, which unmounted
 * Configure and lost its state. The spinner shows while no account exists and MSAL is still busy (start-up, a
 * redirect, sign-in), and during sign-out, which clears the loaded data first (a page left on screen would start
 * loading it again); without an account and with MSAL idle the page is left for the front page.
 */
export type ProtectedRouteView = "page" | "spinner" | "redirect";

export function protectedRouteView(input: { inProgress: string; hasAccount: boolean; pathname: string }): ProtectedRouteView {
    if (input.inProgress === "logout") return "spinner";
    if (input.hasAccount) return "page";
    if (input.inProgress !== "none") return "spinner";
    return input.pathname === "/" ? "page" : "redirect";
}
