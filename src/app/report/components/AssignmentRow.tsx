"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import { Tag } from "@/components/ui/Tag";
import { REPORT_TERMS, type ReportTermKey } from "@/config/help/reportTerms";
import { formatDate } from "@/utils/dateFormat";
import { buildMembershipRows, describeScopeTag, type AssignmentRowModel, type RowKind } from "@/utils/reportRows";
import { useMembershipHook } from "./MembershipContext";

const TYPE: Record<RowKind, { term: ReportTermKey }> = {
    user: { term: "user" },
    guest: { term: "guest" },
    app: { term: "app" },
    group: { term: "group" },
    agentIdentity: { term: "agentIdentity" },
    agentUser: { term: "agentUser" },
    agentBlueprint: { term: "agentBlueprint" },
};

/** The tags of one row in the order of spec 3.2: Type, How, Scope, End, Origin, Emergency; groups add the relation and Always on. Only the Emergency access marker has an icon: the other tags say it in words (icons only where they carry meaning). */
function RowTags({ row }: { row: AssignmentRowModel }) {
    const type = TYPE[row.kind];
    const scope = row.scope ? describeScopeTag(row.scope) : null;
    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-start">
            <Tag tip={REPORT_TERMS[type.term].text}>{REPORT_TERMS[type.term].label}</Tag>
            {row.relation && <Tag tip={REPORT_TERMS[row.relation].text}>{REPORT_TERMS[row.relation].label}</Tag>}
            {row.how.type === "direct" ? (
                !row.relation && <Tag tip={REPORT_TERMS.direct.text}>Direct</Tag>
            ) : (
                <Tag variant="accent" tip={row.isViaGroupUnnamed ? REPORT_TERMS.viaGroupUnnamed.text : REPORT_TERMS.viaGroup.text}>
                    {row.how.groupName ? `Via group: ${row.how.groupName}` : "Via group"}
                </Tag>
            )}
            {scope && <Tag tip={scope.term ? REPORT_TERMS[scope.term].text : scope.tip}>{scope.label}</Tag>}
            {row.isAlwaysOn ? (
                <Tag variant="warn" tip={REPORT_TERMS.alwaysOn.text}>Always on</Tag>
            ) : row.end.type === "expires" ? (
                <Tag tip={REPORT_TERMS.expires.text}>{`Expires ${formatDate(row.end.date)}`}</Tag>
            ) : row.end.type === "permanent" ? (
                <Tag variant="warn" tip={REPORT_TERMS.permanent.text}>Permanent</Tag>
            ) : (
                <Tag tip={REPORT_TERMS.noEndDate.text}>No end date</Tag>
            )}
            {row.origin === "activated" && <Tag tip={REPORT_TERMS.activated.text}>Activated</Tag>}
            {row.origin === "assigned" && <Tag tip={REPORT_TERMS.assigned.text}>Assigned</Tag>}
            {row.isEmergency && <Tag icon="emergency-access" variant="band" tip={REPORT_TERMS.emergency.text}>Emergency access</Tag>}
        </div>
    );
}

interface AssignmentRowProps {
    row: AssignmentRowModel;
    /** The filter has an assignment key: rows that match get an accent edge, the others muted text (spec 6.3) */
    isMarking: boolean;
    emergencyAccountIds: ReadonlySet<string>;
    /** Nested rows are indented and lighter */
    depth?: number;
}

/** One assignment: name and second line left, tags right, member rows under a group row (spec 3.2). */
export function AssignmentRow({ row, isMarking, emergencyAccountIds, depth = 0 }: AssignmentRowProps) {
    const marked = isMarking && row.isMarked;
    const dimmed = isMarking && !row.isMarked;
    return (
        <li className={depth > 0 ? "ml-4" : ""}>
            <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-line bg-surface px-3 py-2.5 ${marked ? "border-l-2 border-l-accent" : ""}`}>
                <div className={`min-w-0 ${dimmed ? "text-muted" : ""}`}>
                    <p className={`truncate text-sm leading-5 font-medium ${dimmed ? "text-muted" : "text-ink"}`}>{row.name}</p>
                    {row.secondary && <p className="truncate text-xs leading-4 text-muted">{row.secondary}</p>}
                </div>
                <RowTags row={row} />
            </div>
            {(row.children.length > 0 || row.isOutsidePim) && (
                <ul className="mt-1.5 flex flex-col gap-1.5">
                    {row.children.map((child) => (
                        <AssignmentRow key={child.key} row={child} depth={depth + 1} isMarking={isMarking} emergencyAccountIds={emergencyAccountIds} />
                    ))}
                    {row.isOutsidePim && row.groupId && <OutsideGroupMembers row={row} emergencyAccountIds={emergencyAccountIds} />}
                </ul>
            )}
        </li>
    );
}

/** "Show {n} members" of a group outside PIM: read on demand, three skeleton rows while it reads, an inline error with Try again (spec 3.2 and 5.3). */
function OutsideGroupMembers({ row, emergencyAccountIds }: { row: AssignmentRowModel; emergencyAccountIds: ReadonlySet<string> }) {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <li className="ml-4">
            {!isOpen ? (
                <Button size="sm" onClick={() => setIsOpen(true)}>
                    {row.memberCount === undefined ? "Show members" : `Show ${row.memberCount} ${row.memberCount === 1 ? "member" : "members"}`}
                </Button>
            ) : (
                <OutsideGroupMemberRows row={row} emergencyAccountIds={emergencyAccountIds} />
            )}
        </li>
    );
}

const MEMBER_ROWS_SHOWN = 200;

function OutsideGroupMemberRows({ row, emergencyAccountIds }: { row: AssignmentRowModel; emergencyAccountIds: ReadonlySet<string> }) {
    const useMembership = useMembershipHook();
    const state = useMembership(row.groupId);
    const [showAll, setShowAll] = useState(false);

    if (state.status === "loading" || state.status === "idle") {
        return <div className="flex flex-col gap-1.5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={52} />)}</div>;
    }
    if (state.status === "error") {
        return (
            <StatusBox variant="error" title="Members could not be read" action={<Button size="sm" onClick={state.retry}>Try again</Button>}>
                {state.error}
            </StatusBox>
        );
    }
    const rows = buildMembershipRows({ members: state.members, owners: state.owners }, { emergencyAccountIds, groupId: row.groupId ?? "", groupName: row.name, isViaGroup: true });
    const shown = showAll ? rows : rows.slice(0, MEMBER_ROWS_SHOWN);
    return (
        <ul className="flex flex-col gap-1.5">
            {shown.map((member) => <AssignmentRow key={member.key} row={member} depth={0} isMarking={false} emergencyAccountIds={emergencyAccountIds} />)}
            {rows.length === 0 && <li className="ml-4 text-[13px] text-muted">This group has no members.</li>}
            {rows.length > shown.length && (
                <li className="ml-4"><Button size="sm" onClick={() => setShowAll(true)}>{`Show all ${rows.length}`}</Button></li>
            )}
        </ul>
    );
}
