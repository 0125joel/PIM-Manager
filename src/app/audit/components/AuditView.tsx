"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { PAGE_TITLE_CLASS } from "@/components/ui/SectionHeader";
import type { AuditStatus } from "@/hooks/useAuditData";
import type { AuditUrlActions } from "@/hooks/useAuditUrlState";
import type { AuditEvent } from "@/types/audit.types";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { PRIVILEGE_NOT_REPORTED_TEXT, judgeEventPrivilege, unjudgedText, type AuditPrivilege } from "@/utils/auditPrivilege";
import { buildNoActivationRows, countNoActivation, filterNoActivationRows, noActivationHonesty, noActivationLimits, type GroupMembersLookup, type NoActivationRow } from "@/utils/auditNoActivation";
import { summarizeFailureCause } from "@/utils/reportStates";
import { auditWindow, parseAuditRange, rangeToUrl, sameRange, timelineRows, type AuditRange, type TimelinePoint } from "@/utils/auditTimeline";
import { AUDIT_MAX_DAYS } from "@/utils/auditUrlState";
import { auditFilterChips, buildCoverageLine, countByKind, countFailed, countInPeriod, filterAuditEvents, groupByDay, isAuditHolderUntold, oldestAvailable, untoldHolderText, type AuditFormat } from "@/utils/auditView";
import type { WorkspaceNotice as WorkspaceNoticeText } from "@/utils/auditWorkspaceMerge";
import { countEnvironments, describeAuditFilter, describeNoActivationFilter, keepIncluded, withInclude, type AuditExportInclude } from "@/utils/auditExportPlan";
import { ReportLayout } from "@/app/report/components/ReportLayout";
import { AuditEventDetail, AuditEventMissing } from "./AuditEventDetail";
import { AuditEventList, scrollAuditRowIntoView } from "./AuditEventList";
import { AllFailedBox } from "@/app/report/components/ReportStates";
import { AuditExportDialog } from "./AuditExportDialog";
import { AuditNoActivation, NoActivationLoading } from "./AuditNoActivation";
import { AuditFilterBar } from "./AuditFilterBar";
import { AuditTimeline } from "./AuditTimeline";
import { AuditBanner, NoMatchingEvents, NothingInPeriod, PermissionNeeded, ReadFailed, Reading, RoleMissing, TooMany, WorkspaceNotice } from "./AuditStates";

/** What the No activation view needs besides the events: the assignments, and how their read went */
export interface NoActivationAssignments {
    roles: readonly RoleDetailData[];
    /** Empty when PIM for Groups is not included */
    groups: readonly PimGroupData[];
    /** The members of the groups a role is eligible for, by group id (lower case); each member is judged on their own */
    membership?: ReadonlyMap<string, GroupMembersLookup>;
    /** The assignments are being read and none are there yet */
    isLoading: boolean;
    /** The read of the assignments failed and left nothing: the Report's error state */
    error: string | null;
    /** Why PIM for Groups is not included (not granted, failed), or null when it is */
    groupsNotIncluded: string | null;
    onRetry: () => void;
    /** Azure: builds the rows itself, from its own assignments, instead of from `roles` and `groups` */
    buildRows?: (input: { events: readonly AuditEvent[]; days: number; now: Date; emergencyIds: ReadonlySet<string>; format: AuditFormat }) => NoActivationRow[];
    /** Further lines above the table and under Not read, one limit each (Azure: what the roles could not read) */
    extraLimits?: readonly string[];
}

/** What Privileged only judges by: the role data the app reads, started only when the filter is on or No activation is open */
export interface AuditPrivilegeView {
    /** Null until roles are there */
    lookup: AuditPrivilege | null;
    /** The read of the roles failed and left nothing */
    error: string | null;
    onRetry: () => void;
}

