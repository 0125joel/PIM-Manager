/**
 * The Log Analytics workspaces a person chose for the Audit page (implementation spec section 7), kept per tenant in this
 * browser. Only the customer ids are stored, as a JSON list under a key of the tenant; never a name, a subscription, a token
 * or anything of the audit log. Storage can be missing, blocked or hold rubbish: then there is no choice, and nothing throws.
 * Each person chooses for themselves; nothing is shared.
 */
import { isWorkspaceId } from "@/utils/auditWorkspaceKql";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const AUDIT_WORKSPACE_PREFIX = "audit-workspaces-";

/** The most workspaces one choice holds */
export const AUDIT_WORKSPACE_LIMIT = 20;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
        return null;
    }
}

export function auditWorkspaceKey(tenantId: string): string {
    return `${AUDIT_WORKSPACE_PREFIX}${tenantId.trim().toLowerCase()}`;
}

/** The ids in the order given, as lower-case GUIDs without duplicates; anything else is left out; at most AUDIT_WORKSPACE_LIMIT */
export function cleanWorkspaceIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const ids: string[] = [];
    for (const item of value) {
        if (!isWorkspaceId(item)) continue;
        const id = item.toLowerCase();
        if (!ids.includes(id)) ids.push(id);
        if (ids.length === AUDIT_WORKSPACE_LIMIT) break;
    }
    return ids;
}

/** The chosen ids of a tenant; empty without a tenant, without storage and for a value that is not a list of ids */
export function readWorkspaceChoice(tenantId: string | null | undefined, storage: StorageLike | null = defaultStorage()): string[] {
    if (!tenantId) return [];
    try {
        const raw = storage?.getItem(auditWorkspaceKey(tenantId));
        return raw ? cleanWorkspaceIds(JSON.parse(raw)) : [];
    } catch {
        return [];
    }
}

/** Remembers the choice of a tenant; an empty choice removes the key. False when it could not be stored. */
export function writeWorkspaceChoice(tenantId: string | null | undefined, ids: readonly string[], storage: StorageLike | null = defaultStorage()): boolean {
    if (!tenantId || !storage) return false;
    try {
        const clean = cleanWorkspaceIds(ids);
        if (clean.length === 0) storage.removeItem(auditWorkspaceKey(tenantId));
        else storage.setItem(auditWorkspaceKey(tenantId), JSON.stringify(clean));
        return true;
    } catch {
        return false;
    }
}

/** Removes the choice of every tenant (sign-out). Returns how many were removed; nothing throws. */
export function clearWorkspaceChoices(storage: StorageLike | null = defaultStorage()): number {
    if (!storage) return 0;
    try {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index++) {
            const key = storage.key(index);
            if (key?.startsWith(AUDIT_WORKSPACE_PREFIX)) keys.push(key);
        }
        for (const key of keys) storage.removeItem(key);
        return keys.length;
    } catch {
        return 0;
    }
}
