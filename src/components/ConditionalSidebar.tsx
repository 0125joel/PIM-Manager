"use client";

import { useMsal } from "@azure/msal-react";
import { Sidebar } from "./Sidebar";

export function ConditionalSidebar() {
    const { accounts } = useMsal();
    const isAuthenticated = accounts.length > 0;

    if (!isAuthenticated) {
        return null;
    }

    return <Sidebar />;
}
