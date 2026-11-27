"use client";

import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import type { AuditKind } from "@/types/audit.types";
import {
    applyKey,
    axisLabels,
    dragSelection,
    formatTimelineStamp,
    fractionToTime,
    fractionsToRange,
    keyDelta,
    pointerFraction,
    rangeToFractions,
    type AuditDragMode,
    type AuditFractions,
    type AuditRange,
    type AuditTimelineFormat,
    type AuditWindow,
    type TimelinePoint,
    type TimelineRow,
} from "@/utils/auditTimeline";
import { AUDIT_MAX_DAYS } from "@/utils/auditUrlState";
import { AUDIT_KIND_ICONS, AUDIT_KIND_LABELS, auditPointText, formatActionCount, periodLimitHint } from "@/utils/auditView";
import { TEXT_SELECTION_IGNORED } from "@/utils/auditNoActivation";
import { AuditKindIcon } from "./AuditEventList";

/** Pixels the pointer must travel before a press on a track becomes a drag: a click on a point is not a tiny drag */
const DRAG_THRESHOLD_PX = 3;

/** The label column: from 128 px, never wider; below 640 it wraps above its track (flex wrap, as the canvas) */
const LABEL_COLUMN = "max-w-32 flex-[1_0_128px]";
const TRACK_COLUMN = "min-w-0 flex-[999_1_240px]";

const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;

/** "Last [30] days": the number is committed on blur or Enter, a whole number from 1 to the longest period; rubbish goes back to the last valid value */
function PeriodField({ days, maxDays, ownLogDays, isWorkspace, onChange }: { days: number; maxDays: number; ownLogDays: number; isWorkspace: boolean; onChange: (days: number) => void }) {
    const [draft, setDraft] = useState(String(days));
    const [seenDays, setSeenDays] = useState(days);
    if (days !== seenDays) {
        setSeenDays(days);
        setDraft(String(days));
    }
    const commit = () => {
        const text = draft.trim();
        const next = /^\d{1,6}$/.test(text) ? Math.min(Math.max(Number(text), 1), maxDays) : days;
        setDraft(String(next));
        if (next !== days) onChange(next);
    };
    return (
        <div className="flex flex-wrap items-center gap-2 text-[13px] leading-5 text-ink">
            <label htmlFor="audit-days">Last</label>
            <input
                id="audit-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxDays}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                }}
                className="h-[34px] w-[72px] rounded-md border border-line bg-surface px-2 text-right font-mono text-[13px] text-ink max-sm:h-11"
            />
            <span>days</span>
            {days >= maxDays && <span className="text-xs leading-[17px] text-muted">{periodLimitHint(isWorkspace, maxDays, ownLogDays)}</span>}
        </div>
    );
}

/** The ring of a point: the kind's icon at 12 px, grid-centred, with the shift that puts its artwork in the middle */
function PointRing({ kind, isFailed, isSelected }: { kind: AuditKind; isFailed: boolean; isSelected: boolean }) {
    const icon = AUDIT_KIND_ICONS[kind];
    const edge = isFailed ? "border-dashed border-danger-text" : "border-(--kind)";
    const outline = isSelected ? "outline-2 outline-offset-1 outline-ink" : "group-hover:outline-1 group-hover:outline-offset-1 group-hover:outline-ink";
    return (
        <span className={`box-border grid size-[18px] place-items-center rounded-full border bg-surface ${edge} ${outline}`}>
            <span className={`audit-ring-icon-${icon} inline-flex text-(--kind) [--pim-icon-accent:var(--kind)]`}>
                <Icon name={icon} size={12} />
            </span>
        </span>
    );
}

const TOOLTIP_WIDTH = 280;

interface PointTip {
    point: TimelinePoint;
    top: number;
    left: number;
    /** Opens above the point when there is no room below it */
    isAbove: boolean;
}

