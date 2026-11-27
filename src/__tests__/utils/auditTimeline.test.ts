import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/types/audit.types";
import {
    AUDIT_MIN_SPAN,
    AUDIT_WHOLE,
    applyKey,
    auditWindow,
    axisLabels,
    dragEnd,
    dragNew,
    dragSelection,
    dragStart,
    formatTimelineStamp,
    fractionToTime,
    fractionsToRange,
    inRange,
    keyDelta,
    moveBand,
    parseAuditRange,
    pointerFraction,
    rangeToFractions,
    rangeToUrl,
    sameRange,
    timeToFraction,
    timelineRows,
} from "@/utils/auditTimeline";

// Invented data only: Contoso names and made-up ids.
const DAY = 86_400_000;
const READ_AT = "2026-11-05T12:00:00Z";
const WINDOW = auditWindow(READ_AT, 10)!;
const FORMAT = { timeZone: "UTC", locale: "en-GB" } as const;

function event(id: string, time: string, overrides: Partial<AuditEvent> = {}): AuditEvent {
    return {
        id,
        time,
        kind: "usage",
        environment: "role",
        sentence: `Megan Bowen activated Security Administrator (${id})`,
        actor: { name: "Megan Bowen", id: "u-megan", kind: "person" },
        role: { name: "Security Administrator", id: "r-sec" },
        scope: "Contoso",
        result: "success",
        source: "graph",
        correlationId: `c-${id}`,
        ...overrides,
    };
}

describe("auditWindow", () => {
    it("ends at the read and starts `days` before it", () => {
        expect(WINDOW.end).toBe(Date.parse(READ_AT));
        expect(WINDOW.start).toBe(Date.parse(READ_AT) - 10 * DAY);
    });

    it("is none before a read has happened, or for rubbish", () => {
        expect(auditWindow(null, 30)).toBeNull();
        expect(auditWindow("", 30)).toBeNull();
        expect(auditWindow("not a time", 30)).toBeNull();
        expect(auditWindow(READ_AT, 0)).toBeNull();
        expect(auditWindow(READ_AT, 1.5)).toBeNull();
    });
});

describe("fractions and times", () => {
    it("converts both ways", () => {
        expect(timeToFraction(WINDOW.start, WINDOW)).toBe(0);
        expect(timeToFraction(WINDOW.end, WINDOW)).toBe(1);
        expect(timeToFraction(WINDOW.start + 5 * DAY, WINDOW)).toBe(0.5);
        expect(fractionToTime(0.25, WINDOW)).toBe(WINDOW.start + 2.5 * DAY);
    });

    it("clamps the pointer to the track and survives a track without width", () => {
        expect(pointerFraction(50, 100, 200)).toBe(0);
        expect(pointerFraction(150, 100, 200)).toBe(0.25);
        expect(pointerFraction(900, 100, 200)).toBe(1);
        expect(pointerFraction(150, 100, 0)).toBe(0);
    });
});

describe("dragging", () => {
    it("makes a new selection in either direction, never narrower than the minimum", () => {
        expect(dragNew(0.2, 0.6)).toEqual({ a: 0.2, b: 0.6 });
        expect(dragNew(0.6, 0.2)).toEqual({ a: 0.2, b: 0.6 });
        const narrow = dragNew(0.5, 0.5);
        expect(narrow.b - narrow.a).toBeCloseTo(AUDIT_MIN_SPAN, 10);
        expect(dragNew(1, 1)).toEqual({ a: 1 - AUDIT_MIN_SPAN, b: 1 });
    });

    it("stops a handle short of the other one and at the ends of the window", () => {
        const current = { a: 0.2, b: 0.6 };
        expect(dragStart(0.4, current)).toEqual({ a: 0.4, b: 0.6 });
        expect(dragStart(0.9, current).a).toBeCloseTo(0.6 - AUDIT_MIN_SPAN, 10);
        expect(dragStart(-1, current).a).toBe(0);
        expect(dragEnd(0.8, current)).toEqual({ a: 0.2, b: 0.8 });
        expect(dragEnd(0.1, current).b).toBeCloseTo(0.2 + AUDIT_MIN_SPAN, 10);
        expect(dragEnd(2, current).b).toBe(1);
    });

    it("moves the band with its width kept, inside the window", () => {
        const band = { a: 0.2, b: 0.5 };
        const right = moveBand(band, 0.1);
        expect(right.a).toBeCloseTo(0.3, 10);
        expect(right.b - right.a).toBeCloseTo(0.3, 10);
        expect(moveBand(band, -1)).toEqual({ a: 0, b: 0.3 });
        const end = moveBand(band, 1);
        expect(end.b).toBeCloseTo(1, 10);
        expect(end.b - end.a).toBeCloseTo(0.3, 10);
    });

    it("lets a handle and the band follow the distance moved, not the position of the pointer", () => {
        const origin = { a: 0.2, b: 0.6 };
        // Grabbed 0.01 right of the start handle: the handle moves by what the pointer moved
        expect(dragSelection("start", origin, 0.21, 0.31).a).toBeCloseTo(0.3, 10);
        expect(dragSelection("end", origin, 0.59, 0.49).b).toBeCloseTo(0.5, 10);
        expect(dragSelection("move", origin, 0.3, 0.4).a).toBeCloseTo(0.3, 10);
        expect(dragSelection("new", origin, 0.3, 0.1)).toEqual({ a: 0.1, b: 0.3 });
    });
});

