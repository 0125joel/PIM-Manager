"use client";

import { useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { useRouter, usePathname } from "next/navigation";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { accounts, inProgress } = useMsal();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (inProgress === "none" && accounts.length === 0 && pathname !== "/") {
            router.push("/");
        }
    }, [accounts, inProgress, router, pathname]);

    // While checking auth status or if not authenticated (and redirecting), show nothing or a loader
    if (inProgress !== "none") {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    // If not authenticated and not on home page, don't render children (useEffect will redirect)
    if (accounts.length === 0 && pathname !== "/") {
        return null;
    }

    return <>{children}</>;
}
