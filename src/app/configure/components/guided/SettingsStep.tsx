"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { ConfigureTab } from "@/types/configure.types";
import { ACTIVATION_CATEGORIES, ASSIGNMENT_CATEGORIES, ASSIGNMENT_NOTE, type ValueWords } from "@/utils/configureSettingRows";
import type { GuidedPart, SettingsBlock } from "@/utils/guidedRoute";
import type { SeveralDraft } from "@/utils/settingValues";
import { EditTabs } from "../edit/EditTabs";
import { SeveralNotificationTab } from "../edit/NotificationTab";
import { SeveralSettings } from "../edit/SeveralSettings";

interface SettingsStepProps {
    /** The ticked targets by name, for the head */
    names: readonly string[];
    /** "roles" or "groups" */
    noun: string;
    /** The settings parts chosen in Start, as tabs */
    parts: readonly GuidedPart[];
    blocks: readonly SettingsBlock[];
    draftOf: (block: SettingsBlock) => SeveralDraft;
    onDraftChange: (block: SettingsBlock, draft: SeveralDraft) => void;
    /** Changes waiting in the basket for the targets, per tab */
    counts: Record<ConfigureTab, number>;
    /** "Values from {source} are filled in": the copy source's name */
    copySourceName: string | null;
    tenantName: string;
    words: ValueWords;
    contextWarning: (contextId: string) => string | null;
    searchPrincipals: PrincipalSearchFn;
    /** A catalog label's name, and the tenant's contexts to choose one for a label without a match (spec 9.3) */
    labelName: (slug: string) => string;
    contexts: ReadonlyArray<{ id: string; displayName: string }>;
    onChooseContext: (slug: string, contextId: string | null) => void;
}

/**
 * Step 3 of Guided (spec 6.3): the several-targets rows of the parts chosen in Start, prefilled with Set to values from
 * the copy source or the catalog. With the catalog every place has its own block, so the Now column groups the targets
 * of one level and each level gets its own values.
 */
export function SettingsStep(props: SettingsStepProps) {
    const tabs = props.parts.filter((p): p is "activation" | "assignment" | "notification" => p !== "people");
    const [chosen, setChosen] = useState<ConfigureTab>(tabs[0] ?? "activation");
    const tab = tabs.includes(chosen as (typeof tabs)[number]) ? chosen : tabs[0] ?? "activation";
    const count = props.names.length;
    const one = props.noun.replace(/s$/, "");
    return (
        <article className="overflow-hidden rounded border border-line bg-surface">
            <header className="border-b border-line p-4 sm:p-5">
                <h2 className="text-xl leading-7 font-semibold text-ink">{`${count} ${count === 1 ? one : props.noun} selected`}</h2>
                <p className="mt-1 text-xs leading-[18px] text-body">{props.names.join(", ")}</p>
                {props.copySourceName && (
                    <p className="mt-3 flex items-start gap-1.5 text-[13px] leading-[18px] text-body">
                        <Icon name="copy" size={16} className="mt-px shrink-0 text-muted" />
                        <span>{`Values from ${props.copySourceName} are filled in as "Set to". Switch any of them back to "Keep".`}</span>
                    </p>
                )}
            </header>
            <EditTabs tab={tab} onTabChange={setChosen} counts={props.counts} tabs={tabs} ariaLabel="Settings of the selected targets">
                <div className="flex flex-col gap-8">
                    {props.blocks.map((block) => (
                        <Block key={block.key} block={block} tab={tab} {...props} />
                    ))}
                </div>
            </EditTabs>
        </article>
    );
}

function Block({ block, tab, noun, draftOf, onDraftChange, tenantName, words, contextWarning, searchPrincipals, labelName, contexts, onChooseContext }: SettingsStepProps & { block: SettingsBlock; tab: ConfigureTab }) {
    const headId = useId();
    const draft = draftOf(block);
    const onChange = (next: SeveralDraft) => onDraftChange(block, next);
    const body = tab === "notification" ? (
        <SeveralNotificationTab entries={block.entries} noun={noun} draft={draft} onDraftChange={onChange} />
    ) : (
        <SeveralSettings
            entries={block.entries}
            noun={noun}
            tenantName={tenantName}
            categories={tab === "activation" ? ACTIVATION_CATEGORIES : ASSIGNMENT_CATEGORIES}
            note={tab === "assignment" ? ASSIGNMENT_NOTE : undefined}
            draft={draft}
            onDraftChange={onChange}
            words={words}
            contextWarning={contextWarning}
            searchPrincipals={searchPrincipals}
            blockName={block.title ?? undefined}
        />
    );
    if (!block.title) return body;
    return (
        <section aria-labelledby={headId} className="flex flex-col gap-3">
            <div className="rounded border border-line bg-page px-3 py-2.5">
                <h3 id={headId} className="text-[15px] font-semibold text-ink">{block.title}</h3>
                <p className="mt-0.5 text-xs leading-[18px] text-body">{block.entries.map((e) => e.name).join(", ")}</p>
                {block.notes.map((note) => <p key={note} className="mt-1 text-[13px] leading-[18px] text-body">{note}</p>)}
                {tab === "activation" && block.unmatchedLabels.map((slug) => (
                    <LabelChoice key={slug} label={labelName(slug)} tenantName={tenantName} contexts={contexts} onChoose={(id) => onChooseContext(slug, id)} />
                ))}
            </div>
            {body}
        </section>
    );
}

/**
 * A catalog label without a context in the tenant (spec 9.3): the requirement stays Keep until the admin chooses the
 * context that stands for it; the choice is kept for this tenant
 */
function LabelChoice({ label, tenantName, contexts, onChoose }: { label: string; tenantName: string; contexts: ReadonlyArray<{ id: string; displayName: string }>; onChoose: (contextId: string | null) => void }) {
    const id = useId();
    return (
        <div className="mt-2 flex flex-col gap-1">
            <p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-warn-text">
                <Icon name="alert" size={16} className="mt-px shrink-0" />
                {`"${label}" is not matched to an authentication context in ${tenantName}: "On activation, require" stays Keep until you choose one.`}
            </p>
            {contexts.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={id} className="text-[13px] text-body">{`Context for "${label}"`}</label>
                    <select id={id} value="" onChange={(e) => onChoose(e.target.value || null)} className="h-[34px] rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11">
                        <option value="">Choose a context</option>
                        {contexts.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                    </select>
                </div>
            )}
        </div>
    );
}
