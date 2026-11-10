"use client";

import { useMemo } from "react";
import { CopyLinkButton } from "@/app/report/components/CopyLinkButton";
import { ConfigTabs } from "@/app/report/components/ConfigTabs";
import type { AzureRolePolicyState } from "@/hooks/useAzureRolePolicy";
import { Button } from "@/components/ui/Button";
import { StatusBox } from "@/components/ui/StatusBox";
import { Tag } from "@/components/ui/Tag";
import { AZURE_TERMS } from "@/config/help/azureReportTerms";
import { useIsDetailed } from "@/contexts/DetailsContext";
import type { AzureAssignment } from "@/types/azureResource.types";
import { azureAssignmentTags } from "@/utils/azureAssignmentTags";
import { isAzureTagShown } from "@/utils/calmTags";
import type { AzureRoleAssignmentItem, AzureRoleDetailModel } from "@/utils/azureRoleView";
import { formatDate } from "@/utils/dateFormat";
import { scopeIconFor } from "@/utils/azureResourceIcons";
import { buildPolicyView, type PolicyTabId } from "@/utils/policyView";

interface AzureRoleDetailProps {
    detail: AzureRoleDetailModel;
    /** The name of the selected scope, for the configuration line */
    scopeName: string;
    /** null while unknown or when it could not be read: no line */
    description: string | null;
    policyState: AzureRolePolicyState;
    onRetryPolicy: () => void;
    tab: PolicyTabId;
    onTabChange: (tab: PolicyTabId) => void;
    emergencyAccountIds: ReadonlySet<string>;
    /** The selected role is not in the list because of the filter */
    isHiddenByFilter: boolean;
    getShareUrl: () => string;
    /** A row on another scope: opens the settings dialog for that row's scope */
    onOpenSettings: (assignment: AzureAssignment) => void;
    /** Graph servicePrincipalType by lowercase object id, for the managed identity tag */
    spTypes?: ReadonlyMap<string, string> | null;
}

