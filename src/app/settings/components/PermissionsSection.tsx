"use client";

import type { CSSProperties } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import type { PermissionRow } from "@/hooks/useWorkloadPermissions";
import { cellLabel, type CellStatus } from "@/utils/permissionStatus";
import type { PermissionsProps } from "./settingsTypes";
import { SettingsSection } from "./SettingsSection";

const CELL_ICON: Partial<Record<CellStatus, { icon: IconName; accent?: string }>> = {
    granted: { icon: "success", accent: "var(--success-text)" },
    notGranted: { icon: "key" },
    needsLicence: { icon: "lock" },
    unknown: { icon: "alert" },
};

/** Status is icon plus text, never colour alone; "Read only" is plain text. */
function Cell({ status }: { status: CellStatus }) {
    if (status === "checking") {
        return (
            <span className="inline-flex items-center">
                <Skeleton width={72} height={14} />
                <span className="sr-only">Checking</span>
            </span>
        );
    }
    const icon = CELL_ICON[status];
    return (
        <span className={`inline-flex items-center gap-1.5 text-[13px] leading-[18px] ${status === "readOnly" ? "text-muted" : "text-ink"}`} style={icon?.accent ? ({ "--pim-icon-accent": icon.accent } as CSSProperties) : undefined}>
            {icon && <Icon name={icon.icon} size={16} />}
            {cellLabel(status)}
        </span>
    );
}

function actionLabel(row: PermissionRow): string | null {
    if (row.action === "grantRead") return "Grant read access";
    if (row.action === "grantWrite") return "Grant write access";
    if (row.action === "retry") return "Check again";
    return null;
}

export function PermissionsSection({ rows, busyRow, message, onAction, onDismissMessage }: PermissionsProps) {
    return (
        <SettingsSection
            id="permissions"
            title="Workloads and permissions"
            subline="What PIM Manager may read and change in this tenant. Microsoft asks for each permission once. Whether a workload counts on a page is set with the chips on that page."
        >
            <table className="w-full border-collapse text-left max-sm:block">
                <thead className="max-sm:sr-only">
                    <tr className="text-xs text-muted">
                        <th scope="col" className="w-[28%] pb-2 pr-4 font-normal">Workload</th>
                        <th scope="col" className="w-[30%] pb-2 pr-4 font-normal">Read</th>
                        <th scope="col" className="pb-2 pr-4 font-normal">Write</th>
                        <th scope="col" className="pb-2 text-right font-normal"><span className="sr-only">Action</span></th>
                    </tr>
                </thead>
                <tbody className="max-sm:block">
                    {rows.map((row) => {
                        const label = actionLabel(row);
                        const isBusy = busyRow === row.id;
                        return (
                            <tr key={row.id} className="border-t border-line max-sm:mb-3 max-sm:block max-sm:rounded-lg max-sm:border max-sm:p-3">
                                <th scope="row" className="py-3 pr-4 text-[13px] leading-[18px] font-semibold text-ink max-sm:block max-sm:py-0 max-sm:pb-2">{row.label}</th>
                                <td className="py-3 pr-4 max-sm:block max-sm:py-1">
                                    <span className="mr-2 text-xs text-muted sm:hidden">Read</span>
                                    <Cell status={row.read} />
                                </td>
                                <td className="py-3 pr-4 max-sm:block max-sm:py-1">
                                    <span className="mr-2 text-xs text-muted sm:hidden">Write</span>
                                    <Cell status={row.write} />
                                </td>
                                <td className="py-2 text-right max-sm:block max-sm:pt-2 max-sm:text-left">
                                    {label && (
                                        <Button size="sm" isLoading={isBusy} disabled={busyRow !== null} onClick={() => onAction(row)}>
                                            {label}
                                            <span className="sr-only"> for {row.label}</span>
                                        </Button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div role="status" className="mt-3">
                {message?.kind === "success" && <p className="text-[13px] text-success-text">{message.text}</p>}
            </div>
            {message?.kind === "error" && (
                <StatusBox variant="error" title="Permission not granted" onDismiss={onDismissMessage} className="mt-3">
                    {message.text}
                </StatusBox>
            )}
        </SettingsSection>
    );
}
