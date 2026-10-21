"use client";

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60000;

function subscribe(onChange: () => void) {
    const id = setInterval(onChange, MINUTE_MS);
    return () => clearInterval(id);
}

/** The current time, rounded down to the minute: components that show "ends in 30 min" re-render once a minute. */
export function useNow(): Date {
    const minute = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / MINUTE_MS), () => 0);
    return new Date(minute * MINUTE_MS);
}
