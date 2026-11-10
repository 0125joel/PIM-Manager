"use client";

import { useMemo } from "react";
import { AccountsSection } from "@/app/dashboard/components/advanced/AccountsSection";
import { ActivationSection } from "@/app/dashboard/components/advanced/ActivationSection";
import { HasAccessSection } from "@/app/dashboard/components/advanced/HasAccessSection";
import { RightNowSection } from "@/app/dashboard/components/advanced/RightNowSection";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { AzureReportFilters } from "@/utils/azureReport";
import { entraTargetFor } from "@/utils/azureDashboardFilterLink";
import { computeAzureAccounts, computeAzureActivation, computeAzureApprovers, computeAzureHasAccess, computeAzureRightNow, type AzureDashboardInput } from "@/utils/azureDashboardStats";
import { getFilterOwnerSection } from "@/utils/dashboardAdvanced";

const AZURE_UNIT = { privileged: "privileged role × scope", all: "role × scope" };
const AZURE_COUNT_NOUN = { one: "role × scope", many: "role × scope" };

export interface AzureAdvancedSectionsProps {
    /** The stats input with `scope` set to the Advanced choice */
    input: AzureDashboardInput;
    filters: AzureReportFilters;
    /** The Report's filter is active: the sections use the numbers as they are and are dimmed */
    isFiltered: boolean;
    onSetTarget: (target: DashboardFilter) => void;
    /** The role settings are still arriving */
    isSettingsPending: boolean;
    /** The Azure data is not complete yet: the sections show skeletons */
    isLoading: boolean;
    emergencyAccountIds: ReadonlySet<string>;
    /** Details off (calm details spec 3.5): no footnotes, no Right now, at most 5 accounts with the Report link */
    isDetailed?: boolean;
    /** The Report's link of the accounts with details off */
    reportHref?: string;
}

/** The four sections of the Advanced view of the Azure dashboard (dashboard spec 7): the Entra sections, fed with the Azure numbers. */
export function AzureAdvancedSections({ input, filters, isFiltered, onSetTarget, isSettingsPending, isLoading, emergencyAccountIds, isDetailed = true, reportHref }: AzureAdvancedSectionsProps) {
    const access = useMemo(() => (isLoading ? null : computeAzureHasAccess(input)), [isLoading, input]);
    const charts = useMemo(() => (isLoading ? null : computeAzureActivation(input)), [isLoading, input]);
    const accounts = useMemo(() => (isLoading ? null : computeAzureAccounts(input)), [isLoading, input]);
    const approvers = useMemo(() => (isLoading ? null : computeAzureApprovers(input)), [isLoading, input]);
    const rightNow = useMemo(() => (isLoading ? null : computeAzureRightNow(input)), [isLoading, input]);

    const target = entraTargetFor(filters);
    // The section a filter was set from stays readable; the others are dimmed
    const dimmed = (section: "access" | "activation") => isFiltered && getFilterOwnerSection(target) !== section;
    const pending = isLoading || isSettingsPending;

    return (
        <div className="mt-4 flex flex-col gap-4">
            <HasAccessSection access={access} rowsHeading="Assignment type per level" isDimmed={dimmed("access")} filter={target} onSetFilter={onSetTarget} />
            <ActivationSection charts={charts} scope={input.scope} unit={AZURE_UNIT} countNoun={AZURE_COUNT_NOUN} isPending={pending} isPolicyLoading={isSettingsPending} extensions={[]} filter={target} onSetFilter={onSetTarget} isDimmed={dimmed("activation")} isDetailed={isDetailed} />
            <AccountsSection accounts={accounts} approvers={approvers} scope={input.scope} isPending={pending} isDimmed={isFiltered} limit={isDetailed ? undefined : 5} reportHref={reportHref} keepTags={isDetailed ? undefined : ["delegated"]} />
            {isDetailed && <RightNowSection data={rightNow} emergencyAccountIds={emergencyAccountIds} isDimmed={isFiltered} />}
        </div>
    );
}
