import { describe, expect, it } from "vitest";
import {
    NOTIFICATION_CELLS,
    applySettingChanges,
    buildRuleUpdates,
    createRuleTarget,
    settingsToChanges,
    type GraphRule,
    type SettingChange,
} from "@/utils/policyRules";
import { parseGraphPolicy } from "@/utils/policyParser";
import { GROUP_APPROVER, USER_APPROVER, groupRules, roleRules } from "../fixtures/policyRules";

const ids = (updates: { ruleId: string }[]) => updates.map((u) => u.ruleId);
const bodyOf = (updates: { ruleId: string; body: Record<string, unknown> }[], id: string) => updates.find((u) => u.ruleId === id)?.body;

describe("buildRuleUpdates: one row of spec 11.2 at a time", () => {
    const roles = roleRules() as GraphRule[];
    const groups = groupRules() as GraphRule[];

    it("no change gives no update", () => {
        expect(buildRuleUpdates("directoryRoles", roles, [])).toEqual([]);
        expect(buildRuleUpdates("pimGroups", groups, [])).toEqual([]);
    });

    it("a change to the value already there gives no update", () => {
        const same: SettingChange[] = [
            { field: "maxActivationDuration", to: "PT8H" },
            { field: "activationRequirement", to: { kind: "none" } },
            { field: "requireJustificationOnActivation", to: true },
            { field: "requireApproval", to: false },
            { field: "allowPermanentEligible", to: true },
            { field: "notifications.activation.admin.isEnabled", to: true },
        ];
        expect(buildRuleUpdates("directoryRoles", roles, same)).toEqual([]);
    });

    it("maximum activation duration writes the expiration rule with an end required", () => {
        const [u] = buildRuleUpdates("pimGroups", groups, [{ field: "maxActivationDuration", to: "PT1H30M" }]);
        expect(u.ruleId).toBe("Expiration_EndUser_Assignment");
        expect(u.body).toMatchObject({ isExpirationRequired: true, maximumDuration: "PT1H30M" });
    });

    it("a new activation duration keeps the end-required flag as read (W-03)", () => {
        const notRequired = groups.map((r) => (r as { id?: string }).id === "Expiration_EndUser_Assignment" ? { ...r, isExpirationRequired: false } : r) as GraphRule[];
        const [u] = buildRuleUpdates("pimGroups", notRequired, [{ field: "maxActivationDuration", to: "PT4H" }]);
        expect(u.body).toMatchObject({ isExpirationRequired: false, maximumDuration: "PT4H" });
    });

    it("MFA adds MultiFactorAuthentication and keeps the other entries", () => {
        const [u] = buildRuleUpdates("directoryRoles", roles, [{ field: "activationRequirement", to: { kind: "mfa" } }]);
        expect(u.body.enabledRules).toEqual(["MultiFactorAuthentication", "Justification"]);
    });

    it("a context is switched on after MFA is switched off (MfaAndAcrsConflict order)", () => {
        const updates = buildRuleUpdates("directoryRoles", roleRules({ requirement: "mfa" }) as GraphRule[], [{ field: "activationRequirement", to: { kind: "authenticationContext", contextId: "c2" } }]);
        expect(ids(updates)).toEqual(["Enablement_EndUser_Assignment", "AuthenticationContext_EndUser_Assignment"]);
        expect(updates[1].body).toMatchObject({ isEnabled: true, claimValue: "c2" });
    });

    it("bug 3: leaving a context writes it off, first, on both workloads", () => {
        for (const [workload, rules] of [["directoryRoles", roleRules({ requirement: { context: "c1" } })], ["pimGroups", groupRules({ requirement: { context: "c1" } })]] as const) {
            const updates = buildRuleUpdates(workload, rules as GraphRule[], [{ field: "activationRequirement", to: { kind: "mfa" } }]);
            expect(ids(updates)).toEqual(["AuthenticationContext_EndUser_Assignment", "Enablement_EndUser_Assignment"]);
            expect(updates[0].body).toMatchObject({ isEnabled: false, claimValue: "" });
            const toNothing = buildRuleUpdates(workload, rules as GraphRule[], [{ field: "activationRequirement", to: { kind: "none" } }]);
            expect(ids(toNothing)).toEqual(["AuthenticationContext_EndUser_Assignment"]);
        }
    });

    it("justification and ticket information toggle their entries", () => {
        const updates = buildRuleUpdates("pimGroups", groups, [
            { field: "requireJustificationOnActivation", to: false },
            { field: "requireTicketInfo", to: true },
        ]);
        expect(bodyOf(updates, "Enablement_EndUser_Assignment")?.enabledRules).toEqual(["Ticketing"]);
    });

    it("bug 4: approval keeps the stage values that were read", () => {
        const rules = groupRules({ approvers: [USER_APPROVER], approvalTimeoutDays: 2 }) as GraphRule[];
        const [u] = buildRuleUpdates("pimGroups", rules, [{ field: "approvers", to: [{ id: GROUP_APPROVER.id, type: "group", displayName: GROUP_APPROVER.name }] }]);
        const setting = u.body.setting as { approvalMode: string; approvalStages: Array<Record<string, unknown>> };
        expect(setting.approvalMode).toBe("SingleStage");
        expect(setting.approvalStages[0]).toMatchObject({ approvalStageTimeOutInDays: 2, primaryApprovers: [{ "@odata.type": "#microsoft.graph.groupMembers", groupId: GROUP_APPROVER.id }] });
    });

    it("approval off keeps one stage with no approvers and NoApproval", () => {
        const rules = roleRules({ approvers: [USER_APPROVER], approvalTimeoutDays: 2 }) as GraphRule[];
        const [u] = buildRuleUpdates("directoryRoles", rules, [{ field: "requireApproval", to: false }]);
        const setting = u.body.setting as { isApprovalRequired: boolean; approvalMode: string; approvalStages: Array<Record<string, unknown>> };
        expect(setting).toMatchObject({ isApprovalRequired: false, approvalMode: "NoApproval" });
        expect(setting.approvalStages).toHaveLength(1);
        expect(setting.approvalStages[0]).toMatchObject({ approvalStageTimeOutInDays: 2, primaryApprovers: [] });
    });

    it("approvers are written in the v1.0 shape (userId, groupId), existing ones too", () => {
        const rules = roleRules({ approvers: [USER_APPROVER] }) as GraphRule[];
        const [u] = buildRuleUpdates("directoryRoles", rules, [{ field: "approvers", to: [{ id: USER_APPROVER.id, type: "user", displayName: USER_APPROVER.name }, { id: GROUP_APPROVER.id, type: "group" }] }]);
        const approvers = (u.body.setting as { approvalStages: Array<{ primaryApprovers: unknown[] }> }).approvalStages[0].primaryApprovers;
        expect(approvers).toEqual([
            { "@odata.type": "#microsoft.graph.singleUser", userId: USER_APPROVER.id, description: USER_APPROVER.name },
            { "@odata.type": "#microsoft.graph.groupMembers", groupId: GROUP_APPROVER.id, description: "" },
        ]);
        expect(JSON.stringify(approvers)).not.toContain("isBackup");
    });

    it("custom extensions: link, unlink, never displayName, a pending pick writes nothing", () => {
        const link = buildRuleUpdates("pimGroups", groups, [{ field: "customExtensions.preApproval", to: { isEnabled: true, customExtensionId: "ext-1", displayName: "Ignored", customAttributes: ["A"] } }]);
        expect(link[0].body).toMatchObject({ id: "CustomExtension_PreApproval_EndUser_Assignment", isEnabled: true, customExtensionId: "ext-1", customAttributes: ["A"] });
        expect(link[0].body).not.toHaveProperty("displayName");
        const linked = groupRules({ postApprovalExtension: "ext-2" }) as GraphRule[];
        const unlink = buildRuleUpdates("pimGroups", linked, [{ field: "customExtensions.postApproval", to: { isEnabled: false, customExtensionId: "", customAttributes: [] } }]);
        expect(unlink[0].body).toMatchObject({ isEnabled: false, customExtensionId: "", customAttributes: [] });
        expect(buildRuleUpdates("pimGroups", groups, [{ field: "customExtensions.preApproval", to: { isEnabled: true, customExtensionId: "", customAttributes: [] } }])).toEqual([]);
    });

    it("eligible: permanence off keeps the stored maximum, a new end converts to days", () => {
        const [off] = buildRuleUpdates("directoryRoles", roles, [{ field: "allowPermanentEligible", to: false }]);
        expect(off.body).toMatchObject({ id: "Expiration_Admin_Eligibility", isExpirationRequired: true, maximumDuration: "P365D" });
        const [months] = buildRuleUpdates("pimGroups", groups, [{ field: "eligibleExpiration", to: "P3M" }]);
        expect(months.body).toMatchObject({ isExpirationRequired: true, maximumDuration: "P90D" });
    });

    it("bug 4: allowing permanence keeps the stored maximum", () => {
        const [on] = buildRuleUpdates("directoryRoles", roleRules({ activeMustEnd: "P180D" }) as GraphRule[], [{ field: "allowPermanentActive", to: true }]);
        expect(on.body).toMatchObject({ id: "Expiration_Admin_Assignment", isExpirationRequired: false, maximumDuration: "P180D" });
    });

    it("an end required where the rule stored PT0S falls back to one year", () => {
        const rules = roleRules().map((r) => (r.id === "Expiration_Admin_Eligibility" ? { ...r, maximumDuration: "PT0S" } : r)) as GraphRule[];
        const [u] = buildRuleUpdates("directoryRoles", rules, [{ field: "allowPermanentEligible", to: false }]);
        expect(u.body.maximumDuration).toBe("P365D");
    });

    it("active assignment MFA and justification", () => {
        const [u] = buildRuleUpdates("pimGroups", groups, [
            { field: "requireMfaOnActiveAssignment", to: true },
            { field: "requireJustificationOnActiveAssignment", to: false },
        ]);
        expect(u).toMatchObject({ ruleId: "Enablement_Admin_Assignment", body: { enabledRules: ["MultiFactorAuthentication"] } });
    });

    it("every notification cell maps to its own rule with the three properties", () => {
        for (const cell of NOTIFICATION_CELLS) {
            const base = `notifications.${cell.section}.${cell.recipient}` as const;
            const [u] = buildRuleUpdates("pimGroups", groups, [
                { field: `${base}.isEnabled`, to: false },
                { field: `${base}.additionalRecipients`, to: ["a@contoso.com", " b@contoso.com "] },
                { field: `${base}.criticalOnly`, to: true },
            ]);
            expect(u.ruleId).toBe(cell.ruleId);
            expect(u.body).toMatchObject({ notificationType: "Email", recipientType: cell.ruleId.split("_")[1], notificationLevel: "Critical", isDefaultRecipientsEnabled: false, notificationRecipients: ["a@contoso.com", "b@contoso.com"] });
        }
    });

    it("updates come in the order the rules were read", () => {
        const updates = buildRuleUpdates("pimGroups", groups, [{ field: "maxActivationDuration", to: "PT2H" }, { field: "notifications.eligibleAssignment.admin.criticalOnly", to: true }]);
        expect(ids(updates)).toEqual(["Notification_Admin_Admin_Eligibility", "Expiration_EndUser_Assignment"]);
    });

    it("every body carries its type and a write target, also for group rules without one", () => {
        const updates = buildRuleUpdates("pimGroups", groups, [{ field: "maxActivationDuration", to: "PT2H" }, { field: "notifications.eligibleAssignment.admin.criticalOnly", to: true }]);
        expect(bodyOf(updates, "Expiration_EndUser_Assignment")).toMatchObject({ "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule", target: createRuleTarget("EndUser", "Assignment") });
        expect(bodyOf(updates, "Notification_Admin_Admin_Eligibility")).toMatchObject({ "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule", target: createRuleTarget("Admin", "Eligibility") });
    });

    it("Enablement_Admin_Eligibility is never written", () => {
        const all = NOTIFICATION_CELLS.map((c) => ({ field: `notifications.${c.section}.${c.recipient}.criticalOnly` as const, to: true }));
        expect(ids(buildRuleUpdates("directoryRoles", roles, [...all, { field: "requireMfaOnActiveAssignment", to: true }]))).not.toContain("Enablement_Admin_Eligibility");
    });
});

