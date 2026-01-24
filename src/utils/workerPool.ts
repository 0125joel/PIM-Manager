/**
 * Universal Worker Pool Utility
 *
 * Provides a reusable pattern for parallel data fetching with:
 * - Configurable worker count for concurrency
 * - Per-worker delay to prevent API throttling
 * - Progress reporting
 * - Error handling
 *
 * Used by: roleDataService.ts, pimGroupDataService.ts, and future services
 */

import { Logger } from './logger';

// Helper to add delay for throttling protection
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper function to chunk array into smaller arrays
 */
function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Configuration options for the worker pool
 */
export interface WorkerPoolOptions<TItem, TResult> {
    /** Array of items to process */
    items: TItem[];

    /** Number of concurrent workers (default: 3) */
    workerCount?: number;

    /** Delay in milliseconds between requests per worker (default: 500) */
    delayMs?: number;

    /**
     * Async function to process each item
     * @param item - The item to process
     * @param workerId - 1-indexed worker ID for logging
     * @returns The result for this item
     */
    processor: (item: TItem, workerId: number) => Promise<TResult | null>;

    /**
     * Optional callback for progress updates
     * @param current - Number of items processed so far
     * @param total - Total number of items
     */
    onProgress?: (current: number, total: number) => void;

    /**
     * Optional callback when an item completes successfully
     * @param item - The processed item
     * @param result - The result for this item
     */
    onItemComplete?: (item: TItem, result: TResult) => void;

    /**
     * Optional callback when an item fails
     * @param item - The failed item
     * @param error - The error message
     */
    onItemError?: (item: TItem, error: string) => void;

    /**
     * Optional AbortSignal to cancel the operation
     */
    signal?: AbortSignal;
}

/**
 * Result of running the worker pool
 */
export interface WorkerPoolResult<TItem, TResult> {
    /** Map of item to its result (only includes successful items) */
    results: Map<TItem, TResult>;

    /** Total items processed */
    processed: number;

    /** Number of successful items */
    succeeded: number;

    /** Number of failed items */
    failed: number;

    /** Whether the operation was aborted */
    aborted: boolean;
}

/**
 * Run a worker pool for parallel processing with throttling protection.
 * Supports cancellation via AbortSignal.
 */
export async function runWorkerPool<TItem, TResult>(
    options: WorkerPoolOptions<TItem, TResult>
): Promise<WorkerPoolResult<TItem, TResult>> {
    const {
        items,
        workerCount = 8,
        delayMs = 300,
        processor,
        onProgress,
        onItemComplete,
        onItemError,
        signal
    } = options;

    const total = items.length;
    const results = new Map<TItem, TResult>();
    let processedCount = 0;
    let succeededCount = 0;
    let failedCount = 0;
    let isAborted = false;

    if (total === 0) {
        return { results, processed: 0, succeeded: 0, failed: 0, aborted: false };
    }

    Logger.debug('WorkerPool', `Starting with ${total} items across ${workerCount} workers`);

    // Distribute items among workers (creates chunks, not round-robin for simpler logic)
    const chunkSize = Math.ceil(total / workerCount);
    const chunks = chunk(items, chunkSize);

    // Worker function
    const runWorker = async (workerId: number, workerItems: TItem[]) => {
        Logger.debug('WorkerPool', `Worker ${workerId} starting with ${workerItems.length} items`);

        for (let i = 0; i < workerItems.length; i++) {
            // Check for abortion before processing item
            if (signal?.aborted) {
                Logger.debug('WorkerPool', `Worker ${workerId} aborted`);
                isAborted = true;
                return;
            }

            const item = workerItems[i];

            try {
                const result = await processor(item, workerId);

                if (result !== null) {
                    results.set(item, result);
                    succeededCount++;
                    onItemComplete?.(item, result);
                } else {
                    // null result means processor handled it but returned nothing
                    succeededCount++;
                }
            } catch (error: any) {
                // Ignore errors if aborted during processing
                if (signal?.aborted) {
                    isAborted = true;
                    return;
                }

                const errorMsg = error.message || String(error);
                Logger.error('WorkerPool', `Worker ${workerId} failed for item: ${errorMsg}`);
                failedCount++;
                onItemError?.(item, errorMsg);
            }

            // Update progress
            processedCount++;
            onProgress?.(processedCount, total);

            // Delay between requests for THIS worker (throttle protection)
            if (i < workerItems.length - 1) {
                // Check abort before delay too
                if (signal?.aborted) {
                    isAborted = true;
                    return;
                }
                await delay(delayMs);
            }
        }
        Logger.debug('WorkerPool', `Worker ${workerId} finished`);
    };

    // Run all workers in parallel
    await Promise.all(
        chunks.map((workerChunk, index) => runWorker(index + 1, workerChunk))
    );

    if (isAborted) {
        Logger.info('WorkerPool', `Operation aborted. Processed ${processedCount}/${total} items.`);
    } else {
        Logger.debug('WorkerPool', `Completed: ${succeededCount}/${total} succeeded, ${failedCount} failed`);
    }

    return {
        results,
        processed: processedCount,
        succeeded: succeededCount,
        failed: failedCount,
        aborted: isAborted
    };
}

/**
 * Helper to run a simple worker pool that returns an array of results.
 * Convenience wrapper around runWorkerPool for cases where you just want an array.
 */
export async function runWorkerPoolArray<TItem, TResult>(
    options: WorkerPoolOptions<TItem, TResult>
): Promise<TResult[]> {
    const { results } = await runWorkerPool(options);
    return Array.from(results.values());
}
