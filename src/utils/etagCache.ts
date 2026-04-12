/**
 * ETag Cache Utility
 *
 * Provides conditional request support using ETags for Microsoft Graph API calls.
 * ETags enable 304 Not Modified responses which:
 * - Reduce bandwidth usage (no body for unchanged data)
 * - Decrease API processing time
 * - Avoid hitting throttle limits as quickly
 *
 * Storage: ETags are stored in sessionStorage alongside cached data.
 * TTL: Same as data cache (60 minutes) - if data expires, ETag expires too.
 */

import { Logger } from "./logger";

const ETAG_STORAGE_KEY_PREFIX = "etag_cache_";

interface ETagCacheEntry {
    etag: string;
    timestamp: number;
    data: unknown;
}

// 60 minutes TTL (matches architecture standard)
const CACHE_TTL = 60 * 60 * 1000;

/**
 * Get cached ETag for a specific cache key
 */
export function getETag(cacheKey: string): string | null {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
        return null;
    }

    try {
        const stored = sessionStorage.getItem(ETAG_STORAGE_KEY_PREFIX + cacheKey);
        if (!stored) return null;

        const entry: ETagCacheEntry = JSON.parse(stored);

        // Check TTL
        if (Date.now() - entry.timestamp > CACHE_TTL) {
            sessionStorage.removeItem(ETAG_STORAGE_KEY_PREFIX + cacheKey);
            return null;
        }

        return entry.etag;
    } catch {
        return null;
    }
}

/**
 * Get cached data for a specific cache key
 * Returns null if no cache or expired
 */
export function getCachedData<T>(cacheKey: string): T | null {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
        return null;
    }

    try {
        const stored = sessionStorage.getItem(ETAG_STORAGE_KEY_PREFIX + cacheKey);
        if (!stored) return null;

        const entry: ETagCacheEntry = JSON.parse(stored);

        // Check TTL
        if (Date.now() - entry.timestamp > CACHE_TTL) {
            sessionStorage.removeItem(ETAG_STORAGE_KEY_PREFIX + cacheKey);
            return null;
        }

        return entry.data as T;
    } catch {
        return null;
    }
}

/**
 * Store ETag and data for a specific cache key
 */
export function setETagCache<T>(cacheKey: string, etag: string, data: T): void {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
        return;
    }

    try {
        const entry: ETagCacheEntry = {
            etag,
            timestamp: Date.now(),
            data
        };
        sessionStorage.setItem(ETAG_STORAGE_KEY_PREFIX + cacheKey, JSON.stringify(entry));
        Logger.debug("ETagCache", `Cached data with ETag for: ${cacheKey}`);
    } catch (error) {
        // SessionStorage might be full - log but don't throw
        Logger.warn("ETagCache", `Failed to cache ETag for ${cacheKey}:`, error);
    }
}

/**
 * Clear a specific cache entry
 */
export function clearETagCache(cacheKey: string): void {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
        return;
    }

    try {
        sessionStorage.removeItem(ETAG_STORAGE_KEY_PREFIX + cacheKey);
    } catch {
        // Ignore errors
    }
}

/**
 * Clear all ETag cache entries
 */
export function clearAllETagCache(): void {
    if (typeof window === "undefined" || typeof sessionStorage === "undefined") {
        return;
    }

    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key?.startsWith(ETAG_STORAGE_KEY_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => sessionStorage.removeItem(key));
        Logger.debug("ETagCache", `Cleared ${keysToRemove.length} ETag cache entries`);
    } catch {
        // Ignore errors
    }
}

/**
 * Generate a cache key from endpoint and options
 */
export function generateCacheKey(endpoint: string, options?: Record<string, unknown>): string {
    const base = endpoint.replace(/[^a-zA-Z0-9]/g, "_");
    if (!options) return base;

    // Include relevant options in cache key
    const optionParts = Object.entries(options)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${String(v)}`)
        .sort()
        .join("_");

    return optionParts ? `${base}__${optionParts}` : base;
}

/**
 * Check if a response status indicates "Not Modified" (304)
 * Graph API uses 304 when ETag matches
 */
export function isNotModifiedResponse(status: number): boolean {
    return status === 304;
}
