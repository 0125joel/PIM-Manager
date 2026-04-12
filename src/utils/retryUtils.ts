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

            // Log retry attempt
            const statusCode = (error as RetryableError).statusCode;
            const delay = baseDelay * Math.pow(2, attempt);
            Logger.info(
                'RetryUtils',
                `${operationName}: Retryable error (${statusCode}), attempt ${attempt + 1}/${maxRetries}. Retrying in ${delay}ms...`
            );

            // Exponential backoff delay
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError;
}
