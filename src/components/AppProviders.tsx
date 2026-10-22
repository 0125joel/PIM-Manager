"use client";

// First: in a demo tab this installs the demo's storage and fetch before anything else runs (src/demo/runtime/boot.ts)
import { IS_DEMO } from "@/demo/runtime/boot";
import { ReactNode, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { AuthProvider } from "@/components/AuthProvider";
import { AppShell } from "@/components/shell/AppShell";
import { ProtectedRoute, StartupSpinner } from "@/components/ProtectedRoute";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { UnifiedPimProvider } from "@/contexts/UnifiedPimContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { DemoModeProvider } from "@/contexts/DemoModeContext";
import { GlobalProgressBar } from "@/components/GlobalProgressBar";
import { OnboardingWrapper } from "@/components/OnboardingWrapper";
import { DemoAuthProvider } from "@/demo/runtime/DemoAuthProvider";
import { REDIRECT_BRIDGE_PATH } from "@/config/authConfig";
import { DEMO_ENTRY_PATH } from "@/config/demo";
import { FIXTURES_ENABLED, FIXTURE_PATH_PREFIX } from "@/config/fixtures";

type Runtime = "pending" | "demo" | "live";
const subscribe = () => () => undefined;

/**
 * The provider tree of the application (see the Context Hierarchy in docs/architecture/code-map.md).
 *
 * The MSAL redirect bridge page (/redirect) must render without MsalProvider:
 * MSAL would otherwise consume the authentication response before the bridge
 * can broadcast it to the window that opened the popup.
 *
 * A demo tab gets the same tree with the demo's sign-in instead of MSAL (`src/demo`), so every page runs as it does
 * for a real tenant. Whether a tab is a demo is only known in the browser: the static HTML and the hydration pass
 * render the startup spinner (as MSAL's startup did before), the real tree follows right after.
 */
export function AppProviders({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const runtime = useSyncExternalStore<Runtime>(subscribe, () => (IS_DEMO ? "demo" : "live"), () => "pending");

    // The redirect bridge and the demo entry page render without providers
    if (pathname === REDIRECT_BRIDGE_PATH || pathname === DEMO_ENTRY_PATH) {
        return <>{children}</>;
    }

    // Fixture routes (a NEXT_PUBLIC_FIXTURES=1 build only) render without sign-in, so they can be screenshotted
    if (FIXTURES_ENABLED && pathname?.startsWith(FIXTURE_PATH_PREFIX)) {
        return <ThemeProvider>{children}</ThemeProvider>;
    }

    // The front page is public and indexable: its static HTML carries the real content, not the startup spinner. It
    // renders outside the providers only until hydration has picked the runtime (the next render)
    if (runtime === "pending" && pathname === "/") {
        return <ThemeProvider>{children}</ThemeProvider>;
    }

    if (runtime === "pending") {
        return (
            <ThemeProvider>
                <StartupSpinner />
            </ThemeProvider>
        );
    }

    const Auth = runtime === "demo" ? DemoAuthProvider : AuthProvider;
    const tree = (
        <ThemeProvider>
            <Auth>
                <ProtectedRoute>
                    <UnifiedPimProvider>
                        <ErrorBoundary>
                            <ToastProvider>
                                <GlobalProgressBar />
                                <AppShell>{children}</AppShell>
                                <OnboardingWrapper />
                            </ToastProvider>
                        </ErrorBoundary>
                    </UnifiedPimProvider>
                </ProtectedRoute>
            </Auth>
        </ThemeProvider>
    );
    return runtime === "demo" ? <DemoModeProvider>{tree}</DemoModeProvider> : tree;
}