describe("settingsToChanges", () => {
    it("an unchanged form gives no change, including durations stored as days", () => {
        for (const rules of [roleRules(), groupRules(), roleRules({ eligibleMustEnd: "P365D", approvers: [USER_APPROVER], requirement: { context: "c1" } })]) {
            const current = parseGraphPolicy({ rules });
            expect(settingsToChanges(current, structuredClone(current))).toEqual([]);
        }
    });

    it("one field edited gives one change", () => {
        const current = parseGraphPolicy({ rules: roleRules() });
        const edited = structuredClone(current);
        edited.activationRequirement = "authenticationContext";
        edited.authenticationContextId = "c3";
        expect(settingsToChanges(current, edited)).toEqual([{ field: "activationRequirement", to: { kind: "authenticationContext", contextId: "c3" } }]);
    });

    it("a context without an id is no context", () => {
        const current = parseGraphPolicy({ rules: roleRules() });
        const edited = { ...structuredClone(current), activationRequirement: "authenticationContext" as const, authenticationContextId: undefined };
        expect(settingsToChanges(current, edited)).toEqual([]);
    });

    it("a slot the form does not carry is left alone", () => {
        const current = parseGraphPolicy({ rules: roleRules({ preApprovalExtension: "ext-1" }) });
        const edited = { ...structuredClone(current), customExtensions: undefined };
        expect(settingsToChanges(current, edited)).toEqual([]);
    });

    it("a requestor's manager survives an approver edit", () => {
        const rules = roleRules().map((r) => r.id === "Approval_EndUser_Assignment"
            ? { ...r, setting: { ...(r.setting as object), isApprovalRequired: true, approvalStages: [{ approvalStageTimeOutInDays: 1, isApproverJustificationRequired: true, escalationTimeInMinutes: 0, isEscalationEnabled: false, primaryApprovers: [{ "@odata.type": "#microsoft.graph.requestorManager", isBackup: false, managerLevel: 1 }], escalationApprovers: [] }] } }
            : r) as GraphRule[];
        const current = parseGraphPolicy({ rules });
        expect(current.approvers).toEqual([expect.objectContaining({ type: "manager" })]);
        const edited = structuredClone(current);
        edited.approvers = [...(edited.approvers ?? []), { id: USER_APPROVER.id, type: "user", displayName: USER_APPROVER.name }];
        const [u] = buildRuleUpdates("directoryRoles", rules, settingsToChanges(current, edited));
        const approvers = (u.body.setting as { approvalStages: Array<{ primaryApprovers: unknown[] }> }).approvalStages[0].primaryApprovers;
        expect(approvers).toEqual([
            { "@odata.type": "#microsoft.graph.requestorManager", managerLevel: 1 },
            { "@odata.type": "#microsoft.graph.singleUser", userId: USER_APPROVER.id, description: USER_APPROVER.name },
        ]);
    });

    it("notification cells: only the property that differs becomes a change", () => {
        const current = parseGraphPolicy({ rules: groupRules() });
        const edited = structuredClone(current);
        edited.notifications.activeAssignment.assignee.additionalRecipients = "a@contoso.com; b@contoso.com";
        edited.notifications.activation.approver.criticalOnly = true;
        expect(settingsToChanges(current, edited)).toEqual([
            { field: "notifications.activeAssignment.assignee.additionalRecipients", to: ["a@contoso.com", "b@contoso.com"] },
            { field: "notifications.activation.approver.criticalOnly", to: true },
        ]);
    });

    it("an activation duration in an unknown form compares as text, never as the 8 hour default", () => {
        const rules = roleRules({ activationDuration: "P1D" });
        const current = parseGraphPolicy({ rules });
        expect(settingsToChanges(current, { ...structuredClone(current), maxActivationDuration: "PT8H" })).toEqual([{ field: "maxActivationDuration", to: "PT8H" }]);
        const half = parseGraphPolicy({ rules: roleRules({ activationDuration: "PT90M" }) });
        expect(settingsToChanges(half, { ...structuredClone(half), maxActivationDuration: "PT1H30M" })).toEqual([]);
    });
});

