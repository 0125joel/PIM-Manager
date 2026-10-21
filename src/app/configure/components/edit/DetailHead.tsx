"use client";

import { useId, type Ref } from "react";
import { Icon } from "@/components/icons/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { GroupAccess } from "@/types/configure.types";
import type { TargetHead } from "@/utils/configureTargets";
import { TargetTags } from "./TargetTags";

interface DetailHeadProps {
    head: TargetHead;
    /** Groups: the side being edited (spec 5.3), `access` in the URL */
    onAccessChange?: (access: GroupAccess) => void;
    /** Below 1024: back to the list ("Roles" or "Groups") */
    backLabel: string;
    onBack: () => void;
    backRef?: Ref<HTMLButtonElement>;
    /** Opens "Copy settings to…" (spec 5.8); the reason it cannot when the target has no settings read */
    onCopy: () => void;
    copyDisabledReason: string | null;
}

/**
 * The head of a role or group in Edit (spec 5.3): name, tags, the catalog place and "{n} with access"; Member | Owner for
 * groups; "Copy settings to…" right (spec 5.8), not offered on a locked target, disabled with its reason while there is
 * nothing to copy.
 */
export function DetailHead({ head, onAccessChange, backLabel, onBack, backRef, onCopy, copyDisabledReason }: DetailHeadProps) {
    const { target } = head;
    const reasonId = useId();
    return (
        <header className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
            <button ref={backRef} type="button" onClick={onBack} className="inline-flex h-8 w-fit items-center gap-1.5 rounded border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-page lg:hidden max-sm:min-h-11">
                <Icon name="arrow-left" size={16} />
                {backLabel}
            </button>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-xl leading-7 font-semibold text-ink">{head.name}</h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-body">
                        <TargetTags tags={head.tags} />
                        {head.place && <span>{head.place}</span>}
                        <span>{head.withAccess}</span>
                    </p>
                </div>
                {!head.lock && (
                    <button
                        type="button"
                        onClick={copyDisabledReason ? undefined : onCopy}
                        aria-disabled={copyDisabledReason ? true : undefined}
                        aria-describedby={copyDisabledReason ? reasonId : undefined}
                        title={copyDisabledReason ?? undefined}
                        className={`inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-2.5 text-[13px] font-medium max-sm:h-11 ${copyDisabledReason ? "cursor-not-allowed text-body opacity-60" : "text-ink hover:bg-page"}`}
                    >
                        Copy settings to…
                        {copyDisabledReason && <span id={reasonId} className="sr-only">{copyDisabledReason}</span>}
                    </button>
                )}
            </div>
            {target.kind === "group" && onAccessChange && (
                <SegmentedControl
                    ariaLabel="Member or owner settings"
                    variant="pill"
                    value={target.access}
                    onChange={onAccessChange}
                    className="w-fit"
                    options={[{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }]}
                />
            )}
        </header>
    );
}
