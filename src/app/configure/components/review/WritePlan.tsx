import type { ReactNode, Ref } from "react";
import { Icon } from "@/components/icons/Icon";
import { Tag } from "@/components/ui/Tag";
import type { AssignmentRow, ReviewView, SettingGroupRow } from "@/utils/configureReview";

interface WritePlanProps {
    steps: ReviewView["steps"];
    onLeaveOut: (changeIds: string[]) => void;
    /** Takes the focus after a Leave out */
    headingRef?: Ref<HTMLHeadingElement>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Leave out": removes the change from the basket; the name of the change makes the button clear to a screen reader */
function LeaveOut({ changeIds, name, onLeaveOut }: { changeIds: string[]; name: string; onLeaveOut: (ids: string[]) => void }) {
    return (
        <button type="button" onClick={() => onLeaveOut(changeIds)} className="shrink-0 rounded text-xs text-accent underline underline-offset-2 hover:no-underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">
            Leave out<span className="sr-only">: {name}</span>
        </button>
    );
}

/** The old value struck through, the arrow, the new value */
function FromTo({ from, to }: { from: string; to: string }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <s className="text-body">{from}</s>
            <Icon name="arrow-right" size={16} className="shrink-0 text-ink" label="becomes" />
            <span className="font-semibold text-ink">{to}</span>
        </span>
    );
}

function StepBox({ number, title, count, children }: { number: number; title: string; count: string; children: ReactNode }) {
    const id = `review-step-${number}`;
    return (
        <section aria-labelledby={id} className="rounded border border-line bg-surface">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
                <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-surface">{number}</span>
                <h3 id={id} className="text-sm font-semibold text-ink"><span className="sr-only">Step {number}: </span>{title}</h3>
                <span className="ml-auto text-xs text-body">{count}</span>
            </div>
            <ul>{children}</ul>
        </section>
    );
}

function SettingRow({ row, onLeaveOut }: { row: SettingGroupRow; onLeaveOut: (ids: string[]) => void }) {
    return (
        <li className="border-t border-line first:border-t-0">
            <details className="group" open>
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <Icon name="chevron-down" size={16} className="mt-2 shrink-0 text-ink -rotate-90 transition-transform group-open:rotate-0" />
                    <span className="min-w-0 flex-1 text-sm">
                        <span className="block text-ink">{row.label}</span>
                        <FromTo from={row.from} to={row.to} />
                    </span>
                    <span className="mt-2 shrink-0 text-xs text-body">{plural(row.targets.length, "target", "targets")}</span>
                </summary>
                <ul className="pb-2">
                    {row.targets.map((t) => (
                        <li key={t.changeId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 pr-4 pl-[52px] text-[13px]">
                            <span className="min-w-0 flex-1 text-ink">{t.name}</span>
                            <span className="flex items-center gap-3 max-sm:w-full max-sm:flex-wrap"><FromTo from={row.from} to={row.to} /><LeaveOut changeIds={[t.changeId]} name={`${row.label} for ${t.name}`} onLeaveOut={onLeaveOut} /></span>
                        </li>
                    ))}
                </ul>
            </details>
        </li>
    );
}

function PersonTarget({ row }: { row: AssignmentRow }) {
    return <><span className="font-semibold text-ink">{row.principal}</span><span className="text-ink"> · {row.target}</span>{row.line && <span className="text-xs text-body"> · {row.line}</span>}</>;
}

/**
 * "What will be written" (spec 12.2): numbered boxes, only those with content, in the order the engine writes them:
 * settings grouped by setting and value pair (open to the targets), new assignments, changes of end,
 * removals. Every change can be left out.
 */
export function WritePlan({ steps, onLeaveOut, headingRef }: WritePlanProps) {
    const boxes: ReactNode[] = [];
    let n = 0;
    if (steps.settings.length > 0) {
        n++;
        boxes.push(
            <StepBox key="settings" number={n} title="Settings" count={`${plural(steps.settingsCount, "change", "changes")}, grouped by setting`}>
                {steps.settings.map((row) => <SettingRow key={row.key} row={row} onLeaveOut={onLeaveOut} />)}
            </StepBox>,
        );
    }
    if (steps.adds.length > 0) {
        n++;
        boxes.push(
            <StepBox key="adds" number={n} title="New assignments" count={plural(steps.adds.length, "assignment", "assignments")}>
                {steps.adds.map((row) => (
                    <li key={row.changeId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-sm first:border-t-0">
                        <span className="min-w-0 flex-1"><PersonTarget row={row} /></span>
                        <span className="text-xs text-body">{row.type} · {row.scope} · {row.start} · {row.end}</span>
                        <LeaveOut changeIds={[row.changeId]} name={`add ${row.principal} to ${row.target}`} onLeaveOut={onLeaveOut} />
                    </li>
                ))}
            </StepBox>,
        );
    }
    if (steps.updates.length > 0) {
        n++;
        boxes.push(
            <StepBox key="updates" number={n} title="Changes of end" count={plural(steps.updates.length, "assignment", "assignments")}>
                {steps.updates.map((row) => (
                    <li key={row.changeId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-sm first:border-t-0">
                        <span className="min-w-0 flex-1"><PersonTarget row={row} /></span>
                        <span className="text-[13px]"><FromTo from={row.oldEnd ?? "No end date"} to={row.newEnd ?? "No end date"} /></span>
                        <LeaveOut changeIds={[row.changeId]} name={`new end for ${row.principal} on ${row.target}`} onLeaveOut={onLeaveOut} />
                    </li>
                ))}
            </StepBox>,
        );
    }
    if (steps.removals.length > 0) {
        n++;
        boxes.push(
            <StepBox key="removals" number={n} title="Removals" count={plural(steps.removals.length, "assignment", "assignments")}>
                {steps.removals.map((row) => (
                    <li key={row.changeId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-sm first:border-t-0">
                        <span className="min-w-0 flex-1"><PersonTarget row={row} /></span>
                        <Tag variant="danger" icon="delete">{row.tag}</Tag>
                        <LeaveOut changeIds={[row.changeId]} name={`${row.tag} for ${row.principal} on ${row.target}`} onLeaveOut={onLeaveOut} />
                    </li>
                ))}
            </StepBox>,
        );
    }
    return (
        <section aria-labelledby="review-plan" className="mt-8">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="review-plan" ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-accent">What will be written</h2>
                <p className="text-xs text-body">Step by step. Each step starts when the one before it is done.</p>
            </div>
            <div className="flex flex-col gap-4">{boxes}</div>
        </section>
    );
}
