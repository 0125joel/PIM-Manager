import { describe, expect, it } from "vitest";
import { toastAutoCloses } from "@/components/ui/Toast";

describe("toastAutoCloses", () => {
    it("never closes an error by itself", () => {
        expect(toastAutoCloses("error", 8000)).toBe(false);
        expect(toastAutoCloses("error", 5000)).toBe(false);
    });

    it("closes the other types after their duration", () => {
        expect(toastAutoCloses("success", 5000)).toBe(true);
        expect(toastAutoCloses("info", 3000)).toBe(true);
    });

    it("keeps a toast without a duration open", () => {
        expect(toastAutoCloses("success", 0)).toBe(false);
    });
});
