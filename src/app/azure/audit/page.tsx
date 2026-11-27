"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAzureActions, useAzureData, useAzureLoading } from "@/contexts/AzureContext";
import { useAzureAuditData } from "@/hooks/useAzureAuditData";
import { useAzureConsent } from "@/hooks/useAzureConsent";
import { useAzureAuditUrlState } from "@/hooks/useAzureAuditUrlState";
import { definitionsOf, loadAzureRoleDefinitions, resetAzureDashboardForRefresh, type AzureDefinitionsState } from "@/hooks/useAzureDashboardReads";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useGroupsMembership } from "@/hooks/useGroupMembership";
import { azureEligibleGroupIds } from "@/utils/azureNoActivation";
import { usePimGroupsConsented, usePimGroupsData, usePimGroupsLoading } from "@/hooks/usePimSelectors";
import { useMyAzureRoles } from "@/hooks/useMyAzureRoles";
import { useNow } from "@/hooks/useNow";
import { useShowDetails } from "@/hooks/useShowDetails";
import { useTenantName } from "@/hooks/useTenantName";
import { useTourPage } from "@/hooks/useTourPage";
import { readAuditBannerDismissed, writeAuditBannerDismissed } from "@/utils/auditBannerPreference";
import { isAbortError } from "@/utils/errorUtils";
import { Logger } from "@/utils/logger";
import { planAzureAuditRead } from "@/utils/azureAuditRead";
import { buildAzureAuditPrivilege, isAzureAuditUnreadableNow } from "@/utils/azureAuditView";
import { AzureAuditBody } from "./components/AzureAuditBody";

/**
 * The data container of the Azure Audit page: the read of the last 90 days once the assignments are in (a shorter `days`
 * filters in memory, with no new read), Refresh, and the role definitions that Privileged only judges by. The body is `AzureAuditBody`.
 */
