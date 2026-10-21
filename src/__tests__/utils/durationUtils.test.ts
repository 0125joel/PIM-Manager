import { describe, expect, it } from "vitest";
import {
    toIsoDuration,
    toGraphDuration,
    parseTotalHours,
    formatDuration,
    isIsoDuration,
    hoursToIso,
    parseHours,
} from "@/utils/durationUtils";

describe("toIsoDuration", () => {
    it("converts human-readable labels to ISO 8601", () => {
        expect(toIsoDuration("1 Year")).toBe("P1Y");
        expect(toIsoDuration("6 Months")).toBe("P6M");
        expect(toIsoDuration("15 Days")).toBe("P15D");
        expect(toIsoDuration("8 Hours")).toBe("PT8H");
    });

    it("passes ISO input through, upper-cased", () => {
        expect(toIsoDuration("p6m")).toBe("P6M");
        expect(toIsoDuration("PT8H")).toBe("PT8H");
    });

    it("falls back to one year for empty or unknown input", () => {
        expect(toIsoDuration(undefined)).toBe("P1Y");
        expect(toIsoDuration("forever")).toBe("P1Y");
    });
});

describe("toGraphDuration", () => {
    it("converts calendar durations to the days form Graph requires", () => {
        expect(toGraphDuration("P1Y")).toBe("P365D");
        expect(toGraphDuration("P6M")).toBe("P180D");
        expect(toGraphDuration("P1M")).toBe("P30D");
        expect(toGraphDuration("P2Y")).toBe("P730D");
        expect(toGraphDuration("P4M")).toBe("P120D");
    });

    it("keeps values that are already in days and defaults to one year", () => {
        expect(toGraphDuration("P15D")).toBe("P15D");
        expect(toGraphDuration(undefined)).toBe("P365D");
    });
});

describe("parseTotalHours", () => {
    it("sums every ISO component into hours", () => {
        expect(parseTotalHours("PT8H")).toBe(8);
        expect(parseTotalHours("P1D")).toBe(24);
        expect(parseTotalHours("P1DT12H")).toBe(36);
        expect(parseTotalHours("PT30M")).toBe(0.5);
        expect(parseTotalHours("P1W")).toBe(168);
    });

    it("returns null for PT0S (no limit), empty and non-ISO values", () => {
        expect(parseTotalHours("PT0S")).toBeNull();
        expect(parseTotalHours(undefined)).toBeNull();
        expect(parseTotalHours("8 hours")).toBeNull();
    });
});

describe("formatDuration", () => {
    it("formats singular and plural units", () => {
        expect(formatDuration("P1Y")).toBe("1 Year");
        expect(formatDuration("P2Y")).toBe("2 Years");
        expect(formatDuration("P6M")).toBe("6 Months");
        expect(formatDuration("P1D")).toBe("1 Day");
        expect(formatDuration("PT8H")).toBe("8 Hours");
        expect(formatDuration("PT30M")).toBe("30 Minutes");
    });

    it("treats P365D as one year and passes unknown patterns through", () => {
        expect(formatDuration("P365D")).toBe("1 Year");
        expect(formatDuration("P1DT12H")).toBe("P1DT12H");
        expect(formatDuration(undefined)).toBe("Unknown");
    });
});

describe("isIsoDuration", () => {
    it("accepts valid and rejects invalid durations", () => {
        expect(isIsoDuration("P1Y")).toBe(true);
        expect(isIsoDuration("PT1H30M")).toBe(true);
        expect(isIsoDuration("P")).toBe(false);
        expect(isIsoDuration("PT")).toBe(false);
        expect(isIsoDuration("8 hours")).toBe(false);
        expect(isIsoDuration(undefined)).toBe(false);
    });
});

describe("hoursToIso and parseHours round-trip", () => {
    it("handles whole and fractional hours", () => {
        expect(hoursToIso(8)).toBe("PT8H");
        expect(hoursToIso(0.5)).toBe("PT30M");
        expect(hoursToIso(1.5)).toBe("PT1H30M");
        expect(parseHours("PT1H30M")).toBe(1.5);
        expect(parseHours(hoursToIso(2.5))).toBe(2.5);
    });
});
