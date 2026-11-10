"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ReportLayout } from "@/app/report/components/ReportLayout";
import { ReadabilityLine } from "@/app/azure/components/ReadabilityLine";
import { DetailsProvider } from "@/contexts/DetailsContext";
import type { AzureAssignment, AzureScope } from "@/types/azureResource.types";
import { DEFAULT_AZURE_FILTERS, EMPTY_AZURE_FILTERS, buildAssignmentRows, hiddenInheritedCount, type AzureFilterContext, defaultScopeId, findScope, flattenScopeTree, visibleScopeRows, type AzureReportFilters as Filters } from "@/utils/azureReport";
import { getAzureFilterChips, removeAzureFilterKey } from "@/utils/azureReportFilter";
import { buildAzureReadability } from "@/utils/azureReadability";
import { isFiltered } from "@/utils/azureReportStates";
import { baseFiltersOf, buildAzureRoleDetail, buildAzureRoleList, noMfaSignalFor, privilegedRoleIds, sortAzureRoles, type AzureListView, type AzureRoleDetailModel } from "@/utils/azureRoleView";
import type { AzureExportView } from "@/utils/azureExportPlan";
import type { ReportSort } from "@/utils/reportList";
import type { PolicyTabId } from "@/utils/policyView";
import { AssignmentCards } from "./AssignmentCards";
import { AssignmentTable } from "./AssignmentTable";
import { AzureFilterPanel } from "./AzureFilterPanel";
import { AzureReportHead } from "./AzureReportHead";
import { AzureReportToolbar } from "./AzureReportToolbar";
import { AzureRoleList } from "./AzureRoleList";
import { ScopeTree } from "./ScopeTree";
import { VisibilityLine } from "./VisibilityLine";

const NO_IDS: ReadonlySet<string> = new Set();
const NO_CONTEXT: AzureFilterContext = {};

/** The policies of a few roles at one scope, per role GUID (lowercase); the page passes `useAzureRolePolicies` */
export type UsePrivilegedPolicies = (scopeId: string | null, roleDefinitionIds: readonly string[], isEnabled: boolean) => ReadonlyMap<string, { status: string; rules?: readonly unknown[] }>;

const NO_POLICIES: ReadonlyMap<string, { status: string }> = new Map();
const useNoPolicies: UsePrivilegedPolicies = () => NO_POLICIES;

interface AzureReportBodyProps {
    scopes: AzureScope[];
    assignments: AzureAssignment[];
    /** The selected scope id of the URL; null selects the default scope */
    selectedId: string | null;
    /** The filters of the URL, search included */
    filters: Filters;
    onSelectScope: (id: string) => void;
    onQueryChange: (query: string) => void;
    onFiltersChange: (filters: Filters) => void;
    /** Export is shown when this is passed; it gets what the table shows */
    onExport?: (view: AzureExportView) => void;
    onOpenRole?: (assignment: AzureAssignment) => void;
    /** Roles or Assignments: the view of the URL */
    view: AzureListView;
    onViewChange: (view: AzureListView) => void;
    /** The role of the URL; null shows the first role of the list */
    roleId: string | null;
    onSelectRole: (id: string) => void;
    onClearRole: () => void;
    getShareUrl: (roleId: string) => string;
    /** The detail of the shown role; the page reads its description and policy, the fixture passes fixed states */
    renderRoleDetail: (props: { detail: AzureRoleDetailModel; scope: AzureScope; isHiddenByFilter: boolean; getShareUrl: () => string; tab: PolicyTabId; onTabChange: (tab: PolicyTabId) => void; spTypes?: ReadonlyMap<string, string> | null }) => ReactNode;
    /**
     * Reads the policies of the privileged roles in the role list at the scope, for "No MFA on activation" (Azure spec
     * 15.6). A hook, passed so the fixture route needs no ARM; without it the signal never shows.
     */
    usePrivilegedPolicies?: UsePrivilegedPolicies;
    /** The 429 and error boxes, shown above the filters */
    notice?: ReactNode;
    /** The principal ids (lowercase) marked as emergency access accounts; the tag shows for them */
    emergencyAccountIds?: ReadonlySet<string>;
    /** For the fixture route: the filter panel is open at the start */
    initialIsFiltersOpen?: boolean;
    /** For example "synced 3 min ago", shown in the head next to Refresh */
    syncedText?: string;
    /** The Refresh button of the head */
    refresh?: ReactNode;
    /** The tenant of the user: a subscription of another tenant is marked Delegated in the tree */
    homeTenantId?: string;
    /** What the filters need beyond the assignments (role definitions, service principal types, role settings) */
    filterContext?: AzureFilterContext;
    /** Role settings being read for a filter on settings; null when none is needed */
    settingsProgress?: { done: number; total: number } | null;
    /** Calm details (spec 2.2): whether details show and the checkbox; default details on, no checkbox */
    details?: { isDetailed: boolean; toggle?: ReactNode };
    /** Read the rest: one more round over the resource groups and resources the read budget did not reach */
    onReadRest?: () => void;
    /** A round is going, so Read the rest waits */
    isReadingRest?: boolean;
}

