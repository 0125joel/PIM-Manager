/**
 * Policy rule fixtures for the write-path golden tests (NG-53). Frozen shapes, independent of the demo tenant, so a change
 * to Contoso never moves a golden snapshot.
 *
 * Shapes follow what Graph returns for `roleManagementPolicyAssignments?$expand=policy($expand=rules)`:
 * - role rules carry a `target` with lower-case `operations` (as a GET answers; a write needs "All", lessons-learned);
 * - group rules come without a `target` (Report run lessons, tenant test T6);
 * - the base rule set is the one 119 of 145 roles share in the devprins backup (tenant test T5): activation PT8H with an
 *   end, justification, no MFA, no approval, no context; eligible and active permanent allowed (P365D, P180D); all nine
 *   notifications on for the default recipients; plus the two custom extension slots, unlinked.
 * - the group base follows T6: a group's starting rules equal the role rules, except that permanent assignment is not
 *   allowed (eligible P365D, active P180D, both with an end).
 */

export type FixtureRule = Record<string, unknown> & { "@odata.type": string; id: string };

const T = "#microsoft.graph.unifiedRoleManagementPolicy";

export interface FixtureApprover {
    kind: "user" | "group";
    id: string;
    name: string;
}

export interface FixtureOptions {
    activationDuration?: string;
    /** "none" (default), "mfa", or a context claim value */
    requirement?: "none" | "mfa" | { context: string };
    justification?: boolean;
    ticket?: boolean;
    approvers?: FixtureApprover[];
    approvalTimeoutDays?: number;
    eligibleMustEnd?: string;
    activeMustEnd?: string;
    activeMfa?: boolean;
    activeJustification?: boolean;
    preApprovalExtension?: string;
    postApprovalExtension?: string;
    /** Extra recipients on every notification rule */
    recipients?: string[];
    /** Leave out the two custom extension rules (a tenant without the preview) */
    withoutExtensionRules?: boolean;
}

function approverShape(approver: FixtureApprover): Record<string, unknown> {
    return approver.kind === "user"
        ? { "@odata.type": "#microsoft.graph.singleUser", isBackup: false, userId: approver.id, description: approver.name }
        : { "@odata.type": "#microsoft.graph.groupMembers", isBackup: false, groupId: approver.id, description: approver.name };
}

