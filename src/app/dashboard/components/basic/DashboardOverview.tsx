"use client";

import { useMemo } from "react";
import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { DashboardFilter, DashboardFilterKey } from "@/types/dashboardFilter.types";
import { buildFilterNames, filterAppliesToGroups, isEmptyDashboardFilter } from "@/utils/dashboardFilter";
import { buildStatsView, buildViewFilterSentence, type CountingState } from "@/utils/dashboardView";
import { buildTips } from "@/utils/tipRules";
import { computeCards, computeEasyToMiss, computeTerms, computeWho, unavailableCards, getEffectiveDashboardFilter, type DashboardStatsInput } from "@/utils/dashboardStats";
import { getGroupsOutsidePim } from "@/utils/groupsOutsidePim";
import { AdvancedSections } from "../advanced/AdvancedSections";
import type { DashboardScope } from "@/utils/dashboardAdvanced";
import { AlertsBlock, type AlertsBlockProps } from "./AlertsBlock";
import { CardGrid } from "./CardGrid";
import { EasyToMissBlock } from "./EasyToMissBlock";
import type { ConfigureLinkTarget } from "@/utils/configureLinks";
import { GroupsOutsidePimBlock, type GroupsBlockState } from "./GroupsOutsidePimBlock";
import { FilterBar } from "./FilterBar";
import { TipBar } from "./TipBar";
import { TermsBlock } from "./TermsBlock";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";
import { WhoBlock } from "./WhoBlock";

export type { CountingState };

interface DashboardOverviewProps {
    rolesData: RoleDetailData[];
    /** Onboarded and unmanaged groups */
    groupsData: PimGroupData[];
    counting: CountingState;
    filter: DashboardFilter;
    isRolesLoading: boolean;
    isGroupsLoading: boolean;
    policiesLoading: boolean;
    emergencyAccountIds: ReadonlySet<string>;
    onSetFilter: (filter: DashboardFilter) => void;
    onRemoveFilterKey: (key: DashboardFilterKey) => void;
    /** The Directory roles load failed (message), shown as a failed block by the page */
    rolesError?: string | null;
    pimGroupsConsented: boolean;
    /** The PIM for Groups load failed; shown as a failed block with Try again */
    pimGroupsError?: string | null;
    onRetryPimGroups?: () => void;
    onGrantPimGroups: () => void;
    /** null: the Security alerts chip is off, the block is left out */
    alerts: Omit<AlertsBlockProps, "isDimmed"> | null;
    /** Basic shows the Who and Terms blocks under the cards; Advanced has its own sections */
    showBlocks: boolean;
    /** Advanced: the five sections of spec 4.3 under the cards instead of the Basic blocks */
    showAdvanced?: boolean;
    /** Which roles the Privileged card, Require approval and the Advanced sections 2 and 4 count; Basic always passes privileged */
    scope?: DashboardScope;
    tenantExtensionIds?: ReadonlySet<string> | null;
    /** "Change in Configure" (spec 16) for a group outside PIM the admin may change; the fixture passes none */
    changeHrefFor?: (target: ConfigureLinkTarget) => string | null;
}

