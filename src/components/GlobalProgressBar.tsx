"use client";

import { useSyncExternalStore } from "react";
import { useLoadingSnapshot } from "@/hooks/useLoadingSnapshot";
import { combineLoadingProgress } from "@/utils/loadingStatus";
import { ProgressLine } from "@/components/ui/ProgressLine";

/**
 * The one progress line for background loading (spec 4.7), combined over both workloads.
 * Selector hooks keep it from re-rendering on data changes in unrelated workloads.
 */
const noopSubscribe = () => () => {};

export function GlobalProgressBar() {
    // Only render client-side to avoid SSR/hydration issues: the server snapshot is
    // always false, the client snapshot is always true, so no effect-driven setState is needed
    const isMounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

    if (!isMounted) {
        return null;
    }

    return <GlobalProgressBarContent />;
}

function GlobalProgressBarContent() {
    const progress = combineLoadingProgress(useLoadingSnapshot());

    if (progress === null) {
        return null;
    }

    // Under the top bar and the compact header, both 56 high (spec 4.7)
    return <ProgressLine value={progress} label="Loading data" className="pointer-events-none fixed top-14 right-0 left-0 z-[100]" />;
}
