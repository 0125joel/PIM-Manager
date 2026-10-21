"use client";

import { useId } from "react";
import { Icon } from "@/components/icons/Icon";
import type { TargetRow as TargetRowData } from "@/utils/configureTargets";
import { TargetTags } from "./TargetTags";

interface TargetRowProps {
    row: TargetRowData;
    isCurrent: boolean;
    /** Select several: ticked or not; undefined outside it */
    isChecked?: boolean;
    /** The one row the Tab key reaches */
    isTabStop: boolean;
    onSelect: () => void;
    /** Every row has the same reason, said once above the rows: the row points at it and shows only the lock */
    sharedReasonId?: string;
}

/**
 * A row of the Edit list (spec 5.2): the violet dot for changes, the name, the tags and the summary, the number of
 * people right. A locked row stays focusable so its reason can be read, but cannot be selected.
 */
export function TargetRow({ row, isCurrent, isChecked, isTabStop, onSelect, sharedReasonId }: TargetRowProps) {
    const isSeveral = isChecked !== undefined;
    const isLocked = row.lock !== null;
    const reasonId = `${useId()}-lock`;
    return (
        <button
            type="button"
            data-list-row=""
            data-row-id={row.id}
            tabIndex={isTabStop ? 0 : -1}
            role={isSeveral ? "checkbox" : undefined}
            aria-checked={isSeveral ? isChecked : undefined}
            aria-current={isCurrent ? "true" : undefined}
            aria-disabled={isLocked || undefined}
            aria-describedby={isLocked ? sharedReasonId ?? reasonId : undefined}
            onClick={isLocked ? undefined : onSelect}
            className={`relative flex w-full items-start gap-2 border-b border-line py-3 pr-3 pl-3 text-left last:border-b-0 max-sm:min-h-11 ${isLocked ? "cursor-not-allowed" : "hover:bg-page"} ${isCurrent ? "bg-accent-tint before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-accent" : ""} ${isChecked ? "bg-accent-tint" : ""}`}
        >
            {isSeveral && (
                <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${isChecked ? "border-accent bg-accent text-accent-ink" : isLocked ? "border-line bg-page" : "border-ink bg-surface"}`}>
                    {isChecked && <Icon name="check" size={16} />}
                </span>
            )}
            <span className="mt-[7px] flex w-2 shrink-0 justify-center">
                {row.hasChanges && (
                    <>
                        <span className="h-1.5 w-1.5 rounded-full bg-change" aria-hidden="true" />
                        <span className="sr-only">has changes</span>
                    </>
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className={`block text-[15px] leading-5 font-medium ${isLocked ? "text-body" : "text-ink"}`}>{row.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-[18px] text-muted">
                    <TargetTags tags={row.tags} />
                    <span>{row.summary}</span>
                </span>
                {isLocked && !sharedReasonId && (
                    <span id={reasonId} className="mt-1 flex items-start gap-1.5 text-[13px] leading-[18px] text-body">
                        <Icon name="lock" size={16} className="mt-px shrink-0 text-muted" />
                        <span>{row.lock}</span>
                    </span>
                )}
            </span>
            {isLocked && sharedReasonId && <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-muted" />}
            <span className="mt-0.5 shrink-0 text-[13px] text-body tabular-nums" title={row.kind === "group" && row.tags.includes("notUnderPim") ? "Members" : "People with access"}>
                {row.people}
                <span className="sr-only">{row.kind === "group" && row.tags.includes("notUnderPim") ? " members" : " with access"}</span>
            </span>
        </button>
    );
}
