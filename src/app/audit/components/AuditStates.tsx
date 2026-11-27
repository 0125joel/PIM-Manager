"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import { PANEL_CLASS } from "@/components/ui/SectionHeader";
import { AUDIT_ROW_LIMIT } from "@/utils/auditErrors";
import { AUDIT_MAX_DAYS } from "@/utils/auditUrlState";
import { NoMatch } from "@/app/report/components/ReportStates";

/** The texts are those of the canvas (`Main.dc.html`). Only one of these states shows at a time (AuditView decides). */

export const CARD = "max-w-[640px] rounded border border-line bg-surface p-6";
const NUMBER_INPUT = "h-[34px] w-[72px] rounded-md border border-line bg-surface px-2 text-right font-mono text-[13px] text-ink max-sm:h-11";

/** AuditLog.Read.All is not granted: no read is made until the viewer grants it (implementation spec section 4) */
export function PermissionNeeded({ onGrant, isLoading }: { onGrant: () => void; isLoading: boolean }) {
    return (
        <section className={CARD}>
            <h2 className="mb-2 text-xl leading-[26px] font-semibold text-ink">Audit needs one more permission</h2>
            <p className="mb-3 text-sm leading-5 text-body">
                To read activations and changes, PIM Manager asks for <span className="font-mono">AuditLog.Read.All</span>. It is optional: the rest of the app works without it. It only reads, in your browser, and an admin must approve it once for your tenant.
            </p>
            <p className="mb-3 text-[13px] leading-[18px] text-muted">You also need Reports Reader, Security Reader or Security Administrator.</p>
            <Button variant="primary" isLoading={isLoading} onClick={onGrant}>Grant permission</Button>
        </section>
    );
}

/** The permission is there but Microsoft answers the unsupported-role error */
export function RoleMissing({ onRefresh }: { onRefresh: () => void }) {
    return (
        <section className={CARD}>
            <h2 className="mb-2 text-xl leading-[26px] font-semibold text-ink">Your role cannot read the audit log</h2>
            <p className="mb-3 text-sm leading-5 text-body">
                The permission is granted, but Microsoft only returns this log to Reports Reader, Security Reader or Security Administrator. Activate or request one of those roles, then refresh.
            </p>
            <Button icon="refresh" onClick={onRefresh}>Refresh</Button>
        </section>
    );
}

/** The read is running: the count so far and skeletons where the list and the detail will be. No spinner. */
export function Reading({ count, text, label = "Reading the audit log" }: { count: number; text?: string; label?: string }) {
    return (
        <div role="status" aria-label={label} aria-busy="true">
            <p className="mb-3 text-[13px] leading-[18px] text-muted">{text ?? (count > 0 ? `Reading the audit log. ${count.toLocaleString("en-US")} events so far.` : "Reading the audit log.")}</p>
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Skeleton className="block" width="100%" height={320} />
                <Skeleton className="block max-lg:hidden" width="100%" height={320} />
            </div>
        </div>
    );
}

/** The read failed: says nothing about whether anything happened */
export function ReadFailed({ onRetry, title = "The audit log could not be loaded" }: { onRetry: () => void; title?: string }) {
    return (
        <StatusBox variant="error" title={title} action={<Button onClick={onRetry}>Try again</Button>} className="max-w-[640px]">
            Microsoft did not answer. This says nothing about whether anything happened in this period.
        </StatusBox>
    );
}

/** More events than the limit in the period that was asked for: a shorter period is chosen here and read again */
export function TooMany({ requestedDays, onLoad }: { requestedDays: number; onLoad: (days: number) => void }) {
    // A period shorter than the one that failed; with one day there is none to offer
    const longest = Math.max(1, requestedDays - 1);
    const [draft, setDraft] = useState(String(Math.min(7, longest)));
    const parsed = Number.parseInt(draft, 10);
    const days = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), longest) : Math.min(7, longest);
    return (
        <StatusBox variant="warn" title={`More than ${AUDIT_ROW_LIMIT.toLocaleString("en-US")} events in the last ${requestedDays} days`} className="max-w-[640px]">
            <p>That is too many to show in your browser, and a part would look like the whole. Choose a shorter period.</p>
            {requestedDays > 1 && (
                <form
                    className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink"
                    onSubmit={(event) => {
                        event.preventDefault();
                        onLoad(days);
                    }}
                >
                    <label htmlFor="audit-shorter-days">Last</label>
                    <input id="audit-shorter-days" type="number" inputMode="numeric" min={1} max={longest} value={draft} onChange={(event) => setDraft(event.target.value)} className={NUMBER_INPUT} />
                    <span>days</span>
                    <Button variant="primary" type="submit">Load</Button>
                </form>
            )}
        </StatusBox>
    );
}

/** A successful read with nothing in the period: only after a read that worked, never after a failure */
export function NothingInPeriod({ days, isWorkspace = false, title = "Nothing happened in this period", text }: { days: number; isWorkspace?: boolean; title?: string; text?: string }) {
    return (
        <section className={PANEL_CLASS}>
            <h2 className="text-[13px] leading-5 font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-[13px] leading-[18px] text-muted">{text ?? (isWorkspace
                    ? `No PIM activations or changes in the last ${days} days, in the workspaces you chose.`
                    : `No PIM activations or changes in the last ${days} days, in a source that reaches back ${AUDIT_MAX_DAYS} days.`)}</p>
        </section>
    );
}

/** Events exist in the period but the filters hide them all */
export function NoMatchingEvents({ onClear }: { onClear: () => void }) {
    return <NoMatch title="No events match these filters in this stretch of time." detail="" onClear={onClear} />;
}

/** The banner of the canvas: up to 30 days without a workspace. The workspace section arrives with a later package. */
export function AuditBanner({ onDismiss, days = 30, logName = "Entra audit log" }: { onDismiss: () => void; days?: number; logName?: string }) {
    return (
        <div data-visual-section="audit-banner" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-accent-tint px-3 py-2 text-[13px] leading-[18px] text-ink">
            <span className="min-w-[280px] flex-1">
                You are looking at up to {days} days, the most the {logName} keeps. For a longer history,{" "}
                <Link href="/settings#workspace" className="text-accent underline">choose a Log Analytics workspace in Settings</Link>.
            </span>
            <Button size="sm" onClick={onDismiss}>Dismiss</Button>
        </div>
    );
}

/**
 * What the chosen workspaces could not give (canvas `WorkspacePartial` and `WorkspaceFailed`): some missing, or all of them
 * with the 30 days of the Entra audit log shown instead. It names what is missing and links to Settings; Retry reads again.
 */
export function WorkspaceNotice({ title, detail, onRetry, hasSettingsLink = true, hasEntraAuditLink = false }: { title: string; detail: string; onRetry: () => void; hasSettingsLink?: boolean; hasEntraAuditLink?: boolean }) {
    return (
        <div role="status" data-visual-section="audit-workspace-notice" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-line bg-warn-tint px-3 py-2 text-[13px] leading-[18px] text-ink">
            <span className="min-w-[280px] flex-1">
                <strong className="font-semibold">{title}</strong>{" "}{detail}
                {hasSettingsLink && <>{" "}<Link href="/settings#workspace" className="text-accent underline">Check Settings</Link>.</>}
                {hasEntraAuditLink && <>{" "}<Link href="/audit" className="text-accent underline">Open Entra Audit</Link>.</>}
            </span>
            <Button size="sm" onClick={onRetry}>Retry</Button>
        </div>
    );
}