/** The tooltip of a point: what its icon and ring mean. Same look and placing as the tip of `Tag`. Hidden from screen readers, as the name of the point says the same. */
function PointTooltip({ tip, isSelected, format }: { tip: PointTip; isSelected: boolean; format: AuditTimelineFormat }) {
    const text = auditPointText(tip.point, isSelected);
    return (
        <div
            aria-hidden="true"
            style={{ top: tip.top, left: tip.left, maxWidth: TOOLTIP_WIDTH, transform: tip.isAbove ? "translateY(-100%)" : undefined }}
            className="pointer-events-none fixed z-50 w-max max-w-[calc(100vw-16px)] rounded border border-line bg-surface px-3 py-2 text-[12px] leading-[18px] font-normal whitespace-normal text-ink shadow-menu"
        >
            <div className="flex items-center gap-2 font-semibold">
                <AuditKindIcon kind={tip.point.kind} />
                <span>{text.kind}</span>
                {text.result && <Tag variant="danger">{text.result}</Tag>}
            </div>
            <p className="mt-1">{tip.point.sentence}</p>
            <p className="mt-1 font-mono text-xs text-muted">{formatTimelineStamp(tip.point.time, format)}</p>
            {text.marks.map((mark) => <p key={mark} className="mt-1 text-muted">{mark}</p>)}
        </div>
    );
}

interface AuditTimelineProps {
    days: number;
    /** The longest period the source offers (30 for the Entra audit log, the longest retention of the chosen workspaces) */
    maxDays?: number;
    /** The events come from chosen workspaces: the period's limit is theirs */
    isWorkspace?: boolean;
    /** The days the page's own log keeps (30 on Entra, 90 on Azure); a workspace that keeps no more than this does not raise the limit */
    ownLogDays?: number;
    onDaysChange: (days: number) => void;
    /** The coverage line, on the right of the period */
    coverage: string;
    period: AuditWindow;
    /** One row per visible kind; the points follow every filter but the selection */
    rows: readonly TimelineRow[];
    /** The selection as shown now: the live one while it is dragged, else the one of the URL; none is the whole period */
    range: AuditRange | undefined;
    /** The event shown in the detail */
    selectedId: string | undefined;
    /** How many actions the list holds under the filters and the selection */
    actionCount: number;
    format: AuditTimelineFormat;
    /** The selection while it is dragged (null: cleared); called on every move */
    onLive: (range: AuditRange | null) => void;
    /** The selection when the drag is over, or a key was pressed (null: cleared) */
    onCommit: (range: AuditRange | null) => void;
    /** A click on a point */
    onPick: (point: TimelinePoint) => void;
    /** The No activation view is on: the selection stays on the card and comes back in Events, but the view does not use it, and the card says so */
    ignoresSelection?: boolean;
}

/**
 * The timeline card (AU-4, canvas `Main.dc.html`): the period and the coverage line, a row of points for each kind, the date
 * axis, the Selection row with its band and handles, and the text of the selection. A drag across a track or the Selection
 * row starts a new selection; a press without movement clears it (not on a point). The handles move one side, the band both.
 * The selection is in continuous time, and `onLive` reports it on every move so the list and the counts follow the pointer.
 * The listeners of a drag sit on `window` and are removed on release, on cancel and on unmount.
 */
