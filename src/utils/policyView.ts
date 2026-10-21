import { parseGraphPolicy } from "@/utils/policyParser";
import type { PimCustomExtension } from "@/types/customExtension.types";
import type { AuthenticationContext, CustomExtensionLink } from "@/types/shared.types";
import type { PolicySettings } from "@/types/wizard.types";
import { CUSTOM_EXTENSION_SLOTS, isCustomExtensionLinked } from "@/utils/customExtensionUtils";
import { formatDuration, parseTotalHours } from "@/utils/durationUtils";
import { summarizePolicyRules } from "@/utils/policySummary";
import type { PimPolicyRule } from "@/types/directoryRole.types";

/**
 * One policy view model for roles and groups alike (Report spec 5.1): the tiles of the three tabs and the attention dots,
 * built from the rules through `parseGraphPolicy` and `summarizePolicyRules`, so dashboard, report and export read a
 * policy the same way. Pure: no Graph, no React.
 */

export type PolicyTabId = "activation" | "assignment" | "notification";

export const POLICY_TAB_IDS: readonly PolicyTabId[] = ["activation", "assignment", "notification"];

export interface PolicyTileEntry {
    /** The recipient of a notification line ("Admin"); empty for the other tiles */
    label?: string;
    text: string;
    /** An id shown because the name is not known (rendered in mono) */
    isId?: boolean;
}

export interface PolicyTile {
    id: string;
    label: string;
    /** One or more lines; a notification tile has three */
    lines: PolicyTileEntry[];
    /** The value is a problem state, shown in `danger-text` (an extension that is not in the tenant list) */
    isDanger?: boolean;
    /** The tile spans both columns */
    isFullWidth?: boolean;
    /** Shows the Preview tag next to the label */
    isPreview?: boolean;
}

export interface PolicyTabView {
    id: PolicyTabId;
    label: string;
    tiles: PolicyTile[];
    /** The amber dot of the tab (spec 3.3) */
    needsAttention: boolean;
}

export interface PolicyView {
    tabs: Record<PolicyTabId, PolicyTabView>;
    /** True when any tab needs attention (the dot of the Member or Owner choice) */
    needsAttention: boolean;
}

export interface PolicyViewContext {
    authenticationContexts?: readonly Pick<AuthenticationContext, "id" | "displayName">[];
    /** The tenant's custom extensions; null or undefined when the list could not be read (licence or consent) */
    customExtensions?: readonly Pick<PimCustomExtension, "id" | "displayName">[] | null;
    /** Resolved approvers; without them the tile shows the ids from the rule */
    approvers?: readonly { id: string; type?: "user" | "group" | "manager"; displayName?: string }[];
    /** Privileged roles must have MFA or an authentication context; groups pass `true` (spec 4.2) */
    isPrivileged: boolean;
}

export const TAB_LABELS: Record<PolicyTabId, string> = {
    activation: "Activation",
    assignment: "Assignment",
    notification: "Notification",
};

type NotificationSetting = PolicySettings["notifications"]["activation"]["admin"];

type LooseRule = Record<string, unknown>;

/**
 * Group policy rules mark most fields optional (`GroupPolicyRule`): no `target`, no recipients list, no approval
 * `setting`. The parsers read those fields without a guard, so a rule is made complete first: the caller and level
 * come from the rule id (`Kind_Caller_Level`, for a notification `Notification_Recipient_Caller_Level`), the
 * missing lists are empty, a `recipientType` list becomes its first entry. The result is only read, never written.
 */
