import { describe, it, expect } from "vitest";
import { buildPolicyView, formatPolicyDuration, type PolicyTile, type PolicyView } from "@/utils/policyView";
import { summarizePolicyRules } from "@/utils/policySummary";
import { applyDashboardFilterToRoles } from "@/utils/dashboardFilter";
import { role as roleFixture } from "../fixtures/dashboardFilterFixtures";
import type { PimPolicyRule } from "@/types/directoryRole.types";

const T = "#microsoft.graph.unifiedRoleManagementPolicy";

type TestRule = { id: string; [key: string]: unknown };

function rule(id: string, type: string, caller: string, level: string, extra: Record<string, unknown> = {}): TestRule {
    return { id, "@odata.type": `${T}${type}Rule`, target: { caller, operations: ["All"], level, inheritableSettings: [], enforcedSettings: [] }, ...extra };
}

const notification = (id: string, caller: string, level: string, recipientType: string, extra: Record<string, unknown> = {}) =>
    rule(id, "Notification", caller, level, { notificationType: "Email", recipientType, notificationLevel: "All", isDefaultRecipientsEnabled: true, notificationRecipients: [], ...extra });

/** A policy as Graph returns it for a role: every group of rules present */
function fullRules(overrides: { duration?: string; enablement?: string[]; approval?: Record<string, unknown>; authContext?: Record<string, unknown>; extensions?: TestRule[] } = {}): TestRule[] {
    return [
        rule("Expiration_EndUser_Assignment", "Expiration", "EndUser", "Assignment", { isExpirationRequired: true, maximumDuration: overrides.duration ?? "PT8H" }),
        rule("Enablement_EndUser_Assignment", "Enablement", "EndUser", "Assignment", { enabledRules: overrides.enablement ?? ["MultiFactorAuthentication", "Justification"] }),
        rule("Approval_EndUser_Assignment", "Approval", "EndUser", "Assignment", { setting: overrides.approval ?? { isApprovalRequired: false } }),
        rule("AuthenticationContext_EndUser_Assignment", "AuthenticationContext", "EndUser", "Assignment", overrides.authContext ?? { isEnabled: false, claimValue: "" }),
        rule("Expiration_Admin_Eligibility", "Expiration", "Admin", "Eligibility", { isExpirationRequired: false, maximumDuration: "P365D" }),
        rule("Expiration_Admin_Assignment", "Expiration", "Admin", "Assignment", { isExpirationRequired: true, maximumDuration: "P180D" }),
        rule("Enablement_Admin_Assignment", "Enablement", "Admin", "Assignment", { enabledRules: ["MultiFactorAuthentication"] }),
        notification("Notification_Admin_Admin_Eligibility", "Admin", "Eligibility", "Admin"),
        notification("Notification_Requestor_Admin_Eligibility", "Admin", "Eligibility", "Requestor"),
        notification("Notification_Approver_Admin_Eligibility", "Admin", "Eligibility", "Approver"),
        notification("Notification_Admin_Admin_Assignment", "Admin", "Assignment", "Admin"),
        notification("Notification_Requestor_Admin_Assignment", "Admin", "Assignment", "Requestor"),
        notification("Notification_Approver_Admin_Assignment", "Admin", "Assignment", "Approver"),
        notification("Notification_Admin_EndUser_Assignment", "EndUser", "Assignment", "Admin"),
        notification("Notification_Requestor_EndUser_Assignment", "EndUser", "Assignment", "Requestor"),
        notification("Notification_Approver_EndUser_Assignment", "EndUser", "Assignment", "Approver"),
        ...(overrides.extensions ?? []),
    ];
}

const extensionRule = (slot: "PreApproval" | "PostApproval", id: string, name: string, isEnabled = true) =>
    rule(`CustomExtension_${slot}_EndUser_Assignment`, "CustomExtension", "EndUser", "Assignment", { isEnabled, customExtensionId: id, displayName: name, customAttributes: [] });

const unlinkedExtensionRule = (slot: "PreApproval" | "PostApproval") =>
    rule(`CustomExtension_${slot}_EndUser_Assignment`, "CustomExtension", "EndUser", "Assignment", { isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [] });

function tile(view: PolicyView, tab: "activation" | "assignment" | "notification", id: string): PolicyTile {
    const found = view.tabs[tab].tiles.find((t) => t.id === id);
    if (!found) throw new Error(`tile ${id} missing`);
    return found;
}