describe("keyboard", () => {
    it("steps a day with an arrow, seven with Shift, and to the ends with Home and End", () => {
        expect(keyDelta("ArrowRight", false, 10)).toBeCloseTo(0.1, 10);
        expect(keyDelta("ArrowUp", false, 10)).toBeCloseTo(0.1, 10);
        expect(keyDelta("ArrowLeft", true, 14)).toBeCloseTo(-0.5, 10);
        expect(keyDelta("ArrowDown", false, 10)).toBeCloseTo(-0.1, 10);
        expect(keyDelta("Home", false, 10)).toBe(-1);
        expect(keyDelta("End", true, 10)).toBe(1);
        expect(keyDelta("a", false, 10)).toBeNull();
        expect(keyDelta("Tab", false, 10)).toBeNull();
    });

    it("applies a step to a handle or the band within the clamps", () => {
        const current = { a: 0.2, b: 0.6 };
        expect(applyKey("start", current, 0.1).a).toBeCloseTo(0.3, 10);
        expect(applyKey("start", current, 1).a).toBeCloseTo(0.6 - AUDIT_MIN_SPAN, 10);
        expect(applyKey("start", current, -1).a).toBe(0);
        expect(applyKey("end", current, -1).b).toBeCloseTo(0.2 + AUDIT_MIN_SPAN, 10);
        expect(applyKey("end", current, 1).b).toBe(1);
        expect(applyKey("move", current, 1).a).toBeCloseTo(0.6, 10);
        expect(applyKey("move", current, 1).b).toBeCloseTo(1, 10);
        expect(applyKey("move", current, -1).a).toBe(0);
    });
});

describe("range and fractions", () => {
    it("shows no selection as the whole window, and the whole window as no selection", () => {
        expect(rangeToFractions(undefined, WINDOW)).toEqual(AUDIT_WHOLE);
        expect(fractionsToRange(AUDIT_WHOLE, WINDOW)).toBeUndefined();
    });

    it("round-trips a selection in whole milliseconds inside the window", () => {
        const range = fractionsToRange({ a: 0.25, b: 0.75 }, WINDOW);
        expect(range).toEqual({ from: WINDOW.start + 2.5 * DAY, to: WINDOW.start + 7.5 * DAY });
        expect(rangeToFractions(range, WINDOW)).toEqual({ a: 0.25, b: 0.75 });
        expect(Number.isInteger(fractionsToRange({ a: 0.123456789, b: 0.987654321 }, WINDOW)?.from)).toBe(true);
    });

    it("keeps a selection that reaches one end of the window", () => {
        expect(fractionsToRange({ a: 0, b: 0.5 }, WINDOW)).toEqual({ from: WINDOW.start, to: WINDOW.start + 5 * DAY });
        expect(fractionsToRange({ a: 0.5, b: 1 }, WINDOW)).toEqual({ from: WINDOW.start + 5 * DAY, to: WINDOW.end });
    });

    it("compares two ranges, and writes one to the URL as ISO times", () => {
        expect(sameRange(undefined, undefined)).toBe(true);
        expect(sameRange({ from: 1, to: 2 }, { from: 1, to: 2 })).toBe(true);
        expect(sameRange({ from: 1, to: 2 }, { from: 1, to: 3 })).toBe(false);
        expect(sameRange({ from: 1, to: 2 }, undefined)).toBe(false);
        expect(rangeToUrl({ from: Date.parse("2026-11-01T00:00:00Z"), to: Date.parse("2026-11-03T12:30:00Z") })).toEqual({
            from: "2026-11-01T00:00:00.000Z",
            to: "2026-11-03T12:30:00.000Z",
        });
    });

    it("holds the ends of a selection and every time without one", () => {
        const range = { from: 100, to: 200 };
        expect(inRange(100, range)).toBe(true);
        expect(inRange(200, range)).toBe(true);
        expect(inRange(99, range)).toBe(false);
        expect(inRange(201, range)).toBe(false);
        expect(inRange(5, undefined)).toBe(true);
    });
});

