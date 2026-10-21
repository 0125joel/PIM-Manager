"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import { targetKey } from "@/utils/configureBasket";
import { COPY_CATEGORIES, describePlan, planCopy, type CopyCategory, type SeveralEntry } from "@/utils/settingValues";

interface CopySettingsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    source: SeveralEntry;
    /** Targets of the same kind (roles, or groups on the same side) the admin may change, the source left out */
    candidates: readonly SeveralEntry[];
    /** "roles" or "groups" */
    noun: string;
}

/**
 * "Copy settings to…" (spec 5.8): the targets of the same kind and the categories to copy (Activation by default).
 * "Copy to {n}" adds one change per target and field where the value differs; the dialog says how many that makes
 * before it is confirmed. A target whose policy is not read cannot be chosen.
 */
export function CopySettingsDialog({ isOpen, onClose, source, candidates, noun }: CopySettingsDialogProps) {
    return (
        <Dialog isOpen={isOpen} onClose={onClose} title={`Copy the settings of ${source.name}`} width={560}>
            {/* A new opening starts from the defaults */}
            {isOpen && <CopyForm key={targetKey(source.target)} source={source} candidates={candidates} noun={noun} onClose={onClose} />}
        </Dialog>
    );
}

function CopyForm({ source, candidates, noun, onClose }: Omit<CopySettingsDialogProps, "isOpen">) {
    const { basket } = useConfigureBasket();
    const { add, leaveOut } = useConfigureBasketActions();
    const [categories, setCategories] = useState<ReadonlySet<CopyCategory>>(() => new Set<CopyCategory>(["activation"]));
    const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
    const [query, setQuery] = useState("");

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates;
    }, [candidates, query]);
    const readable = shown.filter((c) => c.settings !== null);
    const targets = useMemo(() => candidates.filter((c) => chosen.has(targetKey(c.target))), [candidates, chosen]);
    const ordered = useMemo(() => COPY_CATEGORIES.map((c) => c.value).filter((c) => categories.has(c)), [categories]);
    const plan = useMemo(() => planCopy(source, ordered, targets, basket), [source, ordered, targets, basket]);
    const effect = describePlan(plan, noun);

    const toggle = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
        const next = new Set(set);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
    };
    const allShownChosen = readable.length > 0 && readable.every((c) => chosen.has(targetKey(c.target)));
    const toggleAllShown = () => {
        const next = new Set(chosen);
        for (const c of readable) {
            if (allShownChosen) next.delete(targetKey(c.target));
            else next.add(targetKey(c.target));
        }
        setChosen(next);
    };

    let summary: string;
    if (targets.length === 0) summary = `Choose the ${noun} to copy to.`;
    else if (ordered.length === 0) summary = "Choose what to copy.";
    else if (!effect) summary = `The chosen ${noun} already have these settings: nothing to add.`;
    else summary = `This ${effect}. Nothing is written until you review and apply.`;

    const confirm = () => {
        if (plan.leaveOut.length > 0) leaveOut(plan.leaveOut);
        add(plan.add);
        onClose();
    };

    return (
        <div className="flex flex-col gap-4">
            <fieldset>
                <legend className="text-[13px] font-semibold text-ink">Copy</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                    {COPY_CATEGORIES.map((c) => (
                        <label key={c.value} className="flex items-center gap-2 text-sm text-ink max-sm:min-h-11">
                            <input type="checkbox" checked={categories.has(c.value)} onChange={() => setCategories((s) => toggle(s, c.value))} className="h-4 w-4 accent-(--accent)" />
                            {c.label}
                        </label>
                    ))}
                </div>
            </fieldset>
            <fieldset className="min-w-0">
                <legend className="text-[13px] font-semibold text-ink">{`To these ${noun}`}</legend>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="relative block min-w-0 flex-1">
                        <span className="sr-only">{`Search ${noun}`}</span>
                        <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun}`} className="h-9 w-full rounded border border-line bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted max-sm:h-11" />
                    </label>
                    <Button variant="secondary" size="sm" onClick={toggleAllShown} disabled={readable.length === 0}>{allShownChosen ? "Clear the ones shown" : `Choose all ${readable.length} shown`}</Button>
                </div>
                <ul className="mt-2 max-h-64 overflow-y-auto rounded border border-line">
                    {shown.length === 0 && <li className="px-3 py-3 text-[13px] text-body">{`No ${noun} match.`}</li>}
                    {shown.map((c) => {
                        const key = targetKey(c.target);
                        const isReadable = c.settings !== null;
                        return (
                            <li key={key} className="border-b border-line last:border-b-0">
                                <label className={`flex items-start gap-2.5 px-3 py-2 text-sm max-sm:min-h-11 ${isReadable ? "text-ink" : "text-muted"}`}>
                                    <input type="checkbox" disabled={!isReadable} checked={chosen.has(key)} onChange={() => setChosen((s) => toggle(s, key))} className="mt-0.5 h-4 w-4 shrink-0 accent-(--accent)" />
                                    <span className="min-w-0">
                                        {c.name}
                                        {!isReadable && <span className="block text-xs">{c.missing === "loading" ? "Settings still loading" : "Settings not read, cannot be chosen"}</span>}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            </fieldset>
            <p role="status" className="text-[13px] leading-[18px] text-body">{summary}</p>
            {effect && plan.skipped.length > 0 && (
                <p className="text-[13px] leading-[18px] text-body">{`Left alone where they do not have a setting read: ${plan.skipped.join(", ")}.`}</p>
            )}
            {plan.problem && (
                <p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-warn-text">
                    <Icon name="alert" size={16} className="mt-px shrink-0" />
                    {plan.problem}
                </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="primary" onClick={confirm} disabled={plan.add.length === 0 || plan.problem !== null}>{`Copy to ${targets.length}`}</Button>
            </div>
        </div>
    );
}
