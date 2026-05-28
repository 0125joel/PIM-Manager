/**
 * Rate Limiter using sliding-window token bucket pattern
 * Ensures Graph API requests stay within tenant RU (Resource Unit) limits
 */

import { Logger } from './logger';

const DEFAULT_RU_BUDGET = 500; // RU per 10s window — conservative for small tenants
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

            // Remove expired entries
            const now = Date.now();
            this.entries = this.entries.filter(e => now - e.timestamp < this.windowMs);

            // Calculate current consumption
            const currentRu = this.entries.reduce((sum, e) => sum + e.cost, 0);

            // Check if we can proceed
            if (currentRu + cost <= this.maxRu) {
                this.entries.push({ timestamp: now, cost });
                return;
            }

            // Budget exhausted — wait for oldest entry to expire, then retry
            const oldestTimestamp = this.entries[0]?.timestamp;
            if (!oldestTimestamp) break; // Safety, shouldn't happen

            const expiresAt = oldestTimestamp + this.windowMs;
            const waitMs = Math.max(0, expiresAt - now);

            Logger.debug('RateLimiter', `Budget exhausted (${currentRu}/${this.maxRu} RU), waiting ${waitMs}ms for window refresh`);

            // Wait a bit before retrying, or until expiry
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, Math.min(waitMs, 100));
                signal?.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new Error('Aborted'));
                });
            });
        }
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
