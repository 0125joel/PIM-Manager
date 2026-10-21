"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { StatusBox } from "@/components/ui/StatusBox";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { SettingField, SettingValue, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId } from "@/utils/configureBasket";
import {
    APPROVER_ACTIVATION_NOTE,
    NOTIFICATION_CARDS,
    RECIPIENTS_PLACEHOLDER,
    buildNotificationCells,
    canEditRecipients,
    describeCellValue,
    formatRecipients,
    parseRecipients,
    type NotificationCell,
} from "@/utils/configureNotificationRows";
import { isChanged, settingChange } from "@/utils/configureSettingRows";
import { notificationField, type NotificationProperty } from "@/utils/policyRules";
import { MISSING_WORDS, keepSetNote, groupByValue, startValue, type SeveralDraft, type SeveralEntry } from "@/utils/settingValues";
import { KeepOnOff, KeepSet } from "./KeepSetControl";
import { OnOff } from "./OnOff";

const COLUMNS = "@min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.3fr)_minmax(0,0.8fr)] @min-[640px]:items-start @min-[640px]:gap-4";
const INPUT = "h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink placeholder:text-muted disabled:opacity-50 max-sm:h-11";
const COLUMN_LABEL: Record<NotificationProperty, string> = { isEnabled: "Default recipients", additionalRecipients: "Additional recipients", criticalOnly: "Critical emails only" };

/** A card of the tab: the `mail` icon, the title, the column header from 640 px of panel width, then the rows */
function Card({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section aria-label={title} className="overflow-hidden rounded border border-line bg-surface">
            <h3 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[13px] font-semibold text-ink">
                <Icon name="mail" size={16} />
                {title}
            </h3>
            <div className={`border-b border-line px-4 py-2 text-xs text-muted @max-[639px]:hidden ${COLUMNS}`}>
                <span>Email</span>
                <span>{COLUMN_LABEL.isEnabled}</span>
                <span>{COLUMN_LABEL.additionalRecipients}</span>
                <span>{COLUMN_LABEL.criticalOnly}</span>
            </div>
            {children}
        </section>
    );
}

/** One cell: its visible label below 640 px, the control, and what it says under it */
function Cell({ property, children }: { property: NotificationProperty; children: ReactNode }) {
    return (
        <div className="mt-2 min-w-0 @min-[640px]:mt-0">
            <span className="mb-1 block text-xs text-body @min-[640px]:hidden">{COLUMN_LABEL[property]}</span>
            {children}
        </div>
    );
}

function EmailName({ email, recipientLabel }: { email: string; recipientLabel: string }) {
    return (
        <div className="min-w-0">
            <p className="text-[13px] leading-[18px] font-semibold text-ink">{email}</p>
            <p className="text-xs text-body">{recipientLabel}</p>
        </div>
    );
}

export interface NotificationTabProps {
    target: Target;
    tenantName: string;
    settings: PolicySettings | null;
    isLoading: boolean;
    failed?: { onRetry: () => void } | null;
}

/**
 * The Notification tab of one target (spec 5.10): three cards, per email Default recipients (Off | On), Additional
 * recipients (`;` separated, written when the field is left) and Critical emails only. A changed cell shows the value
 * read struck through with Undo; the activation approvers' recipients cannot be set.
 */
