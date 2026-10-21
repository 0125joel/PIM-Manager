"use client";

import { Icon } from "@/components/icons/Icon";
import { DemoLock } from "@/components/ui/DemoLock";
import type { LastApplyLine } from "@/utils/configureStart";

interface LastAppliesProps {
    lines: LastApplyLine[];
    /** Why Undo cannot be used for this apply, or null when it can */
    undoBlockedReason: (runId: string) => string | null;
    onUndo: (runId: string) => void;
    /** An undo that stopped, said once above the list */
    notice?: string | null;
}

const STATUS_ICON = { done: "success", problems: "alert", unfinished: "clock" } as const;
const STATUS_LABEL = { done: "Applied", problems: "Applied with problems", unfinished: "Not finished" } as const;

/** Last applies (spec 14.3): the history of this browser, with Undo */
export function LastApplies({ lines, undoBlockedReason, onUndo, notice }: LastAppliesProps) {
    return (
        <section aria-labelledby="last-applies-title" className="rounded border border-line bg-surface">
            <h2 id="last-applies-title" className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">Last applies</h2>
            {notice && <p role="alert" className="border-b border-line bg-warn-tint px-4 py-2 text-xs text-ink">{notice}</p>}
            {lines.length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted">Nothing applied yet from this browser.</p>
            ) : (
                <ul>
                    {lines.map((line) => {
                        const reason = undoBlockedReason(line.runId);
                        return (
                            <li key={line.runId} className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
                                <Icon name={STATUS_ICON[line.status]} size={16} className={`mt-0.5 shrink-0 ${line.status === "problems" ? "text-warn-text" : "text-ink"}`} label={STATUS_LABEL[line.status]} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-ink">{line.title}</p>
                                    <p className="text-xs text-body">{line.subline}</p>
                                </div>
                                <DemoLock>
                                    {(locked) => (
                                        <button
                                            type="button"
                                            disabled={locked || !!reason}
                                            title={reason ?? undefined}
                                            onClick={() => onUndo(line.runId)}
                                            className="inline-flex h-[26px] shrink-0 items-center rounded border border-line bg-surface px-2 text-xs text-ink hover:bg-page disabled:cursor-not-allowed disabled:text-muted max-sm:h-11"
                                        >
                                            Undo{reason && <span className="sr-only">: {reason}</span>}
                                        </button>
                                    )}
                                </DemoLock>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
