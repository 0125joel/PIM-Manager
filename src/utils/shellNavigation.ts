import type { IconName } from "@/components/icons/Icon";

/** Pure helpers of the app shell: navigation items, active matching, initials, tenant name. */

export interface NavItem {
    name: string;
    path: string;
    icon: IconName;
    tourId: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
    { name: "Dashboard", path: "/dashboard", icon: "dashboard", tourId: "nav-dashboard" },
    { name: "Report", path: "/report", icon: "report", tourId: "nav-report" },
    { name: "Configure", path: "/configure", icon: "configure", tourId: "nav-configure" },
];

/** True for the page itself and anything below it (`/report/x`), never for a longer sibling (`/reportx`). */
export function isNavActive(pathname: string | null | undefined, path: string): boolean {
    if (!pathname) return false;
    const clean = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
    return clean === path || clean.startsWith(`${path}/`);
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
