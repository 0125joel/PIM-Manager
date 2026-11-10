/**
 * The filter of the Azure Report: its URL language (`f=status:eligible,privileged:true`), the chip labels and the controls
 * of the filter panel. Same method as `dashboardFilter.ts` and `reportFilterControls.ts`, with the Azure fields.
 */
import {
    AZURE_FILTER_KEYS,
    DEFAULT_AZURE_FILTERS,
    type AzureEndsFilter,
    type AzureFilterKey,
    type AzureLevelFilter,
    type AzureMaxDurationFilter,
    type AzureMfaFilter,
    type AzurePrincipalFilter,
    type AzureReportFilters,
    type AzureRequiredFilter,
    type AzureStatusFilter,
    type AzureViaFilter,
} from "@/utils/azureReport";
import { resourceIconFor } from "@/utils/azureResourceIcons";
import { isAzureListView, type AzureListView } from "@/utils/azureRoleView";

/** Same shape as `FilterChip` of the Report chips; utils do not import components */
export interface AzureFilterChip {
    key: AzureFilterKey;
    label: string;
}

export type AzureFilterGroup = "Assignments" | "Role properties" | "Scope";

export interface AzureFilterControl {
    key: AzureFilterKey;
    label: string;
    group: AzureFilterGroup;
    neutral: string;
    options: { value: string; label: string }[];
}

const STATUS_VALUES: readonly string[] = ["eligible", "active", "activated", "assigned"];
const PRINCIPAL_VALUES: readonly string[] = ["user", "group", "app", "foreignGroup", "guest", "agent", "managedIdentity", "deleted"];
const ENDS_VALUES: readonly string[] = ["permanent", "within30", "timeBound"];
const LEVEL_VALUES: readonly string[] = ["managementGroup", "subscriptionOrAbove", "subscription", "resourceGroup", "resource"];
const REQUIRED_VALUES: readonly string[] = ["required", "notRequired"];
const MFA_VALUES: readonly string[] = ["entraMfa", "authContext", "neither"];
const MAX_DURATION_VALUES: readonly string[] = ["upTo1h", "upTo4h", "upTo8h", "upTo12h", "over12h", "over8h"];
const VIA_VALUES: readonly string[] = ["direct", "group"];
const ROLE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOURCE_TYPE_PATTERN = /^[a-z0-9]+\.[a-z0-9.]+\/[a-z0-9./]+$/i;

type FilterWithoutQuery = Omit<AzureReportFilters, "query">;

function withoutQuery(filters: AzureReportFilters): FilterWithoutQuery {
    const rest: Partial<AzureReportFilters> = { ...filters };
    delete rest.query;
    return rest as FilterWithoutQuery;
}