const value = (t: PolicyTile) => t.lines.map((l) => l.text).join(" | ");
const ctx = { isPrivileged: true };

describe("formatPolicyDuration", () => {
    it("writes the unit in lower case and handles the half hours Graph allows", () => {
        expect(formatPolicyDuration("PT8H")).toBe("8 hours");
        expect(formatPolicyDuration("PT1H")).toBe("1 hour");
        expect(formatPolicyDuration("P1D")).toBe("1 day");
        expect(formatPolicyDuration("P365D")).toBe("1 year");
        expect(formatPolicyDuration("PT1H30M")).toBe("1.5 hours");
        expect(formatPolicyDuration(undefined)).toBe("Unknown");
    });
});

describe("buildPolicyView: activation", () => {
    it("is null without rules", () => {
        expect(buildPolicyView(null, ctx)).toBeNull();
        expect(buildPolicyView(undefined, ctx)).toBeNull();
        expect(buildPolicyView([], ctx)).toBeNull();
    });

    it("shows MFA, justification, no approval and the duration of a plain policy", () => {
        const view = buildPolicyView(fullRules(), ctx)!;
        expect(value(tile(view, "activation", "maxDuration"))).toBe("8 hours");
        expect(value(tile(view, "activation", "require"))).toBe("Entra MFA");
        expect(value(tile(view, "activation", "justification"))).toBe("Justification");
        expect(value(tile(view, "activation", "approval"))).toBe("Not required");
        expect(view.tabs.activation.tiles.find((t) => t.id === "approvers")).toBeUndefined();
        expect(view.tabs.activation.needsAttention).toBe(false);
    });

    it("names the authentication context and falls back to its id", () => {
        const rules = fullRules({ enablement: [], authContext: { isEnabled: true, claimValue: "c1" } });
        expect(value(tile(buildPolicyView(rules, { ...ctx, authenticationContexts: [{ id: "c1", displayName: "Phishing-resistant" }] })!, "activation", "require"))).toBe("Auth context: Phishing-resistant");
        expect(value(tile(buildPolicyView(rules, ctx)!, "activation", "require"))).toBe("Auth context: c1");
    });

    it("shows Entra MFA when both MFA and an authentication context are set, as the dashboard counts it", () => {
        const rules = fullRules({ enablement: ["MultiFactorAuthentication"], authContext: { isEnabled: true, claimValue: "c1" } });
        expect(value(tile(buildPolicyView(rules, ctx)!, "activation", "require"))).toBe("Entra MFA");
    });

    it("shows Nothing, Ticket and the combination of justification and ticket", () => {
        expect(value(tile(buildPolicyView(fullRules({ enablement: [] }), ctx)!, "activation", "require"))).toBe("Nothing");
        expect(value(tile(buildPolicyView(fullRules({ enablement: ["Ticketing"] }), ctx)!, "activation", "justification"))).toBe("Ticket");
        expect(value(tile(buildPolicyView(fullRules({ enablement: ["Justification", "Ticketing"] }), ctx)!, "activation", "justification"))).toBe("Justification, Ticket");
        expect(value(tile(buildPolicyView(fullRules({ enablement: ["MultiFactorAuthentication"] }), ctx)!, "activation", "justification"))).toBe("None");
    });

    it("lists approvers with (group) and ids in mono when the name is missing", () => {
        const approval = {
            isApprovalRequired: true,
            approvalStages: [{ primaryApprovers: [
                { "@odata.type": "#microsoft.graph.singleUser", userId: "u-1", description: "u-1" },
                { "@odata.type": "#microsoft.graph.groupMembers", groupId: "g-1", description: "g-1" },
            ] }],
        };
        const rules = fullRules({ approval });
        const withNames = buildPolicyView(rules, { ...ctx, approvers: [{ id: "u-1", type: "user", displayName: "Anna de Vries" }, { id: "g-1", type: "group", displayName: "Security Leads" }] })!;
        expect(tile(withNames, "activation", "approvers").lines).toEqual([{ text: "Anna de Vries" }, { text: "Security Leads (group)" }]);
        expect(tile(withNames, "activation", "approvers").isFullWidth).toBe(true);
        const withoutNames = buildPolicyView(rules, ctx)!;
        expect(tile(withoutNames, "activation", "approvers").lines).toEqual([{ text: "u-1", isId: true }, { text: "g-1 (group)", isId: true }]);
        expect(value(tile(withNames, "activation", "approval"))).toBe("Required");
    });

    it("shows the before approval tile with None, and the after approval tile only when linked", () => {
        const none = buildPolicyView(fullRules({ extensions: [unlinkedExtensionRule("PreApproval"), unlinkedExtensionRule("PostApproval")] }), ctx)!;
        expect(value(tile(none, "activation", "extensionBefore"))).toBe("None");
        expect(tile(none, "activation", "extensionBefore").isPreview).toBe(true);
        expect(none.tabs.activation.tiles.find((t) => t.id === "extensionAfter")).toBeUndefined();

        const both = buildPolicyView(fullRules({ extensions: [extensionRule("PreApproval", "e-1", "ServiceNow ticket check"), extensionRule("PostApproval", "e-2", "Audit hook")] }), ctx)!;
        expect(value(tile(both, "activation", "extensionBefore"))).toBe("ServiceNow ticket check");
        expect(value(tile(both, "activation", "extensionAfter"))).toBe("Audit hook");
    });

    it("says Not found in the danger style when a known tenant list lacks the linked id, and uses the list name otherwise", () => {
        const rules = fullRules({ extensions: [extensionRule("PreApproval", "e-1", "Old name")] });
        const missing = buildPolicyView(rules, { ...ctx, customExtensions: [{ id: "other", displayName: "Other" }] })!;
        expect(value(tile(missing, "activation", "extensionBefore"))).toBe("Not found");
        expect(tile(missing, "activation", "extensionBefore").isDanger).toBe(true);
        const found = buildPolicyView(rules, { ...ctx, customExtensions: [{ id: "E-1", displayName: "Current name" }] })!;
        expect(value(tile(found, "activation", "extensionBefore"))).toBe("Current name");
        // list unknown (licence or consent): the name on the rule is shown, never Not found
        const unknown = buildPolicyView(rules, { ...ctx, customExtensions: null })!;
        expect(value(tile(unknown, "activation", "extensionBefore"))).toBe("Old name");
        expect(tile(unknown, "activation", "extensionBefore").isDanger).toBeFalsy();
    });

    it("marks a disabled link", () => {
        const view = buildPolicyView(fullRules({ extensions: [extensionRule("PreApproval", "e-1", "Hook", false)] }), ctx)!;
        expect(value(tile(view, "activation", "extensionBefore"))).toBe("Hook (disabled)");
    });
});

