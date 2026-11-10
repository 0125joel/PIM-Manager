import type { IconName } from "@/components/icons/Icon";

/** Pure helpers of the app shell: navigation items, active matching, initials, tenant name. */

export interface NavItem {
    name: string;
    path: string;
    icon: IconName;
    tourId: string;
    /** Active on the page itself only: `/azure` holds the other Azure pages below it */
    isExact?: boolean;
}

/** The environment of the shell switcher (Azure spec 1): read from the route, never stored */
export type Environment = "entra" | "azure";

export const NAV_ITEMS: readonly NavItem[] = [
    { name: "Dashboard", path: "/dashboard", icon: "dashboard", tourId: "nav-dashboard" },
    { name: "Report", path: "/report", icon: "report", tourId: "nav-report" },
    { name: "Configure", path: "/configure", icon: "configure", tourId: "nav-configure" },
];

/** The same three pages under `/azure`; the tour ids stay the same, only one list is on screen at a time */
export const AZURE_NAV_ITEMS: readonly NavItem[] = [
    { name: "Dashboard", path: "/azure", icon: "dashboard", tourId: "nav-dashboard", isExact: true },
    { name: "Report", path: "/azure/report", icon: "report", tourId: "nav-report" },
    { name: "Configure", path: "/azure/configure", icon: "configure", tourId: "nav-configure" },
];

function withoutTrailingSlash(pathname: string): string {
    return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** True for the page itself and anything below it (`/report/x`), never for a longer sibling (`/reportx`). */
export function isNavActive(pathname: string | null | undefined, path: string): boolean {
    if (!pathname) return false;
    const clean = withoutTrailingSlash(pathname);
    return clean === path || clean.startsWith(`${path}/`);
}

/** `isNavActive` for an item of a navigation list, exact for an item that holds other pages below it */
export function isNavItemActive(pathname: string | null | undefined, item: NavItem): boolean {
    if (!item.isExact) return isNavActive(pathname, item.path);
    return !!pathname && withoutTrailingSlash(pathname) === item.path;
}

/** `"azure"` for `/azure` and below, `"entra"` for every other route */
export function environmentFromPath(pathname: string | null | undefined): Environment {
    return isNavActive(pathname, "/azure") ? "azure" : "entra";
}

export function navItemsFor(environment: Environment): readonly NavItem[] {
    return environment === "azure" ? AZURE_NAV_ITEMS : NAV_ITEMS;
}

/**
 * Where the wordmark goes: the dashboard of the current environment, so it never switches environment (Joël 2026-10-18).
 */
export function homePathFor(environment: Environment): string {
    return environment === "azure" ? "/azure" : "/dashboard";
}

/**
 * Where the switcher goes: the same page in the other environment, or its dashboard for a page the other side does not have. The query string is dropped, the filters differ per environment.
 */
export function switchEnvironmentPath(pathname: string | null | undefined, target: Environment): string {
    const from = navItemsFor(target === "azure" ? "entra" : "azure");
    const to = navItemsFor(target);
    const index = from.findIndex((item) => isNavItemActive(pathname, item));
    if (index >= 0) return to[index].path;
    return homePathFor(target);
}

/** Up to two initials from a display name, falling back to the first letters of the user principal name. */
export function getInitials(displayName: string | null | undefined, userPrincipalName?: string | null): string {
    const words = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
        return (Array.from(words[0])[0] + Array.from(words[words.length - 1])[0]).toUpperCase();
    }
    if (words.length === 1) {
        return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
    }
    const local = (userPrincipalName ?? "").split("@")[0].replace(/[^\p{L}\p{N}]/gu, "");
    return Array.from(local).slice(0, 2).join("").toUpperCase();
}

/** First 8 characters of the tenant id, the label while the display name is unknown. */
export function shortTenantId(tenantId: string | null | undefined): string {
    return (tenantId ?? "").slice(0, 8);
}

export function tenantNameCacheKey(tenantId: string): string {
    return `pim_tenant_name_${tenantId}`;
}

/**
 * Display name from `GET /organization?$select=id,displayName`. The answer is a collection; the entry must be
 * the tenant of the signed-in account. Null when there is no usable name.
 */
export function parseOrganizationResponse(body: unknown, tenantId: string): string | null {
    const value = (body as { value?: { id?: string; displayName?: string }[] } | null | undefined)?.value;
    if (!Array.isArray(value) || value.length === 0) return null;
    const organization = value[0];
    if (organization?.id !== tenantId) return null;
    const name = organization.displayName?.trim();
    return name ? name : null;
}