export function NotificationTab({ target, settings, isLoading, failed }: NotificationTabProps) {
    const { basket } = useConfigureBasket();
    const { add, leaveOut } = useConfigureBasketActions();
    const isBlank = isLoading || settings === null;

    if (failed) {
        return (
            <StatusBox
                variant="error"
                title="Could not read this policy"
                action={<button type="button" onClick={failed.onRetry} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">Try again</button>}
            >
                The settings cannot be shown or changed until the policy is read.
            </StatusBox>
        );
    }

    const cards = buildNotificationCells(settings, basket, target);
    const set = (cell: NotificationCell, to: SettingValue) => {
        const change = settingChange(target, cell.field, cell.now, to);
        if (change) add(change);
    };
    const changedOf = (cell: NotificationCell) => isChanged(cell.field, cell.now, cell.value) && cell.change !== undefined;

    return (
        <div className="@container flex flex-col gap-4">
            {cards.map((card) => (
                <Card key={card.section} title={card.title}>
                    {card.rows.map((row) => {
                        const isRowChanged = Object.values(row.cells).some(changedOf);
                        const undo = (cell: NotificationCell) => (cell.change ? () => leaveOut([changeId(cell.change!)]) : undefined);
                        return (
                            <div key={row.recipient} role="group" aria-label={row.email} className={`border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS} ${isRowChanged ? "bg-linear-to-l from-change-tint to-transparent shadow-[inset_-2px_0_0_var(--change)]" : ""}`}>
                                <EmailName email={row.email} recipientLabel={row.recipientLabel} />
                                <Cell property="isEnabled">
                                    {isBlank ? <span className="text-[13px] text-body">Loading</span> : (
                                        <OnOff label={`${card.title}: ${row.email}, default recipients`} on={row.cells.isEnabled.value === undefined ? undefined : row.cells.isEnabled.value === true} disabled={row.cells.isEnabled.now === undefined} onChange={(next) => set(row.cells.isEnabled, next)} />
                                    )}
                                    <Was cell={row.cells.isEnabled} property="isEnabled" changed={changedOf(row.cells.isEnabled)} onUndo={undo(row.cells.isEnabled)} />
                                </Cell>
                                <Cell property="additionalRecipients">
                                    {!canEditRecipients(row.section, row.recipient) ? (
                                        <p className="text-xs leading-4 text-body">{APPROVER_ACTIVATION_NOTE}</p>
                                    ) : isBlank ? (
                                        <span className="text-[13px] text-body">Loading</span>
                                    ) : (
                                        <RecipientsInput
                                            label={`${card.title}: ${row.email}, additional recipients`}
                                            value={(row.cells.additionalRecipients.value as string[] | undefined) ?? []}
                                            disabled={isBlank || row.cells.additionalRecipients.now === undefined}
                                            onChange={(list) => set(row.cells.additionalRecipients, list)}
                                        />
                                    )}
                                    <Was cell={row.cells.additionalRecipients} property="additionalRecipients" changed={changedOf(row.cells.additionalRecipients)} onUndo={undo(row.cells.additionalRecipients)} />
                                </Cell>
                                <Cell property="criticalOnly">
                                    {isBlank ? <span className="text-[13px] text-body">Loading</span> : (
                                        <OnOff label={`${card.title}: ${row.email}, critical emails only`} on={row.cells.criticalOnly.value === undefined ? undefined : row.cells.criticalOnly.value === true} disabled={row.cells.criticalOnly.now === undefined} onChange={(next) => set(row.cells.criticalOnly, next)} />
                                    )}
                                    <Was cell={row.cells.criticalOnly} property="criticalOnly" changed={changedOf(row.cells.criticalOnly)} onUndo={undo(row.cells.criticalOnly)} />
                                </Cell>
                            </div>
                        );
                    })}
                </Card>
            ))}
        </div>
    );
}

/** Under a changed cell: the value read struck through and Undo */
function Was({ cell, property, changed, onUndo }: { cell: NotificationCell; property: NotificationProperty; changed: boolean; onUndo?: () => void }) {
    if (!changed) return null;
    return (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-body">
            <span><span className="sr-only">Now: </span><s>{describeCellValue(property, cell.now)}</s></span>
            {onUndo && (
                <button type="button" onClick={onUndo} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline max-sm:min-h-11">
                    <Icon name="undo" size={16} />
                    Undo
                </button>
            )}
        </p>
    );
}

/** `;` separated addresses, written when the field is left (as the custom attributes) */
function RecipientsInput({ label, value, disabled, onChange }: { label: string; value: readonly string[]; disabled: boolean; onChange: (list: string[]) => void }) {
    const shown = formatRecipients(value);
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <input
            type="text"
            aria-label={label}
            disabled={disabled}
            value={draft ?? shown}
            placeholder={RECIPIENTS_PLACEHOLDER}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                if (draft !== null && draft !== shown) onChange(parseRecipients(draft));
                setDraft(null);
            }}
            className={INPUT}
        />
    );
}

export interface SeveralNotificationTabProps {
    entries: readonly SeveralEntry[];
    noun: string;
    draft: SeveralDraft;
    onDraftChange: (draft: SeveralDraft) => void;
}

/**
 * The Notification tab of several targets (spec 5.10): the same cards with Keep | Off | On per switch cell and Keep | Set
 * to for the recipients, the value now under each ("On", or "2 values"); nothing is written until "Add {n} to changes".
 */