describe("buildPolicyView: attention dots", () => {
    it("flags Activation for a privileged policy with neither MFA nor an authentication context", () => {
        expect(buildPolicyView(fullRules({ enablement: [] }), { isPrivileged: true })!.tabs.activation.needsAttention).toBe(true);
        expect(buildPolicyView(fullRules({ enablement: [] }), { isPrivileged: false })!.tabs.activation.needsAttention).toBe(false);
        expect(buildPolicyView(fullRules({ enablement: [], authContext: { isEnabled: true, claimValue: "c1" } }), { isPrivileged: true })!.tabs.activation.needsAttention).toBe(false);
    });

    it("flags Assignment when permanent active assignments are allowed", () => {
        const strict = buildPolicyView(fullRules(), ctx)!;
        expect(strict.tabs.assignment.needsAttention).toBe(false);
        const loose = fullRules().map((r) => (r.id === "Expiration_Admin_Assignment" ? { ...r, isExpirationRequired: false } : r));
        expect(buildPolicyView(loose, ctx)!.tabs.assignment.needsAttention).toBe(true);
    });

    it("flags Notification when the activation alert to admins is off with no extra recipients", () => {
        const off = fullRules().map((r) => (r.id === "Notification_Admin_EndUser_Assignment" ? { ...r, isDefaultRecipientsEnabled: false } : r));
        expect(buildPolicyView(off, ctx)!.tabs.notification.needsAttention).toBe(true);
        const extra = fullRules().map((r) => (r.id === "Notification_Admin_EndUser_Assignment" ? { ...r, isDefaultRecipientsEnabled: false, notificationRecipients: ["soc@contoso.com"] } : r));
        expect(buildPolicyView(extra, ctx)!.tabs.notification.needsAttention).toBe(false);
    });

    it("sets no dot and no crash for a policy without notification rules", () => {
        const view = buildPolicyView(fullRules().filter((r) => !r.id.startsWith("Notification_")), ctx)!;
        expect(view.tabs.notification.needsAttention).toBe(false);
        expect(view.tabs.notification.tiles).toHaveLength(3);
        expect(view.needsAttention).toBe(false);
    });

    it("rolls the tabs up into one flag for the Member or Owner switch", () => {
        expect(buildPolicyView(fullRules({ enablement: [] }), ctx)!.needsAttention).toBe(true);
    });
});

