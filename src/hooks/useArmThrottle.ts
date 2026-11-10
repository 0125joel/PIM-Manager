"use client";

import { useSyncExternalStore } from "react";
import { armRateLimiter } from "@/utils/rateLimiter";

/** Re-renders when a 429 starts or extends the ARM pause, and once more when the pause is over */
function subscribe(onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
        if (timer !== undefined) clearTimeout(timer);
        const wait = armRateLimiter.getBlockedUntil() - Date.now();
        timer = wait > 0 ? setTimeout(onChange, wait + 50) : undefined;
    };
    const stop = armRateLimiter.subscribe(() => {
        schedule();
        onChange();
    });
    schedule();
    return () => {
        stop();
        if (timer !== undefined) clearTimeout(timer);
    };
}

/** True while every ARM request waits after a 429 (Azure spec 7: "Azure is limiting requests") */
export function useArmThrottle(): boolean {
    return useSyncExternalStore(subscribe, () => Date.now() < armRateLimiter.getBlockedUntil(), () => false);
}
