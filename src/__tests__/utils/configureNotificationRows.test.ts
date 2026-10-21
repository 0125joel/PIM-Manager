import { describe, expect, it } from "vitest";
import { buildReportRules } from "@/__tests__/fixtures/reportFixture";
import { EMPTY_BASKET, addChange } from "@/utils/configureBasket";
import {
    NOTIFICATION_CARDS,
    buildNotificationCells,
    canEditRecipients,
    describeCellValue,
    formatRecipients,
    parseRecipients,
} from "@/utils/configureNotificationRows";
import { readTargetSettings, settingChange } from "@/utils/configureSettingRows";

const role = { kind: "role" as const, id: "role-ga" };

describe("the Notification tab (spec 5.10)", () => {
    it("three cards of three emails, in the order and with the names of the spec", () => {
        expect(NOTIFICATION_CARDS.map((c) => c.title)).toEqual(["When someone is made eligible", "When someone is assigned active", "When someone activates"]);
        expect(NOTIFICATION_CARDS.map((c) => c.rows.map((r) => `${r.email} (${r.recipientLabel})`))).toEqual([
            ["Role assignment alert (Admins)", "Notification to the assigned user (Assignee)", "Request to approve a renewal or extension (Approvers)"],
            ["Role assignment alert (Admins)", "Notification to the assigned user (Assignee)", "Request to approve a renewal or extension (Approvers)"],
            ["Role activation alert (Admins)", "Notification to the activated user (Requestor)", "Request to approve an activation (Approvers)"],
        ]);
    });

    it("the activation approvers' recipients are the one cell that cannot be set", () => {
        const fixed = NOTIFICATION_CARDS.flatMap((c) => c.rows.filter((r) => !canEditRecipients(c.section, r.recipient)).map((r) => `${c.section}.${r.recipient}`));
        expect(fixed).toEqual(["activation.approver"]);
    });

    it("recipients split on ; and join with '; '", () => {
        expect(parseRecipients("a@contoso.com; b@contoso.com;;")).toEqual(["a@contoso.com", "b@contoso.com"]);
        expect(formatRecipients(["a@contoso.com", "b@contoso.com"])).toBe("a@contoso.com; b@contoso.com");
        expect(describeCellValue("additionalRecipients", [])).toBe("None");
        expect(describeCellValue("criticalOnly", false)).toBe("Off");
    });

    it("Now from the rules as read; the basket's value on top; nothing while not read", () => {
        const cell = (settings: ReturnType<typeof readTargetSettings>, basket = EMPTY_BASKET) => buildNotificationCells(settings, basket, role)[2].rows[0].cells.isEnabled;
        expect(cell(readTargetSettings(buildReportRules())).now).toBe(true);
        expect(cell(readTargetSettings(buildReportRules({ activationAdminNotified: false }))).now).toBe(false);
        const settings = readTargetSettings(buildReportRules({ activationAdminNotified: false }));
        const basket = addChange(EMPTY_BASKET, settingChange(role, "notifications.activation.admin.isEnabled", false, true)!);
        expect(cell(settings, basket)).toMatchObject({ now: false, value: true });
        expect(cell(settings, basket).change).toBeDefined();
        expect(buildNotificationCells(null, EMPTY_BASKET, role).flatMap((c) => c.rows.flatMap((r) => Object.values(r.cells).map((x) => x.now)))).toEqual(Array(27).fill(undefined));
    });
});