describe("buildRuleUpdates: edges", () => {
    it("a rule missing from the read is still written, from its id", () => {
        const rules = (roleRules({ withoutExtensionRules: true }) as GraphRule[]);
        const [u] = buildRuleUpdates("directoryRoles", rules, [{ field: "customExtensions.postApproval", to: { isEnabled: true, customExtensionId: "ext-1", customAttributes: [] } }]);
        expect(u.body).toMatchObject({ "@odata.type": "#microsoft.graph.unifiedRoleManagementPolicyCustomExtensionRule", id: "CustomExtension_PostApproval_EndUser_Assignment", target: createRuleTarget("EndUser", "Assignment") });
    });

    it("an active end required where PT0S was stored falls back to 180 days", () => {
        const rules = roleRules().map((r) => (r.id === "Expiration_Admin_Assignment" ? { ...r, maximumDuration: "PT0S" } : r)) as GraphRule[];
        const [u] = buildRuleUpdates("directoryRoles", rules, [{ field: "allowPermanentActive", to: false }]);
        expect(u.body.maximumDuration).toBe("P180D");
    });

    it("an active end changes to days", () => {
        const [u] = buildRuleUpdates("pimGroups", groupRules() as GraphRule[], [{ field: "activeExpiration", to: "P1M" }]);
        expect(u.body).toMatchObject({ id: "Expiration_Admin_Assignment", isExpirationRequired: true, maximumDuration: "P30D" });
    });
});

