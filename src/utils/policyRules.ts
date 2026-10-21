/**
 * One settings model, one mapper (NG-54, spec 11). `buildRuleUpdates` turns setting changes into the PATCH bodies of the
 * policy rules they touch, for roles and groups alike: it starts from the rule as read and changes only the properties of
 * the change, so anything the app does not edit (approval timeouts, escalation, extension attributes) stays as it is.
 *
 * Pure: no Graph client. The callers read the current rules and send the bodies (`PATCH .../rules/{ruleId}`).
 */
import { CUSTOM_EXTENSION_RULE_IDS, CUSTOM_EXTENSION_RULE_TYPE } from "@/config/constants";
import type { CustomExtensionLink, CustomExtensionSlot } from "@/types/shared.types";
import type { PolicySettings } from "@/types/wizard.types";
import {
    buildCustomExtensionRuleBody,
    customExtensionLinksEqual,
    isPendingCustomExtensionPick,
    parseCustomExtensionLink,
} from "@/utils/customExtensionUtils";
import { DEFAULT_DURATIONS, isZeroDuration, toGraphDuration } from "@/utils/durationUtils";

// ---------------------------------------------------------------------------------------------------------------------
// The model

export type NotificationSection = "eligibleAssignment" | "activeAssignment" | "activation";
export type NotificationRecipientKey = "admin" | "assignee" | "requestor" | "approver";
export type NotificationProperty = "isEnabled" | "additionalRecipients" | "criticalOnly";

/** The nine notification cells: a section (when) and a recipient (who) */
export const NOTIFICATION_CELLS: ReadonlyArray<{ section: NotificationSection; recipient: NotificationRecipientKey; ruleId: string }> = [
    { section: "eligibleAssignment", recipient: "admin", ruleId: "Notification_Admin_Admin_Eligibility" },
    { section: "eligibleAssignment", recipient: "assignee", ruleId: "Notification_Requestor_Admin_Eligibility" },
    { section: "eligibleAssignment", recipient: "approver", ruleId: "Notification_Approver_Admin_Eligibility" },
    { section: "activeAssignment", recipient: "admin", ruleId: "Notification_Admin_Admin_Assignment" },
    { section: "activeAssignment", recipient: "assignee", ruleId: "Notification_Requestor_Admin_Assignment" },
    { section: "activeAssignment", recipient: "approver", ruleId: "Notification_Approver_Admin_Assignment" },
    { section: "activation", recipient: "admin", ruleId: "Notification_Admin_EndUser_Assignment" },
    { section: "activation", recipient: "requestor", ruleId: "Notification_Requestor_EndUser_Assignment" },
    { section: "activation", recipient: "approver", ruleId: "Notification_Approver_EndUser_Assignment" },
];

export type NotificationField = `notifications.${NotificationSection}.${NotificationRecipientKey}.${NotificationProperty}`;

/** Every field a change can touch (spec 5.5 and 5.10) */
export type SettingField =
    | "maxActivationDuration"
    | "activationRequirement"
    | "requireJustificationOnActivation"
    | "requireTicketInfo"
    | "requireApproval"
    | "approvers"
    | "customExtensions.preApproval"
    | "customExtensions.postApproval"
    | "allowPermanentEligible"
    | "eligibleExpiration"
    | "allowPermanentActive"
    | "activeExpiration"
    | "requireMfaOnActiveAssignment"
    | "requireJustificationOnActiveAssignment"
    | NotificationField;

/** One choice: nothing, MFA, or an authentication context (a context replaces MFA) */
export type ActivationRequirementValue =
    | { kind: "none" }
    | { kind: "mfa" }
    | { kind: "authenticationContext"; contextId: string };

export interface ApproverRef {
    id: string;
    type: "user" | "group" | "manager";
    displayName?: string;
}

export type SettingValue = boolean | string | string[] | ActivationRequirementValue | ApproverRef[] | CustomExtensionLink;

export interface SettingChange {
    field: SettingField;
    to: SettingValue;
}

/** A rule as Graph returns it; group rules come without `target` */
export interface GraphRule {
    "@odata.type"?: string;
    id: string;
    [key: string]: unknown;
}