describe("buildPolicyView: assignment and notification", () => {
    it("reads eligible and active expiration and the active requirements", () => {
        const view = buildPolicyView(fullRules(), ctx)!;
        expect(value(tile(view, "assignment", "eligible"))).toBe("Permanent allowed");
        expect(value(tile(view, "assignment", "active"))).toBe("Expire after 180 days");
        expect(value(tile(view, "assignment", "activeRequire"))).toBe("Entra MFA");
        const both = fullRules().map((r) => (r.id === "Enablement_Admin_Assignment" ? { ...r, enabledRules: ["MultiFactorAuthentication", "Justification"] } : r));
        expect(value(tile(buildPolicyView(both, ctx)!, "assignment", "activeRequire"))).toBe("Entra MFA, Justification");
        const none = fullRules().map((r) => (r.id === "Enablement_Admin_Assignment" ? { ...r, enabledRules: [] } : r));
        expect(value(tile(buildPolicyView(none, ctx)!, "assignment", "activeRequire"))).toBe("Nothing");
    });

    it("lists the recipients of every event: default, default plus extra, critical only, off", () => {
        const rules = fullRules().map((r) => {
            if (r.id === "Notification_Admin_Admin_Eligibility") return { ...r, notificationRecipients: ["a@contoso.com", "b@contoso.com"] };
            if (r.id === "Notification_Requestor_Admin_Eligibility") return { ...r, notificationLevel: "Critical" };
            if (r.id === "Notification_Approver_Admin_Eligibility") return { ...r, isDefaultRecipientsEnabled: false };
            return r;
        });
        const view = buildPolicyView(rules, ctx)!;
        expect(tile(view, "notification", "eligibleAssignment").lines).toEqual([
            { label: "Admin", text: "On, default plus a@contoso.com, b@contoso.com" },
            { label: "Assignee", text: "Critical only" },
            { label: "Approver", text: "Off" },
        ]);
        expect(tile(view, "notification", "activation").lines.map((l) => l.label)).toEqual(["Admin", "Requestor", "Approver"]);
        expect(tile(view, "notification", "activeAssignment").lines[0].text).toBe("On, default recipients");
    });

    it("says Only {list} when the default recipients are off but extra recipients are named", () => {
        const rules = fullRules().map((r) => (r.id === "Notification_Admin_Admin_Eligibility" ? { ...r, isDefaultRecipientsEnabled: false, notificationRecipients: ["soc@contoso.com"] } : r));
        expect(tile(buildPolicyView(rules, ctx)!, "notification", "eligibleAssignment").lines[0].text).toBe("Only soc@contoso.com");
    });

    it("reads a group Member policy the same way (durations are ISO, never PT8H)", () => {
        const memberRules = fullRules({ duration: "PT8H", enablement: ["MultiFactorAuthentication"] });
        const view = buildPolicyView(memberRules, { isPrivileged: true })!;
        expect(value(tile(view, "activation", "maxDuration"))).toBe("8 hours");
    });
});

describe("buildPolicyView does not change what the dashboard reads", () => {
    it("leaves the summarizePolicyRules result of the same rules as it was", () => {
        const rules = fullRules({ approval: { isApprovalRequired: true }, extensions: [extensionRule("PreApproval", "e-1", "Hook")] }) as unknown as PimPolicyRule[];
        const before = summarizePolicyRules(rules);
        buildPolicyView(rules, ctx);
        expect(summarizePolicyRules(rules)).toEqual(before);
        expect(before).toMatchObject({ isLoaded: true, isApprovalRequired: true, hasCustomExtension: true, hasPimMfa: true, hasAuthContext: false, isJustificationRequired: true, maxDuration: "PT8H" });
        expect(before.activationNotification).toEqual({ isDefaultRecipientsEnabled: true, notificationRecipients: [] });
    });
});

