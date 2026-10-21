"use client";

import { useId, type ReactNode } from "react";
import { DurationSlider } from "@/components/ui/DurationSlider";
import { Tag } from "@/components/ui/Tag";
import { useConfigureBasket } from "@/contexts/ConfigureBasketContext";
import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { SettingField, SettingValue } from "@/types/configure.types";
import type { CustomExtensionLink } from "@/types/shared.types";
import { GROUP_APPROVERS_REQUIRED, ROLE_DEFAULT_APPROVERS, type SettingCategory, type SettingRowDef, type ValueWords } from "@/utils/configureSettingRows";
import type { ActivationRequirementValue, ApproverRef } from "@/utils/policyRules";
import { groupByValue, keepSetNote, startValue, type NowColumn, type SeveralDraft, type SeveralEntry } from "@/utils/settingValues";
import { ApproverPicker } from "./ApproverPicker";
import { KeepOnOff, KeepSet } from "./KeepSetControl";
import { NowValues } from "./NowValues";
import { ExpirationSelect, ExtensionSelect, RequirementControl } from "./SettingControls";

export interface SeveralSettingsProps {
    entries: readonly SeveralEntry[];
    /** "roles" or "groups" */
    noun: string;
    tenantName: string;
    categories: readonly SettingCategory[];
    draft: SeveralDraft;
    onDraftChange: (draft: SeveralDraft) => void;
    words: ValueWords;
    contextWarning: (contextId: string) => string | null;
    searchPrincipals: PrincipalSearchFn;
    /** The line under the tab (Assignment) */
    note?: string;
    /** Guided draws one block per level: its name keeps the category regions apart */
    blockName?: string;
}

const COLUMNS = "@min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,15rem)] @min-[640px]:items-center @min-[640px]:gap-4";

/**
 * The setting rows of several targets (spec 5.6): the Now column groups the targets by value, the control is Keep | Off |
 * On or Keep | Set to, Keep by default. A row set to a value gets the changed style; nothing reaches the basket until
 * "Add {n} to changes" in the head.
 */
export function SeveralSettings(props: SeveralSettingsProps) {
    const { entries, draft, onDraftChange, categories } = props;
    const { basket } = useConfigureBasket();
    const isSet = (field: SettingField) => field in draft;
    const setField = (field: SettingField, value: SettingValue | undefined) => {
        const next = { ...draft };
        if (value === undefined) delete next[field];
        else next[field] = value;
        // Approval Off makes its approvers meaningless: their choice goes with it
        if (field === "requireApproval" && value === false) delete next.approvers;
        onDraftChange(next);
    };
    const isGroups = entries.some((e) => e.target.kind === "group");

    return (
        <div className="@container flex flex-col gap-6">
            <p className="text-[13px] leading-[18px] text-body">{keepSetNote(props.noun === "groups" ? "groups" : "roles")}</p>
            {categories.map((category) => {
                const rows = category.rows.filter((r) => r.field !== "approvers" || draft.requireApproval !== false);
                return (
                    <section key={category.title} aria-label={props.blockName ? `${category.title}, ${props.blockName}` : category.title}>
                        <div className={`border-b border-ink pb-2 text-xs ${COLUMNS}`}>
                            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                {category.title}
                                {category.isPreview && <Tag variant="accent">Preview</Tag>}
                            </h3>
                            <span className="text-muted @max-[639px]:hidden">{`Now in ${props.tenantName}, ${entries.length} ${entries.length === 1 ? props.noun.replace(/s$/, "") : props.noun}`}</span>
                            <span className="text-muted @max-[639px]:hidden">Set for all</span>
                        </div>
                        {category.note && <p className="mt-2 text-[13px] leading-[18px] text-body">{category.note}</p>}
                        {rows.map((def) => {
                            const column = groupByValue(def.field, entries, basket);
                            return (
                                <SeveralRow key={def.field} def={def} column={column} isSet={isSet(def.field)} words={props.words}
                                    extraLine={def.field === "approvers" && Array.isArray(draft.approvers) && draft.approvers.length === 0 ? (isGroups ? GROUP_APPROVERS_REQUIRED : ROLE_DEFAULT_APPROVERS) : null}>
                                    {renderControl(def, column, draft, setField, props)}
                                </SeveralRow>
                            );
                        })}
                    </section>
                );
            })}
            {props.note && <p className="text-[13px] leading-[18px] text-body">{props.note}</p>}
        </div>
    );
}

