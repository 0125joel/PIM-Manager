"use client";

import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import type { SettingsCompareResult } from "@/utils/importSettings";

interface SettingsCompareProps {
    result: SettingsCompareResult;
    tenantName: string;
    unchecked: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onToggleAll: (keys: string[], isChecked: boolean) => void;
    onReview: (changeCount: number) => void;
    /** Changes an earlier press already put in the basket */
    hasAdded: boolean;
}

/** A long file folds: the first rows, then "Show all n values" */
const FOLD = 50;
const LIST_FOLD = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Compare with {tenant}" (spec 7.4): one row per cell that differs, with the line it came from and the value now and in
 * the file, what needs a fix and what was left alone under the table, the footer with Review.
 */
export function SettingsCompare({ result, tenantName, unchecked, onToggle, onToggleAll, onReview, hasAdded }: SettingsCompareProps) {
    const id = useId();
    const [isUnfolded, setIsUnfolded] = useState(false);
    const { diffs, problems } = result;
    const visible = isUnfolded ? diffs : diffs.slice(0, FOLD);
    const allChecked = diffs.length > 0 && diffs.every((d) => !unchecked.has(d.key));
    const changeCount = diffs.filter((d) => !unchecked.has(d.key)).length;
    const [isListUnfolded, setIsListUnfolded] = useState(false);
    const fixes = useMemo(() => problems.filter((p) => p.kind === "fix"), [problems]);
    const left = useMemo(() => problems.filter((p) => p.kind === "skipped"), [problems]);
    const notes = useMemo(() => problems.filter((p) => p.kind === "note"), [problems]);
    // Five thousand rows with a typo would be five thousand lines: the lists fold too
    const shownFixes = isListUnfolded ? fixes : fixes.slice(0, LIST_FOLD);
    const shownLeft = isListUnfolded ? left : left.slice(0, LIST_FOLD);

    return (
        <section aria-labelledby={`${id}-title`} className="rounded border border-line bg-surface">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 p-4 sm:px-5">
                <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">{`Compare with ${tenantName}`}</h2>
                <p className="text-xs text-body">{`${plural(result.differs, "value differs", "values differ")}, ${result.matches} already match. Empty cells keep the current value.`}</p>
            </div>
            {diffs.length > 0 && (
                <div className="overflow-x-auto border-t border-line">
                    <table className="w-full min-w-[720px] text-left text-sm">
                        <thead>
                            <tr className="text-xs text-muted">
                                <th scope="col" className="w-12 py-2.5 pr-2 pl-4 font-normal sm:pl-5">
                                    <input type="checkbox" aria-label="Select every value" checked={allChecked} onChange={() => onToggleAll(diffs.map((d) => d.key), !allChecked)} className="h-4 w-4 accent-(--accent)" />
                                </th>
                                <th scope="col" className="w-16 py-2.5 pr-3 font-normal">{result.unit}</th>
                                <th scope="col" className="py-2.5 pr-3 font-normal">{result.targetLabel}</th>
                                <th scope="col" className="py-2.5 pr-3 font-normal">Setting</th>
                                <th scope="col" className="py-2.5 pr-4 font-normal sm:pr-5">Now, then the file</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((row) => (
                                <tr key={row.key} className="border-t border-line align-top">
                                    <td className="py-3 pl-4 sm:pl-5">
                                        <input
                                            type="checkbox"
                                            aria-label={`${result.unit} ${row.line}: ${row.target}, ${row.setting}`}
                                            checked={!unchecked.has(row.key)}
                                            onChange={() => onToggle(row.key)}
                                            className="h-4 w-4 accent-(--accent)"
                                        />
                                    </td>
                                    <td className="py-3 pr-3 text-body tabular-nums">{row.line}</td>
                                    <td className="py-3 pr-3 font-semibold text-ink">{row.target}</td>
                                    <td className="py-3 pr-3 text-ink">{row.setting}</td>
                                    <td className="py-3 pr-4 text-ink sm:pr-5">
                                        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                            <s className="text-body">{row.from}</s>
                                            <Icon name="arrow-right" size={16} className="shrink-0 text-ink" label="becomes" />
                                            <span className="font-semibold text-ink">{row.to}</span>
                                        </span>
                                        {row.warning && <span className="mt-0.5 block text-xs text-warn-text">{row.warning}</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {diffs.length === 0 && fixes.length === 0 && (
                <p className="border-t border-line px-4 py-6 text-center text-sm text-body sm:px-5">Nothing differs from the tenant: every filled cell already matches.</p>
            )}
            {!isUnfolded && diffs.length > FOLD && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                    <button type="button" onClick={() => setIsUnfolded(true)} className="rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11">{`Show all ${diffs.length} values`}</button>
                </div>
            )}
            {fixes.length > 0 && (
                <div className="border-t border-line bg-danger-tint px-4 py-3 sm:px-5">
                    <h3 className="text-[13px] font-semibold text-danger-text">{`${plural(fixes.length, "row needs", "rows need")} a fix and ${fixes.length === 1 ? "is" : "are"} left out`}</h3>
                    <ul className="mt-1 flex flex-col gap-1 text-[13px] text-ink">
                        {shownFixes.map((p, i) => <li key={`${p.line}-${i}`}><span className="tabular-nums text-body">{`${result.unit} ${p.line}`}</span>{` · ${p.target}: ${p.message}`}</li>)}
                    </ul>
                </div>
            )}
            {left.length > 0 && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                    <h3 className="text-[13px] font-semibold text-ink">Left alone</h3>
                    <ul className="mt-1 flex flex-col gap-1 text-[13px] text-body">
                        {shownLeft.map((p, i) => <li key={`${p.line}-${i}`}><span className="tabular-nums">{`${result.unit} ${p.line}`}</span>{` · ${p.target}: ${p.message}`}</li>)}
                    </ul>
                </div>
            )}
            {notes.length > 0 && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                    <h3 className="text-[13px] font-semibold text-ink">Notes</h3>
                    <ul className="mt-1 flex flex-col gap-1 text-[13px] text-body">
                        {notes.slice(0, isListUnfolded ? undefined : LIST_FOLD).map((p, i) => <li key={`${p.line}-${i}`}><span className="tabular-nums">{`${result.unit} ${p.line}`}</span>{` · ${p.target}: ${p.message}`}</li>)}
                    </ul>
                </div>
            )}
            {!isListUnfolded && (fixes.length > LIST_FOLD || left.length > LIST_FOLD || notes.length > LIST_FOLD) && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                    <button type="button" onClick={() => setIsListUnfolded(true)} className="rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11">Show every row that needs a fix or was left alone</button>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:px-5">
                <p className="min-w-0 flex-1 text-xs text-body">Changing how people activate takes effect at their next activation. The review lists who is affected.</p>
                <Button variant="primary" disabled={changeCount === 0 && !hasAdded} onClick={() => onReview(changeCount)}>
                    {changeCount === 0 ? (hasAdded ? "Take my earlier changes out" : "Nothing to review") : `Review ${plural(changeCount, "change", "changes")}`}
                </Button>
            </div>
        </section>
    );
}