export function buildFixtureRules(o: FixtureOptions, withTarget: boolean): FixtureRule[] {
    const target = (caller: string, level: string) => (withTarget
        ? { target: { caller, operations: ["all"], level, inheritableSettings: [], enforcedSettings: [] } }
        : {});
    const rule = (id: string, type: string, caller: string, level: string, extra: Record<string, unknown>): FixtureRule => ({
        "@odata.type": `${T}${type}Rule`,
        id,
        ...extra,
        ...target(caller, level),
    });
    const notification = (recipient: "Admin" | "Requestor" | "Approver", caller: string, level: string) =>
        rule(`Notification_${recipient}_${caller}_${level}`, "Notification", caller, level, {
            notificationType: "Email",
            recipientType: recipient,
            notificationLevel: "All",
            isDefaultRecipientsEnabled: true,
            notificationRecipients: o.recipients ? [...o.recipients] : [],
        });
    const extension = (slot: "PreApproval" | "PostApproval", extensionId: string | undefined) =>
        rule(`CustomExtension_${slot}_EndUser_Assignment`, "CustomExtension", "EndUser", "Assignment", extensionId
            ? { isEnabled: true, customExtensionId: extensionId, displayName: `Extension ${extensionId}`, customAttributes: ["TicketNumber"] }
            : { isEnabled: false, customExtensionId: "", displayName: null, customAttributes: [] });

    const requirement = o.requirement ?? "none";
    const context = typeof requirement === "object" ? requirement.context : null;
    const approvers = (o.approvers ?? []).map(approverShape);
    const activeEnablement = [
        ...(o.activeMfa ? ["MultiFactorAuthentication"] : []),
        ...(o.activeJustification === false ? [] : ["Justification"]),
    ];

    const rules: FixtureRule[] = [
        rule("Expiration_Admin_Eligibility", "Expiration", "Admin", "Eligibility", { isExpirationRequired: !!o.eligibleMustEnd, maximumDuration: o.eligibleMustEnd ?? "P365D" }),
        rule("Enablement_Admin_Eligibility", "Enablement", "Admin", "Eligibility", { enabledRules: [] }),
        notification("Admin", "Admin", "Eligibility"),
        notification("Requestor", "Admin", "Eligibility"),
        notification("Approver", "Admin", "Eligibility"),
        rule("Expiration_Admin_Assignment", "Expiration", "Admin", "Assignment", { isExpirationRequired: !!o.activeMustEnd, maximumDuration: o.activeMustEnd ?? "P180D" }),
        rule("Enablement_Admin_Assignment", "Enablement", "Admin", "Assignment", { enabledRules: activeEnablement }),
        notification("Admin", "Admin", "Assignment"),
        notification("Requestor", "Admin", "Assignment"),
        notification("Approver", "Admin", "Assignment"),
        rule("Approval_EndUser_Assignment", "Approval", "EndUser", "Assignment", {
            setting: {
                isApprovalRequired: approvers.length > 0,
                isApprovalRequiredForExtension: false,
                isRequestorJustificationRequired: true,
                approvalMode: "SingleStage",
                approvalStages: [{
                    approvalStageTimeOutInDays: o.approvalTimeoutDays ?? 1,
                    isApproverJustificationRequired: true,
                    escalationTimeInMinutes: 0,
                    isEscalationEnabled: false,
                    primaryApprovers: approvers,
                    escalationApprovers: [],
                }],
            },
        }),
        rule("AuthenticationContext_EndUser_Assignment", "AuthenticationContext", "EndUser", "Assignment", context ? { isEnabled: true, claimValue: context } : { isEnabled: false, claimValue: null }),
        rule("Enablement_EndUser_Assignment", "Enablement", "EndUser", "Assignment", {
            enabledRules: [
                ...(requirement === "mfa" ? ["MultiFactorAuthentication"] : []),
                ...(o.justification === false ? [] : ["Justification"]),
                ...(o.ticket ? ["Ticketing"] : []),
            ],
        }),
        rule("Expiration_EndUser_Assignment", "Expiration", "EndUser", "Assignment", { isExpirationRequired: true, maximumDuration: o.activationDuration ?? "PT8H" }),
        notification("Admin", "EndUser", "Assignment"),
        notification("Requestor", "EndUser", "Assignment"),
        notification("Approver", "EndUser", "Assignment"),
    ];
    if (!o.withoutExtensionRules) {
        rules.push(extension("PreApproval", o.preApprovalExtension), extension("PostApproval", o.postApprovalExtension));
    }
    return rules;
}

export const ROLE_ID = "29232cdf-9323-42fd-ade2-1d097af3e4de";
export const ROLE_POLICY_ID = "DirectoryRole_tenant_29232cdf";
export const GROUP_ID = "6f2c9a1e-4b7d-4e2a-9c1f-3a8d5e7b9c20";
export const GROUP_POLICY_ID = "Group_6f2c9a1e_member";

export const USER_APPROVER: FixtureApprover = { kind: "user", id: "1e1771df-7c2a-4d3b-9b8e-0a1b2c3d4e5f", name: "Megan Bowen" };
export const GROUP_APPROVER: FixtureApprover = { kind: "group", id: "8c4d2b1a-3e5f-4a6b-9c7d-1e2f3a4b5c6d", name: "PIM Approvers" };
export const OTHER_USER_APPROVER: FixtureApprover = { kind: "user", id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Nestor Wilke" };

/** Role rules with targets, as `policy($expand=rules)` answers for a directory role */
export function roleRules(o: FixtureOptions = {}): FixtureRule[] {
    return buildFixtureRules(o, true);
}

/** Group rules without targets; a group starts with both expirations required (T6) */
export function groupRules(o: FixtureOptions = {}): FixtureRule[] {
    return buildFixtureRules({ eligibleMustEnd: "P365D", activeMustEnd: "P180D", ...o }, false);
}
