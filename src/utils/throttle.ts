/**
 * Trailing throttle for high-frequency state commits (progress ticks).
 *
 * `push(value)` stores the latest value and schedules one commit per
 * `intervalMs`. A value for which `isFinal` returns true is committed
 * immediately and cancels any pending commit. `cancel()` drops a pending
 * commit; call it before writing a terminal state (for example "complete")
 * so a late tick cannot overwrite it.
 */
export interface TrailingThrottle<T> {
    push: (value: T) => void;
    cancel: () => void;
}

export function createTrailingThrottle<T>(
    commit: (value: T) => void,
    intervalMs: number,
    isFinal?: (value: T) => boolean
): TrailingThrottle<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { value: T } | null = null;

    const flush = () => {
        timer = null;
        if (!pending) return;
        const { value } = pending;
        pending = null;
        commit(value);
    };

    return {
        push: (value: T) => {
            pending = { value };
            if (isFinal?.(value)) {
                if (timer) clearTimeout(timer);
                flush();
                return;
            }
            if (!timer) timer = setTimeout(flush, intervalMs);
        },
        cancel: () => {
            if (timer) clearTimeout(timer);
            timer = null;
            pending = null;
        },
    };
}

/** Default interval for UI progress commits: at most 4 renders per second. */
export const PROGRESS_FLUSH_MS = 250;