export function AuditTimeline({ days, maxDays = AUDIT_MAX_DAYS, ownLogDays = AUDIT_MAX_DAYS, isWorkspace = false, onDaysChange, coverage, period, rows, range, selectedId, actionCount, format, onLive, onCommit, onPick, ignoresSelection = false }: AuditTimelineProps) {
    const fractions = rangeToFractions(range, period);
    const isSelected = range !== undefined;
    const labels = axisLabels(period, format);

    // The drag reads the latest props through this holder, so the listeners it adds once never see a stale selection
    const latest = useRef({ period, fractions, onLive, onCommit });
    useEffect(() => {
        latest.current = { period, fractions, onLive, onCommit };
    });
    const stopDrag = useRef<(() => void) | null>(null);
    useEffect(() => () => stopDrag.current?.(), []);
    // A drag that began on a point must not also click it
    const swallowClick = useRef(false);

    // The one open tooltip. It shows only while its point is still in the rows (worked out here, no effect sets state)
    const [tip, setTip] = useState<PointTip | null>(null);
    const livePoint = tip ? rows.flatMap((row) => row.points).find((point) => point.id === tip.point.id) : undefined;
    // A tip whose point left the rows is dropped while rendering, so it cannot come back by itself
    if (tip && !livePoint) setTip(null);
    const shownTip = tip && livePoint ? { ...tip, point: livePoint } : null;
    const isTipOpen = shownTip !== null;
    const openTip = (target: HTMLElement, point: TimelinePoint) => {
        const rect = target.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - TOOLTIP_WIDTH - 8));
        const isAbove = window.innerHeight - rect.bottom < 120 && rect.top > 120;
        setTip({ point, top: isAbove ? rect.top - 6 : rect.bottom + 6, left, isAbove });
    };
    // The listeners exist only while a tooltip is open
    useEffect(() => {
        if (!isTipOpen) return;
        // Capture phase: Escape closes the tooltip and nothing around it
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            event.preventDefault();
            setTip(null);
        };
        const onScroll = () => setTip(null);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        return () => {
            document.removeEventListener("keydown", onKey, true);
            window.removeEventListener("scroll", onScroll, true);
        };
    }, [isTipOpen]);

    const beginDrag = (event: ReactPointerEvent<HTMLElement>, mode: AuditDragMode) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const track = event.currentTarget.closest<HTMLElement>("[data-timeline-track]");
        if (!track) return;
        event.preventDefault();
        event.stopPropagation();
        stopDrag.current?.();

        const rect = track.getBoundingClientRect();
        const startX = event.clientX;
        const startPointer = pointerFraction(startX, rect.left, rect.width);
        const origin = latest.current.fractions;
        const onPoint = event.currentTarget.hasAttribute("data-timeline-point");
        let moved = false;
        let last: AuditFractions | null = null;

        const onMove = (move: PointerEvent) => {
            if (!moved && mode === "new" && Math.abs(move.clientX - startX) < DRAG_THRESHOLD_PX) return;
            moved = true;
            last = dragSelection(mode, origin, startPointer, pointerFraction(move.clientX, rect.left, rect.width));
            latest.current.onLive(fractionsToRange(last, latest.current.period) ?? null);
        };
        const stop = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            stopDrag.current = null;
        };
        const finish = () => {
            if (moved && last) latest.current.onCommit(fractionsToRange(last, latest.current.period) ?? null);
            else if (mode === "new" && !onPoint) latest.current.onCommit(null);
            if (moved && onPoint) {
                swallowClick.current = true;
                setTimeout(() => {
                    swallowClick.current = false;
                }, 0);
            }
        };
        const onUp = () => {
            stop();
            finish();
        };
        const onCancel = () => {
            stop();
            if (moved && last) latest.current.onCommit(fractionsToRange(last, latest.current.period) ?? null);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        stopDrag.current = stop;
    };

    const handleKey = (event: ReactKeyboardEvent<HTMLElement>, mode: Exclude<AuditDragMode, "new">) => {
        const delta = keyDelta(event.key, event.shiftKey, days);
        if (delta === null) return;
        event.preventDefault();
        onCommit(fractionsToRange(applyKey(mode, fractions, delta), period) ?? null);
    };

    const fromText = formatTimelineStamp(fractionToTime(fractions.a, period), format);
    const toText = formatTimelineStamp(fractionToTime(fractions.b, period), format);

    return (
        <section data-tour="audit-timeline" data-visual-section="audit-timeline" aria-label="Timeline" className="rounded border border-line border-t-[3px] border-t-accent bg-surface p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <PeriodField days={days} maxDays={maxDays} ownLogDays={ownLogDays} isWorkspace={isWorkspace} onChange={onDaysChange} />
                <p className="text-xs leading-[17px] text-muted">{coverage}</p>
            </div>

            {rows.map((row) => (
                <div key={row.kind} className="flex min-h-7 flex-wrap items-center gap-x-3">
                    <div className={`${LABEL_COLUMN} flex items-center gap-2 text-xs leading-[17px] text-ink`}>
                        <AuditKindIcon kind={row.kind} />
                        <span>{AUDIT_KIND_LABELS[row.kind]}</span>
                        <span className="ml-auto font-mono text-muted">{row.points.length}</span>
                    </div>
                    <div
                        data-timeline-track=""
                        onPointerDown={(event) => beginDrag(event, "new")}
                        className={`audit-kind-${row.kind} relative h-7 cursor-crosshair touch-none border-b border-line select-none ${TRACK_COLUMN}`}
                    >
                        <div className="absolute inset-y-0 left-0 bg-band" style={{ width: percent(fractions.a) }} />
                        <div className="absolute inset-y-0 right-0 bg-band" style={{ width: percent(1 - fractions.b) }} />
                        {row.points.map((point) => {
                            const text = auditPointText(point, point.id === selectedId);
                            const name = `${formatTimelineStamp(point.time, format)}: ${point.sentence}. ${text.kind}${text.result ? `, ${text.result.toLowerCase()}` : ""}`;
                            return (
                                <button
                                    key={point.id}
                                    type="button"
                                    data-timeline-point=""
                                    // The list holds the same events for the keyboard (arrow keys, Enter), so Tab does not walk through every point
                                    tabIndex={-1}
                                    aria-label={name}
                                    onPointerEnter={(event) => {
                                        if (event.pointerType === "mouse" && stopDrag.current === null) openTip(event.currentTarget, point);
                                    }}
                                    onPointerLeave={() => setTip(null)}
                                    onFocus={(event: ReactFocusEvent<HTMLElement>) => {
                                        if (event.currentTarget.matches(":focus-visible")) openTip(event.currentTarget, point);
                                    }}
                                    onBlur={() => setTip(null)}
                                    onPointerDown={(event) => {
                                        setTip(null);
                                        beginDrag(event, "new");
                                    }}
                                    onClick={() => {
                                        if (swallowClick.current) return;
                                        onPick(point);
                                    }}
                                    style={{ left: percent(point.fraction) }}
                                    className={`group absolute top-0.5 -ml-3 grid size-6 cursor-pointer touch-none place-items-center p-0 hover:z-[2] ${point.id === selectedId ? "z-[2]" : point.isFailed ? "z-[1]" : ""}`}
                                >
                                    <PointRing kind={point.kind} isFailed={point.isFailed} isSelected={point.id === selectedId} />
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            <div className="flex flex-wrap gap-x-3">
                <div className={LABEL_COLUMN} />
                <div className={`relative h-5 font-mono text-[11px] leading-5 text-muted ${TRACK_COLUMN}`}>
                    {labels.map((label) => (
                        <span
                            key={label.fraction}
                            className={`absolute whitespace-nowrap ${label.align === "center" ? "-translate-x-1/2" : label.align === "end" ? "-translate-x-full" : ""}`}
                            style={{ left: percent(label.fraction) }}
                        >
                            {label.text}
                        </span>
                    ))}
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3">
                <div className={`${LABEL_COLUMN} text-xs leading-[17px] text-muted`}>Selection</div>
                <div data-timeline-track="" onPointerDown={(event) => beginDrag(event, "new")} className={`relative h-6 touch-none select-none ${TRACK_COLUMN}`}>
                    <div className="absolute inset-x-0 top-[11px] h-0.5 bg-track" />
                    <button
                        type="button"
                        aria-label="Move the selection"
                        onPointerDown={(event) => beginDrag(event, "move")}
                        onKeyDown={(event) => handleKey(event, "move")}
                        style={{ left: percent(fractions.a), width: percent(fractions.b - fractions.a) }}
                        className="absolute top-2 h-2 cursor-grab touch-none border-0 bg-accent p-0 active:cursor-grabbing before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"
                    />
                    <button
                        type="button"
                        role="slider"
                        aria-label="Start of the selection"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(fractions.a * 100)}
                        aria-valuetext={fromText}
                        onPointerDown={(event) => beginDrag(event, "start")}
                        onKeyDown={(event) => handleKey(event, "start")}
                        style={{ left: percent(fractions.a) }}
                        className="absolute top-0 -ml-1.5 box-border h-6 w-3 cursor-ew-resize touch-none rounded border-2 border-accent bg-surface p-0"
                    />
                    <button
                        type="button"
                        role="slider"
                        aria-label="End of the selection"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(fractions.b * 100)}
                        aria-valuetext={toText}
                        onPointerDown={(event) => beginDrag(event, "end")}
                        onKeyDown={(event) => handleKey(event, "end")}
                        style={{ left: percent(fractions.b) }}
                        className="absolute top-0 -ml-1.5 box-border h-6 w-3 cursor-ew-resize touch-none rounded border-2 border-accent bg-surface p-0"
                    />
                </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-[17px] text-muted">
                <span className="font-mono">{fromText} to {toText}</span>
                {!ignoresSelection && <span>{formatActionCount(actionCount)}</span>}
                {ignoresSelection && isSelected && <span className="text-body">{TEXT_SELECTION_IGNORED}</span>}
                {isSelected && <Button size="sm" onClick={() => onCommit(null)}>Whole period</Button>}
                <span className="ml-auto">Drag across the timeline to select a stretch of time.</span>
            </div>
            {shownTip && <PointTooltip tip={shownTip} isSelected={shownTip.point.id === selectedId} format={format} />}
        </section>
    );
}
