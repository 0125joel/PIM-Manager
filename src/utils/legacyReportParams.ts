import type { DashboardFilter } from "@/types/dashboardFilter.types";
import { buildSearchWithFilter, parseDashboardFilter } from "@/utils/dashboardFilter";
import { MAX_DURATION_PANEL_LABELS } from "@/utils/assignmentKinds";

/**
 * Old Report links (`?privileged=yes&approval=required&search=anna`) are converted once on mount into the filter language
 * `f` and `q` (Report spec 6.1). Pure: the hook replaces the URL with the result. Every legacy parameter is removed, also
 * those without a counterpart (`pimConfigured`, `assignmentCount`, `scopeType`, `groupType`, `accessType`, `customExtension`,
 * `duration`); parameters that are not legacy (`view`, `role`, `group`, `q`, `f`, anything unknown) stay as they are. A
 * key already in `f` wins over a converted one with the same name. Without legacy parameters the search is returned as it came.
 */

const LEGACY_PARAMS = [
    "privileged", "approval", "mfaType", "justification", "maxDuration", "assignmentType", "memberType", "roleType",
    "hasAssignments", "search", "user",
    // no counterpart
    "pimConfigured", "assignmentCount", "scopeType", "groupType", "accessType", "customExtension", "duration",
] as const;

const REQUIRED_YES = new Set(["required", "yes", "true"]);
const REQUIRED_NO = new Set(["notrequired", "not-required", "no", "false"]);

function firstValue(raw: string): string {
    return raw.split(",").map((v) => v.trim()).find(Boolean) ?? "";
}

function convertRequired(raw: string): "required" | "notRequired" | undefined {
    const value = firstValue(raw).toLowerCase();
    if (REQUIRED_YES.has(value)) return "required";
    if (REQUIRED_NO.has(value)) return "notRequired";
    return undefined;
}

function convertMfa(raw: string): DashboardFilter["mfa"] {
    const value = firstValue(raw);
    const lower = value.toLowerCase();
    if (lower === "azure-mfa" || lower === "entramfa") return "entraMfa";
    if (lower.startsWith("ca:") || lower === "authcontext") return "authContext";
    if (lower === "none" || lower === "neither") return "neither";
    return undefined;
}

function convertMaxDuration(raw: string): DashboardFilter["maxDuration"] {
    const value = firstValue(raw);
    for (const [bucket, label] of Object.entries(MAX_DURATION_PANEL_LABELS)) {
        if (label === value) return bucket as DashboardFilter["maxDuration"];
    }
    return parseDashboardFilter(`maxDuration:${value}`).maxDuration;
}

function convert(params: URLSearchParams): DashboardFilter {
    const filter: DashboardFilter = {};
    const get = (name: string) => params.get(name) ?? "";

    const privileged = firstValue(get("privileged")).toLowerCase();
    if (privileged === "yes" || privileged === "privileged" || privileged === "true") filter.privileged = true;
    else if (privileged === "no" || privileged === "non-privileged" || privileged === "false") filter.privileged = false;

    const approval = convertRequired(get("approval"));
    if (approval) filter.approval = approval;
    const justification = convertRequired(get("justification"));
    if (justification) filter.justification = justification;
    const mfa = convertMfa(get("mfaType"));
    if (mfa) filter.mfa = mfa;
    const maxDuration = convertMaxDuration(get("maxDuration"));
    if (maxDuration) filter.maxDuration = maxDuration;

    const assignmentType = firstValue(get("assignmentType")).toLowerCase();
    if (assignmentType === "permanent" || assignmentType === "eligible" || assignmentType === "active") filter.assignment = assignmentType;

    const memberType = firstValue(get("memberType")).toLowerCase();
    if (memberType === "direct" || memberType === "group") filter.via = memberType;

    const roleType = firstValue(get("roleType")).toLowerCase();
    if (roleType === "custom") filter.customRole = true;
    else if (roleType === "builtin") filter.customRole = false;

    if (firstValue(get("hasAssignments")).toLowerCase() === "yes") filter.hasAssignments = true;
    return filter;
}

export function convertLegacyReportParams(search: string): { search: string; changed: boolean } {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const hasLegacy = LEGACY_PARAMS.some((name) => params.has(name));
    if (!hasLegacy) return { search, changed: false };

    const converted = convert(params);
    // A search term from the old page: the free text wins over the old "user" field
    const text = (params.get("search") ?? "").trim() || (params.get("user") ?? "").trim();
    const existing = parseDashboardFilter(params.get("f"));

    for (const name of LEGACY_PARAMS) params.delete(name);
    if (text && !params.has("q")) params.set("q", text);

    // The existing filter wins per key
    const merged: DashboardFilter = { ...converted, ...existing };
    return { search: buildSearchWithFilter(params.toString(), merged), changed: true };
}