function AzureAuditPageContent() {
    const data = useAzureAuditData();
    // The longest period comes from the data: 90 days, or up to a year with a chosen workspace
    const url = useAzureAuditUrlState(data.maxDays);
    const details = useShowDetails("azure-audit");
    const emergencyIds = useEmergencyAccountIds();
    const now = useNow();
    const { accounts } = useMsal();
    const homeAccountId = accounts[0]?.homeAccountId ?? "";
    const tenantId = accounts[0]?.tenantId;
    const account = accounts[0];
    const tenantName = useTenantName(tenantId);
    const { scopes, assignments, lastFetched, loadKey } = useAzureData();
    const { loading } = useAzureLoading();
    const { load: loadAzure, refresh, getArmClient } = useAzureActions();
    const { isEnabled } = useAzureConsent();
    const { load: loadAudit } = data;

    // Page mount: load honours the 60 minute TTL and the session cache, and never starts a second run
    useEffect(() => {
        if (isEnabled) void loadAzure();
    }, [isEnabled, loadAzure]);

    // The audit read starts only once the assignments are in: the names of roles, people and scopes come from them. A new load key reads again.
    const isAzureSettled = (lastFetched !== undefined && scopes.length > 0) || (scopes.length === 0 && (loading.phase === "complete" || loading.phase === "error"));
    useEffect(() => {
        if (homeAccountId && isAzureSettled) loadAudit();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- a read per account and per load key; `loadAudit` changes with the data it reads
    }, [homeAccountId, loadKey, isAzureSettled]);

    // Privileged only judges by the role definitions, read once when the filter is first turned on
    const isPrivilegedOn = url.state.privileged === true;
    const [definitionsState, setDefinitionsState] = useState<AzureDefinitionsState | null>(null);
    useEffect(() => {
        if (!isPrivilegedOn || definitionsState !== null || scopes.length === 0) return;
        const controller = new AbortController();
        loadAzureRoleDefinitions(getArmClient(), scopes, controller.signal)
            .then((result) => {
                // "loading" is a read that was stopped; it is asked for again by the next run of this effect
                if (!controller.signal.aborted && result.status !== "loading") setDefinitionsState(result);
            })
            .catch((error: unknown) => {
                if (isAbortError(error) || controller.signal.aborted) return;
                Logger.warn("AzureAuditPage", "The role definitions could not be read");
                setDefinitionsState({ status: "failed" });
            });
        return () => controller.abort();
    }, [isPrivilegedOn, definitionsState, scopes, getArmClient]);
    const definitions = definitionsState === null ? null : definitionsOf(definitionsState);
    const privilege = useMemo(() => ({
        lookup: buildAzureAuditPrivilege(definitions, data.holderKinds),
        error: null,
        onRetry: () => undefined,
    }), [definitions, data.holderKinds]);

    // Hidden until the stored choice is read, so a dismissed banner never flashes. Its own key: dismissing the 30 days of Entra says nothing about the 90 days here.
    const bannerTenant = tenantId ? `azure-${tenantId}` : undefined;
    const [isBannerDismissed, setIsBannerDismissed] = useState(true);
    useEffect(() => {
        // Hydration-safe read of localStorage after mount
        setIsBannerDismissed(readAuditBannerDismissed(bannerTenant));
    }, [bannerTenant]);

    // An account that can read none of it sees its own Azure roles
    const subscriptionIds = useMemo(() => planAzureAuditRead(scopes).subscriptionIds, [scopes]);
    const isUnreadable = isAzureAuditUnreadableNow(data.status, { subscriptionIds, notRead: data.notRead, eventCount: data.events.length });
    // The tour needs the timeline and the filters, which the state of an account that can read none of it does not have
    useTourPage("azure-audit", data.status === "ready" && !isUnreadable);
    const myRoles = useMyAzureRoles(isUnreadable);
    // The members of the groups an assignment is eligible for are read only while No activation is open
    const membership = useGroupsMembership(url.state.view === "idle" ? azureEligibleGroupIds(assignments) : []);

    // PIM for Groups is read by the provider once consented; a group that holds a role actively is judged by it
    const groupData = usePimGroupsData();
    const isGroupsConsented = usePimGroupsConsented();
    const groupsPhase = usePimGroupsLoading().phase;
    const pimGroups = isGroupsConsented && (groupData.length > 0 || groupsPhase === "complete") ? groupData : null;

    const refreshAzure = () => {
        // Role settings and role definitions are read again after a refresh, as the assignments are
        resetAzureDashboardForRefresh();
        void refresh();
    };

    return (
        <AzureAuditBody
            status={data.status}
            events={data.events}
            notRead={data.notRead}
            ownRequestCount={data.ownRequestCount}
            entraLog={data.entraLog}
            scopes={scopes}
            assignments={assignments}
            membership={membership}
            holderKinds={data.holderKinds}
            pimGroups={pimGroups}
            homeTenantId={tenantId}
            tenantName={tenantName ?? "your tenant"}
            readAt={data.readAt}
            windowStart={data.oldest}
            loadedCount={data.loadedCount}
            progress={data.progress}
            requestedDays={data.requestedDays}
            maxDays={data.maxDays}
            entraLogDays={data.entraLogDays}
            workspace={data.workspace}
            banner={isBannerDismissed ? undefined : { onDismiss: () => { writeAuditBannerDismissed(bannerTenant); setIsBannerDismissed(true); } }}
            now={now}
            emergencyIds={emergencyIds}
            url={url}
            details={{ isDetailed: details.isDetailed, toggle: details.canToggle ? <DetailsToggle isChecked={details.isDetailed} onChange={details.setDetailed} /> : undefined }}
            refresh={<RefreshButtonView isDisabled={data.status === "loading" || loading.phase === "fetching" || loading.phase === "processing"} onRefresh={refreshAzure} />}
            onRetry={() => loadAudit(data.requestedDays)}
            onRefresh={refreshAzure}
            onLoadDays={(days) => {
                loadAudit(days);
                url.setDays(days);
            }}
            privilege={privilege}
            myRoles={myRoles}
            exportContext={{
                tenantName: tenantName ?? undefined,
                exporter: account?.name ? `${account.name} (${account.username})` : account?.username,
                appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
            }}
        />
    );
}

export default function AzureAuditPage() {
    return (
        <Suspense fallback={
            <div className="mx-auto max-w-[1376px]">
                <Skeleton className="mb-2 block" width={160} height={32} />
                <Skeleton className="mb-8 block" width={320} height={16} />
            </div>
        }>
            <AzureAuditPageContent />
        </Suspense>
    );
}
