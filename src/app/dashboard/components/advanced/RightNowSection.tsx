"use client";

import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { daysUntil, formatEndsIn, type RightNow, type RightNowRow } from "@/utils/dashboardAdvanced";
import { EmergencyBadge, SPLIT_END, SPLIT_START, SubHeading } from "./shared";

interface RightNowSectionProps {
    /** null: loading */
    data: RightNow | null;
    /** PIM for Groups is not in the lists */
    groupsNote?: string;
    emergencyAccountIds: ReadonlySet<string>;
    isDimmed: boolean;
}

function List({ className, title, count, rows, empty, format, emergencyAccountIds }: { className: string; emergencyAccountIds: ReadonlySet<string>; title: string; count: number | null; rows: RightNowRow[]; empty: string; format: (row: RightNowRow) => { text: string; isWarning: boolean } }) {
    return (
        <div className={className}>
            <SubHeading>
                {title} <span className="font-normal text-muted">{"·"} {count === null ? "..." : count}</span>
            </SubHeading>
            {count === null ? (
                <div className="mt-3 flex flex-col gap-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="block w-full" height={20} />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <p className="mt-3 text-[13px] leading-[18px] text-muted">{empty}</p>
            ) : (
                <>
                    <ul className="mt-2 flex flex-col">
                        {rows.map((row, i) => {
                            const when = format(row);
                            return (
                                <li key={`${row.principalId}-${row.what}-${i}`} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 border-t border-line py-2.5 text-[13px] leading-[18px] sm:grid-cols-[9rem_1fr_auto]">
                                    <span className="truncate font-medium text-ink" title={row.who}>{row.who}{emergencyAccountIds.has(row.principalId.toLowerCase()) && <EmergencyBadge />}</span>
                                    <span className="truncate text-body max-sm:col-span-2 max-sm:row-start-2" title={row.what}>{row.what}</span>
                                    <span className={`font-mono ${when.isWarning ? "text-warn-text" : "text-body"}`}>{when.text}</span>
                                </li>
                            );
                        })}
                    </ul>
                    {count > rows.length && <p className="mt-1 text-xs leading-4 text-muted">+{count - rows.length} more</p>}
                </>
            )}
        </div>
    );
}

/** Right now: activations that are running and eligibilities that end soon (spec 4.3 section 5). */
export function RightNowSection({ data, groupsNote, emergencyAccountIds, isDimmed }: RightNowSectionProps) {
    return (
        <section aria-labelledby="adv-activity-heading" className={PANEL_CLASS}>
            <SectionHeader eyebrow="activity" title="Right now" headingId="adv-activity-heading" isDimmed={isDimmed} />
            {groupsNote && <p className="mt-2 text-xs leading-4 text-muted">{groupsNote}</p>}
            <div className={`mt-5 grid grid-cols-1 lg:grid-cols-2 ${isDimmed ? "opacity-45" : ""}`}>
                <List className={SPLIT_START} emergencyAccountIds={emergencyAccountIds} title="Active through activation" count={data ? data.activatedCount : null} rows={data?.activated ?? []} empty="Nobody has an activation running." format={(row) => ({ text: `ends ${formatEndsIn(row.msLeft)}`, isWarning: false })} />
                <List
                    className={SPLIT_END}
                    emergencyAccountIds={emergencyAccountIds}
                    title="Eligibility ending within 7 days"
                    count={data ? data.endingCount : null}
                    rows={data?.ending ?? []}
                    empty="No eligibility ends within 7 days."
                    format={(row) => {
                        const days = daysUntil(row.msLeft);
                        return { text: `in ${days} ${days === 1 ? "day" : "days"}`, isWarning: days <= 2 };
                    }}
                />
            </div>
        </section>
    );
}
