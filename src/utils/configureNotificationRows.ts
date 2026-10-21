/**
 * The Notification tab of Edit (spec 5.10, NG-66) as data: three cards (made eligible, assigned active, activates), one
 * row per email with its three cells (default recipients, additional recipients, critical emails only), each with the
 * value read from the tenant, the value in the basket and the change. Pure; `NotificationTab` draws it.
 */
import type { BasketSetting, SettingField, SettingValue, Target } from "@/types/configure.types";
import type { PolicySettings } from "@/types/wizard.types";
import { findSetting, type Basket } from "@/utils/configureBasket";
import { notificationField, readSettingValue, recipientList, type NotificationProperty, type NotificationRecipientKey, type NotificationSection } from "@/utils/policyRules";

export interface NotificationRowDef {
    recipient: NotificationRecipientKey;
    /** Microsoft's name of the email */
    email: string;
    recipientLabel: string;
}

export interface NotificationCardDef {
    section: NotificationSection;
    title: string;
    rows: readonly NotificationRowDef[];
}

export const NOTIFICATION_CARDS: readonly NotificationCardDef[] = [
    {
        section: "eligibleAssignment",
        title: "When someone is made eligible",
        rows: [
            { recipient: "admin", email: "Role assignment alert", recipientLabel: "Admins" },
            { recipient: "assignee", email: "Notification to the assigned user", recipientLabel: "Assignee" },
            { recipient: "approver", email: "Request to approve a renewal or extension", recipientLabel: "Approvers" },
        ],
    },
    {
        section: "activeAssignment",
        title: "When someone is assigned active",
        rows: [
            { recipient: "admin", email: "Role assignment alert", recipientLabel: "Admins" },
            { recipient: "assignee", email: "Notification to the assigned user", recipientLabel: "Assignee" },
            { recipient: "approver", email: "Request to approve a renewal or extension", recipientLabel: "Approvers" },
        ],
    },
    {
        section: "activation",
        title: "When someone activates",
        rows: [
            { recipient: "admin", email: "Role activation alert", recipientLabel: "Admins" },
            { recipient: "requestor", email: "Notification to the activated user", recipientLabel: "Requestor" },
            { recipient: "approver", email: "Request to approve an activation", recipientLabel: "Approvers" },
        ],
    },
];

export const APPROVER_ACTIVATION_NOTE = "Not available for approvers of an activation";
export const RECIPIENTS_PLACEHOLDER = "name@contoso.com; other@contoso.com";
export const NOTIFICATION_PROPERTIES: readonly NotificationProperty[] = ["isEnabled", "additionalRecipients", "criticalOnly"];

/** The additional recipients of an activation's approvers cannot be set (spec 5.10) */
export function canEditRecipients(section: NotificationSection, recipient: NotificationRecipientKey): boolean {
    return !(section === "activation" && recipient === "approver");
}

/** `;` separated addresses, trimmed, empty entries dropped */
export function parseRecipients(text: string): string[] {
    return recipientList(text);
}

export function formatRecipients(list: readonly string[]): string {
    return list.join("; ");
}

export interface NotificationCell {
    field: SettingField;
    /** Read from the tenant; undefined while the policy is not read */
    now: SettingValue | undefined;
    /** What the control shows: the basket's value, else Now */
    value: SettingValue | undefined;
    change: BasketSetting | undefined;
}

export interface NotificationRow extends NotificationRowDef {
    section: NotificationSection;
    cells: Record<NotificationProperty, NotificationCell>;
}

export interface NotificationCard {
    section: NotificationSection;
    title: string;
    rows: NotificationRow[];
}

export function buildNotificationCells(settings: PolicySettings | null, basket: Basket, target: Target): NotificationCard[] {
    return NOTIFICATION_CARDS.map((card) => ({
        section: card.section,
        title: card.title,
        rows: card.rows.map((row) => {
            const cells = {} as Record<NotificationProperty, NotificationCell>;
            for (const property of NOTIFICATION_PROPERTIES) {
                const field = notificationField(card.section, row.recipient, property);
                const now = settings ? readSettingValue(settings, field) : undefined;
                const change = findSetting(basket, target, field);
                cells[property] = { field, now, value: change ? change.to : now, change };
            }
            return { ...row, section: card.section, cells };
        }),
    }));
}

/** The words of a cell's value: On or Off, the recipients joined, or None */
export function describeCellValue(property: NotificationProperty, value: SettingValue | undefined): string {
    if (value === undefined) return "Not set";
    if (property === "additionalRecipients") return Array.isArray(value) && value.length > 0 ? formatRecipients(value as string[]) : "None";
    return value === true ? "On" : "Off";
}
