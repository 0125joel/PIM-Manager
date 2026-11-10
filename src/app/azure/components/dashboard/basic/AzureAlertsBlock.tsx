"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { SectionHeader, PANEL_CLASS, DIMMED_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tag } from "@/components/ui/Tag";
import { summarizeAzureAlerts, type AzureAlertsOutcome } from "@/utils/azureDashboardView";

interface AzureAlertsBlockProps {
    /** By lowercase subscription id */
    alerts: ReadonlyMap<string, AzureAlertsOutcome>;
    /** Subscriptions read of the subscriptions to read; the block shows its skeleton rows until `done` reaches `total` */
    progress: { done: number; total: number };
    /** The name of a subscription, asked by lowercase subscription id */
    subscriptionName: (subscriptionId: string) => string;
    /** Asked by lowercase subscription id */
    isDelegated: (subscriptionId: string) => boolean;
    isDimmed: boolean;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

/**
 * "From Microsoft" on the Azure dashboard: PIM's own alerts for Azure resources, read per subscription. Same structure as
 * the Entra `AlertsBlock` (a row per alert that expands inline) with no consent and no dismiss: the alerts need no extra permission.
 */
export function AzureAlertsBlock({ alerts, progress, subscriptionName, isDelegated, isDimmed }: AzureAlertsBlockProps) {
    const [expandedKey, setExpandedKey] = useState<string | null>(null);
    const isLoading = progress.done < progress.total;
    const summary = useMemo(() => summarizeAzureAlerts(alerts, subscriptionName, isDelegated), [alerts, subscriptionName, isDelegated]);

    return (
        <section aria-labelledby="azure-alerts-heading" className={`${PANEL_CLASS} ${isDimmed ? DIMMED_CLASS : ""}`}>
            <div className="flex items-start gap-3">
                <SectionHeader
                    className="min-w-0 flex-1"
                    eyebrow="alerts"
                    title="From Microsoft"
                    headingId="azure-alerts-heading"
                    count={isLoading ? undefined : summary.rows.length}
                    subline="PIM's own alerts for Azure resources, read per subscription."
                />
                <Tag className="mt-1 shrink-0">preview</Tag>
            </div>

            {isLoading && (
                <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="block w-full" height={20} />
                    ))}
                </div>
            )}

            {!isLoading && (
                <>
                    {(summary.rows.length > 0 || summary.notScanned > 0) && (
                        <ul className="mt-4 flex flex-col border-b border-line">
                            {summary.rows.map((row) => {
                                const isExpanded = expandedKey === row.key;
                                const panelId = `azure-alert-${row.key.replace(/[^a-zA-Z0-9-]/g, "-")}`;
                                return (
                                    <li key={row.key} className="border-t border-line">
                                        <button
                                            type="button"
                                            aria-expanded={isExpanded}
                                            aria-controls={panelId}
                                            onClick={() => setExpandedKey(isExpanded ? null : row.key)}
                                            className="flex min-h-[38px] w-[calc(100%+1rem)] items-center gap-3 py-2 text-left text-[13px] leading-[18px] text-ink max-sm:min-h-11 -mx-2 rounded px-2 transition-colors duration-150 hover:bg-page"
                                        >
                                            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${row.severity.toLowerCase() === "high" ? "bg-danger-text" : "bg-warn-fill"}`} />
                                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                                <span className="font-medium">{row.name}</span>
                                                <span className="font-mono text-xs text-muted">{`${row.subscriptionName} · ${row.severity}`}</span>
                                            </span>
                                            <span className="font-mono text-body">{row.incidentCount}</span>
                                            <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={16} className="text-muted" />
                                        </button>
                                        {isExpanded && (
                                            <div id={panelId} className="pb-3 pl-5 text-[13px] leading-[18px] text-body">
                                                {row.description && <p>{row.description}</p>}
                                                {row.mitigationSteps && (
                                                    <p className="mt-2">
                                                        <span className="font-medium text-ink">{"Mitigation: "}</span>
                                                        {row.mitigationSteps}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                            {summary.notScanned > 0 && (
                                <li className="border-t border-line">
                                    <div className="flex items-center gap-3 py-2 text-[13px] leading-[18px]">
                                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border-[1.5px] border-neutral-fill" />
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="font-medium text-ink">{`Not scanned yet on ${plural(summary.notScanned, "subscription", "subscriptions")}`}</span>
                                            <span className="text-xs leading-4 text-muted">Microsoft has not run these alerts there. No alert does not mean nothing is wrong.</span>
                                        </span>
                                        <span className="font-mono text-muted">{summary.notScanned}</span>
                                    </div>
                                </li>
                            )}
                        </ul>
                    )}
                    <p className="mt-3 text-[13px] leading-[18px] text-muted">
                        {`Read on ${plural(summary.read, "subscription", "subscriptions")}${summary.delegatedRead > 0 ? `, ${summary.delegatedRead} of them delegated` : ""}: ${summary.withAlert} with an alert, ${summary.clear} clear, ${summary.notScanned} not scanned yet. Solve an alert in the Azure portal.`}
                        {summary.notReadable > 0 && ` ${plural(summary.notReadable, "subscription", "subscriptions")} not readable.`}
                    </p>
                </>
            )}
        </section>
    );
}
