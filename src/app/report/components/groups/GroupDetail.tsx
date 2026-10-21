"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBox } from "@/components/ui/StatusBox";
import { Tag } from "@/components/ui/Tag";
import { REPORT_TERMS } from "@/config/help/reportTerms";
import type { AuthenticationContext } from "@/types/shared.types";
import type { GroupPimPolicy, PimGroupData } from "@/types/pimGroup.types";
import { formatDate } from "@/utils/dateFormat";
import { getEntraGroupUrl, type RoleHeldByGroup } from "@/utils/groupsOutsidePim";
import { buildPolicyView, type PolicyTabId, type PolicyViewContext } from "@/utils/policyView";
import { buildGroupAssignmentRows, buildMembershipRows, buildRolesHeldRows, describeScopeTag, type RowContext } from "@/utils/reportRows";
import { AssignmentRow } from "../AssignmentRow";
import { ConfigTabs } from "../ConfigTabs";
import { ChangeInConfigureLink } from "@/components/ui/ChangeInConfigureLink";
import { CopyLinkButton } from "../CopyLinkButton";
import { useMembershipHook } from "../MembershipContext";

type Relation = "member" | "owner";

interface GroupDetailProps {
    data: PimGroupData;
    held: readonly RoleHeldByGroup[];
    rowContext: Pick<RowContext, "emergencyAccountIds" | "marking" | "nameById" | "blueprintNames">;
    authenticationContexts: readonly AuthenticationContext[];
    customExtensions: PolicyViewContext["customExtensions"];
    relation: Relation;
    onRelationChange: (relation: Relation) => void;
    tab: PolicyTabId;
    onTabChange: (tab: PolicyTabId) => void;
    isHiddenByFilter: boolean;
    getShareUrl: () => string;
    /** A link on a held role: the roles view with that role selected, `q` and `f` kept */
    onOpenRole: (roleId: string) => void;
    /** "Change in Configure" (spec 16): the link when the admin may change this group, else none */
    changeHref?: string | null;
}

const GROUP_TYPE_LABEL: Record<string, string> = { security: "Security", m365: "Microsoft 365", mailEnabled: "Mail-enabled" };
const MEMBER_ROWS_SHOWN = 200;

