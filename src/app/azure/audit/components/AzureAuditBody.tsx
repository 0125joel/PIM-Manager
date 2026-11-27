"use client";

import { useMemo, type ReactNode } from "react";
import { CARD } from "@/app/audit/components/AuditStates";
import { AuditView, type AuditPrivilegeView } from "@/app/audit/components/AuditView";
import { AzureScopeBar } from "@/app/azure/components/dashboard/basic/AzureScopeBar";
import { MyAzureRoles } from "@/app/azure/report/components/MyAzureRoles";
import { Button } from "@/components/ui/Button";
import { AZURE_AUDIT_MAX_DAYS, type AzureAuditUrlActions } from "@/hooks/useAzureAuditUrlState";
import type { AzureWorkspaceInfo } from "@/hooks/useAzureAuditData";
import type { PimGroupData } from "@/types/pimGroup.types";
import type { AuditEvent, AzureEntraLogState } from "@/types/audit.types";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import type { GroupMembersLookup } from "@/utils/auditNoActivation";
import { buildAzureNoActivationRows } from "@/utils/azureNoActivation";
import type { PrincipalKind } from "@/utils/principalUtils";
import { azureFailureMessage, type AuditFormat } from "@/utils/auditView";
import { holdingsOf, planAzureAuditRead, type AzureAuditNotRead } from "@/utils/azureAuditRead";
import { aboveSubscriptionsNote, azureApproverNote, azureAuditCoverage, azureAuditNotice, azureAuditNotReadText, azureGroupLogNotice, azureWorkspaceLimits, azureWorkspaceNotice, describeAzureAuditScopeBar, filterAuditEventsByScope, filterAzureAssignmentsByScope, isAzureAuditUnreadableNow, joinAzureNotices } from "@/utils/azureAuditView";
import { findScope } from "@/utils/azureReport";
import { hasMyRolesContent, type MyAzureRolesState } from "@/utils/azureReportStates";
import type { AzureAuditStatus } from "@/hooks/useAzureAuditData";

export interface AzureAuditBodyProps {
    status: AzureAuditStatus;
    /** Every event of the last read, before the scope bar */
    events: readonly AuditEvent[];
    notRead: readonly AzureAuditNotRead[];
    /** How many requests are the user's own on scopes the user cannot read: the coverage line says they are included */
    ownRequestCount?: number;
    entraLog: AzureEntraLogState | null;
    /** The longest period the page offers: 90 days, or up to a year with a chosen workspace (default 90) */
    maxDays?: number;
    /** How far back the Entra audit log reaches in this read (default 30) */
    entraLogDays?: number;
    /** The chosen workspaces of the last read; null without a choice */
    workspace?: AzureWorkspaceInfo | null;
    /** The banner about the 90 days; left out once it is dismissed, and it never shows with a chosen workspace */
    banner?: { onDismiss: () => void };
    scopes: readonly AzureScope[];
    /** Every PIM assignment the Azure data holds, before the scope bar: the rows of No activation */
    assignments: readonly AzureAssignment[];
    /** The members of the groups an assignment is eligible for, by lower case group id */
    membership?: ReadonlyMap<string, GroupMembersLookup>;
    /** The kind of each app or agent by lower case id */
    holderKinds?: ReadonlyMap<string, PrincipalKind>;
    /** PIM for Groups, for a group that holds a role actively; null when it is not read */
    pimGroups?: readonly PimGroupData[] | null;
    homeTenantId?: string;
    /** The display name of the user's tenant; "your tenant" until it is known */
    tenantName: string;
    readAt: string | null;
    windowStart: string | null;
    loadedCount: number;
    /** Scopes read so far while loading */
    progress: { done: number; total: number };
    requestedDays: number;
    now: Date;
    emergencyIds: ReadonlySet<string>;
    url: AzureAuditUrlActions;
    details: { isDetailed: boolean; toggle?: ReactNode };
    refresh: ReactNode;
    /** Reads the audit again (Try again, and Retry of the notice) */
    onRetry: () => void;
    /** Reads Azure again, the assignments first (the Refresh of the state that has nothing to read) */
    onRefresh: () => void;
    onLoadDays: (days: number) => void;
    privilege: AuditPrivilegeView;
    /** The user's own Azure roles, for the state that has nothing to read */
    myRoles: MyAzureRolesState;
    format?: AuditFormat;
    /** The Filters panel is open on first render (the fixture) */
    startFiltersOpen?: boolean;
    /** The export dialog is open on first render (the fixture) */
    startExportOpen?: boolean;
    /** Who and what the export names; left out, there is no Export button. `tenantName` is left out until it is known. */
    exportContext?: { tenantName?: string; exporter?: string; appVersion: string };
}

const GROUPS_NOT_INCLUDED_REASON = "read access to PIM for Groups has not been granted or it has not answered, so who activates membership of a group that holds a role is not judged";

