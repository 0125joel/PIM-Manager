"use client";

import { useEffect, useId, useRef, useState } from "react";
import { type IconName } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Tag } from "@/components/ui/Tag";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { BasketAdd, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId } from "@/utils/configureBasket";
import {
    allowsOnlyNoEnd,
    countWhoRows,
    describeEnd,
    endChange,
    filterWhoRows,
    formatDay,
    latestEnd,
    maxEndFrom,
    pendingAdds,
    policyLimits,
    removeChange,
    scopeIcon,
    capEnd,
    toDay,
    type WhoFilter,
    type WhoRow,
} from "@/utils/assignmentForm";

interface WhoHasItProps {
    rows: readonly WhoRow[];
    /** The settings per side as read, for the limits of a new end (roles: both keys the role's policy) */
    settingsOf: (row: WhoRow) => PolicySettings | null;
    /** A group not under PIM: nobody is assigned through PIM yet */
    isOutsidePim: boolean;
    /** Opens the group a row comes from */
    onOpenGroup: (groupId: string) => void;
    now: Date;
    /** The targets shown (a group: both sides), so adds show even while nobody has it yet (U-04) */
    targets?: readonly Target[];
}

const KIND_ICON: Record<WhoRow["kind"], IconName> = { user: "user", guest: "guest", group: "group", app: "app-identity" };

/**
 * Who has it (spec 5.7): All, Eligible, Active; a row per assignment with its tags and its actions: Remove or Change
 * end (no Expired and no Renew: Microsoft lists no ended assignments, tenant run 2026-10-09). A row through a group or
 * an activation has no action and says why; the last
 * owner's Remove is disabled with the reason. Changes wait in the basket and show on their row, with Undo.
 */
export function WhoHasIt({ rows, settingsOf, isOutsidePim, onOpenGroup, now, targets: shownTargets = [] }: WhoHasItProps) {
    const { basket } = useConfigureBasket();
    const { add, leaveOut } = useConfigureBasketActions();
    const [filter, setFilter] = useState<WhoFilter>("all");
    const [editing, setEditing] = useState<string | null>(null);
    // The row whose action takes the focus after its button went away (Remove becomes Keep, the editor closes)
    const [focusRow, setFocusRow] = useState<string | null>(null);
    const counts = countWhoRows(rows);
    const shown = filterWhoRows(rows, filter);
    const targets = [...new Map([...shownTargets, ...rows.map((r) => r.target)].map((t) => [JSON.stringify(t), t])).values()];
    const adds = pendingAdds(basket.changes, targets);

    return (
        <div className="flex flex-col gap-3">
            <SegmentedControl<WhoFilter>
                ariaLabel="Show"
                variant="pill"
                value={filter}
                onChange={setFilter}
                className="w-fit max-w-full flex-wrap"
                options={[
                    { value: "all", label: "All", count: counts.all },
                    { value: "eligible", label: "Eligible", count: counts.eligible },
                    { value: "active", label: "Active", count: counts.active },
                ]}
            />
            {shown.length === 0 ? (
                <p className="rounded border border-line bg-page px-4 py-4 text-sm text-body">
                    {filter === "all" ? `Nobody has it yet.${isOutsidePim ? " The first assignment brings this group under PIM." : ""}` : "Nobody with this filter."}
                </p>
            ) : (
                <ul className="flex flex-col" aria-label="Who has it">
                    {shown.map((row) => (
                        <WhoRowItem
                            key={row.key}
                            row={row}
                            isEditing={editing === row.key}
                            onEdit={() => setEditing(row.key)}
                            onCloseEdit={() => { setEditing(null); setFocusRow(row.key); }}
                            settings={settingsOf(row)}
                            onRemove={() => { add(removeChange(row)); setFocusRow(row.key); }}
                            onEnd={(end, justification) => { add(endChange(row, end, justification)); setEditing(null); setFocusRow(row.key); }}
                            onUndo={() => { if (row.pending) leaveOut([changeId(row.pending)]); setFocusRow(row.key); }}
                            takeFocus={focusRow === row.key}
                            onFocused={() => setFocusRow(null)}
                            onOpenGroup={onOpenGroup}
                            now={now}
                        />
                    ))}
                </ul>
            )}
            {adds.length > 0 && <AddedList adds={adds} onDrop={(a) => leaveOut([changeId(a)])} />}
        </div>
    );
}