export function completeRules(rules: readonly unknown[]): LooseRule[] {
    return rules.filter((raw): raw is LooseRule => !!raw && typeof raw === "object").map((raw) => {
        const rule: LooseRule = { ...raw };
        const id = typeof rule.id === "string" ? rule.id : "";
        const type = typeof rule["@odata.type"] === "string" ? (rule["@odata.type"] as string) : "";
        if (!rule.target || typeof rule.target !== "object") {
            const parts = id.split("_");
            const level = parts[parts.length - 1];
            const caller = parts[parts.length - 2];
            rule.target = { caller: caller ?? "", level: level ?? "", operations: ["All"], inheritableSettings: [], enforcedSettings: [] };
        }
        if (type.endsWith("NotificationRule")) {
            if (!Array.isArray(rule.notificationRecipients)) rule.notificationRecipients = [];
            if (Array.isArray(rule.recipientType)) rule.recipientType = String(rule.recipientType[0] ?? "");
            if (typeof rule.recipientType !== "string") rule.recipientType = "";
        }
        if (type.endsWith("ApprovalRule")) {
            const setting = (rule.setting && typeof rule.setting === "object" ? rule.setting : {}) as LooseRule;
            const stages = Array.isArray(setting.approvalStages) ? (setting.approvalStages as LooseRule[]) : undefined;
            rule.setting = {
                ...setting,
                approvalStages: stages?.map((stage) => ({
                    ...stage,
                    primaryApprovers: (Array.isArray(stage.primaryApprovers) ? (stage.primaryApprovers as LooseRule[]) : []).map((approver) => ({
                        ...approver,
                        "@odata.type": typeof approver["@odata.type"] === "string" ? approver["@odata.type"] : "",
                    })),
                })),
            };
        }
        return rule;
    });
}

interface RuleApprover {
    id: string;
    type: "user" | "group" | "manager";
    displayName?: string;
}

/** The primary approvers named in the approval rule, with their kind from the rule's own `@odata.type` (the parser calls a manager a group). */
function readRuleApprovers(rules: readonly LooseRule[]): RuleApprover[] {
    const result: RuleApprover[] = [];
    for (const rule of rules) {
        if (typeof rule["@odata.type"] !== "string" || !(rule["@odata.type"] as string).endsWith("ApprovalRule")) continue;
        const stages = ((rule.setting as LooseRule | undefined)?.approvalStages ?? []) as LooseRule[];
        for (const stage of stages) {
            for (const approver of (stage.primaryApprovers ?? []) as LooseRule[]) {
                const odataType = String(approver["@odata.type"] ?? "");
                if (odataType.includes("requestorManager")) {
                    result.push({ id: "manager", type: "manager", displayName: "Requestor's manager" });
                    continue;
                }
                const id = String(approver.userId ?? approver.groupId ?? approver.id ?? "");
                if (!id) continue;
                const description = typeof approver.description === "string" && approver.description !== id ? approver.description : undefined;
                result.push({ id, type: odataType.includes("singleUser") ? "user" : "group", displayName: description });
            }
        }
    }
    return result;
}

/** "8 hours", "1 year", "1.5 hours": the unit in lower case as rendered, an unknown shape as hours or as it is */
export function formatPolicyDuration(iso: string | undefined): string {
    if (!iso) return "Unknown";
    const formatted = formatDuration(iso);
    if (formatted !== iso) return formatted.toLowerCase();
    const hours = parseTotalHours(iso);
    if (hours === null) return iso;
    return `${Number.isInteger(hours) ? hours : Number(hours.toFixed(2))} ${hours === 1 ? "hour" : "hours"}`;
}

function formatRecipients(setting: NotificationSetting): string {
    const extra = setting.additionalRecipients
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
    if (setting.criticalOnly && setting.isEnabled) return extra.length > 0 ? `Critical only, plus ${extra.join(", ")}` : "Critical only";
    // Default recipients off but extra recipients named: only those are notified
    if (!setting.isEnabled) return extra.length > 0 ? `Only ${extra.join(", ")}${setting.criticalOnly ? ", critical only" : ""}` : "Off";
    return extra.length > 0 ? `On, default plus ${extra.join(", ")}` : "On, default recipients";
}

function describeExtension(link: CustomExtensionLink | undefined, list: PolicyViewContext["customExtensions"]): { text: string; isDanger: boolean } {
    if (!isCustomExtensionLinked(link)) return { text: "None", isDanger: false };
    const listed = list?.find((extension) => extension.id.toLowerCase() === link.customExtensionId.toLowerCase());
    // A known list that lacks the id: the link points at something the tenant no longer has
    if (list && !listed) return { text: "Not found", isDanger: true };
    const name = listed?.displayName || link.displayName || link.customExtensionId;
    return { text: link.isEnabled ? name : `${name} (disabled)`, isDanger: false };
}