describe("parseAuditRange", () => {
    it("reads two times that lie inside the window", () => {
        expect(parseAuditRange("2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z", WINDOW)).toEqual({
            from: Date.parse("2026-11-01T00:00:00Z"),
            to: Date.parse("2026-11-03T00:00:00Z"),
        });
    });

    it("ignores, and never throws on, rubbish, a missing side, a time outside the window or from after to", () => {
        expect(parseAuditRange("rubbish", "2026-11-03T00:00:00Z", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-01T00:00:00Z", "rubbish", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-01T00:00:00Z", undefined, WINDOW)).toBeUndefined();
        expect(parseAuditRange(undefined, undefined, WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-10-01T00:00:00Z", "2026-11-03T00:00:00Z", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-01T00:00:00Z", "2026-11-09T00:00:00Z", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-04T00:00:00Z", "2026-11-02T00:00:00Z", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-02T00:00:00Z", "2026-11-02T00:00:00Z", WINDOW)).toBeUndefined();
        expect(parseAuditRange("2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z", null)).toBeUndefined();
    });

    it("treats the whole window as no selection and a window edge as inside", () => {
        expect(parseAuditRange(new Date(WINDOW.start).toISOString(), new Date(WINDOW.end).toISOString(), WINDOW)).toBeUndefined();
        expect(parseAuditRange(new Date(WINDOW.start).toISOString(), "2026-11-01T00:00:00Z", WINDOW)).toEqual({ from: WINDOW.start, to: Date.parse("2026-11-01T00:00:00Z") });
    });
});

describe("axis labels", () => {
    it("gives five labels at 0, 25, 50, 75 and 100 percent, aligned start, centre and end", () => {
        const labels = axisLabels(WINDOW, FORMAT);
        expect(labels.map((label) => label.fraction)).toEqual([0, 0.25, 0.5, 0.75, 1]);
        expect(labels.map((label) => label.align)).toEqual(["start", "center", "center", "center", "end"]);
        expect(labels[0].text).toBe("26 Oct");
        expect(labels[2].text).toBe("31 Oct");
        expect(labels[4].text).toBe("5 Nov");
    });

    it("writes the time in the shown zone", () => {
        const time = Date.parse("2026-11-05T09:42:00Z");
        expect(formatTimelineStamp(time, FORMAT)).toContain("09:42");
        expect(formatTimelineStamp(time, { ...FORMAT, timeZone: "Asia/Tokyo" })).toContain("18:42");
        expect(formatTimelineStamp(Number.NaN, FORMAT)).toBe("");
    });
});

describe("timelineRows", () => {
    const events = [
        event("late", "2026-11-04T10:00:00Z"),
        event("early", "2026-10-28T08:00:00Z"),
        event("failed", "2026-11-02T08:00:00Z", { result: "failure" }),
        event("setting", "2026-11-03T08:00:00Z", { kind: "setting" }),
        event("system", "2026-11-03T09:00:00Z", { kind: "system" }),
        event("before", "2026-10-01T08:00:00Z"),
        event("after", "2026-11-06T08:00:00Z"),
        event("rubbish", "not a time"),
    ];

    it("gives one row per chosen kind, in the order of the chips, with the points of that kind", () => {
        const rows = timelineRows(events, ["system", "usage", "setting"], WINDOW);
        expect(rows.map((row) => row.kind)).toEqual(["usage", "setting", "system"]);
        expect(rows[0].points.map((point) => point.id)).toEqual(["early", "failed", "late"]);
        expect(rows[1].points.map((point) => point.id)).toEqual(["setting"]);
        expect(rows[2].points.map((point) => point.id)).toEqual(["system"]);
    });

    it("leaves out events outside the window and with a time that does not parse", () => {
        const ids = timelineRows(events, ["usage"], WINDOW)[0].points.map((point) => point.id);
        expect(ids).not.toContain("before");
        expect(ids).not.toContain("after");
        expect(ids).not.toContain("rubbish");
    });

    it("marks a failed event and places each point between 0 and 1", () => {
        const points = timelineRows(events, ["usage"], WINDOW)[0].points;
        expect(points.find((point) => point.id === "failed")?.isFailed).toBe(true);
        expect(points.find((point) => point.id === "late")?.isFailed).toBe(false);
        for (const point of points) {
            expect(point.fraction).toBeGreaterThanOrEqual(0);
            expect(point.fraction).toBeLessThanOrEqual(1);
        }
    });

    it("tells a denied event from a plain failure", () => {
        const points = timelineRows([event("denied", "2026-11-02T08:00:00Z", { result: "failure", denied: true }), event("plain", "2026-11-02T09:00:00Z", { result: "failure" })], ["usage"], WINDOW)[0].points;
        expect(points.find((point) => point.id === "denied")).toMatchObject({ isFailed: true, isDenied: true });
        expect(points.find((point) => point.id === "plain")).toMatchObject({ isFailed: true, isDenied: false });
    });

    it("keeps a row with no points", () => {
        const rows = timelineRows([], ["usage", "outside"], WINDOW);
        expect(rows.map((row) => [row.kind, row.points.length])).toEqual([["usage", 0], ["outside", 0]]);
    });
});
