"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui/Dialog";
import { Tag } from "@/components/ui/Tag";
import { partlyNote, readabilitySentence, unreadSentence, type AzureReadability } from "@/utils/azureReadability";
import { ReadRest } from "./ReadRest";

const STATUS_TEXT = { all: "all", partly: "partly", failed: "could not be read" } as const;

/**
 * The readability sentence and its "What you can read" dialog (calm details spec 2.7), on the Azure Dashboard and Report
 * with details off; with what the read budget did not reach yet and Read the rest when a round left some
 */
export function ReadabilityLine({ readability, reportHref, onReadRest, isReadingRest = false }: { readability: AzureReadability; reportHref?: string; onReadRest?: () => void; isReadingRest?: boolean }) {
    const [isOpen, setIsOpen] = useState(false);
    const { first, second, hasDetails } = readabilitySentence(readability);
    const hasUnread = unreadSentence(readability) !== null;
    return (
        <div role="note" data-tour="azure-readability" data-visual-section={hasUnread ? "azure-unread" : undefined} className="text-[13px] leading-5 text-body">
            {first}
            {second && ` ${second}`}
            {/* After both sentences, so the action closes the text as Refresh to retry does */}
            <ReadRest readability={readability} onReadRest={onReadRest} isReading={isReadingRest} />
            {hasDetails && (
                <>
                    {" "}
                    <button type="button" onClick={() => setIsOpen(true)} className="inline-flex min-h-6 items-center text-accent underline underline-offset-2 max-sm:min-h-11">What you can read</button>
                    <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="What you can read" width={460}>
                        <h3 className="text-[13px] leading-5 font-semibold text-ink">Subscriptions</h3>
                        <ul className="mt-1 flex flex-col">
                            {readability.subscriptions.map((s) => (
                                <li key={s.id} className="border-t border-line py-2 text-[13px] leading-[18px] first:border-t-0">
                                    <span className="flex items-center justify-between gap-3">
                                        <span className="flex min-w-0 items-center gap-2 text-ink">
                                            <span className="truncate">{s.name}</span>
                                            {s.isDelegated && <Tag variant="accent">Lighthouse</Tag>}
                                        </span>
                                        <span className={s.status === "all" ? "shrink-0 text-muted" : "shrink-0 text-warn-text"}>{STATUS_TEXT[s.status]}</span>
                                    </span>
                                    {s.status === "partly" && <span className="mt-0.5 block text-xs leading-4 text-muted">{partlyNote(s)}</span>}
                                </li>
                            ))}
                        </ul>
                        {readability.notReadableSettings.length > 0 && (
                            <>
                                <h3 className="mt-4 text-[13px] leading-5 font-semibold text-ink">Role settings</h3>
                                <ul className="mt-1 flex flex-col">
                                    {readability.notReadableSettings.map((p) => (
                                        <li key={p.key} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[13px] leading-[18px] first:border-t-0">
                                            <span className="min-w-0 truncate text-ink">{`${p.roleName} · ${p.scopeName}`}</span>
                                            <span className="shrink-0 text-warn-text">not readable</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="mt-2 text-xs leading-4 text-muted">Left out of On activation and Require approval. Activate a role that may read PIM settings, then Refresh.</p>
                            </>
                        )}
                        {reportHref && <Link href={reportHref} className="mt-4 inline-flex min-h-6 items-center text-[13px] text-accent underline underline-offset-2 max-sm:min-h-11">Open the report to see what you can read</Link>}
                    </Dialog>
                </>
            )}
        </div>
    );
}
