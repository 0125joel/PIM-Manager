"use client";

import { useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { protectedRouteView } from "@/utils/protectedRouteView";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { accounts, inProgress } = useMsal();
    const router = useRouter();
    const pathname = usePathname();
    const view = protectedRouteView({ inProgress, hasAccount: accounts.length > 0, pathname });

    useEffect(() => {
        if (view === "redirect") router.push("/");
    }, [view, router]);

    // A consent or token popup keeps the page (bug 13): the spinner shows only while no account is signed in yet
    if (view === "spinner") return <StartupSpinner />;
    // Not signed in and not on the front page: nothing until the redirect lands
    if (view === "redirect") return null;
    return <>{children}</>;
}

/** What a page shows while sign-in starts (also the static HTML of every page, see AppProviders) */
export function StartupSpinner() {
    return (
        <div className="flex items-center justify-center min-h-screen">
            <Icon name="spinner" size={24} className="text-accent" label="Signing in" />
        </div>
    );
}
