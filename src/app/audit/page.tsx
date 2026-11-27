"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useRolesActions, useRolesData, useRolesLoading } from "@/hooks/usePimData";
import { useUnifiedData, useUnifiedLoading } from "@/contexts/UnifiedPimContext";
import { useAuditData } from "@/hooks/useAuditData";
import { useGroupsMembership } from "@/hooks/useGroupMembership";
import { useAuditUrlState } from "@/hooks/useAuditUrlState";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useTenantName } from "@/hooks/useTenantName";
import { useNow } from "@/hooks/useNow";
import { useShowDetails } from "@/hooks/useShowDetails";
import { useTourPage } from "@/hooks/useTourPage";
import { readAuditBannerDismissed, writeAuditBannerDismissed } from "@/utils/auditBannerPreference";
import { linkGroupRoles } from "@/utils/auditGroupRoles";
import { eligibleGroupIds, GROUPS_NOT_GRANTED_REASON } from "@/utils/auditNoActivation";
import { buildAuditPrivilege } from "@/utils/auditPrivilege";
import { workspaceCoverageNotes, workspaceNotice, workspaceNotRead } from "@/utils/auditWorkspaceMerge";
import { workspaceSourceLabel } from "@/utils/auditView";
import { AuditView } from "./components/AuditView";

/**
 * The data container of the Audit page: the read of the last 30 days once (a shorter `days` filters in memory, with no new
 * read), consent, Refresh and the banner. The body is `AuditView`.
 */
