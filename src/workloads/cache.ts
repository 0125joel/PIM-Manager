import { Logger } from "@/utils/logger";
import type { WorkloadCache, WorkloadContent } from "./types";

// SessionStorage is a client-side cache, exposed in DevTools and to any XSS script, and Base64 is no encryption.
// The data is stored as plain JSON: a client-side cache does not need to be encrypted.

export interface SessionCacheOptions<T, X> {
    dataKey: string;
    timestampKey: string;
    /** What is saved next to the items; `encode` returns null when there is nothing worth saving */
    extras?: {
        key: string;
        encode: (extras: X) => unknown | null;
        decode: (raw: unknown | null) => X;
    };
    /** Shown when the full data does not fit in storage (definitions only, for example) */
    minimal?: (data: T[]) => T[];
    /** Where the cache lives; the browser's sessionStorage unless a test passes its own */
    storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
    /** For the log lines */
    label: string;
    /**
     * Binds the cache to one account: `current` gives the account's short hash (never a readable id), written to `key`
     * next to the data. A cache written for another account, or without an owner, is not shown and is removed; with no
     * account (`current` null) nothing is read or written.
     */
    owner?: {
        key: string;
        current: () => string | null;
    };
}

export function createSessionCache<T, X>(options: SessionCacheOptions<T, X>, initialExtras: X): WorkloadCache<T, X> {
    const { dataKey, timestampKey, extras, minimal, label, owner } = options;
    const storage = options.storage ?? (() => (typeof sessionStorage === "undefined" ? null : sessionStorage));

    const clear = () => {
        const s = storage();
        if (!s) return;
        s.removeItem(dataKey);
        s.removeItem(timestampKey);
        if (extras) s.removeItem(extras.key);
        if (owner) s.removeItem(owner.key);
    };

    /** Whether what is stored belongs to the signed-in account; always true without an owner binding */
    const ownedBy = (s: Pick<Storage, "getItem">, account: string | null): boolean => {
        if (!owner) return true;
        return account !== null && s.getItem(owner.key) === account;
    };

    return {
        read() {
            const s = storage();
            if (!s) return null;
            const raw = s.getItem(dataKey);
            const timestamp = s.getItem(timestampKey);
            if (!raw || !timestamp) return null;
            const account = owner ? owner.current() : null;
            if (owner && account === null) return null;
            if (!ownedBy(s, account)) {
                // Another account's data (or a cache from before the binding): never shown, and gone from this tab
                Logger.info("Workload", `${label}: the cache belongs to another account and was removed`);
                clear();
                return null;
            }
            const data = JSON.parse(raw) as T[];
            let decoded: X = initialExtras;
            if (extras) {
                const rawExtras = s.getItem(extras.key);
                if (rawExtras) {
                    try {
                        decoded = extras.decode(JSON.parse(rawExtras));
                    } catch (error) {
                        Logger.warn("Workload", `${label}: cached extras could not be read`, error);
                    }
                }
            }
            return { data, extras: decoded, lastFetched: timestamp };
        },

        write(content: WorkloadContent<T, X>, lastFetched: string) {
            const s = storage();
            if (!s) return;
            const account = owner ? owner.current() : null;
            if (owner && account === null) return;
            try {
                if (owner && account !== null) s.setItem(owner.key, account);
                s.setItem(dataKey, JSON.stringify(content.data));
                s.setItem(timestampKey, lastFetched);
                if (extras) {
                    const encoded = extras.encode(content.extras);
                    if (encoded !== null) s.setItem(extras.key, JSON.stringify(encoded));
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === "QuotaExceededError") {
                    Logger.warn("Workload", `${label}: storage quota exceeded, the data is too large to cache`);
                    try {
                        clear();
                        if (minimal) {
                            if (owner && account !== null) s.setItem(owner.key, account);
                            s.setItem(dataKey, JSON.stringify(minimal(content.data)));
                            s.setItem(timestampKey, lastFetched);
                            Logger.info("Workload", `${label}: stored a minimal cache because of the quota`);
                        }
                    } catch {
                        Logger.warn("Workload", `${label}: even the minimal cache failed, running without a cache this session`);
                    }
                } else {
                    Logger.error("Workload", `${label}: could not save the cache`, error);
                }
            }
        },

        clear,

        peekTimestamp() {
            const s = storage();
            if (!s) return null;
            // A cache of another account is not "about to be shown": `load` must read this account's data
            if (owner && !ownedBy(s, owner.current())) return null;
            return s.getItem(timestampKey);
        },
    };
}