/** A group, outside PIM (a warning, roles held, members read on demand) or under PIM (roles held, assignments, Member and Owner settings), spec 4. */
export function GroupDetail({ data, held, rowContext, authenticationContexts, customExtensions, relation, onRelationChange, tab, onTabChange, isHiddenByFilter, getShareUrl, onOpenRole, changeHref }: GroupDetailProps) {
    const isOutside = data.isManaged === false;
    const typeLabel = GROUP_TYPE_LABEL[data.group.groupType];
    const heldRows = useMemo(() => buildRolesHeldRows(held), [held]);

    return (
        <article className="overflow-hidden rounded border border-line bg-surface">
            <div className="flex flex-col gap-6 p-5 sm:p-6">
                <header>
                    {isHiddenByFilter && <p className="mb-2 text-xs text-muted">Hidden by the current filter</p>}
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl leading-7 font-semibold text-ink">
                                {data.group.displayName}
                                {isOutside ? <Tag variant="danger" tip={REPORT_TERMS.outsidePim.text}>Outside PIM</Tag> : <Tag tip={REPORT_TERMS.underPim.text}>Under PIM</Tag>}
                            </h2>
                            {data.group.description && <p title={data.group.description} className="mt-1.5 line-clamp-2 max-w-[70ch] text-[13px] leading-[18px] text-body">{data.group.description}</p>}
                            {(typeLabel || data.group.isAssignableToRole === true) && (
                                <p className="mt-2 flex flex-wrap gap-1.5">
                                    {typeLabel && <Tag>{typeLabel}</Tag>}
                                    {data.group.isAssignableToRole === true && <Tag>Role-assignable</Tag>}
                                </p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 max-sm:flex-col-reverse max-sm:items-end">
                            {changeHref && <ChangeInConfigureLink href={changeHref} name={data.group.displayName} />}
                            <CopyLinkButton getUrl={getShareUrl} />
                        </div>
                    </div>
                </header>

                {isOutside && (
                    <StatusBox
                        variant="warn"
                        icon="group-outside-pim"
                        title="Not under PIM"
                        action={<Button icon="external-link" onClick={() => window.open(getEntraGroupUrl(data.group.id), "_blank", "noopener,noreferrer")}>Bring under PIM</Button>}
                    >
                        Members hold this group&apos;s roles permanently. Nobody activates, nothing expires.
                    </StatusBox>
                )}

                <section aria-labelledby="group-roles">
                    <h3 id="group-roles" className="text-lg leading-6 font-semibold text-ink">
                        Roles this group holds <span className="ml-1 text-[13px] font-normal text-muted">{new Set(heldRows.map((r) => r.roleId)).size}</span>
                    </h3>
                    {heldRows.length === 0 ? (
                        <p className="mt-2 text-[13px] text-muted">No roles yet.</p>
                    ) : (
                        <ul className="mt-3 flex flex-col gap-2">
                            {heldRows.map((row) => {
                                const scope = row.scope ? describeScopeTag(row.scope) : null;
                                return (
                                    <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-line bg-surface px-3 py-2.5">
                                        <button type="button" onClick={() => onOpenRole(row.roleId)} className="text-left text-sm font-medium text-accent hover:underline max-sm:min-h-11">{row.roleName}</button>
                                        <span className="flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-start">
                                            {row.kind === "eligible" && <Tag>Eligible</Tag>}
                                            {row.kind === "active" && <Tag>Active</Tag>}
                                            {row.end.type === "expires" && <Tag tip={REPORT_TERMS.expires.text}>{`Expires ${formatDate(row.end.date)}`}</Tag>}
                                            {row.end.type === "permanent" && <Tag variant="warn" tip={REPORT_TERMS.permanent.text}>Permanent</Tag>}
                                            {row.end.type === "noEnd" && row.kind !== "permanent" && <Tag tip={REPORT_TERMS.noEndDate.text}>No end date</Tag>}
                                            {scope && <Tag tip={scope.term ? REPORT_TERMS[scope.term].text : scope.tip}>{scope.label}</Tag>}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {isOutside ? <OutsideMembers data={data} emergencyAccountIds={rowContext.emergencyAccountIds} /> : <UnderPimAssignments data={data} rowContext={rowContext} />}
            </div>

            {!isOutside && (
                <GroupConfiguration
                    data={data}
                    authenticationContexts={authenticationContexts}
                    customExtensions={customExtensions}
                    relation={relation}
                    onRelationChange={onRelationChange}
                    tab={tab}
                    onTabChange={onTabChange}
                />
            )}
        </article>
    );
}

function OutsideMembers({ data, emergencyAccountIds }: { data: PimGroupData; emergencyAccountIds: ReadonlySet<string> }) {
    const useMembership = useMembershipHook();
    const state = useMembership(data.group.id);
    const [showAll, setShowAll] = useState(false);
    const rows = useMemo(
        () => buildMembershipRows({ members: state.members, owners: state.owners }, { emergencyAccountIds, groupId: data.group.id, groupName: data.group.displayName, isViaGroup: false }),
        [state.members, state.owners, emergencyAccountIds, data.group.id, data.group.displayName]
    );
    const shown = showAll ? rows : rows.slice(0, MEMBER_ROWS_SHOWN);
    const isReady = state.status === "ready";

    return (
        <section aria-labelledby="group-members">
            <h3 id="group-members" className="text-lg leading-6 font-semibold text-ink">
                Members and owners <span className="ml-1 text-[13px] font-normal text-muted">{!isReady ? "" : rows.length > shown.length ? `${shown.length} shown of ${rows.length}` : rows.length}</span>
            </h3>
            <div className="mt-3">
                {state.status === "error" ? (
                    <StatusBox variant="error" title="Members could not be read" action={<Button size="sm" onClick={state.retry}>Try again</Button>}>{state.error}</StatusBox>
                ) : !isReady ? (
                    <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={56} />)}</div>
                ) : rows.length === 0 ? (
                    <p className="text-[13px] text-muted">This group has no members or owners.</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {shown.map((row) => <AssignmentRow key={row.key} row={row} isMarking={false} emergencyAccountIds={emergencyAccountIds} />)}
                        {rows.length > shown.length && <li><Button size="sm" onClick={() => setShowAll(true)}>{`Show all ${rows.length}`}</Button></li>}
                    </ul>
                )}
            </div>
        </section>
    );
}

function UnderPimAssignments({ data, rowContext }: { data: PimGroupData; rowContext: Pick<RowContext, "emergencyAccountIds" | "marking" | "nameById" | "blueprintNames"> }) {
    const rows = useMemo(() => buildGroupAssignmentRows(data, rowContext), [data, rowContext]);
    const isMarking = rowContext.marking !== null;
    return (
        <section aria-labelledby="group-assignments">
            <h3 id="group-assignments" className="text-lg leading-6 font-semibold text-ink">
                Members and owners <span className="ml-1 text-[13px] font-normal text-muted">{`${rows.total} ${rows.total === 1 ? "assignment" : "assignments"}`}</span>
            </h3>
            {rows.total === 0 ? (
                <div className="mt-3 rounded border border-line bg-page px-4 py-5">
                    <p className="text-sm font-medium text-ink">Nobody is a member or owner</p>
                    <p className="mt-0.5 text-[13px] text-muted">Eligible and active assignments appear here.</p>
                </div>
            ) : (
                <div className="mt-3 flex flex-col gap-4">
                    {([["Eligible", rows.eligible], ["Active", rows.active]] as const).map(([title, list]) => list.length > 0 && (
                        <div key={title}>
                            <h4 className="mb-2 text-[13px] leading-5 font-semibold text-body">{`${title} (${list.length})`}</h4>
                            <ul className="flex flex-col gap-2">{list.map((row) => <AssignmentRow key={row.key} row={row} isMarking={isMarking} emergencyAccountIds={rowContext.emergencyAccountIds} />)}</ul>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}

/** Groups have no privileged flag: the Activation dot applies to every group under PIM (spec 4.2) */
function usePolicyView(policy: GroupPimPolicy | undefined, authenticationContexts: readonly AuthenticationContext[], customExtensions: PolicyViewContext["customExtensions"]) {
    const rules = policy?.rules;
    const approvers = policy?.approvers;
    return useMemo(
        () => (rules ? buildPolicyView(rules, { authenticationContexts, customExtensions, approvers, isPrivileged: true }) : null),
        [rules, approvers, authenticationContexts, customExtensions]
    );
}

function GroupConfiguration({ data, authenticationContexts, customExtensions, relation, onRelationChange, tab, onTabChange }: Pick<GroupDetailProps, "data" | "authenticationContexts" | "customExtensions" | "relation" | "onRelationChange" | "tab" | "onTabChange">) {
    const memberPolicy = data.policies?.member;
    const ownerPolicy = data.policies?.owner;
    const memberView = usePolicyView(memberPolicy, authenticationContexts, customExtensions);
    const ownerView = usePolicyView(ownerPolicy, authenticationContexts, customExtensions);
    const view = relation === "member" ? memberView : ownerView;

    return (
        <section aria-labelledby="group-configuration" className="border-t border-line bg-page p-5 sm:p-6">
            <h3 id="group-configuration" className="mb-3 text-lg leading-6 font-semibold text-ink">
                Group configuration <span className="ml-1 text-[13px] font-normal text-muted">PIM settings for this group</span>
            </h3>
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-body">Settings for</span>
                <SegmentedControl
                    variant="pill"
                    ariaLabel="Settings for"
                    value={relation}
                    onChange={onRelationChange}
                    options={[
                        { value: "member", label: "Member", hasDot: memberView?.needsAttention === true },
                        { value: "owner", label: "Owner", hasDot: ownerView?.needsAttention === true },
                    ]}
                />
            </div>
            <ConfigTabs view={view} state={view ? "ready" : data.policiesForbidden ? "notReadable" : "failed"} tab={tab} onTabChange={onTabChange} />
        </section>
    );
}
