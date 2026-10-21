"use client";

import { useMemo } from "react";
import { Tag } from "@/components/ui/Tag";
import { REPORT_TERMS } from "@/config/help/reportTerms";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { AuthenticationContext } from "@/types/shared.types";
import { buildPolicyView, type PolicyTabId, type PolicyViewContext } from "@/utils/policyView";
import { buildRoleAssignmentRows, type RowContext } from "@/utils/reportRows";
import { AssignmentRow } from "../AssignmentRow";
import { ConfigTabs } from "../ConfigTabs";
import { ChangeInConfigureLink } from "@/components/ui/ChangeInConfigureLink";
import { CopyLinkButton } from "../CopyLinkButton";

interface RoleDetailProps {
    role: RoleDetailData;
    rowContext: RowContext;
    emergencyAccountIds: ReadonlySet<string>;
    authenticationContexts: readonly AuthenticationContext[];
    customExtensions: PolicyViewContext["customExtensions"];
    /** The settings of the roles are still arriving */
    isPoliciesLoading: boolean;
    tab: PolicyTabId;
    onTabChange: (tab: PolicyTabId) => void;
    /** The selected role is not in the list because of the filter (spec 2.3) */
    isHiddenByFilter: boolean;
    getShareUrl: () => string;
    /** "Change in Configure" (spec 16): the link when the admin may change this role, else none */
    changeHref?: string | null;
}

/** A role: its head, the assignments on `surface` and the PIM configuration on the `page` band below (spec 3). */
export function RoleDetail({ role, rowContext, emergencyAccountIds, authenticationContexts, customExtensions, isPoliciesLoading, tab, onTabChange, isHiddenByFilter, getShareUrl, changeHref }: RoleDetailProps) {
    const rows = useMemo(() => buildRoleAssignmentRows(role, rowContext), [role, rowContext]);
    const isMarking = rowContext.marking !== null;
    const rules = role.policy?.details?.rules;
    const view = useMemo(
        () => buildPolicyView(rules, { authenticationContexts, customExtensions, approvers: role.policy?.approvers, isPrivileged: role.definition.isPrivileged === true }),
        [rules, authenticationContexts, customExtensions, role.policy?.approvers, role.definition.isPrivileged]
    );
    const configState = view ? "ready" : role.policiesForbidden ? "notReadable" : isPoliciesLoading && !role.configError ? "loading" : "failed";

    return (
        <article className="overflow-hidden rounded border border-line bg-surface">
            <div className="flex flex-col gap-6 p-5 sm:p-6">
                <header>
                    {isHiddenByFilter && <p className="mb-2 text-xs text-muted">Hidden by the current filter</p>}
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-xl leading-7 font-semibold text-ink">{role.definition.displayName}</h2>
                            {(role.definition.isPrivileged || role.definition.isBuiltIn === false) && (
                                <p className="mt-1 flex flex-wrap gap-1.5">
                                    {role.definition.isPrivileged && <Tag variant="warn" tip={REPORT_TERMS.privileged.text}>Privileged</Tag>}
                                    {role.definition.isBuiltIn === false && <Tag className="border-dashed" tip={REPORT_TERMS.custom.text}>Custom</Tag>}
                                </p>
                            )}
                            {role.definition.description && (
                                <p title={role.definition.description} className="mt-1.5 line-clamp-2 max-w-[70ch] text-[13px] leading-[18px] text-body">{role.definition.description}</p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 max-sm:flex-col-reverse max-sm:items-end">
                            {changeHref && <ChangeInConfigureLink href={changeHref} name={role.definition.displayName} />}
                            <CopyLinkButton getUrl={getShareUrl} />
                        </div>
                    </div>
                </header>

                <section aria-labelledby="role-assignments">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 id="role-assignments" className="text-lg leading-6 font-semibold text-ink">
                            Assignments <span className="ml-1 text-[13px] font-normal text-muted">{`${rows.total} in total`}</span>
                        </h3>
                        <p className="text-xs font-medium text-body max-sm:hidden">
                            Hover or focus a tag for what it means
                        </p>
                    </div>
                    {rows.total === 0 ? (
                        <div className="mt-3 rounded border border-line bg-page px-4 py-5">
                            <p className="text-sm font-medium text-ink">Nobody has this role</p>
                            <p className="mt-0.5 text-[13px] text-muted">Eligible and active assignments appear here.</p>
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-col gap-4">
                            {rows.eligible.length > 0 && <AssignmentGroup title={`Eligible (${rows.eligible.length})`} rows={rows.eligible} isMarking={isMarking} emergencyAccountIds={emergencyAccountIds} />}
                            {rows.active.length > 0 && <AssignmentGroup title={`Active (${rows.active.length})`} rows={rows.active} isMarking={isMarking} emergencyAccountIds={emergencyAccountIds} />}
                        </div>
                    )}
                </section>
            </div>

            <section aria-labelledby="role-configuration" className="border-t border-line bg-page p-5 sm:p-6">
                <h3 id="role-configuration" className="mb-3 text-lg leading-6 font-semibold text-ink">
                    Role configuration <span className="ml-1 text-[13px] font-normal text-muted">PIM settings for this role</span>
                </h3>
                {!view && !role.configError && !role.policiesForbidden && !isPoliciesLoading ? (
                    <p className="mb-3 text-[13px] text-muted">No PIM settings were found for this role.</p>
                ) : null}
                <ConfigTabs view={view} state={configState} tab={tab} onTabChange={onTabChange} />
            </section>
        </article>
    );
}

function AssignmentGroup({ title, rows, isMarking, emergencyAccountIds }: { title: string; rows: ReturnType<typeof buildRoleAssignmentRows>["eligible"]; isMarking: boolean; emergencyAccountIds: ReadonlySet<string> }) {
    return (
        <div>
            <h4 className="mb-2 text-[13px] leading-5 font-semibold text-body">{title}</h4>
            <ul className="flex flex-col gap-2">
                {rows.map((row) => <AssignmentRow key={row.key} row={row} isMarking={isMarking} emergencyAccountIds={emergencyAccountIds} />)}
            </ul>
        </div>
    );
}