function decodeRaw(raw: string): string {
    if (!raw.includes("%")) return raw;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/** Reads the `f` parameter. Unknown keys, unknown values and malformed pairs are ignored; the last valid pair of a key wins. */
export function parseAzureFilter(raw: string | null | undefined): FilterWithoutQuery {
    const result: AzureReportFilters = { ...DEFAULT_AZURE_FILTERS };
    if (!raw) return withoutQuery(result);
    for (const pair of decodeRaw(raw).split(",")) {
        const index = pair.indexOf(":");
        if (index < 0) continue;
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (key === "status" && STATUS_VALUES.includes(value)) result.status = value as AzureStatusFilter;
        else if (key === "origin" && (value === "all" || value === "inherited")) result.origin = value;
        else if (key === "privileged" && value === "true") result.privileged = true;
        else if (key === "principalType" && PRINCIPAL_VALUES.includes(value)) result.principalType = value as AzurePrincipalFilter;
        else if (key === "ends" && ENDS_VALUES.includes(value)) result.ends = value as AzureEndsFilter;
        else if (key === "level" && LEVEL_VALUES.includes(value)) result.level = value as AzureLevelFilter;
        else if (key === "resourceType" && RESOURCE_TYPE_PATTERN.test(value)) result.resourceType = value.toLowerCase();
        else if (key === "customRole" && value === "true") result.customRole = true;
        else if (key === "approval" && REQUIRED_VALUES.includes(value)) result.approval = value as AzureRequiredFilter;
        else if (key === "justification" && REQUIRED_VALUES.includes(value)) result.justification = value as AzureRequiredFilter;
        else if (key === "mfa" && MFA_VALUES.includes(value)) result.mfa = value as AzureMfaFilter;
        else if (key === "maxDuration" && MAX_DURATION_VALUES.includes(value)) result.maxDuration = value as AzureMaxDurationFilter;
        else if (key === "notified" && value === "none") result.notified = "none";
        else if (key === "via" && VIA_VALUES.includes(value)) result.via = value as AzureViaFilter;
        else if (key === "noEligible" && value === "true") result.noEligible = true;
        else if (key === "excludeEmergency" && value === "true") result.excludeEmergency = true;
        else if (key === "role" && ROLE_PATTERN.test(value)) result.role = value.toLowerCase();
    }
    return withoutQuery(result);
}

/** The `key:value` pairs of every field that differs from the default, in `AZURE_FILTER_KEYS` order; `query` is never in it */
export function serializeAzureFilter(filters: AzureReportFilters): string {
    const pairs: string[] = [];
    for (const key of AZURE_FILTER_KEYS) {
        if (filters[key] === DEFAULT_AZURE_FILTERS[key]) continue;
        pairs.push(`${key}:${String(filters[key])}`);
    }
    return pairs.join(",");
}

export interface AzureReportUrlState {
    /** `view=roles` or `view=assignments`; null when the URL has none, so the saved preference decides (Azure spec 15.3) */
    view: AzureListView | null;
    scopeId: string | null;
    /** The role GUID of the role view (`role`); read and written only when the view is not `assignments` */
    roleId: string | null;
    filters: AzureReportFilters;
}

export function parseAzureReportUrlState(search: string): AzureReportUrlState {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const view = params.get("view");
    const parsedView = isAzureListView(view) ? view : null;
    const role = params.get("role");
    return {
        view: parsedView,
        scopeId: params.get("scope"),
        roleId: parsedView !== "assignments" && role ? role : null,
        filters: { ...parseAzureFilter(params.get("f")), query: params.get("q") ?? "" },
    };
}

/**
 * The query string (no `?`): every parameter of `currentSearch` except `view`, `scope`, `role`, `q` and `f`, then
 * those five. `f` stays raw, as the dashboard filter.
 */
export function buildAzureReportSearch(state: AzureReportUrlState, currentSearch = ""): string {
    const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
    for (const key of ["view", "scope", "role", "q", "f"]) params.delete(key);
    if (state.view !== null) params.set("view", state.view);
    if (state.scopeId !== null) params.set("scope", state.scopeId);
    if (state.roleId !== null && state.view !== "assignments") params.set("role", state.roleId);
    if (state.filters.query.trim() !== "") params.set("q", state.filters.query);
    const rest = params.toString();
    const f = serializeAzureFilter(state.filters);
    if (!f) return rest;
    return rest ? `${rest}&f=${f}` : `f=${f}`;
}

const BOOLEAN_CHIP_LABELS = {
    privileged: "Privileged roles",
    customRole: "Custom roles",
    noEligible: "No eligible assignment",
    excludeEmergency: "Emergency access left out",
} as const;

const CHIP_LABELS: Record<Exclude<AzureFilterKey, keyof typeof BOOLEAN_CHIP_LABELS | "resourceType" | "role">, Record<string, string>> = {
    status: { eligible: "Assignment: Eligible", active: "Assignment: Active", activated: "Assignment: Active after activation", assigned: "Assignment: Active assigned" },
    origin: { all: "Origin: All", inherited: "Origin: Inherited" },
    principalType: {
        user: "Held by: Users", group: "Held by: Groups", app: "Held by: Apps", foreignGroup: "Held by: Foreign groups",
        guest: "Held by: Guests", agent: "Held by: Agents", managedIdentity: "Held by: Managed identities", deleted: "Held by: Deleted",
    },
    ends: { permanent: "Ends: Permanent", within30: "Ends: Within 30 days", timeBound: "Ends: Time-bound" },
    level: {
        managementGroup: "Level: Management groups", subscriptionOrAbove: "Level: Subscription or above",
        subscription: "Level: Subscriptions", resourceGroup: "Level: Resource groups", resource: "Level: Resources",
    },
    approval: { required: "Approval: Required", notRequired: "Approval: Not required" },
    justification: { required: "Justification: Required", notRequired: "Justification: Not required" },
    mfa: { entraMfa: "MFA: Entra MFA", authContext: "MFA: Authentication context", neither: "MFA: Neither" },
    // The wording of DURATION_LABELS in dashboardFilter.ts
    maxDuration: {
        upTo1h: "Maximum duration: up to 1 h", upTo4h: "Maximum duration: up to 4 h", upTo8h: "Maximum duration: up to 8 h",
        upTo12h: "Maximum duration: up to 12 h", over12h: "Maximum duration: over 12 h", over8h: "Maximum duration: over 8 h",
    },
    notified: { none: "Nobody is notified" },
    via: { direct: "Through: Direct", group: "Through: A group" },
};

function chipLabel(filters: AzureReportFilters, key: AzureFilterKey, roleNames?: ReadonlyMap<string, string>): string {
    if (key === "privileged" || key === "customRole" || key === "noEligible" || key === "excludeEmergency") return BOOLEAN_CHIP_LABELS[key];
    if (key === "resourceType") return `Resource type: ${resourceIconFor(filters.resourceType).label}`;
    if (key === "role") return `Role: ${roleNames?.get(filters.role) ?? filters.role.slice(0, 8)}`;
    const value = String(filters[key]);
    return CHIP_LABELS[key][value] ?? value;
}

/** One chip per field that differs from the default, in `AZURE_FILTER_KEYS` order */
export function getAzureFilterChips(filters: AzureReportFilters, roleNames?: ReadonlyMap<string, string>): AzureFilterChip[] {
    return AZURE_FILTER_KEYS
        .filter((key) => filters[key] !== DEFAULT_AZURE_FILTERS[key])
        .map((key) => ({ key, label: chipLabel(filters, key, roleNames) }));
}

export function removeAzureFilterKey(filters: AzureReportFilters, key: AzureFilterKey): AzureReportFilters {
    return { ...filters, [key]: DEFAULT_AZURE_FILTERS[key] };
}

/** The controls of the panel; the resource type options come from the types of the scopes in the tree */
export function getAzureFilterControls(resourceTypes: readonly string[]): AzureFilterControl[] {
    const unique = [...new Set(resourceTypes.map((t) => t.toLowerCase()))]
        .map((value) => ({ value, label: resourceIconFor(value).label }))
        .sort((x, y) => x.label.localeCompare(y.label, "en"));
    return [
        {
            key: "status", label: "State", group: "Assignments", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "eligible", label: "Eligible" },
                { value: "active", label: "Active" },
                { value: "activated", label: "Active after activation" },
                { value: "assigned", label: "Active assigned" },
            ],
        },
        {
            key: "origin", label: "Origin", group: "Assignments", neutral: "here",
            options: [
                { value: "here", label: "This scope" },
                { value: "all", label: "All" },
                { value: "inherited", label: "Inherited" },
            ],
        },
        {
            key: "principalType", label: "Held by", group: "Assignments", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "user", label: "Users" },
                { value: "group", label: "Groups" },
                { value: "app", label: "Apps" },
                { value: "guest", label: "Guests" },
                { value: "agent", label: "Agents" },
                { value: "managedIdentity", label: "Managed identities" },
                { value: "foreignGroup", label: "Foreign groups" },
                { value: "deleted", label: "Deleted" },
            ],
        },
        {
            key: "via", label: "Through", group: "Assignments", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "direct", label: "Direct" },
                { value: "group", label: "A group" },
            ],
        },
        {
            key: "ends", label: "Ends", group: "Assignments", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "permanent", label: "Permanent" },
                { value: "within30", label: "Within 30 days" },
                { value: "timeBound", label: "Time-bound" },
            ],
        },
        {
            key: "privileged", label: "Privileged", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "true", label: "Privileged only" },
            ],
        },
        {
            key: "customRole", label: "Custom role", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "true", label: "Custom only" },
            ],
        },
        {
            key: "approval", label: "Approval", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "required", label: "Required" },
                { value: "notRequired", label: "Not required" },
            ],
        },
        {
            key: "mfa", label: "MFA", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "entraMfa", label: "Entra MFA" },
                { value: "authContext", label: "Authentication context" },
                { value: "neither", label: "Neither" },
            ],
        },
        {
            key: "justification", label: "Justification", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "required", label: "Required" },
                { value: "notRequired", label: "Not required" },
            ],
        },
        {
            key: "maxDuration", label: "Maximum duration", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "upTo1h", label: "Up to 1 h" },
                { value: "upTo4h", label: "Up to 4 h" },
                { value: "upTo8h", label: "Up to 8 h" },
                { value: "upTo12h", label: "Up to 12 h" },
                { value: "over12h", label: "Over 12 h" },
                { value: "over8h", label: "Over 8 h" },
            ],
        },
        {
            key: "notified", label: "Notified", group: "Role properties", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "none", label: "Nobody" },
            ],
        },
        {
            key: "level", label: "Level", group: "Scope", neutral: "all",
            options: [
                { value: "all", label: "All" },
                { value: "managementGroup", label: "Management groups" },
                { value: "subscription", label: "Subscriptions" },
                { value: "resourceGroup", label: "Resource groups" },
                { value: "resource", label: "Resources" },
                { value: "subscriptionOrAbove", label: "Subscription or above" },
            ],
        },
        {
            key: "resourceType", label: "Resource type", group: "Scope", neutral: "all",
            options: [{ value: "all", label: "All" }, ...unique],
        },
    ];
}

export function readAzureControlValue(control: AzureFilterControl, filters: AzureReportFilters): string {
    if (control.key === "privileged") return filters.privileged ? "true" : "all";
    if (control.key === "customRole") return filters.customRole ? "true" : "all";
    return String(filters[control.key]);
}

/** An invalid value leaves the filters unchanged */
export function writeAzureControlValue(control: AzureFilterControl, filters: AzureReportFilters, value: string): AzureReportFilters {
    if (!control.options.some((option) => option.value === value)) return filters;
    if (control.key === "privileged") return { ...filters, privileged: value === "true" };
    if (control.key === "customRole") return { ...filters, customRole: value === "true" };
    return { ...filters, [control.key]: value };
}

export function groupAzureControls(controls: readonly AzureFilterControl[]): { group: AzureFilterGroup; controls: AzureFilterControl[] }[] {
    const groups: { group: AzureFilterGroup; controls: AzureFilterControl[] }[] = [];
    for (const control of controls) {
        const existing = groups.find((g) => g.group === control.group);
        if (existing) existing.controls.push(control);
        else groups.push({ group: control.group, controls: [control] });
    }
    return groups;
}
