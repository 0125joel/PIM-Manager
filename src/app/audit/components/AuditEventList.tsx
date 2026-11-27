"use client";

import { Icon } from "@/components/icons/Icon";
import { Tag } from "@/components/ui/Tag";
import type { AuditEvent, AuditKind } from "@/types/audit.types";
import {
    AUDIT_KIND_ICONS,
    AUDIT_KIND_ONE,
    auditRowBy,
    auditUsedForShort,
    formatActionCount,
    formatAuditTime,
    isEmergencyEvent,
    type AuditDay,
    type AuditFormat,
} from "@/utils/auditView";
import { ListFrame, ListRowButton } from "@/app/report/components/ListFrame";

/** The icon of a kind in the colour of that kind: line and accent (`.audit-kind-*` sets `--kind`) */
export function AuditKindIcon({ kind, className = "" }: { kind: AuditKind; className?: string }) {
    return (
        <span className={`audit-kind-${kind} inline-flex text-(--kind) [--pim-icon-accent:var(--kind)] ${className}`}>
            <Icon name={AUDIT_KIND_ICONS[kind]} size={14} />
        </span>
    );
}

const EMPTY_TEXT = "No events match these filters in this stretch of time.";

/**
 * Brings the row of an event into view inside the scrolling column of the list, and only there: the page itself never
 * scrolls. The sticky day heading covers the top of the column, so a row above its lower edge is moved below it. Nothing
 * happens when the row is not in the list (a filter or the selection hides it) or when the column does not scroll (below
 * 1024 the page is the list, and a click on a point opens the detail instead).
 */
export function scrollAuditRowIntoView(id: string): void {
    const marker = document.querySelector(`[data-audit-event="${CSS.escape(id)}"]`);
    const row = marker?.closest("[data-list-row]");
    const boundary = row?.closest("section");
    if (!row || !boundary) return;
    let box: HTMLElement | null = row.parentElement;
    while (box && box !== boundary) {
        const overflowY = getComputedStyle(box).overflowY;
        if ((overflowY === "auto" || overflowY === "scroll") && box.scrollHeight > box.clientHeight) break;
        box = box.parentElement;
    }
    if (!box || box === boundary) return;
    const heading = row.parentElement?.firstElementChild;
    const covered = heading instanceof HTMLElement ? heading.offsetHeight : 0;
    const rowBox = row.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    if (rowBox.top < boxRect.top + covered) box.scrollTop -= boxRect.top + covered - rowBox.top;
    else if (rowBox.bottom > boxRect.bottom) box.scrollTop += rowBox.bottom - boxRect.bottom;
}

interface AuditEventListProps {
    days: AuditDay[];
    /** The event shown in the detail (the list marks it) */
    currentId: string | undefined;
    onSelect: (id: string) => void;
    isDetailed: boolean;
    emergencyIds: ReadonlySet<string>;
    format: AuditFormat;
}

/**
 * The actions by day, newest first (round 3 of the redesign): the sentence 15/20 medium, below it 13/18 muted the time in
 * mono, the kind, "by {actor}" when the sentence does not name the actor, the tags and, with details, "Used for". The day
 * heading stays at the top of the list while its rows scroll. The height rule and the arrow keys are `ListFrame`'s.
 */
export function AuditEventList({ days, currentId, onSelect, isDetailed, emergencyIds, format }: AuditEventListProps) {
    const all = days.flatMap((day) => day.events);
    const stopId = all.some((event) => event.id === currentId) ? currentId : all[0]?.id;
    return (
        <ListFrame label="Action" meta={<span className="font-mono">{formatActionCount(all.length)}</span>} fillsColumn>
            {days.length === 0 && <p className="p-3 text-[13px] leading-[18px] text-muted">{EMPTY_TEXT}</p>}
            {days.map((day) => (
                <div key={day.key}>
                    <div className="sticky top-0 z-10 border-b border-line bg-surface px-3 pt-2 pb-1 font-mono text-xs leading-[17px] text-muted">{day.label}</div>
                    {day.events.map((event) => (
                        <AuditRow key={event.id} event={event} isCurrent={event.id === currentId} isTabStop={event.id === stopId} onSelect={onSelect} isDetailed={isDetailed} isEmergency={isEmergencyEvent(event, emergencyIds)} format={format} />
                    ))}
                </div>
            ))}
        </ListFrame>
    );
}

function AuditRow({ event, isCurrent, isTabStop, onSelect, isDetailed, isEmergency, format }: { event: AuditEvent; isCurrent: boolean; isTabStop: boolean; onSelect: (id: string) => void; isDetailed: boolean; isEmergency: boolean; format: AuditFormat }) {
    const by = auditRowBy(event);
    const used = isDetailed ? auditUsedForShort(event) : null;
    return (
        <ListRowButton isCurrent={isCurrent} isTabStop={isTabStop} onSelect={() => onSelect(event.id)}>
            <span className="flex items-start gap-2" data-audit-event={event.id}>
                <span className="shrink-0 pt-[3px]"><AuditKindIcon kind={event.kind} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[15px] leading-5 font-medium text-ink">{event.sentence}</span>
                    <span className={`mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-[18px] ${isCurrent ? "text-body" : "text-muted"}`}>
                        <span className="font-mono text-xs">{formatAuditTime(event.time, format)}</span>
                        <span>{by ? `${AUDIT_KIND_ONE[event.kind]} ${by}` : AUDIT_KIND_ONE[event.kind]}</span>
                        {event.result === "failure" && <Tag variant="danger">{event.denied ? "Denied" : "Failed"}</Tag>}
                        {isEmergency && (
                            <Tag variant="warn">
                                <span className="inline-flex items-center gap-1"><Icon name="emergency-access" size={12} />Emergency access</span>
                            </Tag>
                        )}
                        {used && <span>{used}</span>}
                    </span>
                </span>
            </span>
        </ListRowButton>
    );
}