describe("applySettingChanges", () => {
    it("is the inverse of settingsToChanges: the edited form comes back from the current one and its changes", () => {
        const current = parseGraphPolicy({ rules: roleRules() });
        const edited = {
            ...current,
            maxActivationDuration: "PT2H",
            activationRequirement: "authenticationContext" as const,
            authenticationContextId: "c1",
            requireApproval: true,
            approvers: [{ id: "approver-user", type: "user" as const }],
            allowPermanentEligible: false,
            eligibleExpiration: "P90D",
            notifications: { ...current.notifications, activation: { ...current.notifications.activation, admin: { isEnabled: false, additionalRecipients: "a@contoso.com;b@contoso.com", criticalOnly: true } } },
        };
        const after = applySettingChanges(current, settingsToChanges(current, edited));
        expect(settingsToChanges(after, edited)).toEqual([]);
        expect(after).toMatchObject({ maxActivationDuration: "PT2H", activationRequirement: "authenticationContext", authenticationContextId: "c1", requireApproval: true, allowPermanentEligible: false, eligibleExpiration: "P90D" });
        expect(after.notifications.activation.admin).toEqual({ isEnabled: false, additionalRecipients: "a@contoso.com;b@contoso.com", criticalOnly: true });
        // The current settings are not changed
        expect(current.maxActivationDuration).not.toBe("PT2H");
    });

    it("leaving a context drops its id", () => {
        const current = { ...parseGraphPolicy({ rules: roleRules() }), activationRequirement: "authenticationContext" as const, authenticationContextId: "c1" };
        const after = applySettingChanges(current, [{ field: "activationRequirement", to: { kind: "mfa" } }]);
        expect(after.activationRequirement).toBe("mfa");
        expect(after.authenticationContextId).toBeUndefined();
    });
});

