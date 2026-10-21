"use client";

import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StackedBar } from "@/components/charts/StackedBar";
import type { DashboardFilter, MaxDurationBucket } from "@/types/dashboardFilter.types";
import type { ActivationCharts, CustomExtensionRow, DashboardScope } from "@/utils/dashboardAdvanced";
import { isSameFilter } from "@/utils/dashboardStats";
import { CountRow, SectionNotice, SubHeading } from "./shared";

const DURATION_ROWS: { key: MaxDurationBucket; label: string; isWarning: boolean }[] = [
    { key: "upTo1h", label: "≤ 1 h", isWarning: false },
    { key: "upTo4h", label: "≤ 4 h", isWarning: false },
    { key: "upTo8h", label: "≤ 8 h", isWarning: false },
    { key: "upTo12h", label: "≤ 12 h", isWarning: true },
    { key: "over12h", label: "> 12 h", isWarning: true },
];

interface ActivationSectionProps {
    /** null: nothing to show yet */
    charts: ActivationCharts | null;
    scope: DashboardScope;
    /** Policies are still arriving: bars are placeholders */
    isPending: boolean;
    /** Policy loading is still running (a finished load with missing policies says "not counted") */
    isPolicyLoading?: boolean;
    notice?: string;
    extensions: CustomExtensionRow[];
    filter: DashboardFilter;
    onSetFilter: (filter: DashboardFilter) => void;
    isDimmed: boolean;
}

function RequiredBar({ label, required, notRequired }: { label: string; required: number; notRequired: number }) {
    return (
        <StackedBar
            ariaLabel={`${label}: ${required} required, ${notRequired} not required`}
            segments={[
                { label: "required", value: required, color: "var(--accent)" },
                { label: "not required", value: notRequired, color: "var(--track)" },
            ]}
        />
    );
}

