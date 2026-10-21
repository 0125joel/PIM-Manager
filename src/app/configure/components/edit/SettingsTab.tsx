"use client";

import { useId, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { DurationSlider } from "@/components/ui/DurationSlider";
import { Tag } from "@/components/ui/Tag";
import { useConfigureBasket, useConfigureBasketActions } from "@/contexts/ConfigureBasketContext";
import type { PrincipalSearchFn } from "@/hooks/useUserSearch";
import type { SettingField, SettingValue, Target } from "@/types/configure.types";
import type { CustomExtensionLink } from "@/types/shared.types";
import type { PolicySettings } from "@/types/wizard.types";
import { changeId } from "@/utils/configureBasket";
import { StatusBox } from "@/components/ui/StatusBox";
import {
    GROUP_APPROVERS_REQUIRED,
    NOT_IN_POLICY,
    planApprovalEdit,
    type ApprovalAction,
    ROLE_DEFAULT_APPROVERS,
    buildSettingRows,
    describeSettingValue,
    isChanged,
    settingChange,
    type SettingCategory,
    type SettingRowState,
    type ValueWords,
} from "@/utils/configureSettingRows";
import type { ActivationRequirementValue, ApproverRef } from "@/utils/policyRules";
import { ApproverPicker } from "./ApproverPicker";
import { OnOff } from "./OnOff";
import { ExpirationSelect, ExtensionSelect, RequirementControl } from "./SettingControls";

export interface SettingsTabProps {
    target: Target;
    tenantName: string;
    categories: readonly SettingCategory[];
    /** Read from the tenant; null while the policy is not read */
    settings: PolicySettings | null;
    /** The policy is still arriving: "Loading" and disabled controls, never a default */
    isLoading: boolean;
    words: ValueWords;
    /** The Conditional Access warning of a context (spec 12.5); null when fine or not readable */
    contextWarning: (contextId: string) => string | null;
    searchPrincipals: PrincipalSearchFn;
    /** The line under the tab (Assignment) */
    note?: string;
    /** The rules as read: tells an unlinked extension slot from a slot the policy lacks */
    rules?: readonly unknown[] | null;
    /** The policy could not be read: an error with Try again instead of the rows */
    failed?: { onRetry: () => void } | null;
    /** The tenant's extension list: ready, unknown yet, cannot be read (403 or an error), or not granted */
    extensionsStatus: "ready" | "checking" | "unavailable" | "noConsent";
    onGrantExtensions?: () => void;
}

const CONTROL_COLUMNS = "@min-[640px]:grid @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,16rem)] @min-[640px]:items-center @min-[640px]:gap-4";

/**
 * The setting rows of one target (spec 5.5): category heads that are also the column header, rows with the label and
 * help, the value now in the tenant and the control. A changed row gets the violet gradient from the right with its
 * edge, the Now value struck through and Undo under it. From 640 px of panel width three columns; below, the control
 * moves under the label.
 */
export function SettingsTab(props: SettingsTabProps) {
    const { target, settings, isLoading, categories } = props;
    const { basket } = useConfigureBasket();
    const { add, leaveOut } = useConfigureBasketActions();
    // A group's approval waits for its first approver (prevented rule, spec 5.5): switched on here, written with it
    const [pendingApproval, setPendingApproval] = useState(false);

    const groups = buildSettingRows(categories, settings, basket, target, props.rules);
    const rows = groups.flatMap((g) => g.rows);
    const rowOf = (field: SettingField) => rows.find((r) => r.def.field === field);
    const approvalOn = rowOf("requireApproval")?.value === true || pendingApproval;
    const isBlank = isLoading || settings === null;

    const set = (field: SettingField, to: SettingValue) => {
        const change = settingChange(target, field, rowOf(field)?.now, to);
        if (change) add(change);
    };

    const editApproval = (action: ApprovalAction) => {
        const plan = planApprovalEdit({ target, nowApproval: rowOf("requireApproval")?.now, nowApprovers: rowOf("approvers")?.now, basket, pending: pendingApproval }, action);
        if (plan.leaveOut.length > 0) leaveOut(plan.leaveOut);
        if (plan.add.length > 0) add(plan.add);
        setPendingApproval(plan.pending);
    };

    const undo = (row: SettingRowState) => {
        if (row.def.field === "requireApproval" || row.def.field === "approvers") editApproval({ kind: "undo", field: row.def.field });
        else if (row.change) leaveOut([changeId(row.change)]);
    };

    if (props.failed) {
        return (
            <StatusBox
                variant="error"
                title="Could not read this policy"
                action={<button type="button" onClick={props.failed.onRetry} className="inline-flex h-[34px] items-center rounded border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">Try again</button>}
            >
                The settings cannot be shown or changed until the policy is read.
            </StatusBox>
        );
    }

    return (
        <div className="@container flex flex-col gap-6">
            {groups.map((group) => {
                const visible = group.rows.filter((r) => r.def.field !== "approvers" || approvalOn);
                const isExtensions = group.title === "Custom extensions";
                return (
                    <section key={group.title} aria-label={group.title}>
                        <div className={`border-b border-ink pb-2 text-xs ${CONTROL_COLUMNS}`}>
                            <h3 className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                                {group.title}
                                {group.isPreview && <Tag variant="accent">Preview</Tag>}
                            </h3>
                            <span className="text-muted @max-[639px]:hidden">{`Now in ${props.tenantName}`}</span>
                            <span className="text-muted @max-[639px]:hidden">Set to</span>
                        </div>
                        {isExtensions && group.note && <p className="mt-2 text-[13px] leading-[18px] text-body">{group.note}</p>}
                        {isExtensions && props.extensionsStatus === "unavailable" && (
                            <p className="mt-2 text-[13px] leading-[18px] text-body">The tenant&apos;s list of extensions cannot be read, so only the extensions linked now are shown.</p>
                        )}
                        {isExtensions && props.extensionsStatus === "noConsent" && props.onGrantExtensions && (
                            <p className="mt-2 flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-body">
                                To choose an extension, PIM Manager needs permission to read the tenant&apos;s list.
                                <button type="button" onClick={props.onGrantExtensions} className="inline-flex h-[30px] items-center gap-1.5 rounded border border-line bg-surface px-2.5 text-[13px] font-medium text-ink hover:bg-page max-sm:h-11">
                                    Grant permission
                                </button>
                            </p>
                        )}
                        {visible.map((row) => (
                            <SettingRow
                                key={row.def.field}
                                row={row}
                                isLoading={isBlank}
                                words={props.words}
                                onUndo={row.change ? () => undo(row) : undefined}
                                extraLine={row.def.field === "approvers" && ((row.value as ApproverRef[] | undefined) ?? []).length === 0 ? (target.kind === "group" ? GROUP_APPROVERS_REQUIRED : ROLE_DEFAULT_APPROVERS) : null}
                            >
                                {renderControl(row, {
                                    // A rule the policy does not have cannot be written (the mapper only changes rules as read)
                                    disabled: isBlank || row.now === undefined,
                                    isBlank,
                                    set,
                                    editApproval,
                                    approvalOn,
                                    keepLastApprover: target.kind === "group" && approvalOn,
                                    props,
                                })}
                            </SettingRow>
                        ))}
                    </section>
                );
            })}
            {props.note && <p className="text-[13px] leading-[18px] text-body">{props.note}</p>}
        </div>
    );
}

interface ControlContext {
    disabled: boolean;
    /** The policy is not read: no value is shown as chosen (spec 15, never a default) */
    isBlank: boolean;
    set: (field: SettingField, to: SettingValue) => void;
    editApproval: (action: ApprovalAction) => void;
    approvalOn: boolean;
    /** A group with approval on keeps at least one approver */
    keepLastApprover: boolean;
    props: SettingsTabProps;
}

function renderControl(row: SettingRowState, ctx: ControlContext): ReactNode {
    const { def, value } = row;
    const { disabled, set, props } = ctx;
    switch (def.control) {
        case "duration":
            // No slider position while the policy is not read: a thumb at 8 hours would be a default
            if (ctx.isBlank || typeof value !== "string") return <span aria-hidden="true" className="block h-[34px] rounded bg-track opacity-60" />;
            return <DurationSlider label="" ariaLabel={def.label} value={value} min={1} max={24} step={0.5} disabled={disabled} onChange={(iso) => set(def.field, iso)} />;
        case "onOff": {
            const isApproval = def.field === "requireApproval";
            const on = ctx.isBlank ? undefined : isApproval ? ctx.approvalOn : value === true;
            return (
                <OnOff label={def.label} on={on} disabled={disabled} onChange={(next) => (isApproval ? ctx.editApproval({ kind: "toggle", on: next }) : set(def.field, next))} />
            );
        }
        case "requirement":
            return <RequirementControl value={ctx.isBlank ? undefined : value as ActivationRequirementValue | undefined} disabled={disabled} contexts={props.words.contexts} warning={props.contextWarning} onChange={(next) => set(def.field, next)} />;
        case "approvers":
            return <ApproverPicker approvers={(value as ApproverRef[] | undefined) ?? []} disabled={disabled} keepLast={ctx.keepLastApprover} search={props.searchPrincipals} onChange={(list) => ctx.editApproval({ kind: "approvers", list })} />;
        case "expiration":
            return <ExpirationSelect label={def.label} value={typeof value === "string" ? value : undefined} now={typeof row.now === "string" ? row.now : undefined} disabled={disabled} onChange={(iso) => set(def.field, iso)} />;
        case "extension":
            return <ExtensionSelect label={def.label} value={value as CustomExtensionLink | undefined} disabled={disabled} extensions={props.words.extensions} onChange={(link) => set(def.field, link)} />;
    }
}

interface SettingRowProps {
    row: SettingRowState;
    isLoading: boolean;
    words: ValueWords;
    onUndo?: () => void;
    extraLine: string | null;
    children: ReactNode;
}

function SettingRow({ row, isLoading, words, onUndo, extraLine, children }: SettingRowProps) {
    const { def, now, value } = row;
    const changed = isChanged(def.field, now, value) && row.change !== undefined;
    const nowText = isLoading ? "Loading" : now === undefined ? NOT_IN_POLICY : describeSettingValue(def.field, now, words);
    const labelId = useId();
    return (
        <div
            role="group"
            aria-labelledby={labelId}
            className={`border-b border-line py-3 ${CONTROL_COLUMNS} ${def.isIndented ? "@min-[640px]:pl-5" : ""} ${changed ? "-mx-2 bg-linear-to-l from-change-tint to-transparent px-2 shadow-[inset_-2px_0_0_var(--change)]" : ""}`}
        >
            <div className="min-w-0">
                <p id={labelId} className="text-[15px] leading-5 font-semibold text-ink">{def.label}</p>
                {def.help && <p className="mt-0.5 text-[13px] leading-[18px] text-body">{def.help}</p>}
                {extraLine && <p className="mt-0.5 text-[13px] leading-[18px] text-body">{extraLine}</p>}
            </div>
            <div className="mt-1.5 text-[13px] text-ink @min-[640px]:mt-0">
                <span className="text-body @min-[640px]:sr-only">Now: </span>
                {changed ? (
                    <>
                        <s className="font-semibold text-body">{nowText}</s>
                        <span className="sr-only">{`, changed to ${describeSettingValue(def.field, value, words)}`}</span>
                        {onUndo && (
                            <button type="button" onClick={onUndo} className="mt-0.5 flex items-center gap-1 text-[13px] text-accent underline-offset-2 hover:underline max-sm:min-h-11">
                                <Icon name="undo" size={16} />
                                Undo
                                <span className="sr-only">{` ${def.label}`}</span>
                            </button>
                        )}
                    </>
                ) : (
                    <span className="font-semibold">{nowText}</span>
                )}
            </div>
            <div className="mt-2 min-w-0 @min-[640px]:mt-0">{children}</div>
        </div>
    );
}
