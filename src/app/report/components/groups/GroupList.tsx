"use client";

import { StatusBox } from "@/components/ui/StatusBox";
import type { GroupListRow, ReportSort } from "@/utils/reportList";
import { ListFrame, ListRowButton } from "../ListFrame";

interface GroupListProps {
    rows: GroupListRow[];
    currentId: string | undefined;
    onSelect: (id: string) => void;
    sort: ReportSort;
    onSortChange: (sort: ReportSort) => void;
    /** Number of role-assignable groups when known: with none outside PIM the section says so (spec 7.8) */
    roleAssignableCount: number | null;
    /** Groups outside PIM before search and filter: the all-clear row only says so when there are none at all */
    outsideTotal: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Two sections with sticky headers, Outside PIM first (spec 2.4). */
export function GroupList({ rows, currentId, onSelect, sort, onSortChange, roleAssignableCount, outsideTotal }: GroupListProps) {
    const outside = rows.filter((r) => r.isOutsidePim);
    const under = rows.filter((r) => !r.isOutsidePim);
    const stopId = rows.some((r) => r.id === currentId) ? currentId : outside[0]?.id ?? under[0]?.id;
    return (
        <ListFrame label="Group" sort={sort} onSortChange={onSortChange}>
            <SectionTitle label={`Outside PIM (${outside.length})`} />
            {outsideTotal === 0 && roleAssignableCount !== null && roleAssignableCount > 0 ? (
                <div className="border-b border-line px-3 py-3"><StatusBox variant="success">{`All ${roleAssignableCount} role-assignable groups are under PIM.`}</StatusBox></div>
            ) : null}
            {outside.map((row) => (
                <ListRowButton key={row.id} isCurrent={row.id === currentId} isTabStop={row.id === stopId} onSelect={() => onSelect(row.id)}>
                    <span className="block text-[15px] leading-5 font-medium text-ink">{row.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] leading-[18px] text-muted">
                        <span>{plural(row.roleCount, "role", "roles")}</span>
                        {row.memberCount !== undefined && <span>{`${plural(row.memberCount, "member", "members")}, always on`}</span>}
                        <span className="text-danger-text">Outside PIM</span>
                    </span>
                </ListRowButton>
            ))}
            <SectionTitle label={`Under PIM (${under.length})`} />
            {under.map((row) => (
                <ListRowButton key={row.id} isCurrent={row.id === currentId} isTabStop={row.id === stopId} onSelect={() => onSelect(row.id)}>
                    <span className="block text-[15px] leading-5 font-medium text-ink">{row.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] leading-[18px] text-muted">
                        <span>{row.roleCount === 0 ? "No roles" : plural(row.roleCount, "role", "roles")}</span>
                        <span>{`${row.eligible} eligible, ${row.active} active`}</span>
                    </span>
                </ListRowButton>
            ))}
        </ListFrame>
    );
}

function SectionTitle({ label }: { label: string }) {
    return (
        <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-page px-3 py-2 text-xs font-semibold text-muted">
            {label}
        </h2>
    );
}