describe("buildPolicyView: group policies (Member and Owner)", () => {
    // What GroupPolicyRule allows: no target, a string recipientType, no recipients list, no approval setting
    const stripTargets = (rules: TestRule[]) => rules.map((r) => {
        const copy: Record<string, unknown> = { ...r };
        delete copy.target;
        return copy as TestRule;
    });

    it("reads the same tiles and dots when the rules carry no target", () => {
        const withTarget = buildPolicyView(fullRules({ enablement: ["MultiFactorAuthentication"] }), { isPrivileged: true })!;
        const without = buildPolicyView(stripTargets(fullRules({ enablement: ["MultiFactorAuthentication"] })), { isPrivileged: true })!;
        expect(value(tile(without, "activation", "require"))).toBe("Entra MFA");
        expect(without.tabs.activation.needsAttention).toBe(false);
        expect(without).toEqual(withTarget);
    });

    it("does not crash on a notification rule without recipients, an approval rule without setting or an approver without type", () => {
        const rules = [
            ...fullRules().filter((r) => !r.id.startsWith("Notification_") && r.id !== "Approval_EndUser_Assignment"),
            { id: "Notification_Admin_EndUser_Assignment", "@odata.type": `${T}NotificationRule`, recipientType: "Admin", notificationLevel: "All" },
            { id: "Notification_Requestor_EndUser_Assignment", "@odata.type": `${T}NotificationRule`, recipientType: ["Requestor"], isDefaultRecipientsEnabled: true },
            { id: "Approval_EndUser_Assignment", "@odata.type": `${T}ApprovalRule` },
        ];
        const view = buildPolicyView(rules, { isPrivileged: true })!;
        expect(value(tile(view, "activation", "approval"))).toBe("Not required");
        expect(tile(view, "notification", "activation").lines.map((l) => l.label)).toEqual(["Admin", "Requestor", "Approver"]);

        const approval = { id: "Approval_EndUser_Assignment", "@odata.type": `${T}ApprovalRule`, setting: { isApprovalRequired: true, approvalStages: [{ primaryApprovers: [{ userId: "u-1" }] }] } };
        const withApprover = buildPolicyView([...rules.filter((r) => r.id !== "Approval_EndUser_Assignment"), approval], { isPrivileged: true })!;
        expect(tile(withApprover, "activation", "approvers").lines).toEqual([{ text: "u-1 (group)", isId: true }]);
    });

    it("keeps Member and Owner policies apart: each has its own tiles and its own dots", () => {
        const member = buildPolicyView(fullRules({ enablement: ["MultiFactorAuthentication"], duration: "PT4H" }), { isPrivileged: true })!;
        const owner = buildPolicyView(fullRules({ enablement: [], duration: "PT1H" }), { isPrivileged: true })!;
        expect(value(tile(member, "activation", "maxDuration"))).toBe("4 hours");
        expect(value(tile(owner, "activation", "maxDuration"))).toBe("1 hour");
        expect(member.needsAttention).toBe(false);
        expect(owner.tabs.activation.needsAttention).toBe(true);
    });
});

describe("buildPolicyView: approvers", () => {
    const approval = (approvers: Record<string, unknown>[]) => ({ isApprovalRequired: true, approvalStages: [{ primaryApprovers: approvers }] });

    it("shows the requestor's manager without any lookup", () => {
        const rules = fullRules({ approval: approval([{ "@odata.type": "#microsoft.graph.requestorManager" }]) });
        expect(tile(buildPolicyView(rules, ctx)!, "activation", "approvers").lines).toEqual([{ text: "Requestor's manager" }]);
    });

    it("keeps approvers that are not resolved yet next to resolved ones", () => {
        const rules = fullRules({ approval: approval([{ "@odata.type": "#microsoft.graph.singleUser", userId: "u-1", description: "u-1" }, { "@odata.type": "#microsoft.graph.groupMembers", groupId: "g-1", description: "Security Leads" }]) });
        const view = buildPolicyView(rules, { ...ctx, approvers: [{ id: "u-1", type: "user", displayName: "Anna de Vries" }] })!;
        expect(tile(view, "activation", "approvers").lines).toEqual([{ text: "Anna de Vries" }, { text: "Security Leads (group)" }]);
    });

    it("shows an id in mono when a resolved approver has no display name", () => {
        const rules = fullRules({ approval: approval([{ "@odata.type": "#microsoft.graph.singleUser", userId: "u-1" }]) });
        const view = buildPolicyView(rules, { ...ctx, approvers: [{ id: "u-1", type: "user" }] })!;
        expect(tile(view, "activation", "approvers").lines).toEqual([{ text: "u-1", isId: true }]);
    });
});