export function SeveralNotificationTab({ entries, noun, draft, onDraftChange }: SeveralNotificationTabProps) {
    const { basket } = useConfigureBasket();
    const setField = (field: SettingField, value: SettingValue | undefined) => {
        const next = { ...draft };
        if (value === undefined) delete next[field];
        else next[field] = value;
        onDraftChange(next);
    };
    // The value now under a cell: one value on all, or how many values, with the targets that have no value named by reason
    const nowLine = (field: SettingField, property: NotificationProperty): ReactNode => {
        const column = groupByValue(field, entries, basket);
        const valued = column.groups.filter((g) => g.value !== undefined);
        const missing = column.groups.filter((g) => g.missing).map((g) => `${MISSING_WORDS[g.missing!]}: ${g.names.join(", ")}`);
        const main = valued.length === 0 ? "" : valued.length === 1 ? `${describeCellValue(property, valued[0].value)}${missing.length === 0 ? " on all of them" : ""}` : `${valued.length} different values`;
        return (
            <>
                <span className="sr-only">Now: </span>
                {[main, ...missing].filter(Boolean).join(". ")}
                {column.waiting > 0 && <span className="block text-muted">{`${column.waiting} with a change waiting`}</span>}
            </>
        );
    };

    return (
        <div className="@container flex flex-col gap-4">
            <p className="text-[13px] leading-[18px] text-body">{keepSetNote(noun === "groups" ? "groups" : "roles")}</p>
            {NOTIFICATION_CARDS.map((card) => (
                <Card key={card.section} title={card.title}>
                    {card.rows.map((row) => {
                        const f = (p: NotificationProperty) => notificationField(card.section, row.recipient, p);
                        const isRowSet = (["isEnabled", "additionalRecipients", "criticalOnly"] as const).some((p) => f(p) in draft);
                        const switchCell = (property: "isEnabled" | "criticalOnly") => {
                            const field = f(property);
                            const column = groupByValue(field, entries, basket);
                            const value = draft[field];
                            return (
                                <Cell property={property}>
                                    <KeepOnOff
                                        label={`${card.title}: ${row.email}, ${COLUMN_LABEL[property].toLowerCase()}`}
                                        value={typeof value === "boolean" ? value : undefined}
                                        disabledReason={startValue(column) === undefined ? "None of the selected targets has this setting read." : null}
                                        onChange={(next) => setField(field, next)}
                                    />
                                    <p className="mt-1 text-xs text-body">{nowLine(field, property)}</p>
                                </Cell>
                            );
                        };
                        const recipientsField = f("additionalRecipients");
                        const recipientsValue = draft[recipientsField];
                        return (
                            <div key={row.recipient} role="group" aria-label={row.email} className={`border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS} ${isRowSet ? "bg-linear-to-l from-change-tint to-transparent shadow-[inset_-2px_0_0_var(--change)]" : ""}`}>
                                <EmailName email={row.email} recipientLabel={row.recipientLabel} />
                                {switchCell("isEnabled")}
                                <Cell property="additionalRecipients">
                                    {!canEditRecipients(card.section, row.recipient) ? (
                                        <p className="text-xs leading-4 text-body">{APPROVER_ACTIVATION_NOTE}</p>
                                    ) : (
                                        <>
                                            <KeepSet
                                                label={`${card.title}: ${row.email}, additional recipients`}
                                                isSet={recipientsValue !== undefined}
                                                setDisabledReason={startValue(groupByValue(recipientsField, entries, basket)) === undefined ? "None of the selected targets has this setting read." : null}
                                                onKeep={() => setField(recipientsField, undefined)}
                                                onSet={() => setField(recipientsField, startValue(groupByValue(recipientsField, entries, basket)))}
                                            >
                                                <RecipientsInput label={`${card.title}: ${row.email}, additional recipients for all`} value={(recipientsValue as string[] | undefined) ?? []} disabled={false} onChange={(list) => setField(recipientsField, list)} />
                                            </KeepSet>
                                            <p className="mt-1 text-xs text-body">{nowLine(recipientsField, "additionalRecipients")}</p>
                                        </>
                                    )}
                                </Cell>
                                {switchCell("criticalOnly")}
                            </div>
                        );
                    })}
                </Card>
            ))}
        </div>
    );
}