/** On activation: MFA, approval, justification and maximum duration, then the custom extensions (spec 4.3 section 2). */
export function ActivationSection({ charts, scope, isPending, isPolicyLoading = false, notice, extensions, filter, onSetFilter, isDimmed }: ActivationSectionProps) {
    const noun = scope === "all" ? "roles" : "privileged roles";
    const toggle = (target: DashboardFilter) => () => onSetFilter(isSameFilter(filter, target) ? {} : target);
    const pressed = (target: DashboardFilter) => isSameFilter(filter, target);
    const show = !isPending && charts !== null;
    const maxDuration = Math.max(1, ...(charts ? Object.values(charts.durations) : [1]));

    return (
        <section aria-labelledby="adv-terms-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="terms" title={charts && !notice ? `On activation, ${charts.roleCount} ${noun}` : "On activation"} headingId="adv-terms-heading" isDimmed={isDimmed} />
            <div className={isDimmed ? "opacity-45" : ""}>
                {notice ? (
                    <SectionNotice>{notice}</SectionNotice>
                ) : (
                    <>
                        <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
                            <div>
                                <SubHeading>MFA or auth context</SubHeading>
                                <div className="mt-3">
                                    {show ? (
                                        <StackedBar
                                            ariaLabel={`MFA or auth context: ${charts.entraMfa} Entra MFA, ${charts.authContext} auth context, ${charts.neither} neither`}
                                            segments={[
                                                { label: "Entra MFA", value: charts.entraMfa, color: "var(--accent)" },
                                                { label: "Auth context", value: charts.authContext, color: "var(--bar-light)" },
                                                { label: "Neither", value: charts.neither, color: "var(--warn-fill)" },
                                            ]}
                                        />
                                    ) : (
                                        <Skeleton className="block w-full" height={12} />
                                    )}
                                </div>
                                <ul className="mt-3">
                                    <CountRow label="Entra MFA" value={charts?.entraMfa ?? null} isPending={!show} onSelect={toggle({ mfa: "entraMfa" })} isPressed={pressed({ mfa: "entraMfa" })} />
                                    <CountRow label="Auth context" value={charts?.authContext ?? null} isPending={!show} onSelect={toggle({ mfa: "authContext" })} isPressed={pressed({ mfa: "authContext" })} />
                                    <CountRow label="Neither" tone="warn" value={charts?.neither ?? null} isPending={!show} onSelect={toggle({ mfa: "neither" })} isPressed={pressed({ mfa: "neither" })} />
                                </ul>
                            </div>
                            <div>
                                <SubHeading>Approval</SubHeading>
                                <div className="mt-3">{show ? <RequiredBar label="Approval" required={charts.approvalRequired} notRequired={charts.approvalNotRequired} /> : <Skeleton className="block w-full" height={12} />}</div>
                                <ul className="mt-3">
                                    <CountRow label="Required" value={charts?.approvalRequired ?? null} isPending={!show} onSelect={toggle({ approval: "required" })} isPressed={pressed({ approval: "required" })} />
                                    <CountRow label="Not required" value={charts?.approvalNotRequired ?? null} isPending={!show} onSelect={toggle({ approval: "notRequired" })} isPressed={pressed({ approval: "notRequired" })} />
                                </ul>
                            </div>
                            <div>
                                <SubHeading>Justification</SubHeading>
                                <div className="mt-3">{show ? <RequiredBar label="Justification" required={charts.justificationRequired} notRequired={charts.justificationNotRequired} /> : <Skeleton className="block w-full" height={12} />}</div>
                                <ul className="mt-3">
                                    <CountRow label="Required" value={charts?.justificationRequired ?? null} isPending={!show} onSelect={toggle({ justification: "required" })} isPressed={pressed({ justification: "required" })} />
                                    <CountRow label="Not required" value={charts?.justificationNotRequired ?? null} isPending={!show} onSelect={toggle({ justification: "notRequired" })} isPressed={pressed({ justification: "notRequired" })} />
                                </ul>
                            </div>
                            <div>
                                <SubHeading>Maximum duration</SubHeading>
                                <ul className="mt-3 flex flex-col gap-1.5">
                                    {DURATION_ROWS.map((row) => {
                                        const value = show ? charts.durations[row.key] : null;
                                        const target: DashboardFilter = { maxDuration: row.key };
                                        const isPressed = pressed(target);
                                        return (
                                            <li key={row.key}>
                                                <button type="button" disabled={!show} aria-pressed={isPressed} onClick={toggle(target)} className={`-mx-2 grid min-h-6 w-[calc(100%+1rem)] grid-cols-[3.5rem_1fr_2rem] items-center gap-3 rounded px-2 text-[13px] leading-[18px] text-ink transition-colors duration-150 enabled:hover:bg-page max-sm:min-h-11 ${isPressed ? "bg-accent-tint" : ""}`}>
                                                    <span className={`text-left ${isPressed ? "underline underline-offset-2" : ""}`}>{row.label}</span>
                                                    <span aria-hidden="true" className="h-2 rounded-full bg-track">
                                                        <span className="block h-full rounded-full" style={{ width: value === null ? 0 : `${(value / maxDuration) * 100}%`, backgroundColor: row.isWarning ? "var(--warn-fill)" : "var(--accent)" }} />
                                                    </span>
                                                    {value === null ? <Skeleton width={20} height={14} /> : <span className="text-right font-mono">{value}</span>}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        </div>

                        {charts && charts.unloaded > 0 && !isPolicyLoading && (
                            <p className="mt-4 text-xs leading-4 text-muted">{charts.unloaded} {charts.unloaded === 1 ? "role is" : "roles are"} not counted: the settings could not be loaded.</p>
                        )}
                        {charts && charts.notReadable > 0 && (
                            <p className="mt-4 text-xs leading-4 text-muted">{charts.notReadable} {charts.notReadable === 1 ? "role is" : "roles are"} not counted: the settings are not readable with your current access.</p>
                        )}

                        {extensions.length > 0 && (
                            <div className="mt-6 border-t border-dashed border-line pt-4">
                                <SubHeading>
                                    Custom extensions <span className="ml-2 font-mono text-xs font-normal text-muted">preview</span>
                                </SubHeading>
                                <ul className="mt-2 flex flex-col">
                                    {extensions.map((ext) => {
                                        // A row lists the roles that link the extension: the filter shows which ones (and which cannot be activated)
                                        const target: DashboardFilter = { customExtension: ext.id };
                                        const isPressed = pressed(target);
                                        return (
                                            <li key={`${ext.id}-${ext.stage}`} className="border-t border-line first:border-t-0">
                                                <button type="button" aria-pressed={isPressed} onClick={toggle(target)} className={`-mx-2 grid w-[calc(100%+1rem)] grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-0.5 rounded px-2 py-2 text-left text-[13px] leading-[18px] transition-colors duration-150 hover:bg-page sm:grid-cols-[1fr_7rem_6rem_5rem] max-sm:min-h-11 ${isPressed ? "bg-accent-tint" : ""}`}>
                                                    <span className="text-ink">
                                                        {ext.name}
                                                        {ext.blockedRoles.length > 0 && (
                                                            <span className="text-danger-text">
                                                                {" · "}
                                                                {ext.blockedRoles[0]}
                                                                {ext.blockedRoles.length > 1 ? ` and ${ext.blockedRoles.length - 1} more` : ""} cannot be activated
                                                            </span>
                                                        )}
                                                    </span>
                                                    <span className="text-body">{ext.stage}</span>
                                                    <span className="font-mono text-body sm:text-right">
                                                        {ext.roleCount} {ext.roleCount === 1 ? "role" : "roles"}
                                                    </span>
                                                    <span className="text-danger-text sm:text-right">{ext.isNotFound ? "not found" : ""}</span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