describe("buildPolicyView: partial policies", () => {
    it("says Not set for a duration or expiration whose rule is missing, never a parser default", () => {
        const rules = fullRules().filter((r) => !["Expiration_EndUser_Assignment", "Expiration_Admin_Eligibility", "Expiration_Admin_Assignment"].includes(r.id));
        const view = buildPolicyView(rules, ctx)!;
        expect(value(tile(view, "activation", "maxDuration"))).toBe("Not set");
        expect(value(tile(view, "assignment", "eligible"))).toBe("Not set");
        expect(value(tile(view, "assignment", "active"))).toBe("Not set");
    });

    it("reads a present expiration rule without isExpirationRequired as permanent allowed (the parser's meaning), with the dot", () => {
        const rules = fullRules().map((r) => {
            if (r.id !== "Expiration_Admin_Assignment") return r;
            const copy: Record<string, unknown> = { ...r };
            delete copy.isExpirationRequired;
            return copy as TestRule;
        });
        const view = buildPolicyView(rules, ctx)!;
        expect(value(tile(view, "assignment", "active"))).toBe("Permanent allowed");
        expect(view.tabs.assignment.needsAttention).toBe(true);
    });

    it("keeps the critical level when only extra recipients are notified", () => {
        const rules = fullRules().map((r) => (r.id === "Notification_Admin_Admin_Eligibility" ? { ...r, isDefaultRecipientsEnabled: false, notificationLevel: "Critical", notificationRecipients: ["soc@contoso.com"] } : r));
        expect(tile(buildPolicyView(rules, ctx)!, "notification", "eligibleAssignment").lines[0].text).toBe("Only soc@contoso.com, critical only");
    });

    it("sets no Assignment dot when the expiration rule of active assignments is missing", () => {
        const rules = fullRules().filter((r) => r.id !== "Expiration_Admin_Assignment");
        expect(buildPolicyView(rules, ctx)!.tabs.assignment.needsAttention).toBe(false);
    });
});

describe("the dots equal the dashboard's definitions", () => {
    const variants: Array<{ name: string; rules: TestRule[] }> = [
        { name: "mfa", rules: fullRules({ enablement: ["MultiFactorAuthentication"] }) },
        { name: "none", rules: fullRules({ enablement: [] }) },
        { name: "auth context", rules: fullRules({ enablement: [], authContext: { isEnabled: true, claimValue: "c1" } }) },
        { name: "auth context without claim", rules: fullRules({ enablement: [], authContext: { isEnabled: true, claimValue: "" } }) },
        { name: "justification only", rules: fullRules({ enablement: ["Justification"] }) },
    ];

    it("Activation dot on a privileged role is mfa:neither", () => {
        const roles = variants.map((v, i) => roleFixture({ id: `r${i}`, isPrivileged: true, policy: { details: { rules: v.rules } } as never }));
        const flagged = applyDashboardFilterToRoles(roles, { mfa: "neither" }).map((r) => r.definition.id);
        variants.forEach((v, i) => {
            expect(buildPolicyView(v.rules, { isPrivileged: true })!.tabs.activation.needsAttention, v.name).toBe(flagged.includes(`r${i}`));
        });
    });

    it("Notification dot is activationNotification:none", () => {
        const make = (defaults: boolean, extra: string[]) => fullRules().map((r) => (r.id === "Notification_Admin_EndUser_Assignment" ? { ...r, isDefaultRecipientsEnabled: defaults, notificationRecipients: extra } : r));
        const cases = [make(true, []), make(false, []), make(false, ["a@contoso.com"])];
        const roles = cases.map((rules, i) => roleFixture({ id: `n${i}`, policy: { details: { rules } } as never }));
        const flagged = applyDashboardFilterToRoles(roles, { activationNotification: "none" }).map((r) => r.definition.id);
        cases.forEach((rules, i) => {
            expect(buildPolicyView(rules, ctx)!.tabs.notification.needsAttention).toBe(flagged.includes(`n${i}`));
        });
    });
});
