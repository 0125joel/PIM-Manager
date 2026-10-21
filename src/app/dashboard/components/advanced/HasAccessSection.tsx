"use client";

import { StackedBar } from "@/components/charts/StackedBar";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { HasAccess } from "@/utils/dashboardAdvanced";
import { isSameFilter } from "@/utils/dashboardStats";
import { SectionNotice, SPLIT_END, SPLIT_START, SubHeading } from "./shared";

const COLORS = { permanent: "var(--warn-fill)", eligible: "var(--accent)", timeBound: "var(--bar-light)" };

/** The legend under the bars; each entry filters on that kind of assignment, like the Who legend in Basic */
const LEGEND: { label: string; color: string; target: DashboardFilter }[] = [
    { label: "permanent", color: COLORS.permanent, target: { assignment: "permanent" } },
    { label: "eligible", color: COLORS.eligible, target: { assignment: "eligible" } },
    { label: "active, time-bound", color: COLORS.timeBound, target: { assignment: "activeTimeBound" } },
];

const ROW_BUTTON = "-mx-2 rounded px-2 transition-colors duration-150 hover:bg-page";

interface HasAccessSectionProps {
    /** null: loading */
    access: HasAccess | null;
    notice?: string;
    /** PIM for Groups is not in the numbers: the group rows say so instead of showing 0 */
    groupsNote?: string;
    isDimmed: boolean;
    filter: DashboardFilter;
    onSetFilter: (filter: DashboardFilter) => void;
}

/** Has access, and how: assignment types per workload and direct or through a group (spec 4.3 section 1). */
export function HasAccessSection({ access, notice, groupsNote, isDimmed, filter, onSetFilter }: HasAccessSectionProps) {
    const toggle = (target: DashboardFilter) => onSetFilter(isSameFilter(filter, target) ? {} : target);
    return (
        <section aria-labelledby="adv-who-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="who" title="Has access, and how" headingId="adv-who-heading" isDimmed={isDimmed} />
            <div className={isDimmed ? "opacity-45" : ""}>
                {notice ? (
                    <SectionNotice>{notice}</SectionNotice>
                ) : (
                    <div className="mt-5 grid grid-cols-1 lg:grid-cols-2">
                        <div className={SPLIT_START}>
                            <SubHeading>Assignment type per workload</SubHeading>
                            <ul className="mt-3 flex flex-col gap-2">
                                {(access?.rows ?? [null, null, null]).map((row, i) => (
                                    <li key={row?.label ?? i} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-[13px] leading-[18px] text-ink sm:grid-cols-[10rem_1fr_3rem]">
                                        {row && groupsNote && row.label !== "Directory roles" ? (
                                            <>
                                                <span>{row.label}</span>
                                                <span className="col-span-2 text-muted">not included</span>
                                            </>
                                        ) : row ? (
                                            <>
                                                <span>{row.label}</span>
                                                <StackedBar
                                                    ariaLabel={`${row.label}: ${row.permanent} permanent, ${row.eligible} eligible, ${row.activeTimeBound} active time-bound, ${row.total} in total`}
                                                    segments={[
                                                        { label: "permanent", value: row.permanent, color: COLORS.permanent },
                                                        { label: "eligible", value: row.eligible, color: COLORS.eligible },
                                                        { label: "active, time-bound", value: row.activeTimeBound, color: COLORS.timeBound },
                                                    ]}
                                                />
                                                <span className="text-right font-mono">{row.total}</span>
                                            </>
                                        ) : (
                                            <>
                                                <Skeleton width={90} height={14} />
                                                <Skeleton className="block w-full" height={12} />
                                                <Skeleton width={28} height={14} />
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {groupsNote && <p className="mt-2 text-xs leading-4 text-muted">{groupsNote}</p>}
                            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-4 text-body" aria-label="Legend">
                                {LEGEND.map((item) => {
                                    const isPressed = isSameFilter(filter, item.target);
                                    return (
                                        <li key={item.label}>
                                            <button type="button" aria-pressed={isPressed} disabled={!access} onClick={() => toggle(item.target)} className={`flex min-h-6 items-center gap-1.5 max-sm:min-h-11 ${ROW_BUTTON} ${isPressed ? "bg-accent-tint text-accent" : ""}`}>
                                                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                                                {item.label}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                        <div className={SPLIT_END}>
                            <SubHeading>Direct or through a group</SubHeading>
                            {access ? (
                                <>
                                    <ul className="mt-3 flex flex-col gap-2">
                                        {[
                                            { label: "Direct", value: access.direct, color: COLORS.eligible, target: { via: "direct" } as DashboardFilter },
                                            { label: "Through a group", value: access.viaGroup, color: COLORS.timeBound, target: { via: "group" } as DashboardFilter },
                                        ].map((item) => {
                                            const max = Math.max(1, access.direct, access.viaGroup);
                                            const isPressed = isSameFilter(filter, item.target);
                                            return (
                                                <li key={item.label}>
                                                    <button type="button" aria-pressed={isPressed} onClick={() => toggle(item.target)} className={`grid min-h-6 w-[calc(100%+1rem)] grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-left text-[13px] leading-[18px] text-ink sm:grid-cols-[10rem_1fr_3rem] max-sm:min-h-11 ${ROW_BUTTON} ${isPressed ? "bg-accent-tint" : ""}`}>
                                                        <span>{item.label}</span>
                                                        <span role="img" aria-label={`${item.label}: ${item.value} assignments`} className="block h-3 rounded-full bg-track">
                                                            <span className="block h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }} />
                                                        </span>
                                                        <span className="text-right font-mono">{item.value}</span>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="mt-3 font-mono text-xs leading-[18px] text-accent">
                                        {access.viaGroup} {access.viaGroup === 1 ? "assignment" : "assignments"} via {access.groupsHoldingRoles} {access.groupsHoldingRoles === 1 ? "group" : "groups"}. Membership decides who gets the role.
                                    </p>
                                </>
                            ) : (
                                <div className="mt-3 flex flex-col gap-2" aria-hidden="true">
                                    <Skeleton className="block w-full" height={12} />
                                    <Skeleton className="block w-full" height={12} />
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
