"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import { Icon } from "@/components/icons/Icon";
import type { AlertSummary } from "@/utils/alertSummary";

export type AlertsBlockState = "loading" | "ready" | "noConsent" | "error";

export interface AlertsBlockProps {
    state: AlertsBlockState;
    summary: AlertSummary;
    errorMessage: string | null;
    isGranting: boolean;
    showDismissed: boolean;
    isDimmed: boolean;
    onGrant: () => void;
    onRetry: () => void;
    onDismiss: (id: string) => void;
    onRestoreDismissed: () => void;
    onShowDismissedChange: (show: boolean) => void;
}

/** "From Microsoft": PIM's own security alerts, a row per alert that expands inline (spec 4.2 item 3). */
export function AlertsBlock({ state, summary, errorMessage, isGranting, showDismissed, isDimmed, onGrant, onRetry, onDismiss, onRestoreDismissed, onShowDismissedChange }: AlertsBlockProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [dismissedError, setDismissedError] = useState<string | null>(null);
    const isReady = state === "ready";
    const sectionRef = useRef<HTMLElement>(null);

    // The dismissed row (and its button) leaves the page: keep keyboard focus inside the block
    const dismiss = (id: string) => {
        setExpandedId(null);
        onDismiss(id);
        sectionRef.current?.focus();
    };

    return (
        <section ref={sectionRef} tabIndex={-1} aria-labelledby="alerts-heading" className={`${PANEL_CLASS} outline-none ${isDimmed ? "opacity-45" : ""}`}>
            <SectionHeader
                eyebrow="alerts"
                title="From Microsoft"
                headingId="alerts-heading"
                count={isReady ? summary.openCount : undefined}
                countTone={summary.openCount === 0 ? "muted" : "warn"}
                subline={isReady ? `PIM's own security alerts. ${summary.passedCount} checks passed.` : "PIM's own security alerts."}
            />

            {state === "noConsent" && (
                <StatusBox variant="consent" title="Security alerts are not granted yet" className="mt-4" action={<Button variant="primary" size="sm" isLoading={isGranting} onClick={onGrant}>Grant read access</Button>}>
                    Microsoft&apos;s PIM alerts need one extra read permission. Microsoft asks you once; nothing is changed in your tenant.
                    {errorMessage && <span className="mt-1 block text-danger-text">{errorMessage}</span>}
                </StatusBox>
            )}

            {state === "loading" && (
                <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="block w-full" height={20} />
                    ))}
                </div>
            )}

            {state === "error" && dismissedError !== (errorMessage ?? "") && (
                <StatusBox variant="error" title="Security alerts could not be loaded" className="mt-4" dismissLabel="Dismiss: Security alerts error" onDismiss={() => setDismissedError(errorMessage ?? "")} action={<Button size="sm" onClick={onRetry}>Try again</Button>}>
                    {errorMessage ?? "Microsoft Graph did not answer."}
                </StatusBox>
            )}

            {isReady && summary.rows.length === 0 && (
                <StatusBox variant="success" className="mt-4">
                    No alerts. {summary.passedCount} checks passed.
                </StatusBox>
            )}

            {isReady && summary.rows.length > 0 && (
                <ul className="mt-4 flex flex-col border-b border-line">
                    {summary.rows.map((row) => {
                        const isExpanded = expandedId === row.id;
                        const panelId = `alert-${row.id}`;
                        const incidents = row.alert.alertIncidents ?? [];
                        return (
                            <li key={row.id} className="border-t border-line">
                                <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    aria-controls={panelId}
                                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                                    className="flex min-h-[38px] w-[calc(100%+1rem)] items-center gap-3 py-2 text-left text-[13px] leading-[18px] text-ink max-sm:min-h-11 -mx-2 rounded px-2 transition-colors duration-150 hover:bg-page"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`h-2 w-2 shrink-0 rounded-full ${row.isFilled ? "bg-warn-fill" : "border border-neutral-fill"}`}
                                    />
                                    <span className="flex-1">
                                        {row.title}
                                        <span className="sr-only">, {row.severity} severity</span>
                                        {row.isDismissed && <span className="ml-2 text-muted">(dismissed)</span>}
                                    </span>
                                    <span className="font-mono text-body">{row.affected}</span>
                                    <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={16} className="text-muted" />
                                </button>
                                {isExpanded && (
                                    <div id={panelId} className="pb-3 pl-5 text-[13px] leading-[18px] text-body">
                                        {row.description && <p>{row.description}</p>}
                                        {incidents.length > 0 && (
                                            <ul className="mt-2 list-disc pl-5">
                                                {incidents.map((incident, i) => (
                                                    <li key={incident.id || i}>
                                                        {incident.assigneeDisplayName || incident.roleDisplayName || "Unknown"}
                                                        {incident.assigneeUserPrincipalName && <span className="text-muted"> ({incident.assigneeUserPrincipalName})</span>}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {row.alert.alertDefinition?.mitigationSteps && (
                                            <p className="mt-2">
                                                <span className="font-medium text-ink">Mitigation: </span>
                                                {row.alert.alertDefinition.mitigationSteps}
                                            </p>
                                        )}
                                        {!row.isDismissed && (
                                            <button type="button" onClick={() => dismiss(row.id)} className="mt-2 inline-flex min-h-6 items-center text-accent underline underline-offset-2 max-sm:min-h-11">
                                                Dismiss this alert
                                            </button>
                                        )}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {isReady && summary.dismissedCount > 0 && (
                <div className="mt-2 flex flex-wrap gap-x-4">
                    <button type="button" onClick={() => onShowDismissedChange(!showDismissed)} className="inline-flex min-h-6 items-center text-[13px] leading-[18px] text-muted underline underline-offset-2 max-sm:min-h-11">
                        {showDismissed ? "Hide dismissed alerts" : `Show dismissed (${summary.dismissedCount})`}
                    </button>
                    <button type="button" onClick={() => { onRestoreDismissed(); onShowDismissedChange(false); }} className="inline-flex min-h-6 items-center text-[13px] leading-[18px] text-muted underline underline-offset-2 max-sm:min-h-11">
                        Restore dismissed
                    </button>
                </div>
            )}
        </section>
    );
}
