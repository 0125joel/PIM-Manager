import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/utils/dateFormat";

describe("dateFormat", () => {
    it("formats a date with day, short month and year", () => {
        const text = formatDate(new Date(2026, 9, 1));
        expect(text).toContain("2026");
        expect(text).toMatch(/1/);
    });

    it("accepts ISO strings and timestamps", () => {
        expect(formatDate("2026-10-01T12:00:00Z")).toBe(formatDate(new Date("2026-10-01T12:00:00Z")));
        expect(formatDate(Date.UTC(2026, 9, 1, 12))).not.toBe("");
    });

    it("gives an empty string for missing or invalid input", () => {
        expect(formatDate(null)).toBe("");
        expect(formatDate(undefined)).toBe("");
        expect(formatDate("")).toBe("");
        expect(formatDate("not a date")).toBe("");
        expect(formatDateTime("not a date")).toBe("");
    });

    it("adds the time to the date", () => {
        const date = new Date(2026, 9, 1, 14, 5);
        expect(formatDateTime(date).startsWith(formatDate(date))).toBe(true);
        expect(formatDateTime(date).length).toBeGreaterThan(formatDate(date).length);
    });
});
