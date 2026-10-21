/**
 * Collects state updaters and applies them as one. Policies arrive one by one (12 workers); a setState
 * per policy re-renders the whole tree about 260 times in a full load. `push` queues an updater and the
 * queue is flushed once per `delayMs`; `flush` applies what is queued at once (completion, priority fetch).
 */
export type Updater<S> = (state: S) => S;

export interface UpdateBatcher<S> {
    push: (updater: Updater<S>) => void;
    flush: () => void;
    cancel: () => void;
}

export function createUpdateBatcher<S>(commit: (combined: Updater<S>) => void, delayMs: number, onFlush?: (count: number) => void): UpdateBatcher<S> {
    let queue: Updater<S>[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (queue.length === 0) return;
        const batch = queue;
        queue = [];
        onFlush?.(batch.length);
        commit((state) => batch.reduce((acc, updater) => updater(acc), state));
    };

    return {
        push(updater) {
            queue.push(updater);
            if (timer === null) timer = setTimeout(flush, delayMs);
        },
        flush,
        cancel() {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            queue = [];
        },
    };
}
