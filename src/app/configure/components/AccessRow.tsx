"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import type { AccessView } from "@/utils/configureStart";

interface AccessRowProps {
    view: AccessView;
    onRetry: () => void;
    onGrant: () => void;
    isGranting: boolean;
    /** "Open the Report" in the closed state */
    reportHref: string;
}

const TONE: Record<AccessView["row"]["kind"], string> = {
    checking: "border border-line bg-surface",
    failed: "bg-warn-tint",
    open: "border border-line bg-surface",
    activate: "bg-warn-tint",
    closed: "bg-danger-tint",
    consent: "bg-warn-tint",
};

/** The access row of the start page (spec 3.4) with its details table; the text comes from `describeAccess` */
export function AccessRow({ view, onRetry, onGrant, isGranting, reportHref }: AccessRowProps) {
    const [isOpen, setIsOpen] = useState(false);
    const detailsId = useId();
    const { row } = view;
    const detailsButton = view.details.length > 0 && (
        <button type="button" onClick={() => setIsOpen((o) => !o)} aria-expanded={isOpen} aria-controls={detailsId} className="text-xs text-accent underline underline-offset-2 hover:text-ink">
            Details
        </button>
    );

    return (
        <section aria-label="What you can change" className="mb-4">
            <div role={row.kind === "checking" ? "status" : undefined} className={`rounded px-4 py-3 text-sm ${TONE[row.kind]}`}>
                {row.kind === "checking" && (
                    <p className="flex items-center gap-2 text-body"><Icon name="spinner" size={16} />{row.title}</p>
                )}
                {row.kind === "failed" && (
                    <p className="flex flex-wrap items-center gap-3 text-warn-text"><Icon name="alert" size={16} /><span className="font-semibold">{row.title}</span><Button size="sm" onClick={onRetry}>Try again</Button></p>
                )}
                {row.kind === "open" && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <Icon name="success" size={16} className="text-ink" />
                        <span className="font-semibold text-ink">{row.title}</span>
                        {row.chips.map((chip) => (
                            <span key={chip} className="inline-flex items-center gap-1 rounded bg-success-tint px-2 py-0.5 text-xs font-medium text-success-text"><Icon name="check" size={16} />{chip}</span>
                        ))}
                        {row.via && <span className="text-xs text-body">{row.via}</span>}
                        <span className="ml-auto">{detailsButton}</span>
                    </div>
                )}
                {row.kind === "activate" && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-warn-text">
                        <Icon name="alert" size={16} />
                        <span className="font-semibold">{row.title}</span>
                        <span className="text-xs text-body">{row.text}</span>
                        <a href={row.link.href} target="_blank" rel="noreferrer" className="text-xs text-accent underline underline-offset-2">{row.link.label}</a>
                        <span className="ml-auto">{detailsButton}</span>
                    </div>
                )}
                {row.kind === "closed" && (
                    <div className="text-ink">
                        <p className="flex items-start gap-2"><Icon name="lock" size={16} className="mt-0.5 shrink-0" /><span><span className="font-semibold">{row.title}</span> {row.text}</span></p>
                        <p className="ml-6 mt-1 text-xs text-body">{row.subline} <a href={reportHref} className="text-accent underline underline-offset-2">Open the Report</a> · {detailsButton}</p>
                    </div>
                )}
                {row.kind === "consent" && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-warn-text">
                        <Icon name="key" size={16} />
                        <span className="font-semibold text-ink">{row.title}</span>
                        <span className="text-xs text-body">{row.text}</span>
                        <Button size="sm" onClick={onGrant} isLoading={isGranting}>Grant permission</Button>
                        <span className="ml-auto">{detailsButton}</span>
                    </div>
                )}
            </div>
            {isOpen && view.details.length > 0 && (
                <div id={detailsId} className="mt-2 overflow-x-auto rounded border border-line bg-surface px-4 py-3">
                    <table className="w-full min-w-[520px] text-left text-xs">
                        <thead className="text-muted">
                            <tr><th className="py-1 pr-4 font-medium">What</th><th className="py-1 pr-4 font-medium">Your role</th><th className="py-1 pr-4 font-medium">App permission</th><th className="py-1 font-medium">Status</th></tr>
                        </thead>
                        <tbody className="text-ink">
                            {view.details.map((d) => (
                                <tr key={d.what} className="border-t border-line"><td className="py-1.5 pr-4">{d.what}</td><td className="py-1.5 pr-4">{d.role}</td><td className="py-1.5 pr-4">{d.permission}</td><td className="py-1.5">{d.status}</td></tr>
                            ))}
                        </tbody>
                    </table>
                    {view.detailsLine && <p className="mt-2 text-xs text-muted">{view.detailsLine}</p>}
                </div>
            )}
        </section>
    );
}
