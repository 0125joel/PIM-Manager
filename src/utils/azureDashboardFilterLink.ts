/**
 * The link from the Azure dashboard to the Azure Report: which Report filters a click on the dashboard opens. Every
 * patch is checked against the dashboard counts (`computeAzureEasyToMiss`), so "Open in report" lands on the same rows.
 * Pure logic, no React, no service.
 */
import type { DashboardFilter } from "@/types/dashboardFilter.types";
import type { AzureCardId, AzureEasyToMissId } from "@/utils/azureDashboardStats";
import { AZURE_FILTER_KEYS, EMPTY_AZURE_FILTERS, type AzureReportFilters } from "@/utils/azureReport";
import { buildAzureReportSearch } from "@/utils/azureReportFilter";

export type AzureFilterPatch = Partial<Omit<AzureReportFilters, "query">>;

/**
 * The Report filters of a dashboard click: neutral everywhere except the patch. Origin comes from the scope bar
 * (All with Include inherited, else This scope) unless the patch sets it.
 */
export function reportFiltersFor(patch: AzureFilterPatch, includeInherited: boolean): AzureReportFilters {
    return { ...EMPTY_AZURE_FILTERS, origin: includeInherited ? "all" : "here", ...patch };
}

/** Every Entra target the reused Entra blocks can emit, with its patch (WhoBlock, TermsBlock, HasAccessSection, ActivationSection) */
const ENTRA_TARGETS: { target: DashboardFilter; patch: AzureFilterPatch }[] = [
    { target: { assignment: "permanent" }, patch: { status: "active", ends: "permanent" } },
    { target: { assignment: "eligible" }, patch: { status: "eligible" } },
    { target: { assignment: "activeTimeBound" }, patch: { status: "active", ends: "timeBound" } },
    ...(["entraMfa", "authContext", "neither"] as const).map((mfa) => ({ target: { mfa } as DashboardFilter, patch: { mfa } as AzureFilterPatch })),
    ...(["required", "notRequired"] as const).map((approval) => ({ target: { approval } as DashboardFilter, patch: { approval } as AzureFilterPatch })),
    ...(["required", "notRequired"] as const).map((justification) => ({ target: { justification } as DashboardFilter, patch: { justification } as AzureFilterPatch })),
    ...(["upTo1h", "upTo4h", "upTo8h", "upTo12h", "over12h", "over8h"] as const).map((maxDuration) => ({ target: { maxDuration } as DashboardFilter, patch: { maxDuration } as AzureFilterPatch })),
    ...(["direct", "group"] as const).map((via) => ({ target: { via } as DashboardFilter, patch: { via } as AzureFilterPatch })),
];

function sameKeys(a: DashboardFilter, b: DashboardFilter): boolean {
    const keys = Object.keys(a) as (keyof DashboardFilter)[];
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** The patch of every Entra target the reused Entra blocks can emit; null for any other target */
export function patchForEntraTarget(target: DashboardFilter): AzureFilterPatch | null {
    const entry = ENTRA_TARGETS.find((e) => sameKeys(e.target, target));
    return entry ? { ...entry.patch } : null;
}

function sameExceptOriginAndQuery(a: AzureReportFilters, b: AzureReportFilters): boolean {
    return AZURE_FILTER_KEYS.every((key) => key === "origin" || a[key] === b[key]);
}

/** The Entra target whose patch equals the current filters, for the pressed state of the Entra blocks; {} when none */
export function entraTargetFor(filters: AzureReportFilters): DashboardFilter {
    const entry = ENTRA_TARGETS.find((e) => sameExceptOriginAndQuery(reportFiltersFor(e.patch, false), filters));
    return entry ? { ...entry.target } : {};
}

export const CARD_PATCHES: Record<AzureCardId, AzureFilterPatch | null> = {
    roleScope: null,
    activeNow: { status: "active" },
    permanent: { status: "active", ends: "permanent" },
    eligible: { status: "eligible" },
    privileged: { privileged: true },
    requireApproval: { privileged: true, approval: "required" },
    customRoles: { customRole: true },
    // The page uses it only at a chosen scope with Include inherited on (spec Q3)
    inherited: { origin: "inherited" },
};

export const EASY_TO_MISS_PATCHES: Record<AzureEasyToMissId, AzureFilterPatch> = {
    permanentOwners: { status: "active", ends: "permanent", role: "8e3af657-a8ff-443c-a75c-2fe8c4bcb635", level: "subscriptionOrAbove", excludeEmergency: true },
    eligibleWithoutEnd: { status: "eligible", ends: "permanent" },
    apps: { principalType: "app", privileged: true },
    managedIdentities: { principalType: "managedIdentity", privileged: true },
    agents: { principalType: "agent" },
    guests: { principalType: "guest" },
    deleted: { principalType: "deleted" },
    nobodyNotified: { privileged: true, notified: "none" },
    onlyPermanent: { privileged: true, status: "active", noEligible: true },
};

/** Every field equal, the query included */
export function isSameAzureFilter(a: AzureReportFilters, b: AzureReportFilters): boolean {
    return a.query === b.query && AZURE_FILTER_KEYS.every((key) => a[key] === b[key]);
}

/** `/azure/report?scope=...&f=...` through `buildAzureReportSearch`, with `view` null */
export function reportHrefFor(filters: AzureReportFilters, chosenScopeId: string | null): string {
    const search = buildAzureReportSearch({ view: null, scopeId: chosenScopeId, roleId: null, filters });
    return search === "" ? "/azure/report" : `/azure/report?${search}`;
}
