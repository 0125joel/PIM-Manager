/**
 * The PIM groups the user is an eligible member of, for "Your Azure roles" (AU-21). An eligible membership gives no
 * Azure role yet: Azure shows the role of a group only after the membership is activated (measured 2026-11-13). Pure
 * logic, no React.
 */
import { endTextFor } from "@/utils/azureReport";
import type { MyGroupInstance } from "@/utils/writeAccess";

export interface MyGroupPath {
    groupId: string;
    groupName: string;
    /** "Permanent" or the end date, as the table */
    endText: string;
    isPermanent: boolean;
}

/** `listed` when PIM for Groups could be read, `noConsent` without read access to it, `failed` when a group read failed */
export type MyGroupPathsState = { kind: "listed"; groups: MyGroupPath[] } | { kind: "noConsent" } | { kind: "failed" };

/**
 * One entry per group the user is an eligible member of: owners are left out (an owner does not get the group's roles),
 * and so is a group whose membership is active now (Azure shows it through the role itself). The latest end wins and
 * a permanent eligibility wins over any end. `names` is by lower-case group id; a missing name falls back to the id.
 */
export function myGroupPaths(
    eligible: readonly MyGroupInstance[],
    active: readonly MyGroupInstance[],
    names: ReadonlyMap<string, string>,
): MyGroupPath[] {
    const activeIds = new Set(active.filter((i) => i.accessId === "member").map((i) => i.groupId.toLowerCase()));
    // null is permanent
    const ends = new Map<string, { groupId: string; end: string | null }>();
    for (const instance of eligible) {
        if (instance.accessId !== "member") continue;
        const key = instance.groupId.toLowerCase();
        if (activeIds.has(key)) continue;
        const end = instance.endDateTime ?? null;
        const known = ends.get(key);
        if (!known) {
            ends.set(key, { groupId: instance.groupId, end });
        } else if (known.end !== null && (end === null || Date.parse(end) > Date.parse(known.end))) {
            known.end = end;
        }
    }
    return [...ends.entries()]
        .map(([key, { groupId, end }]) => ({
            groupId,
            groupName: names.get(key) || groupId,
            endText: endTextFor(end),
            isPermanent: end === null,
        }))
        .sort((a, b) => a.groupName.localeCompare(b.groupName));
}
