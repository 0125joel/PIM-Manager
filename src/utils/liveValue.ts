/**
 * The latest value of something that changes with every render, readable from code that runs later (callbacks, the
 * workload engines) without closing over a stale snapshot. Set it in an effect, read it with `get()`. It is a
 * holder object, not a ref, so it can be handed to code that is created while rendering.
 */
export class LiveValue<T> {
    private value: T;

    constructor(initial: T) {
        this.value = initial;
    }

    get(): T {
        return this.value;
    }

    set(next: T): void {
        this.value = next;
    }
}
