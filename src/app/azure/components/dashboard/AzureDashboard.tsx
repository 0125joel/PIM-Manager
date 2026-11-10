"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { ScopeControl } from "@/app/dashboard/components/advanced/ScopeControl";
import { DashboardHead } from "@/app/dashboard/components/basic/DashboardHead";
import { CardGridView, type CardGridItem } from "@/app/dashboard/components/basic/CardGrid";
import { EasyToMissBlock } from "@/app/dashboard/components/basic/EasyToMissBlock";
import { FilterBarView, type FilterBarChip } from "@/app/dashboard/components/basic/FilterBar";
import { TermsBlock } from "@/app/dashboard/components/basic/TermsBlock";
import { TipBar } from "@/app/dashboard/components/basic/TipBar";
import { WhoBlock } from "@/app/dashboard/components/basic/WhoBlock";
import { AzureLoadError } from "@/app/azure/report/components/AzureLoadError";
import { AzureReportEmpty } from "@/app/azure/report/components/AzureReportEmpty";
import { ThrottleNotice } from "@/app/azure/report/components/ThrottleNotice";
import { DataWarningBanner } from "@/components/DataWarningBanner";
import { ReadabilityLine } from "@/app/azure/components/ReadabilityLine";
import { LoadingSentence } from "@/components/LoadingStatus";
import { SyncStatusView } from "@/components/SyncStatus";
import { DetailsToggle } from "@/components/ui/DetailsToggle";
import { RefreshButtonView } from "@/components/ui/RefreshButton";
import { useViewMode, type ViewMode } from "@/contexts/ViewModeContext";
import { useAzureActions, useAzureData, useAzureLoading } from "@/contexts/AzureContext";
import { useArmThrottle } from "@/hooks/useArmThrottle";
import { useMyAzureRoles } from "@/hooks/useMyAzureRoles";
import { useAzureConsent } from "@/hooks/useAzureConsent";
import { definitionsOf, resetAzureDashboardForRefresh, useAzureDashboardReads, type AzureDashboardReads } from "@/hooks/useAzureDashboardReads";
import { useEmergencyAccountIds } from "@/hooks/useEmergencyAccountIds";
import { useDashboardScope } from "@/hooks/useDashboardScope";
import { useShowDetails } from "@/hooks/useShowDetails";
import { useTourPage } from "@/hooks/useTourPage";
import { useEscapeClearsFilter } from "@/hooks/useEscapeClearsFilter";
import { useNow } from "@/hooks/useNow";
import { useTenantName } from "@/hooks/useTenantName";
import type { ArmRoleDefinition, AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { findScope, type AzureFilterContext, type AzureReportFilters } from "@/utils/azureReport";
import { buildAzureReportSearch, getAzureFilterChips, parseAzureReportUrlState, removeAzureFilterKey, type AzureReportUrlState } from "@/utils/azureReportFilter";
import { CARD_PATCHES, EASY_TO_MISS_PATCHES, entraTargetFor, isSameAzureFilter, patchForEntraTarget, reportFiltersFor, reportHrefFor, type AzureFilterPatch } from "@/utils/azureDashboardFilterLink";
import {
    computeAzureCards,
    computeAzureEasyToMiss,
    computeAzureTerms,
    computeAzureWho,
    countAzureSettingsFailed,
    type AzureCardId,
    type AzureDashboardInput,
} from "@/utils/azureDashboardStats";
import type { DashboardScope } from "@/utils/dashboardAdvanced";
import { azureScopePath, buildAzureDashboardView, hasPartialInView } from "@/utils/azureDashboardView";
import { buildAzureTips } from "@/utils/azureTipRules";
import { azurePolicyKey, isDelegatedScope, isRootScope } from "@/utils/azureScopes";
import { isPrivilegedRole } from "@/utils/azureDashboard";
import { azureReportView, type AzureReportView, type MyAzureRolesState } from "@/utils/azureReportStates";
import { buildAzureReadability, unreadSentence } from "@/utils/azureReadability";
import { ReadRest } from "@/app/azure/components/ReadRest";
import { POLICY_NOT_READABLE } from "@/utils/policyReadAccess";
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { AzureAlertsBlock } from "./basic/AzureAlertsBlock";
import { AzureScopeBar } from "./basic/AzureScopeBar";
import { AzureAdvancedSections } from "./advanced/AzureAdvancedSections";
import { AzureDashboardExportDialog } from "./AzureDashboardExportDialog";

const EMPTY_SP_TYPES: ReadonlyMap<string, string> = new Map();

const CARDS: { id: AzureCardId; label: string }[] = [
    { id: "roleScope", label: "Role × scope" },
    { id: "activeNow", label: "Active now" },
    { id: "permanent", label: "Permanent" },
    { id: "eligible", label: "Eligible" },
    { id: "privileged", label: "Privileged roles" },
    { id: "requireApproval", label: "Require approval" },
    { id: "customRoles", label: "Custom roles" },
    { id: "inherited", label: "Inherited" },
];

export interface AzureDashboardBodyProps {
    scopes: AzureScope[];
    assignments: AzureAssignment[];
    homeTenantId?: string;
    /** The display name of the user's tenant; "your tenant" until it is known */
    tenantName: string;
    /** The scope chosen in the scope bar; null = "All you can read" */
    chosenScopeId: string | null;
    /** The Report's filters; `origin` other than This scope is Include inherited */
    filters: AzureReportFilters;
    includeDelegated: boolean;
    reads: AzureDashboardReads;
    emergencyIds: ReadonlySet<string>;
    now: Date;
    /** The Azure data is not complete yet: the numbers show skeletons */
    isLoading: boolean;
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    /** Advanced only: Privileged roles or All roles */
    advancedScope: DashboardScope;
    onAdvancedScopeChange: (scope: DashboardScope) => void;
    /** 429: every ARM request waits */
    isThrottled: boolean;
    /** What the page shows: loading, failed (nothing loaded), empty (nothing readable) or report */
    view: AzureReportView;
    /** The message of a failed load; with data from before the page keeps its numbers */
    error?: string;
    /** Try again of the error box is busy */
    isRetrying?: boolean;
    /** The user's own Azure roles, for the empty state */
    myRoles: MyAzureRolesState;
    /** Privileged role x scope pairs whose settings cannot be read, of all privileged pairs; null when none */
    notReadable: { n: number; m: number } | null;
    /** `SyncStatusView` and the Refresh button, built by the page */
    syncStatus: ReactNode;
    refresh: ReactNode;
    /** Refresh to retry, on the incomplete data banner */
    onRefresh: () => void;
    onSelectScope: (id: string | null) => void;
    onFiltersChange: (filters: AzureReportFilters) => void;
    onIncludeDelegatedChange: (isOn: boolean) => void;
    /** Export: who exports, the version and when the data was read, for the header of the document */
    exporter?: string;
    version?: string;
    dataReadAt?: Date;
    /** The export dialog is open on load (the fixture) */
    isExportInitiallyOpen?: boolean;
    /** The message of the running load; the Report's fallback text when empty */
    loadingMessage?: string;
    /** Calm details (spec 2.2): whether details show and the checkbox; default details on and no checkbox */
    details?: { isDetailed: boolean; canToggle: boolean; setDetailed: (isDetailed: boolean) => void };
    /** Read the rest: one more round over the resource groups and resources the read budget did not reach */
    onReadRest?: () => void;
    /** A round is going, so Read the rest waits */
    isReadingRest?: boolean;
}

/** The Basic view of the Azure dashboard (dashboard spec 6): everything comes in as props, so a fixture can render it without contexts. */
export function AzureDashboardBody({ scopes, assignments, homeTenantId, tenantName, chosenScopeId, filters, includeDelegated, reads, emergencyIds, now, isLoading, isThrottled, view, error, isRetrying = false, myRoles, notReadable, viewMode, onViewModeChange, advancedScope, onAdvancedScopeChange, syncStatus, refresh, onRefresh, onSelectScope, onFiltersChange, onIncludeDelegatedChange, exporter = "unknown", version = "", dataReadAt, isExportInitiallyOpen = false, loadingMessage, details = { isDetailed: true, canToggle: false, setDetailed: () => undefined }, onReadRest, isReadingRest = false }: AzureDashboardBodyProps) {
    const [isExportOpen, setIsExportOpen] = useState(isExportInitiallyOpen);
    // Origin This scope is the default; All and Inherited both keep what is above the chosen scope in view
    const includeInherited = filters.origin !== "here";
    const neutral = useMemo(() => reportFiltersFor({}, includeInherited), [includeInherited]);

    const definitions = definitionsOf(reads.definitions);
    const definitionsFailed = reads.definitions.status === "failed";
    const spTypes = reads.spTypes.status === "loaded" ? reads.spTypes.byId : reads.spTypes.status === "none" ? EMPTY_SP_TYPES : null;
    const context = useMemo<AzureFilterContext>(
        () => ({ ...(definitions ? { definitions } : {}), ...(spTypes ? { spTypes } : {}), settings: reads.settings, emergencyIds }),
        [definitions, spTypes, reads.settings, emergencyIds],
    );
    const isDetailed = details.isDetailed;
    const readability = useMemo(
        () => buildAzureReadability({ scopes, assignments, definitions, settings: reads.settings, homeTenantId, includeDelegated }),
        [scopes, assignments, definitions, reads.settings, homeTenantId, includeDelegated],
    );

    const { inView, counted } = useMemo(
        () => buildAzureDashboardView({ assignments, scopes, chosenScopeId, includeInherited, includeDelegated, homeTenantId, filters, context, now }),
        [assignments, scopes, chosenScopeId, includeInherited, includeDelegated, homeTenantId, filters, context, now],
    );

    const input = useMemo<AzureDashboardInput>(
        () => ({ assignments: counted, scopes, homeTenantId, definitions, settings: reads.settings, spTypes, emergencyIds, now, isTopScope: chosenScopeId === null, chosenScopeId, scope: "privileged", spTypesFailed: reads.spTypes.status === "failed", isDeletedUnknown: reads.spTypes.status === "failed" || (reads.spTypes.status === "loaded" && !reads.spTypes.isDeletedChecked), definitionsFailed }),
        [counted, scopes, homeTenantId, definitions, reads.settings, reads.spTypes, spTypes, emergencyIds, now, chosenScopeId, definitionsFailed],
    );

    // The same input with the filter left out, for "Apply the current filter" off in the export
    const inputWithoutFilter = useMemo<AzureDashboardInput>(() => ({ ...input, assignments: inView }), [input, inView]);

    // Advanced counts the roles of its own choice; the cards stay on the Basic input in both views (spec 7)
    const advancedInput = useMemo<AzureDashboardInput>(() => ({ ...input, scope: advancedScope }), [input, advancedScope]);

    const roleNames = useMemo(() => {
        const names = new Map<string, string>();
        for (const a of assignments) names.set(a.roleDefinitionId.toLowerCase(), a.roleName);
        return names;
    }, [assignments]);
    // Origin All is the Include inherited chip of the scope bar, not a filter of its own
    const chips = useMemo(() => getAzureFilterChips(filters, roleNames).filter((chip) => !(chip.key === "origin" && filters.origin === "all")), [filters, roleNames]);
    const isFiltered = chips.length > 0;
    const sentence = `${counted.length} of ${inView.length} assignments. From Microsoft is not affected.`;

    const clearFilter = useCallback(() => onFiltersChange(neutral), [onFiltersChange, neutral]);
    useEscapeClearsFilter(isFiltered, clearFilter);

    const setPatch = (patch: AzureFilterPatch | null) => {
        if (patch === null) return;
        const next = reportFiltersFor(patch, includeInherited);
        onFiltersChange(isSameAzureFilter(filters, next) ? neutral : next);
    };
    // The Entra blocks emit Entra targets: {} clears, a target without a Report counterpart is ignored
    const setTarget = (target: DashboardFilter) => {
        if (Object.keys(target).length === 0) clearFilter();
        else setPatch(patchForEntraTarget(target));
    };

    const cardStats = useMemo(() => (isLoading ? null : computeAzureCards(input)), [isLoading, input]);
    const who = useMemo(() => (isLoading ? null : computeAzureWho(input)), [isLoading, input]);
    const termsResult = useMemo(() => (isLoading ? null : computeAzureTerms(input)), [isLoading, input]);
    const terms = termsResult && !termsResult.isPending ? termsResult : null;
    const easyToMissRows = useMemo(() => (isLoading ? null : computeAzureEasyToMiss(input)), [isLoading, input]);
    const easyToMiss = useMemo(
        () => easyToMissRows?.map((row) => ({ ...row, filter: reportFiltersFor(EASY_TO_MISS_PATCHES[row.id], includeInherited) })) ?? null,
        [easyToMissRows, includeInherited],
    );

    const isChosen = chosenScopeId !== null;
    const cardItems: CardGridItem[] = CARDS.map(({ id, label }) => {
        const stat = cardStats?.[id] ?? null;
        const patch = CARD_PATCHES[id];
        const target = patch ? reportFiltersFor(patch, includeInherited) : null;
        // Inherited filters only at a chosen scope with Include inherited on (spec Q3); roleScope does not filter
        const canFilter = target !== null && stat?.value != null && stat.value !== "-" && (id !== "inherited" || (isChosen && includeInherited));
        const isOffNote = id === "inherited" && isChosen && !includeInherited;
        return {
            id,
            label,
            stat: isOffNote && stat ? { ...stat, breakdown: `${stat.breakdown} · Include inherited is off` } : stat,
            isPressed: target !== null && isSameAzureFilter(filters, target),
            isDimmed: false,
            onSelect: canFilter ? () => setPatch(patch) : undefined,
        };
    });

    const filterChips: FilterBarChip[] = chips.map((chip) => ({ key: chip.key, label: chip.label, onRemove: () => onFiltersChange(removeAzureFilterKey(filters, chip.key)) }));

    const subscriptions = useMemo(() => scopes.filter((s) => s.level === "subscription"), [scopes]);
    const failedCount = subscriptions.filter((s) => s.access === "failed").length;
    // Partial is not a failure: some resource groups and resources are out of view. One neutral notice says so
    const hasPartial = useMemo(() => hasPartialInView(scopes, chosenScopeId, includeDelegated, homeTenantId), [scopes, chosenScopeId, includeDelegated, homeTenantId]);
    const subscriptionsById = useMemo(() => new Map(subscriptions.map((s) => [s.id.toLowerCase().replace(/^\/subscriptions\//, ""), s])), [subscriptions]);
    const subscriptionName = useCallback((id: string) => subscriptionsById.get(id.toLowerCase())?.name ?? id, [subscriptionsById]);
    const isDelegated = useCallback((id: string) => {
        const scope = subscriptionsById.get(id.toLowerCase());
        return scope !== undefined && isDelegatedScope(scope, homeTenantId);
    }, [subscriptionsById, homeTenantId]);
    // "Off leaves delegated subscriptions out of every number": the alerts of a delegated subscription too
    const shownAlerts = useMemo(
        () => (includeDelegated ? reads.alerts : new Map([...reads.alerts].filter(([id]) => !isDelegated(id)))),
        [includeDelegated, reads.alerts, isDelegated],
    );
    const alertable = subscriptions.filter((s) => s.access === undefined && (includeDelegated || !isDelegatedScope(s, homeTenantId))).length;
    const alertsProgress = isLoading ? { done: 0, total: 1 } : { done: Math.min(shownAlerts.size, alertable), total: alertable };

    const tips = useMemo(
        () => buildAzureTips({ counted: inView, settings: reads.settings, scopes, definitions, emergencyIds }),
        [inView, reads.settings, scopes, definitions, emergencyIds],
    );

    const { done, total } = reads.settingsProgress;
    const isReadingSettings = !isLoading && total > 0 && done < total;

    // Role settings whose read failed (5xx, network, 429 after retries): left out of every number about settings, as the
    // Entra dashboard names roles whose policy failed. Over the roles the reads asked for: privileged, or all in Advanced
    const readScope: DashboardScope = viewMode === "advanced" ? advancedScope : "privileged";
    const settingsFailed = useMemo(
        () => (isLoading ? null : countAzureSettingsFailed(assignments, definitions, reads.settings, readScope)),
        [isLoading, assignments, definitions, reads.settings, readScope],
    );
    // What Privileged roles rests on when the role definitions are not complete
    const definitionsNote = reads.definitions.status === "failed"
        ? "The role definitions could not be read, so Privileged roles counts the built-in privileged roles only."
        : reads.definitions.status === "partial"
          ? `The custom roles of ${reads.definitions.failedSubscriptions} of ${reads.definitions.subscriptionCount} subscriptions could not be read, so Privileged roles may leave out custom roles there.`
          : null;

    return (
        <div data-focus-fallback tabIndex={-1} className="mx-auto flex max-w-[1376px] flex-col gap-4 outline-none">
            <div className="mb-2 flex flex-col gap-4 border-b border-line pb-5">
                <DashboardHead viewMode={viewMode} onViewModeChange={onViewModeChange} syncStatus={syncStatus} refresh={refresh} isExportDisabled={isLoading || counted.length === 0} onExport={() => setIsExportOpen(true)} scopeControl={viewMode === "advanced" ? <ScopeControl scope={advancedScope} onChange={onAdvancedScopeChange} /> : undefined} detailsToggle={details.canToggle ? <DetailsToggle isChecked={isDetailed} onChange={details.setDetailed} /> : undefined} />
                <AzureScopeBar
                    scopes={scopes}
                    chosenScopeId={chosenScopeId}
                    homeTenantId={homeTenantId}
                    tenantName={tenantName}
                    includeInherited={includeInherited}
                    includeDelegated={includeDelegated}
                    onSelectScope={onSelectScope}
                    onIncludeInheritedChange={(isOn) => onFiltersChange({ ...filters, origin: isOn ? "all" : "here" })}
                    onIncludeDelegatedChange={onIncludeDelegatedChange}
                    isVisibilityHidden={view === "loading"}
                    isCompact={!isDetailed}
                />
                {!isDetailed && view !== "loading" && <ReadabilityLine readability={readability} reportHref={reportHrefFor(neutral, chosenScopeId)} onReadRest={onReadRest} isReadingRest={isReadingRest} />}
                {view === "loading" && <LoadingSentence sentence={loadingMessage || "Loading Azure role assignments..."} />}
                {isReadingSettings && <LoadingSentence sentence={`Reading role settings, ${done} of ${total}`} />}
            </div>

            {isThrottled && <ThrottleNotice />}
            {view === "failed" && <AzureLoadError message={error ?? "Azure Resource Manager did not answer."} onRetry={onRefresh} isRetrying={isRetrying} />}
            {view === "report" && error && assignments.length > 0 && <AzureLoadError message={`${error} The numbers below are from the last load.`} onRetry={onRefresh} isRetrying={isRetrying} />}
            {view === "empty" && <AzureReportEmpty myRoles={myRoles} />}

            {(view === "loading" || view === "report") && (
                <>
                    {/* One wrapper, only when a notice shows, so the visual check has its own section for the warnings */}
                    {(failedCount > 0 || (settingsFailed && settingsFailed.n > 0) || (definitionsNote && view === "report")) && (
                        <div data-visual-section="azure-notices" className="flex flex-col gap-4">
                            <DataWarningBanner failedCount={failedCount} totalCount={subscriptions.length} onRefresh={onRefresh} className="" unit="subscriptions" />
                            {settingsFailed && <DataWarningBanner failedCount={settingsFailed.n} totalCount={settingsFailed.m} onRefresh={onRefresh} className="" unit={readScope === "all" ? "role × scope settings" : "privileged role × scope settings"} />}
                            {definitionsNote && view === "report" && (
                                <p role="note" className="text-[13px] leading-5 text-body">
                                    {definitionsNote}{" "}
                                    <button type="button" onClick={onRefresh} className="inline-flex min-h-6 items-center text-accent underline underline-offset-2 max-sm:flex max-sm:min-h-11">Refresh to retry</button>
                                </p>
                            )}
                        </div>
                    )}
                    {isDetailed && hasPartial && (
                        <p role="note" data-visual-section={unreadSentence(readability) !== null ? "azure-unread" : undefined} className="text-[13px] leading-5 text-body">
                            Some resource groups and resources in this view are not readable for you.{" "}
                            <Link href={reportHrefFor(neutral, chosenScopeId)} className="text-accent underline underline-offset-2">Open the report</Link> to see what you can read.
                            <ReadRest readability={readability} onReadRest={onReadRest} isReading={isReadingRest} />
                        </p>
                    )}

                    {isDetailed && notReadable && (
                        <p role="note" className="text-[13px] leading-5 text-body">{notReadable.n} of {notReadable.m} privileged role × scope: {POLICY_NOT_READABLE}</p>
                    )}

                    {/* Always mounted so that a change of the filter is announced */}
                    <p role="status" className="sr-only">{isFiltered ? sentence : ""}</p>
                    {isFiltered && <FilterBarView chips={filterChips} sentence={sentence} reportHref={reportHrefFor(filters, chosenScopeId)} />}
                    <div data-visual-section="azure-cards" data-tour="dashboard-cards"><CardGridView items={cardItems} /></div>

                    {viewMode === "basic" ? (
                        <>
                            <div data-visual-section="azure-who-terms" className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <WhoBlock who={who} filter={entraTargetFor(filters)} isFiltered={false} onSetFilter={setTarget} />
                                <TermsBlock terms={terms} isWaitingForSettings={!isLoading && termsResult?.isPending === true} filter={entraTargetFor(filters)} onSetFilter={setTarget} />
                            </div>
                            <div data-visual-section="azure-easy-alerts" data-tour="azure-easy-to-miss" className={isDetailed ? "mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2" : "mt-4 grid grid-cols-1 gap-4"}>
                                <EasyToMissBlock rows={easyToMiss} filter={filters} onSetFilter={onFiltersChange} isSameFilter={isSameAzureFilter} emptyFilter={neutral} isCompact={!isDetailed} />
                                {isDetailed && <AzureAlertsBlock alerts={shownAlerts} progress={alertsProgress} subscriptionName={subscriptionName} isDelegated={isDelegated} isDimmed={isFiltered} />}
                            </div>
                            <div data-visual-section="azure-tips" className="mt-4"><TipBar tips={tips} onSetFilter={setPatch} /></div>
                        </>
                    ) : (
                        <div data-visual-section="azure-advanced"><AzureAdvancedSections input={advancedInput} filters={filters} isFiltered={isFiltered} onSetTarget={setTarget} isSettingsPending={isReadingSettings} isLoading={isLoading} emergencyAccountIds={emergencyIds} isDetailed={isDetailed} reportHref={reportHrefFor(neutral, chosenScopeId)} /></div>
                    )}
                </>
            )}

            {isExportOpen && (
                <AzureDashboardExportDialog
                    isOpen={isExportOpen}
                    onClose={() => setIsExportOpen(false)}
                    input={{
                        stats: input,
                        statsWithoutFilter: inputWithoutFilter,
                        reads,
                        scopeLine: chosenScopeId === null ? "All you can read" : azureScopePath(scopes, chosenScopeId).join(" / ") || "All you can read",
                        includeInherited,
                        includeDelegated,
                        filterSentence: chips.map((chip) => chip.label).join(", "),
                        subscriptionName,
                    }}
                    meta={{ tenantName: tenantName === "your tenant" ? null : tenantName, tenantId: homeTenantId, exporter, version, dataReadAt }}
                />
            )}
        </div>
    );
}

/**
 * The privileged role × scope pairs whose settings cannot be read, of all privileged pairs (root pairs count as not
 * readable, as in the numbers). Null when every pair is readable or still arriving.
 */
export function countNotReadable(
    assignments: AzureAssignment[],
    definitions: ReadonlyMap<string, ArmRoleDefinition> | null,
    settings: AzureDashboardReads["settings"],
): { n: number; m: number } | null {
    const pairs = new Map<string, boolean>();
    for (const a of assignments) {
        if (!isPrivilegedRole(a.roleDefinitionId, definitions)) continue;
        const key = azurePolicyKey(a.scopeId, a.roleDefinitionId);
        if (!pairs.has(key)) pairs.set(key, isRootScope(a.scopeId) || settings.get(key)?.status === "noAccess");
    }
    const n = [...pairs.values()].filter(Boolean).length;
    return n > 0 ? { n, m: pairs.size } : null;
}

/** The Azure dashboard URL: the Report's parameters (`scope`, `f`) and `delegated=0` for delegated subscriptions off */
function useAzureDashboardUrl(): { state: AzureReportUrlState; includeDelegated: boolean; setFilters: (filters: AzureReportFilters) => void; setScope: (id: string | null) => void; setIncludeDelegated: (isOn: boolean) => void } {
    const router = useRouter();
    const pathname = usePathname() ?? "/azure";
    const searchParams = useSearchParams();
    const search = searchParams?.toString() ?? "";
    const state = useMemo(() => parseAzureReportUrlState(search), [search]);
    const includeDelegated = useMemo(() => new URLSearchParams(search).get("delegated") !== "0", [search]);

    const write = useCallback((next: AzureReportUrlState, delegated: boolean) => {
        const base = new URLSearchParams(search);
        if (delegated) base.delete("delegated");
        else base.set("delegated", "0");
        const query = buildAzureReportSearch({ view: null, scopeId: next.scopeId, roleId: null, filters: next.filters }, base.toString());
        // A filter or scope change is a history entry, as the Report's
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [router, pathname, search]);

    const setFilters = useCallback((filters: AzureReportFilters) => write({ ...state, filters }, includeDelegated), [write, state, includeDelegated]);
    const setScope = useCallback((id: string | null) => write({ ...state, scopeId: id }, includeDelegated), [write, state, includeDelegated]);
    const setIncludeDelegated = useCallback((isOn: boolean) => write(state, isOn), [write, state]);
    return { state, includeDelegated, setFilters, setScope, setIncludeDelegated };
}

/** The Azure dashboard (dashboard spec 6): the data container; the body is `AzureDashboardBody` */
export function AzureDashboard() {
    const url = useAzureDashboardUrl();
    const { scopes, assignments, error, lastFetched } = useAzureData();
    const { loading } = useAzureLoading();
    const { load, refresh, readRest } = useAzureActions();
    const { isEnabled } = useAzureConsent();
    const { viewMode, setViewMode } = useViewMode();
    const details = useShowDetails(viewMode === "advanced" ? "azure-dashboard-advanced" : "azure-dashboard-basic");
    const [advancedScope, setAdvancedScope] = useDashboardScope("azure-dashboard-scope");
    const { accounts } = useMsal();
    const homeTenantId = accounts[0]?.tenantId;
    // All roles reads the settings of the other roles too
    const reads = useAzureDashboardReads(viewMode === "advanced" ? advancedScope : "privileged", homeTenantId);
    const emergencyIds = useEmergencyAccountIds();
    const tenantName = useTenantName(homeTenantId) ?? "your tenant";
    const now = useNow();
    const [isRetrying, setIsRetrying] = useState(false);
    const isThrottled = useArmThrottle();
    const view = azureReportView({ phase: loading.phase, scopeCount: scopes.length });
    useTourPage(viewMode === "advanced" ? "azure-dashboard-advanced" : "azure-dashboard-basic", view === "report" && loading.phase === "complete", viewMode, setViewMode);
    const myRoles = useMyAzureRoles(isEnabled && view === "empty");

    // Page mount, and the moment Azure is turned on: load honours the 60 minute TTL and the session cache, and never starts a second run
    useEffect(() => {
        if (isEnabled) void load();
    }, [isEnabled, load]);

    const retry = () => {
        // Role settings and role definitions are read again after a refresh, as the assignments are
        resetAzureDashboardForRefresh();
        setIsRetrying(true);
        void refresh().finally(() => setIsRetrying(false));
    };

    const isBusy = loading.phase === "fetching" || loading.phase === "processing";
    const syncedAt = lastFetched ? new Date(lastFetched) : null;
    // A scope the URL names that is not in the tree (an old link) counts as nothing chosen
    const chosenScopeId = findScope(scopes, url.state.scopeId)?.id ?? null;
    // The filter of the dashboard has no search: a stray q is not applied
    const filters = useMemo<AzureReportFilters>(() => ({ ...url.state.filters, query: "" }), [url.state.filters]);

    return (
        <AzureDashboardBody
            scopes={scopes}
            assignments={assignments}
            homeTenantId={homeTenantId}
            tenantName={tenantName}
            chosenScopeId={chosenScopeId}
            filters={filters}
            includeDelegated={url.includeDelegated}
            reads={reads}
            emergencyIds={emergencyIds}
            now={now}
            isLoading={loading.phase !== "complete" && loading.phase !== "error"}
            isThrottled={isThrottled}
            view={view}
            error={error}
            isRetrying={isRetrying}
            myRoles={myRoles}
            notReadable={countNotReadable(assignments, definitionsOf(reads.definitions), reads.settings)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            advancedScope={advancedScope}
            onAdvancedScopeChange={setAdvancedScope}
            syncStatus={<SyncStatusView lastSyncedAt={syncedAt} isLoading={isBusy} />}
            refresh={<RefreshButtonView isDisabled={isBusy} isLoading={isRetrying} onRefresh={retry} />}
            onRefresh={retry}
            onSelectScope={url.setScope}
            onFiltersChange={url.setFilters}
            onIncludeDelegatedChange={url.setIncludeDelegated}
            exporter={accounts[0]?.name ? `${accounts[0].name} (${accounts[0].username})` : accounts[0]?.username ?? "unknown"}
            version={process.env.NEXT_PUBLIC_APP_VERSION ?? ""}
            dataReadAt={syncedAt ?? undefined}
            loadingMessage={loading.message}
            details={details}
            onReadRest={() => void readRest()}
            isReadingRest={isBusy}
        />
    );
}
