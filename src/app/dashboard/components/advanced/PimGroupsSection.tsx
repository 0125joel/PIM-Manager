"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { ListSearch, matchesQuery } from "@/components/ui/ListSearch";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import type { GroupsSection } from "@/utils/dashboardAdvanced";
import { SectionNotice, SPLIT_END, SPLIT_START, SubHeading } from "./shared";

export type GroupsSectionState = "loading" | "ready" | "noConsent" | "notCounted" | "error";

interface PimGroupsSectionProps {
    state: GroupsSectionState;
    section: GroupsSection;
    errorMessage?: string | null;
    onGrant: () => void;
    onRetry: () => void;
    isDimmed: boolean;
}

/** PIM for Groups: the groups outside PIM and the busiest managed groups (spec 4.3 section 3). */
const OUTSIDE_LIMIT = 8;

export function PimGroupsSection({ state, section, errorMessage, onGrant, onRetry, isDimmed }: PimGroupsSectionProps) {
    const [showAllOutside, setShowAllOutside] = useState(false);
    const [query, setQuery] = useState("");
    const isSearching = query.trim() !== "";
    const matching = isSearching ? section.outside.filter((g) => matchesQuery(g.name, query)) : section.outside;
    const outsideRows = showAllOutside || isSearching ? matching : matching.slice(0, OUTSIDE_LIMIT);
    return (
        <section tabIndex={-1} aria-labelledby="adv-groups-heading" className={`${PANEL_CLASS} outline-none`}>
            <SectionHeader eyebrow="groups" title="PIM for Groups" headingId="adv-groups-heading" isDimmed={isDimmed} />
            <div className={isDimmed ? "opacity-45" : ""}>
                {state === "noConsent" && (
                    <StatusBox variant="consent" title="PIM for Groups is not granted yet" className="mt-4" action={<Button variant="primary" size="sm" onClick={onGrant}>Grant read access</Button>}>
                        Reading groups needs two extra read permissions. Microsoft asks you once; nothing is changed in your tenant.
                    </StatusBox>
                )}
                {state === "error" && (
                    <StatusBox variant="error" title="PIM for Groups could not be loaded" className="mt-4" action={<Button size="sm" onClick={onRetry}>Try again</Button>}>
                        {errorMessage ?? "Microsoft Graph did not answer."}
                    </StatusBox>
                )}
                {state === "notCounted" && <SectionNotice>PIM for Groups is not counted. Switch the chip on to see this.</SectionNotice>}
                {state === "loading" && (
                    <div className="mt-5 flex flex-col gap-3" aria-hidden="true">
                        {[0, 1, 2, 3].map((i) => (
                            <Skeleton key={i} className="block w-full" height={20} />
                        ))}
                    </div>
                )}
                {state === "ready" && (
                    <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <div className={SPLIT_START}>
                            <SubHeading>Outside PIM</SubHeading>
                            <p className="mt-3 flex items-baseline gap-3 text-[13px] leading-5 text-ink">
                                <span className={`font-mono text-2xl leading-7 ${section.outside.length > 0 ? "text-warn-text" : "text-muted"}`}>{section.outside.length}</span>
                                role-assignable groups outside PIM
                            </p>
                            {section.outside.length === 0 ? (
                                <StatusBox variant="success" className="mt-3">All role-assignable groups are under PIM.</StatusBox>
                            ) : (
                                <>
                                {section.outside.length > OUTSIDE_LIMIT && <ListSearch value={query} onChange={setQuery} label="Search groups outside PIM" className="mt-3" />}
                                {isSearching && matching.length === 0 && <p className="mt-3 text-[13px] leading-[18px] text-muted">No group matches {`"${query.trim()}"`}.</p>}
                                <ul className="mt-3 flex flex-col">
                                    {outsideRows.map((g) => (
                                        <li key={g.id} className="flex items-baseline justify-between gap-3 border-t border-line py-2.5 text-[13px] leading-[18px]">
                                            <span className="min-w-0 truncate font-medium text-ink" title={g.name}>{g.name}</span>
                                            <span className="shrink-0 text-muted">{g.type}</span>
                                        </li>
                                    ))}
                                </ul>
                                </>
                            )}
                            {!isSearching && section.outside.length > OUTSIDE_LIMIT && (
                                <button type="button" aria-expanded={showAllOutside} onClick={() => setShowAllOutside((v) => !v)} className="mt-2 inline-flex min-h-6 items-center text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11">
                                    {showAllOutside ? "Show fewer" : `Show all ${section.outside.length} groups`}
                                </button>
                            )}
                        </div>
                        <div className={SPLIT_END}>
                            <div className="flex items-baseline justify-between gap-3">
                                <SubHeading>
                                    Managed by PIM <span className="font-normal text-muted">{"·"} {section.managedCount}, top {Math.min(5, section.topManaged.length) || 5}</span>
                                </SubHeading>
                                <Link href="/report?view=groups&f=groupPim:under" className="inline-flex min-h-6 items-center text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11">
                                    All in report
                                </Link>
                            </div>
                            {section.topManaged.length === 0 ? (
                                <SectionNotice>No groups are managed by PIM yet.</SectionNotice>
                            ) : (
                                <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Managed groups table">
                                    <table className="w-full min-w-[26rem] border-collapse text-[13px] leading-[18px]">
                                        <thead>
                                            <tr className="text-right text-muted">
                                                <th scope="col" className="py-2 pr-3 text-left font-normal">Group</th>
                                                <th scope="col" className="py-2 pr-3 font-normal">Members elig.</th>
                                                <th scope="col" className="py-2 pr-3 font-normal">Members active</th>
                                                <th scope="col" className="py-2 pr-3 font-normal">Owners elig.</th>
                                                <th scope="col" className="py-2 font-normal">Permanent</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {section.topManaged.map((g) => (
                                                <tr key={g.id} className="border-t border-line text-right font-mono text-ink">
                                                    <th scope="row" className="max-w-[12rem] truncate py-2.5 pr-3 text-left font-sans font-medium" title={g.name}>{g.name}</th>
                                                    <td className="py-2.5 pr-3">{g.membersEligible}</td>
                                                    <td className="py-2.5 pr-3">{g.membersActive}</td>
                                                    <td className="py-2.5 pr-3">{g.ownersEligible}</td>
                                                    <td className={`py-2.5 ${g.permanent > 0 ? "text-warn-text" : "text-muted"}`}>{g.permanent}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
