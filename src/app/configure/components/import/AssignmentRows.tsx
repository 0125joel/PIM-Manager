"use client";

import { useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { countRows, filterRows, isSelectable, type CheckedRow, type RowFilter } from "@/utils/importAssignments";

interface AssignmentRowsProps {
    rows: readonly CheckedRow[];
    unchecked: ReadonlySet<number>;
    filter: RowFilter;
    onFilter: (filter: RowFilter) => void;
    onToggle: (line: number) => void;
    onToggleAll: (lines: number[], isChecked: boolean) => void;
    onReview: (changeCount: number) => void;
    /** Changes an earlier press already put in the basket */
    hasAdded: boolean;
}

/** A long file folds: the first rows, then "Show all n rows" (a tenant file has hundreds, the fixture eight) */
const FOLD = 50;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Check the rows" (spec 7.3): the filter, one row per line of the file with its result, the footer with Review */
export function AssignmentRows({ rows, unchecked, filter, onFilter, onToggle, onToggleAll, onReview, hasAdded }: AssignmentRowsProps) {
    const id = useId();
    const [isUnfolded, setIsUnfolded] = useState(false);
    const counts = useMemo(() => countRows(rows), [rows]);
    const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
    const visible = isUnfolded ? shown : shown.slice(0, FOLD);
    const selectable = shown.filter(isSelectable);
    const allChecked = selectable.length > 0 && selectable.every((r) => !unchecked.has(r.line));
    const changeCount = rows.filter((r) => isSelectable(r) && !unchecked.has(r.line)).length;

    return (
        <section aria-labelledby={`${id}-title`} className="rounded border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 p-4 sm:px-5">
                <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">Check the rows</h2>
                <p className="text-xs text-body">{`${plural(rows.length, "row", "rows")} read · line numbers as in the file`}</p>
                <SegmentedControl
                    variant="pill"
                    ariaLabel="Show rows"
                    className="ml-auto max-sm:ml-0 max-sm:max-w-full max-sm:flex-wrap"
                    value={filter}
                    onChange={onFilter}
                    options={[
                        { value: "all", label: "All", count: counts.all },
                        { value: "new", label: "New", count: counts.new },
                        { value: "removals", label: "Removals", count: counts.removals },
                        { value: "skipped", label: "Skipped", count: counts.skipped },
                        { value: "fix", label: "Need a fix", count: counts.fix },
                    ]}
                />
            </div>
            <div className="overflow-x-auto border-t border-line">
                <table className="w-full min-w-[720px] text-left text-sm">
                    <thead>
                        <tr className="text-xs text-muted">
                            <th scope="col" className="w-12 py-2.5 pr-2 pl-4 font-normal sm:pl-5">
                                <input
                                    type="checkbox"
                                    aria-label="Select every row that can be added"
                                    checked={allChecked}
                                    disabled={selectable.length === 0}
                                    onChange={() => onToggleAll(selectable.map((r) => r.line), !allChecked)}
                                    className="h-4 w-4 accent-(--accent)"
                                />
                            </th>
                            <th scope="col" className="w-14 py-2.5 pr-3 font-normal">Line</th>
                            <th scope="col" className="py-2.5 pr-3 font-normal">Who</th>
                            <th scope="col" className="py-2.5 pr-3 font-normal">Role or group</th>
                            <th scope="col" className="py-2.5 pr-4 font-normal sm:pr-5">Result of the check</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map((row) => {
                            const isError = row.result === "error";
                            const canCheck = isSelectable(row);
                            return (
                                <tr key={row.line} className={`border-t border-line align-top ${isError ? "bg-danger-tint" : ""}`}>
                                    <td className="py-3 pl-4 sm:pl-5">
                                        {canCheck ? (
                                            <input
                                                type="checkbox"
                                                aria-label={`Line ${row.line}: ${row.who}, ${row.action.toLowerCase()}`}
                                                checked={!unchecked.has(row.line)}
                                                onChange={() => onToggle(row.line)}
                                                className="h-4 w-4 accent-(--accent)"
                                            />
                                        ) : (
                                            <span className={isError ? "text-danger-text" : "text-body"}>
                                                <Icon name={isError ? "error" : "info"} size={16} label={isError ? "Needs a fix" : "Skipped"} />
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-3 pr-3 text-body tabular-nums">{row.line}</td>
                                    <td className="py-3 pr-3">
                                        <span className="block font-semibold text-ink">{row.who}</span>
                                        <span className="block text-body">{row.action}</span>
                                    </td>
                                    <td className="py-3 pr-3">
                                        <span className="block text-ink">{row.target}</span>
                                        <span className="block text-body">{[row.scope, row.end].filter(Boolean).join(" · ")}</span>
                                    </td>
                                    <td className="py-3 pr-4 text-ink sm:pr-5">
                                        <span className="block">{row.message}</span>
                                        {row.detail && <span className="block text-xs text-body">{row.detail}</span>}
                                    </td>
                                </tr>
                            );
                        })}
                        {shown.length === 0 && (
                            <tr className="border-t border-line"><td colSpan={5} className="px-5 py-6 text-center text-sm text-body">No rows in this view.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
            {!isUnfolded && shown.length > FOLD && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                    <button type="button" onClick={() => setIsUnfolded(true)} className="rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:min-h-11">{`Show all ${shown.length} rows`}</button>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line px-4 py-3 sm:px-5">
                <p className="min-w-0 flex-1 text-xs text-body">
                    {counts.fix > 0 ? `${plural(counts.fix, "row needs", "rows need")} a fix in the file and ${counts.fix === 1 ? "is" : "are"} left out. Fix ${counts.fix === 1 ? "it" : "them"} and choose the file again.` : ""}
                </p>
                <Button variant="primary" disabled={changeCount === 0 && !hasAdded} onClick={() => onReview(changeCount)}>
                    {changeCount === 0 ? (hasAdded ? "Take my earlier changes out" : "Nothing to review") : `Review ${plural(changeCount, "change", "changes")}`}
                </Button>
            </div>
        </section>
    );
}
