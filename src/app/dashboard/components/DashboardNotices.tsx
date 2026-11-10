"use client";

import { DataWarningBanner } from "@/components/DataWarningBanner";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";

interface DashboardNoticesProps {
    /** Roles whose settings failed to load */
    failedCount: number;
    roleCount: number;
    groupCount: number;
    /** Roles and groups whose settings this account cannot read */
    notReadableRoleCount: number;
    notReadableGroupCount: number;
    onRefresh: () => void;
}

/** The warning banner and the note on unreadable settings under the dashboard head, in one wrapper only when one shows (its own visual section) */
export function DashboardNotices({ failedCount, roleCount, groupCount, notReadableRoleCount, notReadableGroupCount, onRefresh }: DashboardNoticesProps) {
    const isNotReadable = notReadableRoleCount + notReadableGroupCount > 0;
    if (failedCount === 0 && !isNotReadable) return null;
    return (
        <div data-visual-section="dashboard-notices" className="flex flex-col gap-4">
            <DataWarningBanner failedCount={failedCount} totalCount={roleCount} onRefresh={onRefresh} className="" />
            {isNotReadable && (
                <p role="note" className="text-[13px] leading-5 text-body">
                    {[notReadableRoleCount > 0 && `${notReadableRoleCount} of ${roleCount} roles`, notReadableGroupCount > 0 && `${notReadableGroupCount} of ${groupCount} groups`].filter(Boolean).join(" and ")}
                    {": "}{POLICY_NOT_READABLE}
                </p>
            )}
        </div>
    );
}