const UNREADABLE_TEXT = "Azure answered, but left everything out. It does that without saying so when your account has no Azure role on a scope, so this says nothing about whether anything happened. Reader on a subscription or a resource group is enough to see what happened there.";

function readingText(progress: { done: number; total: number }, count: number): string {
    if (progress.total === 0) return "Reading the Azure logs";
    const head = `Reading ${progress.done} of ${progress.total} scopes.`;
    return count > 0 ? `${head} ${count.toLocaleString("en-US")} events so far.` : head;
}

/**
 * The body of the Azure Audit page without any context: the shared Audit body with the scope bar, Azure's texts and the
 * state of an account that can read none of it. The page and the fixture route (`/dev/audit?surface=azure`) render this. No MSAL and no ARM here.
 */
export function AzureAuditBody({ status, events, notRead, ownRequestCount = 0, entraLog, maxDays = AZURE_AUDIT_MAX_DAYS, entraLogDays = 30, workspace = null, banner, scopes, assignments, membership, holderKinds, pimGroups, homeTenantId, tenantName, readAt, windowStart, loadedCount, progress, requestedDays, now, emergencyIds, url, details, refresh, onRetry, onRefresh, onLoadDays, privilege, myRoles, format, startFiltersOpen, startExportOpen, exportContext }: AzureAuditBodyProps) {
    const chosenScopeId = findScope([...scopes], url.scopeId)?.id ?? null;
    const scoped = useMemo(
        () => filterAuditEventsByScope(events, { scopes, chosenScopeId, includeInherited: url.includeInherited, includeDelegated: url.includeDelegated, homeTenantId }),
        [events, scopes, chosenScopeId, url.includeInherited, url.includeDelegated, homeTenantId]
    );
    // The workspaces are in the page only when they were read: after a fall-back the page shows the native read, as without one
    const workspaceRead = workspace && !workspace.fellBack ? workspace : null;
    const groupLogNotice = useMemo(() => azureGroupLogNotice(entraLog, url.state.days, holdingsOf(assignments).length > 0, entraLogDays), [entraLog, url.state.days, assignments, entraLogDays]);
    const workspaceNotice = useMemo(() => (workspace ? azureWorkspaceNotice(workspace.summary, workspace.fellBack, workspace.logFailures) : null), [workspace]);
    const notice = useMemo(() => joinAzureNotices(joinAzureNotices(azureAuditNotice(notRead, scopes), workspaceNotice), groupLogNotice), [notRead, scopes, workspaceNotice, groupLogNotice]);
    const subscriptionIds = useMemo(() => planAzureAuditRead([...scopes]).subscriptionIds, [scopes]);
    const coverage = useMemo(
        () => azureAuditCoverage(notRead, entraLog, workspaceRead ? {
            summary: workspaceRead.summary,
            sendingSubscriptionIds: workspaceRead.sendingSubscriptionIds,
            readableSubscriptionIds: subscriptionIds,
            days: url.state.days,
        } : undefined, ownRequestCount),
        [notRead, entraLog, workspaceRead, subscriptionIds, url.state.days, ownRequestCount]
    );
    const subscriptionsNotRead = useMemo(() => azureAuditNotReadText(notRead, scopes), [notRead, scopes]);
    // Every export names what is missing, the workspaces included
    const exportNotRead = useMemo(() => {
        const above = aboveSubscriptionsNote(url.state.days, workspaceRead !== null) || undefined;
        const parts = [subscriptionsNotRead, workspaceNotice ? `${workspaceNotice.title} ${workspaceNotice.detail}` : undefined, groupLogNotice ? `${groupLogNotice.title} ${groupLogNotice.detail}` : undefined, above].filter((part) => part !== undefined);
        return parts.length > 0 ? parts.join(" ") : undefined;
    }, [subscriptionsNotRead, workspaceNotice, groupLogNotice, url.state.days, workspaceRead]);
    const workspaceLimits = useMemo(() => (workspace ? azureWorkspaceLimits(workspace.summary, workspace.fellBack, workspace.logFailures) : []), [workspace]);
    const exportScopeBar = useMemo(
        () => describeAzureAuditScopeBar({ scopes, chosenScopeId, includeInherited: url.includeInherited, includeDelegated: url.includeDelegated }),
        [scopes, chosenScopeId, url.includeInherited, url.includeDelegated]
    );
    const isUnreadable = isAzureAuditUnreadableNow(status, { subscriptionIds, notRead, eventCount: events.length });
    const scopedAssignments = useMemo(
        () => filterAzureAssignmentsByScope(assignments, { scopes, chosenScopeId, includeInherited: url.includeInherited, includeDelegated: url.includeDelegated, homeTenantId }),
        [assignments, scopes, chosenScopeId, url.includeInherited, url.includeDelegated, homeTenantId]
    );
    const noActivation = useMemo(() => ({
        roles: [],
        groups: [],
        membership,
        isLoading: false,
        error: null,
        groupsNotIncluded: pimGroups ? null : GROUPS_NOT_INCLUDED_REASON,
        onRetry: onRetry,
        // The notice above the list already says what is missing for a group, and each row of such a group says it too
        extraLimits: [...(subscriptionsNotRead ? [subscriptionsNotRead] : []), ...workspaceLimits],
        buildRows: (input: { events: readonly AuditEvent[]; days: number; now: Date; emergencyIds: ReadonlySet<string>; format: AuditFormat }) =>
            buildAzureNoActivationRows({ ...input, assignments: scopedAssignments, scopes, holderKinds, privilege: privilege.lookup, membership, pimGroups, entraLog, entraLogDays, unreadScopeIds: notRead.map((entry) => entry.scopeId) }),
    }), [membership, onRetry, subscriptionsNotRead, workspaceLimits, scopedAssignments, scopes, holderKinds, privilege.lookup, pimGroups, entraLog, entraLogDays, notRead]);
    const roles = myRoles !== null && myRoles !== "failed" ? myRoles : null;

    const unreadable = (
        <section data-visual-section="azure-audit-unreadable" className={CARD}>
            <h2 className="mb-2 text-xl leading-[26px] font-semibold text-ink">Your account can read none of this</h2>
            <p className="mt-1 text-sm leading-5 text-body">{UNREADABLE_TEXT}</p>
            {roles !== null && hasMyRolesContent(roles) && <MyAzureRoles roles={roles} />}
            <div className="mt-4">
                <Button icon="refresh" onClick={onRefresh}>Refresh</Button>
            </div>
        </section>
    );

    return (
        <AuditView
            status={isUnreadable ? "ready" : status}
            events={scoped}
            windowStart={windowStart}
            readAt={readAt}
            loadedCount={loadedCount}
            requestedDays={requestedDays}
            maxDays={maxDays}
            ownLogDays={AZURE_AUDIT_MAX_DAYS}
            source={{
                kind: workspaceRead ? "workspace" : "graph",
                label: coverage.label,
                // With nothing to list there is nothing to say is missing from it
                notice: isUnreadable ? null : notice,
                coverageNotes: coverage.notes,
                notRead: exportNotRead,
                exportLabel: coverage.label,
                // Settings is where a workspace is checked; without one there is nothing to check there
                hasSettingsLink: workspace !== null,
                // The Entra audit log is read and granted on the Entra Audit page
                hasEntraAuditLink: groupLogNotice !== null && entraLog !== "read",
            }}
            isRequestingPermission={false}
            now={now}
            emergencyIds={emergencyIds}
            url={url}
            details={details}
            refresh={refresh}
            onGrant={() => undefined}
            onRetry={onRetry}
            onLoadDays={onLoadDays}
            format={format}
            privilege={privilege}
            startFiltersOpen={startFiltersOpen}
            startExportOpen={startExportOpen}
            exportScopeBar={exportScopeBar}
            exportContext={exportContext ? { tenant: { id: homeTenantId ?? "", name: exportContext.tenantName }, exporter: exportContext.exporter, appVersion: exportContext.appVersion } : undefined}
            assignments={noActivation}
            hasEnvironment={false}
            hasScopeLevel
            noteOf={(event) => (azureFailureMessage(event) ? null : azureApproverNote(event, entraLog, now, entraLogDays))}
            emptyState={isUnreadable ? unreadable : undefined}
            banner={banner && workspace === null && !isUnreadable ? { onDismiss: banner.onDismiss, days: AZURE_AUDIT_MAX_DAYS, logName: "Azure activity log" } : undefined}
            copy={{
                subtitle: "Who activated what, and what changed, on the Azure scopes you can read.",
                searchLabel: "Person, role, ticket or scope",
                idleSearchLabel: "Person, role, group or scope",
                readingLabel: "Reading the Azure logs",
                readingText: (count) => readingText(progress, count),
                readFailedTitle: "The Azure logs could not be loaded",
                nothingTitle: "Nothing in what you can read",
                nothingText: (days) => `No PIM activations or changes in the last ${days} days, on the scopes you can read. Azure leaves out what your roles cannot see without saying so, so this does not prove that nothing happened.`,
            }}
            scopeBar={isUnreadable ? undefined : (
                <div data-visual-section="azure-audit-scope-bar">
                <AzureScopeBar
                    scopes={[...scopes]}
                    chosenScopeId={chosenScopeId}
                    homeTenantId={homeTenantId}
                    tenantName={tenantName}
                    includeInherited={url.includeInherited}
                    includeDelegated={url.includeDelegated}
                    onSelectScope={url.setScope}
                    onIncludeInheritedChange={url.setIncludeInherited}
                    onIncludeDelegatedChange={url.setIncludeDelegated}
                    isCompact={!details.isDetailed}
                />
                </div>
            )}
        />
    );
}