/** Resolved approvers win per id; an approver that is not resolved (yet) keeps the name on the rule or its id in mono. */
function describeApprovers(fromRules: readonly RuleApprover[], resolved: PolicyViewContext["approvers"]): PolicyTileEntry[] {
    const resolvedById = new Map((resolved ?? []).map((approver) => [approver.id.toLowerCase(), approver]));
    const merged: RuleApprover[] = fromRules.map((approver) => {
        const match = approver.type === "manager" ? undefined : resolvedById.get(approver.id.toLowerCase());
        return match ? { id: approver.id, type: match.type === "group" ? "group" : approver.type, displayName: match.displayName } : approver;
    });
    // Approvers that arrive resolved while the rule names none (rule not parsed): show them rather than nothing
    const listed = merged.length > 0 ? merged : (resolved ?? []).map((a): RuleApprover => ({ id: a.id, type: a.type ?? "user", displayName: a.displayName }));
    return listed.map((approver) => {
        if (approver.type === "manager") return { text: approver.displayName ?? "Requestor's manager" };
        const name = approver.displayName && approver.displayName !== approver.id ? approver.displayName : undefined;
        const suffix = approver.type === "group" ? " (group)" : "";
        return name ? { text: `${name}${suffix}` } : { text: `${approver.id}${suffix}`, isId: true };
    });
}

function describeRequirement(settings: PolicySettings, summary: ReturnType<typeof summarizePolicyRules>, contexts: PolicyViewContext["authenticationContexts"]): string {
    // Entra MFA wins over an authentication context, as in the dashboard filter (mfa:entraMfa, mfa:authContext)
    if (summary.hasPimMfa) return "Entra MFA";
    if (summary.hasAuthContext) {
        const id = summary.contextId ?? settings.authenticationContextId ?? "";
        const name = contexts?.find((context) => context.id === id)?.displayName ?? id;
        return `Auth context: ${name}`;
    }
    return "Nothing";
}

function listOrNone(parts: string[]): string {
    return parts.length > 0 ? parts.join(", ") : "None";
}

const NOT_SET = "Not set";

function describeExpiration(isRulePresent: boolean, allowPermanent: boolean, expiration: string | undefined): string {
    // A policy without the rule would otherwise read as the parser default ("permanent allowed"), a value nobody set
    if (!isRulePresent) return NOT_SET;
    return allowPermanent ? "Permanent allowed" : `Expire after ${formatPolicyDuration(expiration)}`;
}

