/**
 * A gate that lets at most `max` tasks run at the same time. Waiting tasks start in the order they asked (first in, first out),
 * a slot is released when its task ends, also on an error, and a task that waits for a slot is rejected with an `AbortError`
 * when its signal aborts. Pure: no timers, no network.
 */
export interface ConcurrencyGate {
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

function abortError(): DOMException {
    return new DOMException("The wait for a free slot was cancelled.", "AbortError");
}

export function createConcurrencyGate(max: number): ConcurrencyGate {
    const limit = Math.max(1, Math.floor(max));
    let active = 0;
    const waiting: Array<() => void> = [];

    const release = () => {
        const next = waiting.shift();
        // The slot goes straight to the next in line, so `active` stays at the limit
        if (next) next();
        else active--;
    };

    const acquire = (signal?: AbortSignal): Promise<void> => {
        if (signal?.aborted) return Promise.reject(abortError());
        if (active < limit) {
            active++;
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                const index = waiting.indexOf(start);
                if (index >= 0) waiting.splice(index, 1);
                reject(abortError());
            };
            const start = () => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            };
            waiting.push(start);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    };

    return {
        async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
            await acquire(signal);
            try {
                return await fn();
            } finally {
                release();
            }
        },
    };
}
