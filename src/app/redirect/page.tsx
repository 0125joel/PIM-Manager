"use client";

import { useEffect, useRef, useState } from "react";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { Logger } from "@/utils/logger";

/**
 * MSAL redirect bridge page.
 *
 * MSAL v5 sends every popup and silent (hidden iframe) authentication response
 * to this page. It broadcasts the response to the window that started the
 * flow and closes itself; for a redirect flow it navigates back to the origin.
 * This page must be registered as the Single-page application redirect URI
 * (https://<host>/redirect) and is rendered outside MsalProvider on purpose.
 */
export default function RedirectBridgePage() {
    const [failed, setFailed] = useState(false);
    const started = useRef(false);

    useEffect(() => {
        // broadcastResponseToMainFrame strips the response from the URL, so a second
        // run (React Strict Mode re-runs effects in development) would fail with empty_response.
        if (started.current) return;
        started.current = true;
        broadcastResponseToMainFrame().catch((error: unknown) => {
            Logger.error("RedirectBridge", "Failed to broadcast the authentication response", error);
            setFailed(true);
        });
    }, []);

    return (
        <main className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-700 dark:bg-black dark:text-zinc-300">
            <p className="text-sm">
                {failed
                    ? "Sign-in could not be completed. Close this window and try again."
                    : "Completing sign-in..."}
            </p>
        </main>
    );
}
