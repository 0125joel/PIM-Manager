import { GroupPolicyRule } from "@/types/pimGroup.types";

interface GroupNotificationTabProps {
    rules: GroupPolicyRule[];
}

export function GroupNotificationTab({ rules }: GroupNotificationTabProps) {
    // Get notification rules
    const notificationRules = rules.filter((r) =>
        r["@odata.type"]?.includes("NotificationRule")
    );

    // Need approval rule to check for custom conditional logic
    const activationApproval = rules.find((r) =>
        r["@odata.type"]?.includes("ApprovalRule") &&
        r.target?.caller === "EndUser" &&
        r.target?.level === "Assignment"
    );

    // Helper to render notification row
    const RenderNotifRow = ({ label, recipientType, caller, level }: { label: string, recipientType: string, caller: string, level: string }) => {
        const rule = notificationRules.find((r) =>
            r.target?.caller === caller &&
            r.target?.level === level &&
            r.recipientType === recipientType
        );
        const isDefault = rule?.isDefaultRecipientsEnabled ?? false;
        const additional = rule?.notificationRecipients?.join("; ") || "-";
        const isCritical = rule?.notificationLevel === "Critical";

        // Check specific condition: Activation Approval Required & Approver Notification
        const isApproverRow = recipientType === "Approver";
        const isActivationNotification = caller === "EndUser" && level === "Assignment";
        const approvalRequired = activationApproval?.setting?.isApprovalRequired ?? false;
        const shouldDisableApprover = isApproverRow && isActivationNotification && approvalRequired;

        return (
            <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">{label}</td>
                <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 ${isDefault ? "text-blue-600" : "text-zinc-400"}`}>
                        {isDefault ? "✓" : "✗"} {recipientType === "Requestor" ? "Assignee" : recipientType}
                    </span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500 break-all">
                    {shouldDisableApprover ? (
                        <span className="italic text-zinc-400">Only designated approvers can receive this email</span>
                    ) : (
                        additional
                    )}
                </td>
                <td className="px-3 py-2 text-center text-xs text-zinc-500">
                    {isCritical ? "Yes" : "No"}
                </td>
            </tr>
        );
    };

    const NotificationTable = ({ title, caller, level }: { title: string, caller: string, level: string }) => (
        <div>
            <h4 className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2 uppercase tracking-wider">{title}</h4>
            <div className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-xs text-left">
                    <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase">
                        <tr>
                            <th className="px-3 py-2 font-medium w-[40%]">Type</th>
                            <th className="px-3 py-2 font-medium w-[20%]">Default</th>
                            <th className="px-3 py-2 font-medium w-[28%]">Additional</th>
                            <th className="px-3 py-2 font-medium w-[12%] text-center">Critical</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                        <RenderNotifRow
                            label="Role assignment alert"
                            recipientType="Admin"
                            caller={caller}
                            level={level}
                        />
                        <RenderNotifRow
                            label={caller === "EndUser" ? "Notification to activated user" : "Notification to the assigned user (assignee)"}
                            recipientType="Requestor"
                            caller={caller}
                            level={level}
                        />
                        <RenderNotifRow
                            label={caller === "EndUser" ? "Request to approve an activation" : "Request to approve a role assignment renewal/extension"}
                            recipientType="Approver"
                            caller={caller}
                            level={level}
                        />
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="space-y-6 text-sm">
            <NotificationTable
                title="Send notifications when members are assigned as eligible to this role"
                caller="Admin"
                level="Eligibility"
            />

            <NotificationTable
                title="Send notifications when members are assigned as active to this role"
                caller="Admin"
                level="Assignment"
            />

            <NotificationTable
                title="Send notifications when eligible members activate this role"
                caller="EndUser"
                level="Assignment"
            />
        </div>
    );
}
