import { escapeODataString } from "@/utils/odataUtils";
import { getPrincipalKind, toBasicKind } from "@/utils/principalUtils";

/**
 * Pure helpers to read the `userType` (Member or Guest) of the users that hold a role.
 * The expanded `principal` on role schedules supports `$select` of `id` only, so the type comes from
 * `GET /users?$filter=id in (...)&$select=id,userType` (spec 5.3). The `in` operator takes at most
 * 15 values by default, hence the chunks.
 */

/** Default limit of the OData `in` operator in Microsoft Graph. */
export const USER_ID_CHUNK_SIZE = 15;

export function chunkArray<T>(items: T[], size: number): T[][] {
    if (size < 1) throw new Error("chunk size must be at least 1");
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/** `id in ('a','b')` with every value escaped. */
export function buildUserIdFilter(ids: string[]): string {
    return `id in (${ids.map((id) => `'${escapeODataString(id)}'`).join(",")})`;
}

interface PrincipalHolder {
    principalId: string;
    principal?: { "@odata.type"?: string; servicePrincipalType?: string | null } | null;
}

/**
 * Distinct principal ids that can be users: everything except principals the expand already shows to be
 * groups, service principals or agent identities. Active schedules carry no expanded principal, so their ids are included
 * and a lookup that finds no user simply leaves them out.
 */
export function collectUserCandidateIds(lists: PrincipalHolder[][]): string[] {
    const ids = new Set<string>();
    for (const list of lists) {
        for (const item of list) {
            if (!item.principalId) continue;
            const kind = toBasicKind(getPrincipalKind(item.principal));
            if (kind === "group" || kind === "servicePrincipal") continue;
            ids.add(item.principalId);
        }
    }
    return Array.from(ids);
}

/** Copies `userType` of the matching user onto each item as `principalUserType`; other items are returned unchanged. */
export function applyUserTypes<T extends { principalId: string; principalUserType?: string }>(items: T[], userTypes: Map<string, string>): T[] {
    return items.map((item) => {
        const userType = userTypes.get(item.principalId);
        return userType === undefined ? item : { ...item, principalUserType: userType };
    });
}

/** userType of every principal already read on a previous load, so a refresh only looks up new ids. */
export function collectKnownUserTypes(roles: { assignments: { permanent: PrincipalTyped[]; eligible: PrincipalTyped[]; active: PrincipalTyped[] } }[]): Map<string, string> {
    const known = new Map<string, string>();
    for (const role of roles) {
        for (const list of [role.assignments.permanent, role.assignments.eligible, role.assignments.active]) {
            for (const item of list) {
                if (item.principalUserType) known.set(item.principalId, item.principalUserType);
            }
        }
    }
    return known;
}

interface PrincipalTyped {
    principalId: string;
    principalUserType?: string;
}

export function isGuestUserType(userType: string | undefined): boolean {
    return userType?.toLowerCase() === "guest";
}