/** Eligible and active assignment, then the three notification events, then the activation tiles: see spec 3.3 */
export function buildPolicyView(rawRules: readonly unknown[] | null | undefined, ctx: PolicyViewContext): PolicyView | null {
    // No rules is no policy to show (loading, failed or verified not configured): the caller shows its own state
    if (!rawRules || rawRules.length === 0) return null;
    const rules = completeRules(rawRules);
    const settings = parseGraphPolicy({ rules });
    const summary = summarizePolicyRules(rules as unknown as PimPolicyRule[]);
    const hasRule = (id: string) => rules.some((rule) => rule.id === id);

    // Activation
    const requirement = describeRequirement(settings, summary, ctx.authenticationContexts);
    const justificationAndTicket = listOrNone([
        ...(settings.requireJustificationOnActivation ? ["Justification"] : []),
        ...(settings.requireTicketInfo ? ["Ticket"] : []),
    ]);
    const activationTiles: PolicyTile[] = [
        { id: "maxDuration", label: "Maximum activation duration", lines: [{ text: hasRule("Expiration_EndUser_Assignment") ? formatPolicyDuration(settings.maxActivationDuration) : NOT_SET }] },
        { id: "require", label: "On activation, require", lines: [{ text: requirement }] },
        { id: "justification", label: "Justification and ticket", lines: [{ text: justificationAndTicket }] },
        { id: "approval", label: "Approval", lines: [{ text: settings.requireApproval ? "Required" : "Not required" }] },
    ];
    if (settings.requireApproval) {
        const approvers = describeApprovers(readRuleApprovers(rules), ctx.approvers);
        activationTiles.push({
            id: "approvers",
            label: "Approvers",

            lines: approvers.length > 0 ? approvers : [{ text: "None named" }],
            isFullWidth: true,
        });
    }
    const slots = settings.customExtensions;
    for (const slot of CUSTOM_EXTENSION_SLOTS) {
        // The after approval slot is undocumented by Microsoft: shown only when it is linked
        if (slot === "postApproval" && !isCustomExtensionLinked(slots?.postApproval)) continue;
        const described = describeExtension(slots?.[slot], ctx.customExtensions);
        activationTiles.push({
            id: slot === "preApproval" ? "extensionBefore" : "extensionAfter",
            label: slot === "preApproval" ? "Custom extension, before approval" : "Custom extension, after approval",

            lines: [{ text: described.text }],
            isDanger: described.isDanger,
            isPreview: true,
        });
    }
    const needsMfaAttention = ctx.isPrivileged && !summary.hasPimMfa && !summary.hasAuthContext;

    // Assignment
    const activeRequire = listOrNone([
        ...(settings.requireMfaOnActiveAssignment ? ["Entra MFA"] : []),
        ...(settings.requireJustificationOnActiveAssignment ? ["Justification"] : []),
    ]);
    const assignmentTiles: PolicyTile[] = [
        { id: "eligible", label: "Eligible assignments", lines: [{ text: describeExpiration(hasRule("Expiration_Admin_Eligibility"), settings.allowPermanentEligible, settings.eligibleExpiration) }] },
        { id: "active", label: "Active assignments", lines: [{ text: describeExpiration(hasRule("Expiration_Admin_Assignment"), settings.allowPermanentActive, settings.activeExpiration) }] },
        { id: "activeRequire", label: "On active assignment, require", lines: [{ text: activeRequire === "None" ? "Nothing" : activeRequire }] },
    ];

    // Notification
    const n = settings.notifications;
    const notificationTiles: PolicyTile[] = [
        {
            id: "eligibleAssignment",
            label: "Eligible assignment",

            lines: [
                { label: "Admin", text: formatRecipients(n.eligibleAssignment.admin) },
                { label: "Assignee", text: formatRecipients(n.eligibleAssignment.assignee) },
                { label: "Approver", text: formatRecipients(n.eligibleAssignment.approver) },
            ],
        },
        {
            id: "activeAssignment",
            label: "Active assignment",

            lines: [
                { label: "Admin", text: formatRecipients(n.activeAssignment.admin) },
                { label: "Assignee", text: formatRecipients(n.activeAssignment.assignee) },
                { label: "Approver", text: formatRecipients(n.activeAssignment.approver) },
            ],
        },
        {
            id: "activation",
            label: "Activation",

            lines: [
                { label: "Admin", text: formatRecipients(n.activation.admin) },
                { label: "Requestor", text: formatRecipients(n.activation.requestor) },
                { label: "Approver", text: formatRecipients(n.activation.approver) },
            ],
        },
    ];

    // Attention: the same definitions as the dashboard (mfa:neither, assignment:permanent, activationNotification:none)
    const activationNotification = summary.activationNotification;
    const nobodyNotified = !!activationNotification
        && !activationNotification.isDefaultRecipientsEnabled
        && activationNotification.notificationRecipients.length === 0;

    const tabs: Record<PolicyTabId, PolicyTabView> = {
        activation: { id: "activation", label: TAB_LABELS.activation, tiles: activationTiles, needsAttention: needsMfaAttention },
        assignment: { id: "assignment", label: TAB_LABELS.assignment, tiles: assignmentTiles, needsAttention: hasRule("Expiration_Admin_Assignment") && settings.allowPermanentActive },
        notification: { id: "notification", label: TAB_LABELS.notification, tiles: notificationTiles, needsAttention: nobodyNotified },
    };
    return { tabs, needsAttention: POLICY_TAB_IDS.some((id) => tabs[id].needsAttention) };
}
