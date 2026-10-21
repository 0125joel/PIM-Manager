"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { enterDemo, isDemoAvailable, isDemoStartPath } from "@/demo/runtime/session";

function startPage(to: string | null): string {
    return to && isDemoStartPath(to) ? to : "/dashboard";
}

/**
 * Starts the live demo: the app with the Contoso tenant, no sign-in, nothing sent to Microsoft (src/demo). Only on the
 * hosted version; a self-hosted install shows where the demo is instead.
 */
function DemoEntry() {
    const params = useSearchParams();
    const [isUnavailable, setIsUnavailable] = useState(false);

    useEffect(() => {
        if (!isDemoAvailable()) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- known only in the browser (env-config.js)
            setIsUnavailable(true);
            return;
        }
        enterDemo(startPage(params.get("to")));
    }, [params]);

    if (isUnavailable) {
        return (
            <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-4 text-ink">
                <h1 className="text-xl font-semibold">The live demo is on pimmanager.com</h1>
                <p className="text-sm leading-6 text-body">This installation runs against your own tenant. The demo with the Contoso test tenant is part of the hosted version.</p>
                <p className="flex gap-4 text-sm">
                    <a href="https://pimmanager.com/demo" className="text-accent underline underline-offset-2">Open the demo</a>
                    <Link href="/" className="text-accent underline underline-offset-2">Back to sign in</Link>
                </p>
            </main>
        );
    }

    return (
        <main className="flex min-h-dvh items-center justify-center bg-page">
            <Icon name="spinner" size={24} className="text-accent" label="Starting the demo" />
        </main>
    );
}

export default function DemoPage() {
    return (
        <Suspense fallback={null}>
            <DemoEntry />
        </Suspense>
    );
}
