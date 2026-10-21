"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SectionHeader, PANEL_CLASS } from "@/components/ui/SectionHeader";
import { ListSearch, matchesQuery } from "@/components/ui/ListSearch";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import { ChangeInConfigureLink } from "@/components/ui/ChangeInConfigureLink";
import type { ConfigureLinkTarget } from "@/utils/configureLinks";
import { getEntraGroupUrl, type GroupOutsidePim } from "@/utils/groupsOutsidePim";

/** More rows than this are folded: a tenant can have dozens of role-assignable groups outside PIM */
const VISIBLE_LIMIT = 10;

export type GroupsBlockState = "loading" | "ready" | "noConsent" | "notCounted" | "error";

interface GroupsOutsidePimBlockProps {
    state: GroupsBlockState;
    rows: GroupOutsidePim[];
    /** Every role-assignable group, for the all clear sentence */
    roleAssignableCount: number;
    isDimmed: boolean;
    onGrant: () => void;
    /** The failed block (spec 4.7) */
    errorMessage?: string | null;
    onRetry?: () => void;
    /** "Change in Configure" (spec 16): the link for a group the admin may change, else null */
    changeHrefFor?: (target: ConfigureLinkTarget) => string | null;
}

function BringUnderPim({ group }: { group: GroupOutsidePim }) {
    return (
        <a href={getEntraGroupUrl(group.id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 whitespace-nowrap text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11 max-sm:items-center">
            Bring under PIM
            <span className="sr-only">: {group.name}, opens the Microsoft Entra admin center</span>
        </a>
    );
}

function ChangeLink({ group, changeHrefFor }: { group: GroupOutsidePim; changeHrefFor?: (target: ConfigureLinkTarget) => string | null }) {
    const href = changeHrefFor?.({ kind: "group", id: group.id, tab: "who" });
    return href ? <ChangeInConfigureLink href={href} name={group.name} /> : null;
}

function Holds({ group }: { group: GroupOutsidePim }) {
    return group.holds.length > 0 ? <span className="text-warn-text">{group.holds.join(", ")}</span> : <span className="text-muted">no role yet</span>;
}

/** Role-assignable groups outside PIM: who gets a role permanently, without activation (spec 4.2 item 3). */
export function GroupsOutsidePimBlock({ state, rows, roleAssignableCount, isDimmed, onGrant, errorMessage, onRetry, changeHrefFor }: GroupsOutsidePimBlockProps) {
    const [dismissedError, setDismissedError] = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [query, setQuery] = useState("");
    const isSearching = query.trim() !== "";
    const matching = isSearching ? rows.filter((g) => matchesQuery(g.name, query)) : rows;
    const visibleRows = showAll || isSearching ? matching : matching.slice(0, VISIBLE_LIMIT);
    const count = state === "ready" ? rows.length : undefined;
    return (
        <section tabIndex={-1} aria-labelledby="gaps-heading" className={`${PANEL_CLASS} outline-none ${isDimmed ? "opacity-45" : ""}`}>
            <SectionHeader
                eyebrow="gaps"
                title="Role-assignable groups outside PIM"
                headingId="gaps-heading"
                count={count}
                countTone={count === 0 ? "muted" : "warn"}
                subline="Members get the group's roles permanently, without activation."
            />

            {state === "noConsent" && (
                <StatusBox variant="consent" title="PIM for Groups is not granted yet" className="mt-4" action={<Button variant="primary" size="sm" onClick={onGrant}>Grant read access</Button>}>
                    Reading groups needs two extra read permissions. Microsoft asks you once; nothing is changed in your tenant.
                </StatusBox>
            )}

            {state === "error" && dismissedError !== (errorMessage ?? "") && (
                <StatusBox variant="error" title="PIM for Groups could not be loaded" className="mt-4" dismissLabel="Dismiss: PIM for Groups error" onDismiss={() => setDismissedError(errorMessage ?? "")} action={<Button size="sm" onClick={onRetry}>Try again</Button>}>
                    {errorMessage ?? "Microsoft Graph did not answer."}
                </StatusBox>
            )}

            {state === "notCounted" && <p className="mt-4 text-[13px] leading-[18px] text-muted">PIM for Groups and Unmanaged groups are not counted. Switch both chips on to see these groups.</p>}

            {state === "loading" && (
                <div className="mt-4 flex flex-col gap-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="block w-full" height={20} />
                    ))}
                </div>
            )}

            {state === "ready" && rows.length === 0 && (
                <StatusBox variant="success" className="mt-4">
                    {roleAssignableCount === 0 ? "No role-assignable groups." : `All ${roleAssignableCount} role-assignable groups are under PIM.`}
                </StatusBox>
            )}

            {state === "ready" && rows.length > 0 && (
                <>
                    {rows.length > VISIBLE_LIMIT && <ListSearch value={query} onChange={setQuery} label="Search role-assignable groups outside PIM" className="mt-4" />}
                    {isSearching && matching.length === 0 && <p className="mt-3 text-[13px] leading-[18px] text-muted">No group matches {`"${query.trim()}"`}.</p>}
                    <table className="mt-4 hidden w-full border-collapse text-[13px] leading-[18px] sm:table">
                        <thead>
                            <tr className="text-left text-muted">
                                <th scope="col" className="pb-2 pr-3 font-normal">Group</th>
                                <th scope="col" className="pb-2 pr-3 font-normal">Holds</th>
                                <th scope="col" className="pb-2 pr-3 text-right font-normal">Members</th>
                                <th scope="col" className="pb-2 font-normal"><span className="sr-only">Action</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((g) => (
                                <tr key={g.id} className="border-t border-line">
                                    <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">{g.name}</th>
                                    <td className="py-2.5 pr-3"><Holds group={g} /></td>
                                    <td className="py-2.5 pr-3 text-right font-mono text-ink">{g.memberCount ?? "-"}</td>
                                    <td className="py-2.5 text-right"><span className="inline-flex flex-wrap items-center justify-end gap-3"><BringUnderPim group={g} /><ChangeLink group={g} changeHrefFor={changeHrefFor} /></span></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <ul className="mt-4 flex flex-col sm:hidden">
                        {visibleRows.map((g) => (
                            <li key={g.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                                <div className="min-w-0 text-[13px] leading-[18px]">
                                    <p className="font-medium text-ink">{g.name}</p>
                                    <p className="text-muted">
                                        <Holds group={g} /> {" · "} {g.memberCount === undefined ? "members not read" : `${g.memberCount} members`}
                                    </p>
                                </div>
                                <span className="flex shrink-0 flex-col items-end gap-1"><BringUnderPim group={g} /><ChangeLink group={g} changeHrefFor={changeHrefFor} /></span>
                            </li>
                        ))}
                    </ul>
                    {!isSearching && rows.length > VISIBLE_LIMIT && (
                        <button type="button" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)} className="mt-2 inline-flex min-h-6 items-center text-[13px] leading-[18px] text-accent underline underline-offset-2 max-sm:min-h-11">
                            {showAll ? "Show fewer" : `Show all ${rows.length} groups`}
                        </button>
                    )}
                </>
            )}
        </section>
    );
}
