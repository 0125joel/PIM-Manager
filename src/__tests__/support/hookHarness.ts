/**
 * A small stand-in for React's hooks, for tests that run in the node environment (no DOM, no testing library, no new
 * dependency). `renderHook` runs one hook function with useState, useRef, useCallback, useMemo and useEffect. Effects run
 * after each render, and a state change outside a render re-renders at once. It is enough to test the state of a hook;
 * it is not a renderer. Used through `vi.mock("react", ...)` in the test file.
 */

interface StateSlot {
    value: unknown;
}
interface RefSlot {
    current: unknown;
}
interface EffectSlot {
    deps: unknown[] | undefined;
    cleanup?: () => void;
}

interface Context {
    fn: () => unknown;
    slots: unknown[];
    cursor: number;
    pending: Array<() => void>;
    rendering: boolean;
    dirty: boolean;
    result: unknown;
}

let active: Context | null = null;

function context(): Context {
    if (!active) throw new Error("A hook was called outside renderHook.");
    return active;
}

function sameDeps(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
}

function flush(ctx: Context): void {
    active = ctx;
    ctx.rendering = true;
    do {
        ctx.dirty = false;
        ctx.cursor = 0;
        ctx.pending = [];
        ctx.result = ctx.fn();
        for (const run of ctx.pending) run();
    } while (ctx.dirty);
    ctx.rendering = false;
}

function schedule(ctx: Context): void {
    if (ctx.rendering) ctx.dirty = true;
    else flush(ctx);
}

export function useState<T>(init: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] {
    const ctx = context();
    const i = ctx.cursor++;
    if (!(i in ctx.slots)) ctx.slots[i] = { value: typeof init === "function" ? (init as () => T)() : init } as StateSlot;
    const slot = ctx.slots[i] as StateSlot;
    const set = (next: T | ((previous: T) => T)) => {
        const value = typeof next === "function" ? (next as (previous: T) => T)(slot.value as T) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        schedule(ctx);
    };
    return [slot.value as T, set];
}

export function useRef<T>(init: T): { current: T } {
    const ctx = context();
    const i = ctx.cursor++;
    if (!(i in ctx.slots)) ctx.slots[i] = { current: init } as RefSlot;
    return ctx.slots[i] as { current: T };
}

export function useCallback<T>(fn: T): T {
    context().cursor++;
    return fn;
}

export function useMemo<T>(fn: () => T): T {
    context().cursor++;
    return fn();
}

export function useEffect(effect: () => void | (() => void), deps?: unknown[]): void {
    const ctx = context();
    const i = ctx.cursor++;
    const previous = ctx.slots[i] as EffectSlot | undefined;
    if (previous && deps && sameDeps(previous.deps, deps)) return;
    ctx.slots[i] = { deps, cleanup: previous?.cleanup } as EffectSlot;
    ctx.pending.push(() => {
        const slot = ctx.slots[i] as EffectSlot;
        slot.cleanup?.();
        const cleanup = effect();
        slot.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    });
}

/** Renders `fn` once. `result` is the value of the latest render; `rerender` renders again (for changed inputs). */
export function renderHook<T>(fn: () => T) {
    const ctx: Context = { fn, slots: [], cursor: 0, pending: [], rendering: false, dirty: false, result: undefined };
    flush(ctx);
    return {
        get result(): T {
            return ctx.result as T;
        },
        rerender(): void {
            flush(ctx);
        },
    };
}
