/**
 * Rate Limiter using sliding-window token bucket pattern
 * Ensures Graph API requests stay within tenant RU (Resource Unit) limits
 */

import { Logger } from './logger';

const DEFAULT_RU_BUDGET = 500; // RU per 10s window, conservative for small tenants
const WINDOW_MS = 10_000; // 10 second window per Microsoft Graph throttle limits

interface RUEntry {
    timestamp: number;
    cost: number;
}

/**
 * Sliding-window token bucket rate limiter
 * Tracks RU consumption and blocks acquire() calls when budget is exhausted
 */
export class RateLimiter {
    private entries: RUEntry[] = [];
    private maxRu: number;
    private windowMs: number;
    /** After a 429 every caller waits, not only the one that was throttled */
    private blockedUntil = 0;

    constructor(maxRu: number = DEFAULT_RU_BUDGET, windowMs: number = WINDOW_MS) {
        this.maxRu = maxRu;
        this.windowMs = windowMs;
    }

    /**
     * Acquire permission to make a request
     * Blocks if budget exhausted until an old entry expires from the window
     */
    async acquire(cost: number = 1, signal?: AbortSignal): Promise<void> {
        while (true) {
            // Check abort
            if (signal?.aborted) throw new Error('Aborted');

            const now = Date.now();
            if (now < this.blockedUntil) {
                await this.sleep(Math.min(this.blockedUntil - now, 250), signal);
                continue;
            }

            // Remove expired entries
            this.entries = this.entries.filter(e => now - e.timestamp < this.windowMs);

            // Calculate current consumption
            const currentRu = this.entries.reduce((sum, e) => sum + e.cost, 0);

            // Check if we can proceed
            if (currentRu + cost <= this.maxRu) {
                this.entries.push({ timestamp: now, cost });
                return;
            }

            // Budget exhausted: wait for the oldest entry to expire, then retry
            const oldestTimestamp = this.entries[0]?.timestamp;
            if (!oldestTimestamp) break; // Safety, shouldn't happen

            const expiresAt = oldestTimestamp + this.windowMs;
            const waitMs = Math.max(0, expiresAt - now);

            Logger.debug('RateLimiter', `Budget exhausted (${currentRu}/${this.maxRu} RU), waiting ${waitMs}ms for window refresh`);

            // Wait a bit before retrying, or until expiry
            await this.sleep(Math.min(waitMs, 100), signal);
        }
    }

    /**
     * Graph answered 429: nobody sends a request for `ms` (the Retry-After of the answer). Without this, the other
     * workers keep sending while one waits, and the throttling gets worse instead of clearing.
     */
    backOff(ms: number): void {
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    }

    private sleep(ms: number, signal?: AbortSignal): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                clearTimeout(timeout);
                reject(new Error('Aborted'));
            };
            const timeout = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            // { once: true } plus explicit removal on resolve prevents listener build-up
            // when acquire() loops many times on a busy limiter
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    /**
     * Get current usage stats for telemetry
     */
    getCurrentUsage(): { ru: number; capacity: number; utilizationPct: number } {
        const now = Date.now();
        this.entries = this.entries.filter(e => now - e.timestamp < this.windowMs);
        const ru = this.entries.reduce((sum, e) => sum + e.cost, 0);
        return {
            ru,
            capacity: this.maxRu,
            utilizationPct: Math.round((ru / this.maxRu) * 100)
        };
    }
}

/**
 * Global singleton rate limiter for the Graph client
 * All worker pools share this instance to enforce a tenant-wide RU budget
 */
export const graphRateLimiter = new RateLimiter(DEFAULT_RU_BUDGET);
