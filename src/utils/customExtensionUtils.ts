import { CUSTOM_EXTENSION_RULE_IDS, CUSTOM_EXTENSION_RULE_TYPE } from '@/config/constants';
import { CustomExtensionLink, CustomExtensionSlot, CustomExtensionSlots } from '@/types/shared.types';

/** The subset of a policy rule the custom extension helpers read */
export interface CustomExtensionRuleLike {
    id: string;
    '@odata.type': string;
    isEnabled?: boolean;
    customExtensionId?: string | null;
    displayName?: string | null;
    customAttributes?: string[] | null;
}

export const CUSTOM_EXTENSION_SLOTS: readonly CustomExtensionSlot[] = ['preApproval', 'postApproval'];

export const CUSTOM_EXTENSION_SLOT_LABELS: Record<CustomExtensionSlot, string> = {
    preApproval: 'Pre-approval',
    postApproval: 'Post-approval',
};

export function isCustomExtensionRule(rule: { id: string; '@odata.type': string }): boolean {
    return rule['@odata.type'] === CUSTOM_EXTENSION_RULE_TYPE
        && (rule.id === CUSTOM_EXTENSION_RULE_IDS.preApproval || rule.id === CUSTOM_EXTENSION_RULE_IDS.postApproval);
}

export function getCustomExtensionSlotForRuleId(ruleId: string): CustomExtensionSlot | undefined {
    if (ruleId === CUSTOM_EXTENSION_RULE_IDS.preApproval) return 'preApproval';
    if (ruleId === CUSTOM_EXTENSION_RULE_IDS.postApproval) return 'postApproval';
    return undefined;
}

export function emptyCustomExtensionLink(): CustomExtensionLink {
    return { isEnabled: false, customExtensionId: '', customAttributes: [] };
}

export function isCustomExtensionLinked(link: CustomExtensionLink | undefined): link is CustomExtensionLink {
    return !!link && link.customExtensionId.trim() !== '';
}

/** Linked and switched on: PIM actually calls the extension on activation */
export function isCustomExtensionActive(link: CustomExtensionLink | undefined): boolean {
    return isCustomExtensionLinked(link) && link.isEnabled;
}

/**
 * The form's "switched on, nothing picked yet" state: enabled with an empty id.
 * Writes skip it, so an abandoned toggle never turns into an unlink.
 */
export function isPendingCustomExtensionPick(link: CustomExtensionLink | undefined): boolean {
    return !!link && link.isEnabled && link.customExtensionId.trim() === '';
}

export type CustomExtensionSummaryState = 'linked' | 'disabled' | 'removed' | 'pending';

export interface CustomExtensionSummaryLine {
    slot: CustomExtensionSlot;
    text: string;
    state: CustomExtensionSummaryState;
}

/** Human-readable line per managed slot, for review and compare views */
export function getCustomExtensionSummary(slots: CustomExtensionSlots | undefined): CustomExtensionSummaryLine[] {
    if (!slots) return [];
    const lines: CustomExtensionSummaryLine[] = [];
    for (const slot of CUSTOM_EXTENSION_SLOTS) {
        const link = slots[slot];
        if (!link) continue;
        if (isPendingCustomExtensionPick(link)) {
            lines.push({ slot, text: 'No extension selected (left unchanged)', state: 'pending' });
        } else if (!isCustomExtensionLinked(link)) {
            lines.push({ slot, text: 'Removed', state: 'removed' });
        } else {
            const name = link.displayName || link.customExtensionId;
            lines.push(link.isEnabled
                ? { slot, text: name, state: 'linked' }
                : { slot, text: `${name} (disabled)`, state: 'disabled' });
        }
    }
    return lines;
}

/** Read one rule into a link; unlinked rules become an empty link */
export function parseCustomExtensionLink(rule: CustomExtensionRuleLike): CustomExtensionLink {
    const link: CustomExtensionLink = {
        isEnabled: rule.isEnabled === true,
        customExtensionId: (rule.customExtensionId ?? '').trim(),
        customAttributes: Array.isArray(rule.customAttributes) ? rule.customAttributes.filter((a): a is string => typeof a === 'string') : [],
    };
    if (rule.displayName) link.displayName = rule.displayName;
    return link;
}

/** True when the policy carries the preview slots at all (feature rolled out in the tenant) */
export function hasCustomExtensionSlots(rules: readonly { id: string; '@odata.type': string }[] | undefined): boolean {
    return !!rules && rules.some(isCustomExtensionRule);
}

/**
 * Slots that currently link an extension. Unlinked slots are left undefined so a
 * write built from this result never touches a slot nobody changed.
 */
