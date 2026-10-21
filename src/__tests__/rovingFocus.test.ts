import { describe, it, expect } from "vitest";
import { getNextIndex, getNextMenuIndex } from "@/utils/rovingFocus";

describe("getNextIndex", () => {
    it("moves right and wraps around", () => {
        expect(getNextIndex("ArrowRight", 0, 3)).toBe(1);
        expect(getNextIndex("ArrowRight", 2, 3)).toBe(0);
    });
    it("moves left and wraps around", () => {
        expect(getNextIndex("ArrowLeft", 1, 3)).toBe(0);
        expect(getNextIndex("ArrowLeft", 0, 3)).toBe(2);
    });
    it("jumps to the first and last item", () => {
        expect(getNextIndex("Home", 2, 5)).toBe(0);
        expect(getNextIndex("End", 0, 5)).toBe(4);
    });
    it("ignores keys that do not navigate and vertical arrows in a horizontal list", () => {
        expect(getNextIndex("Enter", 0, 3)).toBeNull();
        expect(getNextIndex("ArrowDown", 0, 3)).toBeNull();
    });
    it("returns null for an empty list", () => {
        expect(getNextIndex("ArrowRight", 0, 0)).toBeNull();
    });
});

describe("focus outside the list", () => {
    it("goes to the first item forward and to the last item backward", () => {
        expect(getNextIndex("ArrowDown", -1, 3, "vertical")).toBe(0);
        expect(getNextIndex("ArrowUp", -1, 3, "vertical")).toBe(2);
    });
    it("stays on the only item", () => {
        expect(getNextIndex("ArrowRight", 0, 1)).toBe(0);
        expect(getNextIndex("ArrowLeft", 0, 1)).toBe(0);
    });
});

describe("getNextMenuIndex", () => {
    it("uses the vertical arrows", () => {
        expect(getNextMenuIndex("ArrowDown", 0, 3)).toBe(1);
        expect(getNextMenuIndex("ArrowUp", 0, 3)).toBe(2);
        expect(getNextMenuIndex("ArrowRight", 0, 3)).toBeNull();
    });
});