/** A role on one scope: its head, the assignments Eligible and Active in the Entra row layout, and the role configuration at that scope (Azure spec 15.2). */
export function AzureRoleDetail({ detail, scopeName, description, policyState, onRetryPolicy, tab, onTabChange, emergencyAccountIds, isHiddenByFilter, getShareUrl, onOpenSettings, spTypes }: AzureRoleDetailProps) {
    const rules = policyState.status === "loaded" ? policyState.rules : null;
    const view = useMemo(
        () => (rules ? buildPolicyView(rules, { isPrivileged: detail.isPrivileged }) : null),
        [rules, detail.isPrivileged]
    );
    const configState = policyState.status === "loaded" ? (view ? "ready" : "failed") : "loading";

    return (
        <article className="overflow-hidden rounded border border-line bg-surface">
            <div className="flex flex-col gap-6 p-5 sm:p-6">
                <header>
                    {isHiddenByFilter && <p className="mb-2 text-xs text-muted">Hidden by the current filter</p>}
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h2 className="text-xl leading-7 font-semibold text-ink">{detail.name}</h2>
                            {(detail.isPrivileged || detail.isCustom) && (
                                <p className="mt-1 flex flex-wrap gap-1.5">
                                    {detail.isPrivileged && <Tag variant="warn" tip={AZURE_TERMS.privileged.text}>Privileged</Tag>}
                                    {detail.isCustom && <Tag className="border-dashed" tip={AZURE_TERMS.custom.text}>Custom</Tag>}
                                </p>
                            )}
                            {description && (
                                <p title={description} className="mt-1.5 line-clamp-2 max-w-[70ch] text-[13px] leading-[18px] text-body">{description}</p>
                            )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2 max-sm:flex-col-reverse max-sm:items-end">
                            <CopyLinkButton getUrl={getShareUrl} />
                        </div>
                    </div>
                </header>

                <section aria-labelledby="role-assignments">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <h3 id="role-assignments" className="text-lg leading-6 font-semibold text-ink">
                            Assignments <span className="ml-1 text-[13px] font-normal text-muted">{`${detail.total} in total`}</span>
                        </h3>
                        <p className="text-xs font-medium text-body max-sm:hidden">
                            Hover or focus a tag for what it means
                        </p>
                    </div>
                    {detail.total === 0 ? (
                        <div className="mt-3 rounded border border-line bg-page px-4 py-5">
                            <p className="text-sm font-medium text-ink">Nobody has this role on this scope</p>
                            <p className="mt-0.5 text-[13px] text-muted">Eligible and active assignments appear here.</p>
                        </div>
                    ) : (
                        <div className="mt-3 flex flex-col gap-4">
                            {detail.eligible.length > 0 && <AssignmentGroup title={`Eligible (${detail.eligible.length})`} items={detail.eligible} detail={detail} emergencyAccountIds={emergencyAccountIds} onOpenSettings={onOpenSettings} spTypes={spTypes} />}
                            {detail.active.length > 0 && <AssignmentGroup title={`Active (${detail.active.length})`} items={detail.active} detail={detail} emergencyAccountIds={emergencyAccountIds} onOpenSettings={onOpenSettings} spTypes={spTypes} />}
                        </div>
                    )}
                </section>
            </div>

            <section aria-labelledby="role-configuration" className="border-t border-line bg-page p-5 sm:p-6">
                <h3 id="role-configuration" className="mb-3 text-lg leading-6 font-semibold text-ink">
                    Role configuration <span className="ml-1 text-[13px] font-normal text-muted">{`PIM settings at ${scopeName}`}</span>
                </h3>
                {policyState.status === "missing" ? (
                    <p className="text-[13px] text-muted">No role settings for this role at this scope.</p>
                ) : policyState.status === "noAccess" ? (
                    <p className="text-[13px] text-muted">No access to this scope. Your Azure role at this scope does not allow reading its role settings.</p>
                ) : policyState.status === "unavailable" ? (
                    <p className="text-[13px] text-muted">PIM settings are not available at the root scope. Choose a management group, subscription, resource group or resource.</p>
                ) : policyState.status === "failed" ? (
                    <StatusBox variant="error" title={policyState.title} action={<Button onClick={onRetryPolicy}>Try again</Button>}>
                        {policyState.detail}
                    </StatusBox>
                ) : (
                    <ConfigTabs view={view} state={configState} tab={tab} onTabChange={onTabChange} />
                )}
            </section>
        </article>
    );
}

function AssignmentGroup({ title, items, detail, emergencyAccountIds, onOpenSettings, spTypes }: { spTypes?: ReadonlyMap<string, string> | null; title: string; items: AzureRoleAssignmentItem[]; detail: AzureRoleDetailModel; emergencyAccountIds: ReadonlySet<string>; onOpenSettings: (assignment: AzureAssignment) => void }) {
    return (
        <div>
            <h4 className="mb-2 text-[13px] leading-5 font-semibold text-body">{title}</h4>
            <ul className="flex flex-col gap-2">
                {items.map((item) => (
                    <AzureRoleAssignmentRow key={item.row.assignment.id} item={item} detail={detail} emergencyAccountIds={emergencyAccountIds} onOpenSettings={onOpenSettings} spTypes={spTypes} />
                ))}
            </ul>
        </div>
    );
}

interface AzureRoleAssignmentRowProps {
    item: AzureRoleAssignmentItem;
    detail: AzureRoleDetailModel;
    emergencyAccountIds: ReadonlySet<string>;
    onOpenSettings: (assignment: AzureAssignment) => void;
    spTypes?: ReadonlyMap<string, string> | null;
}

/** One assignment in the Entra row layout: name and second line left, tags right; marked when the detail marks rows. */
function AzureRoleAssignmentRow({ item, detail, emergencyAccountIds, onOpenSettings, spTypes }: AzureRoleAssignmentRowProps) {
    const { row } = item;
    const marked = detail.isMarking && item.isMarked;
    const dimmed = detail.isMarking && !item.isMarked;
    return (
        <li>
            <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded border border-line bg-surface px-3 py-2.5 ${marked ? "border-l-2 border-l-accent" : ""}`}>
                <div className={`min-w-0 ${dimmed ? "text-muted" : ""}`}>
                    <p className={`truncate text-sm leading-5 font-medium ${dimmed ? "text-muted" : "text-ink"}`}>{row.assignment.principalName}</p>
                    <p className="truncate text-xs leading-4 text-muted">{row.assignment.principalUpn ?? row.principalTypeLabel}</p>
                </div>
                <RowTags item={item} detailName={detail.name} emergencyAccountIds={emergencyAccountIds} onOpenSettings={onOpenSettings} spTypes={spTypes} />
            </div>
        </li>
    );
}

/** The tags of one row: the Azure tags, the origin, the scope below when it is not inherited, and Settings on another scope. */
function RowTags({ item, detailName, emergencyAccountIds, onOpenSettings, spTypes }: { spTypes?: ReadonlyMap<string, string> | null; item: AzureRoleAssignmentItem; detailName: string; emergencyAccountIds: ReadonlySet<string>; onOpenSettings: (assignment: AzureAssignment) => void }) {
    const { row } = item;
    const isDetailed = useIsDetailed();
    return (
        <div className="flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-start">
            {azureAssignmentTags(row.assignment, emergencyAccountIds, formatDate, spTypes).filter((tag) => isAzureTagShown(tag.term, isDetailed)).map((tag) => (
                <Tag key={tag.label} tip={tag.term ? AZURE_TERMS[tag.term].text : undefined} variant={tag.variant} icon={tag.icon}>{tag.label}</Tag>
            ))}
            {(isDetailed || row.isInherited) && <Tag tip={AZURE_TERMS[row.isInherited ? "inherited" : "thisScope"].text}>{row.originText}</Tag>}
            {item.isOtherScope && !row.isInherited && (
                <Tag icon={scopeIconFor(row.scope)} tip={AZURE_TERMS.belowScope.text}>{row.scope.name}</Tag>
            )}
            {item.isOtherScope && (
                <Button size="sm" onClick={() => onOpenSettings(row.assignment)}>
                    Settings<span className="sr-only">{` of ${detailName} at ${row.scope.name}`}</span>
                </Button>
            )}
        </div>
    );
}