function WhoRowItem({ row, isEditing, onEdit, onCloseEdit, settings, onRemove, onEnd, onUndo, onOpenGroup, now, takeFocus, onFocused }: {
    takeFocus: boolean;
    onFocused: () => void;
    row: WhoRow;
    isEditing: boolean;
    onEdit: () => void;
    onCloseEdit: () => void;
    settings: PolicySettings | null;
    onRemove: () => void;
    onEnd: (end: string | null, justification: string) => void;
    onUndo: () => void;
    onOpenGroup: (groupId: string) => void;
    now: Date;
}) {
    const reasonId = useId();
    const actionsRef = useRef<HTMLDivElement>(null);
    // The first action of the row takes the focus once the button pressed is gone
    useEffect(() => {
        if (!takeFocus) return;
        actionsRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
        onFocused();
    }, [takeFocus, onFocused]);
    const isRemoved = row.pending?.kind === "remove";
    const newEnd = row.pending?.kind === "update" ? row.pending.end : undefined;
    const tagFor = row.status === "expired" ? "danger" : row.schedule.end && new Date(row.schedule.end).getTime() - now.getTime() < 14 * 864e5 ? "warn" : "default";
    return (
        <li className={`flex flex-col gap-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between ${isRemoved ? "opacity-70" : ""}`}>
            <div className="min-w-0">
                <p className={`text-[15px] leading-5 font-semibold text-ink ${isRemoved ? "line-through" : ""}`}>{row.principal.displayName}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Tag variant="default" icon={row.type === "eligible" ? "eligible" : "active"}>{`${row.type === "eligible" ? "Eligible" : "Active"}${row.isActivated ? " · activated" : ""}`}</Tag>
                    {row.access && <Tag variant="default" icon={row.access === "owner" ? "owner" : "group"}>{row.access === "owner" ? "Owner" : "Member"}</Tag>}
                    {row.kind !== "user" && <Tag variant="default" icon={KIND_ICON[row.kind]}>{row.kind === "group" ? "Group" : row.kind === "guest" ? "Guest" : "App"}</Tag>}
                    {row.isEmergency && <Tag variant="default" icon="emergency-access">Emergency access</Tag>}
                    {row.viaGroup && <Tag variant="default" icon="via-group">{`Through ${row.viaGroup.name ?? "a group"}`}</Tag>}
                    <Tag variant={tagFor} icon={row.status === "expired" ? "clock" : row.schedule.end ? "calendar" : "no-end-date"}>{describeEnd(row)}</Tag>
                    {row.scopeLabel && <Tag variant="default" icon={scopeIcon(row.schedule.scope)}>{row.scopeLabel}</Tag>}
                    {row.isScheduled && <Tag variant="warn" icon="clock">Scheduled</Tag>}
                    {isRemoved && <Tag variant="danger" icon="delete">Removed when you apply</Tag>}
                    {newEnd !== undefined && <Tag variant="accent" icon="calendar">{`New end: ${formatDay(newEnd)}`}</Tag>}
                </div>
                {row.note && (
                    <p className="mt-1 text-[13px] leading-[18px] text-body">
                        {row.note}
                        {row.viaGroup?.id && (
                            <button type="button" onClick={() => onOpenGroup(row.viaGroup!.id!)} className="ml-1 text-accent underline underline-offset-2 max-sm:min-h-11">{`Open ${row.viaGroup.name ?? "the group"}`}</button>
                        )}
                    </p>
                )}
                {isEditing && <EndEditor row={row} settings={settings} now={now} onDone={onEnd} onCancel={onCloseEdit} />}
            </div>
            {!row.note && !isEditing && (
                <div ref={actionsRef} className="flex shrink-0 flex-wrap items-center gap-2">
                    {row.pending ? (
                        <Button variant="secondary" size="sm" onClick={onUndo}>{isRemoved ? "Keep" : "Undo"}</Button>
                    ) : (
                        <>
                            {row.canChangeEnd && <Button variant="secondary" size="sm" onClick={onEdit}>Change end</Button>}
                            {(row.canRemove || row.removeBlockedReason) && (
                                <Button variant="secondary" size="sm" onClick={onRemove} disabled={!row.canRemove} aria-describedby={row.removeBlockedReason ? reasonId : undefined}>Remove</Button>
                            )}
                        </>
                    )}
                    {row.removeBlockedReason && !row.pending && <p id={reasonId} className="w-full text-xs leading-4 text-body sm:max-w-56">{row.removeBlockedReason}</p>}
                </div>
            )}
        </li>
    );
}

/**
 * The new end of Change end: the policy maximum from today, a date up to it, or no end when the policy allows.
 * A policy that requires a justification for active assignments requires it on every request for one, a change of end
 * included (tenant run 2026-10-09: adminUpdate without one failed with "JustificationRule - Justification is required").
 */
