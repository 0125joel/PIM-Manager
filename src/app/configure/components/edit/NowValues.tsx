"use client";

import { useEffect, useRef, useState } from "react";
import type { SettingField } from "@/types/configure.types";
import { describeSettingValue, type ValueWords } from "@/utils/configureSettingRows";
import { MISSING_WORDS, splitNames, type NowColumn, type ValueGroup } from "@/utils/settingValues";

interface NowValuesProps {
    field: SettingField;
    column: NowColumn;
    words: ValueWords;
}

/**
 * The Now column of several targets (spec 5.6): one value "on all of them", or "{k} different values" with per value the
 * targets that have it, two names and the rest behind "+{n}", which expands.
 */
export function NowValues({ field, column, words }: NowValuesProps) {
    const valueOf = (group: ValueGroup) => (group.missing ? MISSING_WORDS[group.missing] : describeSettingValue(field, group.value, words));
    if (column.groups.length === 0) return null;
    return (
        <div className="text-[13px] leading-[18px]">
            {column.isSame ? (
                <>
                    <p className="font-semibold text-ink">{valueOf(column.groups[0])}</p>
                    <p className="text-body">on all of them</p>
                </>
            ) : (
                <>
                    <p className="text-body">{`${column.groups.length} different values`}</p>
                    {column.groups.map((group) => (
                        <div key={group.targets.map((t) => t.id).join(",")} className="mt-1.5">
                            <p className="font-semibold text-ink">{valueOf(group)}</p>
                            <Names names={group.names} />
                        </div>
                    ))}
                </>
            )}
            {column.waiting > 0 && <p className="mt-1.5 text-xs text-muted">{`${column.waiting} with a change waiting`}</p>}
        </div>
    );
}

function Names({ names }: { names: readonly string[] }) {
    const [isOpen, setIsOpen] = useState(false);
    const listRef = useRef<HTMLParagraphElement>(null);
    // "+n" goes away when pressed: the full list takes its focus (U-05)
    useEffect(() => { if (isOpen) listRef.current?.focus(); }, [isOpen]);
    const split = splitNames(names);
    if (isOpen || split.more === 0) return <p ref={listRef} tabIndex={isOpen ? -1 : undefined} className="text-body focus:outline-none">{names.join(", ")}</p>;
    return (
        <p className="text-body">
            {split.names.join(", ")}{" "}
            <button type="button" onClick={() => setIsOpen(true)} className="text-accent underline underline-offset-2 max-sm:min-h-11">
                {`+${split.more}`}
                <span className="sr-only">{` more: show all ${names.length}`}</span>
            </button>
        </p>
    );
}
