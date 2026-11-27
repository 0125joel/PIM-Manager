/**
 * Whether the viewer dismissed the banner of the Audit page ("You are looking at up to 30 days ..."), kept per tenant in
 * this browser. Only this one boolean is stored, as "1"; nothing of the audit log. Storage can be missing or blocked: then
 * the banner shows every time and a dismissal lasts until the page is left.
 */
type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function auditBannerKey(tenantId: string): string {
    return `audit-banner-dismissed-${tenantId}`;
}

/** True only when this tenant's banner was dismissed; no tenant, no storage or an unreadable value: false */
export function readAuditBannerDismissed(tenantId: string | null | undefined, storage: StorageLike | null = defaultStorage()): boolean {
    if (!tenantId) return false;
    try {
        return storage?.getItem(auditBannerKey(tenantId)) === "1";
    } catch {
        return false;
    }
}

/** Remembers the dismissal; false when it could not be stored */
export function writeAuditBannerDismissed(tenantId: string | null | undefined, storage: StorageLike | null = defaultStorage()): boolean {
    if (!tenantId) return false;
    try {
        storage?.setItem(auditBannerKey(tenantId), "1");
        return storage !== null;
    } catch {
        return false;
    }
}
