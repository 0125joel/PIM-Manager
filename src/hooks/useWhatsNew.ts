"use client";

import { useCallback, useSyncExternalStore } from "react";
import { WHATS_NEW_STORAGE_KEY, isWhatsNewUnseen } from "@/utils/whatsNew";

const CHANGE_EVENT = "pim-whats-new-change";

function subscribe(onChange: () => void) {
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
        window.removeEventListener(CHANGE_EVENT, onChange);
        window.removeEventListener("storage", onChange);
    };
}

function readSeen(): string | null {
    try {
        return localStorage.getItem(WHATS_NEW_STORAGE_KEY);
    } catch {
        return null;
    }
}

/** Version label and the unseen dot of the "What's new" row; `markSeen` stores the running version (per-viewer convenience). */
export function useWhatsNew() {
    const version = process.env.NEXT_PUBLIC_APP_VERSION;
    const seen = useSyncExternalStore(subscribe, readSeen, () => version ?? null);
    const markSeen = useCallback(() => {
        if (!version) return;
        try {
            localStorage.setItem(WHATS_NEW_STORAGE_KEY, version);
        } catch {
            // storage unavailable: the dot simply stays
        }
        window.dispatchEvent(new Event(CHANGE_EVENT));
    }, [version]);

    return { version, hasUnseen: isWhatsNewUnseen(version, seen), markSeen };
}
