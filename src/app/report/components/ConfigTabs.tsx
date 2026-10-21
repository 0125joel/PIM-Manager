"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";
import { POLICY_TAB_IDS, TAB_LABELS, type PolicyTabId, type PolicyView } from "@/utils/policyView";
import { getNextIndex } from "@/utils/rovingFocus";
import { ConfigTile } from "./ConfigTile";

/** What each tab shows while the settings are not there: the label per tile, so the grid does not jump when they arrive */
const PLACEHOLDERS: Record<PolicyTabId, Array<{ label: string }>> = {
    activation: [
        { label: "Maximum activation duration" },
        { label: "On activation, require" },
        { label: "Justification and ticket" },
        { label: "Approval" },
    ],
    assignment: [
        { label: "Eligible assignments" },
        { label: "Active assignments" },
        { label: "On active assignment, require" },
    ],
    notification: [
        { label: "Eligible assignment" },
        { label: "Active assignment" },
        { label: "Activation" },
    ],
};

interface ConfigTabsProps {
    /** null: not loaded; `state` says why */
    view: PolicyView | null;
    /** notReadable: Graph answered 403 on the policy, the settings are not there for this admin (FIX-11, FIX-12) */
    state: "ready" | "loading" | "failed" | "notReadable";
    tab: PolicyTabId;
    onTabChange: (tab: PolicyTabId) => void;
}

/**
 * Activation, Assignment and Notification (spec 3.3): a tablist with arrow keys, an amber dot on a tab that needs attention and
 * a two-column grid of tiles. The chosen tab is state of the page, kept when another role or group is selected.
 */
export function ConfigTabs({ view, state, tab, onTabChange }: ConfigTabsProps) {
    const baseId = useId();
    const refs = useRef<Array<HTMLButtonElement | null>>([]);

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const next = getNextIndex(event.key, index, POLICY_TAB_IDS.length, "horizontal");
        if (next === null) return;
        event.preventDefault();
        onTabChange(POLICY_TAB_IDS[next]);
        refs.current[next]?.focus();
    };

    return (
        <div>
            <div role="tablist" aria-label="Settings" className="flex gap-1 border-b border-line">
                {POLICY_TAB_IDS.map((id, index) => {
                    const isSelected = id === tab;
                    const needsAttention = view?.tabs[id].needsAttention === true;
                    return (
                        <button
                            key={id}
                            ref={(el) => {
                                refs.current[index] = el;
                            }}
                            type="button"
                            role="tab"
                            id={`${baseId}-tab-${id}`}
                            aria-selected={isSelected}
                            aria-controls={isSelected ? `${baseId}-panel-${id}` : undefined}
                            tabIndex={isSelected ? 0 : -1}
                            onClick={() => onTabChange(id)}
                            onKeyDown={(event) => handleKeyDown(event, index)}
                            className={`-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13px] leading-[18px] max-sm:min-h-11 ${isSelected ? "border-accent font-semibold text-ink" : "border-transparent font-medium text-body hover:text-ink"}`}
                        >
                            {TAB_LABELS[id]}
                            {needsAttention && (
                                <>
                                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warn-fill" />
                                    <span className="sr-only">needs attention</span>
                                </>
                            )}
                        </button>
                    );
                })}
            </div>
            <div role="tabpanel" tabIndex={0} id={`${baseId}-panel-${tab}`} aria-labelledby={`${baseId}-tab-${tab}`} className="mt-3 grid gap-2 sm:grid-cols-2">
                {view && view.tabs[tab].tiles.map((tile) => <ConfigTile key={tile.id} tile={tile} />)}
                {!view && state === "notReadable" && <p className="text-[13px] leading-5 text-body sm:col-span-2">{POLICY_NOT_READABLE}</p>}
                {!view && state !== "notReadable" && PLACEHOLDERS[tab].map((placeholder) => <ConfigTile key={placeholder.label} tile={null} placeholder={placeholder} state={state === "failed" ? "failed" : "loading"} />)}
            </div>
        </div>
    );
}
