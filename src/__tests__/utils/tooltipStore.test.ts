import { describe, expect, it, vi } from "vitest";
import { createTooltipStore } from "@/utils/tooltipStore";

describe("tooltipStore", () => {
    it("keeps one tip open at a time", () => {
        const store = createTooltipStore();
        store.open("a");
        store.open("b");
        expect(store.getOpenId()).toBe("b");
    });

    it("closes only the tip that is open", () => {
        const store = createTooltipStore();
        store.open("a");
        store.open("b");
        store.close("a");
        expect(store.getOpenId()).toBe("b");
        store.close("b");
        expect(store.getOpenId()).toBeNull();
    });

    it("toggles and closes all (Escape)", () => {
        const store = createTooltipStore();
        store.toggle("a");
        expect(store.getOpenId()).toBe("a");
        store.toggle("a");
        expect(store.getOpenId()).toBeNull();
        store.open("c");
        store.closeAll();
        expect(store.getOpenId()).toBeNull();
    });

    it("notifies subscribers only when the open tip changes", () => {
        const store = createTooltipStore();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);
        store.open("a");
        store.open("a");
        expect(listener).toHaveBeenCalledTimes(1);
        store.closeAll();
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        store.open("b");
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
