import type { AuditEvent, AuditKind } from "@/types/audit.types";
import { AUDIT_KINDS } from "@/utils/auditUrlState";

/**
 * The maths of the timeline card on the Audit page (AU-4): time and fraction of the window, the selection as two
 * fractions while it is dragged and as two times once it is kept, clamping with a minimum width, moving the band, the
 * keyboard steps, the axis labels and the points per kind. Pure: no DOM, no state, so every rule here is tested.
 * A fraction is a position on the track, 0 at the start of the window and 1 at its end.
 */

const DAY_MS = 86_400_000;

/** The least width of a selection as a fraction of the window: a handle cannot pass the other one */
export const AUDIT_MIN_SPAN = 0.002;

/** The period shown: it ends when the last read finished and starts `days` before that */
export interface AuditWindow {
    /** ms since the epoch */
    start: number;
    end: number;
}

/** A kept selection, in ms since the epoch; `from` is before `to` */
export interface AuditRange {
    from: number;
    to: number;
}

/** The selection while it is dragged: positions on the track */
export interface AuditFractions {
    a: number;
    b: number;
}

export type AuditDragMode = "new" | "start" | "end" | "move";

/** The window of a read, or null before a read has happened (no timeline then) */
export function auditWindow(readAt: string | null | undefined, days: number): AuditWindow | null {
    if (!readAt || !Number.isInteger(days) || days < 1) return null;
    const end = Date.parse(readAt);
    if (!Number.isFinite(end)) return null;
    return { start: end - days * DAY_MS, end };
}

