"use client";

import { Tag } from "@/components/ui/Tag";
import type { ReportSort, RoleListRow } from "@/utils/reportList";
import { ListFrame, ListRowButton } from "../ListFrame";

interface RoleListProps {
    rows: RoleListRow[];
    currentId: string | undefined;
    onSelect: (id: string) => void;
    sort: ReportSort;
    onSortChange: (sort: ReportSort) => void;
}

/** The roles of the Report (spec 2.4): name with Privileged or Custom, "{e} eligible, {a} active", and only the two red signals. */
export function RoleList({ rows, currentId, onSelect, sort, onSortChange }: RoleListProps) {
    const stopId = rows.some((r) => r.id === currentId) ? currentId : rows[0]?.id;
    return (
        <ListFrame label="Role" sort={sort} onSortChange={onSortChange}>
            {rows.map((row) => (
                <ListRowButton key={row.id} isCurrent={row.id === currentId} isTabStop={row.id === stopId} onSelect={() => onSelect(row.id)}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[15px] leading-5 font-medium text-ink">{row.name}</span>
                        {row.isPrivileged && <Tag variant="warn">Privileged</Tag>}
                        {row.isCustom && <Tag className="border-dashed">Custom</Tag>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] leading-[18px] text-muted">
                        <span>{`${row.eligible} eligible, ${row.active} active`}</span>
                        {row.isPolicyFailed && <span>Not loaded</span>}
                        {row.hasNoMfaSignal === true && <span className="text-danger-text">No MFA on activation</span>}
                        {row.hasPermanentActive && <span className="text-danger-text">Permanent active</span>}
                    </span>
                </ListRowButton>
            ))}
        </ListFrame>
    );
}