/** Where the events came from: the Entra audit log, or the Log Analytics workspaces the viewer chose (spec section 7) */
export interface AuditSourceView {
    kind: "graph" | "workspace";
    /** The name in the coverage line ("2 of 3 workspaces"); left out it is the Entra audit log */
    label?: string;
    /** Some workspaces, or all of them, could not be read: the banner */
    notice: WorkspaceNoticeText | null;
    /** The same as one sentence for the `Not read` line of every export */
    notRead?: string;
    /** The sources in words for the `Source` line of every export; left out it is named from `kind` */
    exportLabel?: string;
    /** Sentences for the coverage line (what a workspace is, what the Entra audit log added) */
    coverageNotes?: readonly string[];
    /** Whether the notice links to the workspace section of Settings; true when left out */
    hasSettingsLink?: boolean;
    /** The notice is about the Entra audit log that this page cannot read: link to the Entra Audit page, where it is granted */
    hasEntraAuditLink?: boolean;
}

/** The texts a page can set in place of Entra's; each one left out is Entra's own */
export interface AuditViewCopy {
    subtitle?: string;
    /** The line of the reading state, from the number of events read so far */
    readingText?: (count: number) => string;
    readingLabel?: string;
    readFailedTitle?: string;
    nothingTitle?: string;
    nothingText?: (days: number) => string;
    searchLabel?: string;
    idleSearchLabel?: string;
}

export interface AuditViewProps {
    status: AuditStatus;
    /** The source of the events; left out it is the Entra audit log */
    source?: AuditSourceView;
    /** The longest period the source offers (30 for the Entra audit log) */
    maxDays?: number;
    /** The days the page's own log keeps (30 for the Entra audit log, 90 for the Azure activity log) */
    ownLogDays?: number;
    /** The mapped events of the last successful read */
    events: readonly AuditEvent[];
    /** ISO start of the window the last successful read covered */
    windowStart: string | null;
    /** ISO time the last successful read finished */
    readAt: string | null;
    /** Rows read so far while loading */
    loadedCount: number;
    /** The period the last read was asked for (named by the too-many state) */
    requestedDays: number;
    isRequestingPermission: boolean;
    now: Date;
    emergencyIds: ReadonlySet<string>;
    url: AuditUrlActions;
    /** Calm details: whether details show, and the checkbox (left out with the setting More) */
    details: { isDetailed: boolean; toggle?: ReactNode };
    /** The shared Refresh button; shown once a read has worked */
    refresh: ReactNode;
    onGrant: () => void;
    /** Reads again: Try again and the Refresh of the role-missing state */
    onRetry: () => void;
    /** Reads a shorter period (the too-many state) */
    onLoadDays: (days: number) => void;
    /** The banner about the longest period of the native log (30 days of the Entra audit log unless told otherwise); left out once it is dismissed */
    banner?: { onDismiss: () => void; days?: number; logName?: string };
    /** The zone and locale of the shown times; left out they are the browser's */
    format?: AuditFormat;
    /** Who and what the export names: the tenant, the exporter and the app version. Left out, there is no Export button. */
    exportContext?: { tenant: { id: string; name?: string }; exporter?: string; appVersion: string };
    /** The assignments of the No activation view; the container reads them only once that view is opened */
    assignments?: NoActivationAssignments;
    privilege?: AuditPrivilegeView;
    /** The export dialog is open on first render (the fixture) */
    startExportOpen?: boolean;
    /** The choices of the scope bar as one phrase, for the filter sentence of the export (the Azure page); left out there are none */
    exportScopeBar?: string;
    /** The Filters panel is open on first render (the fixture) */
    startFiltersOpen?: boolean;
    /** Texts in place of Entra's */
    copy?: AuditViewCopy;
    /** Shown after the head and any notice, before the filter bar, once a read has worked (the Azure scope bar) */
    scopeBar?: ReactNode;
    /** False: no timeline and no period control; the coverage line shows alone. True when left out */
    hasTimeline?: boolean;
    /** False: no No activation view. True when left out */
    hasIdleView?: boolean;
    /** False: no Environment choice in the Filters panel. True when left out */
    hasEnvironment?: boolean;
    /** True: the Scope level choice in the Filters panel, in the place of Environment (Azure). False when left out */
    hasScopeLevel?: boolean;
    /** A note under the detail of an event, in place of the standard one; null for none of its own */
    noteOf?: (event: AuditEvent) => string | null;
    /** Replaces the body and the filter bar once a read has worked */
    emptyState?: ReactNode;
}