function EndEditor({ row, settings, now, onDone, onCancel }: { row: WhoRow; settings: PolicySettings | null; now: Date; onDone: (end: string | null, justification: string) => void; onCancel: () => void }) {
    const id = useId();
    const limits = policyLimits(settings, row.type);
    const latest = latestEnd(limits, now);
    const max = maxEndFrom(limits, now);
    const onlyNoEnd = allowsOnlyNoEnd(limits);
    const [choice, setChoice] = useState<"max" | "date" | "none">(onlyNoEnd ? "none" : max ? "max" : "date");
    const [date, setDate] = useState(toDay(max ?? new Date(now.getTime() + 30 * 864e5)));
    const [justification, setJustification] = useState("");
    // By calendar day: the day of the maximum is allowed and ends at the maximum; an empty or past day is not
    const tooLate = latest !== null && date > toDay(latest);
    // Today is allowed (it ends tonight), as in Add people
    const tooEarly = date !== "" && date < toDay(now);
    const dayProblem = date === "" ? "Choose a date." : tooLate ? "Later than the policy maximum." : tooEarly ? "The end cannot be in the past." : null;
    const needsJustification = limits.justificationRequired;
    const justificationProblem = needsJustification && !justification.trim() ? "The policy requires a justification for active assignments." : null;
    const isValid = (choice !== "date" || dayProblem === null) && justificationProblem === null;
    const done = () => {
        if (!isValid) return;
        onDone(choice === "none" ? null : choice === "max" && max ? max.toISOString() : capEnd(date, limits, now), justification.trim());
    };
    return (
        <fieldset className="mt-2 flex flex-col gap-2 rounded border border-line bg-page p-3">
            <legend className="sr-only">{`Change the end of ${row.principal.displayName}`}</legend>
            <label htmlFor={`${id}-end`} className="text-[13px] font-semibold text-ink">New end</label>
            {/* Opened on purpose: the choice takes the focus */}
            <select id={`${id}-end`} autoFocus value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)} className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11">
                {max && <option value="max">{`Policy maximum (${formatDay(max.toISOString())})`}</option>}
                <option value="date" disabled={onlyNoEnd}>{onlyNoEnd ? "On a date (not allowed by the policy)" : "On a date"}</option>
                <option value="none" disabled={limits.permanentAllowed === false}>{limits.permanentAllowed === false ? "No end date (not allowed by the policy)" : "No end date"}</option>
            </select>
            {choice === "date" && (
                <input type="date" aria-label="End date" aria-describedby={dayProblem ? `${id}-problem` : undefined} aria-invalid={dayProblem ? true : undefined} min={toDay(now)} max={latest ? toDay(latest) : undefined} value={date} onChange={(e) => setDate(e.target.value)} className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11" />
            )}
            {choice === "date" && dayProblem && <p id={`${id}-problem`} className="text-xs text-danger-text">{dayProblem}</p>}
            {needsJustification && (
                <>
                    <label htmlFor={`${id}-why`} className="text-[13px] font-semibold text-ink">Justification (required by the policy)</label>
                    <input id={`${id}-why`} type="text" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Why the end changes, for the audit log" aria-invalid={justificationProblem ? true : undefined} aria-describedby={justificationProblem ? `${id}-why-problem` : undefined} className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11" />
                    {justificationProblem && <p id={`${id}-why-problem`} className="text-xs text-danger-text">{justificationProblem}</p>}
                </>
            )}
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={done} disabled={!isValid}>Change end</Button>
                <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            </div>
        </fieldset>
    );
}

/** The adds waiting in the basket for these targets, with "Remove from changes" (several targets: under the form) */
export function PendingAdds({ targets, nameOf }: { targets: readonly Target[]; nameOf: (target: Target) => string }) {
    const { basket } = useConfigureBasket();
    const { leaveOut } = useConfigureBasketActions();
    const adds = pendingAdds(basket.changes, targets);
    return adds.length > 0 ? <AddedList adds={adds} nameOf={nameOf} onDrop={(a) => leaveOut([changeId(a)])} /> : null;
}

function AddedList({ adds, onDrop, nameOf }: { adds: readonly BasketAdd[]; onDrop: (add: BasketAdd) => void; nameOf?: (target: Target) => string }) {
    return (
        <section aria-label="Added to changes" className="flex flex-col">
            <h3 className="text-[13px] font-semibold text-ink">Added to changes</h3>
            <ul>
                {adds.map((a) => (
                    <li key={changeId(a)} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-[15px] leading-5 font-semibold text-ink">
                                {a.principal.displayName}
                                {nameOf && <span className="font-normal text-body">{` · ${nameOf(a.target)}`}</span>}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                <Tag variant="accent" icon="add">New</Tag>
                                <Tag variant="default">{a.type === "eligible" ? "Eligible" : "Active"}</Tag>
                                {a.target.kind === "group" && <Tag variant="default">{a.target.access === "owner" ? "Owner" : "Member"}</Tag>}
                                <Tag variant="default">{a.end ? `Ends ${formatDay(a.end)}` : "No end date"}</Tag>
                                {a.start && <Tag variant="warn" icon="clock">{`Starts ${formatDay(a.start)}`}</Tag>}
                            </div>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => onDrop(a)}>Remove from changes</Button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
