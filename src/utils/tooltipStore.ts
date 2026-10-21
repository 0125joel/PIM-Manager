/**
 * One open tooltip at a time (Report spec 9.1). A tiny external store: a tag opens its tip, which closes any other open tip,
 * and closing only works for the tip that is open. `ui/Tag` reads it with `useSyncExternalStore`.
 */
export interface TooltipStore {
    getOpenId: () => string | null;
    open: (id: string) => void;
    /** Closes `id` only when it is the open one, so a late blur of an older tag cannot close a newer tip */
    close: (id: string) => void;
    closeAll: () => void;
    toggle: (id: string) => void;
    subscribe: (listener: () => void) => () => void;
}

export function createTooltipStore(): TooltipStore {
    let openId: string | null = null;
    const listeners = new Set<() => void>();

    const set = (next: string | null) => {
        if (next === openId) return;
        openId = next;
        listeners.forEach((listener) => listener());
    };

    return {
        getOpenId: () => openId,
        open: (id) => set(id),
        close: (id) => {
            if (openId === id) set(null);
        },
        closeAll: () => set(null),
        toggle: (id) => set(openId === id ? null : id),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export const tooltipStore = createTooltipStore();