function AuditPageContent() {
    const data = useAuditData();
    useTourPage("entra-audit", data.status === "ready");
    const { load } = data;
    // The longest period of the source: 30 days, or what the chosen workspaces keep
    const url = useAuditUrlState(data.maxDays);
    const details = useShowDetails("entra-audit");
    const emergencyIds = useEmergencyAccountIds();
    const now = useNow();
    const { accounts } = useMsal();
    const homeAccountId = accounts[0]?.homeAccountId ?? "";
    const tenantId = accounts[0]?.tenantId;
    const account = accounts[0];
    const tenantName = useTenantName(tenantId);

    // Without a period the source decides: 30 days of the Entra audit log, or all that the chosen workspaces keep
    const read = useCallback((days?: number) => load(days), [load]);

    // Once per account (and so once on mount): the hook cleared its state for this account just before
    useEffect(() => {
        if (homeAccountId) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` changes with the account only; this runs once per account
    }, [homeAccountId]);

    // The assignments of the No activation view: started only when that view is opened (as the Report starts its own load),
    // and what is already there is reused. PIM for Groups is read by the provider when it is consented.
    const isIdle = url.state.view === "idle";
    const { rolesData, error: rolesError } = useRolesData();
    const { loading: rolesLoading } = useRolesLoading();
    const { fetchData, refreshData } = useRolesActions();
    const { workloads } = useUnifiedData();
    const { workloads: workloadLoading } = useUnifiedLoading();
    // Privileged only judges by the same roles, and they tell an app from an agent, so those start the same read, and no sooner
    // An activation of or assignment to a group names the group only: the roles tell what it gave the person
    const hasGroupMembership = data.events.some((event) => event.environment === "group" && (event.kind === "usage" || event.kind === "assignment"));
    const needsRoles = isIdle || url.state.privileged === true || url.state.who === "app" || url.state.who === "agent" || hasGroupMembership;
    useEffect(() => {
        if (needsRoles && rolesData.length === 0 && !rolesLoading && !rolesError) fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once when the view, the filter or the events ask for it
    }, [needsRoles]);
    const events = useMemo(() => linkGroupRoles(data.events, rolesData), [data.events, rolesData]);
    const privilege = useMemo(() => ({
        lookup: rolesData.length > 0 ? buildAuditPrivilege(rolesData) : null,
        error: rolesData.length === 0 ? rolesError : null,
        onRetry: () => void refreshData(false),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `refreshData` is an action with a stable identity
    }), [rolesData, rolesError]);
    const groupsPhase = workloadLoading.pimGroups.phase;
    const isGroupsConsented = workloads.pimGroups.consent.consented;
    const isGroupsLoading = isGroupsConsented && (groupsPhase === "fetching" || groupsPhase === "processing" || groupsPhase === "consent" || groupsPhase === "idle") && workloads.pimGroups.data.length === 0;
    const groupsFailed = isGroupsConsented && groupsPhase === "error" && workloads.pimGroups.data.length === 0;
    let groupsNotIncluded: string | null = null;
    if (!isGroupsConsented) groupsNotIncluded = GROUPS_NOT_GRANTED_REASON;
    else if (groupsFailed) groupsNotIncluded = "Microsoft Graph did not return the groups";
    const groupData = groupsNotIncluded === null ? workloads.pimGroups.data : [];
    // The members of the groups a role is eligible for, read only while this view is open: each member is judged on their own
    const membership = useGroupsMembership(isIdle && rolesData.length > 0 ? eligibleGroupIds(rolesData, groupData) : []);
    const assignments = {
        roles: rolesData,
        groups: groupData,
        membership,
        // No roles and no error yet: the read has not answered (it may not have started this render)
        isLoading: (rolesData.length === 0 && !rolesError) || isGroupsLoading,
        error: rolesError && rolesData.length === 0 ? rolesError : null,
        groupsNotIncluded,
        onRetry: () => void refreshData(false),
    };

    // What the chosen workspaces could not give, as the banner and the `Not read` line of every export say it
    const source = useMemo(() => {
        const info = data.source;
        if (!info.summary) return undefined;
        const notice = workspaceNotice(info.summary, info.fellBack);
        return {
            kind: info.kind,
            label: info.kind === "workspace" ? workspaceSourceLabel(info.summary.read, info.summary.total) : undefined,
            notice,
            notRead: workspaceNotRead(info.summary, info.fellBack) || undefined,
            coverageNotes: info.kind === "workspace" ? workspaceCoverageNotes(info.summary) : undefined,
        };
    }, [data.source]);

    // Hidden until the stored choice is read, so a dismissed banner never flashes
    const [isBannerDismissed, setIsBannerDismissed] = useState(true);
    useEffect(() => {
        // Hydration-safe read of localStorage after mount
        setIsBannerDismissed(readAuditBannerDismissed(tenantId));
    }, [tenantId]);

    return (
        <AuditView
            status={data.status}
            events={events}
            windowStart={data.oldest}
            readAt={data.readAt}
            loadedCount={data.loadedCount}
            requestedDays={data.requestedDays}
            source={source}
            maxDays={data.maxDays}
            isRequestingPermission={data.isRequestingPermission}
            now={now}
            emergencyIds={emergencyIds}
            url={url}
            details={{ isDetailed: details.isDetailed, toggle: details.canToggle ? <DetailsToggle isChecked={details.isDetailed} onChange={details.setDetailed} /> : undefined }}
            refresh={<RefreshButtonView isDisabled={data.status === "loading"} onRefresh={() => read()} />}
            onGrant={() => void data.requestPermission()}
            onRetry={() => read()}
            onLoadDays={(days) => {
                read(days);
                url.setDays(days);
            }}
            assignments={isIdle ? assignments : undefined}
            privilege={privilege}
            exportContext={{
                tenant: { id: tenantId ?? "", name: tenantName ?? undefined },
                exporter: account?.name ? `${account.name} (${account.username})` : account?.username,
                appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "",
            }}
            banner={isBannerDismissed || data.source.summary !== null ? undefined : { onDismiss: () => { writeAuditBannerDismissed(tenantId); setIsBannerDismissed(true); } }}
        />
    );
}

export default function AuditPage() {
    return (
        <Suspense fallback={
            <div className="mx-auto max-w-[1376px]">
                <Skeleton className="mb-2 block" width={160} height={32} />
                <Skeleton className="mb-8 block" width={320} height={16} />
            </div>
        }>
            <AuditPageContent />
        </Suspense>
    );
}
