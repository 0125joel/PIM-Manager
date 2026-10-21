"use client";

import { useId, type ReactNode } from "react";
import { MODEL_PARTS, type GuidedFrom, type GuidedPart, type GuidedSide, type GuidedState, type GuidedWorkload } from "@/utils/guidedRoute";

export interface StartChoices {
    /** "You can change {x} of {y}" or why roles cannot be changed */
    rolesLine: string;
    groupsLine: string;
    /** Why a workload cannot be chosen; null when it can */
    workloadLock: Record<GuidedWorkload, string | null>;
    /** The targets a copy can come from (open, with settings) */
    copySources: ReadonlyArray<{ id: string; name: string }>;
}

interface StartStepProps {
    state: GuidedState;
    choices: StartChoices;
    onWorkload: (workload: GuidedWorkload) => void;
    onSide: (side: GuidedSide) => void;
    onFrom: (from: GuidedFrom) => void;
    onCopySource: (id: string) => void;
    onPart: (part: GuidedPart) => void;
}

const PART_CARDS: ReadonlyArray<{ part: GuidedPart; title: string; line: string }> = [
    { part: "activation", title: "Activation rules", line: "Duration, MFA or context, approval, extensions" },
    { part: "assignment", title: "Assignment rules", line: "Permanent or ending, MFA and justification" },
    { part: "notification", title: "Notifications", line: "Who gets which email" },
    { part: "people", title: "People", line: "Add the same people to every target" },
];

/** A choice as a card button: the title and a muted line, pressed when chosen (render `guided-start`, no icons) */
function Card({ title, line, isPressed, disabledReason, onPress }: { title: string; line: string; isPressed: boolean; disabledReason?: string | null; onPress: () => void }) {
    const isDisabled = !!disabledReason;
    return (
        <button
            type="button"
            aria-pressed={isPressed}
            aria-disabled={isDisabled || undefined}
            onClick={() => { if (!isDisabled) onPress(); }}
            className={`flex min-h-[84px] flex-col items-start rounded border px-3 py-3 text-left transition-colors duration-150 ${isPressed && !isDisabled ? "border-accent bg-accent-tint" : "border-line bg-surface"} ${isDisabled ? "cursor-not-allowed" : isPressed ? "" : "hover:bg-page"}`}
        >
            <span className={`text-[15px] leading-5 ${isDisabled ? "text-muted" : "text-ink"}`}>{title}</span>
            <span className={`mt-1 text-xs leading-5 ${isDisabled ? "text-muted" : "text-body"}`}>{disabledReason ?? line}</span>
        </button>
    );
}

function Question({ number, title, children }: { number: number; title: string; children: ReactNode }) {
    const id = useId();
    return (
        <section aria-labelledby={id} className="flex flex-col gap-2">
            <h2 id={id} className="text-[13px] text-body">{`${number}. ${title}`}</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,262px))]">{children}</div>
        </section>
    );
}

/**
 * Step 1 of Guided (spec 6.1): roles or groups, Member or Owner for groups, where the values start from, and what to
 * set. No "Microsoft defaults" (spec 1). With the access model only activation and assignment rules can be set.
 */
export function StartStep({ state, choices, onWorkload, onSide, onFrom, onCopySource, onPart }: StartStepProps) {
    const isGroups = state.workload === "groups";
    const noun = isGroups ? "group" : "role";
    const copyId = useId();
    let n = 1;
    return (
        <div className="flex flex-col gap-5 rounded border border-line bg-surface p-4">
            <Question number={n++} title="Roles or groups?">
                <Card title="Entra roles" line={choices.rolesLine} isPressed={!isGroups} disabledReason={choices.workloadLock.roles} onPress={() => onWorkload("roles")} />
                <Card title="Groups" line={choices.groupsLine} isPressed={isGroups} disabledReason={choices.workloadLock.groups} onPress={() => onWorkload("groups")} />
            </Question>
            {isGroups && (
                <Question number={n++} title="Member or Owner settings?">
                    <Card title="Member" line="Who activates to become a member" isPressed={state.side === "member"} onPress={() => onSide("member")} />
                    <Card title="Owner" line="Who activates to become an owner" isPressed={state.side === "owner"} onPress={() => onSide("owner")} />
                    <Card title="Both" line="The same values for Member and Owner" isPressed={state.side === "both"} onPress={() => onSide("both")} />
                </Question>
            )}
            <div className="flex flex-col gap-3">
                <Question number={n++} title="Start from">
                    <Card title="The current settings" line="You set only what should change" isPressed={state.from === "current"} onPress={() => onFrom("current")} />
                    <Card
                        title={`A copy of one ${noun}`}
                        line={'Its values become "Set to" in step 3'}
                        isPressed={state.from === "copy"}
                        disabledReason={choices.copySources.length === 0 ? `No ${noun} with settings to copy from` : null}
                        onPress={() => onFrom("copy")}
                    />
                    <Card title="The PIM Monitor access model" line="Recommended settings per level" isPressed={state.from === "model"} onPress={() => onFrom("model")} />
                </Question>
                {state.from === "copy" && (
                    <div className="flex max-w-[360px] flex-col gap-1">
                        <label htmlFor={copyId} className="text-[13px] font-semibold text-ink">Copy from</label>
                        <select
                            id={copyId}
                            value={state.copySourceId ?? ""}
                            onChange={(event) => onCopySource(event.target.value)}
                            className="h-[34px] rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11"
                        >
                            {state.copySourceId === null && <option value="">{`Choose a ${noun}`}</option>}
                            {choices.copySources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <span className="text-xs text-body">This one is not changed itself.</span>
                    </div>
                )}
            </div>
            <Question number={n++} title="What do you want to set?">
                {PART_CARDS.map(({ part, title, line }) => {
                    const isBlocked = state.from === "model" && !MODEL_PARTS.includes(part);
                    return (
                        <Card
                            key={part}
                            title={title}
                            line={line}
                            isPressed={state.parts.includes(part)}
                            disabledReason={isBlocked ? "The access model sets activation and assignment rules only" : null}
                            onPress={() => onPart(part)}
                        />
                    );
                })}
            </Question>
        </div>
    );
}