/** Filter bar, the eight cards and, in Basic, Who and Terms (spec 4.2 items 1 and 2): every number comes from `dashboardStats`. */
export function DashboardOverview({ rolesData, groupsData, counting, filter, isRolesLoading, isGroupsLoading, policiesLoading, emergencyAccountIds, onSetFilter, onRemoveFilterKey, showBlocks, showAdvanced = false, scope = "privileged", tenantExtensionIds = null, rolesError, pimGroupsConsented, onGrantPimGroups, pimGroupsError, onRetryPimGroups, alerts, changeHrefFor }: DashboardOverviewProps) {
    const effective = useMemo(() => getEffectiveDashboardFilter(filter), [filter]);
    const isFiltered = !isEmptyDashboardFilter(effective);
    const appliesToGroups = !isFiltered || filterAppliesToGroups(effective);

    // A failed load is "unknown", not zero (spec 4.7)
    const isRolesFailed = counting.directoryRoles && !!rolesError && rolesData.length === 0;
    const isGroupsFailed = counting.pimGroups && !!pimGroupsError && groupsData.length === 0;

    const view = useMemo(
        () => buildStatsView({ rolesData, groupsData, counting, effective, policiesLoading, emergencyAccountIds, scope, narrowToScope: showAdvanced, isGroupsUnavailable: isGroupsFailed }),
        [rolesData, groupsData, counting, effective, policiesLoading, emergencyAccountIds, isGroupsFailed, scope, showAdvanced],
    );

    const isLoading = (counting.directoryRoles && isRolesLoading && rolesData.length === 0) || (counting.pimGroups && isGroupsLoading && groupsData.length === 0);
    const stats = useMemo(() => (isRolesFailed ? unavailableCards("not loaded") : isLoading ? null : computeCards(view.input)), [isRolesFailed, isLoading, view.input]);
    const who = useMemo(() => (isLoading ? null : computeWho(view.input)), [isLoading, view.input]);
    const easyToMiss = useMemo(() => (isLoading ? null : computeEasyToMiss(view.roleLevelInput)), [isLoading, view.roleLevelInput]);
    const terms = useMemo(() => {
        if (isLoading || !counting.directoryRoles) return null;
        const result = computeTerms(view.input);
        return result.isPending ? null : result;
    }, [isLoading, counting.directoryRoles, view.input]);

    const filterNames = useMemo(() => buildFilterNames(rolesData), [rolesData]);
    const outsideRows = useMemo(() => getGroupsOutsidePim(groupsData, rolesData), [groupsData, rolesData]);
    const roleAssignableCount = useMemo(() => groupsData.filter((g) => g.group.isAssignableToRole === true).length, [groupsData]);
    let groupsState: GroupsBlockState = "ready";
    if (!pimGroupsConsented) groupsState = "noConsent";
    else if (pimGroupsError) groupsState = "error";
    else if (!counting.pimGroups || !counting.unmanagedGroups) groupsState = "notCounted";
    else if (isGroupsLoading && groupsData.length === 0) groupsState = "loading";

    // Tenant tips describe the whole tenant, so they are computed without the page filter
    const tips = useMemo(() => {
        if (isLoading || isRolesFailed) return buildTips({ permanentOutsideEmergency: null, privilegedWithoutMfa: null, privilegedWithoutJustification: null, groupsOutsidePim: null, nobodyNotified: null });
        const wholeTenant: DashboardStatsInput = { ...view.input, roles: counting.directoryRoles ? rolesData : [], groups: counting.pimGroups ? groupsData.filter((g) => g.isManaged !== false) : [], isFiltered: false, filterAppliesToGroups: true };
        const who = computeWho(wholeTenant);
        const termsAll = counting.directoryRoles ? computeTerms(wholeTenant) : null;
        const rows = computeEasyToMiss(wholeTenant);
        const pending = termsAll?.isPending ?? true;
        return buildTips({
            permanentOutsideEmergency: who.permanent - who.emergencyPermanent,
            privilegedWithoutMfa: termsAll && !pending ? termsAll.neither : null,
            privilegedWithoutJustification: termsAll && !pending ? termsAll.withoutJustification : null,
            groupsOutsidePim: counting.pimGroups && counting.unmanagedGroups ? outsideRows.length : null,
            nobodyNotified: rows.find((r) => r.id === "nobodyNotified")?.count ?? null,
        });
    }, [isLoading, isRolesFailed, view.input, counting, rolesData, groupsData, outsideRows.length]);

    // A privileged role whose policy Graph refused (FIX-12) is left out of Terms; the block says so instead of showing "0 of 0" silently
    const hasUnreadablePrivileged = rolesData.some((r) => r.policiesForbidden && r.definition.isPrivileged === true);
    const termsCaveat = counting.directoryRoles && hasUnreadablePrivileged ? POLICY_NOT_READABLE : undefined;
    const rolesNotice = !counting.directoryRoles ? "Directory roles are not counted. Switch the chip on to see this." : isRolesFailed ? "Not available until the Directory roles load." : undefined;

    const sentence = buildViewFilterSentence(view, rolesData, effective, counting.pimGroups, showAdvanced);

    return (
        <>
            {/* Always mounted so that a change of the filter is announced */}
            <p role="status" className="sr-only">{isFiltered ? sentence : ""}</p>
            {isFiltered && <FilterBar filter={filter} reportFilter={effective} sentence={sentence} onRemoveKey={onRemoveFilterKey} names={filterNames} />}
            <CardGrid stats={stats} filter={filter} isGroupsDimmed={isFiltered && !appliesToGroups} onSetFilter={onSetFilter} />
            {showBlocks && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <WhoBlock notice={isRolesFailed ? rolesNotice : undefined} who={who} filter={filter} isFiltered={isFiltered && !appliesToGroups} onSetFilter={onSetFilter} />
                    <TermsBlock terms={terms} notice={rolesNotice} caveat={termsCaveat} isWaitingForSettings={rolesData.length > 0 && policiesLoading} filter={filter} onSetFilter={onSetFilter} />
                </div>
            )}
            {showBlocks && (
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <GroupsOutsidePimBlock state={groupsState} rows={outsideRows} roleAssignableCount={roleAssignableCount} isDimmed={isFiltered && !appliesToGroups} onGrant={onGrantPimGroups} errorMessage={pimGroupsError} onRetry={onRetryPimGroups} changeHrefFor={changeHrefFor} />
                    <div className="flex flex-col gap-4">
                        <EasyToMissBlock rows={easyToMiss} notice={rolesNotice} filter={filter} onSetFilter={onSetFilter} />
                        {alerts && <AlertsBlock {...alerts} isDimmed={isFiltered} />}
                    </div>
                </div>
            )}
            {showAdvanced && (
                <AdvancedSections
                    rolesData={rolesData}
                    groupsData={groupsData}
                    counting={counting}
                    scope={scope}
                    emergencyAccountIds={emergencyAccountIds}
                    tenantExtensionIds={tenantExtensionIds}
                    filter={filter}
                    isFiltered={isFiltered}
                    onSetFilter={onSetFilter}
                    isRolesLoading={isRolesLoading}
                    isGroupsLoading={isGroupsLoading}
                    policiesLoading={policiesLoading}
                    rolesError={rolesError}
                    pimGroupsConsented={pimGroupsConsented}
                    pimGroupsError={pimGroupsError}
                    onGrantPimGroups={onGrantPimGroups}
                    onRetryPimGroups={onRetryPimGroups ?? (() => undefined)}
                />
            )}
            {showBlocks && <div className="mt-4"><TipBar tips={tips} onSetFilter={onSetFilter} /></div>}
        </>
    );
}
