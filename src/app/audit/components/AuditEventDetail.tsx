"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AuditEvent } from "@/types/audit.types";
import { auditDetailNote, auditDetailRows, isAzureEvent, isEmergencyEvent, type AuditFormat } from "@/utils/auditView";
import { CopyLinkButton } from "@/app/report/components/CopyLinkButton";

interface AuditEventDetailProps {
    event: AuditEvent;
    isDetailed: boolean;
    emergencyIds: ReadonlySet<string>;
    format: AuditFormat;
    /** The selected event is not in the list because of the filters */
    isHiddenByFilter: boolean;
    getShareUrl: () => string;
    /** A note of the page that replaces the standard one (the Azure approver text); left out it is the standard note */
    note?: string | null;
}

/**
 * Whether the text of an element is taller than the element: then it scrolls, and must be reachable by keyboard. It measures
 * again when the text changes. `text` is a string on purpose: a JSX element is new on every render, and while the selection of
 * the timeline is dragged that set state after every move, until React warned about its update depth.
 */
function useIsScrollable(ref: RefObject<HTMLElement | null>, text: string): boolean {
    const [isScrollable, setIsScrollable] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === "undefined") return;
        const measure = () => setIsScrollable(element.scrollHeight > element.clientHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, text]);
    return isScrollable;
}

/**
 * The value of one field. From 1024 up the field has a fixed height and scrolls inside it; a text that overflows is reachable
 * by keyboard (tab stop, named by its label), a text that fits stays out of the tab order.
 */
function DetailValue({ label, className, value }: { label: string; className: string; value: string }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const isScrollable = useIsScrollable(ref, value);
    return (
        // A `dd` takes no role, so the scrolling box is a div inside it
        <dd className={className}>
            <div ref={ref} className="lg:h-full lg:overflow-y-auto" tabIndex={isScrollable ? 0 : undefined} role={isScrollable ? "group" : undefined} aria-label={isScrollable ? label : undefined}>
                {value || <span className="sr-only">Empty</span>}
            </div>
        </dd>
    );
}

/** The heading of an Azure event: three lines high from 1024 up; a longer sentence scrolls, reachable by keyboard */
function AzureHeading({ text }: { text: string }) {
    const ref = useRef<HTMLSpanElement | null>(null);
    const isScrollable = useIsScrollable(ref, text);
    return (
        <h2 className="min-w-0 text-xl leading-7 font-semibold text-ink lg:h-[84px] lg:flex-1">
            <span ref={ref} className="block lg:h-full lg:overflow-y-auto" tabIndex={isScrollable ? 0 : undefined} role={isScrollable ? "group" : undefined} aria-label={isScrollable ? "Action" : undefined}>{text}</span>
        </h2>
    );
}

/** The line under the detail; of an Azure event it holds two lines and scrolls, reachable by keyboard when it overflows */
function DetailNote({ className, text, isAzure }: { className: string; text: string; isAzure: boolean }) {
    const ref = useRef<HTMLParagraphElement | null>(null);
    // Entra's note keeps its hidden overflow and its tab order
    const isScrollable = useIsScrollable(ref, text) && isAzure;
    return (
        <p ref={ref} className={className} tabIndex={isScrollable ? 0 : undefined} role={isScrollable ? "group" : undefined} aria-label={isScrollable ? "Note" : undefined}>
            {text}
        </p>
    );
}

/** One action: its sentence as the heading, Copy link, the facts in a grid that follows the width, and the line that explains what is absent. */
export function AuditEventDetail({ event, isDetailed, emergencyIds, format, isHiddenByFilter, getShareUrl, note: pageNote }: AuditEventDetailProps) {
    const isEmergency = isEmergencyEvent(event, emergencyIds);
    const rows = useMemo(() => auditDetailRows(event, isDetailed, isEmergency, format), [event, isDetailed, isEmergency, format]);
    const note = pageNote ?? auditDetailNote(event, isDetailed);
    // An Azure event has two more fields (Scope and Through), a note of two lines and a heading of three lines: one row and two lines more than Entra's card
    const isAzure = isAzureEvent(event);
    const height = isAzure
        ? isDetailed ? "lg:h-[919px] xl:h-[777px]" : "lg:h-[777px] xl:h-[637px]"
        : isDetailed ? "lg:h-[802px] xl:h-[660px]" : "lg:h-[660px] xl:h-[520px]";
    const noteHeight = isAzure ? "lg:h-[49px] lg:overflow-y-auto" : "lg:h-[31px] lg:overflow-hidden";
    return (
        <article data-audit-detail className={`rounded border border-line bg-surface p-5 lg:flex lg:flex-col ${height}`}>
            <div className="flex items-start justify-between gap-3">
                {isAzure
                    ? <AzureHeading text={event.sentence} />
                    : <h2 className="min-w-0 text-xl leading-7 font-semibold text-ink lg:h-14 lg:flex-1 lg:overflow-y-auto">{event.sentence}</h2>}
                <div className="shrink-0"><CopyLinkButton getUrl={getShareUrl} /></div>
            </div>
            {/* From 1024 up every field has a fixed place and height, so nothing moves between events; a longer text scrolls inside its field */}
            <dl className="mt-4 grid grid-cols-1 content-start gap-x-6 gap-y-3 text-sm leading-5 sm:grid-cols-2 lg:min-h-0 lg:flex-1 xl:grid-cols-3">
                {rows.map((row) => (
                    <div key={row.label} className={`min-w-0 ${row.isWide ? "col-span-full" : ""}`}>
                        <dt className="text-xs leading-[17px] text-muted">{row.label}</dt>
                        <DetailValue label={row.label} className={`mt-0.5 min-h-5 text-ink [overflow-wrap:anywhere] ${row.isWide ? "lg:h-[60px]" : "lg:h-10"}`} value={row.value} />
                    </div>
                ))}
            </dl>
            {/* The same place on every event, also when there is nothing to explain */}
            <DetailNote isAzure={isAzure} className={`mt-3 border-line pt-3 text-[13px] leading-[18px] text-muted lg:shrink-0 lg:border-t ${noteHeight} ${note || isHiddenByFilter ? "max-lg:border-t" : "max-lg:hidden"}`} text={[isHiddenByFilter ? "Hidden by the current filter." : "", note ?? ""].filter(Boolean).join(" ")} />
        </article>
    );
}

/** A link to an event that the data does not hold (another period, or one that never existed): said plainly, nothing is guessed */
export function AuditEventMissing() {
    return (
        <div className="rounded border border-line bg-surface p-5 text-sm text-muted">This event is not in this period.</div>
    );
}