export interface RuleUpdate {
    ruleId: string;
    body: Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rule shapes

const T = "#microsoft.graph.unifiedRoleManagementPolicy";
export const RULE_TYPES = {
    expiration: `${T}ExpirationRule`,
    enablement: `${T}EnablementRule`,
    approval: `${T}ApprovalRule`,
    authenticationContext: `${T}AuthenticationContextRule`,
    notification: `${T}NotificationRule`,
    customExtension: CUSTOM_EXTENSION_RULE_TYPE,
} as const;

export type RuleCaller = "Admin" | "EndUser";
export type RuleLevel = "Eligibility" | "Assignment";

/**
 * The target a write needs. A target copied from a GET (lower-case "all", no `@odata.type`) fails with
 * `MissingProvider` (lessons-learned), and group rules have none at all.
 */
export function createRuleTarget(caller: RuleCaller, level: RuleLevel): Record<string, unknown> {
    return {
        "@odata.type": "microsoft.graph.unifiedRoleManagementPolicyRuleTarget",
        caller,
        operations: ["All"],
        level,
        inheritableSettings: [],
        enforcedSettings: [],
    };
}

/** Caller and level from the rule id (`Notification_Admin_EndUser_Assignment`): the last two parts */
function callerAndLevel(ruleId: string): { caller: RuleCaller; level: RuleLevel } {
    const parts = ruleId.split("_");
    return { caller: parts[parts.length - 2] as RuleCaller, level: parts[parts.length - 1] as RuleLevel };
}

function typeOfRuleId(ruleId: string): string {
    if (ruleId.startsWith("Expiration_")) return RULE_TYPES.expiration;
    if (ruleId.startsWith("Enablement_")) return RULE_TYPES.enablement;
    if (ruleId.startsWith("Approval_")) return RULE_TYPES.approval;
    if (ruleId.startsWith("AuthenticationContext_")) return RULE_TYPES.authenticationContext;
    if (ruleId.startsWith("Notification_")) return RULE_TYPES.notification;
    return RULE_TYPES.customExtension;
}

/** The fields every body carries: its type, its id and a write target */
function baseBody(ruleId: string, current: GraphRule | undefined): Record<string, unknown> {
    const { caller, level } = callerAndLevel(ruleId);
    return {
        "@odata.type": typeof current?.["@odata.type"] === "string" ? current["@odata.type"] : typeOfRuleId(ruleId),
        id: ruleId,
        target: createRuleTarget(caller, level),
    };
}

const ACTIVATION_EXPIRATION = "Expiration_EndUser_Assignment";
const ACTIVATION_ENABLEMENT = "Enablement_EndUser_Assignment";
const ACTIVATION_CONTEXT = "AuthenticationContext_EndUser_Assignment";
const ACTIVATION_APPROVAL = "Approval_EndUser_Assignment";
const ELIGIBLE_EXPIRATION = "Expiration_Admin_Eligibility";
const ACTIVE_EXPIRATION = "Expiration_Admin_Assignment";
const ACTIVE_ENABLEMENT = "Enablement_Admin_Assignment";

/**
 * The fallback when an end becomes required and the rule stored none (`PT0S`): what a group starts with (tenant test T6),
 * one year for eligible and 180 days for active assignments, in the form Graph keeps.
 */
const FALLBACK_MAXIMUM: Record<string, string> = {
    Expiration_Admin_Eligibility: toGraphDuration(DEFAULT_DURATIONS.eligibleExpiration),
    Expiration_Admin_Assignment: toGraphDuration(DEFAULT_DURATIONS.activeExpiration),
    Expiration_EndUser_Assignment: DEFAULT_DURATIONS.activationDuration,
};

/** Hours and minutes stay as they are (`PT1H30M`); days, months and years go to the days form Graph keeps (`P1Y` is `P365D`) */
function graphDuration(value: string): string {
    return value.startsWith("PT") ? value : toGraphDuration(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading values off a rule

const ENABLEMENT_ORDER = ["MultiFactorAuthentication", "Justification", "Ticketing"];

function enabledRulesOf(rule: GraphRule | undefined): string[] {
    return Array.isArray(rule?.enabledRules) ? (rule.enabledRules as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

/** Known entries in a fixed order, unknown ones kept after them */
function orderEnabledRules(values: Set<string>): string[] {
    return [...ENABLEMENT_ORDER.filter((v) => values.has(v)), ...[...values].filter((v) => !ENABLEMENT_ORDER.includes(v))];
}

function isBlankDuration(value: unknown): boolean {
    return typeof value !== "string" || value === "" || isZeroDuration(value);
}

/** Additional recipients as a list: `;` separated text, or a list; trimmed, empty entries left out */
export function recipientList(value: string[] | string): string[] {
    const list = Array.isArray(value) ? value : value.split(";");
    return list.map((v) => v.trim()).filter(Boolean);
}

type RawApproverShape = Record<string, unknown>;

/** An approver in the v1.0 write shape: `singleUser` with `userId`, `groupMembers` with `groupId` (Learn), as the group path sent it */
function writeApprover(raw: RawApproverShape): RawApproverShape {
    const type = typeof raw["@odata.type"] === "string" ? raw["@odata.type"] : "";
    const description = typeof raw.description === "string" ? raw.description : undefined;
    if (type.endsWith("singleUser")) return { "@odata.type": "#microsoft.graph.singleUser", userId: raw.userId ?? raw.id, ...(description !== undefined ? { description } : {}) };
    if (type.endsWith("groupMembers")) return { "@odata.type": "#microsoft.graph.groupMembers", groupId: raw.groupId ?? raw.id, ...(description !== undefined ? { description } : {}) };
    if (type.endsWith("requestorManager")) return { "@odata.type": "#microsoft.graph.requestorManager", managerLevel: typeof raw.managerLevel === "number" ? raw.managerLevel : 1 };
    const copy = { ...raw };
    delete copy.isBackup;
    return copy;
}

function approverFromRef(ref: ApproverRef): RawApproverShape {
    if (ref.type === "manager") return { "@odata.type": "#microsoft.graph.requestorManager", managerLevel: 1 };
    return ref.type === "group"
        ? { "@odata.type": "#microsoft.graph.groupMembers", groupId: ref.id, description: ref.displayName ?? "" }
        : { "@odata.type": "#microsoft.graph.singleUser", userId: ref.id, description: ref.displayName ?? "" };
}

// ---------------------------------------------------------------------------------------------------------------------
// The mapper

type ChangeMap = Partial<Record<SettingField, SettingValue>>;

function has(changes: ChangeMap, field: SettingField): boolean {
    return Object.prototype.hasOwnProperty.call(changes, field);
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function buildExpiration(ruleId: string, current: GraphRule | undefined, permanentField: SettingField | null, durationField: SettingField, changes: ChangeMap): RuleUpdate | null {
    const touched = (permanentField && has(changes, permanentField)) || has(changes, durationField);
    if (!touched) return null;
    const currentRequired = current?.isExpirationRequired === true;
    // The activation rule has no permanent switch: its required flag stays as read (W-03; the review says PIM Manager
    // does not change it). A rule not read yet starts required, as Microsoft's default
    const required = permanentField
        ? (has(changes, permanentField) ? !(changes[permanentField] as boolean) : currentRequired)
        : (current ? currentRequired : true);
    const durationChange = has(changes, durationField) ? (changes[durationField] as string) : undefined;
    let maximum = durationChange !== undefined ? graphDuration(durationChange) : (current?.maximumDuration as string | undefined);
    if (required && isBlankDuration(maximum)) maximum = FALLBACK_MAXIMUM[ruleId];
    if (current && currentRequired === required && sameJson(current.maximumDuration, maximum)) return null;
    const body: Record<string, unknown> = { ...baseBody(ruleId, current), isExpirationRequired: required };
    if (maximum !== undefined) body.maximumDuration = maximum;
    return { ruleId, body };
}

function buildEnablement(ruleId: string, current: GraphRule | undefined, flags: Array<{ field: SettingField; entry: string; on: (v: SettingValue) => boolean }>, changes: ChangeMap): RuleUpdate | null {
    const relevant = flags.filter((f) => has(changes, f.field));
    if (relevant.length === 0) return null;
    const before = enabledRulesOf(current);
    const values = new Set(before);
    for (const f of relevant) {
        if (f.on(changes[f.field] as SettingValue)) values.add(f.entry);
        else values.delete(f.entry);
    }
    const after = orderEnabledRules(values);
    if (current && sameJson([...before].sort(), [...after].sort())) return null;
    return { ruleId, body: { ...baseBody(ruleId, current), enabledRules: after } };
}

function buildAuthenticationContext(current: GraphRule | undefined, changes: ChangeMap): RuleUpdate | null {
    if (!has(changes, "activationRequirement")) return null;
    const requirement = changes.activationRequirement as ActivationRequirementValue;
    const currentOn = current?.isEnabled === true;
    const currentClaim = typeof current?.claimValue === "string" ? current.claimValue : "";
    if (requirement.kind === "authenticationContext") {
        if (current && currentOn && currentClaim === requirement.contextId) return null;
        return { ruleId: ACTIVATION_CONTEXT, body: { ...baseBody(ACTIVATION_CONTEXT, current), isEnabled: true, claimValue: requirement.contextId } };
    }
    // Leaving a context, written for both workloads (bug 3: groups never switched it off)
    if (!currentOn) return null;
    return { ruleId: ACTIVATION_CONTEXT, body: { ...baseBody(ACTIVATION_CONTEXT, current), isEnabled: false, claimValue: "" } };
}

function buildApproval(current: GraphRule | undefined, changes: ChangeMap): RuleUpdate | null {
    if (!has(changes, "requireApproval") && !has(changes, "approvers")) return null;
    const setting = (current?.setting && typeof current.setting === "object" ? current.setting : {}) as Record<string, unknown>;
    const stages = Array.isArray(setting.approvalStages) ? (setting.approvalStages as Record<string, unknown>[]) : [];
    const firstStage = stages[0] ?? {};
    const currentApprovers = Array.isArray(firstStage.primaryApprovers) ? (firstStage.primaryApprovers as RawApproverShape[]) : [];
    const required = has(changes, "requireApproval") ? (changes.requireApproval as boolean) : setting.isApprovalRequired === true;
    const approvers = !required
        ? []
        : has(changes, "approvers")
            ? (changes.approvers as ApproverRef[]).filter((a) => a.type === "manager" || !!a.id).map(approverFromRef)
            : currentApprovers.map(writeApprover);
    const currentMode = typeof setting.approvalMode === "string" ? setting.approvalMode : "";
    const approvalMode = required
        ? (currentMode && currentMode !== "NoApproval" ? currentMode : "SingleStage")
        : "NoApproval";
    // Bug 4: every value the change does not name stays as read (timeouts, escalation, justification flags)
    const stage = {
        approvalStageTimeOutInDays: typeof firstStage.approvalStageTimeOutInDays === "number" ? firstStage.approvalStageTimeOutInDays : 1,
        isApproverJustificationRequired: typeof firstStage.isApproverJustificationRequired === "boolean" ? firstStage.isApproverJustificationRequired : true,
        escalationTimeInMinutes: typeof firstStage.escalationTimeInMinutes === "number" ? firstStage.escalationTimeInMinutes : 0,
        isEscalationEnabled: typeof firstStage.isEscalationEnabled === "boolean" ? firstStage.isEscalationEnabled : false,
        primaryApprovers: approvers,
        escalationApprovers: (Array.isArray(firstStage.escalationApprovers) ? (firstStage.escalationApprovers as RawApproverShape[]) : []).map(writeApprover),
    };
    const laterStages = stages.slice(1);
    const nextSetting = {
        isApprovalRequired: required,
        isApprovalRequiredForExtension: typeof setting.isApprovalRequiredForExtension === "boolean" ? setting.isApprovalRequiredForExtension : false,
        isRequestorJustificationRequired: typeof setting.isRequestorJustificationRequired === "boolean" ? setting.isRequestorJustificationRequired : true,
        approvalMode,
        // An empty list answers "The policy is invalid." even with NoApproval (lessons-learned), so one stage always stays
        approvalStages: [stage, ...(required ? laterStages : [])],
    };
    if (current) {
        const sameRequired = (setting.isApprovalRequired === true) === required;
        const ids = (list: RawApproverShape[]) => list.map((a) => String(a.userId ?? a.groupId ?? a.id ?? a["@odata.type"])).sort();
        if (sameRequired && sameJson(ids(currentApprovers.map(writeApprover)), ids(approvers))) return null;
    }
    return { ruleId: ACTIVATION_APPROVAL, body: { ...baseBody(ACTIVATION_APPROVAL, current), setting: nextSetting } };
}

function buildCustomExtension(slot: CustomExtensionSlot, current: GraphRule | undefined, changes: ChangeMap): RuleUpdate | null {
    const field: SettingField = slot === "preApproval" ? "customExtensions.preApproval" : "customExtensions.postApproval";
    if (!has(changes, field)) return null;
    const link = changes[field] as CustomExtensionLink;
    if (isPendingCustomExtensionPick(link)) return null;
    const ruleId = CUSTOM_EXTENSION_RULE_IDS[slot];
    if (current && customExtensionLinksEqual(parseCustomExtensionLink({ ...current, "@odata.type": RULE_TYPES.customExtension } as Parameters<typeof parseCustomExtensionLink>[0]), link)) return null;
    // Never `displayName`: Graph derives it from customExtensionId
    return { ruleId, body: { ...baseBody(ruleId, current), ...buildCustomExtensionRuleBody(slot, link) } };
}

export function notificationField(section: NotificationSection, recipient: NotificationRecipientKey, property: NotificationProperty): NotificationField {
    return `notifications.${section}.${recipient}.${property}`;
}

function buildNotification(cell: (typeof NOTIFICATION_CELLS)[number], current: GraphRule | undefined, changes: ChangeMap): RuleUpdate | null {
    const f = (p: NotificationProperty) => notificationField(cell.section, cell.recipient, p);
    if (!has(changes, f("isEnabled")) && !has(changes, f("additionalRecipients")) && !has(changes, f("criticalOnly"))) return null;
    const currentLevel = current?.notificationLevel === "Critical" ? "Critical" : "All";
    const currentDefaults = current?.isDefaultRecipientsEnabled !== false;
    const currentRecipients = Array.isArray(current?.notificationRecipients) ? (current.notificationRecipients as string[]) : [];
    const level = has(changes, f("criticalOnly")) ? ((changes[f("criticalOnly")] as boolean) ? "Critical" : "All") : currentLevel;
    const defaults = has(changes, f("isEnabled")) ? (changes[f("isEnabled")] as boolean) : currentDefaults;
    const recipients = has(changes, f("additionalRecipients")) ? recipientList(changes[f("additionalRecipients")] as string[]) : currentRecipients;
    if (current && level === currentLevel && defaults === currentDefaults && sameJson([...recipients].sort(), [...currentRecipients].sort())) return null;
    const recipientType = typeof current?.recipientType === "string" && current.recipientType
        ? current.recipientType
        : Array.isArray(current?.recipientType) && typeof current.recipientType[0] === "string"
            ? current.recipientType[0]
            : cell.ruleId.split("_")[1];
    return {
        ruleId: cell.ruleId,
        body: {
            ...baseBody(cell.ruleId, current),
            notificationType: typeof current?.notificationType === "string" ? current.notificationType : "Email",
            recipientType,
            notificationLevel: level,
            isDefaultRecipientsEnabled: defaults,
            notificationRecipients: recipients,
        },
    };
}

/**
 * Write order inside one policy (`MfaAndAcrsConflict`, lessons-learned): a context switched off goes first, a context
 * switched on goes last, so MFA and a context are never on at the same time, not even between two PATCHes.
 */
function writeOrder(update: RuleUpdate): number {
    if (update.ruleId !== ACTIVATION_CONTEXT) return 1;
    return update.body.isEnabled === true ? 2 : 0;
}

/**
 * The PATCH bodies for a set of changes on one policy, in write order. Only rules a change touches and whose value
 * differs from the rule as read are returned. `Enablement_Admin_Eligibility` is never written.
 */
export function buildRuleUpdates(
    workload: "directoryRoles" | "pimGroups",
    currentRules: readonly GraphRule[],
    changes: readonly SettingChange[],
): RuleUpdate[] {
    void workload; // roles and groups differ in data only (group rules have no target), not in the mapping
    const map: ChangeMap = {};
    for (const change of changes) map[change.field] = change.to;
    const byId = new Map(currentRules.map((r) => [r.id, r]));
    const get = (id: string) => byId.get(id);

    const updates: RuleUpdate[] = [
        buildExpiration(ACTIVATION_EXPIRATION, get(ACTIVATION_EXPIRATION), null, "maxActivationDuration", map),
        buildEnablement(ACTIVATION_ENABLEMENT, get(ACTIVATION_ENABLEMENT), [
            { field: "activationRequirement", entry: "MultiFactorAuthentication", on: (v) => (v as ActivationRequirementValue).kind === "mfa" },
            { field: "requireJustificationOnActivation", entry: "Justification", on: (v) => v === true },
            { field: "requireTicketInfo", entry: "Ticketing", on: (v) => v === true },
        ], map),
        buildAuthenticationContext(get(ACTIVATION_CONTEXT), map),
        buildApproval(get(ACTIVATION_APPROVAL), map),
        buildCustomExtension("preApproval", get(CUSTOM_EXTENSION_RULE_IDS.preApproval), map),
        buildCustomExtension("postApproval", get(CUSTOM_EXTENSION_RULE_IDS.postApproval), map),
        buildExpiration(ELIGIBLE_EXPIRATION, get(ELIGIBLE_EXPIRATION), "allowPermanentEligible", "eligibleExpiration", map),
        buildExpiration(ACTIVE_EXPIRATION, get(ACTIVE_EXPIRATION), "allowPermanentActive", "activeExpiration", map),
        buildEnablement(ACTIVE_ENABLEMENT, get(ACTIVE_ENABLEMENT), [
            { field: "requireMfaOnActiveAssignment", entry: "MultiFactorAuthentication", on: (v) => v === true },
            { field: "requireJustificationOnActiveAssignment", entry: "Justification", on: (v) => v === true },
        ], map),
        ...NOTIFICATION_CELLS.map((cell) => buildNotification(cell, get(cell.ruleId), map)),
    ].filter((u): u is RuleUpdate => u !== null);

    // The order the rules were read in, rules missing from the read after them, then the MfaAndAcrsConflict sort
    const position = new Map(currentRules.map((r, i) => [r.id, i]));
    const indexOf = (u: RuleUpdate) => position.get(u.ruleId) ?? currentRules.length + updates.indexOf(u);
    return [...updates].sort((a, b) => indexOf(a) - indexOf(b)).sort((a, b) => writeOrder(a) - writeOrder(b));
}

// ---------------------------------------------------------------------------------------------------------------------
// Equality of one field's values, by meaning (the basket and the adapter below use the same rules)

function isRequirementValue(v: unknown): v is ActivationRequirementValue {
    return !!v && typeof v === "object" && typeof (v as { kind?: unknown }).kind === "string";
}

function isLinkValue(v: unknown): v is CustomExtensionLink {
    return !!v && typeof v === "object" && typeof (v as { customExtensionId?: unknown }).customExtensionId === "string";
}

function approverKeys(list: readonly ApproverRef[]): string[] {
    return list.filter((a) => a.type === "manager" || !!a.id).map((a) => `${a.type}:${a.type === "manager" ? "" : a.id.toLowerCase()}`).sort();
}

/**
 * Whether two values of one field mean the same: durations by length (`P1Y` is `P365D`, `PT90M` is `PT1H30M`),
 * approvers and recipients as sets, unlinked extension slots as equal, the rest as data.
 */
export function settingValuesEqualFor(field: SettingField, a: SettingValue | undefined, b: SettingValue | undefined): boolean {
    if (a === undefined || b === undefined) return a === b;
    if (field === "maxActivationDuration") return typeof a === "string" && typeof b === "string" && sameHours(a, b);
    if (field === "eligibleExpiration" || field === "activeExpiration") return typeof a === "string" && typeof b === "string" && sameDuration(a, b);
    if (field === "activationRequirement" && isRequirementValue(a) && isRequirementValue(b)) {
        return a.kind === b.kind && (a.kind !== "authenticationContext" || a.contextId === (b as { contextId?: string }).contextId);
    }
    if (field === "approvers" && Array.isArray(a) && Array.isArray(b)) return sameJson(approverKeys(a as ApproverRef[]), approverKeys(b as ApproverRef[]));
    if ((field === "customExtensions.preApproval" || field === "customExtensions.postApproval") && isLinkValue(a) && isLinkValue(b)) return customExtensionLinksEqual(a, b);
    if (field.endsWith(".additionalRecipients")) {
        const list = (v: SettingValue) => recipientList(Array.isArray(v) ? (v as string[]) : String(v)).map((x) => x.toLowerCase()).sort();
        return sameJson(list(a), list(b));
    }
    return sameJson(a, b);
}

// ---------------------------------------------------------------------------------------------------------------------
// The adapter for the old screens: a full settings object becomes the changes against the tenant

function requirementOf(s: PolicySettings): ActivationRequirementValue {
    if (s.activationRequirement === "authenticationContext" && s.authenticationContextId) return { kind: "authenticationContext", contextId: s.authenticationContextId };
    if (s.activationRequirement === "mfa") return { kind: "mfa" };
    return { kind: "none" };
}

function sameDuration(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return a === b;
    return toGraphDuration(a) === toGraphDuration(b);
}

/** Minutes of `PT{h}H{m}M`, or null for any other form (which then compares as text, never as a default) */
function activationMinutes(value: string): number | null {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(value);
    if (!match || (match[1] === undefined && match[2] === undefined)) return null;
    return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function sameHours(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b || a === b) return a === b;
    const left = activationMinutes(a);
    const right = activationMinutes(b);
    return left !== null && right !== null && left === right;
}

function approverIds(list: PolicySettings["approvers"]): string[] {
    return (list ?? []).filter((a) => a.type === "manager" || !!a.id).map((a) => `${a.type}:${a.type === "manager" ? "" : a.id}`).sort();
}

/**
 * The changes that turn `current` (read from the tenant) into `edited` (a full settings object from an old screen).
 * Only fields that differ become a change, so a full form writes only what differs from the tenant.
 */
export function settingsToChanges(current: PolicySettings, edited: PolicySettings): SettingChange[] {
    const changes: SettingChange[] = [];
    const push = (field: SettingField, to: SettingValue) => changes.push({ field, to });

    if (!sameHours(current.maxActivationDuration, edited.maxActivationDuration)) push("maxActivationDuration", edited.maxActivationDuration);
    const requirementBefore = requirementOf(current);
    const requirementAfter = requirementOf(edited);
    if (!sameJson(requirementBefore, requirementAfter)) push("activationRequirement", requirementAfter);
    if (current.requireJustificationOnActivation !== edited.requireJustificationOnActivation) push("requireJustificationOnActivation", edited.requireJustificationOnActivation);
    if (!!current.requireTicketInfo !== !!edited.requireTicketInfo) push("requireTicketInfo", !!edited.requireTicketInfo);
    if (current.requireApproval !== edited.requireApproval) push("requireApproval", edited.requireApproval);
    if (edited.requireApproval && !sameJson(approverIds(current.approvers), approverIds(edited.approvers))) {
        push("approvers", (edited.approvers ?? []).map((a) => ({ id: a.id, type: a.type, displayName: a.displayName })));
    }
    for (const slot of ["preApproval", "postApproval"] as const) {
        const next = edited.customExtensions?.[slot];
        if (!next || isPendingCustomExtensionPick(next)) continue;
        if (!customExtensionLinksEqual(current.customExtensions?.[slot], next)) push(`customExtensions.${slot}`, next);
    }
    if (current.allowPermanentEligible !== edited.allowPermanentEligible) push("allowPermanentEligible", edited.allowPermanentEligible);
    if (!sameDuration(current.eligibleExpiration, edited.eligibleExpiration) && edited.eligibleExpiration) push("eligibleExpiration", edited.eligibleExpiration);
    if (current.allowPermanentActive !== edited.allowPermanentActive) push("allowPermanentActive", edited.allowPermanentActive);
    if (!sameDuration(current.activeExpiration, edited.activeExpiration) && edited.activeExpiration) push("activeExpiration", edited.activeExpiration);
    if (current.requireMfaOnActiveAssignment !== edited.requireMfaOnActiveAssignment) push("requireMfaOnActiveAssignment", edited.requireMfaOnActiveAssignment);
    if (current.requireJustificationOnActiveAssignment !== edited.requireJustificationOnActiveAssignment) push("requireJustificationOnActiveAssignment", edited.requireJustificationOnActiveAssignment);

    for (const { section, recipient } of NOTIFICATION_CELLS) {
        const before = (current.notifications?.[section] as Record<string, { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean }> | undefined)?.[recipient];
        const after = (edited.notifications?.[section] as Record<string, { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean }> | undefined)?.[recipient];
        if (!after) continue;
        if (!before || before.isEnabled !== after.isEnabled) push(notificationField(section, recipient, "isEnabled"), after.isEnabled);
        if (!before || !!before.criticalOnly !== !!after.criticalOnly) push(notificationField(section, recipient, "criticalOnly"), !!after.criticalOnly);
        const beforeList = before ? recipientList(before.additionalRecipients ?? "") : [];
        const afterList = recipientList(after.additionalRecipients ?? "");
        if (!before || !sameJson([...beforeList].sort(), [...afterList].sort())) push(notificationField(section, recipient, "additionalRecipients"), afterList);
    }
    return changes;
}

/**
 * The settings as they will be after the changes (the inverse of `settingsToChanges`): what the pre-flight checks
 * existing assignments and activations against. Pure; `current` is not changed.
 */
export function applySettingChanges(current: PolicySettings, changes: readonly SettingChange[]): PolicySettings {
    const next: PolicySettings = {
        ...current,
        ...(current.customExtensions ? { customExtensions: { ...current.customExtensions } } : {}),
        notifications: JSON.parse(JSON.stringify(current.notifications ?? {})) as PolicySettings["notifications"],
    };
    for (const { field, to } of changes) {
        if (field === "activationRequirement") {
            const requirement = to as ActivationRequirementValue;
            next.activationRequirement = requirement.kind;
            if (requirement.kind === "authenticationContext") next.authenticationContextId = requirement.contextId;
            else delete next.authenticationContextId;
        } else if (field === "approvers") {
            next.approvers = (to as ApproverRef[]).map((a) => ({ id: a.id, type: a.type, displayName: a.displayName }));
        } else if (field === "customExtensions.preApproval" || field === "customExtensions.postApproval") {
            const slot = field === "customExtensions.preApproval" ? "preApproval" : "postApproval";
            next.customExtensions = { ...(next.customExtensions ?? {}), [slot]: to as CustomExtensionLink };
        } else if (field.startsWith("notifications.")) {
            const [, section, recipient, property] = field.split(".") as [string, NotificationSection, NotificationRecipientKey, NotificationProperty];
            const sectionValue = (next.notifications as unknown as Record<string, Record<string, { isEnabled: boolean; additionalRecipients: string; criticalOnly: boolean }>>)[section] ??= {};
            const cell = sectionValue[recipient] ??= { isEnabled: true, additionalRecipients: "", criticalOnly: false };
            if (property === "additionalRecipients") cell.additionalRecipients = recipientList(to as string[] | string).join(";");
            else cell[property] = to as boolean;
        } else {
            (next as unknown as Record<string, SettingValue>)[field] = to;
        }
    }
    return next;
}

/** The value of one field in a settings form, in the shape of a change (`SettingValue`); undefined when absent */
export function readSettingValue(settings: PolicySettings, field: SettingField): SettingValue | undefined {
    if (field === "activationRequirement") return requirementOf(settings);
    if (field === "approvers") return (settings.approvers ?? []).map((a) => ({ id: a.id, type: a.type, displayName: a.displayName }));
    if (field === "customExtensions.preApproval") return settings.customExtensions?.preApproval;
    if (field === "customExtensions.postApproval") return settings.customExtensions?.postApproval;
    if (field.startsWith("notifications.")) {
        const [, section, recipient, property] = field.split(".") as [string, NotificationSection, NotificationRecipientKey, NotificationProperty];
        const value = (settings.notifications as unknown as Record<string, Record<string, Record<string, unknown>> | undefined>)?.[section]?.[recipient]?.[property];
        if (property === "additionalRecipients") return recipientList(typeof value === "string" ? value : "");
        return value === undefined ? undefined : value === true;
    }
    return (settings as unknown as Record<string, SettingValue | undefined>)[field];
}
