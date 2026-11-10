"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ViewModeProvider } from "@/contexts/ViewModeContext";
import { AzureDashboard } from "./components/dashboard/AzureDashboard";

export default function AzureDashboardPage() {
    return (
        // The Azure dashboard keeps its own Basic or Advanced choice (dashboard redesign V10)
        <ViewModeProvider storageKey="azure-dashboard-view-mode">
            {/* Before the page can read the URL: the head and the eight cards as skeletons, in the layout of the page */}
            <Suspense fallback={
                <div className="mx-auto flex max-w-[1376px] flex-col gap-4">
                    <Skeleton className="block" width={240} height={34} />
                    <Skeleton className="block" width={360} height={28} />
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                            <Skeleton key={i} className="block w-full" height={92} />
                        ))}
                    </div>
                </div>
            }>
                <AzureDashboard />
            </Suspense>
        </ViewModeProvider>
    );
}
