"use client";

import { useMsal } from "@azure/msal-react";
import { useMobileMenu } from "@/contexts/MobileMenuContext";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
    const { accounts } = useMsal();
    const { isOpen } = useMobileMenu();
    const isAuthenticated = accounts.length > 0;

    if (!isAuthenticated) {
        // No sidebar or padding for landing page
        return <>{children}</>;
    }

    // Content margin follows sidebar state
    return (
        <main className={`mt-16 p-4 md:p-8 transition-[margin] duration-300 ${isOpen ? 'md:ml-64' : 'ml-0'}`}>
            {children}
        </main>
    );
}
