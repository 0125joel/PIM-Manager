/**
 * Everything the app caches in the browser session for Microsoft Graph data. Used by sign-out and by "Clear cached data"
 * on the settings page. Preferences (theme, view mode, workload flags) and the emergency account list live in
 * localStorage and are never touched here.
 */

const SESSION_KEY_PREFIXES = ["pim_", "etag_cache_"] as const;
const SESSION_KEYS = ["directory_role_policy_cache", "directory_role_policy_timestamp", "pim-custom-extensions", "pim-dismissed-alerts"] as const;

type SessionStorageLike = Pick<Storage, "removeItem" | "key" | "length">;

export function isCachedKey(key: string): boolean {
    return SESSION_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) || (SESSION_KEYS as readonly string[]).includes(key);
}

/** Removes every cached session key; returns how many were removed. Safe when storage is missing or throws. */
export function clearPimSessionCaches(storage: SessionStorageLike | null = typeof sessionStorage === "undefined" ? null : sessionStorage): number {
    if (!storage) return 0;
    try {
        const keys: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && isCachedKey(key)) keys.push(key);
        }
        keys.forEach((key) => storage.removeItem(key));
        return keys.length;
    } catch {
        return 0;
    }
}
