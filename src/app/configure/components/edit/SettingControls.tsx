"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import type { CustomExtensionLink } from "@/types/shared.types";
import { EXPIRATION_CHOICES, describeExpiration, expirationChoiceOf, type ValueWords } from "@/utils/configureSettingRows";
import { formatCustomAttributes, parseCustomAttributesInput } from "@/utils/customExtensionUtils";
import type { ActivationRequirementValue } from "@/utils/policyRules";

/*
 * The controls of the setting rows that are more than Off | On (spec 5.5): shared by one target (`SettingsTab`) and the
 * "Set to" of several targets (`SeveralSettings`, NG-65).
 */

export function RequirementControl({ value, disabled, contexts, warning, onChange }: {
    value: ActivationRequirementValue | undefined;
    disabled: boolean;
    contexts: ValueWords["contexts"];
    warning: (contextId: string) => string | null;
    onChange: (value: ActivationRequirementValue) => void;
}) {
    const name = useId();
    const kind = value?.kind;
    const contextId = value?.kind === "authenticationContext" ? value.contextId : "";
    const available = contexts.filter((c) => c.isAvailable !== false || c.id === contextId);
    const line = kind === "authenticationContext" && contextId ? warning(contextId) : null;
    const choices: { kind: ActivationRequirementValue["kind"]; label: string }[] = [
        { kind: "none", label: "Nothing" },
        { kind: "mfa", label: "Multifactor authentication" },
        { kind: "authenticationContext", label: "Authentication context" },
    ];
    return (
        <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
            <legend className="sr-only">On activation, require</legend>
            {choices.map((choice) => {
                const noContexts = choice.kind === "authenticationContext" && available.length === 0;
                return (
                    <label key={choice.kind} className={`flex items-center gap-2 text-[13px] max-sm:min-h-11 ${noContexts ? "text-muted" : "text-ink"}`}>
                        <input
                            type="radio"
                            name={name}
                            checked={kind === choice.kind}
                            disabled={noContexts}
                            onChange={() => onChange(choice.kind === "authenticationContext" ? { kind: "authenticationContext", contextId: contextId || available[0].id } : { kind: choice.kind } as ActivationRequirementValue)}
                            className="h-4 w-4 accent-(--accent)"
                        />
                        {choice.label}
                        {noContexts && <span className="text-xs">(none in this tenant)</span>}
                    </label>
                );
            })}
            {kind === "authenticationContext" && (
                <select
                    aria-label="Authentication context"
                    value={contextId}
                    onChange={(event) => onChange({ kind: "authenticationContext", contextId: event.target.value })}
                    className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink max-sm:h-11"
                >
                    {!available.some((c) => c.id === contextId) && <option value={contextId}>{contextId}</option>}
                    {available.map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
                </select>
            )}
            {line && (
                <p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-warn-text">
                    <Icon name="alert" size={16} className="mt-px shrink-0" />
                    {line}
                </p>
            )}
        </fieldset>
    );
}

export function ExpirationSelect({ label, value, now, disabled, onChange }: { label: string; value: string | undefined; now: string | undefined; disabled: boolean; onChange: (iso: string) => void }) {
    const choice = expirationChoiceOf(value);
    // The value read keeps its option when it is not one of the choices, so it can be chosen again without Undo
    const keepNow = now && !expirationChoiceOf(now) && now !== value ? now : null;
    return (
        <select
            aria-label={label}
            disabled={disabled}
            value={choice ?? value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className="h-[34px] w-fit min-w-32 rounded border border-line bg-surface px-2 text-sm text-ink disabled:opacity-50 max-sm:h-11"
        >
            {/* A value read from the tenant that is not one of the choices is shown as it is and kept unless changed */}
            {!choice && value && <option value={value}>{describeExpiration(value)}</option>}
            {keepNow && <option value={keepNow}>{describeExpiration(keepNow)}</option>}
            {!value && <option value="">Not set</option>}
            {EXPIRATION_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
    );
}

const NONE_LINK: CustomExtensionLink = { isEnabled: false, customExtensionId: "", customAttributes: [] };

export function ExtensionSelect({ label, value, disabled, extensions, onChange }: {
    label: string;
    value: CustomExtensionLink | undefined;
    disabled: boolean;
    extensions: ValueWords["extensions"];
    onChange: (link: CustomExtensionLink) => void;
}) {
    const id = value?.customExtensionId ?? "";
    const attributes = value?.customAttributes ?? [];
    // Without the list the select would offer nothing to choose (spec 5.5: a 403 hides the list-dependent parts only)
    if (extensions === null) return <p className="text-[13px] text-body">{id ? value?.displayName || id : "None"}</p>;
    const isMissing = id !== "" && !extensions.some((e) => e.id === id);
    return (
        <div className="flex flex-col gap-1.5">
            <select
                aria-label={label}
                disabled={disabled}
                value={id}
                onChange={(event) => onChange(event.target.value ? { isEnabled: true, customExtensionId: event.target.value, customAttributes: attributes } : NONE_LINK)}
                className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink disabled:opacity-50 max-sm:h-11"
            >
                <option value="">None</option>
                {isMissing && <option value={id}>Missing extension</option>}
                {extensions.map((e) => <option key={e.id} value={e.id}>{e.displayName}</option>)}
            </select>
            {id && <AttributesInput attributes={attributes} disabled={disabled} onChange={(next) => onChange({ ...(value ?? NONE_LINK), isEnabled: true, customExtensionId: id, customAttributes: next })} />}
        </div>
    );
}

/** "Custom attributes sent along" (spec 5.5): names separated by commas, written when the field is left */
function AttributesInput({ attributes, disabled, onChange }: { attributes: readonly string[]; disabled: boolean; onChange: (attributes: string[]) => void }) {
    const id = useId();
    const shown = formatCustomAttributes(attributes);
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <div className="flex flex-col gap-1">
            <label htmlFor={id} className="text-xs text-body">Custom attributes sent along</label>
            <input
                id={id}
                type="text"
                disabled={disabled}
                value={draft ?? shown}
                placeholder="Names, separated by commas"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    if (draft !== null && draft !== shown) onChange(parseCustomAttributesInput(draft));
                    setDraft(null);
                }}
                className="h-[34px] w-full rounded border border-line bg-surface px-2 text-sm text-ink placeholder:text-muted disabled:opacity-50 max-sm:h-11"
            />
        </div>
    );
}
