/**
 * Retry Utility for handling transient failures with exponential backoff
 *
 * Handles common API failures:
 * - 429 (Too Many Requests / Throttling)
 * - 503 (Service Unavailable)
 * - 500+ (Server Errors)
 */

import { Logger } from './logger';

interface RetryableError {
    statusCode?: number;
    message: string;
}

/**
 * Parse Retry-After header from a Graph error response
 * Returns milliseconds to wait, or null if header is missing/invalid
 * Caps at 60s to prevent indefinite waits
 */
function parseRetryAfterHeader(error: unknown): number | null {
    const errorObj = error as Record<string, unknown> | undefined;
    const headers = errorObj?.responseHeaders || errorObj?.headers;
    if (!headers) return null;

    let retryAfterValue: string | undefined;
    const headersAny = headers as Record<string, unknown>;
    if (typeof headersAny.get === 'function') {
        const h = headers as unknown as Headers;
        retryAfterValue = h.get('Retry-After') ?? h.get('retry-after') ?? undefined;
    } else if (typeof headers === 'object') {
        const h = headers as Record<string, string>;
        retryAfterValue = h['Retry-After'] || h['retry-after'];
    }

    if (!retryAfterValue) return null;

    // Try parsing as seconds (most common)
    const seconds = parseInt(retryAfterValue, 10);
    if (!isNaN(seconds) && seconds > 0) {
        const ms = Math.min(seconds * 1000, 60000); // Cap at 60s
        return ms;
    }

    // Try parsing as HTTP-date
    const dateMs = new Date(retryAfterValue).getTime();
    if (!isNaN(dateMs)) {
        const delayMs = Math.max(0, dateMs - Date.now());
        return Math.min(delayMs, 60000); // Cap at 60s
    }

    return null;
}

/**
 * Check if an error is retryable based on status code
 */
function isRetryableError(error: unknown): boolean {
    const statusCode = (error as RetryableError).statusCode;
    return statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
}

/**
 * Execute an async operation with automatic retry on transient failures
 *
 * Uses exponential backoff: 1s, 2s, 4s (default)
 *
 * @param operation - The async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000ms)
 * @param operationName - Name for logging purposes
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * const result = await withRetry(
 *   () => updatePolicyRules(client, policyId, rules),
 *   3,
 *   1000,
 *   'updatePolicyRules'
 * );
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000,
    operationName: string = 'operation'
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error: unknown) {
            lastError = error;
            const isRetryable = isRetryableError(error);
            const isLastAttempt = attempt === maxRetries - 1;

            // If not retryable or last attempt, throw immediately
            if (!isRetryable || isLastAttempt) {
                if (isLastAttempt && isRetryable) {
                    Logger.warn('RetryUtils', `${operationName}: All ${maxRetries} retry attempts exhausted`);
                }
                throw error;
            }

            // Log retry attempt and calculate delay
            const statusCode = (error as RetryableError).statusCode;
            let delay = baseDelay * Math.pow(2, attempt);
            let retryAfterSource = 'backoff-fallback';

            // For 429, try to honor Retry-After header
            if (statusCode === 429) {
                const retryAfterMs = parseRetryAfterHeader(error);
                if (retryAfterMs !== null) {
                    delay = retryAfterMs;
                    retryAfterSource = 'header';
                }
                Logger.warn(
                    'Throttle',
                    `${operationName}: 429 throttled, retry-after=${delay}ms (source: ${retryAfterSource}), attempt ${attempt + 1}/${maxRetries}`
                );
            } else {
                Logger.info(
                    'RetryUtils',
                    `${operationName}: Retryable error (${statusCode}), attempt ${attempt + 1}/${maxRetries}. Retrying in ${delay}ms...`
                );
            }

            // Delay before retry
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError;
}
