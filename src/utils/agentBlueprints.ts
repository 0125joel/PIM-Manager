import type { RoleDetailData } from "@/types/directoryRole.types";
import type { PimGroupData } from "@/types/pimGroup.types";
import { COPILOT_STUDIO_BLUEPRINT_APP_ID } from "@/config/constants";

/**
 * The blueprints whose names the Report shows next to an agent identity (AG-5): every distinct agentIdentityBlueprintId
 * of the loaded role and group assignments, lower case, without the Copilot Studio blueprint (its product name is known).
 */
export function collectBlueprintAppIds(roles: readonly RoleDetailData[], groups: readonly PimGroupData[]): string[] {
    const ids = new Set<string>();
    const take = (principal: { agentIdentityBlueprintId?: string | null } | null | undefined) => {
        const id = principal?.agentIdentityBlueprintId?.toLowerCase();
        if (id && id !== COPILOT_STUDIO_BLUEPRINT_APP_ID) ids.add(id);
    };
    for (const role of roles) {
        for (const item of [...role.assignments.permanent, ...role.assignments.eligible, ...role.assignments.active]) take(item.principal);
    }
    for (const group of groups) {
        for (const assignment of group.assignments) take(assignment.principal);
    }
    return [...ids].sort();
}

/** sessionStorage key per tenant; the `pim_` prefix makes sign-out and "Clear cached data" remove it (utils/cacheUtils.ts) */
export const blueprintCacheKey = (tenantId: string) => `pim_agent_blueprints:${tenantId}`;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readBlueprintCache(tenantId: string, storage: StorageLike | null): Map<string, string> {
    try {
        const raw = storage?.getItem(blueprintCacheKey(tenantId));
        if (!raw) return new Map();
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
        return new Map(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch {
        return new Map();
    }
}

export function writeBlueprintCache(tenantId: string, names: ReadonlyMap<string, string>, storage: StorageLike | null): void {
    try {
        storage?.setItem(blueprintCacheKey(tenantId), JSON.stringify(Object.fromEntries(names)));
    } catch {
        // A full or blocked storage only costs a second read later.
    }
}