export function parseCustomExtensionRules(rules: readonly CustomExtensionRuleLike[] | undefined): CustomExtensionSlots | undefined {
    if (!rules) return undefined;
    const slots: CustomExtensionSlots = {};
    for (const rule of rules) {
        if (!isCustomExtensionRule(rule)) continue;
        const slot = getCustomExtensionSlotForRuleId(rule.id);
        if (!slot) continue;
        const link = parseCustomExtensionLink(rule);
        if (isCustomExtensionLinked(link)) slots[slot] = link;
    }
    return slots.preApproval || slots.postApproval ? slots : undefined;
}

export function getLinkedCustomExtensions(slots: CustomExtensionSlots | undefined): Array<{ slot: CustomExtensionSlot; link: CustomExtensionLink }> {
    if (!slots) return [];
    return CUSTOM_EXTENSION_SLOTS.flatMap((slot) => {
        const link = slots[slot];
        return isCustomExtensionLinked(link) ? [{ slot, link }] : [];
    });
}

export function customExtensionLinksEqual(a: CustomExtensionLink | undefined, b: CustomExtensionLink | undefined): boolean {
    const left = a ?? emptyCustomExtensionLink();
    const right = b ?? emptyCustomExtensionLink();
    const leftLinked = isCustomExtensionLinked(left);
    const rightLinked = isCustomExtensionLinked(right);
    if (!leftLinked && !rightLinked) return true;
    // Graph fills customAttributes from the extension when a slot is linked: a link written with [] reads back with the
    // extension's attribute names (tenant run 2026-10-09), so an empty list on one side is not a difference
    const sameAttributes = left.customAttributes.length === 0 || right.customAttributes.length === 0
        || (left.customAttributes.length === right.customAttributes.length && left.customAttributes.every((attr, i) => attr === right.customAttributes[i]));
    return left.customExtensionId === right.customExtensionId
        && left.isEnabled === right.isEnabled
        && sameAttributes;
}

/**
 * Rule body for the PATCH, without the target (callers add their own) and without
 * displayName, which Graph derives from customExtensionId and rejects as input.
 * Graph forces isEnabled to false while nothing is linked, so an unlink sends
 * both an empty id and isEnabled: false.
 */
export function buildCustomExtensionRuleBody(slot: CustomExtensionSlot, link: CustomExtensionLink | undefined): {
    id: string;
    isEnabled: boolean;
    customExtensionId: string;
    customAttributes: string[];
} {
    const linked = isCustomExtensionLinked(link);
    return {
        id: CUSTOM_EXTENSION_RULE_IDS[slot],
        isEnabled: linked ? link.isEnabled : false,
        customExtensionId: linked ? link.customExtensionId.trim() : '',
        customAttributes: linked ? [...link.customAttributes] : [],
    };
}

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a CSV or user-typed reference (id, or display name ignoring case) to
 * an extension. Without a list, a GUID is trusted as an id; a name cannot be.
 */
export function resolveCustomExtensionReference(
    value: string,
    extensions: readonly { id: string; displayName: string }[] | null | undefined
): { id: string; displayName: string } | undefined {
    const needle = value.trim();
    if (!needle) return undefined;
    if (extensions) {
        const byId = extensions.find((e) => e.id.toLowerCase() === needle.toLowerCase());
        if (byId) return { id: byId.id, displayName: byId.displayName };
        const byName = extensions.filter((e) => e.displayName.trim().toLowerCase() === needle.toLowerCase());
        if (byName.length === 1) return { id: byName[0].id, displayName: byName[0].displayName };
        if (byName.length > 1) return undefined;
    }
    return GUID_PATTERN.test(needle) ? { id: needle, displayName: needle } : undefined;
}

/**
 * Applies one bulk CSV cell to a slot: "" unlinks, anything else must resolve
 * to an extension. Attributes survive when the same extension stays linked.
 */
export function applyCustomExtensionCsvValue(
    settings: { customExtensions?: CustomExtensionSlots },
    slot: CustomExtensionSlot,
    value: string,
    extensions: readonly { id: string; displayName: string }[] | null | undefined
): void {
    const current = settings.customExtensions?.[slot];
    const slots: CustomExtensionSlots = { ...(settings.customExtensions ?? {}) };
    if (value.trim() === '') {
        slots[slot] = emptyCustomExtensionLink();
    } else {
        const match = resolveCustomExtensionReference(value, extensions);
        if (!match) throw new Error(`Custom extension "${value}" was not found in this tenant`);
        slots[slot] = {
            isEnabled: true,
            customExtensionId: match.id,
            displayName: match.displayName,
            customAttributes: current?.customExtensionId === match.id ? [...current.customAttributes] : [],
        };
    }
    settings.customExtensions = slots;
}

/** "ticket; costCenter" -> ["ticket", "costCenter"] */
export function parseCustomAttributesInput(value: string): string[] {
    return value.split(';').map((v) => v.trim()).filter(Boolean);
}

export function formatCustomAttributes(attributes: readonly string[] | undefined): string {
    return (attributes ?? []).join('; ');
}