function renderControl(def: SettingRowDef, column: NowColumn, draft: SeveralDraft, setField: (field: SettingField, value: SettingValue | undefined) => void, props: SeveralSettingsProps): ReactNode {
    const start = startValue(column);
    const notRead = start === undefined ? "None of the selected targets has this setting read." : null;
    const value = draft[def.field];
    if (def.control === "onOff") {
        return <KeepOnOff label={def.label} value={typeof value === "boolean" ? value : undefined} disabledReason={notRead} onChange={(next) => setField(def.field, next)} />;
    }
    const noList = def.control === "extension" && props.words.extensions === null ? "The tenant's list of extensions cannot be read." : null;
    const keepSet = (control: ReactNode) => (
        <KeepSet label={def.label} isSet={value !== undefined} setDisabledReason={notRead ?? noList} onKeep={() => setField(def.field, undefined)} onSet={() => setField(def.field, start)}>
            {control}
        </KeepSet>
    );
    if (value === undefined) return keepSet(null);
    switch (def.control) {
        case "duration":
            return keepSet(typeof value === "string" ? <DurationSlider label="" ariaLabel={def.label} value={value} min={1} max={24} step={0.5} onChange={(iso) => setField(def.field, iso)} /> : null);
        case "requirement":
            return keepSet(<RequirementControl value={value as ActivationRequirementValue} disabled={false} contexts={props.words.contexts} warning={props.contextWarning} onChange={(next) => setField(def.field, next)} />);
        case "approvers":
            return keepSet(<ApproverPicker approvers={value as ApproverRef[]} disabled={false} keepLast={false} search={props.searchPrincipals} onChange={(list) => setField(def.field, list)} />);
        case "expiration":
            return keepSet(<ExpirationSelect label={def.label} value={typeof value === "string" ? value : undefined} now={undefined} disabled={false} onChange={(iso) => setField(def.field, iso)} />);
        case "extension":
            return keepSet(<ExtensionSelect label={def.label} value={value as CustomExtensionLink} disabled={false} extensions={props.words.extensions} onChange={(link) => setField(def.field, link)} />);
        default:
            return null;
    }
}

function SeveralRow({ def, column, isSet, words, extraLine, children }: { def: SettingRowDef; column: NowColumn; isSet: boolean; words: ValueWords; extraLine: string | null; children: ReactNode }) {
    const labelId = useId();
    return (
        <div
            role="group"
            aria-labelledby={labelId}
            className={`border-b border-line py-3 ${COLUMNS} ${def.isIndented ? "@min-[640px]:pl-5" : ""} ${isSet ? "-mx-2 bg-linear-to-l from-change-tint to-transparent px-2 shadow-[inset_-2px_0_0_var(--change)]" : ""}`}
        >
            <div className="min-w-0">
                <p id={labelId} className="text-[15px] leading-5 font-semibold text-ink">{def.label}</p>
                {def.help && <p className="mt-0.5 text-[13px] leading-[18px] text-body">{def.help}</p>}
                {extraLine && <p className="mt-0.5 text-[13px] leading-[18px] text-body">{extraLine}</p>}
            </div>
            <div className="mt-1.5 @min-[640px]:mt-0">
                <span className="text-[13px] text-body @min-[640px]:sr-only">Now: </span>
                <NowValues field={def.field} column={column} words={words} />
            </div>
            <div className="mt-2 min-w-0 @min-[640px]:mt-0">{children}</div>
        </div>
    );
}