const NO_FORMAT: AuditFormat = {};

/**
 * The Audit page without any context: head, timeline card (period, coverage line, points, selection), filter bar, list and detail, and every state, driven by props and
 * the URL state, so the page and the fixture route (`/dev/audit`) render the same body. The data container is
 * `app/audit/page.tsx`. No MSAL and no Graph here. One state shows at a time: permission, role missing, reading, failed, too
 * many, then (after a read that worked) nothing in the period, no match or the list.
 */
export function AuditView({ status, source, maxDays = AUDIT_MAX_DAYS, ownLogDays = AUDIT_MAX_DAYS, events, windowStart, readAt, loadedCount, requestedDays, isRequestingPermission, now, emergencyIds, url, details, refresh, onGrant, onRetry, onLoadDays, banner, format = NO_FORMAT, exportContext, assignments, privilege, startExportOpen = false, startFiltersOpen = false, exportScopeBar, copy, scopeBar, hasTimeline = true, hasIdleView = true, hasEnvironment = true, hasScopeLevel = false, noteOf, emptyState }: AuditViewProps) {
    // Privileged only is applied once it can be: until the roles are in, and when Graph gave no flag at all, nothing is left out
    // under its name. `state` then says what is really on screen, for the list as well as the export line.
    const lookup = privilege?.lookup ?? null;
    const isPrivilegeOn = url.state.privileged === true;
    const isPrivilegeUnavailable = lookup !== null && !lookup.isReported;
    const usedLookup = isPrivilegeOn && lookup?.isReported ? lookup : undefined;
    const isPrivilegePending = isPrivilegeOn && lookup === null;
    // Apps and Agents wait for the same roles: the log calls both the same
    const isWhoPending = (url.state.who === "app" || url.state.who === "agent") && lookup === null;
    const holderKinds = lookup?.holderKinds;
    // Only the Azure page offers a scope level: in a link to Entra Audit it is ignored, as it is not a choice there
    const shownState = useMemo(() => (!hasScopeLevel && url.state.level ? { ...url.state, level: undefined } : url.state), [url.state, hasScopeLevel]);
    const state = useMemo(() => (shownState.privileged && !usedLookup ? { ...shownState, privileged: undefined } : shownState), [shownState, usedLookup]);
    const isReady = status === "ready";
    // No activation: the period is `days` of the URL; the selection, the kinds and Failed or denied are not used
    const isIdle = hasIdleView && state.view === "idle";
    const [isExportOpen, setIsExportOpen] = useState(startExportOpen);

    // The window ends when the last read finished. Until a read has happened there is no timeline.
    const period = useMemo(() => auditWindow(readAt, state.days), [readAt, state.days]);
    // `now` is a new object on every render; the memos below follow its value. The list and the counts count back from `now`
    // as before; the timeline counts back from the read, and leaves out an event that lies outside its window.
    const nowMs = now.getTime();

    // The selection: the one of the URL, or the live one while it is dragged and until the URL has caught up with a release
    const urlRange = useMemo(() => parseAuditRange(state.from, state.to, period), [state.from, state.to, period]);
    const [live, setLive] = useState<AuditRange | null | undefined>(undefined);
    if (live !== undefined && sameRange(live ?? undefined, urlRange)) setLive(undefined);
    const range = live !== undefined ? live ?? undefined : urlRange;
    // The band follows the pointer at once; the list, the counts and the text below follow without holding it up
    const listRange = useDeferredValue(range);
    const commitRange = (next: AuditRange | null) => {
        setLive(next);
        if (next) url.setRange(rangeToUrl(next));
        else if (state.from !== undefined) url.setRange(null);
    };

    // What the timeline shows: every filter but the selection (selecting dims the bands and nothing else)
    const unselected = useMemo(() => filterAuditEvents(events, state, new Date(nowMs), emergencyIds, undefined, usedLookup, holderKinds), [events, state, nowMs, emergencyIds, usedLookup, holderKinds]);
    const points = useMemo(() => (period ? timelineRows(unselected, state.kinds, period) : []), [unselected, state.kinds, period]);
    const usedRange = isIdle ? undefined : listRange;
    const filtered = useMemo(() => filterAuditEvents(events, state, new Date(nowMs), emergencyIds, usedRange, usedLookup, holderKinds), [events, state, nowMs, emergencyIds, usedRange, usedLookup, holderKinds]);
    const kindCounts = useMemo(() => countByKind(events, state, new Date(nowMs), emergencyIds, usedRange, usedLookup, holderKinds), [events, state, nowMs, emergencyIds, usedRange, usedLookup, holderKinds]);
    const failedCount = useMemo(() => countFailed(events, state, new Date(nowMs), emergencyIds, usedRange, usedLookup, holderKinds), [events, state, nowMs, emergencyIds, usedRange, usedLookup, holderKinds]);
    const inPeriod = useMemo(() => countInPeriod(events, state.days, new Date(nowMs)), [events, state.days, nowMs]);
    const unjudgedEvents = useMemo(() => (usedLookup ? filtered.filter((event) => judgeEventPrivilege(event, usedLookup) === null).length : 0), [filtered, usedLookup]);
    const untoldEvents = useMemo(() => (holderKinds && (state.who === "app" || state.who === "agent") ? filtered.filter((event) => isAuditHolderUntold(event, holderKinds)).length : 0), [filtered, holderKinds, state.who]);
    const days = useMemo(() => groupByDay(filtered, format.timeZone, format.locale), [filtered, format.timeZone, format.locale]);

    // A link to an event outside the data is told plainly. An event that the filters hide is still shown, with a note.
    const urlEvent = state.event !== undefined ? events.find((event) => event.id === state.event) : undefined;
    const shown = state.event !== undefined ? urlEvent : days[0]?.events[0];
    const hasSelection = state.event !== undefined;
    const isShownHidden = urlEvent !== undefined && !filtered.some((event) => event.id === urlEvent.id);

    const isEmptyPeriod = isReady && inPeriod === 0;
    // A selection that holds nothing is told by the list; "no match" is for the filters
    const isNoMatch = isReady && !isIdle && inPeriod > 0 && unselected.length === 0;
    // The empty box of the canvas stands alone; with a shorter period the bar stays, so the period can be changed again
    // Without a timeline there is no period to change, so an empty period has no bar either
    const showBar = isReady && !emptyState && !(isEmptyPeriod && (state.days === maxDays || !hasTimeline));

    const coverage = buildCoverageLine({ windowStart, readAt, days: state.days, now, timeZone: format.timeZone, locale: format.locale, sourceLabel: source?.label, notes: source?.coverageNotes });
    const sourceKind = source?.kind ?? "graph";
    // A selection that comes from the URL (a shared link, the back button) is brought into view too; a row already in view stays where it is
    const selectedInUrl = state.event;
    useEffect(() => {
        if (!isReady || selectedInUrl === undefined) return;
        const frame = requestAnimationFrame(() => scrollAuditRowIntoView(selectedInUrl));
        return () => cancelAnimationFrame(frame);
    }, [isReady, selectedInUrl]);
    // A click on a point selects its row as a click in the list does, and brings it into view in the list column only
    const pickPoint = (point: TimelinePoint) => {
        url.select(point.id);
        requestAnimationFrame(() => scrollAuditRowIntoView(point.id));
    };

    // The export holds what is on screen: every filter and the selection, whatever the details toggle says. The dialog calls this
    // for the workloads it has chosen, and every number inside the texts follows that choice, so the file agrees with itself.
    const eventCounts = useMemo(() => countEnvironments(filtered), [filtered]);
    const buildExportData = (include: AuditExportInclude) => {
        if (!exportContext || !period || !readAt) return null;
        const kept = keepIncluded(filtered, include);
        const unjudged = usedLookup ? kept.filter((event) => judgeEventPrivilege(event, usedLookup) === null).length : 0;
        const untold = holderKinds && (state.who === "app" || state.who === "agent") ? kept.filter((event) => isAuditHolderUntold(event, holderKinds)).length : 0;
        return {
            events: kept,
            period: { from: new Date(range?.from ?? period.start), to: new Date(range?.to ?? period.end) },
            filterSentence: withInclude(describeAuditFilter(state, range, unjudged, untold, exportScopeBar), eventCounts, include),
            searchTerm: state.q,
            readAt,
            oldestAvailable: oldestAvailable(windowStart, state.days, new Date(nowMs)),
            source: sourceKind,
            sourceLabel: source?.exportLabel,
            tenant: exportContext.tenant,
            exporter: exportContext.exporter,
            emergencyIds,
            notRead: source?.notRead || undefined,
        };
    };
    const canExport = Boolean(exportContext && period && readAt);

    // No activation: one row per assignment, after a read of the log that worked. A period without events is shown too: a
    // read that worked and holds nothing is the case this view is for. Where a source cannot see a scope, its rows say so
    // themselves (AU-17, P12); a source that can read nothing at all has its own empty state.
    const idleAll = useMemo(() => {
        if (!isIdle || !isReady || !assignments || assignments.isLoading || assignments.error !== null) return [];
        if (assignments.buildRows) return assignments.buildRows({ events, days: state.days, now: new Date(nowMs), emergencyIds, format });
        return buildNoActivationRows({ roles: assignments.roles, groups: assignments.groups, events, days: state.days, now: new Date(nowMs), emergencyIds, format, membership: assignments.membership });
    }, [isIdle, isReady, assignments, events, state.days, nowMs, emergencyIds, format]);
    const idleRows = useMemo(() => filterNoActivationRows(idleAll, state.env, state.q, { who: state.who, isPrivilegedOnly: state.privileged === true, level: state.level }), [idleAll, state.env, state.q, state.who, state.privileged, state.level]);
    const unjudgedRows = useMemo(() => (state.privileged ? idleRows.filter((row) => row.isPrivileged === null).length : 0), [idleRows, state.privileged]);
    const honesty = noActivationHonesty(countNoActivation(idleRows));
    // Everything that limits the table, once, above it; the export carries the same lines under Not read
    const idleLimits = useMemo(() => [...noActivationLimits({
        groupsReason: assignments?.groupsNotIncluded ?? null,
        rows: idleAll,
        sourceFrom: oldestAvailable(windowStart, state.days, new Date(nowMs)),
        periodFrom: new Date(nowMs - state.days * 86_400_000),
        format,
    }), ...(assignments?.extraLimits ?? [])], [assignments, idleAll, windowStart, state.days, nowMs, format]);
    const idleCounts = useMemo(() => countEnvironments(idleRows), [idleRows]);
    const buildIdleExport = (include: AuditExportInclude) => {
        if (!exportContext || !period || !readAt) return null;
        const kept = keepIncluded(idleRows, include);
        const unjudged = state.privileged ? kept.filter((row) => row.isPrivileged === null).length : 0;
        // The limits read the kept rows, so a group that was left out is not named as unread
        const limits = [...noActivationLimits({
            groupsReason: assignments?.groupsNotIncluded ?? null,
            rows: keepIncluded(idleAll, include),
            sourceFrom: oldestAvailable(windowStart, state.days, new Date(nowMs)),
            periodFrom: new Date(nowMs - state.days * 86_400_000),
            format,
        }), ...(assignments?.extraLimits ?? [])];
        return {
            rows: kept,
            honesty: noActivationHonesty(countNoActivation(kept)),
            // The period of the URL, never the selection
            period: { from: new Date(period.start), to: new Date(period.end) },
            filterSentence: withInclude(describeNoActivationFilter(state, unjudged, exportScopeBar), idleCounts, include),
            searchTerm: state.q,
            readAt,
            oldestAvailable: oldestAvailable(windowStart, state.days, new Date(nowMs)),
            source: sourceKind,
            tenant: exportContext.tenant,
            exporter: exportContext.exporter,
            notRead: [source?.notRead ?? "", ...limits].filter(Boolean).join(" ") || undefined,
        };
    };
    const isExportEmpty = isIdle ? idleRows.length === 0 : filtered.length === 0;
    // While the roles are not in, the list is not yet what the filter asks: nothing to export under it
    const isExportBlocked = (isPrivilegePending || isWhoPending) && !isIdle;
    const exportTitle = isExportBlocked ? "Available when the roles are read" : isExportEmpty ? "Nothing to export in this view" : undefined;

    // A sentence above the body: why Privileged only does nothing, or what it kept without knowing
    const privilegeNote = isPrivilegeOn && isPrivilegeUnavailable
        ? `Privileged only is not applied. ${PRIVILEGE_NOT_REPORTED_TEXT}`
        : isIdle ? unjudgedText(unjudgedRows, "assignment") : unjudgedText(unjudgedEvents, "event");

    const whoNote = isIdle ? null : untoldHolderText(untoldEvents);

    const chips = useMemo(() => auditFilterChips(shownState), [shownState]);

    let body: ReactNode;
    if (status === "permission") body = <PermissionNeeded onGrant={onGrant} isLoading={isRequestingPermission} />;
    else if (status === "role-missing") body = <RoleMissing onRefresh={onRetry} />;
    else if (status === "too-many") body = <TooMany key={requestedDays} requestedDays={requestedDays} onLoad={onLoadDays} />;
    else if (status === "failed") body = <ReadFailed onRetry={onRetry} title={copy?.readFailedTitle} />;
    else if (!isReady) body = <Reading count={loadedCount} text={copy?.readingText?.(loadedCount)} label={copy?.readingLabel} />;
    else if (emptyState) body = emptyState;
    else if (isEmptyPeriod && !isIdle) body = <NothingInPeriod days={state.days} isWorkspace={sourceKind === "workspace"} title={copy?.nothingTitle} text={copy?.nothingText?.(state.days)} />;
    else if (isNoMatch) body = <NoMatchingEvents onClear={url.clearFilters} />;
    else if ((isPrivilegePending || isWhoPending) && !isIdle) {
        body = privilege?.error
            ? <AllFailedBox cause={summarizeFailureCause([privilege.error])} onRetry={privilege.onRetry} />
            : <NoActivationLoading text={isPrivilegePending ? "Reading the roles, to tell which are privileged" : "Reading the roles, to tell apps from agents"} />;
    }
    else if (isIdle) {
        if (!assignments) body = <NoActivationLoading />;
        else if (assignments.error !== null) body = <AllFailedBox cause={summarizeFailureCause([assignments.error])} onRetry={assignments.onRetry} />;
        else if (assignments.isLoading) body = <NoActivationLoading />;
        else body = <AuditNoActivation days={state.days} rows={idleRows} honesty={honesty} limits={idleLimits} />;
    }
    else {
        body = (
            <ReportLayout
                columns="even"
                hasSelection={hasSelection}
                backLabel="All actions"
                onBack={url.clearSelection}
                list={<AuditEventList days={days} currentId={shown?.id} onSelect={url.select} isDetailed={details.isDetailed} emergencyIds={emergencyIds} format={format} />}
                detail={shown
                    ? <AuditEventDetail event={shown} isDetailed={details.isDetailed} emergencyIds={emergencyIds} format={format} isHiddenByFilter={isShownHidden} getShareUrl={() => url.getShareUrl(shown.id)} note={noteOf?.(shown) ?? undefined} />
                    : state.event !== undefined ? <AuditEventMissing /> : null}
            />
        );
    }

    return (
        <div data-focus-fallback tabIndex={-1} className="mx-auto flex max-w-[1376px] flex-col gap-4 outline-none">
            <div data-visual-section="audit-head" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <h1 className={PAGE_TITLE_CLASS}>Audit</h1>
                    <p className="mt-1 text-sm leading-5 text-body">{copy?.subtitle ?? "Who activated what, and what changed, in Entra roles and PIM for Groups."}</p>
                </div>
                {isReady && !emptyState && (
                    <div className="flex items-center gap-3">
                        <span className="max-sm:hidden" data-tour="refresh">{refresh}</span>
                        {canExport && (
                            <>
                                <span className="max-sm:hidden" data-tour="audit-export">
                                    <Button variant="primary" onClick={() => setIsExportOpen(true)} disabled={isExportEmpty || isExportBlocked} title={exportTitle}>Export</Button>
                                </span>
                                <span className="sm:hidden" data-tour="audit-export">
                                    <Button variant="primary" icon="export" iconOnly label="Export" onClick={() => setIsExportOpen(true)} disabled={isExportEmpty || isExportBlocked} title={exportTitle} />
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>
            {isReady && scopeBar}
            {isReady && banner && <AuditBanner onDismiss={banner.onDismiss} days={banner.days} logName={banner.logName} />}
            {source?.notice && status !== "loading" && status !== "idle" && <WorkspaceNotice title={source.notice.title} detail={source.notice.detail} onRetry={onRetry} hasSettingsLink={source.hasSettingsLink} hasEntraAuditLink={source.hasEntraAuditLink} />}
            {isReady && !emptyState && !(hasTimeline && showBar && period) && <p {...(hasTimeline ? {} : { "data-visual-section": "audit-coverage" })} className="text-xs leading-[17px] text-muted">{coverage}</p>}
            {hasTimeline && showBar && period && (
                <AuditTimeline
                    days={state.days}
                    maxDays={maxDays}
                    ownLogDays={ownLogDays}
                    isWorkspace={sourceKind === "workspace"}
                    onDaysChange={url.setDays}
                    coverage={coverage}
                    period={period}
                    rows={points}
                    range={range}
                    selectedId={shown?.id}
                    actionCount={filtered.length}
                    format={format}
                    onLive={setLive}
                    onCommit={commitRange}
                    onPick={pickPoint}
                    ignoresSelection={isIdle}
                />
            )}
            {showBar && (
                <AuditFilterBar
                    view={isIdle ? "idle" : "events"}
                    onViewChange={url.setView}
                    detailsToggle={details.toggle}
                    kinds={state.kinds}
                    kindCounts={kindCounts}
                    onKindsChange={url.setKinds}
                    filters={shownState}
                    onFilterChange={url.setFilter}
                    isPrivilegeUnavailable={isPrivilegeUnavailable}
                    chips={chips}
                    onRemoveChip={url.removeFilter}
                    onClearAll={url.clearPanelFilters}
                    startFiltersOpen={startFiltersOpen}
                    failedCount={failedCount}
                    query={state.q}
                    onQueryChange={url.setQuery}
                    hasEnvironment={hasEnvironment}
                    hasScopeLevel={hasScopeLevel}
                    hasIdleView={hasIdleView}
                    searchLabel={copy?.searchLabel}
                    idleSearchLabel={copy?.idleSearchLabel}
                />
            )}
            <div data-visual-section="audit-body">
                {isReady && privilegeNote && <p role="note" data-audit-privilege-note className="mb-3 text-[13px] leading-[18px] text-body">{privilegeNote}</p>}
                {isReady && whoNote && <p role="note" data-audit-who-note className="mb-3 text-[13px] leading-[18px] text-body">{whoNote}</p>}
                {body}
            </div>
            {exportContext && <AuditExportDialog isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} buildData={buildExportData} buildIdleData={isIdle ? buildIdleExport : undefined}
                workloads={hasEnvironment ? { counts: isIdle ? idleCounts : eventCounts, unit: isIdle ? "assignment" : "action", groupsReason: isIdle ? assignments?.groupsNotIncluded ?? null : null, env: state.env } : undefined} appVersion={exportContext.appVersion} />}
        </div>
    );
}
