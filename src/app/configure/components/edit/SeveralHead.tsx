"use client";

import { useEffect, useId, useRef } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { GroupAccess } from "@/types/configure.types";

interface SeveralHeadProps {
    names: readonly string[];
    /** "roles" or "groups" */
    noun: string;
    /** The rows set: "Add {n} to changes" */
    setCount: number;
    /** Why the choices cannot be added; null when they can */
    problem: string | null;
    onAdd: () => void;
    /** What the last Add did, read out politely */
    status: string;
    /** Groups: the side every selected group is changed on */
    access?: GroupAccess;
    onAccessChange?: (access: GroupAccess) => void;
}

/**
 * The head of several targets (spec 5.6): "{n} roles selected" with the names, the primary "Add {n} to changes" (the
 * number of rows set) and, for groups, Member | Owner for all of them.
 */
export function SeveralHead({ names, noun, setCount, problem, onAdd, status, access, onAccessChange }: SeveralHeadProps) {
    const problemId = useId();
    const isDisabled = setCount === 0 || names.length === 0 || problem !== null;
    // "Add" turns disabled once its rows went into the basket: the focus moves to the line that says what happened (U-05)
    const statusRef = useRef<HTMLParagraphElement>(null);
    useEffect(() => {
        const active = document.activeElement as HTMLButtonElement | null;
        if (status && (!active || active === document.body || active.disabled)) statusRef.current?.focus();
    }, [status]);
    return (
        <header className="flex flex-col gap-3 border-b border-line p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-xl leading-7 font-semibold text-ink">
                        {names.length === 0 ? `Select the ${noun} to change together` : `${names.length} ${names.length === 1 ? noun.replace(/s$/, "") : noun} selected`}
                    </h2>
                    {names.length > 0 && <p className="mt-1 text-xs leading-[18px] text-body">{names.join(", ")}</p>}
                    {names.length === 0 && <p className="mt-1 text-[13px] text-body">{`Tick the ${noun} in the list. Only ${noun} you may change can be ticked.`}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={onAdd} disabled={isDisabled} aria-describedby={problem ? problemId : undefined}>{`Add ${setCount} to changes`}</Button>
                </div>
            </div>
            {problem && (
                <p id={problemId} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-warn-text">
                    <Icon name="alert" size={16} className="mt-px shrink-0" />
                    {problem}
                </p>
            )}
            {/* Always in the tree, so a screen reader hears the text that arrives */}
            <p ref={statusRef} tabIndex={-1} role="status" className="text-[13px] text-body empty:sr-only focus:outline-none">{status}</p>
            {access && onAccessChange && (
                <SegmentedControl
                    ariaLabel="Member or owner settings"
                    variant="pill"
                    value={access}
                    onChange={onAccessChange}
                    className="w-fit"
                    options={[{ value: "member", label: "Member" }, { value: "owner", label: "Owner" }]}
                />
            )}
        </header>
    );
}
