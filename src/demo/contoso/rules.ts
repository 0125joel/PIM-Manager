import type { DemoRule } from "./model";

/**
 * The rule set of a PIM policy as Graph returns it (`policy($expand=rules)`): 17 rules plus the two custom extension
 * slots of the preview. Role rules carry a `target`; group rules come without one (lessons-learned, Report run
 * 2026-10-02), which the app completes from the rule id.
 */

const T = "#microsoft.graph.unifiedRoleManagementPolicy";

export type DemoApprover =
    | { kind: "user"; id: string; name: string }
    | { kind: "group"; id: string; name: string }
    | { kind: "manager" };

export interface PolicyOptions {
    /** Maximum activation duration, ISO 8601 (default PT8H) */
    activationDuration?: string;
    /** "mfa" (default), "none", or an authentication context claim value such as "c1" */
    activationRequirement?: "mfa" | "none" | { authenticationContext: string };
    justification?: boolean;
    ticket?: boolean;
    approvers?: DemoApprover[];
    extensionBeforeApproval?: string;
    extensionAfterApproval?: string;
    /** Eligible assignments must end, after this duration (default: may be permanent) */
    eligibleMustEnd?: string;
    /** Active assignments may be permanent (default: they must end after P180D) */
    activeMayBePermanent?: boolean;
    activeMaximum?: string;
    /** Require MFA and a justification on active assignment (default both) */
    activeAssignmentMfa?: boolean;
    /** The "notify admins on activation" rule: default recipients off and these extra recipients */
    activationAdminNotification?: { defaultRecipients: boolean; extraRecipients: string[] };
    /** Critical-only e-mails for the requestor on activation */
    requestorCriticalOnly?: boolean;
    /** Extra recipients of "notify on eligible assignment" */
    eligibleAssignmentRecipients?: string[];
}

function approverShape(approver: DemoApprover): Record<string, unknown> {
    if (approver.kind === "manager") return { "@odata.type": "#microsoft.graph.requestorManager", isBackup: false, managerLevel: 1 };
    if (approver.kind === "user") return { "@odata.type": "#microsoft.graph.singleUser", isBackup: false, userId: approver.id, description: approver.name };
    return { "@odata.type": "#microsoft.graph.groupMembers", isBackup: false, groupId: approver.id, description: approver.name };
}

export function buildPolicyRules(o: PolicyOptions, withTarget: boolean): DemoRule[] {
    const target = (caller: string, level: string) => (withTarget
        ? { target: { caller, operations: ["all"], level, inheritableSettings: [], enforcedSettings: [] } }
        : {});
    const rule = (id: string, type: string, caller: string, level: string, extra: Record<string, unknown>): DemoRule => ({
        "@odata.type": `${T}${type}Rule`,
        id,
        ...extra,
        ...target(caller, level),
    });
    const notification = (recipient: "Admin" | "Requestor" | "Approver", caller: string, level: string, extra: Record<string, unknown> = {}) =>
        rule(`Notification_${recipient}_${caller}_${level}`, "Notification", caller, level, {
            notificationType: "Email",
            recipientType: recipient,
            notificationLevel: "All",
            isDefaultRecipientsEnabled: true,
            notificationRecipients: [],
            ...extra,
        });
    const extension = (slot: "PreApproval" | "PostApproval", extensionId: string | undefined) =>
        rule(`CustomExtension_${slot}_EndUser_Assignment`, "CustomExtension", "EndUser", "Assignment", extensionId
            ? { isEnabled: true, customExtensionId: extensionId, customAttributes: [] }
            : { isEnabled: false, customExtensionId: "", customAttributes: [] });

    const requirement = o.activationRequirement ?? "mfa";
    const authContext = typeof requirement === "object" ? requirement.authenticationContext : null;
    const approvers = (o.approvers ?? []).map(approverShape);
    const activeMfa = o.activeAssignmentMfa ?? true;
    const adminNotice = o.activationAdminNotification;

    return [
        rule("Expiration_Admin_Eligibility", "Expiration", "Admin", "Eligibility", { isExpirationRequired: !!o.eligibleMustEnd, maximumDuration: o.eligibleMustEnd ?? "P365D" }),
        rule("Enablement_Admin_Eligibility", "Enablement", "Admin", "Eligibility", { enabledRules: [] }),
        notification("Admin", "Admin", "Eligibility"),
        notification("Requestor", "Admin", "Eligibility", o.eligibleAssignmentRecipients ? { notificationRecipients: o.eligibleAssignmentRecipients } : {}),
        notification("Approver", "Admin", "Eligibility"),
        rule("Expiration_Admin_Assignment", "Expiration", "Admin", "Assignment", { isExpirationRequired: !o.activeMayBePermanent, maximumDuration: o.activeMaximum ?? "P180D" }),
        rule("Enablement_Admin_Assignment", "Enablement", "Admin", "Assignment", { enabledRules: activeMfa ? ["MultiFactorAuthentication", "Justification"] : ["Justification"] }),
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
                    approvalStageTimeOutInDays: 1,
                    isApproverJustificationRequired: true,
                    escalationTimeInMinutes: 0,
                    isEscalationEnabled: false,
                    primaryApprovers: approvers,
                    escalationApprovers: [],
                }],
            },
        }),
        rule("AuthenticationContext_EndUser_Assignment", "AuthenticationContext", "EndUser", "Assignment", authContext ? { isEnabled: true, claimValue: authContext } : { isEnabled: false, claimValue: null }),
        rule("Enablement_EndUser_Assignment", "Enablement", "EndUser", "Assignment", {
            enabledRules: [
                ...(requirement === "mfa" ? ["MultiFactorAuthentication"] : []),
                ...(o.justification === false ? [] : ["Justification"]),
                ...(o.ticket ? ["Ticketing"] : []),
            ],
        }),
        rule("Expiration_EndUser_Assignment", "Expiration", "EndUser", "Assignment", { isExpirationRequired: true, maximumDuration: o.activationDuration ?? "PT8H" }),
        notification("Admin", "EndUser", "Assignment", adminNotice ? { isDefaultRecipientsEnabled: adminNotice.defaultRecipients, notificationRecipients: adminNotice.extraRecipients } : {}),
        notification("Requestor", "EndUser", "Assignment", o.requestorCriticalOnly ? { notificationLevel: "Critical" } : {}),
        notification("Approver", "EndUser", "Assignment"),
        extension("PreApproval", o.extensionBeforeApproval),
        extension("PostApproval", o.extensionAfterApproval),
    ];
}