export function clampNumber(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

/** Where a time lies on the track; not clamped, so a time outside the window gives a value outside 0 to 1 */
export function timeToFraction(time: number, window: AuditWindow): number {
    return (time - window.start) / (window.end - window.start);
}

/** The time at a position of the track */
export function fractionToTime(fraction: number, window: AuditWindow): number {
    return window.start + fraction * (window.end - window.start);
}

/** The position of the pointer on a track of `width` pixels that starts at `left`, clamped to 0 to 1 */
export function pointerFraction(clientX: number, left: number, width: number): number {
    if (!(width > 0)) return 0;
    return clampNumber((clientX - left) / width, 0, 1);
}

// The selection while it is dragged ----------------------------------------------------------------------------------------

/** The whole window: nothing is selected */
export const AUDIT_WHOLE: AuditFractions = { a: 0, b: 1 };

/** True when the fractions cover the whole window, which is "nothing selected" */
export function isWhole({ a, b }: AuditFractions): boolean {
    return a <= 0 && b >= 1;
}

/** A new selection from where the press began to where the pointer is, wide enough to hold two handles */
export function dragNew(start: number, pointer: number): AuditFractions {
    const a = Math.min(start, pointer);
    const b = Math.max(start, pointer);
    if (b - a >= AUDIT_MIN_SPAN) return { a, b };
    return a + AUDIT_MIN_SPAN <= 1 ? { a, b: a + AUDIT_MIN_SPAN } : { a: 1 - AUDIT_MIN_SPAN, b: 1 };
}

/** The start handle at `position`: it stops short of the end handle */
export function dragStart(position: number, current: AuditFractions): AuditFractions {
    return { a: clampNumber(position, 0, current.b - AUDIT_MIN_SPAN), b: current.b };
}

/** The end handle at `position`: it stops short of the start handle */
export function dragEnd(position: number, current: AuditFractions): AuditFractions {
    return { a: current.a, b: clampNumber(position, current.a + AUDIT_MIN_SPAN, 1) };
}

/** The band moved by `delta`, keeping its width and staying inside the window */
export function moveBand(origin: AuditFractions, delta: number): AuditFractions {
    const width = origin.b - origin.a;
    const a = clampNumber(origin.a + delta, 0, 1 - width);
    return { a, b: a + width };
}

/**
 * The selection for a drag in progress: where it began (`origin`, `startPointer`) and where the pointer is now. A handle and
 * the band follow the distance the pointer has moved, not its position, so grabbing a handle off its centre does not make
 * it jump.
 */
export function dragSelection(mode: AuditDragMode, origin: AuditFractions, startPointer: number, pointer: number): AuditFractions {
    const delta = pointer - startPointer;
    if (mode === "new") return dragNew(startPointer, pointer);
    if (mode === "start") return dragStart(origin.a + delta, origin);
    if (mode === "end") return dragEnd(origin.b + delta, origin);
    return moveBand(origin, delta);
}

// Keyboard -------------------------------------------------------------------------------------------------------------------

/**
 * The step of a key as a fraction of the window: arrows one day, with Shift seven, Home all the way back and End all the way
 * forward. Null for a key that does nothing here.
 */
export function keyDelta(key: string, shiftKey: boolean, days: number): number | null {
    const step = (shiftKey ? 7 : 1) / days;
    if (key === "ArrowLeft" || key === "ArrowDown") return -step;
    if (key === "ArrowRight" || key === "ArrowUp") return step;
    if (key === "Home") return -1;
    if (key === "End") return 1;
    return null;
}

/** The selection after a key on the start handle, the end handle or the band */
export function applyKey(mode: Exclude<AuditDragMode, "new">, current: AuditFractions, delta: number): AuditFractions {
    if (mode === "start") return { a: clampNumber(current.a + delta, 0, current.b - AUDIT_MIN_SPAN), b: current.b };
    if (mode === "end") return { a: current.a, b: clampNumber(current.b + delta, current.a + AUDIT_MIN_SPAN, 1) };
    return moveBand(current, delta);
}

// Fractions and times --------------------------------------------------------------------------------------------------------

/** The selection of a range as positions; no range is the whole window. A range that leaves the window is cut to it. */
export function rangeToFractions(range: AuditRange | undefined, window: AuditWindow): AuditFractions {
    if (!range) return AUDIT_WHOLE;
    return {
        a: clampNumber(timeToFraction(range.from, window), 0, 1),
        b: clampNumber(timeToFraction(range.to, window), 0, 1),
    };
}

/**
 * The kept selection of some positions, in whole ms inside the window; undefined when it covers the whole window.
 * A pointer position is clamped to 0 and 1, so a drag to an end of the track lands exactly on the end of the window.
 */
export function fractionsToRange(fractions: AuditFractions, window: AuditWindow): AuditRange | undefined {
    if (isWhole(fractions)) return undefined;
    const from = clampNumber(Math.round(fractionToTime(fractions.a, window)), window.start, window.end);
    const to = clampNumber(Math.round(fractionToTime(fractions.b, window)), window.start, window.end);
    if (from <= window.start && to >= window.end) return undefined;
    return to > from ? { from, to } : undefined;
}

export function sameRange(a: AuditRange | undefined, b: AuditRange | undefined): boolean {
    if (!a || !b) return !a && !b;
    return a.from === b.from && a.to === b.to;
}

/** The `from` and `to` of the URL: ISO times, UTC */
export function rangeToUrl(range: AuditRange): { from: string; to: string } {
    return { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() };
}

/**
 * The selection of a link. Both times are needed. A time that does not parse, one outside the window, or `from` not before
 * `to` gives no selection: it is ignored, never thrown on.
 */
export function parseAuditRange(from: string | undefined, to: string | undefined, window: AuditWindow | null): AuditRange | undefined {
    if (!window || !from || !to) return undefined;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return undefined;
    if (start < window.start || end > window.end) return undefined;
    // The whole window is no selection
    return start <= window.start && end >= window.end ? undefined : { from: start, to: end };
}

// Text -----------------------------------------------------------------------------------------------------------------------

/** The zone and locale of the shown times; left out they are the browser's */
export interface AuditTimelineFormat {
    timeZone?: string;
    locale?: string;
}

const formatCache = new Map<string, Intl.DateTimeFormat>();

function formatterOf(kind: "day" | "stamp", format: AuditTimelineFormat): Intl.DateTimeFormat {
    const key = `${kind}|${format.locale ?? ""}|${format.timeZone ?? ""}`;
    let found = formatCache.get(key);
    if (!found) {
        const options: Intl.DateTimeFormatOptions =
            kind === "day"
                ? { day: "numeric", month: "short" }
                : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
        found = new Intl.DateTimeFormat(format.locale, { ...options, timeZone: format.timeZone });
        formatCache.set(key, found);
    }
    return found;
}

/** "5 Nov" of a time in the shown zone */
export function formatAxisDay(time: number, format: AuditTimelineFormat = {}): string {
    return Number.isFinite(time) ? formatterOf("day", format).format(new Date(time)) : "";
}

/** "5 Nov, 09:42" of a time in the shown zone: the date and time of an end of the selection and of a point */
export function formatTimelineStamp(time: number, format: AuditTimelineFormat = {}): string {
    return Number.isFinite(time) ? formatterOf("stamp", format).format(new Date(time)) : "";
}

export type AxisAlign = "start" | "center" | "end";

export interface AxisLabel {
    fraction: number;
    text: string;
    /** The first label starts at its tick, the last ends at it, the others are centred on it */
    align: AxisAlign;
}

/** Five labels at 0, 25, 50, 75 and 100% of the window, in the shown zone */
export function axisLabels(window: AuditWindow, format: AuditTimelineFormat = {}): AxisLabel[] {
    return [0, 0.25, 0.5, 0.75, 1].map((fraction, index) => ({
        fraction,
        text: formatAxisDay(fractionToTime(fraction, window), format),
        align: index === 0 ? "start" : index === 4 ? "end" : "center",
    }));
}

// Points ---------------------------------------------------------------------------------------------------------------------

export interface TimelinePoint {
    id: string;
    kind: AuditKind;
    /** Position on the track, 0 to 1 */
    fraction: number;
    time: number;
    isFailed: boolean;
    /** Failed because an approver denied it */
    isDenied: boolean;
    /** The sentence of the event, for the name of the point */
    sentence: string;
}

export interface TimelineRow {
    kind: AuditKind;
    points: TimelinePoint[];
}

/**
 * One row per kind in `kinds`, in the order of the chips, each with the points of the events of that kind that lie inside the
 * window, oldest first. The caller passes the events that follow every filter but the selection.
 */
export function timelineRows(events: readonly AuditEvent[], kinds: readonly AuditKind[], window: AuditWindow): TimelineRow[] {
    const rows = new Map<AuditKind, TimelinePoint[]>(AUDIT_KINDS.filter((kind) => kinds.includes(kind)).map((kind) => [kind, []]));
    for (const event of events) {
        const time = Date.parse(event.time);
        const row = rows.get(event.kind);
        if (!row || !Number.isFinite(time) || time < window.start || time > window.end) continue;
        row.push({ id: event.id, kind: event.kind, fraction: timeToFraction(time, window), time, isFailed: event.result === "failure", isDenied: event.denied === true, sentence: event.sentence });
    }
    return [...rows].map(([kind, points]) => ({ kind, points: points.sort((x, y) => x.time - y.time) }));
}

/** True when a time lies inside a selection (the ends count); no selection holds every time */
export function inRange(time: number, range: AuditRange | undefined): boolean {
    return !range || (time >= range.from && time <= range.to);
}