/** The Azure Report: the head, the visibility line, the scope tree (a dialog below 1024 px), the filters and the assignments. */
export function AzureReportBody({ scopes, assignments, selectedId, filters, onSelectScope, onQueryChange, onFiltersChange, onExport, onOpenRole, view, onViewChange, roleId, onSelectRole, onClearRole, getShareUrl, renderRoleDetail, usePrivilegedPolicies = useNoPolicies, notice, emergencyAccountIds = NO_IDS, initialIsFiltersOpen = false, syncedText, refresh, homeTenantId, filterContext = NO_CONTEXT, settingsProgress = null, details = { isDetailed: true }, onReadRest, isReadingRest = false }: AzureReportBodyProps) {
    const [isFiltersOpen, setIsFiltersOpen] = useState(initialIsFiltersOpen);
    const [isScopeSheetOpen, setIsScopeSheetOpen] = useState(false);
    const [sort, setSort] = useState<ReportSort>("assignments");
    const [tab, setTab] = useState<PolicyTabId>("activation");
    const scopeButton = useRef<HTMLButtonElement>(null);

    const treeRows = useMemo(() => flattenScopeTree(scopes), [scopes]);
    const effectiveId = useMemo(() => findScope(scopes, selectedId)?.id ?? defaultScopeId(scopes), [scopes, selectedId]);
    const selectedScope = useMemo(() => findScope(scopes, effectiveId), [scopes, effectiveId]);
    const visibleRows = useMemo(() => visibleScopeRows(treeRows, effectiveId), [treeRows, effectiveId]);
    const rows = useMemo(() => buildAssignmentRows(assignments, scopes, effectiveId, filters, new Date(), filterContext), [assignments, scopes, effectiveId, filters, filterContext]);
    const total = useMemo(() => buildAssignmentRows(assignments, scopes, effectiveId, EMPTY_AZURE_FILTERS, new Date(), filterContext).length, [assignments, scopes, effectiveId, filterContext]);
    // The role view: the roles of the scope under the Origin, with the search and filters marking the list (G6a rules)
    const baseRows = useMemo(() => buildAssignmentRows(assignments, scopes, effectiveId, baseFiltersOf(filters), new Date(), filterContext), [assignments, scopes, effectiveId, filters, filterContext]);
    const unsortedRoles = useMemo(() => buildAzureRoleList(rows, baseRows), [rows, baseRows]);
    // Only the privileged roles need their policy, and only while the role view shows (at most 5 reads per scope)
    const policies = usePrivilegedPolicies(effectiveId, privilegedRoleIds(unsortedRoles), view === "roles");
    const roleList = useMemo(
        () => sortAzureRoles(unsortedRoles.map((row) => ({ ...row, hasNoMfaSignal: noMfaSignalFor(row.isPrivileged, policies.get(row.id)) })), sort),
        [unsortedRoles, policies, sort],
    );
    const roleTotal = useMemo(() => buildAzureRoleList(baseRows, baseRows).length, [baseRows]);
    const selectedRoleId = useMemo(() => {
        if (roleId === null) return null;
        const wanted = roleId.toLowerCase();
        return baseRows.some((row) => row.assignment.roleDefinitionId.toLowerCase() === wanted) ? wanted : null;
    }, [roleId, baseRows]);
    const shownRoleId = selectedRoleId ?? roleList[0]?.id ?? null;
    const isShownHidden = selectedRoleId !== null && !roleList.some((r) => r.id === selectedRoleId);
    const detail = useMemo(
        () => (shownRoleId && effectiveId ? buildAzureRoleDetail(shownRoleId, rows, baseRows, effectiveId, filters) : null),
        [shownRoleId, rows, baseRows, effectiveId, filters],
    );
    const roleNames = useMemo(() => {
        const names = new Map<string, string>();
        for (const a of assignments) names.set(a.roleDefinitionId.toLowerCase(), a.roleName);
        return names;
    }, [assignments]);
    const chips = useMemo(() => getAzureFilterChips(filters, roleNames), [filters, roleNames]);
    const resourceTypes = useMemo(() => scopes.flatMap((s) => (s.resourceType ? [s.resourceType] : [])), [scopes]);
    const hiddenInherited = useMemo(() => hiddenInheritedCount(assignments, scopes, effectiveId, filters, filterContext), [assignments, scopes, effectiveId, filters, filterContext]);
    // The settings the Report has read; it reads them only for a policy filter, so the root pairs are what it always knows
    const readability = useMemo(
        () => buildAzureReadability({ scopes, assignments, definitions: filterContext.definitions ?? null, settings: filterContext.settings ?? new Map(), homeTenantId, includeDelegated: true }),
        [scopes, assignments, filterContext.definitions, filterContext.settings, homeTenantId],
    );
    const isNarrowed = chips.length > 0 || filters.query.trim() !== "";
    const countText = view === "roles"
        ? (roleTotal > 0 && (details.isDetailed || isNarrowed || roleList.length < roleTotal) ? `${roleList.length} of ${roleTotal} roles on this scope` : null)
        : (total > 0 && (details.isDetailed || isNarrowed || rows.length < total) ? `${rows.length} of ${total} assignments` : null);

    // Dialog returns focus to its opener only when the user closes it; a close by the parent does not, so the body does it
    const handleSheetSelect = (id: string) => {
        onSelectScope(id);
        setIsScopeSheetOpen(false);
        requestAnimationFrame(() => scopeButton.current?.focus());
    };

    return (
        <DetailsProvider isDetailed={details.isDetailed}>
            <div className="mx-auto max-w-[1376px]">
                <AzureReportHead scopeName={selectedScope?.name ?? null} origin={filters.origin} onExport={onExport ? () => onExport({ rows, scope: selectedScope, filters }) : undefined} syncedText={syncedText} refresh={refresh} detailsToggle={details.toggle} />
                {details.isDetailed ? <VisibilityLine className="mt-4" readability={readability} onReadRest={onReadRest} isReadingRest={isReadingRest} /> : <div className="mt-4"><ReadabilityLine readability={readability} onReadRest={onReadRest} isReadingRest={isReadingRest} /></div>}
                {scopes.length > 0 && (
                    <div className="mt-4 grid items-start gap-4 lg:grid-cols-[272px_minmax(0,1fr)]">
                        <aside className="rounded border border-line bg-surface p-3 max-lg:hidden lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto" data-tour="azure-scope">
                            <ScopeTree rows={visibleRows} selectedId={effectiveId} onSelect={onSelectScope} homeTenantId={homeTenantId} />
                        </aside>
                        <div className="flex min-w-0 flex-col gap-4">
                            <div className="lg:hidden" data-tour="azure-scope">
                                <Button ref={scopeButton} onClick={() => setIsScopeSheetOpen(true)} className="max-w-full max-sm:w-full">
                                    <span className="min-w-0 truncate">{`Scope: ${selectedScope?.name ?? ""}`}</span>
                                </Button>
                            </div>
                            {notice}
                            <AzureReportToolbar
                                view={view}
                                onViewChange={onViewChange}
                                roleCount={roleTotal}
                                assignmentCount={total}
                                query={filters.query}
                                onQueryChange={onQueryChange}
                                filterCount={chips.length}
                                isFiltersOpen={isFiltersOpen}
                                onFiltersToggle={() => setIsFiltersOpen((open) => !open)}
                                panel={<AzureFilterPanel filters={filters} onChange={onFiltersChange} resourceTypes={resourceTypes} />}
                                chips={chips}
                                onRemoveChip={(key) => onFiltersChange(removeAzureFilterKey(filters, key))}
                                onClearAll={() => onFiltersChange(DEFAULT_AZURE_FILTERS)}
                                resultText={countText}
                            />
                            {settingsProgress && (
                                <p role="status" className="mt-2 text-[13px] leading-[18px] text-muted">{`Reading role settings for this filter: ${settingsProgress.done} of ${settingsProgress.total}`}</p>
                            )}
                            {rows.length === 0 && (
                                <div data-visual-section="azure-no-result" className="rounded border border-line bg-surface p-4">
                                    {hiddenInherited > 0 ? (
                                        <div className="flex flex-wrap items-center gap-3">
                                            <p className="text-sm leading-5 text-body">{`No assignments on this scope itself. ${hiddenInherited} ${hiddenInherited === 1 ? "is" : "are"} inherited from above.`}</p>
                                            <Button onClick={() => onFiltersChange({ ...filters, origin: "all" })}>Show inherited</Button>
                                        </div>
                                    ) : isFiltered(filters) ? (
                                        <div className="flex flex-wrap items-center gap-3">
                                            <p className="text-sm leading-5 text-body">No assignments match these filters.</p>
                                            <Button onClick={() => { onQueryChange(""); onFiltersChange(DEFAULT_AZURE_FILTERS); }}>Clear filters</Button>
                                        </div>
                                    ) : (
                                        <p className="text-sm leading-5 text-body">No assignments on this scope.</p>
                                    )}
                                </div>
                            )}
                            {rows.length > 0 && view === "roles" && (
                                <ReportLayout
                                    list={<AzureRoleList rows={roleList} currentId={shownRoleId ?? undefined} onSelect={onSelectRole} sort={sort} onSortChange={setSort} />}
                                    detail={detail && selectedScope ? renderRoleDetail({ detail, scope: selectedScope, isHiddenByFilter: isShownHidden, getShareUrl: () => getShareUrl(detail.id), tab, onTabChange: setTab, spTypes: filterContext.spTypes }) : null}
                                    hasSelection={selectedRoleId !== null}
                                    backLabel="All roles"
                                    onBack={onClearRole}
                                    wideFrom="xl"
                                />
                            )}
                            {rows.length > 0 && view === "assignments" && (
                                <p className="text-right text-[13px] leading-[18px] text-muted max-sm:hidden">Hover or focus a tag for what it means</p>
                            )}
                            {rows.length > 0 && view === "assignments" && (
                                <>
                                    <AssignmentTable rows={rows} emergencyAccountIds={emergencyAccountIds} onOpenRole={onOpenRole} spTypes={filterContext.spTypes} showOrigin={details.isDetailed || filters.origin !== "here"} />
                                    <AssignmentCards rows={rows} emergencyAccountIds={emergencyAccountIds} onOpenRole={onOpenRole} spTypes={filterContext.spTypes} />
                                </>
                            )}
                        </div>
                    </div>
                )}
                <Dialog isOpen={isScopeSheetOpen} onClose={() => setIsScopeSheetOpen(false)} title="Scope" width={400}>
                    <ScopeTree rows={visibleRows} selectedId={effectiveId} onSelect={handleSheetSelect} homeTenantId={homeTenantId} />
                </Dialog>
            </div>
        </DetailsProvider>
    );
}
