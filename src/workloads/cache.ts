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
}

export function createSessionCache<T, X>(options: SessionCacheOptions<T, X>, initialExtras: X): WorkloadCache<T, X> {
    const { dataKey, timestampKey, extras, minimal, label } = options;
    const storage = options.storage ?? (() => (typeof sessionStorage === "undefined" ? null : sessionStorage));

    const clear = () => {
        const s = storage();
        if (!s) return;
        s.removeItem(dataKey);
        s.removeItem(timestampKey);
        if (extras) s.removeItem(extras.key);
    };

    return {
        read() {
            const s = storage();
            if (!s) return null;
            const raw = s.getItem(dataKey);
            const timestamp = s.getItem(timestampKey);
            if (!raw || !timestamp) return null;
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
            try {
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
            return storage()?.getItem(timestampKey) ?? null;
        },
    };
}
