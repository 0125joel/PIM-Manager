"use client";

import { Icon } from "@/components/icons/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import { PANEL_CLASS } from "@/components/ui/SectionHeader";
import { Tag } from "@/components/ui/Tag";
import { stateGroupOf, type NoActivationRow } from "@/utils/auditNoActivation";

const TH = "border-b border-line py-2 pr-2 text-left align-top text-xs leading-[17px] font-semibold text-ink";
const TD = "border-b border-line py-2 pr-2 align-top";

/** The Activation cell: a warning has a shape and a word as well as its colour; a group or a permanent assignment is muted, never a warning */
function ActivationCell({ row }: { row: NoActivationRow }) {
    if (row.isWarning) {
        return (
            <span className="inline-flex items-start gap-1.5 text-warn-text">
                <span className="pt-0.5"><Icon name="alert" size={14} /></span>
                <span><span className="sr-only">Warning: </span>{row.activationText}</span>
            </span>
        );
    }
    // Members being read: a skeleton, so the row never reads as a verdict
    if (row.state === "loading") {
        return (
            <span role="status" aria-label={row.activationText} className="block">
                <Skeleton className="block" width={180} height={16} />
            </span>
        );
    }
    // Not judged: a warning about the data, with its own shape and word, never a verdict on the role
    if (stateGroupOf(row.state) === "notRead") {
        return (
            <span className="inline-flex items-start gap-1.5 text-warn-text">
                <span className="pt-0.5"><Icon name="info" size={14} /></span>
                <span><span className="sr-only">Not judged: </span>{row.activationText}</span>
            </span>
        );
    }
    const isMuted = stateGroupOf(row.state) === "na";
    return <span className={isMuted ? "text-muted" : "text-body"}>{row.activationText}</span>;
}

/** The Who line, shared by the table and the cards: the name, the emergency tag and the group it comes through */
function WhoBlock({ row }: { row: NoActivationRow }) {
    return (
        <>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{row.who}</span>
                {row.isEmergency && (
                    <Tag variant="warn">
                        <span className="inline-flex items-center gap-1"><Icon name="emergency-access" size={12} />Emergency access</span>
                    </Tag>
                )}
            </span>
            {row.viaGroup && <span className="block text-xs leading-4 text-muted">{`Through ${row.viaGroup}`}</span>}
        </>
    );
}

/** What the table shows while the assignments are read: no rows, so a role never looks unused for want of data */
export function NoActivationLoading({ text = "Reading the assignments" }: { text?: string }) {
    return (
        <div role="status" aria-label={text} aria-busy="true">
            <p className="mb-3 text-[13px] leading-[18px] text-muted">{text}.</p>
            <Skeleton className="block" width="100%" height={240} />
        </div>
    );
}

interface AuditNoActivationProps {
    days: number;
    /** The rows after the filters and the search */
    rows: readonly NoActivationRow[];
    /** The literal text above the table */
    honesty: string;
    /** Everything that limits the table, one line each with its reason; empty when nothing does */
    limits: readonly string[];
}

/**
 * The No activation table (AU-6, canvas `NoActivation.dc.html`): the heading, the honesty text, the note when PIM for Groups
 * is not included, and one row per assignment with its Activation. The container shows this only after a read of the audit
 * log that worked and a read of the assignments that worked.
 */
export function AuditNoActivation({ days, rows, honesty, limits }: AuditNoActivationProps) {
    return (
        <section className={PANEL_CLASS}>
            <h2 className="text-[13px] leading-5 font-semibold text-ink">{`Assignments and their activation in the last ${days} days`}</h2>
            <p className="mt-1 mb-3 text-[13px] leading-[18px] text-muted">{honesty}</p>
            {limits.length > 0 && (
                <div role="note" aria-label="What limits this table" data-no-activation-limits className="mb-3 rounded border border-line bg-band px-3 py-2 text-[13px] leading-[18px] text-body">
                    <p className="font-semibold text-ink">Not everything could be read</p>
                    <ul className="mt-1 list-disc pl-4">
                        {limits.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </div>
            )}
            {rows.length === 0 ? (
                <p className="text-[13px] leading-[18px] text-muted">No assignments to show for these filters.</p>
            ) : (
                <>
                {/* Below 640 the rows are cards; from 640 up the table. Only one of the two is exposed at a time. */}
                <ul aria-label="Assignments and their activation" data-no-activation-cards className="m-0 list-none p-0 sm:hidden">
                    {rows.map((row) => (
                        <li key={row.id} data-no-activation={row.state} className="border-b border-line py-3 last:border-b-0">
                            <p className="m-0 text-[15px] leading-5 font-medium text-ink">{row.resourceName}</p>
                            {row.scopeName && <p className="m-0 text-[13px] leading-[18px] text-muted">{row.scopeName}</p>}
                            {row.who && <div className="mt-2 text-[13px] leading-[18px] text-body"><WhoBlock row={row} /></div>}
                            <div className="mt-2 text-[13px] leading-[18px]"><ActivationCell row={row} /></div>
                            {row.typeText && <p className="m-0 mt-1 text-[13px] leading-[18px] text-muted">{row.typeText}</p>}
                        </li>
                    ))}
                </ul>
                <div className="relative overflow-x-auto max-sm:hidden">
                    <table className="w-full min-w-[640px] border-collapse text-[13px] leading-[18px]">
                        <thead>
                            <tr>
                                <th scope="col" className={TH}>Role or group</th>
                                <th scope="col" className={TH}>Scope</th>
                                <th scope="col" className={TH}>Who</th>
                                <th scope="col" className={TH}>Type</th>
                                <th scope="col" className={TH}>Activation</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} data-no-activation={row.state}>
                                    <td className={`${TD} text-ink`}>{row.resourceName}</td>
                                    <td className={`${TD} text-body`}>{row.scopeName}</td>
                                    <td className={`${TD} text-body`}>
                                        <WhoBlock row={row} />
                                    </td>
                                    <td className={`${TD} text-body`}>{row.typeText}</td>
                                    <td className={TD}><ActivationCell row={row} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                </>
            )}
        </section>
    );
}
