/**
 * Label slugs of authentication contexts (spec 9.3): the rule of PIM Monitor's `Get-InventorySlug`: accents dropped
 * (é is e), lower case, keep `a-z0-9`, whitespace and hyphens become one `-`, everything else goes. "Phish-resistant &
 * SIF" is `phish-resistant-sif`.
 * The admin's choices are kept per tenant in localStorage `pim-access-model-contexts:{tenantId}` and
 * `pim-access-model-groups:{tenantId}`.
 */
import { PLANES, SECURITY_LEVELS, type Plane, type SecurityLevel } from "@/utils/accessModelCatalog";

export function slugify(name: string): string {
    return name
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/[\s-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export interface TenantContext {
    id: string;
    displayName: string;
}

export type ContextMatch =
    | { kind: "chosen"; contextId: string }
    | { kind: "byName"; contextId: string }
    | { kind: "byPolicy"; contextId: string }
    | { kind: "choose"; candidates: string[] }
    | { kind: "none" };

/**
 * Matches a label to a context in the tenant: the admin's own choice first, then a context whose display name slugifies
 * to the label, then (when Conditional Access could be read) the one context whose enabled policy meets the label.
 * Several or none: the admin chooses.
 */
export function matchContext(
    slug: string,
    contexts: readonly TenantContext[],
    chosen: Readonly<Record<string, string>>,
    byPolicy?: readonly string[],
): ContextMatch {
    const own = chosen[slug];
    if (own && contexts.some((c) => c.id === own)) return { kind: "chosen", contextId: own };
    const named = contexts.filter((c) => slugify(c.displayName) === slug);
    if (named.length === 1) return { kind: "byName", contextId: named[0].id };
    if (named.length > 1) return { kind: "choose", candidates: named.map((c) => c.id) };
    if (byPolicy && byPolicy.length === 1) return { kind: "byPolicy", contextId: byPolicy[0] };
    if (byPolicy && byPolicy.length > 1) return { kind: "choose", candidates: [...byPolicy] };
    return { kind: "none" };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const CONTEXT_CHOICE_PREFIX = "pim-access-model-contexts:";
export const GROUP_PLACEMENT_PREFIX = "pim-access-model-groups:";

/** Reads a per-tenant map and keeps only the valid entries, so one bad entry never wipes the others */
function readMap<T>(storage: StorageLike | null, key: string, isValid: (v: unknown) => v is T): Record<string, T> {
    if (!storage) return {};
    try {
        const raw = storage.getItem(key);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const result: Record<string, T> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (isValid(v)) result[k] = v;
        return result;
    } catch {
        return {};
    }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): boolean {
    if (!storage) return false;
    try {
        storage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

const isString = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Label slug to context id, per tenant */
export function readContextChoices(storage: StorageLike | null, tenantId: string): Record<string, string> {
    return tenantId ? readMap(storage, CONTEXT_CHOICE_PREFIX + tenantId, isString) : {};
}

export function writeContextChoice(storage: StorageLike | null, tenantId: string, slug: string, contextId: string | null): boolean {
    if (!tenantId) return false;
    const next = { ...readContextChoices(storage, tenantId) };
    if (contextId) next[slug] = contextId;
    else delete next[slug];
    return writeJson(storage, CONTEXT_CHOICE_PREFIX + tenantId, next);
}

export interface GroupPlacement {
    plane: Plane;
    securityLevel: SecurityLevel;
}

const isPlacement = (p: unknown): p is GroupPlacement =>
    !!p && typeof p === "object" && (PLANES as readonly string[]).includes((p as GroupPlacement).plane)
    && (SECURITY_LEVELS as readonly string[]).includes((p as GroupPlacement).securityLevel);

/** Group id to plane and level, per tenant */
export function readGroupPlacements(storage: StorageLike | null, tenantId: string): Record<string, GroupPlacement> {
    return tenantId ? readMap(storage, GROUP_PLACEMENT_PREFIX + tenantId, isPlacement) : {};
}

export function writeGroupPlacement(storage: StorageLike | null, tenantId: string, groupId: string, placement: GroupPlacement | null): boolean {
    if (!tenantId) return false;
    const next = { ...readGroupPlacements(storage, tenantId) };
    if (placement) next[groupId] = placement;
    else delete next[groupId];
    return writeJson(storage, GROUP_PLACEMENT_PREFIX + tenantId, next);
}
